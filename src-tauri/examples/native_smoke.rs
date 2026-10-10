//! Isolated verification harness; never shipped in the installer.
use asterinbook_lib::{
    contracts::NovelIndex,
    desktop::{self, AppState},
    storage::Core,
};
use std::{fs, path::PathBuf};
use tauri::{Listener, Manager};
fn seed(c: &mut Core, path: &std::path::Path, title: &str, text: &str) {
    fs::write(path, text).unwrap();
    let p = c.prepare_import(path).unwrap();
    let id = p["value"]["sessionId"].as_str().unwrap();
    c.write_import_chunk(id, 0, text.as_bytes()).unwrap();
    let index:NovelIndex=serde_json::from_value(serde_json::json!({"version":1,"encoding":"utf-8","totalUtf16":text.encode_utf16().count(),"totalBytes":text.len(),"chapters":[{"id":"c0","order":0,"title":"正文","volumeId":null,"headingStart":0,"bodyStart":0,"bodyEnd":text.encode_utf16().count(),"byteStart":0,"byteEnd":text.len()}],"volumes":[],"checkpoints":[{"utf16":0,"byte":0}]})).unwrap();
    c.commit_import(id, title, index).unwrap();
}
fn main() {
    let base = PathBuf::from(
        std::env::args()
            .nth(1)
            .expect("verification directory required"),
    );
    fs::create_dir_all(&base).unwrap();
    let base = base.canonicalize().unwrap();
    let root = base.join("图书 数据");
    fs::create_dir_all(&root).unwrap();
    let install = std::env::current_exe()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf();
    let mut core = Core::new(base.join("config/bootstrap.json"), install);
    if core.startup().unwrap()["status"] == "needsRoot" {
        core.select_root(&root).unwrap();
    }
    if core.list_books("recent").unwrap().is_empty() {
        seed(
            &mut core,
            &base.join("甲.txt"),
            "本地小说甲",
            &"山风轻拂过纸页，灯火照亮长街。\n".repeat(100),
        );
        seed(
            &mut core,
            &base.join("乙.txt"),
            "本地小说乙",
            &"归途依然有故事，中文阅读从这里开始。\n".repeat(45),
        );
    }
    let fixture = base.join("待导入.txt");
    fs::write(
        &fixture,
        format!(
            "第一章 山风\r\n{}第二章 归途\r\n回来😀é\r\n",
            "山风拂过长街，纸页记录故事。\r\n".repeat(80)
        ),
    )
    .unwrap();
    let report = base.join("prepared.json");
    let hold_report = base.join("hold.json");
    let migrate_report = base.join("migration.json");
    let target = base.join("迁移后 数据");
    fs::create_dir_all(&target).unwrap();
    desktop::builder()
        .manage(AppState::new(core))
        .setup(move |app| {
            let handle = app.handle().clone();
            app.listen("smoke-prepare", move |_| {
                let state = handle.state::<AppState>();
                let p = state.0.lock().unwrap().prepare_import(&fixture).unwrap();
                fs::write(&report, serde_json::to_vec(&p).unwrap()).unwrap();
            });
            let handle = app.handle().clone();
            app.listen("smoke-migrate", move |_| {
                let state = handle.state::<AppState>();
                let p = state.0.lock().unwrap().prepare_migration(&target).unwrap();
                fs::write(&migrate_report, serde_json::to_vec(&p).unwrap()).unwrap();
            });
            let handle = app.handle().clone();
            app.listen("smoke-hold", move |_| {
                let handle = handle.clone();
                let report = hold_report.clone();
                std::thread::spawn(move || {
                    let state = handle.state::<AppState>();
                    let _core = state.0.lock().unwrap();
                    fs::write(report, b"holding").unwrap();
                    std::thread::sleep(std::time::Duration::from_millis(1800));
                });
            });
            let handle = app.handle().clone();
            app.listen("smoke-close", move |_| {
                handle.get_webview_window("main").unwrap().close().unwrap();
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("native smoke app");
}
