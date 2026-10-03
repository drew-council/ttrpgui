//! Isolated end-to-end measurements. Never launched on a desktop display.
use super::{campaign::CampaignModel, encounter::EncounterView, navigator::Navigator};
use anyhow::{Context, ensure};
use campaign_domain::*;
use gpui::{AnyWindowHandle, AppContext, AsyncApp, Entity, Focusable};
use std::time::Instant;
use workspace::Workspace;

pub fn seed(root: &std::path::Path) -> anyhow::Result<()> {
    let mut campaign = Campaign::new("10,000-page performance fixture");
    for number in 0..10_000 {
        let note = Note::new(format!("Archive {number:05}"));
        campaign.notes.insert(note.id, note);
    }
    let session = Session::new("Performance session");
    let session_id = session.id;
    campaign.sessions.insert(session_id, session);
    let encounter = EncounterId::new();
    let mut engine = CampaignEngine::new(campaign)?;
    engine.execute(Command::CreateEncounter {
        id: encounter,
        session: session_id,
        name: "100 participants".into(),
        location: None,
    })?;
    engine.execute(Command::AddLocalCreature {
        encounter,
        creature: Creature::new("Goblin", 7, Some(13), CreatureKind::Template),
        quantity: 100,
        initiative: Some(10),
    })?;
    engine.execute(Command::Start(encounter))?;
    let start = Instant::now();
    drop(campaign_storage::CampaignStore::create(
        root,
        engine.state(),
    )?);
    println!(
        "Performance fixture: 10,000 portable pages and 100 participants; initial durable creation {:?}.",
        start.elapsed()
    );
    Ok(())
}

pub async fn verify(
    model: &Entity<CampaignModel>,
    workspace: &Entity<Workspace>,
    window: AnyWindowHandle,
    cx: &mut AsyncApp,
) -> anyhow::Result<()> {
    let scans = workspace.read_with(cx, |w, cx| {
        w.project()
            .read(cx)
            .worktrees(cx)
            .filter_map(|tree| tree.read(cx).as_local().map(|tree| tree.scan_complete()))
            .collect::<Vec<_>>()
    });
    futures::future::join_all(scans).await;
    cx.background_executor()
        .timer(std::time::Duration::from_millis(20))
        .await;
    let panel = workspace
        .read_with(cx, |w, cx| w.panel::<Navigator>(cx))
        .context("Performance navigator missing")?;
    let (filter, focus) = panel.read_with(cx, |p, cx| (p.filter_handle(), p.focus_handle(cx)));
    window.update(cx, |_, window, cx| {
        window.focus(&filter.read(cx).focus_handle(cx).clone(), cx);
        window.refresh();
        window.draw(cx).clear(cx);
    })?;
    let mut searches = Vec::new();
    // Each sample includes the input mutation, actual picker query and UI frame.
    for query in [
        "a",
        "ar",
        "arc",
        "archive",
        "archive 0",
        "archive 00",
        "archive 000",
        "archive 009",
    ] {
        let start = Instant::now();
        window.update(cx, |_, window, cx| {
            filter.update(cx, |e, cx| e.set_text(query, window, cx));
            window.refresh();
            window.draw(cx).clear(cx);
        })?;
        searches.push(start.elapsed().as_secs_f64() * 1000.);
        cx.background_executor()
            .timer(std::time::Duration::from_millis(20))
            .await;
    }
    searches.sort_by(f64::total_cmp);
    println!(
        "10,000-page warm picker: input + fuzzy query + headless CPU frame, median={:.2} ms, max={:.2} ms.",
        searches[4], searches[7]
    );
    let encounter = model.read_with(cx, |m, _| {
        *m.engine.state().encounters.keys().next().unwrap()
    });
    let view = window.update(cx, |_, window, cx| {
        let view =
            cx.new(|cx| EncounterView::new(model.clone(), workspace.downgrade(), encounter, cx));
        workspace.update(cx, |w, cx| {
            w.add_item_to_active_pane(Box::new(view.clone()), None, true, window, cx)
        });
        let focus = view.read(cx).focus_handle(cx);
        window.focus(&focus, cx);
        window.refresh();
        window.draw(cx).clear(cx);
        view
    })?;
    cx.background_executor()
        .timer(std::time::Duration::from_millis(20))
        .await;
    let mut frames = Vec::new();
    for _ in 0..30 {
        let start = Instant::now();
        super::rehearsal::press(window, "j", cx)?;
        frames.push(start.elapsed().as_secs_f64() * 1000.);
        cx.background_executor()
            .timer(std::time::Duration::from_millis(16))
            .await;
    }
    frames.sort_by(f64::total_cmp);
    println!(
        "100-participant navigation: key + headless CPU frame, p50={:.2} ms, p95={:.2} ms, max={:.2} ms.",
        frames[15], frames[28], frames[29]
    );
    // Include a real mutation with durable saving queued off the UI thread.
    let target = view
        .read_with(cx, |v, _| v.selection_state().0)
        .context("Participant cursor missing")?;
    let start = Instant::now();
    model.update(cx, |m, cx| {
        m.execute(
            Command::AdjustHealth {
                encounter,
                participants: [target].into(),
                delta: -1,
            },
            cx,
        );
    });
    window.update(cx, |_, window, cx| {
        window.refresh();
        window.draw(cx).clear(cx);
    })?;
    let mutation_ms = start.elapsed().as_secs_f64() * 1000.;
    println!(
        "10,000-page campaign health mutation + queued save + CPU frame: {mutation_ms:.2} ms."
    );
    super::campaign::wait_saved(model, cx).await?;
    window.update(cx, |_, window, cx| window.focus(&focus, cx))?;
    ensure!(
        searches[7] < 50.,
        "Warm picker exceeded 50 ms: {:.2} ms",
        searches[7]
    );
    ensure!(
        frames[28] < 1000. / 60.,
        "100-participant frame p95 exceeded the 60 Hz CPU budget: {:.2} ms",
        frames[28]
    );
    ensure!(
        mutation_ms < 1000. / 60.,
        "Health mutation exceeded the 60 Hz CPU budget: {mutation_ms:.2} ms"
    );
    Ok(())
}
