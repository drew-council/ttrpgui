use super::{campaign::CampaignModel, navigator::Navigator};
use campaign_documents::DocumentId;
use editor::{Editor, EditorEvent, MultiBufferOffset, ToOffset};
use gpui::{App, Entity, Window};
use workspace::Workspace;
gpui::actions!(campaign, [FollowLink]);

pub fn init(
    model: &Entity<CampaignModel>,
    workspace: &Entity<Workspace>,
    window: &mut Window,
    cx: &mut App,
) {
    cx.bind_keys([gpui::KeyBinding::new(
        "ctrl-enter",
        FollowLink,
        Some("Editor && mode == full"),
    )]);
    let editors = workspace
        .read(cx)
        .items_of_type::<Editor>(cx)
        .collect::<Vec<_>>();
    let model = model.downgrade();
    let workspace = workspace.downgrade();
    for entity in editors {
        entity.update(cx, |editor, cx| {
            attach(editor, window, cx, model.clone(), workspace.clone())
        });
    }
    cx.observe_new(move |editor: &mut Editor, window, cx| {
        if let Some(window) = window {
            attach(editor, window, cx, model.clone(), workspace.clone());
        }
    })
    .detach();
}

fn attach(
    editor: &mut Editor,
    window: &mut Window,
    cx: &mut gpui::Context<Editor>,
    model: gpui::WeakEntity<CampaignModel>,
    workspace: gpui::WeakEntity<Workspace>,
) {
    let model = model.clone();
    let workspace = workspace.clone();
    let weak_editor = cx.weak_entity();
    let follow_model = model.clone();
    let follow_workspace = workspace.clone();
    editor
        .register_action(move |_: &FollowLink, window, cx| {
            let (Some(editor), Some(model), Some(workspace)) = (
                weak_editor.upgrade(),
                follow_model.upgrade(),
                follow_workspace.upgrade(),
            ) else {
                return;
            };
            let view = editor.read(cx);
            let snapshot = view.buffer().read(cx).snapshot(cx);
            let cursor = view
                .selections
                .newest_anchor()
                .head()
                .to_offset(&snapshot)
                .0;
            let text = view.text(cx);
            let Some(link) = campaign_documents::parse_links(&text)
                .into_iter()
                .find(|link| link.span.contains(&cursor))
            else {
                return;
            };
            let Some(buffer) = view.buffer().read(cx).as_singleton() else {
                return;
            };
            let Some(path) = buffer
                .read(cx)
                .file()
                .and_then(|file| file.as_local())
                .map(|file| file.abs_path(cx))
            else {
                return;
            };
            let m = model.read(cx);
            let Some(from) = m
                .catalogue
                .documents
                .values()
                .find(|d| m.store.root().join(&d.path) == path)
                .map(|d| d.id)
            else {
                return;
            };
            match m.catalogue.resolve(from, &link) {
                campaign_documents::Resolution::Found { document, heading } => {
                    super::campaign::open_document_heading(
                        &model,
                        &workspace.downgrade(),
                        document,
                        heading,
                        window,
                        cx,
                    )
                }
                campaign_documents::Resolution::Ambiguous(candidates) => {
                    workspace.update(cx, |w, cx| w.focus_panel::<Navigator>(window, cx));
                    if let Some(panel) = workspace.read(cx).panel::<Navigator>(cx) {
                        panel.update(cx, |p, cx| {
                            p.resolve_ambiguous(candidates, link.heading, window, cx)
                        });
                    }
                }
                campaign_documents::Resolution::Missing => model.update(cx, |m, cx| {
                    m.error = Some(format!("Missing page: {}", link.target));
                    cx.notify();
                }),
                campaign_documents::Resolution::External => {
                    let url = match &link.heading {
                        Some(fragment) => format!("{}#{fragment}", link.target),
                        None => link.target.clone(),
                    };
                    cx.open_url(&url);
                }
            }
        })
        .detach();
    cx.subscribe_in(
        &cx.entity(),
        window,
        move |editor, entity, event: &EditorEvent, window, cx| {
            if matches!(event, EditorEvent::BufferEdited) {
                if let Some(model) = model.upgrade() {
                    if let Some(singleton) = editor.buffer().read(cx).as_singleton() {
                        if let Some(path) = singleton
                            .read(cx)
                            .file()
                            .and_then(|f| f.as_local())
                            .map(|f| f.abs_path(cx))
                        {
                            let id = {
                                let m = model.read(cx);
                                m.catalogue
                                    .documents
                                    .values()
                                    .find(|d| m.store.root().join(&d.path) == path)
                                    .map(|d| d.id)
                            };
                            if let Some(id) = id {
                                let revision = model.update(cx, |m, _| {
                                    m.document_revision += 1;
                                    m.document_revision
                                });
                                let text = editor.text(cx);
                                let parse = cx.background_executor().spawn(async move {
                                    campaign_documents::PreparedDocument::new(id, revision, text)
                                });
                                cx.spawn(async move |_, cx| {
                                    let prepared = parse.await;
                                    model.update(cx, |m, cx| {
                                        if m.index.apply(prepared) {
                                            cx.notify();
                                        }
                                    });
                                })
                                .detach();
                            }
                        }
                    }
                }
            }
            let EditorEvent::InputHandled { text, .. } = event else {
                return;
            };
            if !text.ends_with('[') {
                return;
            }
            let (Some(model), Some(workspace)) = (model.upgrade(), workspace.upgrade()) else {
                return;
            };
            let snapshot = editor.display_snapshot(cx);
            let offset = editor
                .selections
                .newest::<MultiBufferOffset>(&snapshot)
                .head();
            let Some(start) = offset.0.checked_sub(2) else {
                return;
            };
            let buffer = editor.buffer().read(cx).snapshot(cx);
            let range = MultiBufferOffset(start)..offset;
            if buffer.text_for_range(range.clone()).collect::<String>() != "[[" {
                return;
            }
            let Some(singleton) = editor.buffer().read(cx).as_singleton() else {
                return;
            };
            let Some(path) = singleton
                .read(cx)
                .file()
                .and_then(|file| file.as_local())
                .map(|file| file.abs_path(cx))
            else {
                return;
            };
            let state = model.read(cx);
            let Some(source) = state
                .catalogue
                .documents
                .values()
                .find(|d| state.store.root().join(&d.path) == path)
                .map(|d| d.id)
            else {
                return;
            };
            let text = editor.text(cx);
            let end = if text.get(range.end.0..range.end.0 + 2) == Some("]]") {
                MultiBufferOffset(range.end.0 + 2)
            } else {
                range.end
            };
            let anchors = buffer.anchor_before(range.start)..buffer.anchor_after(end);
            // Defer focus changes until the source editor's input transaction
            // has completed; the picker holds anchors, never a copied buffer.
            let weak = entity.downgrade();
            cx.defer_in(window, move |_, window, cx| {
                workspace.update(cx, |w, cx| w.focus_panel::<Navigator>(window, cx));
                if let Some(panel) = workspace.read(cx).panel::<Navigator>(cx) {
                    panel.update(cx, |p, cx| {
                        p.complete_link(weak, source, anchors, window, cx)
                    });
                }
            });
        },
    )
    .detach();
}

pub struct PendingLink {
    pub editor: gpui::WeakEntity<Editor>,
    pub source: DocumentId,
    pub range: std::ops::Range<editor::Anchor>,
}

pub fn insert(
    pending: PendingLink,
    target: DocumentId,
    model: &Entity<CampaignModel>,
    window: &mut Window,
    cx: &mut App,
) -> anyhow::Result<()> {
    use gpui::Focusable;
    let editor = pending
        .editor
        .upgrade()
        .ok_or_else(|| anyhow::anyhow!("Source document was closed"))?;
    let link = model
        .read(cx)
        .catalogue
        .relative_link(pending.source, target, None)
        .ok_or_else(|| anyhow::anyhow!("Link target was removed"))?;
    editor.update(cx, |editor, cx| {
        let buffer = editor.buffer().read(cx).snapshot(cx);
        anyhow::ensure!(
            buffer
                .text_for_range(pending.range.clone())
                .collect::<String>()
                .as_str()
                == "[["
                || buffer
                    .text_for_range(pending.range.clone())
                    .collect::<String>()
                    == "[[]]",
            "Source changed while choosing the link; its contents were preserved"
        );
        editor.edit([(pending.range, link)], cx);
        window.focus(&editor.focus_handle(cx), cx);
        Ok(())
    })
}

pub fn update_renamed_links(
    before: campaign_documents::Catalogue,
    model: &Entity<CampaignModel>,
    workspace: &gpui::WeakEntity<Workspace>,
    cx: &mut App,
) -> anyhow::Result<()> {
    let model = model.clone();
    let workspace = workspace.clone();
    cx.spawn(async move |cx| {
        let result = async {
            super::campaign::wait_saved(&model, cx).await?;
            let edits = cx.update(|cx| apply_renamed_links(before, &model, &workspace, cx))?;
            edits.await
        }
        .await;
        if let Err(error) = result {
            model.update(cx, |m, cx| {
                m.error = Some(format!("Link updates need attention: {error:#}"));
                cx.notify();
            });
        }
    })
    .detach();
    Ok(())
}

fn apply_renamed_links(
    before: campaign_documents::Catalogue,
    model: &Entity<CampaignModel>,
    workspace: &gpui::WeakEntity<Workspace>,
    cx: &mut App,
) -> anyhow::Result<futures::future::BoxFuture<'static, anyhow::Result<()>>> {
    let Some(workspace) = workspace.upgrade() else {
        return Ok(Box::pin(async { Ok(()) }));
    };
    let mut open = std::collections::BTreeMap::new();
    for editor in workspace.read(cx).items_of_type::<Editor>(cx) {
        if let Some(buffer) = editor.read(cx).buffer().read(cx).as_singleton() {
            if let Some(path) = buffer
                .read(cx)
                .file()
                .and_then(|file| file.as_local())
                .map(|file| file.abs_path(cx))
            {
                open.insert(path, editor.clone());
            }
        }
    }
    let state = model.read(cx);
    anyhow::ensure!(
        !state.dirty,
        "Save page metadata before updating related links"
    );
    let root = state.store.root().to_path_buf();
    let after = campaign_documents::Catalogue::from_campaign(state.engine.state());
    let mut closed = std::collections::BTreeMap::new();
    for document in before.documents.values() {
        let path = root.join(&document.path);
        let source = if let Some(editor) = open.get(&path) {
            editor.read(cx).text(cx)
        } else {
            std::fs::read_to_string(&path)?
        };
        let edits = campaign_documents::links_after_change(&source, document.id, &before, &after);
        if edits.is_empty() {
            continue;
        }
        if let Some(editor) = open.get(&path) {
            editor.update(cx, |editor, cx| {
                editor.edit(
                    edits.into_iter().map(|edit| {
                        (
                            MultiBufferOffset(edit.range.start)..MultiBufferOffset(edit.range.end),
                            edit.replacement,
                        )
                    }),
                    cx,
                )
            });
        } else {
            let mut revised = source.clone();
            for edit in edits {
                revised.replace_range(edit.range, &edit.replacement);
            }
            closed.insert(
                document.path.to_string_lossy().into_owned(),
                (source, revised),
            );
        }
    }
    Ok(model.read(cx).store.edit_documents(closed))
}
