use super::Core;
use crate::contracts::{AppError, MigrationPlan, Result, RootInfo};
use crate::services::{
    bootstrap::atomic_write,
    data_root::{related, validate_root_path},
    fs_ops::tree_size,
};
use std::{
    fs,
    path::{Path, PathBuf},
};
impl Core {
    pub fn prepare_migration(&mut self, target: &Path) -> Result<MigrationPlan> {
        if !self.sessions.is_empty() {
            return Err(AppError::new("IO_ERROR", "请先完成或取消正在导入的小说"));
        }
        let source = self.root_path()?;
        let target = validate_root_path(target, &self.install)?;
        if related(&source, &target) {
            return Err(AppError::new(
                "PATH_CONFLICT",
                "新旧阅读目录不能相同或互为父子目录",
            ));
        }
        let nonempty = fs::read_dir(&target)?.next().is_some();
        let mut target_library_id = None;
        let mode = if nonempty {
            if !target.join("library.json").is_file() {
                return Err(AppError::new(
                    "ROOT_NOT_EMPTY",
                    "目标非空且不是有效书库，不会覆盖文件",
                ));
            }
            target_library_id = Some(
                crate::services::data_root::open_existing_root(&target, &self.install, None)?
                    .library_id,
            );
            "open"
        } else {
            "copy"
        };
        let bytes = if mode == "copy" {
            tree_size(&source)?
        } else {
            0
        };
        if mode == "copy" && fs2::available_space(&target)? < bytes + 1048576 {
            return Err(AppError::new("NO_SPACE", "目标目录空间不足"));
        }
        let plan = MigrationPlan {
            token: uuid::Uuid::new_v4().to_string(),
            mode: mode.into(),
            source: source.to_string_lossy().into(),
            target: target.to_string_lossy().into(),
            bytes,
            target_library_id,
        };
        self.pending_migration = Some(plan.clone());
        Ok(plan)
    }
    pub fn commit_migration(&mut self, token: &str) -> Result<RootInfo> {
        let p = self
            .pending_migration
            .take()
            .filter(|p| p.token == token)
            .ok_or_else(|| AppError::new("SESSION_EXPIRED", "迁移预览已失效，请重新选择"))?;
        let source = self.root_path()?;
        if source != Path::new(&p.source) {
            return Err(AppError::new("SESSION_EXPIRED", "当前书库已变化"));
        }
        let target = validate_root_path(Path::new(&p.target), &self.install)?;
        if related(&source, &target) {
            return Err(AppError::new("PATH_CONFLICT", "目标路径冲突"));
        }
        self.flush_writes()?;
        self.db.take();
        if p.mode == "open" {
            let result = self.select_existing_root(&target, p.target_library_id.as_deref());
            if result.is_err() {
                self.select_root(&source)?;
            }
            return result;
        }
        let stage = target
            .parent()
            .ok_or_else(|| AppError::new("PATH_CONFLICT", "无法使用磁盘根目录作为迁移目标"))?
            .join(format!(".asterinbook-migrate-{}", p.token));
        let marker_path = self.bootstrap.with_extension("migration.json");
        let library = self.root.as_ref().unwrap().library_id.clone();
        let mut marker = serde_json::json!({"token":p.token,"source":p.source,"target":p.target,"libraryId":library,"phase":"copying"});
        let result = (|| -> Result<RootInfo> {
            if fs::read_dir(&target)?.next().is_some() {
                return Err(AppError::new("ROOT_NOT_EMPTY", "目标目录不再为空"));
            }
            atomic_write(&marker_path, &serde_json::to_vec(&marker)?)?;
            self.fs_ops.copy_tree(&source, &stage)?;
            let db = rusqlite::Connection::open(stage.join("reader.db"))?;
            let integrity: String = db.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
            drop(db);
            if integrity != "ok" {
                return Err(AppError::new("DB_ERROR", "迁移后数据库完整性校验失败"));
            }
            marker["phase"] = "verified".into();
            atomic_write(&marker_path, &serde_json::to_vec(&marker)?)?;
            self.fs_ops.commit_dir(&stage, &target)?;
            marker["phase"] = "targetCommitted".into();
            atomic_write(&marker_path, &serde_json::to_vec(&marker)?)?;
            self.fs_ops.write_pointer(
                &self.bootstrap,
                &serde_json::to_vec(&serde_json::json!({"rootPath":p.target,"libraryId":library}))?,
            )?;
            marker["phase"] = "pointerSwitched".into();
            atomic_write(&marker_path, &serde_json::to_vec(&marker)?)?;
            let info = self.select_root(&target)?;
            let _ = fs::remove_file(&marker_path);
            Ok(info)
        })();
        if result.is_err() {
            self.select_root(&source)?;
            if stage.exists() {
                let expected = target
                    .parent()
                    .unwrap()
                    .join(format!(".asterinbook-migrate-{}", p.token));
                if stage == expected {
                    fs::remove_dir_all(&stage)?
                }
            }
            let _ = fs::remove_file(&marker_path);
        }
        result
    }
    pub(crate) fn recover_migration(&mut self) -> Result<()> {
        let marker_path = self.bootstrap.with_extension("migration.json");
        if !marker_path.exists() {
            return Ok(());
        }
        let marker: serde_json::Value = serde_json::from_slice(&fs::read(&marker_path)?)?;
        let source = PathBuf::from(
            marker["source"]
                .as_str()
                .ok_or_else(|| AppError::new("IO_ERROR", "迁移记录损坏"))?,
        );
        let target = PathBuf::from(
            marker["target"]
                .as_str()
                .ok_or_else(|| AppError::new("IO_ERROR", "迁移记录损坏"))?,
        );
        let pointer: serde_json::Value = serde_json::from_slice(&fs::read(&self.bootstrap)?)?;
        let pointed = pointer["rootPath"].as_str().unwrap_or("");
        if pointed != source.to_string_lossy() && pointed != target.to_string_lossy() {
            return Err(AppError::new(
                "ROOT_UNAVAILABLE",
                "迁移记录与当前书库不一致",
            ));
        }
        if pointed == target.to_string_lossy() {
            let valid = (|| -> Result<()> {
                let data: serde_json::Value =
                    serde_json::from_slice(&fs::read(target.join("library.json"))?)?;
                if data["libraryId"] != marker["libraryId"] {
                    return Err(AppError::new("DB_ERROR", "目标标识不一致"));
                }
                let db = rusqlite::Connection::open_with_flags(
                    target.join("reader.db"),
                    rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
                )?;
                let check: String = db.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
                if check != "ok" {
                    return Err(AppError::new("DB_ERROR", "目标校验失败"));
                }
                Ok(())
            })();
            if valid.is_err() {
                let data: serde_json::Value =
                    serde_json::from_slice(&fs::read(source.join("library.json"))?)?;
                if data["libraryId"] != marker["libraryId"] {
                    return Err(AppError::new(
                        "ROOT_UNAVAILABLE",
                        "新旧书库均无法确认，请恢复备份",
                    ));
                }
                atomic_write(
                    &self.bootstrap,
                    &serde_json::to_vec(
                        &serde_json::json!({"rootPath":source.to_string_lossy(),"libraryId":marker["libraryId"]}),
                    )?,
                )?;
            }
        }
        // Only remove our own staged copy, identified by token and matching library manifest.
        if let Some(token) = marker["token"]
            .as_str()
            .filter(|s| uuid::Uuid::parse_str(s).is_ok())
        {
            if let Some(parent) = target.parent() {
                let stage = parent.join(format!(".asterinbook-migrate-{token}"));
                if stage.exists() {
                    let manifest = stage.join("library.json");
                    if manifest.exists() {
                        let data: serde_json::Value = serde_json::from_slice(&fs::read(manifest)?)?;
                        if data["libraryId"] == marker["libraryId"]
                            && !fs::symlink_metadata(&stage)?.file_type().is_symlink()
                        {
                            fs::remove_dir_all(stage)?
                        }
                    }
                }
            }
        }
        fs::remove_file(marker_path)?;
        Ok(())
    }
}
