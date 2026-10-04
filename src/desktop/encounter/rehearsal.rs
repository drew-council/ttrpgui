use super::*;

pub fn verify(
    model: &Entity<CampaignModel>,
    workspace: &Entity<Workspace>,
    window: &mut Window,
    cx: &mut App,
) -> anyhow::Result<()> {
    use anyhow::ensure;
    let session = *model
        .read(cx)
        .engine
        .state()
        .sessions
        .keys()
        .next()
        .unwrap();
    let encounter = EncounterId::new();
    let hero = Creature::new("Rehearsal hero", 20, None, CreatureKind::Persistent);
    let hero_id = hero.id;
    model.update(cx, |m, cx| {
        m.execute(Command::CreateCreature(hero), cx);
        m.execute(Command::SetRoster([hero_id].into()), cx);
        m.execute(
            Command::CreateEncounter {
                id: encounter,
                session,
                name: "Rehearsal".into(),
                location: None,
            },
            cx,
        );
        m.execute(
            Command::AddLocalCreature {
                encounter,
                creature: Creature::new("Goblin", 7, Some(13), CreatureKind::Template),
                quantity: 99,
                initiative: Some(10),
            },
            cx,
        );
        m.execute(Command::Start(encounter), cx);
    });
    ensure!(
        model.read(cx).error.is_none(),
        "Campaign setup failed: {:?}",
        model.read(cx).error
    );
    let view = cx.new(|cx| EncounterView::new(model.clone(), workspace.downgrade(), encounter, cx));
    workspace.update(cx, |w, cx| {
        w.add_item_to_active_pane(Box::new(view.clone()), None, true, window, cx)
    });
    window.focus(&view.read(cx).focus_handle(cx), cx);
    window.refresh();
    window.draw(cx).clear(cx);
    let press = |key: &str, window: &mut Window, cx: &mut App| {
        window.dispatch_keystroke(Keystroke::parse(key).unwrap(), cx);
        window.refresh();
        window.draw(cx).clear(cx);
    };
    press("space", window, cx);
    let target = view.read(cx).cursor.unwrap();
    ensure!(
        view.read(cx).selected.contains(&target),
        "Space did not select a participant"
    );
    press("-", window, cx);
    ensure!(
        view.read(cx).edit.is_some(),
        "Damage key did not open an anchored field"
    );
    let field = view.read(cx).edit.as_ref().unwrap().1.inputs[0].1.clone();
    field.update(cx, |e, cx| e.set_text("9", window, cx));
    press("enter", window, cx);
    ensure!(view.read(cx).edit.is_none(), "Enter did not submit field");
    ensure!(
        model.read(cx).engine.state().encounters[&encounter].participants[&target].hp == -2,
        "Damage did not use campaign transaction"
    );
    press("u", window, cx);
    ensure!(
        model.read(cx).engine.state().encounters[&encounter].participants[&target].hp == 7,
        "Encounter undo failed"
    );
    press("ctrl-r", window, cx);
    ensure!(
        model.read(cx).engine.state().encounters[&encounter].participants[&target].hp == -2,
        "Encounter redo failed"
    );
    press("i", window, cx);
    let field = view.read(cx).edit.as_ref().unwrap().1.inputs[0].1.clone();
    field.update(cx, |e, cx| e.set_text("30", window, cx));
    press("enter", window, cx);
    ensure!(
        view.read(cx).cursor == Some(target) && view.read(cx).selected.contains(&target),
        "Initiative sort lost focus or selection"
    );
    press("-", window, cx);
    let revision = model.read(cx).engine.revision();
    press("j", window, cx);
    ensure!(
        model.read(cx).engine.revision() == revision,
        "Typing in a field triggered a combat mutation"
    );
    press("escape", window, cx);
    ensure!(view.read(cx).edit.is_none(), "Escape did not cancel field");
    ensure!(
        model.read(cx).engine.revision() == revision,
        "Cancel committed a field"
    );
    press("escape", window, cx);
    ensure!(
        view.read(cx).selected.is_empty(),
        "Escape did not clear selection"
    );
    // Cursor movement is by participant identity in initiative order, wrapping
    // at both ends; g/G and Home/End jump to the first and last rows.
    let order = model.read(cx).engine.state().encounters[&encounter]
        .sorted_participants()
        .iter()
        .map(|p| p.id)
        .collect::<Vec<_>>();
    let (first, last) = (order[0], order[order.len() - 1]);
    for (key, expected, message) in [
        ("g", first, "g did not move to the first row"),
        ("k", last, "k did not wrap from the first to the last row"),
        ("j", first, "j did not wrap from the last to the first row"),
        ("j", order[1], "j did not move down one row"),
        ("shift-g", last, "G did not move to the last row"),
        ("home", first, "Home did not move to the first row"),
        ("end", last, "End did not move to the last row"),
        ("up", order[order.len() - 2], "Up did not move up one row"),
    ] {
        press(key, window, cx);
        ensure!(view.read(cx).cursor == Some(expected), "{message}");
    }
    press("space", window, cx);
    press("down", window, cx);
    press("space", window, cx);
    ensure!(
        view.read(cx).selected == [order[order.len() - 2], last].into(),
        "Space did not build an explicit two-row selection"
    );
    press("space", window, cx);
    ensure!(
        view.read(cx).selected == [order[order.len() - 2]].into(),
        "Space did not toggle the cursor row out of the selection"
    );
    press("escape", window, cx);
    ensure!(
        view.read(cx).selected.is_empty(),
        "Escape did not clear the selection"
    );
    let wolf = Creature::new("Wolf", 11, Some(13), CreatureKind::Template);
    model.update(cx, |m, cx| {
        m.execute(Command::CreateCreature(wolf), cx);
    });
    press("a", window, cx);
    ensure!(view.read(cx).library, "Add did not open the library picker");
    for key in ["w", "o", "l", "f", "enter"] {
        press(key, window, cx);
    }
    ensure!(
        matches!(
            view.read(cx).edit.as_ref().map(|(edit, _)| edit),
            Some(Edit::Add(_))
        ),
        "Library search did not choose Wolf"
    );
    let fields = &view.read(cx).edit.as_ref().unwrap().1;
    let quantity = fields.inputs[0].1.clone();
    let initiative = fields.inputs[1].1.clone();
    quantity.update(cx, |e, cx| e.set_text("2", window, cx));
    initiative.update(cx, |e, cx| e.set_text("18", window, cx));
    press("enter", window, cx);
    let copies = model.read(cx).engine.state().encounters[&encounter]
        .participants
        .values()
        .filter(|p| p.name == "Wolf")
        .collect::<Vec<_>>();
    ensure!(
        copies.len() == 2
            && copies[0].id != copies[1].id
            && copies.iter().all(|p| p.initiative == Some(18)),
        "Library quantity did not create independent copies with initiative"
    );
    press("u", window, cx);
    ensure!(
        model.read(cx).engine.state().encounters[&encounter]
            .participants
            .len()
            == 100,
        "Library insertion was not one undoable action"
    );
    press("shift-f10", window, cx);
    ensure!(
        view.read(cx).context_menu.is_some(),
        "Keyboard context menu did not open"
    );
    press("escape", window, cx);
    println!(
        "Library rehearsal passed: fuzzy picker, quantity, initiative, independent copies and single undo; keyboard context menu opens."
    );
    ensure!(
        model.read(cx).error.is_none(),
        "Rehearsal reported a persistence error"
    );
    println!(
        "Campaign smoke test passed: 100 participants, keyboard selection, damage, undo/redo, stable initiative focus, field cancellation and queued automatic save."
    );
    Ok(())
}

/// Yield to GPUI between field creation and typing, so upstream Vim observers
/// install the draft's addon just as they do in a real event loop.
pub async fn verify_description(
    model: &Entity<CampaignModel>,
    workspace: &Entity<Workspace>,
    window: AnyWindowHandle,
    cx: &mut AsyncApp,
) -> anyhow::Result<()> {
    use crate::desktop::rehearsal::press as key;
    use anyhow::{Context, ensure};
    let view = workspace
        .read_with(cx, |w, cx| w.item_of_type::<EncounterView>(cx))
        .context("Description rehearsal needs an encounter")?;
    let encounter = view.read_with(cx, |v, _| v.id);
    let (targets, first, draft) = window.update(cx, |_, window, cx| {
        let targets = model.read(cx).engine.state().encounters[&encounter]
            .sorted_participants()
            .into_iter()
            .take(2)
            .map(|p| p.id)
            .collect::<BTreeSet<_>>();
        let first = model.read(cx).engine.state().encounters[&encounter]
            .sorted_participants()
            .into_iter()
            .find(|p| targets.contains(&p.id))
            .unwrap()
            .id;
        model.update(cx, |m, cx| {
            m.execute(
                Command::SetDescription {
                    encounter,
                    participants: [first].into(),
                    description: "First line\nSecond line".into(),
                },
                cx,
            );
        });
        let draft = view.update(cx, |v, cx| {
            v.selected = targets.clone();
            v.cursor = targets.iter().copied().find(|id| *id != first);
            v.begin(Edit::Description, window, cx);
            v.edit.as_ref().unwrap().1.inputs[0].1.clone()
        });
        (targets, first, draft)
    })?;
    cx.background_executor()
        .timer(std::time::Duration::from_millis(20))
        .await;
    ensure!(
        draft.read_with(cx, |e, cx| e.text(cx)) == "First line\nSecond line",
        "Bulk description did not prefill the first selected row"
    );
    let revision = model.read_with(cx, |m, _| m.engine.revision());
    for stroke in ["i", "x", "enter", "y", "escape"] {
        key(window, stroke, cx)?;
    }
    ensure!(
        view.read_with(cx, |v, _| v.edit.is_some()),
        "Insert-mode Escape cancelled the description draft"
    );
    ensure!(
        draft.read_with(cx, |e, cx| e.text(cx)).contains("x\ny"),
        "Insert-mode Enter did not enter a newline"
    );
    key(window, "u", cx)?;
    ensure!(
        draft.read_with(cx, |e, cx| e.text(cx)) == "First line\nSecond line",
        "Vim draft undo failed"
    );
    ensure!(
        model.read_with(cx, |m, _| m.engine.revision()) == revision,
        "Draft typing or undo changed encounter state"
    );
    window.update(cx, |_, window, cx| {
        draft.update(cx, |e, cx| {
            e.set_text("Shared\nencounter notes", window, cx)
        })
    })?;
    key(window, "enter", cx)?;
    ensure!(
        view.read_with(cx, |v, _| v.edit.is_none())
            && model.read_with(cx, |m, _| targets.iter().all(|id| m
                .engine
                .state()
                .encounters[&encounter]
                .participants[id]
                .description
                == "Shared\nencounter notes")),
        "Description did not commit to all selected participants"
    );
    key(window, "u", cx)?;
    ensure!(
        model.read_with(cx, |m, _| m.engine.state().encounters[&encounter]
            .participants[&first]
            .description
            .clone())
            == "First line\nSecond line",
        "Bulk description was not one undoable mutation"
    );
    key(window, "escape", cx)?;
    key(window, "r", cx)?;
    ensure!(
        view.read_with(cx, |v, _| matches!(
            v.edit.as_ref().map(|(edit, _)| edit),
            Some(Edit::Rename)
        )),
        "Rename shortcut did not open its field"
    );
    key(window, "escape", cx)?;
    key(window, "n", cx)?;
    ensure!(
        view.read_with(cx, |v, _| matches!(
            v.edit.as_ref().map(|(edit, _)| edit),
            Some(Edit::Local)
        )),
        "Create shortcut did not open creature creation"
    );
    key(window, "escape", cx)?;
    println!(
        "Description rehearsal passed: multiline Vim input, draft undo, mode-aware Escape, first-selected prefill and one-step bulk commit/undo; n/r shortcuts retained."
    );
    Ok(())
}
