//! Reproducible disk-backed campaign timing; no GUI or permanent data.
use campaign_domain::*;
use campaign_storage::CampaignStore;
use std::time::Instant;

fn main() -> anyhow::Result<()> {
    let mut campaign = Campaign::new("Performance fixture");
    for number in 0..10_000 {
        let note = Note::new(format!("Location {number:05}"));
        campaign.notes.insert(note.id, note);
    }
    let session = Session::new("Session");
    let session_id = session.id;
    campaign.sessions.insert(session.id, session);
    let mut engine = CampaignEngine::new(campaign)?;
    let encounter = EncounterId::new();
    engine.execute(Command::CreateEncounter {
        id: encounter,
        session: session_id,
        name: "Encounter".into(),
        location: None,
    })?;
    engine.execute(Command::AddLocalCreature {
        encounter,
        creature: Creature::new("Goblin", 7, None, CreatureKind::Template),
        quantity: 100,
        initiative: Some(10),
    })?;
    engine.execute(Command::Start(encounter))?;
    let temp = tempfile::tempdir()?;
    let start = Instant::now();
    let mut store = CampaignStore::create(temp.path(), engine.state())?;
    println!(
        "10,000 pages + 100 participants: initial durable save {:?}",
        start.elapsed()
    );
    let participant = *engine.state().encounters[&encounter]
        .participants
        .keys()
        .next()
        .unwrap();
    let start = Instant::now();
    engine.execute(Command::AdjustHealth {
        encounter,
        participants: [participant].into(),
        delta: -1,
    })?;
    println!("Combat domain mutation {:?}", start.elapsed());
    let start = Instant::now();
    store.save(engine.state())?;
    println!("Combat durable save {:?}", start.elapsed());
    Ok(())
}
