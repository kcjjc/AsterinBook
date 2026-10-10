use asterinbook_lib::{contracts::NovelIndex, storage::Core};
use std::path::PathBuf;
fn setup() -> (tempfile::TempDir, Core, PathBuf) {
    let tmp = tempfile::tempdir().unwrap();
    let root = tmp.path().join("书库");
    let install = tmp.path().join("程序");
    std::fs::create_dir(&root).unwrap();
    std::fs::create_dir(&install).unwrap();
    let mut core = Core::new(tmp.path().join("config/bootstrap.json"), install);
    core.select_root(&root).unwrap();
    (tmp, core, root)
}
fn index() -> NovelIndex {
    serde_json::from_value(serde_json::json!({"version":1,"encoding":"utf-8","totalUtf16":18,"totalBytes":42,"chapters":[{"id":"c0","order":0,"title":"第一章 雨","volumeId":null,"headingStart":0,"bodyStart":6,"bodyEnd":9,"byteStart":14,"byteEnd":21},{"id":"c1","order":1,"title":"第二章 山","volumeId":null,"headingStart":9,"bodyStart":15,"bodyEnd":18,"byteStart":35,"byteEnd":42}],"volumes":[],"checkpoints":[{"utf16":0,"byte":0}]})).unwrap()
}
#[test]
fn rejects_sparse_checkpoints_that_would_require_scanning_entire_book() {
    let (tmp, mut core, _) = setup();
    let text = "中".repeat(70_000);
    let path = tmp.path().join("long.txt");
    std::fs::write(&path, &text).unwrap();
    let p = core.prepare_import(&path).unwrap();
    let id = p["value"]["sessionId"].as_str().unwrap();
    core.write_import_chunk(id, 0, text.as_bytes()).unwrap();
    let i:NovelIndex=serde_json::from_value(serde_json::json!({"version":1,"encoding":"utf-8","totalUtf16":70000,"totalBytes":text.len(),"chapters":[{"id":"c0","order":0,"title":"正文","volumeId":null,"headingStart":0,"bodyStart":0,"bodyEnd":70000,"byteStart":0,"byteEnd":text.len()}],"volumes":[],"checkpoints":[{"utf16":0,"byte":0}]})).unwrap();
    assert_eq!(
        core.commit_import(id, "长篇", i).unwrap_err().code,
        "INVALID_INDEX"
    );
}
#[test]
fn rejects_oversize_before_staging() {
    let (tmp, mut core, root) = setup();
    let path = tmp.path().join("big.txt");
    let f = std::fs::File::create(&path).unwrap();
    f.set_len(52_428_801).unwrap();
    assert_eq!(
        core.prepare_import(&path).unwrap_err().code,
        "FILE_TOO_LARGE"
    );
    assert_eq!(std::fs::read_dir(root.join("staging")).unwrap().count(), 0)
}
#[test]
fn real_copy_and_duplicate_detection() {
    let (tmp, mut core, root) = setup();
    let path = tmp.path().join("小说.txt");
    let text = "第一章 雨\n山风\n第二章 山\n回家\n";
    std::fs::write(&path, text).unwrap();
    let prepared = core.prepare_import(&path).unwrap();
    let session = prepared["value"]["sessionId"].as_str().unwrap();
    core.write_import_chunk(session, 0, text.as_bytes())
        .unwrap();
    let book = core.commit_import(session, "小说", index()).unwrap();
    assert_eq!(book.chapter_count, 2);
    assert_eq!(
        std::fs::read_to_string(root.join("books").join(&book.id).join("source.txt")).unwrap(),
        text
    );
    assert_eq!(core.prepare_import(&path).unwrap()["kind"], "duplicate");
    std::fs::remove_file(&path).unwrap();
    assert!(root
        .join("books")
        .join(book.id)
        .join("content.txt")
        .exists())
}
#[test]
fn rejects_out_of_order_chunk_and_invalid_index() {
    let (tmp, mut core, root) = setup();
    let path = tmp.path().join("novel.txt");
    std::fs::write(&path, "第一章 雨\n山风\n第二章 山\n回家\n").unwrap();
    let prepared = core.prepare_import(&path).unwrap();
    let session = prepared["value"]["sessionId"].as_str().unwrap();
    assert_eq!(
        core.write_import_chunk(session, 1, b"x").unwrap_err().code,
        "INVALID_INDEX"
    );
    core.write_import_chunk(session, 0, "第一章 雨\n山风\n第二章 山\n回家\n".as_bytes())
        .unwrap();
    let mut invalid = index();
    invalid.chapters[0].byte_end = 999;
    assert_eq!(
        core.commit_import(session, "小说", invalid)
            .unwrap_err()
            .code,
        "INVALID_INDEX"
    );
    core.cancel_import(session).unwrap();
    assert_eq!(std::fs::read_dir(root.join("books")).unwrap().count(), 0)
}
#[test]
fn restart_cleans_only_uncommitted_import() {
    let (tmp, mut core, root) = setup();
    let path = tmp.path().join("novel.txt");
    std::fs::write(&path, "原始文本").unwrap();
    core.prepare_import(&path).unwrap();
    assert_eq!(std::fs::read_dir(root.join("staging")).unwrap().count(), 1);
    let pointer = core.bootstrap.clone();
    let install = core.install.clone();
    drop(core);
    let mut reopened = Core::new(pointer, install);
    assert_eq!(reopened.startup().unwrap()["status"], "ready");
    assert_eq!(std::fs::read_dir(root.join("staging")).unwrap().count(), 0)
}
#[test]
fn database_commit_failure_can_retry_without_losing_source() {
    let (tmp, mut core, root) = setup();
    let path = tmp.path().join("小说.txt");
    let text = "第一章 雨\n山风\n第二章 山\n回家\n";
    std::fs::write(&path, text).unwrap();
    let p = core.prepare_import(&path).unwrap();
    let session = p["value"]["sessionId"].as_str().unwrap();
    core.write_import_chunk(session, 0, text.as_bytes())
        .unwrap();
    let db = rusqlite::Connection::open(root.join("reader.db")).unwrap();
    db.execute_batch("CREATE TRIGGER test_fail BEFORE INSERT ON books BEGIN SELECT RAISE(FAIL,'test failure'); END;").unwrap();
    assert!(core.commit_import(session, "小说", index()).is_err());
    assert!(root
        .join("staging")
        .join(session)
        .join("source.txt")
        .exists());
    db.execute_batch("DROP TRIGGER test_fail;").unwrap();
    assert!(core.commit_import(session, "小说", index()).is_ok());
}
