use asterinbook_lib::services::data_root::open_root;
#[test]
fn refuses_nonempty_nonlibrary() {
    let root = tempfile::tempdir().unwrap();
    let install = tempfile::tempdir().unwrap();
    std::fs::write(root.path().join("用户文件.txt"), "保留").unwrap();
    assert_eq!(
        open_root(root.path(), install.path()).unwrap_err().code,
        "ROOT_NOT_EMPTY"
    );
    assert_eq!(
        std::fs::read_to_string(root.path().join("用户文件.txt")).unwrap(),
        "保留"
    );
}
#[test]
fn chinese_path_reopens_same_library() {
    let root = tempfile::tempdir().unwrap();
    let install = tempfile::tempdir().unwrap();
    let p = root.path().join("图书 数据");
    std::fs::create_dir(&p).unwrap();
    let first = open_root(&p, install.path()).unwrap();
    assert_eq!(
        open_root(&p, install.path()).unwrap().library_id,
        first.library_id
    );
    assert!(p.join("reader.db").exists());
}
#[test]
fn rejects_install_subdirectory() {
    let install = tempfile::tempdir().unwrap();
    let path = install.path().join("data");
    std::fs::create_dir(&path).unwrap();
    assert_eq!(
        open_root(&path, install.path()).unwrap_err().code,
        "PATH_CONFLICT"
    );
}
