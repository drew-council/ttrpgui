use super::*;
use crate::desktop::{campaign::wait_saved, rehearsal::press};
use anyhow::{Context as _, ensure};

fn focus(
    view: &Entity<EncounterView>,
    workspace: &Entity<Workspace>,
    window: AnyWindowHandle,
    cx: &mut AsyncApp,
) -> anyhow::Result<()> {
    window.update(cx, |_, window, cx| {
        workspace.update(cx, |w, cx| {
            w.add_item_to_active_pane(Box::new(view.clone()), None, true, window, cx)
        });
        let focus = view.read(cx).focus.clone();
        window.focus(&focus, cx);
        window.refresh();
        window.draw(cx).clear(cx);
    })?;
    Ok(())
}

/// Continues the navigator's real keyboard creation route. All mutations below
/// are dispatched through focused controls, not directly into the domain.
pub async fn verify_session(
    model: &Entity<CampaignModel>,
    workspace: &Entity<Workspace>,
    window: AnyWindowHandle,
    cx: &mut AsyncApp,
) -> anyhow::Result<()> {
    let (active, encounter, hero) = model.read_with(cx, |m, _| {
        let state = m.engine.state();
        (
            state.active_encounter().map(|e| e.id),
            state
                .encounters
                .values()
                .find(|e| e.name == "ambush")
                .map(|e| e.id),
            state
                .creatures
                .values()
                .find(|c| c.kind == CreatureKind::Persistent)
                .map(|c| c.id),
        )
    });
    let encounter = encounter.context("Navigator did not create the session encounter")?;
    let hero = hero.context("Campaign roster has no persistent character")?;
    let views = workspace.read_with(cx, |w, cx| {
        w.items_of_type::<EncounterView>(cx).collect::<Vec<_>>()
    });
    if let Some(active) = active {
        let old = views
            .iter()
            .find(|v| v.read_with(cx, |v, _| v.id) == active)
            .context("Active encounter tab missing")?;
        focus(old, workspace, window, cx)?;
        press(window, "ctrl-shift-c", cx)?;
    }
    let view = views
        .into_iter()
        .find(|v| v.read_with(cx, |v, _| v.id) == encounter)
        .context("New encounter tab missing")?;
    focus(&view, workspace, window, cx)?;
    press(window, "ctrl-shift-s", cx)?;
    ensure!(
        model.read_with(cx, |m, _| m.engine.state().encounters[&encounter].status
            == EncounterStatus::Active),
        "Start shortcut failed"
    );
    for key in [
        "a", "ctrl-n", "s", "c", "o", "u", "t", "tab", "ctrl-a", "9", "tab", "tab", "ctrl-a", "2",
        "tab", "1", "2", "enter",
    ] {
        press(window, key, cx)?;
    }
    let copies = model.read_with(cx, |m, _| {
        m.engine.state().encounters[&encounter]
            .participants
            .values()
            .filter(|p| p.name == "scout")
            .map(|p| p.id)
            .collect::<BTreeSet<_>>()
    });
    ensure!(
        copies.len() == 2,
        "Keyboard local-creature quantity did not create independent copies"
    );
    for key in [
        "home", "space", "j", "space", "i", "ctrl-a", "1", "7", "enter",
    ] {
        press(window, key, cx)?;
    }
    let cursor = view.read_with(cx, |v, _| v.cursor);
    ensure!(
        view.read_with(cx, |v, _| v.selected == copies),
        "Keyboard bulk selection did not select both copies"
    );
    ensure!(
        model.read_with(cx, |m, _| copies.iter().all(|id| m
            .engine
            .state()
            .encounters[&encounter]
            .participants[id]
            .initiative
            == Some(17))),
        "Bulk initiative failed"
    );
    press(window, "u", cx)?;
    ensure!(
        model.read_with(cx, |m, _| copies.iter().all(|id| m
            .engine
            .state()
            .encounters[&encounter]
            .participants[id]
            .initiative
            == Some(12))),
        "Bulk initiative was not one undo step"
    );
    press(window, "ctrl-r", cx)?;
    ensure!(
        view.read_with(cx, |v, _| v.cursor == cursor && v.selected == copies),
        "Reordering lost cursor/selection identity"
    );
    for key in ["-", "ctrl-a", "1", "1", "enter"] {
        press(window, key, cx)?;
    }
    ensure!(
        model.read_with(cx, |m, _| copies.iter().all(|id| m
            .engine
            .state()
            .encounters[&encounter]
            .participants[id]
            .hp
            == -2)),
        "Bulk damage did not permit negative HP"
    );
    press(window, "ctrl-shift-h", cx)?;
    ensure!(
        model.read_with(cx, |m, _| copies.iter().all(|id| m
            .engine
            .state()
            .encounters[&encounter]
            .participants[id]
            .hp
            == 9)),
        "Bulk reset failed"
    );
    press(window, "u", cx)?;
    ensure!(
        model.read_with(cx, |m, _| copies.iter().all(|id| m
            .engine
            .state()
            .encounters[&encounter]
            .participants[id]
            .hp
            == -2)),
        "Bulk reset was not undoable"
    );
    press(window, "ctrl-r", cx)?;
    for key in [
        "escape",
        "r",
        "ctrl-a",
        "l",
        "e",
        "a",
        "d",
        "e",
        "r",
        "enter",
        "ctrl-shift-l",
    ] {
        press(window, key, cx)?;
    }
    let local = cursor.context("Local creature cursor missing")?;
    let definition = model
        .read_with(cx, |m, _| {
            m.engine.state().encounters[&encounter].participants[&local].creature
        })
        .context("Save-to-library shortcut failed")?;
    ensure!(
        model.read_with(cx, |m, _| m.engine.state().creatures[&definition].name
            == "leader"),
        "Rename or library definition failed"
    );
    for key in [
        "a", "l", "e", "a", "d", "e", "r", "enter", "ctrl-a", "2", "tab", "2", "0", "enter",
    ] {
        press(window, key, cx)?;
    }
    ensure!(
        model.read_with(cx, |m, _| m.engine.state().encounters[&encounter]
            .participants
            .values()
            .filter(|p| p.creature == Some(definition))
            .count()
            == 3),
        "Library quantity entry failed"
    );
    for key in ["end", "-", "ctrl-a", "5", "enter"] {
        press(window, key, cx)?;
    }
    let carried = model.read_with(cx, |m, _| m.engine.state().character_hp[&hero]);
    ensure!(
        carried == 15,
        "Persistent character health did not update through the field"
    );
    press(window, "ctrl-shift-c", cx)?;
    let snapshot = model.read_with(cx, |m, _| m.engine.state().encounters[&encounter].clone());
    // Reuse the browser route for the next encounter under the same session.
    let navigator = workspace
        .read_with(cx, |w, cx| {
            w.panel::<crate::desktop::navigator::Navigator>(cx)
        })
        .context("Navigator missing")?;
    window.update(cx, |_, window, cx| {
        navigator.update(cx, |p, cx| p.focus_session(snapshot.session, window, cx))
    })?;
    for key in ["n", "n", "e", "x", "t", "enter"] {
        press(window, key, cx)?;
    }
    wait_saved(model, cx).await?;
    cx.background_executor()
        .timer(std::time::Duration::from_millis(30))
        .await;
    let next = workspace
        .read_with(cx, |w, cx| w.active_item_as::<EncounterView>(cx))
        .context("Next encounter did not open")?;
    let next_id = next.read_with(cx, |v, _| v.id);
    ensure!(
        next_id != encounter,
        "Creation reopened the completed encounter"
    );
    focus(&next, workspace, window, cx)?;
    press(window, "ctrl-shift-s", cx)?;
    ensure!(
        model.read_with(cx, |m, _| m.engine.state().encounters[&next_id]
            .participants
            .values()
            .any(|p| p.creature == Some(hero) && p.hp == carried)),
        "Next encounter did not resolve persistent HP"
    );
    focus(&view, workspace, window, cx)?;
    // Editing keys on history explain why instead of opening fields.
    for key in ["end", "-", "i", "a"] {
        press(window, key, cx)?;
    }
    ensure!(
        view.read_with(cx, |v, _| v.edit.is_none()
            && !v.library
            && v.error
                .as_deref()
                .is_some_and(|e| e.contains("historical snapshots"))),
        "Completed encounter offered an edit instead of explaining it is history"
    );
    ensure!(
        model.read_with(cx, |m, _| m.engine.state().character_hp[&hero] == carried
            && m.engine.state().encounters[&encounter] == snapshot),
        "Viewing history changed current character HP or snapshot"
    );
    focus(&next, workspace, window, cx)?;
    press(window, "ctrl-shift-c", cx)?;
    wait_saved(model, cx).await?;
    println!(
        "Keyboard session rehearsal passed: creation, start, local/library copies, bulk initiative/damage/reset and undo, rename, completion, next-encounter persistent HP, immutable history and refused edits on completed encounters."
    );
    Ok(())
}
