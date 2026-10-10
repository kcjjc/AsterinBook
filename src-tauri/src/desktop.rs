use crate::{contracts::*, storage::Core};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
};
use tauri::{
    ipc::{InvokeBody, Request, Response},
    Manager, State,
};
use tauri_plugin_dialog::DialogExt;

pub struct AppState(pub Arc<Mutex<Core>>);
impl AppState {
    pub fn new(core: Core) -> Self {
        Self(Arc::new(Mutex::new(core)))
    }
}
async fn run_core<T: Send + 'static>(
    state: &State<'_, AppState>,
    op: impl FnOnce(&mut Core) -> Result<T> + Send + 'static,
) -> Result<T> {
    let core = state.0.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut core = core
            .lock()
            .map_err(|_| AppError::new("IO_ERROR", "本地存储任务异常，请重新启动"))?;
        op(&mut core)
    })
    .await
    .map_err(|e| AppError::new("IO_ERROR", e.to_string()))?
}
async fn pick(app: tauri::AppHandle, folder: bool) -> Result<Option<PathBuf>> {
    tauri::async_runtime::spawn_blocking(move || {
        let dialog = app.dialog().file();
        let selected = if folder {
            dialog.set_title("选择阅读数据目录").blocking_pick_folder()
        } else {
            dialog
                .set_title("导入 TXT 小说")
                .add_filter("TXT 小说", &["txt"])
                .blocking_pick_file()
        };
        selected
            .map(|p| {
                p.into_path()
                    .map_err(|e| AppError::new("IO_ERROR", e.to_string()))
            })
            .transpose()
    })
    .await
    .map_err(|e| AppError::new("IO_ERROR", e.to_string()))?
}
#[tauri::command]
async fn startup(state: State<'_, AppState>) -> Result<serde_json::Value> {
    run_core(&state, |c| c.startup()).await
}
#[tauri::command]
async fn choose_root(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    mode: String,
) -> Result<Option<RootInfo>> {
    if !matches!(mode.as_str(), "initialize" | "open") {
        return Err(AppError::new("INVALID_INDEX", "目录选择方式无效"));
    }
    let Some(path) = pick(app, true).await? else {
        return Ok(None);
    };
    run_core(&state, move |c| {
        c.choose_root(&path, mode == "open").map(Some)
    })
    .await
}
#[tauri::command]
async fn list_books(state: State<'_, AppState>, sort: String) -> Result<Vec<Book>> {
    run_core(&state, move |c| c.list_books(&sort)).await
}
#[tauri::command]
async fn prepare_import(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<serde_json::Value>> {
    let Some(path) = pick(app, false).await? else {
        return Ok(None);
    };
    run_core(&state, move |c| c.prepare_import(&path).map(Some)).await
}
#[tauri::command]
async fn read_import_source(state: State<'_, AppState>, session_id: String) -> Result<Response> {
    run_core(&state, move |c| {
        c.read_import_source(&session_id).map(Response::new)
    })
    .await
}
#[tauri::command]
async fn write_import_chunk(state: State<'_, AppState>, request: Request<'_>) -> Result<()> {
    let bad = || AppError::new("INVALID_INDEX", "正文上传请求无效");
    let session = request
        .headers()
        .get("x-import-session")
        .and_then(|s| s.to_str().ok())
        .ok_or_else(bad)?
        .to_owned();
    let sequence = request
        .headers()
        .get("x-import-sequence")
        .and_then(|s| s.to_str().ok())
        .and_then(|s| s.parse::<u32>().ok())
        .ok_or_else(bad)?;
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(bad());
    };
    if bytes.len() > 1_048_576 {
        return Err(bad());
    }
    let bytes = bytes.clone();
    run_core(&state, move |c| {
        c.write_import_chunk(&session, sequence, &bytes)
    })
    .await
}
#[tauri::command]
async fn commit_import(
    state: State<'_, AppState>,
    session_id: String,
    title: String,
    index: NovelIndex,
) -> Result<Book> {
    run_core(&state, move |c| c.commit_import(&session_id, &title, index)).await
}
#[tauri::command]
async fn cancel_import(state: State<'_, AppState>, session_id: String) -> Result<()> {
    run_core(&state, move |c| c.cancel_import(&session_id)).await
}
#[tauri::command]
async fn rename_book(state: State<'_, AppState>, book_id: String, title: String) -> Result<()> {
    run_core(&state, move |c| c.rename_book(&book_id, &title)).await
}
#[tauri::command]
async fn remove_book(state: State<'_, AppState>, book_id: String) -> Result<()> {
    run_core(&state, move |c| c.remove_book(&book_id)).await
}
#[tauri::command]
async fn get_index(state: State<'_, AppState>, book_id: String) -> Result<NovelIndex> {
    run_core(&state, move |c| c.get_index(&book_id)).await
}
#[tauri::command]
async fn read_text(
    state: State<'_, AppState>,
    book_id: String,
    chapter_id: String,
    start: u64,
    max_utf16: u64,
) -> Result<TextChunk> {
    run_core(&state, move |c| {
        c.read_text(&book_id, &chapter_id, start, max_utf16)
    })
    .await
}
#[tauri::command]
async fn save_position(state: State<'_, AppState>, book_id: String, offset: u64) -> Result<()> {
    run_core(&state, move |c| c.save_position(&book_id, offset)).await
}
#[tauri::command]
async fn flush_writes(state: State<'_, AppState>) -> Result<()> {
    run_core(&state, |c| c.flush_writes()).await
}
#[tauri::command]
async fn list_bookmarks(state: State<'_, AppState>, book_id: String) -> Result<Vec<Bookmark>> {
    run_core(&state, move |c| c.list_bookmarks(&book_id)).await
}
#[tauri::command]
async fn add_bookmark(
    state: State<'_, AppState>,
    book_id: String,
    offset: u64,
    excerpt: String,
) -> Result<Bookmark> {
    run_core(&state, move |c| c.add_bookmark(&book_id, offset, &excerpt)).await
}
#[tauri::command]
async fn remove_bookmark(state: State<'_, AppState>, bookmark_id: String) -> Result<()> {
    run_core(&state, move |c| c.remove_bookmark(&bookmark_id)).await
}
#[tauri::command]
async fn get_prefs(state: State<'_, AppState>) -> Result<ReadingPrefs> {
    run_core(&state, |c| c.get_prefs()).await
}
#[tauri::command]
async fn set_prefs(state: State<'_, AppState>, prefs: ReadingPrefs) -> Result<()> {
    run_core(&state, move |c| c.set_prefs(prefs)).await
}
#[tauri::command]
async fn list_fonts() -> Result<Vec<String>> {
    tauri::async_runtime::spawn_blocking(crate::services::fonts::list_fonts)
        .await
        .map_err(|e| AppError::new("IO_ERROR", e.to_string()))?
}
#[tauri::command]
async fn prepare_migration(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<MigrationPlan>> {
    let Some(path) = pick(app, true).await? else {
        return Ok(None);
    };
    run_core(&state, move |c| c.prepare_migration(&path).map(Some)).await
}
#[tauri::command]
async fn commit_migration(state: State<'_, AppState>, token: String) -> Result<RootInfo> {
    run_core(&state, move |c| c.commit_migration(&token)).await
}

pub fn builder() -> tauri::Builder<tauri::Wry> {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _, _| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if app.try_state::<AppState>().is_none() {
                let install = std::env::current_exe()?
                    .parent()
                    .ok_or("无法定位程序目录")?
                    .to_path_buf();
                let bootstrap = app.path().app_config_dir()?.join("bootstrap.json");
                app.manage(AppState::new(Core::new(bootstrap, install)));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            startup,
            choose_root,
            list_books,
            prepare_import,
            read_import_source,
            write_import_chunk,
            commit_import,
            cancel_import,
            rename_book,
            remove_book,
            get_index,
            read_text,
            save_position,
            flush_writes,
            list_bookmarks,
            add_bookmark,
            remove_bookmark,
            get_prefs,
            set_prefs,
            list_fonts,
            prepare_migration,
            commit_migration
        ])
}
