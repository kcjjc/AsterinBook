use asterinbook_lib::storage::Core;
#[test]
fn pointer_reopens_same_library_and_missing_path_does_not_reset() {
    let temp = tempfile::tempdir().unwrap();
    let install = temp.path().join("程序");
    let root = temp.path().join("小说 数据");
    std::fs::create_dir(&install).unwrap();
    std::fs::create_dir(&root).unwrap();
    let pointer = temp.path().join("config/bootstrap.json");
    let mut core = Core::new(pointer.clone(), install.clone());
    assert_eq!(core.startup().unwrap()["status"], "needsRoot");
    let first = core.select_root(&root).unwrap();
    let mut reopened = Core::new(pointer.clone(), install.clone());
    let status = reopened.startup().unwrap();
    assert_eq!(status["root"]["libraryId"], first.library_id);
    drop(core);
    drop(reopened);
    let moved = temp.path().join("暂时移走");
    std::fs::rename(&root, &moved).unwrap();
    let mut missing = Core::new(pointer.clone(), install);
    assert_eq!(missing.startup().unwrap()["status"], "unavailable");
    assert!(!root.exists());
    assert!(pointer.exists());
}
