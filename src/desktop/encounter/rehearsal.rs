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
    let _ = window.draw(cx);
    let press = |key: &str, window: &mut Window, cx: &mut App| {
        window.dispatch_keystroke(Keystroke::parse(key).unwrap(), cx);
        window.refresh();
        let _ = window.draw(cx);
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
    press("d", window, cx);
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
    let begin = std::time::Instant::now();
    for _ in 0..10 {
        window.refresh();
        let _ = window.draw(cx);
    }
    println!(
        "Campaign smoke test passed: 100 participants, keyboard selection, damage, undo/redo, stable initiative focus, field cancellation, queued automatic save. Ten headless layout frames: {:?}",
        begin.elapsed()
    );
    Ok(())
}
