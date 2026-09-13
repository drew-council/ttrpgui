use crate::Files;
use anyhow::{Context, Result, ensure};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeSet,
    fs::{self, File},
    io::Write,
    path::{Component, Path, PathBuf},
};

#[derive(Serialize, Deserialize)]
struct Entry {
    path: String,
    before: Option<Vec<u8>>,
    after: Option<Vec<u8>>,
}

pub(crate) fn safe_path(root: &Path, relative: &str) -> Result<PathBuf> {
    let path = Path::new(relative);
    ensure!(
        !relative.is_empty() && path.components().all(|p| matches!(p, Component::Normal(_))),
        "Invalid campaign-relative path"
    );
    let mut target = root.to_path_buf();
    for component in path.components() {
        target.push(component);
        match fs::symlink_metadata(&target) {
            Ok(metadata) => ensure!(
                !metadata.is_symlink(),
                "Refusing symlink at {}",
                target.display()
            ),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(e.into()),
        }
    }
    Ok(target)
}

fn contents(path: &Path) -> Result<Option<Vec<u8>>> {
    match fs::read(path) {
        Ok(value) => Ok(Some(value)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

fn sync(path: &Path) -> Result<()> {
    File::open(path)?.sync_all()?;
    Ok(())
}

/// The temporary file and destination share a directory, so replacement is
/// atomic. Both file contents and directory entries are flushed before return.
pub(crate) fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    let parent = path.parent().context("Missing parent directory")?;
    fs::create_dir_all(parent)?;
    let temporary = parent.join(format!(".write-{}", uuid::Uuid::new_v4()));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&temporary, path)?;
        sync(parent)
    })();
    if result.is_err() {
        let _ = fs::remove_file(temporary);
    }
    result
}

pub(crate) fn commit(root: &Path, before: &Files, after: &Files) -> Result<()> {
    let paths: BTreeSet<_> = before.keys().chain(after.keys()).collect();
    let entries: Vec<_> = paths
        .into_iter()
        .filter(|p| before.get(*p) != after.get(*p))
        .map(|p| Entry {
            path: p.clone(),
            before: before.get(p).cloned(),
            after: after.get(p).cloned(),
        })
        .collect();
    if entries.is_empty() {
        return Ok(());
    }
    let journal = safe_path(root, ".transaction")?;
    ensure!(!journal.exists(), "An unfinished save needs recovery");
    // One atomic journal contains old and new bytes. No campaign file is touched
    // until this durable recovery record exists.
    atomic_write(&journal, &serde_json::to_vec(&entries)?)?;
    recover(root)
}

pub(crate) fn recover(root: &Path) -> Result<()> {
    let journal = safe_path(root, ".transaction")?;
    let Some(bytes) = contents(&journal)? else {
        return Ok(());
    };
    let entries: Vec<Entry> = serde_json::from_slice(&bytes)
        .context("Invalid recovery journal; preserved for inspection")?;
    // Preflight all paths before writing. If an external editor changed a file
    // after interruption, retain its contents plus both journal versions.
    for entry in &entries {
        let path = safe_path(root, &entry.path)?;
        ensure!(
            entry.path != ".transaction" && entry.path != ".campaign.lock",
            "Invalid journal target"
        );
        let current = contents(&path)?;
        ensure!(
            current == entry.before || current == entry.after,
            "Recovery conflict at {}; external contents and recovery journal are preserved",
            entry.path
        );
    }
    for entry in entries {
        let path = safe_path(root, &entry.path)?;
        let current = contents(&path)?;
        ensure!(
            current == entry.before || current == entry.after,
            "Concurrent external edit at {}; journal preserved",
            entry.path
        );
        if current == entry.after {
            continue;
        }
        match entry.after {
            Some(bytes) => atomic_write(&path, &bytes)?,
            None => {
                fs::remove_file(&path)?;
                sync(path.parent().unwrap())?;
            }
        }
        let mut parent = path.parent();
        while let Some(directory) = parent {
            sync(directory)?;
            if directory == root {
                break;
            }
            parent = directory.parent();
        }
    }
    fs::remove_file(journal)?;
    sync(root)
}

#[cfg(test)]
pub(crate) fn interrupt(root: &Path, before: &Files, after: &Files, applied: usize) -> Result<()> {
    let entries: Vec<_> = after
        .iter()
        .filter(|(p, v)| before.get(*p) != Some(*v))
        .map(|(p, v)| Entry {
            path: p.clone(),
            before: before.get(p).cloned(),
            after: Some(v.clone()),
        })
        .collect();
    atomic_write(&root.join(".transaction"), &serde_json::to_vec(&entries)?)?;
    for entry in entries.iter().take(applied) {
        atomic_write(&root.join(&entry.path), entry.after.as_ref().unwrap())?;
    }
    Ok(())
}
