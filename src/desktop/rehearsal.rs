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
        window.draw(cx).clear(cx);
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
        window.draw(cx).clear(cx);
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

pub(super) fn press(window: AnyWindowHandle, key: &str, cx: &mut AsyncApp) -> anyhow::Result<()> {
    window.update(cx, |_, window, cx| {
        window.dispatch_keystroke(Keystroke::parse(key).unwrap(), cx);
        window.refresh();
        window.draw(cx).clear(cx);
    })
}

#[derive(Debug, PartialEq, serde::Serialize, serde::Deserialize)]
struct SessionPane {
    bounds: Option<(f32, f32, f32, f32)>,
    items: Vec<String>,
    active_item: usize,
    focused: bool,
    cursor: Option<usize>,
    scroll: Option<(f64, f64)>,
    text: Option<String>,
}

fn session_snapshot(
    workspace: &Entity<Workspace>,
    window: &mut gpui::Window,
    cx: &mut gpui::App,
) -> Vec<SessionPane> {
    use editor::ToOffset;
    let panes = workspace.read(cx).panes().to_vec();
    panes
        .iter()
        .map(|pane| {
            let bounds = workspace.read(cx).bounding_box_for_pane(pane).map(|b| {
                (
                    f32::from(b.origin.x),
                    f32::from(b.origin.y),
                    f32::from(b.size.width),
                    f32::from(b.size.height),
                )
            });
            let pane = pane.read(cx);
            let items = pane
                .items()
                .map(|item| {
                    if let Some(editor) = item.act_as::<editor::Editor>(cx) {
                        editor
                            .read(cx)
                            .buffer()
                            .read(cx)
                            .as_singleton()
                            .and_then(|buffer| {
                                buffer
                                    .read(cx)
                                    .file()
                                    .and_then(|f| f.as_local())
                                    .map(|f| f.abs_path(cx).display().to_string())
                            })
                            .unwrap_or_else(|| "untitled".into())
                    } else if let Some(encounter) =
                        item.act_as::<super::encounter::EncounterView>(cx)
                    {
                        format!("encounter/{}", encounter.read(cx).encounter_id())
                    } else {
                        item.tab_content_text(0, cx).to_string()
                    }
                })
                .collect();
            let editor = pane
                .active_item()
                .and_then(|item| item.act_as::<editor::Editor>(cx));
            let active_item = pane.active_item_index();
            let focused = pane.has_focus(window, cx);
            let (cursor, scroll, text) = if let Some(editor) = editor {
                editor.update(cx, |e, cx| {
                    let cursor = e
                        .selections
                        .newest_anchor()
                        .head()
                        .to_offset(&e.buffer().read(cx).snapshot(cx))
                        .0;
                    let scroll = e.scroll_position(cx);
                    (Some(cursor), Some((scroll.x, scroll.y)), Some(e.text(cx)))
                })
            } else {
                (None, None, None)
            };
            SessionPane {
                bounds,
                items,
                active_item,
                focused,
                cursor,
                scroll,
                text,
            }
        })
        .collect()
}

/// Run in two separate headless application processes against one isolated
/// data directory. The second process must restore the first one's layout.
pub async fn session(
    restoring: bool,
    model: &Entity<CampaignModel>,
    workspace: &Entity<Workspace>,
    window: AnyWindowHandle,
    cx: &mut AsyncApp,
) -> anyhow::Result<()> {
    let snapshot_path = model.read_with(cx, |m, _| {
        m.store
            .root()
            .parent()
            .unwrap()
            .join("expected-session.json")
    });
    if restoring {
        // Editor cursor/scroll restoration can finish after the workspace opens.
        let expected: Vec<SessionPane> = serde_json::from_slice(&std::fs::read(snapshot_path)?)?;
        let mut restored = false;
        let mut actual = Vec::new();
        for _ in 0..100 {
            cx.background_executor()
                .timer(std::time::Duration::from_millis(20))
                .await;
            actual = window.update(cx, |_, window, cx| {
                window.refresh();
                window.draw(cx).clear(cx);
                session_snapshot(workspace, window, cx)
            })?;
            if actual == expected {
                restored = true;
                break;
            }
        }
        if !restored {
            let concise = |mut panes: Vec<SessionPane>| {
                for pane in &mut panes {
                    pane.text = pane.text.take().map(|text| format!("{} bytes", text.len()));
                }
                panes
            };
            anyhow::bail!(
                "Restart did not restore tabs, pane bounds, focus, cursor, scroll and text.\nExpected: {:#?}\nActual: {:#?}",
                concise(expected),
                concise(actual)
            );
        }
        let buffers = workspace.read_with(cx, |w, cx| {
            w.items_of_type::<editor::Editor>(cx)
                .filter_map(|e| e.read(cx).buffer().read(cx).as_singleton())
                .collect::<Vec<_>>()
        });
        ensure!(
            buffers
                .iter()
                .filter(|b| **b == *buffers.last().unwrap())
                .count()
                == 3,
            "Restored splits no longer share one document buffer"
        );
        println!(
            "Session restart rehearsal passed: three panes, tabs, active items, focus, independent cursors/scroll, dirty text and shared buffers restored in a new process."
        );
        return Ok(());
    }
    window.update(cx, |_, window, cx| {
        super::encounter::verify(model, workspace, window, cx)
    })??;
    super::campaign::wait_saved(model, cx).await?;
    let paths = model.read_with(cx, |m, _| {
        m.catalogue
            .documents
            .values()
            .filter(|d| matches!(d.id, DocumentId::Note(_) | DocumentId::Session(_)))
            .map(|d| m.store.root().join(&d.path))
            .collect::<Vec<_>>()
    });
    for path in paths {
        window
            .update(cx, |_, window, cx| {
                workspace.update(cx, |w, cx| {
                    w.open_abs_path(path, Default::default(), window, cx)
                })
            })?
            .await?;
    }
    window.update(cx, |_, window, cx| {
        let editor = workspace
            .read(cx)
            .active_item_as::<editor::Editor>(cx)
            .unwrap();
        editor.update(cx, |e, cx| {
            e.set_text(
                (0..80)
                    .map(|i| format!("Line {i}: Éowyn and the archive\n"))
                    .collect::<String>(),
                window,
                cx,
            )
        });
    })?;
    for direction in [
        workspace::SplitDirection::Right,
        workspace::SplitDirection::Down,
    ] {
        let split = window.update(cx, |_, window, cx| {
            workspace.update(cx, |w, cx| {
                w.split_and_clone(w.active_pane().clone(), direction, window, cx)
            })
        })?;
        let pane = split
            .await
            .context("Session rehearsal could not split the document")?;
        window.update(cx, |_, window, cx| {
            let editor = pane
                .read(cx)
                .active_item()
                .unwrap()
                .act_as::<editor::Editor>(cx)
                .unwrap();
            window.focus(&editor.read(cx).focus_handle(cx), cx);
        })?;
    }
    let panes = workspace.read_with(cx, |w, _| w.panes().to_vec());
    for (index, pane) in panes.iter().enumerate() {
        window.update(cx, |_, window, cx| {
            let editor = pane
                .read(cx)
                .active_item()
                .unwrap()
                .act_as::<editor::Editor>(cx)
                .unwrap();
            editor.update(cx, |e, cx| {
                let offset = editor::MultiBufferOffset(100 + index * 30);
                e.change_selections(editor::SelectionEffects::no_scroll(), window, cx, |s| {
                    s.select_ranges([offset..offset])
                });
                e.set_scroll_position(gpui::point(0., (index * 3) as f64), window, cx);
            });
        })?;
    }
    // Complete focus effects and draw before taking the expected snapshot.
    cx.background_executor()
        .timer(std::time::Duration::from_millis(30))
        .await;
    let expected = window.update(cx, |_, window, cx| {
        window.refresh();
        window.draw(cx).clear(cx);
        session_snapshot(workspace, window, cx)
    })?;
    ensure!(
        expected.len() == 3 && expected.iter().filter(|p| p.focused).count() == 1,
        "Session rehearsal did not establish three panes and one focused pane"
    );
    let left = expected[0].bounds.context("Missing first pane bounds")?;
    let upper = expected[1].bounds.context("Missing second pane bounds")?;
    let lower = expected[2].bounds.context("Missing third pane bounds")?;
    ensure!(
        left.0 < upper.0 && upper.0 == lower.0 && upper.1 < lower.1,
        "Session rehearsal did not establish horizontal and vertical splits"
    );
    std::fs::write(snapshot_path, serde_json::to_vec_pretty(&expected)?)?;
    // Ctrl-Shift-Q exercises the real application quit handler; it must save text
    // and flush workspace serialization before exiting.
    println!(
        "Session restart preparation passed; quitting through Ctrl-Shift-Q with pending document changes."
    );
    Ok(())
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
    super::campaign::wait_saved(model, cx).await?;
    model.read_with(cx, |m, _| {
        ensure!(!m.has_recovery, "Clean reload invented a recovery copy");
        Ok::<_, anyhow::Error>(())
    })?;
    // Write a new page wholly outside the application. Its prose can arrive
    // before its identity; both must become visible after metadata reload.
    let external = Note::new("Externally added page");
    let external_id = DocumentId::Note(external.id);
    let external_directory = root.join(format!("notes/{}", external.id));
    std::fs::create_dir_all(&external_directory)?;
    std::fs::write(
        external_directory.join("notes.md"),
        "# Outside\n\nExternal addition marker\n",
    )?;
    std::fs::write(
        external_directory.join("metadata.toml"),
        format!(
            "id = \"{}\"\nname = \"Externally added page\"\n",
            external.id
        ),
    )?;
    let mut added = false;
    for _ in 0..100 {
        cx.background_executor()
            .timer(std::time::Duration::from_millis(20))
            .await;
        added = model.read_with(cx, |m, _| {
            m.catalogue.documents.contains_key(&external_id)
                && m.index
                    .search("External addition marker", 1)
                    .first()
                    .is_some_and(|hit| hit.document == external_id)
        });
        if added {
            break;
        }
    }
    ensure!(
        added,
        "Externally added page was not catalogued and indexed"
    );
    std::fs::remove_dir_all(&external_directory)?;
    let mut removed = false;
    for _ in 0..100 {
        cx.background_executor()
            .timer(std::time::Duration::from_millis(20))
            .await;
        removed = model.read_with(cx, |m, _| {
            !m.catalogue.documents.contains_key(&external_id)
                && m.index.search("External addition marker", 1).is_empty()
        });
        if removed {
            break;
        }
    }
    ensure!(
        removed,
        "Deleted external page remained in catalogue/search"
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
        "External-change rehearsal passed: clean metadata reload, closed Markdown indexing, external page addition/deletion, dirty conflict preservation and explicit recovery."
    );
    Ok(())
}

pub async fn rename_links(
    model: &Entity<CampaignModel>,
    workspace: &Entity<Workspace>,
    window: AnyWindowHandle,
    cx: &mut AsyncApp,
) -> anyhow::Result<()> {
    use campaign_domain::{Command, Note};
    let open_note = Note::new("Open rename source");
    let closed_note = Note::new("Closed rename source");
    let (open_id, closed_id) = (
        DocumentId::Note(open_note.id),
        DocumentId::Note(closed_note.id),
    );
    let mut session = model.read_with(cx, |m, _| {
        m.engine.state().sessions.values().next().unwrap().clone()
    });
    let original = session.name.clone();
    let target = DocumentId::Session(session.id);
    model.update(cx, |m, cx| {
        m.execute(Command::CreateNote(open_note), cx);
        m.execute(Command::CreateNote(closed_note), cx);
    });
    super::campaign::wait_saved(model, cx).await?;
    let (root, open_path, closed_path, relative) = model.read_with(cx, |m, _| {
        (
            m.store.root().to_path_buf(),
            m.catalogue.documents[&open_id].path.clone(),
            m.catalogue.documents[&closed_id].path.clone(),
            m.catalogue
                .relative_link(open_id, target, Some("heading"))
                .unwrap(),
        )
    });
    let source = format!("[[{original}]] [[{original}|custom label]]\n{relative}\n");
    model
        .read_with(cx, |m, _| {
            m.store.edit_documents(
                [
                    (
                        open_path.to_string_lossy().into_owned(),
                        (String::new(), source.clone()),
                    ),
                    (
                        closed_path.to_string_lossy().into_owned(),
                        (String::new(), source.clone()),
                    ),
                ]
                .into(),
            )
        })
        .await?;
    let item = window
        .update(cx, |_, window, cx| {
            workspace.update(cx, |w, cx| {
                w.open_abs_path(root.join(&open_path), Default::default(), window, cx)
            })
        })?
        .await?;
    let editor = cx
        .update(|cx| item.act_as::<editor::Editor>(cx))
        .context("Rename source was not an editor")?;
    session.name = "Renamed session".into();
    session.aliases.push(original.clone());
    model.update(cx, |m, cx| {
        m.execute(Command::UpdateSession(session), cx);
    });
    super::campaign::wait_saved(model, cx).await?;
    let revised = source.replace(&format!("[[{original}"), "[[Renamed session");
    ensure!(
        editor.read_with(cx, |e, cx| e.text(cx)) == revised,
        "Rename failed to update open wiki links while retaining labels/headings"
    );
    ensure!(
        std::fs::read_to_string(root.join(&closed_path))? == revised,
        "Rename failed to update closed wiki links"
    );
    model.update(cx, |m, cx| m.undo(cx));
    super::campaign::wait_saved(model, cx).await?;
    ensure!(
        editor.read_with(cx, |e, cx| e.text(cx)) == source
            && std::fs::read_to_string(root.join(&closed_path))? == source,
        "Undoing a rename broke open or closed links"
    );
    model.update(cx, |m, cx| m.redo(cx));
    super::campaign::wait_saved(model, cx).await?;
    ensure!(
        editor.read_with(cx, |e, cx| e.text(cx)) == revised
            && std::fs::read_to_string(root.join(&closed_path))? == revised,
        "Redoing a rename broke open or closed links"
    );
    model.update(cx, |m, cx| m.undo(cx));
    super::campaign::wait_saved(model, cx).await?;
    println!(
        "Rename rehearsal passed: open-buffer transactions, closed-file journal, wiki labels, portable relative links/headings, structured undo and redo preserve link identity."
    );
    Ok(())
}

/// Optional native supervisor probe; never used by normal campaign sessions.
/// Inspect the actual parser and presentation, not just a first-frame message.
pub async fn native_note(
    workspace: &Entity<Workspace>,
    window: AnyWindowHandle,
    cx: &mut AsyncApp,
) -> anyhow::Result<()> {
    let started = std::time::Instant::now();
    let mut editor = None;
    for _ in 0..100 {
        editor = workspace.read_with(cx, |w, cx| w.active_item_as::<editor::Editor>(cx));
        if editor.is_some() {
            break;
        }
        cx.background_executor()
            .timer(std::time::Duration::from_millis(20))
            .await;
    }
    let Some(editor) = editor else {
        return Ok(());
    }; // Combat scenario.
    let buffer = editor
        .read_with(cx, |e, cx| e.buffer().read(cx).as_singleton())
        .context("Native document has no buffer")?;
    eprintln!(
        "Native editor check waiting: {} bytes, parsing={:?}",
        buffer.read_with(cx, |b, _| b.len()),
        buffer.read_with(cx, |b, _| *b.parse_status().borrow())
    );
    buffer.read_with(cx, |b, _| b.parsing_idle()).await;
    cx.background_executor()
        .timer(std::time::Duration::from_millis(20))
        .await;
    let (language, layers, presentation) = window.update(cx, |_, window, cx| {
        window.refresh();
        window.draw(cx).clear(cx);
        let buffer = buffer.read(cx);
        (
            buffer.language().map(|l| l.name()),
            buffer.snapshot().syntax_layers().count(),
            markdown_live_preview::presentation_status(editor.read(cx), cx),
        )
    })?;
    let presentation = presentation.context("Native Markdown addon missing")?;
    ensure!(
        language.as_ref().is_some_and(|l| l.as_ref() == "Markdown")
            && layers > 0
            && presentation.enabled
            && presentation.rendered_blocks > 0
            && presentation.inline_markers > 0,
        "Native document did not receive parsed live Markdown: language={language:?}, layers={layers}, presentation={presentation:?}"
    );
    println!(
        "Native editor check passed: parsed live Markdown, {} rendered blocks and {} inline markers; ready after {:?}.",
        presentation.rendered_blocks,
        presentation.inline_markers,
        started.elapsed()
    );
    let mut frames = Vec::new();
    for index in 0..24 {
        let start = std::time::Instant::now();
        press(window, if index % 2 == 0 { "j" } else { "k" }, cx)?;
        let elapsed = start.elapsed().as_secs_f64() * 1000.;
        frames.push(elapsed);
        eprintln!("Native note motion {index}: {elapsed:.2} ms");
        cx.background_executor()
            .timer(std::time::Duration::from_millis(16))
            .await;
    }
    frames.sort_by(f64::total_cmp);
    println!(
        "Native note interaction timing: 24 Vim motions + CPU frame construction, median={:.2} ms, p95={:.2} ms, max={:.2} ms; private software compositor; excludes presentation latency.",
        frames[12], frames[22], frames[23]
    );
    if std::env::var_os("TTRPGUI_CHECK_PERFORMANCE").is_some() {
        ensure!(
            frames[22] < 1000. / 60.,
            "Large-note Vim frame p95 exceeded the 60 Hz CPU budget: {:.2} ms",
            frames[22]
        );
    }
    println!("Native note probe completed successfully.");
    Ok(())
}
