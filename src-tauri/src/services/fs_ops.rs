use super::data_root::key;
use crate::contracts::{AppError, Result};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};
pub fn hash_file(path: &Path) -> Result<String> {
    let mut input = fs::File::open(path)?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let n = input.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        hash.update(&buffer[..n]);
    }
    Ok(format!("{:x}", hash.finalize()))
}
pub fn copy_source(source: &Path, target: &Path, limit: u64) -> Result<String> {
    let mut input = fs::File::open(source)?;
    let mut out = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(target)?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 65536];
    let mut total = 0;
    loop {
        let n = input.read(&mut buffer)?;
        if n == 0 {
            break;
        }
        total += n as u64;
        if total > limit {
            return Err(AppError::new(
                "FILE_TOO_LARGE",
                "文件超过 50 MiB，已停止复制",
            ));
        }
        out.write_all(&buffer[..n])?;
        hash.update(&buffer[..n]);
    }
    out.sync_all()?;
    Ok(format!("{:x}", hash.finalize()))
}
pub fn owned_dir(root: &Path, bucket: &str, id: &str) -> Result<PathBuf> {
    if uuid::Uuid::parse_str(id).is_err() {
        return Err(AppError::new("INVALID_INDEX", "无效书籍或任务标识"));
    }
    let root = root.canonicalize()?;
    let base = root.join(bucket).canonicalize()?;
    if !base.starts_with(&root) {
        return Err(AppError::new("PATH_CONFLICT", "书库目录指向了外部路径"));
    }
    let path = base.join(id);
    if path.exists() {
        let real = path.canonicalize()?;
        if key(&real) != key(&path) || fs::symlink_metadata(&path)?.file_type().is_symlink() {
            return Err(AppError::new("PATH_CONFLICT", "书籍目录不能是链接"));
        }
    }
    Ok(path)
}

pub trait FsOps: Send + Sync {
    fn append_chunk(&self, path: &Path, bytes: &[u8]) -> Result<()> {
        let mut out = fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)?;
        out.write_all(bytes)?;
        out.sync_all()?;
        Ok(())
    }
    fn copy_tree(&self, source: &Path, target: &Path) -> Result<()>;
    fn commit_dir(&self, stage: &Path, target: &Path) -> Result<()>;
    fn write_pointer(&self, path: &Path, bytes: &[u8]) -> Result<()>;
}
pub struct RealFsOps;
impl FsOps for RealFsOps {
    fn copy_tree(&self, source: &Path, target: &Path) -> Result<()> {
        copy_tree(source, target)
    }
    fn commit_dir(&self, stage: &Path, target: &Path) -> Result<()> {
        if target.exists() {
            if fs::symlink_metadata(target)?.file_type().is_symlink()
                || fs::read_dir(target)?.next().is_some()
            {
                return Err(AppError::new(
                    "ROOT_NOT_EMPTY",
                    "目标目录已改变，迁移已停止",
                ));
            }
            fs::remove_dir(target)?
        }
        fs::rename(stage, target)?;
        Ok(())
    }
    fn write_pointer(&self, path: &Path, bytes: &[u8]) -> Result<()> {
        super::bootstrap::atomic_write(path, bytes)
    }
}
pub fn copy_tree(source: &Path, target: &Path) -> Result<()> {
    fs::create_dir(target)?;
    for entry in fs::read_dir(source)? {
        let entry = entry?;
        let from = entry.path();
        let to = target.join(entry.file_name());
        if entry.file_type()?.is_symlink() {
            return Err(AppError::new(
                "PATH_CONFLICT",
                "书库中存在链接文件，请先处理后迁移",
            ));
        }
        if entry.file_type()?.is_dir() {
            copy_tree(&from, &to)?
        } else {
            fs::copy(&from, &to)?;
            fs::OpenOptions::new().write(true).open(&to)?.sync_all()?;
            if hash_file(&from)? != hash_file(&to)? {
                return Err(AppError::new("IO_ERROR", "迁移文件校验失败"));
            }
        }
    }
    Ok(())
}
pub fn tree_size(root: &Path) -> Result<u64> {
    let mut size = 0;
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        if entry.file_type()?.is_symlink() {
            return Err(AppError::new("PATH_CONFLICT", "目录中存在链接文件"));
        }
        size += if entry.file_type()?.is_dir() {
            tree_size(&entry.path())?
        } else {
            entry.metadata()?.len()
        };
    }
    Ok(size)
}
