use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
pub struct AppError {
    pub code: String,
    pub message: String,
}
impl AppError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}
impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        Self::new(
            if e.raw_os_error() == Some(112) {
                "NO_SPACE"
            } else {
                "IO_ERROR"
            },
            e.to_string(),
        )
    }
}
impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        Self::new("DB_ERROR", e.to_string())
    }
}
impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        Self::new("INVALID_INDEX", e.to_string())
    }
}
pub type Result<T> = std::result::Result<T, AppError>;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RootInfo {
    pub path: String,
    pub library_id: String,
    pub schema_version: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub id: String,
    pub order: u32,
    pub title: String,
    pub volume_id: Option<String>,
    pub heading_start: u64,
    pub body_start: u64,
    pub body_end: u64,
    pub byte_start: u64,
    pub byte_end: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TocVolume {
    pub id: String,
    pub title: String,
    pub before_chapter: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Checkpoint {
    pub utf16: u64,
    pub byte: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NovelIndex {
    pub version: u32,
    pub encoding: String,
    pub total_utf16: u64,
    pub total_bytes: u64,
    pub chapters: Vec<Chapter>,
    pub volumes: Vec<TocVolume>,
    pub checkpoints: Vec<Checkpoint>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Book {
    pub id: String,
    pub title: String,
    pub author: Option<String>,
    pub imported_at: String,
    pub last_read_at: Option<String>,
    pub total_utf16: u64,
    pub position: u64,
    pub chapter_count: u32,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Bookmark {
    pub id: String,
    pub book_id: String,
    pub offset: u64,
    pub excerpt: String,
    pub created_at: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadingPrefs {
    pub font_size: f64,
    pub font_family: String,
    pub line_height: f64,
    pub margin: f64,
    pub theme: String,
    pub sort: String,
}
impl Default for ReadingPrefs {
    fn default() -> Self {
        Self {
            font_size: 20.,
            font_family: "SimSun".into(),
            line_height: 1.95,
            margin: 64.,
            theme: "warm".into(),
            sort: "recent".into(),
        }
    }
}
#[derive(Debug, Clone, Serialize)]
pub struct TextChunk {
    pub start: u64,
    pub text: String,
    pub next: u64,
    pub done: bool,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MigrationPlan {
    pub token: String,
    pub mode: String,
    pub source: String,
    pub target: String,
    pub bytes: u64,
    #[serde(skip)]
    pub target_library_id: Option<String>,
}
