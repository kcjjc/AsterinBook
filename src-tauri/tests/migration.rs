use asterinbook_lib::{contracts::ReadingPrefs, storage::Core};
#[test]
fn migrate_retains_original_and_reopens_target() {
    let t = tempfile::tempdir().unwrap();
    let root = t.path().join("旧书库");
    let target = t.path().join("新书库 空格");
    let install = t.path().join("程序");
    for p in [&root, &target, &install] {
        std::fs::create_dir(p).unwrap()
    }
    let pointer = t.path().join("config/bootstrap.json");
    let mut c = Core::new(pointer.clone(), install.clone());
    let old = c.select_root(&root).unwrap();
    let mut prefs = ReadingPrefs::default();
    prefs.font_size = 26.;
    c.set_prefs(prefs).unwrap();
    let p = c.prepare_migration(&target).unwrap();
    assert_eq!(p.mode, "copy");
    let new = c.commit_migration(&p.token).unwrap();
    assert_eq!(new.library_id, old.library_id);
    assert!(root.join("reader.db").exists());
    assert!(target.join("reader.db").exists());
    assert_eq!(c.get_prefs().unwrap().font_size, 26.);
    drop(c);
    let mut reopened = Core::new(pointer, install);
    assert_eq!(reopened.startup().unwrap()["status"], "ready");
    assert_eq!(reopened.get_prefs().unwrap().font_size, 26.)
}
#[test]
fn rejects_nested_and_nonlibrary_nonempty_target() {
    let t = tempfile::tempdir().unwrap();
    let root = t.path().join("root");
    let install = t.path().join("app");
    let target = t.path().join("target");
    for p in [&root, &install, &target] {
        std::fs::create_dir(p).unwrap()
    }
    let mut c = Core::new(t.path().join("bootstrap.json"), install);
    c.select_root(&root).unwrap();
    let nested = root.join("nested");
    std::fs::create_dir(&nested).unwrap();
    assert_eq!(
        c.prepare_migration(&nested).unwrap_err().code,
        "PATH_CONFLICT"
    );
    std::fs::write(target.join("用户.txt"), "保留").unwrap();
    assert_eq!(
        c.prepare_migration(&target).unwrap_err().code,
        "ROOT_NOT_EMPTY"
    );
    assert_eq!(
        std::fs::read_to_string(target.join("用户.txt")).unwrap(),
        "保留"
    )
}

use asterinbook_lib::{
    contracts::{AppError, NovelIndex, Result},
    services::fs_ops::{FsOps, RealFsOps},
};
use std::{path::Path, sync::Arc};
struct FailingFs(&'static str);
impl FsOps for FailingFs {
    fn copy_tree(&self, s: &Path, t: &Path) -> Result<()> {
        RealFsOps.copy_tree(s, t)?;
        if self.0 == "copy" {
            return Err(AppError::new("IO_ERROR", "copy interrupted"));
        }
        Ok(())
    }
    fn commit_dir(&self, s: &Path, t: &Path) -> Result<()> {
        if self.0 == "rename" {
            return Err(AppError::new("IO_ERROR", "rename interrupted"));
        }
        RealFsOps.commit_dir(s, t)
    }
    fn write_pointer(&self, p: &Path, b: &[u8]) -> Result<()> {
        RealFsOps.write_pointer(p, b)?;
        if self.0 == "pointer" {
            return Err(AppError::new("IO_ERROR", "pointer interrupted"));
        }
        Ok(())
    }
}
fn add(c: &mut Core, source: &Path, text: &str) -> String {
    std::fs::write(source, text).unwrap();
    let prepared = c.prepare_import(source).unwrap();
    let id = prepared["value"]["sessionId"].as_str().unwrap();
    c.write_import_chunk(id, 0, text.as_bytes()).unwrap();
    let index:NovelIndex=serde_json::from_value(serde_json::json!({"version":1,"encoding":"utf-8","totalUtf16":text.encode_utf16().count(),"totalBytes":text.len(),"chapters":[{"id":"c0","order":0,"title":"正文","volumeId":null,"headingStart":0,"bodyStart":0,"bodyEnd":text.encode_utf16().count(),"byteStart":0,"byteEnd":text.len()}],"volumes":[],"checkpoints":[{"utf16":0,"byte":0}]})).unwrap();
    c.commit_import(id, "测试小说", index).unwrap().id
}
#[test]
fn failures_restore_two_books_positions_and_bookmarks_on_disk() {
    for phase in ["copy", "rename", "pointer"] {
        let t = tempfile::tempdir().unwrap();
        let root = t.path().join("原书库");
        let target = t.path().join("新书库");
        let install = t.path().join("程序");
        for p in [&root, &target, &install] {
            std::fs::create_dir(p).unwrap()
        }
        let pointer = t.path().join("config/bootstrap.json");
        let mut c = Core::with_fs_ops(pointer.clone(), install.clone(), Arc::new(FailingFs(phase)));
        c.select_root(&root).unwrap();
        let a = add(&mut c, &t.path().join("a.txt"), "山风过林\n");
        let b = add(&mut c, &t.path().join("b.txt"), "归途灯火\n");
        c.save_position(&a, 2).unwrap();
        c.save_position(&b, 3).unwrap();
        let mark = c.add_bookmark(&a, 2, "过林").unwrap();
        let plan = c.prepare_migration(&target).unwrap();
        assert!(c.commit_migration(&plan.token).is_err(), "{phase}");
        drop(c);
        let mut reopened = Core::new(pointer, install);
        assert_eq!(reopened.startup().unwrap()["status"], "ready");
        let books = reopened.list_books("recent").unwrap();
        assert_eq!(books.len(), 2);
        assert_eq!(books.iter().find(|v| v.id == a).unwrap().position, 2);
        assert_eq!(reopened.list_bookmarks(&a).unwrap()[0].id, mark.id);
        assert_eq!(
            reopened.read_text(&b, "c0", 0, 20).unwrap().text,
            "归途灯火\n"
        );
        assert!(root.join("books").join(a).join("source.txt").exists());
    }
}
#[test]
fn startup_falls_back_when_switched_target_is_damaged() {
    let t = tempfile::tempdir().unwrap();
    let root = t.path().join("old");
    let target = t.path().join("new");
    let install = t.path().join("app");
    for p in [&root, &target, &install] {
        std::fs::create_dir(p).unwrap()
    }
    let pointer = t.path().join("config/bootstrap.json");
    let mut c = Core::new(pointer.clone(), install.clone());
    let info = c.select_root(&root).unwrap();
    let id = add(&mut c, &t.path().join("a.txt"), "旧书库仍然可读\n");
    let plan = c.prepare_migration(&target).unwrap();
    c.commit_migration(&plan.token).unwrap();
    drop(c);
    std::fs::write(target.join("reader.db"), b"damaged").unwrap();
    std::fs::write(pointer.with_extension("migration.json"),serde_json::to_vec(&serde_json::json!({"token":plan.token,"source":plan.source,"target":plan.target,"libraryId":info.library_id,"phase":"pointerSwitched"})).unwrap()).unwrap();
    let mut reopened = Core::new(pointer, install);
    assert_eq!(reopened.startup().unwrap()["status"], "ready");
    assert_eq!(
        reopened.read_text(&id, "c0", 0, 30).unwrap().text,
        "旧书库仍然可读\n"
    );
}
#[test]
fn existing_library_switch_does_not_merge_or_copy() {
    let t = tempfile::tempdir().unwrap();
    let a = t.path().join("a");
    let b = t.path().join("b");
    let app = t.path().join("app");
    for p in [&a, &b, &app] {
        std::fs::create_dir(p).unwrap()
    }
    let mut other = Core::new(t.path().join("other.json"), app.clone());
    let other_info = other.select_root(&b).unwrap();
    let id = add(&mut other, &t.path().join("b.txt"), "不同书库\n");
    drop(other);
    let mut c = Core::new(t.path().join("bootstrap.json"), app);
    c.select_root(&a).unwrap();
    add(&mut c, &t.path().join("a.txt"), "原来的书\n");
    let plan = c.prepare_migration(&b).unwrap();
    assert_eq!(plan.mode, "open");
    assert_eq!(
        c.commit_migration(&plan.token).unwrap().library_id,
        other_info.library_id
    );
    assert_eq!(c.list_books("title").unwrap()[0].id, id);
    assert!(a.join("reader.db").exists());
}
