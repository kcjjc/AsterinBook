use super::Core;
use crate::contracts::{
    AppError, Book, Bookmark, Chapter, NovelIndex, ReadingPrefs, Result, TextChunk,
};
use crate::services::fs_ops::owned_dir;
use rusqlite::{params, OptionalExtension};
use std::{
    fs,
    io::{BufReader, Read, Seek, SeekFrom},
};
impl Core {
    pub fn list_books(&self, sort: &str) -> Result<Vec<Book>> {
        let order = if sort == "title" {
            "b.title COLLATE NOCASE,b.id"
        } else {
            "COALESCE(b.last_read_at,b.imported_at) DESC,b.id"
        };
        let mut query=self.connection()?.prepare(&format!("SELECT b.id,b.title,b.author,b.imported_at,b.last_read_at,b.total_utf16,COALESCE(p.offset,0),(SELECT COUNT(*) FROM chapters c WHERE c.book_id=b.id) FROM books b LEFT JOIN reading_positions p ON p.book_id=b.id WHERE b.state='ready' ORDER BY {order}"))?;
        let rows = query.query_map([], |r| {
            Ok(Book {
                id: r.get(0)?,
                title: r.get(1)?,
                author: r.get(2)?,
                imported_at: r.get(3)?,
                last_read_at: r.get(4)?,
                total_utf16: r.get::<_, i64>(5)? as u64,
                position: r.get::<_, i64>(6)? as u64,
                chapter_count: r.get::<_, i64>(7)? as u32,
            })
        })?;
        Ok(rows.collect::<std::result::Result<Vec<_>, _>>()?)
    }
    pub fn rename_book(&mut self, id: &str, title: &str) -> Result<()> {
        let title = title.trim();
        if title.is_empty() || title.chars().count() > 120 {
            return Err(AppError::new("INVALID_INDEX", "书名须为 1—120 个字符"));
        }
        self.connection()?.execute(
            "UPDATE books SET title=?1 WHERE id=?2 AND state='ready'",
            params![title, id],
        )?;
        Ok(())
    }
    pub fn remove_book(&mut self, id: &str) -> Result<()> {
        let path = owned_dir(&self.root_path()?, "books", id)?;
        self.connection()?
            .execute("UPDATE books SET state='deleting' WHERE id=?1", [id])?;
        if path.exists() {
            fs::remove_dir_all(path)?
        }
        self.connection()?
            .execute("DELETE FROM books WHERE id=?1", [id])?;
        Ok(())
    }
    pub(crate) fn recover_deletions(&mut self) -> Result<()> {
        let ids: Vec<String> = {
            let mut query = self
                .connection()?
                .prepare("SELECT id FROM books WHERE state='deleting'")?;
            let rows = query.query_map([], |r| r.get(0))?;
            rows.collect::<std::result::Result<_, _>>()?
        };
        for id in ids {
            self.remove_book(&id)?
        }
        Ok(())
    }
    pub fn get_index(&self, id: &str) -> Result<NovelIndex> {
        let json: String = self.connection()?.query_row(
            "SELECT index_meta FROM books WHERE id=?1 AND state='ready'",
            [id],
            |r| r.get(0),
        )?;
        let mut index: NovelIndex = serde_json::from_str(&json)?;
        let mut query=self.connection()?.prepare("SELECT id,chapter_order,title,volume_id,heading_start,body_start,body_end,byte_start,byte_end FROM chapters WHERE book_id=?1 ORDER BY chapter_order")?;
        let rows = query.query_map([id], |r| {
            Ok(Chapter {
                id: r.get(0)?,
                order: r.get::<_, i64>(1)? as u32,
                title: r.get(2)?,
                volume_id: r.get(3)?,
                heading_start: r.get::<_, i64>(4)? as u64,
                body_start: r.get::<_, i64>(5)? as u64,
                body_end: r.get::<_, i64>(6)? as u64,
                byte_start: r.get::<_, i64>(7)? as u64,
                byte_end: r.get::<_, i64>(8)? as u64,
            })
        })?;
        index.chapters = rows.collect::<std::result::Result<_, _>>()?;
        Ok(index)
    }
    pub fn read_text(&self, id: &str, chapter: &str, start: u64, max: u64) -> Result<TextChunk> {
        let index = self.get_index(id)?;
        let c = index
            .chapters
            .iter()
            .find(|c| c.id == chapter)
            .ok_or_else(|| AppError::new("INVALID_INDEX", "章节不存在"))?;
        if start < c.body_start || start > c.body_end || max == 0 || max > 65536 {
            return Err(AppError::new("INVALID_INDEX", "正文读取范围无效"));
        }
        if start == c.body_end {
            return Ok(TextChunk {
                start,
                text: String::new(),
                next: start,
                done: true,
            });
        }
        let checkpoint = index
            .checkpoints
            .iter()
            .rev()
            .find(|p| p.utf16 <= start)
            .ok_or_else(|| AppError::new("INVALID_INDEX", "正文定位索引缺失"))?;
        let mut file = BufReader::new(fs::File::open(
            owned_dir(&self.root_path()?, "books", id)?.join("content.txt"),
        )?);
        file.seek(SeekFrom::Start(checkpoint.byte))?;
        let mut position = checkpoint.utf16;
        while position < start {
            position += read_char(&mut file)?.len_utf16() as u64;
        }
        if position != start {
            return Err(AppError::new(
                "INVALID_INDEX",
                "位置不能在 UTF-16 代理对内部",
            ));
        }
        let mut text = String::new();
        while position < c.body_end && position - start < max {
            let ch = read_char(&mut file)?;
            let next = position + ch.len_utf16() as u64;
            if next - start > max {
                break;
            }
            text.push(ch);
            position = next;
        }
        if position == start {
            return Err(AppError::new("INVALID_INDEX", "读取长度不足以容纳完整字符"));
        }
        Ok(TextChunk {
            start,
            text,
            next: position,
            done: position == c.body_end,
        })
    }
    pub fn save_position(&mut self, id: &str, offset: u64) -> Result<()> {
        let index = self.get_index(id)?;
        if offset > index.total_utf16 {
            return Err(AppError::new("INVALID_INDEX", "阅读位置超出正文"));
        }
        let now = chrono::Utc::now().to_rfc3339();
        let tx = self.db.as_mut().unwrap().transaction()?;
        tx.execute("INSERT INTO reading_positions VALUES(?1,?2,?3) ON CONFLICT(book_id) DO UPDATE SET offset=excluded.offset,updated_at=excluded.updated_at",params![id,offset as i64,now])?;
        tx.execute(
            "UPDATE books SET last_read_at=?1 WHERE id=?2",
            params![now, id],
        )?;
        tx.commit()?;
        Ok(())
    }
    pub fn list_bookmarks(&self, id: &str) -> Result<Vec<Bookmark>> {
        let mut query=self.connection()?.prepare("SELECT id,book_id,offset,excerpt,created_at FROM bookmarks WHERE book_id=?1 ORDER BY offset")?;
        let rows = query.query_map([id], |r| {
            Ok(Bookmark {
                id: r.get(0)?,
                book_id: r.get(1)?,
                offset: r.get::<_, i64>(2)? as u64,
                excerpt: r.get(3)?,
                created_at: r.get(4)?,
            })
        })?;
        Ok(rows.collect::<std::result::Result<_, _>>()?)
    }
    pub fn add_bookmark(&mut self, id: &str, offset: u64, excerpt: &str) -> Result<Bookmark> {
        let index = self.get_index(id)?;
        if !index
            .chapters
            .iter()
            .any(|c| c.body_start <= offset && offset < c.body_end)
        {
            return Err(AppError::new("INVALID_INDEX", "书签不在正文范围内"));
        }
        let mark = Bookmark {
            id: uuid::Uuid::new_v4().to_string(),
            book_id: id.into(),
            offset,
            excerpt: excerpt.chars().take(240).collect(),
            created_at: chrono::Utc::now().to_rfc3339(),
        };
        self.connection()?.execute(
            "INSERT INTO bookmarks VALUES(?1,?2,?3,?4,?5) ON CONFLICT(book_id,offset) DO NOTHING",
            params![mark.id, id, offset as i64, mark.excerpt, mark.created_at],
        )?;
        self.list_bookmarks(id)?
            .into_iter()
            .find(|m| m.offset == offset)
            .ok_or_else(|| AppError::new("DB_ERROR", "书签保存失败"))
    }
    pub fn remove_bookmark(&mut self, id: &str) -> Result<()> {
        self.connection()?
            .execute("DELETE FROM bookmarks WHERE id=?1", [id])?;
        Ok(())
    }
    pub fn get_prefs(&self) -> Result<ReadingPrefs> {
        let json: Option<String> = self
            .connection()?
            .query_row("SELECT value_json FROM preferences WHERE id=1", [], |r| {
                r.get(0)
            })
            .optional()?;
        match json {
            Some(j) => Ok(serde_json::from_str(&j)?),
            None => Ok(ReadingPrefs::default()),
        }
    }
    pub fn set_prefs(&mut self, prefs: ReadingPrefs) -> Result<()> {
        if !(14.0..=36.0).contains(&prefs.font_size)
            || !(1.4..=2.6).contains(&prefs.line_height)
            || !(20.0..=100.0).contains(&prefs.margin)
            || prefs.font_family.len() > 256
            || !matches!(prefs.theme.as_str(), "warm" | "white" | "night")
            || !matches!(prefs.sort.as_str(), "recent" | "title")
        {
            return Err(AppError::new("INVALID_INDEX", "阅读排版参数不正确"));
        }
        self.connection()?.execute("INSERT INTO preferences VALUES(1,?1) ON CONFLICT(id) DO UPDATE SET value_json=excluded.value_json",[serde_json::to_string(&prefs)?])?;
        Ok(())
    }
    pub fn flush_writes(&self) -> Result<()> {
        self.connection()?.execute_batch("PRAGMA optimize")?;
        Ok(())
    }
}
fn read_char(reader: &mut impl Read) -> Result<char> {
    let mut bytes = [0u8; 4];
    reader.read_exact(&mut bytes[..1])?;
    let n = match bytes[0] {
        0..=127 => 1,
        0xc2..=0xdf => 2,
        0xe0..=0xef => 3,
        0xf0..=0xf4 => 4,
        _ => return Err(AppError::new("IO_ERROR", "正文编码已损坏")),
    };
    reader.read_exact(&mut bytes[1..n])?;
    std::str::from_utf8(&bytes[..n])
        .ok()
        .and_then(|s| s.chars().next())
        .ok_or_else(|| AppError::new("IO_ERROR", "正文编码已损坏"))
}
