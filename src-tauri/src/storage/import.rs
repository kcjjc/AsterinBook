use super::{Core, ImportSession};
use crate::contracts::{AppError, Book, NovelIndex, Result};
use crate::services::{
    bootstrap::atomic_write,
    fs_ops::{copy_source, owned_dir},
};
use rusqlite::{params, OptionalExtension};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashSet},
    fs,
    path::Path,
};
impl Core {
    pub fn prepare_import(&mut self, path: &Path) -> Result<serde_json::Value> {
        let root = self.root_path()?;
        let size = fs::metadata(path)?.len();
        if size > 52_428_800 {
            return Err(AppError::new("FILE_TOO_LARGE", "单个 TXT 上限为 50 MiB"));
        }
        if size == 0 {
            return Err(AppError::new("IO_ERROR", "文件为空"));
        }
        if fs2::available_space(&root)? < size.saturating_mul(5) + 1048576 {
            return Err(AppError::new("NO_SPACE", "阅读数据目录空间不足"));
        }
        let id = uuid::Uuid::new_v4().to_string();
        let stage = owned_dir(&root, "staging", &id)?;
        fs::create_dir(&stage)?;
        atomic_write(
            &stage.join("manifest.json"),
            &serde_json::to_vec(&serde_json::json!({"id":id,"phase":"copied"}))?,
        )?;
        let hash = match copy_source(path, &stage.join("source.txt"), 52_428_800) {
            Ok(h) => h,
            Err(e) => {
                let _ = fs::remove_dir_all(&stage);
                return Err(e);
            }
        };
        let duplicate: Option<String> = self
            .connection()?
            .query_row(
                "SELECT id FROM books WHERE source_hash=?1 AND state='ready'",
                [&hash],
                |r| r.get(0),
            )
            .optional()?;
        if let Some(book_id) = duplicate {
            fs::remove_dir_all(&stage)?;
            return Ok(serde_json::json!({"kind":"duplicate","bookId":book_id}));
        }
        let title = path
            .file_stem()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        self.sessions.insert(
            id.clone(),
            ImportSession {
                id: id.clone(),
                source_hash: hash,
                sequence: 0,
                bytes: 0,
                last_chunk: None,
            },
        );
        Ok(
            serde_json::json!({"kind":"prepared","value":{"sessionId":id,"suggestedTitle":title,"sourceBytes":size}}),
        )
    }
    pub fn read_import_source(&self, id: &str) -> Result<Vec<u8>> {
        if !self.sessions.contains_key(id) {
            return Err(AppError::new("SESSION_EXPIRED", "导入任务已结束"));
        }
        Ok(fs::read(
            owned_dir(&self.root_path()?, "staging", id)?.join("source.txt"),
        )?)
    }
    pub fn write_import_chunk(&mut self, id: &str, sequence: u32, bytes: &[u8]) -> Result<()> {
        let stage = owned_dir(&self.root_path()?, "staging", id)?;
        let session = self
            .sessions
            .get_mut(id)
            .ok_or_else(|| AppError::new("SESSION_EXPIRED", "导入任务已结束"))?;
        let hash = format!("{:x}", Sha256::digest(bytes));
        if session
            .last_chunk
            .as_ref()
            .is_some_and(|(seq, h)| *seq == sequence && *h == hash)
        {
            return Ok(());
        }
        if session.sequence != sequence
            || bytes.len() > 1048576
            || session.bytes + bytes.len() as u64 > 157286400
        {
            return Err(AppError::new("INVALID_INDEX", "正文块的顺序或大小不正确"));
        }
        let content = stage.join("content.txt");
        // Reestablish the last acknowledged length even if a previous rollback itself failed.
        let out = fs::OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(&content)?;
        out.set_len(session.bytes)?;
        out.sync_all()?;
        drop(out);
        if let Err(error) = self.fs_ops.append_chunk(&content, bytes) {
            let out = fs::OpenOptions::new().write(true).open(&content)?;
            out.set_len(session.bytes)?;
            out.sync_all()?;
            return Err(error);
        }
        session.sequence += 1;
        session.bytes += bytes.len() as u64;
        session.last_chunk = Some((sequence, hash));
        Ok(())
    }
    pub fn commit_import(&mut self, id: &str, title: &str, index: NovelIndex) -> Result<Book> {
        let title = title.trim();
        if title.is_empty() || title.chars().count() > 120 {
            return Err(AppError::new("INVALID_INDEX", "书名须为 1—120 个字符"));
        }
        let root = self.root_path()?;
        let stage = owned_dir(&root, "staging", id)?;
        let session = self
            .sessions
            .get(id)
            .ok_or_else(|| AppError::new("SESSION_EXPIRED", "导入任务已结束"))?;
        let content = fs::read(stage.join("content.txt"))?;
        validate_index(&content, &index)?;
        let imported = chrono::Utc::now().to_rfc3339();
        let target = owned_dir(&root, "books", id)?;
        atomic_write(
            &stage.join("manifest.json"),
            &serde_json::to_vec(&serde_json::json!({"id":session.id,"phase":"filesCommitted"}))?,
        )?;
        // Keep manifest in staging until the database commit is known. Only book files move.
        let committed = (|| -> Result<()> {
            fs::create_dir(&target)?;
            fs::rename(stage.join("source.txt"), target.join("source.txt"))?;
            fs::rename(stage.join("content.txt"), target.join("content.txt"))?;
            let mut meta = index.clone();
            meta.chapters.clear();
            let json = serde_json::to_string(&meta)?;
            let db = self
                .db
                .as_mut()
                .ok_or_else(|| AppError::new("ROOT_UNAVAILABLE", "书库未打开"))?;
            let tx = db.transaction()?;
            tx.execute("INSERT INTO books(id,title,source_hash,encoding,source_path,content_path,total_utf16,total_bytes,imported_at,index_meta,state) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'ready')",params![id,title,session.source_hash,index.encoding,format!("books/{id}/source.txt"),format!("books/{id}/content.txt"),index.total_utf16 as i64,index.total_bytes as i64,imported,json])?;
            for c in &index.chapters {
                tx.execute(
                    "INSERT INTO chapters VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
                    params![
                        id,
                        c.id,
                        c.order,
                        c.title,
                        c.volume_id,
                        c.heading_start as i64,
                        c.body_start as i64,
                        c.body_end as i64,
                        c.byte_start as i64,
                        c.byte_end as i64
                    ],
                )?;
            }
            tx.commit()?;
            Ok(())
        })();
        if let Err(error) = committed {
            for file in ["source.txt", "content.txt"] {
                let from = target.join(file);
                let to = stage.join(file);
                if from.exists() && !to.exists() {
                    fs::rename(from, to)?
                }
            }
            if target.exists() {
                fs::remove_dir(&target)?
            }
            return Err(error);
        }
        self.sessions.remove(id);
        // A cleanup error must not turn a committed book into a failed import.
        let _ = fs::remove_dir_all(&stage);
        Ok(Book {
            id: id.into(),
            title: title.into(),
            author: None,
            imported_at: imported,
            last_read_at: None,
            total_utf16: index.total_utf16,
            position: 0,
            chapter_count: index.chapters.len() as u32,
        })
    }
    pub fn cancel_import(&mut self, id: &str) -> Result<()> {
        self.sessions.remove(id);
        let root = self.root_path()?;
        let stage = owned_dir(&root, "staging", id)?;
        let exists: bool = self.connection()?.query_row(
            "SELECT EXISTS(SELECT 1 FROM books WHERE id=?1)",
            [id],
            |r| r.get(0),
        )?;
        if !exists {
            let target = owned_dir(&root, "books", id)?;
            if target.exists() {
                fs::remove_dir_all(target)?
            }
        }
        if stage.exists() {
            fs::remove_dir_all(stage)?
        }
        Ok(())
    }
    pub(crate) fn recover_imports(&mut self) -> Result<()> {
        let root = self.root_path()?;
        for entry in fs::read_dir(root.join("staging"))? {
            let entry = entry?;
            let id = entry.file_name().to_string_lossy().into_owned();
            if uuid::Uuid::parse_str(&id).is_err() {
                continue;
            }
            let stage = owned_dir(&root, "staging", &id)?;
            let manifest = stage.join("manifest.json");
            if !manifest.exists() {
                continue;
            }
            let marker: serde_json::Value = serde_json::from_slice(&fs::read(&manifest)?)?;
            if marker["id"] != id {
                continue;
            }
            let exists: bool = self.connection()?.query_row(
                "SELECT EXISTS(SELECT 1 FROM books WHERE id=?1)",
                [&id],
                |r| r.get(0),
            )?;
            if !exists {
                let target = owned_dir(&root, "books", &id)?;
                if target.exists() {
                    fs::remove_dir_all(target)?
                }
            }
            fs::remove_dir_all(stage)?;
        }
        Ok(())
    }
}

fn validate_index(bytes: &[u8], index: &NovelIndex) -> Result<()> {
    let bad = || AppError::new("INVALID_INDEX", "章节索引与正文不一致");
    let text = std::str::from_utf8(bytes).map_err(|_| bad())?;
    if index.version != 1
        || index.total_bytes != bytes.len() as u64
        || index.total_utf16 != text.encode_utf16().count() as u64
        || index.chapters.is_empty()
        || !matches!(
            index.encoding.as_str(),
            "utf-8" | "gb18030" | "utf-16le" | "utf-16be"
        )
    {
        return Err(bad());
    }
    let mut markers = BTreeMap::new();
    let mut ids = HashSet::new();
    let mut previous = 0;
    for (n, c) in index.chapters.iter().enumerate() {
        if c.order as usize != n
            || !ids.insert(&c.id)
            || c.heading_start < previous
            || c.heading_start > c.body_start
            || c.body_start > c.body_end
            || c.body_end > index.total_utf16
            || c.byte_start > c.byte_end
            || c.byte_end > index.total_bytes
        {
            return Err(bad());
        }
        previous = c.body_end;
        for (u, b) in [(c.body_start, c.byte_start), (c.body_end, c.byte_end)] {
            if markers.insert(u, b).is_some_and(|old| old != b) {
                return Err(bad());
            }
        }
    }
    if index
        .checkpoints
        .first()
        .is_none_or(|p| p.utf16 != 0 || p.byte != 0)
    {
        return Err(bad());
    }
    let (mut last_u, mut last_b) = (0, 0);
    for p in &index.checkpoints {
        if p.utf16 < last_u
            || p.byte < last_b
            || p.utf16 - last_u > 65_537
            || p.utf16 > index.total_utf16
            || p.byte > index.total_bytes
        {
            return Err(bad());
        }
        last_u = p.utf16;
        last_b = p.byte;
        if markers
            .insert(p.utf16, p.byte)
            .is_some_and(|old| old != p.byte)
        {
            return Err(bad());
        }
    }
    if index.total_utf16 - last_u > 65_536 {
        return Err(bad());
    }
    let (mut u, mut b) = (0, 0);
    for c in text.chars() {
        if let Some(expected) = markers.remove(&u) {
            if expected != b {
                return Err(bad());
            }
        }
        u += c.len_utf16() as u64;
        b += c.len_utf8() as u64;
    }
    if let Some(expected) = markers.remove(&u) {
        if expected != b {
            return Err(bad());
        }
    }
    if !markers.is_empty() {
        return Err(bad());
    }
    Ok(())
}
