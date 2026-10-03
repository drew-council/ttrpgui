use super::*;
use crate::desktop::rehearsal::press;
use anyhow::{Context, ensure};

pub async fn verify(
    model: &Entity<CampaignModel>,
    workspace: &Entity<Workspace>,
    window: AnyWindowHandle,
    cx: &mut AsyncApp,
) -> anyhow::Result<()> {
    let panel = workspace
        .read_with(cx, |w, cx| w.panel::<Navigator>(cx))
        .context("Campaign navigator missing")?;
    let session = model.read_with(cx, |m, _| *m.engine.state().sessions.keys().next().unwrap());
    window.update(cx, |_, window, cx| {
        panel.update(cx, |p, cx| {
            p.filter.update(cx, |e, cx| e.set_text("", window, cx));
            p.picker_cursor = p
                .pages(cx)
                .iter()
                .position(|(id, _)| *id == DocumentId::Session(session))
                .unwrap();
            window.focus(&p.focus, cx);
            cx.notify();
        })
    })?;
    press(window, "h", cx)?;
    ensure!(panel.read_with(cx, |p, cx| p.collapsed_sessions.contains(&session)
        && p.pages(cx).iter().all(|(id, _)| !matches!(id, DocumentId::Encounter(id) if model.read(cx).engine.state().encounters[id].session == session))), "h did not collapse the selected session hierarchy");
    press(window, "l", cx)?;
    ensure!(
        panel.read_with(cx, |p, _| !p.collapsed_sessions.contains(&session)),
        "l did not expand the session hierarchy"
    );
    press(window, "s", cx)?;
    ensure!(
        panel.read_with(cx, |p, _| matches!(
            p.form.as_ref().map(|(kind, _)| kind),
            Some(Create::Session)
        )),
        "s did not open session creation"
    );
    for stroke in ["n", "e", "w", "s", "e", "s", "s", "i", "o", "n", "enter"] {
        press(window, stroke, cx)?;
    }
    super::super::campaign::wait_saved(model, cx).await?;
    let created = model
        .read_with(cx, |m, _| {
            m.engine
                .state()
                .sessions
                .values()
                .find(|s| s.name == "newsession")
                .map(|s| s.id)
        })
        .context("Keyboard session creation failed")?;
    // Page opening runs asynchronously. Restore browser focus after it finishes.
    cx.background_executor()
        .timer(std::time::Duration::from_millis(30))
        .await;
    window.update(cx, |_, window, cx| {
        let focus = panel.read(cx).focus.clone();
        window.focus(&focus, cx);
    })?;
    press(window, "n", cx)?;
    ensure!(panel.read_with(cx, |p, _| matches!(p.form.as_ref().map(|(kind, _)| kind), Some(Create::Encounter(id)) if *id == created)), "n did not create under the selected session");
    for stroke in ["a", "m", "b", "u", "s", "h", "enter"] {
        press(window, stroke, cx)?;
    }
    super::super::campaign::wait_saved(model, cx).await?;
    let encounter = model
        .read_with(cx, |m, _| {
            m.engine
                .state()
                .encounters
                .values()
                .find(|e| e.name == "ambush" && e.session == created)
                .cloned()
        })
        .context("Keyboard encounter creation failed")?;
    ensure!(
        encounter.participants.values().any(|p| p.persistent),
        "New encounter omitted the campaign roster"
    );
    cx.background_executor()
        .timer(std::time::Duration::from_millis(30))
        .await;
    ensure!(
        workspace.read_with(cx, |w, cx| w
            .items_of_type::<super::super::encounter::EncounterView>(cx)
            .any(|v| v.read(cx).encounter_id() == encounter.id)),
        "Created encounter did not open as a workspace tab"
    );
    println!(
        "Navigator rehearsal passed: keyboard session expansion, session creation, encounter creation under its selected parent, automatic roster inclusion and workspace-tab opening."
    );
    Ok(())
}
