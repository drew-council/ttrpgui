use super::{campaign::CampaignModel, navigator::Navigator};
use anyhow::{Context, ensure};
use campaign_documents::DocumentId;
use gpui::{AnyWindowHandle, AsyncApp, Entity, Focusable, Keystroke};
use workspace::Workspace;

pub async fn links(
    model: &Entity<CampaignModel>,
    workspace: &Entity<Workspace>,
    window: AnyWindowHandle,
    cx: &mut AsyncApp,
) -> anyhow::Result<()> {
    let (source, target, path) = model.read_with(cx, |m, _| {
        let source = *m
            .catalogue
            .documents
            .keys()
            .find(|id| matches!(id, DocumentId::Note(_)))
            .unwrap();
        let target = *m
            .catalogue
            .documents
            .keys()
            .find(|id| matches!(id, DocumentId::Session(_)))
            .unwrap();
        (
            source,
            target,
            m.store.root().join(&m.catalogue.documents[&source].path),
        )
    });
    let open = window.update(cx, |_, window, cx| {
        workspace.update(cx, |w, cx| {
            w.open_abs_path(path, Default::default(), window, cx)
        })
    })?;
    let item = open.await?;
    let editor = cx
        .update(|cx| item.act_as::<editor::Editor>(cx))
        .context("Notes did not open in an editor")?;
    window.update(cx, |_, window, cx| {
        editor.update(cx, |editor, cx| editor.set_text("", window, cx));
        window.focus(&editor.read(cx).focus_handle(cx), cx);
        window.refresh();
        let _ = window.draw(cx);
    })?;
    for key in ["i", "[", "["] {
        press(window, key, cx)?;
    }
    // Each window update finishes its effect cycle, allowing the deferred
    // completion callback to move focus to the native picker.
    window.update(cx, |_, window, cx| {
        let panel = workspace
            .read(cx)
            .panel::<Navigator>(cx)
            .context("Campaign navigator missing")?;
        ensure!(
            panel.read(cx).link_pending(),
            "Typing [[ did not invoke link completion"
        );
        window.refresh();
        let _ = window.draw(cx);
        Ok::<_, anyhow::Error>(())
    })??;
    for key in ["s", "e", "s", "s", "i", "o", "n", "space", "1", "enter"] {
        press(window, key, cx)?;
    }
    window.update(cx, |_, window, cx| {
        let expected = model
            .read(cx)
            .catalogue
            .relative_link(source, target, None)
            .unwrap();
        ensure!(
            editor.read(cx).text(cx) == expected,
            "Generated link differs: {:?}, expected {:?}",
            editor.read(cx).text(cx),
            expected
        );
        ensure!(
            editor.read(cx).focus_handle(cx).is_focused(window),
            "Link completion did not return focus to the source editor"
        );
        Ok::<_, anyhow::Error>(())
    })??;
    press(window, "escape", cx)?;
    press(window, "u", cx)?;
    window.update(cx, |_, _, cx| {
        ensure!(
            !editor.read(cx).text(cx).contains("sessions/"),
            "Vim undo did not undo generated link"
        );
        Ok::<_, anyhow::Error>(())
    })??;
    let target_text = "# Session 1\n\n## Preparation\n\nMeet Éowyn.\n";
    let target_path = model.read_with(cx, |m, _| {
        m.store.root().join(&m.catalogue.documents[&target].path)
    });
    std::fs::write(target_path, target_text)?;
    window.update(cx, |_, window, cx| {
        let link = model
            .read(cx)
            .catalogue
            .relative_link(source, target, Some("preparation"))
            .unwrap();
        editor.update(cx, |e, cx| {
            e.set_text(link, window, cx);
            let start = editor::MultiBufferOffset(0);
            e.change_selections(Default::default(), window, cx, |s| {
                s.select_ranges([start..start])
            });
        });
    })?;
    press(window, "ctrl-enter", cx)?;
    let mut reached = false;
    for _ in 0..100 {
        cx.background_executor()
            .timer(std::time::Duration::from_millis(20))
            .await;
        reached = window.update(cx, |_, window, cx| {
            use editor::ToOffset;
            workspace
                .read(cx)
                .items_of_type::<editor::Editor>(cx)
                .any(|entity| {
                    let e = entity.read(cx);
                    e.text(cx) == target_text
                        && e.focus_handle(cx).is_focused(window)
                        && e.selections
                            .newest_anchor()
                            .head()
                            .to_offset(&e.buffer().read(cx).snapshot(cx))
                            .0
                            == target_text.find("## Preparation").unwrap()
                })
        })?;
        if reached {
            break;
        }
    }
    ensure!(
        reached,
        "Ctrl-Enter did not open the linked page at its heading"
    );
    println!(
        "Link completion rehearsal passed: [[ invokes picker, aliases/name search inserts portable Markdown, focus returns to Vim, text undo works."
    );
    println!(
        "Link navigation rehearsal passed: Ctrl-Enter opens the normal document tab at the requested heading."
    );
    Ok(())
}

fn press(window: AnyWindowHandle, key: &str, cx: &mut AsyncApp) -> anyhow::Result<()> {
    window.update(cx, |_, window, cx| {
        window.dispatch_keystroke(Keystroke::parse(key).unwrap(), cx);
        window.refresh();
        let _ = window.draw(cx);
    })
}

pub async fn restore(
    workspace: &Entity<Workspace>,
    window: AnyWindowHandle,
    cx: &mut AsyncApp,
) -> anyhow::Result<()> {
    use super::encounter::EncounterView;
    use workspace::item::{Item, SerializableItem};
    let view = workspace
        .read_with(cx, |w, cx| w.item_of_type::<EncounterView>(cx))
        .context("Encounter view missing")?;
    let saved = window
        .update(cx, |_, window, cx| {
            workspace.update(cx, |w, cx| {
                view.update(cx, |v, cx| v.serialize(w, 90_000_001, false, window, cx))
            })
        })?
        .context("Workspace has no persistent identity")?;
    saved.await?;
    let restored = window
        .update(cx, |_, window, cx| {
            let w = workspace.read(cx);
            EncounterView::deserialize(
                w.project().clone(),
                workspace.downgrade(),
                w.database_id().unwrap(),
                90_000_001,
                window,
                cx,
            )
        })?
        .await?;
    window.update(cx, |_, _, cx| {
        ensure!(view != restored, "Restore reused the original view");
        ensure!(
            view.read(cx).tab_content_text(0, cx) == restored.read(cx).tab_content_text(0, cx),
            "Encounter identity did not restore"
        );
        ensure!(
            view.read(cx).selection_state() == restored.read(cx).selection_state(),
            "Encounter selection did not restore"
        );
        Ok::<_, anyhow::Error>(())
    })??;
    let cloned = window
        .update(cx, |_, window, cx| {
            view.update(cx, |v, cx| v.clone_on_split(None, window, cx))
        })?
        .await
        .context("Encounter did not split")?;
    window.update(cx, |_, _, cx| {
        ensure!(
            cloned != view && cloned.read(cx).focus_handle(cx) != view.read(cx).focus_handle(cx),
            "Split reused encounter focus state"
        );
        Ok::<_, anyhow::Error>(())
    })??;
    println!(
        "Workspace rehearsal passed: encounter tabs serialize/restore identity and selection, split views have independent focus."
    );
    Ok(())
}

pub async fn external_changes(
    model: &Entity<CampaignModel>,
    cx: &mut AsyncApp,
) -> anyhow::Result<()> {
    use campaign_domain::{Command, Note};
    let note = Note::new("External change rehearsal");
    let id = note.id;
    model.update(cx, |m, cx| {
        m.execute(Command::CreateNote(note), cx);
    });
    super::campaign::wait_saved(model, cx).await?;
    let root = model.read_with(cx, |m, _| m.store.root().to_path_buf());
    std::fs::write(
        root.join(format!("notes/{id}/notes.md")),
        "# Externally edited

Watcher rehearsal marker
",
    )?;
    let config = root.join("campaign.toml");
    let original = std::fs::read_to_string(&config)?;
    std::fs::write(
        &config,
        original.replace("My campaign", "External campaign"),
    )?;
    let mut reloaded = false;
    for _ in 0..100 {
        cx.background_executor()
            .timer(std::time::Duration::from_millis(20))
            .await;
        reloaded = model.read_with(cx, |m, _| {
            m.engine.state().config.name == "External campaign"
                && !m.index.search("Watcher rehearsal marker", 1).is_empty()
        });
        if reloaded {
            break;
        }
    }
    ensure!(
        reloaded,
        "Clean external metadata or closed Markdown did not reload"
    );
    let unsaved = Note::new("Unsaved conflict work");
    let unsaved_id = unsaved.id;
    model.update(cx, |m, _| {
        m.engine.execute(Command::CreateNote(unsaved)).unwrap();
        m.dirty = true;
    });
    std::fs::write(
        &config,
        original.replace("My campaign", "External conflicting campaign"),
    )?;
    let mut conflicted = false;
    for _ in 0..100 {
        cx.background_executor()
            .timer(std::time::Duration::from_millis(20))
            .await;
        conflicted = model.read_with(cx, |m, _| m.has_recovery && m.error.is_some());
        if conflicted {
            break;
        }
    }
    ensure!(
        conflicted,
        "External dirty conflict did not preserve recovery"
    );
    ensure!(
        std::fs::read_to_string(&config)?.contains("External conflicting campaign"),
        "Watcher overwrote external contents"
    );
    model.update(cx, |m, cx| m.restore_unsaved(cx));
    super::campaign::wait_saved(model, cx).await?;
    model.read_with(cx, |m, _| {
        ensure!(
            !m.dirty && m.error.is_none() && m.engine.state().notes.contains_key(&unsaved_id),
            "Explicit recovery did not restore unsaved work: {:?}",
            m.error
        );
        Ok::<_, anyhow::Error>(())
    })?;
    ensure!(
        root.join(".recovery").is_dir(),
        "Recovery did not back up external metadata"
    );
    println!(
        "External-change rehearsal passed: clean metadata reload, closed Markdown indexing, dirty conflict preservation and explicit recovery."
    );
    Ok(())
}
