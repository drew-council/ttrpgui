use campaign_domain::*;
use std::collections::BTreeSet;

fn setup() -> (CampaignEngine, CreatureId, EncounterId) {
    let mut engine = CampaignEngine::new(Campaign::new("Campaign")).unwrap();
    let hero = Creature::new("Éowyn", 20, None, CreatureKind::Persistent);
    let hero_id = hero.id;
    let session = Session::new("Session one");
    let session_id = session.id;
    engine.execute(Command::CreateCreature(hero)).unwrap();
    engine.execute(Command::CreateSession(session)).unwrap();
    engine
        .execute(Command::SetRoster([hero_id].into()))
        .unwrap();
    let encounter = next_encounter(&mut engine, session_id);
    (engine, hero_id, encounter)
}

fn next_encounter(engine: &mut CampaignEngine, session: SessionId) -> EncounterId {
    let id = EncounterId::new();
    engine
        .execute(Command::CreateEncounter {
            id,
            session,
            name: "Encounter".into(),
            location: None,
        })
        .unwrap();
    id
}

fn participants(engine: &CampaignEngine, encounter: EncounterId) -> BTreeSet<ParticipantId> {
    engine.state().encounters[&encounter]
        .participants
        .keys()
        .copied()
        .collect()
}

#[test]
fn persistent_health_lifecycle_reset_and_history() {
    let (mut engine, hero, first) = setup();
    let ids = participants(&engine, first);
    assert_eq!(ids.len(), 1, "default roster is included automatically");
    engine.execute(Command::Start(first)).unwrap();
    engine
        .execute(Command::AdjustHealth {
            encounter: first,
            participants: ids.clone(),
            delta: -27,
        })
        .unwrap();
    assert_eq!(engine.state().character_hp[&hero], -7);
    engine.execute(Command::Complete(first)).unwrap();
    let snapshot = engine.state().encounters[&first].clone();
    let second = next_encounter(&mut engine, snapshot.session);
    engine.execute(Command::Start(second)).unwrap();
    assert_eq!(
        engine.state().encounters[&second]
            .participants
            .values()
            .next()
            .unwrap()
            .hp,
        -7
    );
    assert_eq!(
        engine.execute(Command::Start(first)).unwrap_err(),
        DomainError::AlreadyActive
    );
    engine
        .execute(Command::ResetCharacters([hero].into()))
        .unwrap();
    assert_eq!(engine.state().character_hp[&hero], 20);
    assert!(engine.undo());
    assert_eq!(engine.state().character_hp[&hero], -7);
    assert!(engine.redo());
    let mut definition = engine.state().creatures[&hero].clone();
    definition.name = "Changed later".into();
    definition.max_hp = 40;
    engine.execute(Command::UpdateCreature(definition)).unwrap();
    assert_eq!(engine.state().encounters[&first], snapshot);
    assert_eq!(
        engine
            .execute(Command::AdjustHealth {
                encounter: first,
                participants: ids,
                delta: 1
            })
            .unwrap_err(),
        DomainError::Completed
    );
}

#[test]
fn copies_bulk_undo_caps_and_independent_health() {
    let (mut engine, _, encounter) = setup();
    let goblin = Creature::new("Goblin", 7, Some(13), CreatureKind::Template);
    let creature = goblin.id;
    engine.execute(Command::CreateCreature(goblin)).unwrap();
    let copies = engine
        .execute(Command::AddCreatures {
            encounter,
            creature,
            quantity: 3,
            initiative: None,
        })
        .unwrap()
        .added_participants;
    assert_eq!(copies.iter().copied().collect::<BTreeSet<_>>().len(), 3);
    engine.execute(Command::Start(encounter)).unwrap();
    let before = engine.state().clone();
    engine
        .execute(Command::AdjustHealth {
            encounter,
            participants: copies.iter().copied().collect(),
            delta: -10,
        })
        .unwrap();
    for id in &copies {
        assert_eq!(
            engine.state().encounters[&encounter].participants[id].hp,
            -3
        );
    }
    assert!(engine.undo());
    assert_eq!(*engine.state(), before);
    assert!(engine.redo());
    engine
        .execute(Command::AdjustHealth {
            encounter,
            participants: [copies[0]].into(),
            delta: i32::MAX,
        })
        .unwrap();
    let rows = &engine.state().encounters[&encounter].participants;
    assert_eq!(rows[&copies[0]].hp, 7);
    assert_eq!(rows[&copies[1]].hp, -3);
    engine
        .execute(Command::ResetHealth {
            encounter,
            participants: [copies[1]].into(),
        })
        .unwrap();
    assert_eq!(
        engine.state().encounters[&encounter].participants[&copies[1]].hp,
        7
    );
}

#[test]
fn invalid_commands_leave_state_and_history_unchanged() {
    let (mut engine, hero, encounter) = setup();
    let before = engine.state().clone();
    let revision = engine.revision();
    for command in [
        Command::AddCreatures {
            encounter,
            creature: hero,
            quantity: 2,
            initiative: None,
        },
        Command::SetInitiative {
            encounter,
            participants: BTreeSet::new(),
            initiative: Some(2),
        },
        Command::SetDescription {
            encounter,
            participants: [ParticipantId::new()].into(),
            description: "x".into(),
        },
        Command::CreateCreature(Creature::new("", 0, None, CreatureKind::Template)),
        Command::AdjustHealth {
            encounter,
            participants: participants(&engine, encounter),
            delta: -1,
        },
    ] {
        assert!(engine.execute(command).is_err());
        assert_eq!(*engine.state(), before);
        assert_eq!(engine.revision(), revision);
    }
}

#[test]
fn initiative_sort_retains_identity_and_unknown_values_last() {
    let (mut engine, _, encounter) = setup();
    let copies = engine
        .execute(Command::AddLocalCreature {
            encounter,
            creature: Creature::new("Bandit", 5, None, CreatureKind::Template),
            quantity: 3,
            initiative: None,
        })
        .unwrap()
        .added_participants;
    engine
        .execute(Command::SetInitiative {
            encounter,
            participants: [copies[0]].into(),
            initiative: Some(i32::MIN),
        })
        .unwrap();
    engine
        .execute(Command::SetInitiative {
            encounter,
            participants: [copies[1]].into(),
            initiative: Some(20),
        })
        .unwrap();
    let rows = engine.state().encounters[&encounter].sorted_participants();
    assert_eq!(rows[0].id, copies[1]);
    assert_eq!(rows[1].id, copies[0]);
    assert!(rows[2..].iter().all(|p| p.initiative.is_none()));
    engine
        .execute(Command::SetDescription {
            encounter,
            participants: copies.iter().copied().collect(),
            description: "Poisoned".into(),
        })
        .unwrap();
    engine
        .execute(Command::RenameParticipant {
            encounter,
            participant: copies[0],
            name: "Captain".into(),
        })
        .unwrap();
    assert_eq!(
        engine.state().encounters[&encounter].participants[&copies[0]].display_name(),
        "Captain"
    );
    assert!(engine.undo());
    assert_eq!(
        engine.state().encounters[&encounter].participants[&copies[0]].description,
        "Poisoned"
    );
    assert!(engine.undo());
    assert!(
        engine.state().encounters[&encounter].participants[&copies[0]]
            .description
            .is_empty()
    );
}

#[test]
fn encounter_only_creatures_can_be_saved_to_library() {
    let (mut engine, _, encounter) = setup();
    let added = engine
        .execute(Command::AddLocalCreature {
            encounter,
            creature: Creature::new("Guest", 12, None, CreatureKind::Persistent),
            quantity: 1,
            initiative: None,
        })
        .unwrap()
        .added_participants[0];
    let id = CreatureId::new();
    engine
        .execute(Command::SaveToLibrary {
            encounter,
            participant: added,
            id,
        })
        .unwrap();
    assert_eq!(engine.state().creatures[&id].kind, CreatureKind::Template);
    assert!(!engine.state().encounters[&encounter].participants[&added].persistent);
    assert!(engine.undo());
    assert!(!engine.state().creatures.contains_key(&id));
    assert_eq!(
        engine.state().encounters[&encounter].participants[&added].creature,
        None
    );
}
