//! Portable campaign storage. Structured commands commit through a recoverable
//! journal; ordinary Markdown files remain independently editable by Zed.
mod transaction;

use anyhow::{Context, Result, bail, ensure};
use campaign_domain::*;
use serde::{Serialize, de::DeserializeOwned};
use std::{
    collections::BTreeMap,
    fs::{self, File},
    path::{Path, PathBuf},
};

type Files = BTreeMap<String, Vec<u8>>;

pub struct CampaignStore {
    root: PathBuf,
    _lock: File,
    expected: Files,
}

pub struct ExternalSnapshot {
    pub campaign: Campaign,
    files: Files,
}

impl CampaignStore {
    /// Holds an OS lock for the store lifetime. Recovery finishes a previously
    /// prepared transaction before any campaign data is made available.
    pub fn open(root: impl AsRef<Path>) -> Result<(Self, Campaign)> {
        let mut store = Self::lock(root.as_ref())?;
        transaction::recover(&store.root)?;
        let files = read_structured(&store.root)?;
        let campaign = decode(&files)?;
        store.expected = files;
        Ok((store, campaign))
    }

    pub fn create(root: impl AsRef<Path>, campaign: &Campaign) -> Result<Self> {
        let mut store = Self::lock(root.as_ref())?;
        ensure!(
            !store.root.join("campaign.toml").exists(),
            "A campaign already exists here"
        );
        ensure!(
            !store.root.join(".transaction").exists(),
            "An unfinished transaction needs recovery"
        );
        ensure!(
            read_structured(&store.root)?.is_empty(),
            "Campaign metadata already exists here"
        );
        store.save(campaign)?;
        fs::create_dir_all(store.root.join("templates"))?;
        transaction::atomic_write(&store.root.join("templates/blank.md"), b"# {{title}}\n\n")?;
        transaction::atomic_write(
            &store.root.join("templates/session.md"),
            b"# {{title}}\n\n## Preparation\n\n## Events\n\n## Follow-up\n\n",
        )?;
        Ok(store)
    }

    fn lock(root: &Path) -> Result<Self> {
        fs::create_dir_all(root)?;
        let root = root.canonicalize()?;
        transaction::safe_path(&root, ".campaign.lock")?;
        let lock = fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(root.join(".campaign.lock"))?;
        lock.try_lock()
            .context("This campaign is already open in another process")?;
        Ok(Self {
            root,
            _lock: lock,
            expected: Files::new(),
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    pub fn preserve_unsaved(&self, campaign: &Campaign) -> Result<()> {
        campaign.validate()?;
        transaction::atomic_write(
            &transaction::safe_path(&self.root, ".unsaved.toml")?,
            toml::to_string_pretty(campaign)?.as_bytes(),
        )
    }

    pub fn unsaved(&self) -> Result<Option<Campaign>> {
        let path = transaction::safe_path(&self.root, ".unsaved.toml")?;
        if !path.exists() {
            return Ok(None);
        }
        let campaign: Campaign = toml::from_str(&fs::read_to_string(path)?)?;
        campaign.validate()?;
        Ok(Some(campaign))
    }

    pub fn clear_unsaved(&self) -> Result<()> {
        let path = transaction::safe_path(&self.root, ".unsaved.toml")?;
        if path.exists() {
            fs::remove_file(path)?;
            File::open(&self.root)?.sync_all()?;
        }
        Ok(())
    }

    /// Explicit recovery resolution. Keep the exact external metadata (even
    /// malformed TOML) before replacing it with the user's recovered state.
    pub fn restore_unsaved(&mut self) -> Result<Campaign> {
        let recovered = self.unsaved()?.context("No recovery copy exists")?;
        let previous = decode(&self.expected)?;
        ensure!(
            recovered.config.id == previous.config.id,
            "Recovery belongs to another campaign"
        );
        ensure!(
            !self.root.join(".transaction").exists(),
            "Reopen the campaign to finish the pending save first"
        );
        let current = read_structured(&self.root)?;
        let backup = format!(".recovery/{}.json", uuid::Uuid::new_v4());
        transaction::atomic_write(
            &transaction::safe_path(&self.root, &backup)?,
            &serde_json::to_vec_pretty(&current)?,
        )?;
        File::open(&self.root)?.sync_all()?;
        self.expected = current;
        self.save(&recovered)?;
        self.clear_unsaved()?;
        Ok(recovered)
    }

    /// Apply closed-document edits with compare-before-write conflict checks.
    /// Open documents are edited through their Zed buffers by the desktop.
    pub fn edit_documents(&mut self, edits: BTreeMap<String, (String, String)>) -> Result<()> {
        let mut before = Files::new();
        let mut after = Files::new();
        for (path, (old, new)) in edits {
            ensure!(
                Path::new(&path).extension().is_some_and(|e| e == "md"),
                "Document edits require Markdown files"
            );
            let target = transaction::safe_path(&self.root, &path)?;
            ensure!(
                fs::read(&target)? == old.as_bytes(),
                "Document changed externally: {path}; disk contents preserved"
            );
            before.insert(path.clone(), old.into_bytes());
            after.insert(path, new.into_bytes());
        }
        transaction::commit(&self.root, &before, &after)
    }

    pub fn has_external_changes(&self) -> Result<bool> {
        Ok(read_structured(&self.root)? != self.expected)
    }

    pub fn external_snapshot(&self) -> Result<Option<ExternalSnapshot>> {
        let files = read_structured(&self.root)?;
        if files == self.expected {
            return Ok(None);
        }
        Ok(Some(ExternalSnapshot {
            campaign: decode(&files)?,
            files,
        }))
    }

    /// Accept only the exact externally-read version, after the UI confirms
    /// that it has no intervening local mutations.
    pub fn accept_external(&mut self, snapshot: ExternalSnapshot) -> Result<()> {
        ensure!(
            read_structured(&self.root)? == snapshot.files,
            "External metadata changed again during reload"
        );
        self.expected = snapshot.files;
        Ok(())
    }

    /// Call only for clean domain state. A dirty caller retains its in-memory
    /// state when `save` reports a conflict and can offer explicit resolution.
    pub fn reload(&mut self) -> Result<Campaign> {
        ensure!(
            !self.root.join(".transaction").exists(),
            "Recover the pending save by reopening the campaign"
        );
        let files = read_structured(&self.root)?;
        let campaign = decode(&files)?;
        self.expected = files;
        Ok(campaign)
    }

    pub fn save(&mut self, campaign: &Campaign) -> Result<()> {
        campaign.validate()?;
        ensure!(
            !self.root.join(".transaction").exists(),
            "Recover the pending save by reopening the campaign"
        );
        let current = read_structured(&self.root)?;
        ensure!(
            current == self.expected,
            "Campaign metadata changed externally; both disk and in-memory versions have been preserved"
        );
        let desired = encode(campaign)?;
        let mut batch = desired.clone();
        // New prose belongs to the same recovery batch. Existing prose remains
        // untouched, including unsupported Markdown and external edits.
        for path in desired
            .keys()
            .filter(|path| path.ends_with("/metadata.toml"))
        {
            let notes = Path::new(path).parent().unwrap().join("notes.md");
            let notes = notes.to_str().context("Invalid document path")?;
            let destination = transaction::safe_path(&self.root, notes)?;
            if !destination.exists() {
                batch.insert(notes.into(), Vec::new());
            }
        }
        transaction::commit(&self.root, &self.expected, &batch)?;
        self.expected = desired;
        Ok(())
    }
}

pub fn encounter_directory(encounter: &Encounter) -> String {
    format!("sessions/{}/encounters/{}", encounter.session, encounter.id)
}

fn encode(c: &Campaign) -> Result<Files> {
    let mut files = Files::new();
    fn put(files: &mut Files, path: String, value: &impl Serialize) -> Result<()> {
        files.insert(path, toml::to_string_pretty(value)?.into_bytes());
        Ok(())
    }
    put(&mut files, "campaign.toml".into(), &c.config)?;
    put(&mut files, "characters.toml".into(), &c.character_hp)?;
    for (id, value) in &c.creatures {
        put(&mut files, format!("creatures/{id}/metadata.toml"), value)?;
    }
    for (id, value) in &c.locations {
        put(&mut files, format!("locations/{id}/metadata.toml"), value)?;
    }
    for (id, value) in &c.sessions {
        put(&mut files, format!("sessions/{id}/metadata.toml"), value)?;
    }
    for (id, value) in &c.notes {
        put(&mut files, format!("notes/{id}/metadata.toml"), value)?;
    }
    for value in c.encounters.values() {
        put(
            &mut files,
            format!("{}/metadata.toml", encounter_directory(value)),
            value,
        )?;
    }
    Ok(files)
}

fn parse<T: DeserializeOwned>(files: &Files, path: &str) -> Result<T> {
    let bytes = files.get(path).with_context(|| format!("Missing {path}"))?;
    toml::from_str(std::str::from_utf8(bytes)?).with_context(|| format!("Invalid {path}"))
}

fn decode(files: &Files) -> Result<Campaign> {
    let mut c = Campaign::new("Loading");
    c.config = parse(files, "campaign.toml")?;
    c.character_hp = parse(files, "characters.toml")?;
    for path in files.keys().filter(|p| p.ends_with("/metadata.toml")) {
        let parts: Vec<_> = path.split('/').collect();
        match parts.as_slice() {
            ["creatures", id, "metadata.toml"] => {
                let v: Creature = parse(files, path)?;
                ensure!(v.id.to_string() == *id, "Creature path/ID mismatch");
                c.creatures.insert(v.id, v);
            }
            ["locations", id, "metadata.toml"] => {
                let v: Location = parse(files, path)?;
                ensure!(v.id.to_string() == *id, "Location path/ID mismatch");
                c.locations.insert(v.id, v);
            }
            ["sessions", id, "metadata.toml"] => {
                let v: Session = parse(files, path)?;
                ensure!(v.id.to_string() == *id, "Session path/ID mismatch");
                c.sessions.insert(v.id, v);
            }
            ["notes", id, "metadata.toml"] => {
                let v: Note = parse(files, path)?;
                ensure!(v.id.to_string() == *id, "Note path/ID mismatch");
                c.notes.insert(v.id, v);
            }
            ["sessions", session, "encounters", id, "metadata.toml"] => {
                let v: Encounter = parse(files, path)?;
                ensure!(
                    v.id.to_string() == *id && v.session.to_string() == *session,
                    "Encounter path/ID mismatch"
                );
                c.encounters.insert(v.id, v);
            }
            _ => bail!("Unrecognized metadata path: {path}"),
        }
    }
    c.validate()?;
    Ok(c)
}

fn read_structured(root: &Path) -> Result<Files> {
    fn visit(root: &Path, path: &Path, files: &mut Files) -> Result<()> {
        if !path.exists() {
            return Ok(());
        }
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            let kind = entry.file_type()?;
            ensure!(
                !kind.is_symlink(),
                "Campaign entity directories must not contain symlinks: {}",
                entry.path().display()
            );
            if kind.is_dir() {
                visit(root, &entry.path(), files)?;
            } else if entry.file_name() == "metadata.toml" {
                files.insert(
                    entry
                        .path()
                        .strip_prefix(root)?
                        .to_str()
                        .context("Non-UTF-8 path")?
                        .into(),
                    fs::read(entry.path())?,
                );
            }
        }
        Ok(())
    }
    let mut files = Files::new();
    for name in ["campaign.toml", "characters.toml"] {
        let path = transaction::safe_path(root, name)?;
        if path.exists() {
            files.insert(name.into(), fs::read(path)?);
        }
    }
    for name in ["creatures", "locations", "sessions", "notes"] {
        visit(root, &transaction::safe_path(root, name)?, &mut files)?;
    }
    Ok(files)
}

#[cfg(test)]
mod tests;
