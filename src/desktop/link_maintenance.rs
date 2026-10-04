//! Rename and undo link maintenance. File reads and parsing run off the UI;
//! open buffers receive ordinary editor transactions and closed files use the
//! storage worker's compare-before-write journal.
use super::campaign::{CampaignModel, RetryLinkMaintenance, wait_structured_saved};
use campaign_documents::{Catalogue, links_after_change};
use editor::{Editor, MultiBufferOffset};
use gpui::{App, AsyncApp, Entity, WeakEntity};
use std::{cell::RefCell, collections::BTreeMap, rc::Rc, sync::Arc};
use workspace::Workspace;

/// Documents' links reflect `applied`. One loop at a time rewrites them from
/// `applied` to the newest catalogue, so rapid rename/undo sequences and
/// retries never skip an intermediate rename.
struct Maintenance {
    applied: Arc<Catalogue>,
    running: bool,
}

/// Preparation raced a newer rename; rewrite again from the same base.
#[derive(Debug)]
struct IdentitiesChanged;
impl std::fmt::Display for IdentitiesChanged {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("Page identities changed while preparing link updates")
    }
}
impl std::error::Error for IdentitiesChanged {}

fn renamed(before: &Catalogue, after: &Catalogue) -> bool {
    before.documents.iter().any(|(id, old)| {
        after
            .documents
            .get(id)
            .is_some_and(|new| old.name != new.name || old.path != new.path)
    })
}

pub fn init(model: &Entity<CampaignModel>, workspace: &Entity<Workspace>, cx: &mut App) {
    let state = Rc::new(RefCell::new(Maintenance {
        applied: model.read(cx).catalogue.clone(),
        running: false,
    }));
    let workspace = workspace.downgrade();
    cx.subscribe(model, {
        let state = state.clone();
        let workspace = workspace.clone();
        move |model, _: &(), cx| start(&state, model, &workspace, cx)
    })
    .detach();
    cx.subscribe(model, move |model, _: &RetryLinkMaintenance, cx| {
        start(&state, model, &workspace, cx)
    })
    .detach();
}

fn start(
    state: &Rc<RefCell<Maintenance>>,
    model: Entity<CampaignModel>,
    workspace: &WeakEntity<Workspace>,
    cx: &mut App,
) {
    {
        let mut state = state.borrow_mut();
        let current = model.read(cx).catalogue.clone();
        if state.running || Arc::ptr_eq(&state.applied, &current) {
            return;
        }
        if !renamed(&state.applied, &current) {
            state.applied = current;
            return;
        }
        state.running = true;
    }
    model.update(cx, |m, cx| {
        m.link_updates_pending += 1;
        m.link_error = None;
        cx.notify();
    });
    let state = state.clone();
    let workspace = workspace.clone();
    cx.spawn(async move |cx| {
        let result = loop {
            let (base, current) = cx.update(|cx| {
                (
                    state.borrow().applied.clone(),
                    model.read(cx).catalogue.clone(),
                )
            });
            if Arc::ptr_eq(&base, &current) || !renamed(&base, &current) {
                state.borrow_mut().applied = current;
                break Ok(());
            }
            match rewrite(base, &model, &workspace, cx).await {
                Ok(after) => state.borrow_mut().applied = after,
                Err(error) if error.is::<IdentitiesChanged>() => continue,
                Err(error) => break Err(error),
            }
        };
        state.borrow_mut().running = false;
        model.update(cx, |m, cx| {
            m.link_updates_pending -= 1;
            if let Err(error) = result {
                let error = format!("Link updates need attention: {error:#}");
                m.link_error = Some(error.clone());
                m.error = Some(error);
            }
            cx.notify();
        });
    })
    .detach();
}

/// Rewrite links from `before` to the current catalogue; returns the catalogue
/// the documents now reflect.
async fn rewrite(
    before: Arc<Catalogue>,
    model: &Entity<CampaignModel>,
    workspace: &WeakEntity<Workspace>,
    cx: &mut AsyncApp,
) -> anyhow::Result<Arc<Catalogue>> {
    wait_structured_saved(model, cx).await?;
    let Some(workspace) = workspace.upgrade() else {
        return Ok(model.read_with(cx, |m, _| m.catalogue.clone()));
    };
    let open = cx.update(|cx| open_editors(&workspace, cx));
    let sources = cx.update(|cx| {
        open.iter()
            .map(|(path, editor)| (path.clone(), editor.read(cx).text(cx)))
            .collect::<BTreeMap<_, _>>()
    });
    let (root, after) = model.read_with(cx, |m, _| {
        (m.store.root().to_path_buf(), m.catalogue.clone())
    });
    let old = before.clone();
    let new = after.clone();
    let edits = cx
        .background_executor()
        .spawn(async move {
            let mut edits = Vec::new();
            for document in old.documents.values() {
                let path = root.join(&document.path);
                let source = match sources.get(&path) {
                    Some(source) => source.clone(),
                    None => std::fs::read_to_string(&path)?,
                };
                let changes = links_after_change(&source, document.id, &old, &new);
                if !changes.is_empty() {
                    edits.push((document.id, path, source, changes));
                }
            }
            Ok::<_, anyhow::Error>(edits)
        })
        .await?;
    let closed = cx.update(|cx| -> anyhow::Result<_> {
        let current = model.read(cx);
        if !after.documents.iter().all(|(id, expected)| {
            current
                .catalogue
                .documents
                .get(id)
                .is_some_and(|d| d.name == expected.name && d.path == expected.path)
        }) {
            return Err(IdentitiesChanged.into());
        }
        let open = open_editors(&workspace, cx);
        let mut closed = BTreeMap::new();
        for (id, path, source, changes) in edits {
            if let Some(editor) = open.get(&path) {
                let current = editor.read(cx).text(cx);
                let changes = if current == source {
                    changes
                } else {
                    links_after_change(&current, id, &before, &after)
                };
                editor.update(cx, |e, cx| {
                    e.edit(
                        changes.into_iter().map(|edit| {
                            (
                                MultiBufferOffset(edit.range.start)
                                    ..MultiBufferOffset(edit.range.end),
                                edit.replacement,
                            )
                        }),
                        cx,
                    )
                });
            } else {
                let mut revised = source.clone();
                for edit in changes {
                    revised.replace_range(edit.range, &edit.replacement);
                }
                closed.insert(
                    before.documents[&id].path.to_string_lossy().into_owned(),
                    (source, revised),
                );
            }
        }
        Ok(closed)
    })?;
    model
        .read_with(cx, |m, _| m.store.edit_documents(closed))
        .await?;
    Ok(after)
}

fn open_editors(
    workspace: &Entity<Workspace>,
    cx: &App,
) -> BTreeMap<std::path::PathBuf, Entity<Editor>> {
    workspace
        .read(cx)
        .items_of_type::<Editor>(cx)
        .filter_map(|editor| {
            let buffer = editor.read(cx).buffer().read(cx).as_singleton()?;
            let path = buffer.read(cx).file()?.as_local()?.abs_path(cx);
            Some((path, editor))
        })
        .collect()
}
