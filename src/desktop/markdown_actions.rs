//! Native Markdown actions edit the same Zed buffer and transaction history.
use super::campaign::{ActiveCampaign, CampaignModel, wait_structured_saved};
use anyhow::Context as _;
use editor::{Anchor, Editor, ToOffset, ToPoint};
use gpui::{Action, App, AsyncApp, Context, Entity, KeyBinding, WeakEntity, Window};
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
                let prompt = cx.prompt_for_paths(gpui::PathPromptOptions {
                    files: true,
                    directories: false,
                    multiple: false,
                    prompt: Some("Choose an image to copy into this page".into()),
                });
                let window = window.window_handle();
                let editor = editor.downgrade();
                cx.spawn(async move |cx| {
                    let result = async {
                        let Some(paths) = prompt.await?? else {
                            return Ok(());
                        };
                        let Some(source) = paths.into_iter().next() else {
                            return Ok(());
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

pub(super) fn verify(
    workspace: &Entity<workspace::Workspace>,
    window: &mut Window,
    cx: &mut App,
) -> anyhow::Result<()> {
    let editor = workspace
        .read(cx)
        .active_item_as::<Editor>(cx)
        .context("Formatting editor missing")?;
    let before = editor.read(cx).text(cx);
    window.dispatch_action(BoldSelection.boxed_clone(), cx);
    anyhow::ensure!(
        editor.read(cx).text(cx) != before,
        "Native bold action did not edit the document"
    );
    window.dispatch_action(editor::actions::Undo.boxed_clone(), cx);
    anyhow::ensure!(
        editor.read(cx).text(cx) == before,
        "Native formatting did not share document undo"
    );
    println!(
        "Native Markdown action rehearsal passed: formatting through the parent document transaction and shared undo."
    );
    Ok(())
}
