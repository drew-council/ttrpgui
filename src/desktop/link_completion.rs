use super::{campaign::CampaignModel, navigator::Navigator};
use campaign_documents::DocumentId;
use editor::{Editor, EditorEvent, MultiBufferOffset};
use gpui::{App, Entity, Window};
use workspace::Workspace;

pub fn init(model: &Entity<CampaignModel>, workspace: &Entity<Workspace>, cx: &mut App) {
    let model = model.downgrade();
    let workspace = workspace.downgrade();
    cx.observe_new(move |_: &mut Editor, window, cx| {
        let Some(window) = window else {
            return;
        };
        let model = model.clone();
        let workspace = workspace.clone();
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
                                        campaign_documents::PreparedDocument::new(
                                            id, revision, text,
                                        )
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
                let anchors = buffer.anchor_before(range.start)..buffer.anchor_after(range.end);
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
    })
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
                == "[[",
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
    let Some(workspace) = workspace.upgrade() else {
        return Ok(());
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
    model.update(cx, |m, _| m.store.edit_documents(closed))
}
