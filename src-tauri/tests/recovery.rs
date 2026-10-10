use asterinbook_lib::storage::Core;
use asterinbook_lib::{
    contracts::{AppError, Result},
    services::fs_ops::{FsOps, RealFsOps},
};
use std::{
    io::Write,
    path::Path,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
};
struct PartialAppend(AtomicBool);
impl FsOps for PartialAppend {
    fn copy_tree(&self, s: &Path, t: &Path) -> Result<()> {
        RealFsOps.copy_tree(s, t)
    }
    fn commit_dir(&self, s: &Path, t: &Path) -> Result<()> {
        RealFsOps.commit_dir(s, t)
    }
    fn write_pointer(&self, p: &Path, b: &[u8]) -> Result<()> {
        RealFsOps.write_pointer(p, b)
    }
    fn append_chunk(&self, p: &Path, b: &[u8]) -> Result<()> {
        if !self.0.swap(true, Ordering::SeqCst) {
            let mut f = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(p)?;
            f.write_all(&b[..b.len() / 2])?;
            return Err(AppError::new("IO_ERROR", "模拟部分写入失败"));
        }
        RealFsOps.append_chunk(p, b)
    }
}
#[test]
fn partial_chunk_failure_rolls_back_and_replay_is_idempotent() {
    let t = tempfile::tempdir().unwrap();
    let root = t.path().join("root");
    let app = t.path().join("app");
    std::fs::create_dir(&root).unwrap();
    std::fs::create_dir(&app).unwrap();
    let mut c = Core::with_fs_ops(
        t.path().join("bootstrap.json"),
        app,
        Arc::new(PartialAppend(AtomicBool::new(false))),
    );
    c.select_root(&root).unwrap();
    let src = t.path().join("book.txt");
    let text = "正文内容完整\n";
    std::fs::write(&src, text).unwrap();
    let p = c.prepare_import(&src).unwrap();
    let id = p["value"]["sessionId"].as_str().unwrap();
    assert!(c.write_import_chunk(id, 0, text.as_bytes()).is_err());
    let content = root.join("staging").join(id).join("content.txt");
    assert_eq!(std::fs::metadata(&content).unwrap().len(), 0);
    c.write_import_chunk(id, 0, text.as_bytes()).unwrap();
    c.write_import_chunk(id, 0, text.as_bytes()).unwrap();
    assert_eq!(std::fs::read_to_string(content).unwrap(), text);
    assert!(c.write_import_chunk(id, 0, b"different").is_err());
}
#[test]
fn migration_open_rejects_disappeared_or_replaced_library() {
    for replaced in [false, true] {
        let t = tempfile::tempdir().unwrap();
        let app = t.path().join("app");
        let source = t.path().join("source");
        let target = t.path().join("target");
        for p in [&app, &source, &target] {
            std::fs::create_dir(p).unwrap();
        }
        let pointer = t.path().join("bootstrap.json");
        let mut c = Core::new(pointer.clone(), app.clone());
        let original = c.select_root(&source).unwrap();
        let mut other = Core::new(t.path().join("other.json"), app.clone());
        other.select_root(&target).unwrap();
        drop(other);
        let plan = c.prepare_migration(&target).unwrap();
        assert_eq!(plan.mode, "open");
        std::fs::remove_dir_all(&target).unwrap();
        std::fs::create_dir(&target).unwrap();
        if replaced {
            let mut different = Core::new(t.path().join("different.json"), app.clone());
            different.select_root(&target).unwrap();
        }
        assert!(
            c.commit_migration(&plan.token).is_err(),
            "replaced={replaced}"
        );
        let p: serde_json::Value =
            serde_json::from_slice(&std::fs::read(pointer).unwrap()).unwrap();
        assert_eq!(p["libraryId"], original.library_id);
        if !replaced {
            assert_eq!(std::fs::read_dir(&target).unwrap().count(), 0);
        }
    }
}
#[test]
fn missing_migration_roots_offer_retry_without_erasing_marker() {
    let t = tempfile::tempdir().unwrap();
    let app = t.path().join("app");
    let root = t.path().join("root");
    let target = t.path().join("target");
    for p in [&app, &root, &target] {
        std::fs::create_dir(p).unwrap();
    }
    let pointer = t.path().join("bootstrap.json");
    let mut c = Core::new(pointer.clone(), app.clone());
    let info = c.select_root(&root).unwrap();
    drop(c);
    std::fs::write(
        &pointer,
        serde_json::to_vec(&serde_json::json!({"rootPath": target, "libraryId":info.library_id}))
            .unwrap(),
    )
    .unwrap();
    let marker = pointer.with_extension("migration.json");
    std::fs::write(&marker, serde_json::to_vec(&serde_json::json!({"source":root,"target":target,"libraryId":info.library_id,"phase":"pointerSwitched"})).unwrap()).unwrap();
    let moved = t.path().join("moved");
    std::fs::rename(&root, &moved).unwrap();
    let mut retry = Core::new(pointer, app);
    assert_eq!(retry.startup().unwrap()["status"], "unavailable");
    assert!(marker.exists());
    std::fs::rename(moved, &root).unwrap();
    assert_eq!(retry.startup().unwrap()["status"], "ready");
    assert!(!marker.exists());
}
