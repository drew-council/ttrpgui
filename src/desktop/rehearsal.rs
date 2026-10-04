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

/// A dirty open page changed on disk keeps both versions through Zed's buffer
/// conflict state, is reported, survives autosave, and resolves by keyboard
/// through the themed in-window prompt.
pub async fn prose_conflict(
    model: &Entity<CampaignModel>,
    workspace: &Entity<Workspace>,
    window: AnyWindowHandle,
    cx: &mut AsyncApp,
) -> anyhow::Result<()> {
    use campaign_domain::{Command, Note};
    let note = Note::new("Conflict rehearsal");
    let id = DocumentId::Note(note.id);
    model.update(cx, |m, cx| m.execute(Command::CreateNote(note), cx));
    super::campaign::wait_saved(model, cx).await?;
    let path = model.read_with(cx, |m, _| {
        m.store.root().join(&m.catalogue.documents[&id].path)
    });
    std::fs::write(&path, "# Disk\n")?;
    let item = window
        .update(cx, |_, window, cx| {
            workspace.update(cx, |w, cx| {
                w.open_abs_path(path.clone(), Default::default(), window, cx)
            })
        })?
        .await?;
    let editor = cx
        .update(|cx| item.act_as::<editor::Editor>(cx))
        .context("Conflict page did not open in an editor")?;
    let buffer = editor
        .read_with(cx, |e, cx| e.buffer().read(cx).as_singleton())
        .context("Conflict page has no buffer")?;
    let wait = async |cx: &mut AsyncApp, condition: &dyn Fn(&mut AsyncApp) -> bool| {
        for _ in 0..300 {
            if condition(cx) {
                return true;
            }
            cx.background_executor()
                .timer(std::time::Duration::from_millis(10))
                .await;
        }
        condition(cx)
    };
    let text = |cx: &mut AsyncApp| editor.read_with(cx, |e, cx| e.text(cx));
    let disk = || std::fs::read_to_string(&path).unwrap_or_default();

    for (round, keys, keep_local) in [(0, &["enter"][..], true), (1, &["l", "enter"][..], false)] {
        let local = format!("# Local {round}\n\nUnsaved edit\n");
        let external = format!("# External {round}\n\nOutside edit\n");
        window.update(cx, |_, window, cx| {
            window.focus(&editor.focus_handle(cx), cx);
            editor.update(cx, |e, cx| e.set_text(local.as_str(), window, cx));
        })?;
        // Write before autosave (750 ms) can save the local edit.
        std::fs::write(&path, &external)?;
        ensure!(
            wait(cx, &|cx| buffer.read_with(cx, |b, _| b.has_conflict())).await,
            "Dirty page did not enter conflict after an external write"
        );
        ensure!(
            cx.update(|cx| !super::watcher::prose_conflicts(workspace, cx).is_empty()),
            "Prose conflict was not reported in the campaign status"
        );
        // Autosave must not overwrite the external version.
        cx.background_executor()
            .timer(std::time::Duration::from_millis(1000))
            .await;
        ensure!(
            disk() == external && text(cx) == local,
            "Autosave did not preserve both versions: disk={:?}, buffer={:?}",
            disk(),
            text(cx)
        );
        press(window, "ctrl-s", cx)?;
        ensure!(
            wait(cx, &|cx| window
                .update(cx, |_, window, _| window.has_active_prompt())
                .unwrap_or(false))
            .await,
            "Saving a conflicted page did not ask how to resolve it"
        );
        for key in keys {
            press(window, key, cx)?;
        }
        let expected = if keep_local { &local } else { &external };
        ensure!(
            wait(cx, &|cx| disk() == *expected
                && text(cx) == *expected
                && !buffer
                    .read_with(cx, |b, _| b.has_conflict() || b.is_dirty()))
            .await,
            "Conflict resolution round {round} did not settle: disk={:?}, buffer={:?}",
            disk(),
            text(cx)
        );
        ensure!(
            !window.update(cx, |_, window, _| window.has_active_prompt())?,
            "Conflict prompt remained open"
        );
    }
    ensure!(
        cx.update(|cx| super::watcher::prose_conflicts(workspace, cx).is_empty()),
        "Resolved conflict remained in the campaign status"
    );
    println!(
        "Prose conflict rehearsal passed: dirty page changed on disk keeps both versions, is reported, survives autosave, and resolves by keyboard via Overwrite and Discard Edits."
    );
    Ok(())
}

/// Keyboard-only workspace route: palette split, moving a tab between panes,
/// ambiguous-link picker, navigation history and project-wide search.
pub async fn workspace_keyboard(
    model: &Entity<CampaignModel>,
    workspace: &Entity<Workspace>,
    window: AnyWindowHandle,
    cx: &mut AsyncApp,
) -> anyhow::Result<()> {
    use campaign_domain::{Command, Note};
    let pause = async |cx: &mut AsyncApp, ms: u64| {
        cx.background_executor()
            .timer(std::time::Duration::from_millis(ms))
            .await
    };
    let wait = async |cx: &mut AsyncApp, condition: &dyn Fn(&mut AsyncApp) -> bool| {
        for _ in 0..200 {
            if condition(cx) {
                return true;
            }
            cx.background_executor()
                .timer(std::time::Duration::from_millis(10))
                .await;
        }
        condition(cx)
    };
    let type_text = |text: &str, cx: &mut AsyncApp| -> anyhow::Result<()> {
        for ch in text.chars() {
            let key = match ch {
                ' ' => "space".to_string(),
                c => c.to_string(),
            };
            press(window, &key, cx)?;
        }
        Ok(())
    };

    let alpha = Note::new("Alpha page");
    let first = Note::new("Beta page");
    let second = Note::new("Beta page");
    let ids = [alpha.id, first.id, second.id].map(DocumentId::Note);
    model.update(cx, |m, cx| {
        for note in [alpha, first, second] {
            m.execute(Command::CreateNote(note), cx);
        }
    });
    super::campaign::wait_saved(model, cx).await?;
    let (root, paths) = model.read_with(cx, |m, _| {
        (
            m.store.root().to_path_buf(),
            ids.map(|id| m.catalogue.documents[&id].path.clone()),
        )
    });
    let alpha_text = "# Alpha\n\nSee [[Beta page]] soon.\n\nunique-search-token\n";
    let bodies = [alpha_text, "# Beta one\n", "# Beta two\n"];
    model
        .read_with(cx, |m, _| {
            m.store.edit_documents(
                paths
                    .iter()
                    .zip(bodies)
                    .map(|(path, body)| {
                        (
                            path.to_string_lossy().into_owned(),
                            (String::new(), body.to_owned()),
                        )
                    })
                    .collect(),
            )
        })
        .await?;
    let open = async |path: &std::path::Path,
                      cx: &mut AsyncApp|
           -> anyhow::Result<Entity<editor::Editor>> {
        let item = window
            .update(cx, |_, window, cx| {
                workspace.update(cx, |w, cx| {
                    w.open_abs_path(root.join(path), Default::default(), window, cx)
                })
            })?
            .await?;
        let editor = cx
            .update(|cx| item.act_as::<editor::Editor>(cx))
            .context("Page did not open in an editor")?;
        window.update(cx, |_, window, cx| {
            window.focus(&editor.focus_handle(cx), cx);
            window.refresh();
            window.draw(cx).clear(cx);
        })?;
        Ok(editor)
    };
    let alpha_editor = open(&paths[0], cx).await?;
    let pane_count = |cx: &mut AsyncApp| workspace.read_with(cx, |w, _| w.panes().len());
    let panes_before = pane_count(cx);

    // Command palette: run "pane: split right" by name.
    press(window, "ctrl-shift-p", cx)?;
    ensure!(
        workspace.read_with(cx, |w, cx| w
            .active_modal::<command_palette::CommandPalette>(cx)
            .is_some()),
        "Ctrl+Shift+P did not open the command palette"
    );
    type_text("pane split right", cx)?;
    pause(cx, 150).await;
    press(window, "enter", cx)?;
    ensure!(
        wait(cx, &|cx| pane_count(cx) == panes_before + 1).await,
        "The palette did not run pane: split right"
    );
    pause(cx, 30).await;

    // Ctrl-W m h moves the active tab into the left pane, keeping focus on it.
    let beta_editor = open(&paths[1], cx).await?;
    let right = workspace.read_with(cx, |w, _| w.active_pane().clone());
    press(window, "ctrl-w", cx)?;
    press(window, "m", cx)?;
    press(window, "h", cx)?;
    let moved = wait(cx, &|cx| {
        workspace.read_with(cx, |w, cx| {
            let active = w.active_pane();
            *active != right
                && active
                    .read(cx)
                    .items()
                    .any(|i| i.item_id() == beta_editor.entity_id())
                && !right
                    .read(cx)
                    .items()
                    .any(|i| i.item_id() == beta_editor.entity_id())
        })
    })
    .await;
    ensure!(moved, "Ctrl-W m h did not move the tab to the left pane");
    ensure!(
        window.update(cx, |_, window, cx| beta_editor
            .focus_handle(cx)
            .is_focused(window))?,
        "Focus did not follow the moved tab"
    );

    // Ambiguous [[Beta page]]: Ctrl-Enter opens the restricted picker; choose
    // the second candidate with the keyboard.
    let _ = alpha_editor;
    let alpha_editor = open(&paths[0], cx).await?;
    let link = alpha_text.find("[[Beta").unwrap() + 3;
    window.update(cx, |_, window, cx| {
        alpha_editor.update(cx, |e, cx| {
            let offset = editor::MultiBufferOffset(link);
            e.change_selections(Default::default(), window, cx, |s| {
                s.select_ranges([offset..offset])
            })
        });
        window.refresh();
        window.draw(cx).clear(cx);
    })?;
    press(window, "ctrl-enter", cx)?;
    let panel = workspace
        .read_with(cx, |w, cx| w.panel::<super::navigator::Navigator>(cx))
        .context("Campaign navigator missing")?;
    let candidates = panel.read_with(cx, |p, cx| p.visible_pages(cx));
    ensure!(
        candidates.len() == 2 && candidates.iter().all(|id| ids[1..].contains(id)),
        "Ambiguous link did not restrict the picker to both pages: {candidates:?}"
    );
    press(window, "down", cx)?;
    press(window, "enter", cx)?;
    let chosen = candidates[1];
    let expected = bodies[ids.iter().position(|id| *id == chosen).unwrap()];
    let active_text = |cx: &mut AsyncApp| {
        workspace.read_with(cx, |w, cx| {
            w.active_item_as::<editor::Editor>(cx)
                .map(|e| e.read(cx).text(cx))
                .unwrap_or_default()
        })
    };
    ensure!(
        wait(cx, &|cx| active_text(cx) == expected).await,
        "Choosing the second candidate did not open it: {:?}",
        active_text(cx)
    );
    pause(cx, 30).await;

    // Navigation history: Ctrl-O returns to the link, Ctrl-I goes forward.
    window.update(cx, |_, window, cx| {
        if let Some(e) = workspace.read(cx).active_item_as::<editor::Editor>(cx) {
            window.focus(&e.focus_handle(cx), cx);
        }
        window.refresh();
        window.draw(cx).clear(cx);
    })?;
    press(window, "ctrl-o", cx)?;
    ensure!(
        wait(cx, &|cx| active_text(cx) == alpha_text).await,
        "Ctrl-O did not navigate back to the linking page"
    );
    pause(cx, 30).await;
    press(window, "ctrl-i", cx)?;
    ensure!(
        wait(cx, &|cx| active_text(cx) == expected).await,
        "Ctrl-I did not navigate forward again"
    );

    // Project search opens as a workspace item and finds closed-page text.
    press(window, "ctrl-shift-f", cx)?;
    let search = workspace
        .read_with(cx, |w, cx| {
            w.active_item_as::<search::ProjectSearchView>(cx)
        })
        .context("Ctrl+Shift+F did not open project search as a tab")?;
    window.update(cx, |_, window, cx| {
        window.refresh();
        window.draw(cx).clear(cx);
    })?;
    ensure!(
        wait(cx, &|cx| window
            .update(cx, |_, window, cx| {
                window.refresh();
                window.draw(cx).clear(cx);
                // The query input lives in the toolbar's search bar.
                let _ = &search;
                window
                    .context_stack()
                    .iter()
                    .any(|context| context.contains("ProjectSearchBar"))
                    && !window
                        .context_stack()
                        .iter()
                        .any(|context| context.contains("VimControl"))
            })
            .unwrap_or(false))
        .await,
        "Project search did not take keyboard focus: {:?}",
        window.update(cx, |_, window, _| window
            .context_stack()
            .iter()
            .map(|c| format!("{c:?}"))
            .collect::<Vec<_>>())?
    );
    type_text("unique-search-token", cx)?;
    press(window, "enter", cx)?;
    ensure!(
        wait(cx, &|cx| search.read_with(cx, |s, _| s.has_matches())).await,
        "Project search found no results for {:?}",
        search.read_with(cx, |s, cx| s.search_query_text(cx))
    );
    ensure!(
        search.read_with(cx, |s, cx| s.search_query_text(cx) == "unique-search-token"),
        "Project search query was not typed into its own input"
    );
    println!(
        "Workspace keyboard rehearsal passed: palette split, Ctrl-W m h tab move with focus, ambiguous-link picker, Ctrl-O/Ctrl-I history and project search as a tab."
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
        m.execute(Command::UpdateSession(session.clone()), cx);
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
    let texts = |cx: &mut AsyncApp| -> anyhow::Result<(String, String)> {
        Ok((
            editor.read_with(cx, |e, cx| e.text(cx)),
            std::fs::read_to_string(root.join(&closed_path))?,
        ))
    };
    let tick = |cx: &mut AsyncApp| {
        cx.background_executor()
            .timer(std::time::Duration::from_millis(1))
    };

    // Undo while the rename's link preparation is in flight.
    let mut renamed = session.clone();
    renamed.name = "Rapid session".into();
    model.update(cx, |m, cx| m.execute(Command::UpdateSession(renamed), cx));
    tick(cx).await;
    model.update(cx, |m, cx| m.undo(cx));
    super::campaign::wait_saved(model, cx).await?;
    ensure!(
        texts(cx)? == (source.clone(), source.clone()),
        "Rename then immediate undo left stale links: {:?}",
        texts(cx)?
    );
    // Two renames in quick succession end at the newest name.
    for name in ["Rapid session", "Final session"] {
        let mut renamed =
            model.read_with(cx, |m, _| m.engine.state().sessions[&session.id].clone());
        if !renamed.aliases.contains(&renamed.name) {
            renamed.aliases.push(renamed.name.clone());
        }
        renamed.name = name.into();
        model.update(cx, |m, cx| m.execute(Command::UpdateSession(renamed), cx));
        tick(cx).await;
    }
    super::campaign::wait_saved(model, cx).await?;
    let last = source.replace(&format!("[[{original}"), "[[Final session");
    ensure!(
        texts(cx)? == (last.clone(), last.clone()),
        "Consecutive renames left stale links: {:?}",
        texts(cx)?
    );
    model.update(cx, |m, cx| {
        m.undo(cx);
        m.undo(cx);
    });
    super::campaign::wait_saved(model, cx).await?;
    ensure!(
        texts(cx)? == (source.clone(), source.clone()),
        "Undoing consecutive renames left stale links"
    );

    // A failed link update is reported, keeps the quit barrier, and resumes
    // from the same base on Retry without losing the rename.
    use std::os::unix::fs::PermissionsExt as _;
    let closed_file = root.join(&closed_path);
    std::fs::set_permissions(&closed_file, std::fs::Permissions::from_mode(0o000))?;
    if std::fs::read(&closed_file).is_ok() {
        // Privileged users bypass permissions; the failure path is untestable.
        std::fs::set_permissions(&closed_file, std::fs::Permissions::from_mode(0o644))?;
        println!("Rename failure rehearsal skipped: permissions are not enforced for this user.");
    } else {
        let mut failed = session.clone();
        failed.name = "Retried session".into();
        model.update(cx, |m, cx| m.execute(Command::UpdateSession(failed), cx));
        let result = super::campaign::wait_saved(model, cx).await;
        std::fs::set_permissions(&closed_file, std::fs::Permissions::from_mode(0o644))?;
        ensure!(
            result
                .as_ref()
                .is_err_and(|e| e.to_string().starts_with("Link updates need attention")),
            "Unreadable closed page did not report a link-maintenance failure: {result:?}"
        );
        model.read_with(cx, |m, _| {
            ensure!(
                m.error
                    .as_deref()
                    .is_some_and(|e| e.starts_with("Link updates need attention")),
                "Link failure was not shown in the save status"
            );
            Ok::<_, anyhow::Error>(())
        })?;
        model.update(cx, |m, cx| m.retry(cx));
        super::campaign::wait_saved(model, cx).await?;
        let retried = source.replace(&format!("[[{original}"), "[[Retried session");
        ensure!(
            texts(cx)? == (retried.clone(), retried),
            "Retry did not resume link maintenance: {:?}",
            texts(cx)?
        );
        ensure!(
            model.read_with(cx, |m, _| m.error.is_none() && m.link_error.is_none()),
            "Retry did not clear the link failure"
        );
        model.update(cx, |m, cx| m.undo(cx));
        super::campaign::wait_saved(model, cx).await?;
        ensure!(
            texts(cx)? == (source.clone(), source.clone()),
            "Undo after a retried rename left stale links"
        );
    }
    println!(
        "Rename rehearsal passed: open-buffer transactions, closed-file journal, wiki labels, portable relative links/headings, structured undo/redo, rename-then-undo during preparation, consecutive renames, and failed link maintenance resumed by Retry."
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
    let millis = |d: std::time::Duration| d.as_secs_f64() * 1000.;
    // Baseline: an unchanged frame of the same workspace.
    let mut idle = Vec::new();
    for _ in 0..8 {
        idle.push(window.update(cx, |_, window, cx| {
            let start = std::time::Instant::now();
            window.refresh();
            window.draw(cx).clear(cx);
            millis(start.elapsed())
        })?);
        cx.background_executor()
            .timer(std::time::Duration::from_millis(16))
            .await;
    }
    idle.sort_by(f64::total_cmp);
    // Profiling runs may request more motions; gates always use at least 24.
    let motions = std::env::var("TTRPGUI_NATIVE_MOTIONS")
        .ok()
        .and_then(|n| n.parse::<usize>().ok())
        .unwrap_or(24)
        .max(24);
    let mut frames = Vec::new();
    for index in 0..motions {
        let key = if index % 2 == 0 { "j" } else { "k" };
        let (dispatch, draw) = window.update(cx, |_, window, cx| {
            let start = std::time::Instant::now();
            window.dispatch_keystroke(Keystroke::parse(key).unwrap(), cx);
            let dispatched = start.elapsed();
            window.refresh();
            window.draw(cx).clear(cx);
            (millis(dispatched), millis(start.elapsed() - dispatched))
        })?;
        frames.push(dispatch + draw);
        eprintln!(
            "Native note motion {index}: {:.2} ms (key dispatch {dispatch:.2} ms, frame {draw:.2} ms)",
            dispatch + draw
        );
        cx.background_executor()
            .timer(std::time::Duration::from_millis(16))
            .await;
    }
    eprintln!(
        "Native note idle frame: median={:.2} ms, max={:.2} ms",
        idle[4], idle[7]
    );
    frames.sort_by(f64::total_cmp);
    let percentile =
        |p: f64| frames[((frames.len() as f64 * p).ceil() as usize).clamp(1, frames.len()) - 1];
    let (median, p95) = (percentile(0.5), percentile(0.95));
    println!(
        "Native note interaction timing: {} Vim motions + CPU frame construction, median={median:.2} ms, p95={p95:.2} ms, max={:.2} ms; private software compositor; excludes presentation latency.",
        frames.len(),
        frames[frames.len() - 1]
    );
    if std::env::var_os("TTRPGUI_CHECK_PERFORMANCE").is_some() {
        ensure!(
            p95 < 1000. / 60.,
            "Large-note Vim frame p95 exceeded the 60 Hz CPU budget: {p95:.2} ms"
        );
    }
    println!("Native note probe completed successfully.");
    Ok(())
}
