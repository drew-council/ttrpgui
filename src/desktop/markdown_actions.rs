//! Native Markdown actions edit the same Zed buffer and transaction history.
use super::campaign::{ActiveCampaign, CampaignModel, wait_structured_saved};
use anyhow::{Context as _, ensure};
use editor::{Anchor, Editor, ToOffset, ToPoint};
use gpui::{
    AnyWindowHandle, App, AsyncApp, Context, Entity, Focusable as _, KeyBinding, WeakEntity, Window,
};
use std::{collections::BTreeSet, ops::Range, path::PathBuf};

gpui::actions!(
    campaign_markdown,
    [
        BoldSelection,
        ItalicSelection,
        StrikeSelection,
        CodeSelection,
        HeadingSelection,
        BulletSelection,
        InsertImage
    ]
);

/// Headless rehearsals supply the image here instead of opening the platform
/// chooser; on Linux even the headless platform uses the desktop portal.
pub(super) struct RehearsalImage(pub PathBuf);
impl gpui::Global for RehearsalImage {}

#[derive(Clone, Copy)]
enum Format {
    Inline(&'static str),
    Heading,
    Bullet,
}

pub fn init(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("ctrl-alt-b", BoldSelection, Some("Editor && mode == full")),
        KeyBinding::new(
            "ctrl-alt-i",
            ItalicSelection,
            Some("Editor && mode == full"),
        ),
    ]);
    cx.observe_new(|editor: &mut Editor, _, cx| {
        if !editor.mode().is_full() {
            return;
        }
        macro_rules! format_action {
            ($action:ident, $format:expr) => {{
                let editor_handle = cx.weak_entity();
                editor
                    .register_action(move |_: &$action, window, cx| {
                        let _ = editor_handle.update(cx, |editor, cx| {
                            if is_markdown(editor, cx) {
                                format(editor, $format, window, cx);
                            } else {
                                cx.propagate();
                            }
                        });
                    })
                    .detach();
            }};
        }
        format_action!(BoldSelection, Format::Inline("**"));
        format_action!(ItalicSelection, Format::Inline("*"));
        format_action!(StrikeSelection, Format::Inline("~~"));
        format_action!(CodeSelection, Format::Inline("`"));
        format_action!(HeadingSelection, Format::Heading);
        format_action!(BulletSelection, Format::Bullet);
        let editor_handle = cx.weak_entity();
        editor
            .register_action(move |_: &InsertImage, window, cx| {
                let Some(editor) = editor_handle.upgrade() else {
                    return;
                };
                if !is_markdown(editor.read(cx), cx) {
                    cx.propagate();
                    return;
                }
                let Some(model) = cx.try_global::<ActiveCampaign>().map(|m| m.0.clone()) else {
                    return;
                };
                let path = editor
                    .read(cx)
                    .buffer()
                    .read(cx)
                    .as_singleton()
                    .and_then(|buffer| {
                        buffer
                            .read(cx)
                            .file()?
                            .as_local()
                            .map(|file| file.abs_path(cx))
                    });
                let document = path.and_then(|path| {
                    model
                        .read(cx)
                        .catalogue
                        .documents
                        .values()
                        .find(|d| model.read(cx).store.root().join(&d.path) == path)
                        .map(|d| d.path.clone())
                });
                let Some(document) = document else {
                    return;
                };
                let range = editor.read(cx).selections.newest_anchor().range();
                let rehearsal = cx.try_global::<RehearsalImage>().map(|r| r.0.clone());
                let prompt = rehearsal.is_none().then(|| {
                    cx.prompt_for_paths(gpui::PathPromptOptions {
                        files: true,
                        directories: false,
                        multiple: false,
                        prompt: Some("Choose an image to copy into this page".into()),
                    })
                });
                let window = window.window_handle();
                let editor = editor.downgrade();
                cx.spawn(async move |cx| {
                    let result = async {
                        let source = match (rehearsal, prompt) {
                            (Some(source), _) => source,
                            (None, Some(prompt)) => {
                                let Some(paths) = prompt.await?? else {
                                    return Ok(());
                                };
                                let Some(source) = paths.into_iter().next() else {
                                    return Ok(());
                                };
                                source
                            }
                            (None, None) => return Ok(()),
                        };
                        import_image(&model, &editor, document, range, source, window, cx).await
                    }
                    .await;
                    if let Err(error) = result {
                        model.update(cx, |m, cx| {
                            m.error = Some(format!("Image import failed: {error:#}"));
                            cx.notify();
                        });
                    }
                })
                .detach();
            })
            .detach();
    })
    .detach();
}

fn is_markdown(editor: &Editor, cx: &App) -> bool {
    editor
        .buffer()
        .read(cx)
        .as_singleton()
        .is_some_and(|buffer| {
            buffer
                .read(cx)
                .language()
                .is_some_and(|l| l.name().as_ref() == "Markdown")
        })
}

fn format(editor: &mut Editor, format: Format, window: &mut Window, cx: &mut Context<Editor>) {
    editor.with_source_display(cx, |editor, cx| {
        let snapshot = editor.buffer().read(cx).snapshot(cx);
        let selections = editor.selections.disjoint_anchors();
        let mut edits = Vec::new();
        match format {
            Format::Inline(delimiter) => {
                for selection in selections {
                    let start = selection.start.to_offset(&snapshot);
                    let end = selection.end.to_offset(&snapshot);
                    let selected: String = snapshot.text_for_range(start..end).collect();
                    if selected.len() >= delimiter.len() * 2
                        && selected.starts_with(delimiter)
                        && selected.ends_with(delimiter)
                    {
                        edits.push((
                            start..end,
                            selected[delimiter.len()..selected.len() - delimiter.len()].to_owned(),
                        ));
                    } else {
                        let selected = if selected.is_empty() {
                            "Text"
                        } else {
                            &selected
                        };
                        edits.push((start..end, format!("{delimiter}{selected}{delimiter}")));
                    }
                }
            }
            Format::Heading | Format::Bullet => {
                let mut rows = BTreeSet::new();
                for selection in selections {
                    let start = selection.start.to_point(&snapshot);
                    let end = selection.end.to_point(&snapshot);
                    let last = if end.column == 0 && end.row > start.row {
                        end.row - 1
                    } else {
                        end.row
                    };
                    rows.extend(start.row..=last);
                }
                for row in rows {
                    let start = snapshot.point_to_offset(language::Point::new(row, 0));
                    let end = if row < snapshot.max_point().row {
                        editor::MultiBufferOffset(
                            snapshot.point_to_offset(language::Point::new(row + 1, 0)).0 - 1,
                        )
                    } else {
                        snapshot.len()
                    };
                    let line: String = snapshot.text_for_range(start..end).collect();
                    let prefix = match format {
                        Format::Heading => "# ",
                        _ => "- ",
                    };
                    let replacement = line
                        .strip_prefix(prefix)
                        .map(str::to_owned)
                        .unwrap_or_else(|| format!("{prefix}{line}"));
                    edits.push((start..end, replacement));
                }
            }
        }
        if let Some(buffer) = editor.buffer().read(cx).as_singleton() {
            buffer.update(cx, |b, _| {
                b.finalize_last_transaction();
            });
        }
        editor.transact(window, cx, |editor, _, cx| editor.edit(edits, cx));
        if let Some(buffer) = editor.buffer().read(cx).as_singleton() {
            buffer.update(cx, |b, _| {
                b.finalize_last_transaction();
            });
        }
    });
}

pub(super) async fn import_image(
    model: &Entity<CampaignModel>,
    editor: &WeakEntity<Editor>,
    document: PathBuf,
    range: Range<Anchor>,
    source: PathBuf,
    window: gpui::AnyWindowHandle,
    cx: &mut AsyncApp,
) -> anyhow::Result<()> {
    wait_structured_saved(model, cx).await?;
    let imported = model
        .read_with(cx, |m, _| {
            m.store
                .request(move |store| store.import_image(&document, &source))
        })
        .await?;
    let Some(editor) = editor.upgrade() else {
        return Ok(());
    };
    window.update(cx, |_, window, cx| {
        editor.update(cx, |editor, cx| {
            let snapshot = editor.buffer().read(cx).snapshot(cx);
            let offsets = range.start.to_offset(&snapshot)..range.end.to_offset(&snapshot);
            if let Some(buffer) = editor.buffer().read(cx).as_singleton() {
                buffer.update(cx, |b, _| {
                    b.finalize_last_transaction();
                });
            }
            editor.transact(window, cx, |editor, _, cx| {
                editor.edit([(offsets, format!("![Image]({imported})"))], cx)
            });
            if let Some(buffer) = editor.buffer().read(cx).as_singleton() {
                buffer.update(cx, |b, _| {
                    b.finalize_last_transaction();
                });
            }
        })
    })?;
    Ok(())
}

/// Focus `editor`, replace its text and select byte ranges, then draw so key
/// dispatch uses a current focus path.
fn prepare(
    editor: &Entity<Editor>,
    text: Option<&str>,
    ranges: &[Range<usize>],
    window: AnyWindowHandle,
    cx: &mut AsyncApp,
) -> anyhow::Result<()> {
    window.update(cx, |_, window, cx| {
        window.focus(&editor.focus_handle(cx), cx);
        editor.update(cx, |e, cx| {
            if let Some(text) = text {
                e.set_text(text, window, cx);
            }
            e.change_selections(Default::default(), window, cx, |s| {
                s.select_ranges(
                    ranges.iter().map(|r| {
                        editor::MultiBufferOffset(r.start)..editor::MultiBufferOffset(r.end)
                    }),
                )
            });
        });
        window.refresh();
        window.draw(cx).clear(cx);
    })
}

fn dispatch(
    editor: &Entity<Editor>,
    action: &dyn gpui::Action,
    window: AnyWindowHandle,
    cx: &mut AsyncApp,
) -> anyhow::Result<()> {
    window.update(cx, |_, window, cx| {
        editor.focus_handle(cx).dispatch_action(action, window, cx);
        window.refresh();
        window.draw(cx).clear(cx);
    })
}

fn undo(window: AnyWindowHandle, cx: &mut AsyncApp) -> anyhow::Result<()> {
    super::rehearsal::press(window, "escape", cx)?;
    super::rehearsal::press(window, "u", cx)
}

/// Keyboard formatting through the parent buffer. `Window::dispatch_action` is
/// deferred, so shortcuts are dispatched as keystrokes and palette actions on
/// the focused editor's rendered node before each assertion.
pub(super) async fn verify(
    workspace: &Entity<workspace::Workspace>,
    window: AnyWindowHandle,
    cx: &mut AsyncApp,
) -> anyhow::Result<()> {
    use super::rehearsal::press;
    let (editor, split) = workspace.read_with(cx, |w, cx| {
        let editor = |index: usize| {
            w.panes()
                .get(index)
                .and_then(|p| p.read(cx).active_item())
                .and_then(|i| i.act_as::<Editor>(cx))
        };
        (editor(0), editor(1))
    });
    let editor = editor.context("Formatting editor missing")?;
    let split = split.context("Formatting split missing")?;
    let text = |cx: &mut AsyncApp| editor.read_with(cx, |e, cx| e.text(cx));
    let original = "alpha beta gamma\nsecond line\n";

    // Two disjoint selections become one formatting transaction.
    prepare(&editor, Some(original), &[6..10, 17..23], window, cx)?;
    press(window, "ctrl-alt-b", cx)?;
    let bold = "alpha **beta** gamma\n**second** line\n";
    ensure!(
        text(cx) == bold,
        "Ctrl+Alt+B did not embolden every selection: {:?}",
        text(cx)
    );
    ensure!(
        split.read_with(cx, |e, cx| e.text(cx)) == bold,
        "Formatting did not reach the split sharing the document"
    );
    window.update(cx, |_, window, cx| {
        ensure!(
            editor.focus_handle(cx).is_focused(window),
            "Formatting moved focus out of the editor"
        );
        let presentation = markdown_live_preview::presentation_status(editor.read(cx), cx)
            .context("Markdown presentation addon missing")?;
        ensure!(
            presentation.enabled,
            "Formatting left live presentation suspended"
        );
        Ok(())
    })??;
    undo(window, cx)?;
    ensure!(
        text(cx) == original,
        "One Vim undo did not revert multi-range formatting: {:?}",
        text(cx)
    );

    // Formatting an already delimited selection removes the delimiters.
    prepare(&editor, None, &[6..10], window, cx)?;
    press(window, "ctrl-alt-i", cx)?;
    ensure!(
        text(cx) == "alpha *beta* gamma\nsecond line\n",
        "Ctrl+Alt+I did not italicize: {:?}",
        text(cx)
    );
    prepare(&editor, None, &[6..12], window, cx)?;
    press(window, "ctrl-alt-i", cx)?;
    ensure!(
        text(cx) == original,
        "Repeated italic did not toggle: {:?}",
        text(cx)
    );

    // Palette-only actions: strike/code inline, heading/bullet per line.
    for (action, expected) in [
        (
            &StrikeSelection as &dyn gpui::Action,
            "alpha ~~beta~~ gamma\nsecond line\n",
        ),
        (&CodeSelection, "alpha `beta` gamma\nsecond line\n"),
    ] {
        prepare(&editor, Some(original), &[6..10], window, cx)?;
        dispatch(&editor, action, window, cx)?;
        ensure!(
            text(cx) == expected,
            "{} produced {:?}",
            action.name(),
            text(cx)
        );
    }
    for (action, expected) in [
        (
            &HeadingSelection as &dyn gpui::Action,
            "# alpha beta gamma\n# second line\n",
        ),
        (&BulletSelection, "- alpha beta gamma\n- second line\n"),
    ] {
        prepare(&editor, Some(original), &[2..20], window, cx)?;
        dispatch(&editor, action, window, cx)?;
        ensure!(
            text(cx) == expected,
            "{} produced {:?}",
            action.name(),
            text(cx)
        );
        undo(window, cx)?;
        ensure!(
            text(cx) == original,
            "One Vim undo did not revert {}: {:?}",
            action.name(),
            text(cx)
        );
    }
    // An empty selection inserts editable placeholder text at the cursor.
    prepare(&editor, Some(original), &[0..0], window, cx)?;
    press(window, "ctrl-alt-b", cx)?;
    ensure!(
        text(cx) == format!("**Text**{original}"),
        "Bold at a cursor produced {:?}",
        text(cx)
    );
    println!(
        "Native Markdown action rehearsal passed: Ctrl+Alt+B/I and palette strike/code/heading/bullet edit the parent buffer, multiple selections, toggling, shared splits, retained focus and one-step Vim undo."
    );
    Ok(())
}

/// A valid 1x1 PNG.
const PIXEL_PNG: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x63, 0xf8, 0xcf, 0xc0, 0xf0,
    0x1f, 0x00, 0x05, 0x00, 0x01, 0xff, 0x89, 0x99, 0x3d, 0x1d, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45,
    0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];

/// The InsertImage action with a rehearsal-supplied file: storage worker
/// import, anchored parent-buffer edit, focus, one-step undo and rejection.
pub(super) async fn verify_image(
    model: &Entity<CampaignModel>,
    workspace: &Entity<workspace::Workspace>,
    window: AnyWindowHandle,
    cx: &mut AsyncApp,
) -> anyhow::Result<()> {
    use campaign_documents::DocumentId;
    let (root, page) = model.read_with(cx, |m, _| {
        let page = m
            .catalogue
            .documents
            .values()
            .find(|d| matches!(d.id, DocumentId::Note(_)))
            .map(|d| d.path.clone());
        (m.store.root().to_path_buf(), page)
    });
    let page = page.context("No note page for image rehearsal")?;
    let item = window
        .update(cx, |_, window, cx| {
            workspace.update(cx, |w, cx| {
                w.open_abs_path(root.join(&page), Default::default(), window, cx)
            })
        })?
        .await?;
    let editor = cx
        .update(|cx| item.act_as::<Editor>(cx))
        .context("Image page did not open in an editor")?;
    // The smoke data directory is removed after the run.
    let fixtures = root
        .parent()
        .context("Campaign has no data directory")?
        .join("image-fixtures");
    std::fs::create_dir_all(&fixtures)?;
    let source = fixtures.join("portrait.png");
    std::fs::write(&source, PIXEL_PNG)?;
    let original = "# Gallery\n\nBefore after\n";
    let cursor = original.find(" after").unwrap();
    prepare(&editor, Some(original), &[cursor..cursor], window, cx)?;
    cx.update(|cx| cx.set_global(RehearsalImage(source.clone())));
    dispatch(&editor, &InsertImage, window, cx)?;
    let mut inserted = None;
    for _ in 0..200 {
        cx.background_executor()
            .timer(std::time::Duration::from_millis(10))
            .await;
        let text = editor.read_with(cx, |e, cx| e.text(cx));
        if text != original {
            inserted = Some(text);
            break;
        }
    }
    let inserted = inserted.context("InsertImage did not edit the page")?;
    let link = inserted
        .strip_prefix(&original[..cursor])
        .and_then(|rest| rest.strip_suffix(&original[cursor..]))
        .with_context(|| format!("Image link was not inserted at the cursor: {inserted:?}"))?;
    let relative = link
        .strip_prefix("![Image](")
        .and_then(|l| l.strip_suffix(')'))
        .with_context(|| format!("Unexpected image Markdown {link:?}"))?;
    ensure!(
        relative.starts_with("assets/") && relative.ends_with(".png"),
        "Image link is not portable and page-relative: {relative}"
    );
    let asset = root.join(&page).parent().unwrap().join(relative);
    ensure!(
        std::fs::read(&asset)? == PIXEL_PNG,
        "Imported asset differs from its source"
    );
    ensure!(
        std::fs::read(&source)? == PIXEL_PNG,
        "Image import changed the original file"
    );
    window.update(cx, |_, window, cx| {
        ensure!(
            editor.focus_handle(cx).is_focused(window),
            "Image import moved focus out of the editor"
        );
        Ok(())
    })??;
    undo(window, cx)?;
    ensure!(
        editor.read_with(cx, |e, cx| e.text(cx)) == original,
        "One Vim undo did not remove the inserted image"
    );

    // Unsupported files are rejected visibly without editing the page.
    let invalid = fixtures.join("notes.txt");
    std::fs::write(&invalid, "not an image")?;
    cx.update(|cx| cx.set_global(RehearsalImage(invalid)));
    dispatch(&editor, &InsertImage, window, cx)?;
    let mut rejected = false;
    for _ in 0..200 {
        cx.background_executor()
            .timer(std::time::Duration::from_millis(10))
            .await;
        rejected = model.read_with(cx, |m, _| {
            m.error
                .as_deref()
                .is_some_and(|e| e.starts_with("Image import failed"))
        });
        if rejected {
            break;
        }
    }
    cx.update(|cx| cx.remove_global::<RehearsalImage>());
    ensure!(rejected, "Invalid image import was not reported");
    ensure!(
        editor.read_with(cx, |e, cx| e.text(cx)) == original,
        "Rejected image import edited the page"
    );
    model.update(cx, |m, cx| {
        m.error = None;
        cx.notify();
    });
    println!(
        "Image rehearsal passed: InsertImage copies into portable page assets through the storage worker, inserts relative Markdown at the anchored cursor, keeps focus, undoes in one step and visibly rejects non-images."
    );
    Ok(())
}
