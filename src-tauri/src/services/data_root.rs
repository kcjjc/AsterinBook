use super::bootstrap::atomic_write;
use crate::contracts::{AppError, Result, RootInfo};
use std::{
    fs,
    path::{Path, PathBuf},
};
pub fn key(path: &Path) -> String {
    path.to_string_lossy()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_lowercase()
}
pub fn related(a: &Path, b: &Path) -> bool {
    let a = key(a);
    let b = key(b);
    a == b || a.starts_with(&(b.clone() + "/")) || b.starts_with(&(a + "/"))
}
pub fn validate_root_path(path: &Path, install: &Path) -> Result<PathBuf> {
    let real = path
        .canonicalize()
        .map_err(|_| AppError::new("ROOT_UNAVAILABLE", "目录不存在或不可访问"))?;
    if !real.is_dir() {
        return Err(AppError::new("ROOT_UNAVAILABLE", "请选择一个目录"));
    }
    let install = install.canonicalize()?;
    let p = key(&real);
    let i = key(&install);
    if p == i || p.starts_with(&(i + "/")) {
        return Err(AppError::new(
            "PATH_CONFLICT",
            "阅读数据目录不能放在程序安装目录中",
        ));
    }
    Ok(real)
}
pub fn open_root(path: &Path, install: &Path) -> Result<RootInfo> {
    open_root_checked(path, install, true, None)
}
pub fn open_existing_root(
    path: &Path,
    install: &Path,
    expected_id: Option<&str>,
) -> Result<RootInfo> {
    open_root_checked(path, install, false, expected_id)
}
fn open_root_checked(
    path: &Path,
    install: &Path,
    create: bool,
    expected_id: Option<&str>,
) -> Result<RootInfo> {
    let real = validate_root_path(path, install)?;
    let manifest = real.join("library.json");
    let mut data: serde_json::Value;
    if manifest.exists() {
        data = serde_json::from_slice(&fs::read(&manifest)?)?;
        if expected_id.is_some_and(|id| data["libraryId"].as_str() != Some(id)) {
            return Err(AppError::new(
                "ROOT_UNAVAILABLE",
                "目标书库已改变，请重新选择并确认",
            ));
        }
        if data["schemaVersion"] != 1
            || data["normalizationVersion"] != 1
            || data["libraryId"]
                .as_str()
                .and_then(|s| uuid::Uuid::parse_str(s).ok())
                .is_none()
        {
            return Err(AppError::new("ROOT_UNAVAILABLE", "不支持或损坏的书库格式"));
        }
        if data["initializing"] != true && !real.join("reader.db").is_file() {
            return Err(AppError::new(
                "ROOT_UNAVAILABLE",
                "书库数据库缺失，请恢复备份",
            ));
        }
    } else {
        if !create {
            return Err(AppError::new(
                "ROOT_UNAVAILABLE",
                "所选目录不再是已有书库，请重新选择",
            ));
        }
        if fs::read_dir(&real)?.next().is_some() {
            return Err(AppError::new(
                "ROOT_NOT_EMPTY",
                "所选目录非空且不是 AsterinBook 书库，请选择其他目录",
            ));
        }
        data = serde_json::json!({"libraryId":uuid::Uuid::new_v4().to_string(),"schemaVersion":1,"normalizationVersion":1,"initializing":true});
        atomic_write(&manifest, &serde_json::to_vec(&data)?)?;
    }
    let probe = real.join(format!(".write-check-{}", uuid::Uuid::new_v4()));
    let f = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&probe)
        .map_err(|_| AppError::new("ROOT_UNAVAILABLE", "阅读数据目录没有写入权限"))?;
    drop(f);
    fs::remove_file(&probe)?;
    let db = rusqlite::Connection::open(real.join("reader.db"))?;
    let version: u32 = db.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version > 1 {
        return Err(AppError::new(
            "ROOT_UNAVAILABLE",
            "书库由更新版本创建，请使用对应版本程序",
        ));
    }
    if version == 0 && data["initializing"] != true {
        return Err(AppError::new("ROOT_UNAVAILABLE", "书库结构不完整"));
    }
    db.execute_batch(include_str!("../storage/schema.sql"))?;
    let check: String = db.query_row("PRAGMA quick_check", [], |r| r.get(0))?;
    if check != "ok" {
        return Err(AppError::new("DB_ERROR", "数据库完整性检查失败"));
    }
    fs::create_dir_all(real.join("books"))?;
    fs::create_dir_all(real.join("staging"))?;
    if data["initializing"] == true {
        data.as_object_mut().unwrap().remove("initializing");
        atomic_write(&manifest, &serde_json::to_vec(&data)?)?
    }
    Ok(RootInfo {
        path: real.to_string_lossy().into(),
        library_id: data["libraryId"].as_str().unwrap().into(),
        schema_version: 1,
    })
}
