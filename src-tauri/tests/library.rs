use asterinbook_lib::{
    contracts::{NovelIndex, ReadingPrefs},
    storage::Core,
};
fn setup() -> (tempfile::TempDir, Core) {
    let temp = tempfile::tempdir().unwrap();
    let install = temp.path().join("程序");
    let root = temp.path().join("书库");
    std::fs::create_dir(&install).unwrap();
    std::fs::create_dir(&root).unwrap();
    let mut c = Core::new(temp.path().join("config/bootstrap.json"), install);
    c.select_root(&root).unwrap();
    (temp, c)
}
fn import(c: &mut Core, path: &std::path::Path, title: &str, text: &str) -> String {
    std::fs::write(path, text).unwrap();
    let p = c.prepare_import(path).unwrap();
    let id = p["value"]["sessionId"].as_str().unwrap();
    c.write_import_chunk(id, 0, text.as_bytes()).unwrap();
    let i:NovelIndex=serde_json::from_value(serde_json::json!({"version":1,"encoding":"utf-8","totalUtf16":text.encode_utf16().count(),"totalBytes":text.len(),"chapters":[{"id":"c0","order":0,"title":"正文","volumeId":null,"headingStart":0,"bodyStart":0,"bodyEnd":text.encode_utf16().count(),"byteStart":0,"byteEnd":text.len()}],"volumes":[],"checkpoints":[{"utf16":0,"byte":0}]})).unwrap();
    c.commit_import(id, title, i).unwrap().id
}
#[test]
fn independent_positions_bookmarks_and_removal() {
    let (t, mut c) = setup();
    let a = import(&mut c, &t.path().join("a.txt"), "甲", "山风吹过\n");
    let b = import(&mut c, &t.path().join("b.txt"), "乙", "归途灯火\n");
    c.save_position(&a, 2).unwrap();
    let m = c.add_bookmark(&a, 2, "吹过").unwrap();
    assert_eq!(c.add_bookmark(&a, 2, "吹过").unwrap().id, m.id);
    assert_eq!(c.list_bookmarks(&b).unwrap().len(), 0);
    assert_eq!(
        c.list_books("recent")
            .unwrap()
            .iter()
            .find(|v| v.id == b)
            .unwrap()
            .position,
        0
    );
    assert!(c.save_position(&a, 999).is_err());
    assert!(c.add_bookmark(&a, 999, "错").is_err());
    c.rename_book(&a, "甲的新名").unwrap();
    c.remove_book(&a).unwrap();
    assert_eq!(c.list_books("title").unwrap()[0].id, b);
    assert!(c.list_bookmarks(&a).unwrap().is_empty());
}
#[test]
fn utf16_read_boundaries_and_prefs_reopen() {
    let (t, mut c) = setup();
    let id = import(&mut c, &t.path().join("emoji.txt"), "表情", "正文😀é\n");
    let text = c.read_text(&id, "c0", 2, 2).unwrap();
    assert_eq!(text.text, "😀");
    assert_eq!(text.next, 4);
    assert!(c.read_text(&id, "c0", 3, 2).is_err());
    let mut prefs = ReadingPrefs::default();
    prefs.font_size = 28.;
    c.set_prefs(prefs.clone()).unwrap();
    prefs.font_size = 999.;
    assert!(c.set_prefs(prefs).is_err());
    let pointer = c.bootstrap.clone();
    let install = c.install.clone();
    drop(c);
    let mut reopened = Core::new(pointer, install);
    reopened.startup().unwrap();
    assert_eq!(reopened.get_prefs().unwrap().font_size, 28.);
    assert_eq!(reopened.get_index(&id).unwrap().total_utf16, 7)
}
