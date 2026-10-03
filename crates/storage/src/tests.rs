use super::*;

fn example() -> Campaign {
    let mut engine = CampaignEngine::new(Campaign::new("Test campaign")).unwrap();
    let hero = Creature::new("Éowyn", 20, None, CreatureKind::Persistent);
    let hero_id = hero.id;
    let session = Session::new("Session one");
    let session_id = session.id;
    engine.execute(Command::CreateCreature(hero)).unwrap();
    engine
        .execute(Command::SetRoster([hero_id].into()))
        .unwrap();
    engine.execute(Command::CreateSession(session)).unwrap();
    let encounter = EncounterId::new();
    engine
        .execute(Command::CreateEncounter {
            id: encounter,
            session: session_id,
            name: "Forest".into(),
            location: None,
        })
        .unwrap();
    engine.execute(Command::Start(encounter)).unwrap();
    engine.state().clone()
}

#[test]
fn explicit_recovery_preserves_external_bytes_before_resolving_conflict() {
    let temp = tempfile::tempdir().unwrap();
    let mut campaign = example();
    let mut store = CampaignStore::create(temp.path(), &campaign).unwrap();
    campaign.config.name = "Recovered work".into();
    store.preserve_unsaved(&campaign).unwrap();
    let external = b"invalid external TOML, preserve exactly";
    fs::write(temp.path().join("campaign.toml"), external).unwrap();
    assert!(store.save(&campaign).is_err());
    assert_eq!(store.restore_unsaved().unwrap(), campaign);
    assert!(store.unsaved().unwrap().is_none());
    let backup = fs::read_dir(temp.path().join(".recovery"))
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let files: Files = serde_json::from_slice(&fs::read(backup).unwrap()).unwrap();
    assert_eq!(files["campaign.toml"], external);
    assert_eq!(store.reload().unwrap(), campaign);
}

#[test]
fn external_snapshot_requires_explicit_acceptance_of_the_same_disk_version() {
    let temp = tempfile::tempdir().unwrap();
    let mut campaign = example();
    let mut store = CampaignStore::create(temp.path(), &campaign).unwrap();
    let path = temp.path().join("campaign.toml");
    campaign.config.name = "External one".into();
    fs::write(&path, toml::to_string(&campaign.config).unwrap()).unwrap();
    let snapshot = store.external_snapshot().unwrap().unwrap();
    assert!(
        store.save(&campaign).is_err(),
        "Reading external state must not accept it"
    );
    campaign.config.name = "External two".into();
    fs::write(&path, toml::to_string(&campaign.config).unwrap()).unwrap();
    assert!(store.accept_external(snapshot).is_err());
    let snapshot = store.external_snapshot().unwrap().unwrap();
    store.accept_external(snapshot).unwrap();
    store.save(&campaign).unwrap();
}

#[test]
fn portable_roundtrip_and_prose_preservation() {
    let temp = tempfile::tempdir().unwrap();
    let campaign = example();
    let mut store = CampaignStore::create(temp.path(), &campaign).unwrap();
    let hero = campaign.creatures.keys().next().unwrap();
    let prose = temp.path().join(format!("creatures/{hero}/notes.md"));
    fs::write(
        &prose,
        "# Éowyn\n\n[[unknown]]\n<custom preserve='yes' />\n",
    )
    .unwrap();
    store.save(&campaign).unwrap();
    assert!(
        fs::read_to_string(&prose)
            .unwrap()
            .contains("<custom preserve='yes' />")
    );
    assert!(
        CampaignStore::open(temp.path()).is_err(),
        "second writer is locked out"
    );
    drop(store);
    let (_, loaded) = CampaignStore::open(temp.path()).unwrap();
    assert_eq!(loaded, campaign);
}

#[test]
fn external_changes_preserve_both_versions_and_reload_cleanly() {
    let temp = tempfile::tempdir().unwrap();
    let mut campaign = example();
    let mut store = CampaignStore::create(temp.path(), &campaign).unwrap();
    let mut external = campaign.config.clone();
    external.name = "External".into();
    fs::write(
        temp.path().join("campaign.toml"),
        toml::to_string(&external).unwrap(),
    )
    .unwrap();
    campaign.config.name = "In memory".into();
    assert!(store.has_external_changes().unwrap());
    assert!(
        store
            .save(&campaign)
            .unwrap_err()
            .to_string()
            .contains("externally")
    );
    assert_eq!(campaign.config.name, "In memory");
    assert_eq!(store.reload().unwrap().config.name, "External");
}

#[test]
fn interrupted_batch_rolls_forward_all_files() {
    for applied in 0..3 {
        let temp = tempfile::tempdir().unwrap();
        let before = example();
        let store = CampaignStore::create(temp.path(), &before).unwrap();
        let mut after = before.clone();
        after.config.name = "After".into();
        after.sessions.values_mut().next().unwrap().name = "Renamed session".into();
        after.encounters.values_mut().next().unwrap().name = "Renamed encounter".into();
        transaction::interrupt(
            temp.path(),
            &encode(&before).unwrap(),
            &encode(&after).unwrap(),
            applied,
        )
        .unwrap();
        drop(store);
        let (_, recovered) = CampaignStore::open(temp.path()).unwrap();
        assert_eq!(recovered, after);
        assert!(!temp.path().join(".transaction").exists());
    }
}

#[test]
fn interrupted_batch_external_conflict_keeps_journal_and_external_file() {
    let temp = tempfile::tempdir().unwrap();
    let before = example();
    let store = CampaignStore::create(temp.path(), &before).unwrap();
    let mut after = before.clone();
    after.config.name = "Pending".into();
    transaction::interrupt(
        temp.path(),
        &encode(&before).unwrap(),
        &encode(&after).unwrap(),
        0,
    )
    .unwrap();
    fs::write(temp.path().join("campaign.toml"), "external edit").unwrap();
    drop(store);
    assert!(CampaignStore::open(temp.path()).is_err());
    assert!(temp.path().join(".transaction").exists());
    assert_eq!(
        fs::read_to_string(temp.path().join("campaign.toml")).unwrap(),
        "external edit"
    );
}

#[test]
fn blocked_path_is_reported_before_mutation_and_retry_succeeds() {
    let temp = tempfile::tempdir().unwrap();
    let before = example();
    let mut store = CampaignStore::create(temp.path(), &before).unwrap();
    let mut after = before.clone();
    let note = Note::new("Blocked");
    let id = note.id;
    after.notes.insert(id, note);
    fs::create_dir_all(temp.path().join("notes")).unwrap();
    fs::write(
        temp.path().join(format!("notes/{id}")),
        "file blocks directory",
    )
    .unwrap();
    assert!(store.save(&after).is_err());
    assert!(!temp.path().join(".transaction").exists());
    fs::remove_file(temp.path().join(format!("notes/{id}"))).unwrap();
    store.save(&after).unwrap();
    drop(store);
    let (_, loaded) = CampaignStore::open(temp.path()).unwrap();
    assert_eq!(loaded, after);
}

#[test]
fn malicious_paths_and_symlinks_cannot_escape_campaign() {
    let temp = tempfile::tempdir().unwrap();
    assert!(transaction::safe_path(temp.path(), "../outside").is_err());
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink("/tmp", temp.path().join("notes")).unwrap();
        assert!(transaction::safe_path(temp.path(), "notes/outside").is_err());
    }
}

#[test]
fn document_batches_reject_external_edits_and_preserve_unsaved_campaign() {
    let temp = tempfile::tempdir().unwrap();
    let campaign = example();
    let mut store = CampaignStore::create(temp.path(), &campaign).unwrap();
    let id = campaign.sessions.keys().next().unwrap();
    let path = format!("sessions/{id}/notes.md");
    store
        .edit_documents([(path.clone(), (String::new(), "[[Archive]]".into()))].into())
        .unwrap();
    assert!(
        store
            .edit_documents([(path.clone(), (String::new(), "overwrite".into()))].into())
            .is_err()
    );
    assert_eq!(
        fs::read_to_string(temp.path().join(path)).unwrap(),
        "[[Archive]]"
    );
    let mut unsaved = campaign.clone();
    unsaved.config.name = "Recover me".into();
    store.preserve_unsaved(&unsaved).unwrap();
    assert_eq!(store.unsaved().unwrap(), Some(unsaved));
    store.clear_unsaved().unwrap();
    assert_eq!(store.unsaved().unwrap(), None);
}
