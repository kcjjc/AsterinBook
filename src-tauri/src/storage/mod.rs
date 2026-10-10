use crate::contracts::{AppError, Result, RootInfo};
use crate::services::{
    bootstrap::atomic_write,
    data_root::{open_existing_root, open_root},
};
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
mod import;
mod library;
mod migration;
pub(crate) struct ImportSession {
    pub id: String,
    pub source_hash: String,
    pub sequence: u32,
    pub bytes: u64,
    pub last_chunk: Option<(u32, String)>,
}
pub struct Core {
    pub bootstrap: PathBuf,
    pub install: PathBuf,
    pub(crate) root: Option<RootInfo>,
    pub(crate) db: Option<rusqlite::Connection>,
    pub(crate) sessions: std::collections::HashMap<String, ImportSession>,
    pub(crate) pending_migration: Option<crate::contracts::MigrationPlan>,
    pub(crate) fs_ops: std::sync::Arc<dyn crate::services::fs_ops::FsOps>,
}
impl Core {
    pub fn new(bootstrap: PathBuf, install: PathBuf) -> Self {
        Self::with_fs_ops(
            bootstrap,
            install,
            std::sync::Arc::new(crate::services::fs_ops::RealFsOps),
        )
    }
    pub fn with_fs_ops(
        bootstrap: PathBuf,
        install: PathBuf,
        fs_ops: std::sync::Arc<dyn crate::services::fs_ops::FsOps>,
    ) -> Self {
        Self {
            bootstrap,
            install,
            root: None,
            db: None,
            sessions: std::collections::HashMap::new(),
            pending_migration: None,
            fs_ops,
        }
    }
    pub fn select_root(&mut self, path: &Path) -> Result<RootInfo> {
        let info = open_root(path, &self.install)?;
        self.activate_root(info)
    }
    pub fn select_existing_root(
        &mut self,
        path: &Path,
        expected_id: Option<&str>,
    ) -> Result<RootInfo> {
        let info = open_existing_root(path, &self.install, expected_id)?;
        self.activate_root(info)
    }
    pub fn choose_root(&mut self, path: &Path, existing: bool) -> Result<RootInfo> {
        // Explicit selection resolves a failed recovery. Preserve the old record for inspection.
        let marker = self.bootstrap.with_extension("migration.json");
        let info = if existing {
            open_existing_root(path, &self.install, None)?
        } else {
            open_root(path, &self.install)?
        };
        let archived =
            marker.with_extension(format!("migration-resolved-{}.json", uuid::Uuid::new_v4()));
        if marker.exists() {
            fs::rename(&marker, &archived)?;
        }
        let result = self.activate_root(info);
        if result.is_err() && archived.exists() {
            fs::rename(archived, marker)?;
        }
        result
    }
    fn activate_root(&mut self, info: RootInfo) -> Result<RootInfo> {
        let db = rusqlite::Connection::open(Path::new(&info.path).join("reader.db"))?;
        db.busy_timeout(Duration::from_secs(5))?;
        db.execute_batch("PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL;")?;
        atomic_write(
            &self.bootstrap,
            &serde_json::to_vec(
                &serde_json::json!({"rootPath":info.path,"libraryId":info.library_id}),
            )?,
        )?;
        self.root = Some(info.clone());
        self.db = Some(db);
        self.recover_imports()?;
        self.recover_deletions()?;
        Ok(info)
    }
    pub fn startup(&mut self) -> Result<serde_json::Value> {
        if let Err(error) = self.recover_migration() {
            let path = fs::read(&self.bootstrap)
                .ok()
                .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
                .and_then(|v| v["rootPath"].as_str().map(str::to_owned))
                .unwrap_or_else(|| self.bootstrap.to_string_lossy().into_owned());
            return Ok(serde_json::json!({"status":"unavailable","path":path,"error":error}));
        }
        if !self.bootstrap.exists() {
            return Ok(
                serde_json::json!({"status":"needsRoot","suggestedPath":format!("{}\\AsterinBook",std::env::var("USERPROFILE").unwrap_or_default())}),
            );
        }
        let value: serde_json::Value = match fs::read(&self.bootstrap)
            .map_err(AppError::from)
            .and_then(|b| serde_json::from_slice(&b).map_err(AppError::from))
        {
            Ok(v) => v,
            Err(e) => {
                return Ok(
                    serde_json::json!({"status":"unavailable","path":self.bootstrap.to_string_lossy(),"error":e}),
                )
            }
        };
        let path = PathBuf::from(value["rootPath"].as_str().unwrap_or(""));
        let opened = (|| {
            if !path.join("library.json").is_file() {
                return Err(AppError::new(
                    "ROOT_UNAVAILABLE",
                    "原书库不可访问或书库标识缺失，请选择原书库或恢复备份",
                ));
            }
            let manifest: serde_json::Value =
                serde_json::from_slice(&fs::read(path.join("library.json"))?)?;
            if manifest["libraryId"] != value["libraryId"] {
                return Err(AppError::new(
                    "ROOT_UNAVAILABLE",
                    "该目录中的书库已改变，请明确选择要打开的书库",
                ));
            }
            self.select_root(&path)
        })();
        Ok(match opened {
            Ok(info) => serde_json::json!({"status":"ready","root":info}),
            Err(error) => {
                serde_json::json!({"status":"unavailable","path":path.to_string_lossy(),"error":error})
            }
        })
    }
    pub(crate) fn root_path(&self) -> Result<PathBuf> {
        self.root
            .as_ref()
            .map(|r| PathBuf::from(&r.path))
            .ok_or_else(|| AppError::new("ROOT_UNAVAILABLE", "请先选择阅读数据目录"))
    }
    pub(crate) fn connection(&self) -> Result<&rusqlite::Connection> {
        self.db
            .as_ref()
            .ok_or_else(|| AppError::new("ROOT_UNAVAILABLE", "书库暂不可用"))
    }
}
