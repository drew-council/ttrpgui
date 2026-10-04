use super::campaign::CampaignModel;
use campaign_documents::PreparedDocument;
use campaign_domain::CampaignEngine;
use futures::StreamExt;
use gpui::{App, AsyncApp, Entity, WeakEntity};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    time::Duration,
};
use workspace::Workspace;

// The Linux watcher is non-recursive. Scan directories after registration so
// files written before their new directory was watched are still discovered.
fn watch_tree(watcher: &dyn fs::Watcher, root: &Path) -> anyhow::Result<Vec<PathBuf>> {
    let mut pending = vec![root.to_path_buf()];
    let mut files = Vec::new();
    while let Some(directory) = pending.pop() {
        let entries = match std::fs::read_dir(&directory) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(error.into()),
        };
        if let Err(error) = watcher.add(&directory) {
            if !directory.exists() {
                continue;
            }
            return Err(error);
        }
        for entry in entries {
            let entry = entry?;
            if entry.file_name().to_string_lossy().starts_with('.') {
                continue;
            }
            let kind = entry.file_type()?;
            if kind.is_dir() {
                pending.push(entry.path());
            } else if kind.is_file() {
                files.push(entry.path());
            }
        }
    }
    Ok(files)
}

fn report(model: &WeakEntity<CampaignModel>, message: String, cx: &mut AsyncApp) {
    let _ = model.update(cx, |m, cx| {
        m.error = Some(message);
        cx.notify();
    });
}

async fn reload_external(
    model: &WeakEntity<CampaignModel>,
    cx: &mut AsyncApp,
) -> anyhow::Result<()> {
    let poll = model.update(cx, |m, _| {
        m.store.request(|store| store.external_snapshot())
    })?;
    let Some(snapshot) = poll.await? else {
        return Ok(());
    };
    let (followup, conflict, serial) = model.update(cx, |m, cx| {
        let serial = m.save_serial;
        if m.dirty || m.saves_pending > 0 || m.restoring {
            let state = m.engine.state().clone();
            m.error = Some(
                "External edits conflict with unsaved changes; both versions are preserved".into(),
            );
            cx.notify();
            (
                m.store.request(move |store| store.preserve_unsaved(&state)),
                true,
                serial,
            )
        } else {
            m.engine = CampaignEngine::new(snapshot.campaign.clone())
                .expect("Storage validated external campaign");
            m.replace_catalogue();
            m.error = None;
            cx.emit(());
            cx.notify();
            // Queue acceptance before a new UI command can queue a save.
            (
                m.store
                    .request(move |store| store.accept_external(snapshot)),
                false,
                serial,
            )
        }
    })?;
    match followup.await {
        Ok(()) if conflict => {
            model.update(cx, |m, cx| {
                // A later successful save/restore can already have removed it.
                if m.save_serial == serial && !m.restoring {
                    m.has_recovery = true;
                }
                cx.notify();
            })?;
        }
        Ok(()) => (),
        Err(error) => {
            let recovery = model.update(cx, |m, cx| {
                m.dirty = true;
                m.error = Some(format!("External change: {error:#}"));
                let state = m.engine.state().clone();
                let serial = m.save_serial;
                cx.notify();
                (
                    m.store.request(move |store| store.preserve_unsaved(&state)),
                    serial,
                )
            })?;
            let preserved = recovery.0.await;
            model.update(cx, |m, cx| {
                if m.save_serial == recovery.1 {
                    match preserved {
                        Ok(()) => m.has_recovery = true,
                        Err(error) => m.error = Some(format!("External change could not be resolved; recovery copy failed: {error:#}")),
                    }
                }
                cx.notify();
            })?;
        }
    }
    Ok(())
}

async fn refresh_documents(
    model: &WeakEntity<CampaignModel>,
    workspace: &WeakEntity<Workspace>,
    paths: &[PathBuf],
    cx: &mut AsyncApp,
) -> anyhow::Result<()> {
    let jobs = model.update(cx, |m, cx| {
        let open = workspace
            .upgrade()
            .map(|w| {
                w.read(cx)
                    .items_of_type::<editor::Editor>(cx)
                    .filter_map(|e| {
                        let view = e.read(cx);
                        let buffer = view.buffer().read(cx).as_singleton()?;
                        let path = buffer.read(cx).file()?.as_local()?.abs_path(cx);
                        Some((path, view.text(cx)))
                    })
                    .collect::<BTreeMap<_, _>>()
            })
            .unwrap_or_default();
        let mut jobs = Vec::new();
        for document in m.catalogue.documents.values() {
            let path = m.store.root().join(&document.path);
            if !paths.contains(&path) && m.index.contains(document.id) {
                continue;
            }
            m.document_revision += 1;
            jobs.push((
                document.id,
                m.document_revision,
                path.clone(),
                open.get(&path).cloned(),
            ));
        }
        jobs
    })?;
    if jobs.is_empty() {
        return Ok(());
    }
    // Reserve revisions before I/O. Open/dirty editor text wins over disk,
    // and a later editor revision wins over an older background parse.
    let parsed = cx
        .background_executor()
        .spawn(async move {
            jobs.into_iter()
                .map(|(id, revision, path, open)| {
                    let text = match open {
                        Some(text) => Ok(text),
                        None => std::fs::read_to_string(path),
                    };
                    let text = match text {
                        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                            Ok(String::new())
                        }
                        other => other,
                    };
                    text.map(|text| (id, PreparedDocument::new(id, revision, text)))
                })
                .collect::<Vec<_>>()
        })
        .await;
    model.update(cx, |m, cx| {
        for result in parsed {
            match result {
                Ok((id, document)) if m.catalogue.documents.contains_key(&id) => {
                    m.index.apply(document);
                }
                Ok(_) => (),
                Err(error) => m.error = Some(format!("Index refresh failed: {error}")),
            }
        }
        cx.notify();
    })?;
    Ok(())
}

/// Open pages whose file changed on disk while they had unsaved edits. Zed
/// keeps both versions: autosave skips them and saving asks to overwrite or
/// discard the edits.
pub fn prose_conflicts(workspace: &Entity<Workspace>, cx: &App) -> Vec<String> {
    let mut names = workspace
        .read(cx)
        .items_of_type::<editor::Editor>(cx)
        .filter_map(|e| {
            let multibuffer = e.read(cx).buffer().read(cx);
            let buffer = multibuffer.as_singleton()?;
            buffer
                .read(cx)
                .has_conflict()
                .then(|| multibuffer.title(cx).to_string())
        })
        .collect::<Vec<_>>();
    names.sort();
    names.dedup();
    names
}

/// Refresh status whenever a buffer's disk or dirty state changes.
fn observe_buffers(model: &Entity<CampaignModel>, workspace: &Entity<Workspace>, cx: &mut App) {
    let notify =
        |model: &WeakEntity<CampaignModel>, buffer: &Entity<language::Buffer>, cx: &mut App| {
            let model = model.clone();
            cx.subscribe(buffer, move |_, event: &language::BufferEvent, cx| {
                use language::BufferEvent::*;
                if matches!(
                    event,
                    FileHandleChanged | ReloadNeeded | DirtyChanged | Saved | Reloaded
                ) {
                    let _ = model.update(cx, |_, cx| cx.notify());
                }
            })
            .detach();
        };
    let weak = model.downgrade();
    let open = workspace
        .read(cx)
        .items_of_type::<editor::Editor>(cx)
        .filter_map(|e| e.read(cx).buffer().read(cx).as_singleton())
        .collect::<Vec<_>>();
    for buffer in open {
        notify(&weak, &buffer, cx);
    }
    cx.observe_new(move |_: &mut language::Buffer, _, cx| {
        let buffer = cx.entity();
        notify(&weak, &buffer, cx);
    })
    .detach();
}

pub fn watch(model: &Entity<CampaignModel>, workspace: &Entity<Workspace>, cx: &mut App) {
    observe_buffers(model, workspace, cx);
    let fs = <dyn fs::Fs>::global(cx);
    let root = model.read(cx).store.root().to_path_buf();
    let model = model.downgrade();
    let workspace = workspace.downgrade();
    cx.spawn(async move |cx| {
        let (mut events, watcher) = fs.watch(&root, Duration::from_millis(200)).await;
        let initial_watcher = watcher.clone();
        let initial_root = root.clone();
        if let Err(error) = cx
            .background_executor()
            .spawn(async move { watch_tree(initial_watcher.as_ref(), &initial_root) })
            .await
        {
            report(&model, format!("Campaign watch failed: {error}"), cx);
        }
        while let Some(batch) = events.next().await {
            if model.upgrade().is_none() {
                break;
            }
            let mut paths = batch
                .into_iter()
                .map(|e| e.path)
                .filter(|path| {
                    path.strip_prefix(&root).is_ok_and(|relative| {
                        !relative
                            .components()
                            .any(|part| part.as_os_str().to_string_lossy().starts_with('.'))
                    })
                })
                .collect::<Vec<_>>();
            if paths.is_empty() {
                continue;
            }
            let tree_watcher = watcher.clone();
            let changed_paths = paths.clone();
            let discovered = cx
                .background_executor()
                .spawn(async move {
                    let mut files = Vec::new();
                    for path in changed_paths {
                        if std::fs::symlink_metadata(&path).is_ok_and(|m| m.is_dir()) {
                            files.extend(watch_tree(tree_watcher.as_ref(), &path)?);
                        }
                    }
                    Ok::<_, anyhow::Error>(files)
                })
                .await;
            match discovered {
                Ok(files) => paths.extend(files),
                Err(error) => report(&model, format!("Campaign watch failed: {error}"), cx),
            }
            paths.sort();
            paths.dedup();
            // Load metadata first: Markdown in newly added page directories
            // cannot be identified against the old catalogue.
            if paths.iter().any(|path| {
                path.extension().is_none()
                    || path.file_name().is_some_and(|name| {
                        name == "metadata.toml"
                            || name == "campaign.toml"
                            || name == "characters.toml"
                    })
            }) {
                if let Err(error) = reload_external(&model, cx).await {
                    report(&model, format!("External change: {error:#}"), cx);
                }
            }
            if let Err(error) = refresh_documents(&model, &workspace, &paths, cx).await {
                report(&model, format!("Index refresh failed: {error:#}"), cx);
            }
        }
    })
    .detach();
}
