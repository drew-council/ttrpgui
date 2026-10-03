use campaign_documents::{Catalogue, DocumentId};
use campaign_domain::*;
use campaign_storage::CampaignStore;
use gpui::{App, AppContext, Context, Entity, EventEmitter, WeakEntity, Window};
use std::path::PathBuf;
use workspace::Workspace;

pub struct CampaignModel {
    pub engine: CampaignEngine,
    pub store: super::persistence::Persistence,
    pub saves_pending: usize,
    save_serial: u64,
    restoring: bool,
    pub catalogue: Catalogue,
    pub error: Option<String>,
    pub dirty: bool,
    pub has_recovery: bool,
    pub index: campaign_documents::SearchIndex,
    pub document_revision: u64,
}
pub struct ActiveCampaign(pub Entity<CampaignModel>);
impl gpui::Global for ActiveCampaign {}
impl EventEmitter<()> for CampaignModel {}
impl CampaignModel {
    pub fn open(root: PathBuf) -> anyhow::Result<Self> {
        let (store, state) = if root.join("campaign.toml").exists() {
            CampaignStore::open(&root)?
        } else {
            let mut engine = CampaignEngine::new(Campaign::new("My campaign"))?;
            engine.execute(Command::CreateSession(Session::new("Session 1")))?;
            let welcome = Note::new("Welcome");
            let id = welcome.id;
            engine.execute(Command::CreateNote(welcome))?;
            let state = engine.state().clone();
            let store = CampaignStore::create(&root, &state)?;
            std::fs::write(
                root.join(format!("notes/{id}/notes.md")),
                "# Welcome\n\nCreate creatures and locations in the campaign navigator, then add an encounter to a session.\n\nNotes use ordinary Markdown. Vim is enabled. Use Ctrl+Alt+M to switch source presentation.\n",
            )?;
            (store, state)
        };
        let catalogue = Catalogue::from_campaign(&state);
        let has_recovery = store.unsaved()?.is_some();
        let index = campaign_documents::SearchIndex::load(store.root(), &catalogue)?;
        Ok(Self {
            engine: CampaignEngine::new(state)?,
            store: super::persistence::Persistence::new(store)?,
            saves_pending: 0,
            save_serial: 0,
            restoring: false,
            catalogue,
            error: None,
            dirty: false,
            has_recovery,
            index,
            document_revision: 1,
        })
    }
    pub fn execute(&mut self, command: Command, cx: &mut Context<Self>) -> Option<Change> {
        if self.restoring {
            self.error = Some("Recovery is still being saved".into());
            cx.notify();
            return None;
        }
        match self.engine.execute(command) {
            Ok(change) => {
                if change.changed {
                    self.changed(cx);
                }
                Some(change)
            }
            Err(error) => {
                self.error = Some(error.to_string());
                cx.notify();
                None
            }
        }
    }
    pub fn undo(&mut self, cx: &mut Context<Self>) {
        if self.restoring {
            return;
        }
        if self.engine.undo() {
            self.changed(cx);
        }
    }
    pub fn redo(&mut self, cx: &mut Context<Self>) {
        if self.restoring {
            return;
        }
        if self.engine.redo() {
            self.changed(cx);
        }
    }
    fn changed(&mut self, cx: &mut Context<Self>) {
        self.dirty = true;
        self.catalogue = Catalogue::from_campaign(self.engine.state());
        self.save(cx);
        cx.emit(());
    }
    pub fn save(&mut self, cx: &mut Context<Self>) {
        self.dirty = true;
        self.saves_pending += 1;
        self.save_serial += 1;
        let serial = self.save_serial;
        let saved = self.store.save(self.engine.state().clone());
        cx.spawn(async move |model, cx| {
            let result = saved.await;
            let _ = model.update(cx, |m, cx| {
                m.saves_pending -= 1;
                if serial == m.save_serial {
                    match result {
                        Ok(()) => {
                            m.error = None;
                            m.dirty = false;
                            m.has_recovery = false;
                        }
                        Err(error) => {
                            m.error = Some(format!("{error:#}"));
                            m.has_recovery =
                                error.to_string().contains("unsaved recovery preserved");
                        }
                    }
                }
                cx.emit(());
                cx.notify();
            });
        })
        .detach();
        cx.notify();
    }

    pub fn restore_unsaved(&mut self, cx: &mut Context<Self>) {
        if self.restoring {
            return;
        }
        self.restoring = true;
        let recovered = self.store.request(|store| store.restore_unsaved());
        cx.spawn(async move |model, cx| {
            let result = recovered.await;
            let _ = model.update(cx, |m, cx| {
                m.restoring = false;
                match result.and_then(|state| CampaignEngine::new(state).map_err(Into::into)) {
                    Ok(engine) => {
                        m.engine = engine;
                        m.catalogue = Catalogue::from_campaign(m.engine.state());
                        m.dirty = false;
                        m.has_recovery = false;
                        m.error = None;
                        cx.emit(());
                    }
                    Err(error) => m.error = Some(format!("Recovery failed: {error:#}")),
                }
                cx.notify();
            });
        })
        .detach();
    }
}

pub async fn wait_saved(
    model: &Entity<CampaignModel>,
    cx: &mut gpui::AsyncApp,
) -> anyhow::Result<()> {
    let barrier = model.read_with(cx, |m, _| m.store.barrier());
    barrier.await?;
    while model.read_with(cx, |m, _| m.saves_pending > 0 || m.restoring) {
        cx.background_executor()
            .timer(std::time::Duration::from_millis(5))
            .await;
    }
    model.read_with(cx, |m, _| {
        anyhow::ensure!(
            !m.dirty,
            "{}",
            m.error.as_deref().unwrap_or("Campaign has unsaved changes")
        );
        Ok(())
    })
}

// Linux's upstream watcher is non-recursive. Register each directory and scan
// new directories immediately so files created before registration aren't lost.
fn watch_tree(watcher: &dyn fs::Watcher, root: &std::path::Path) -> anyhow::Result<Vec<PathBuf>> {
    let mut pending = vec![root.to_path_buf()];
    let mut files = Vec::new();
    while let Some(directory) = pending.pop() {
        watcher.add(&directory)?;
        for entry in std::fs::read_dir(directory)? {
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

pub fn watch(model: &Entity<CampaignModel>, workspace: &Entity<Workspace>, cx: &mut App) {
    use futures::StreamExt;
    let fs = <dyn fs::Fs>::global(cx);
    let root = model.read(cx).store.root().to_path_buf();
    let weak = model.downgrade();
    let workspace = workspace.downgrade();
    cx.spawn(async move |cx| {
        let (mut events,watcher)=fs.watch(&root,std::time::Duration::from_millis(200)).await;
        let initial_watcher=watcher.clone(); let initial_root=root.clone();
        if let Err(error)=cx.background_executor().spawn(async move { watch_tree(initial_watcher.as_ref(),&initial_root) }).await {
            let _=weak.update(cx,|m,cx| {m.error=Some(format!("Campaign watch failed: {error}"));cx.notify();});
        }
        while let Some(mut batch)=events.next().await {
            batch.retain(|event|event.path.strip_prefix(&root).is_ok_and(|relative|!relative.components().any(|part|part.as_os_str().to_string_lossy().starts_with('.'))));
            let changed_paths=batch.iter().map(|e|e.path.clone()).collect::<Vec<_>>();
            let tree_watcher=watcher.clone();
            let discovered=cx.background_executor().spawn(async move {
                let mut paths=Vec::new();
                for path in changed_paths {
                    if std::fs::symlink_metadata(&path).is_ok_and(|m|m.is_dir()) {
                        paths.extend(watch_tree(tree_watcher.as_ref(),&path)?);
                    }
                }
                Ok::<_,anyhow::Error>(paths)
            }).await;
            match discovered {
                Ok(paths)=>batch.extend(paths.into_iter().map(|path|fs::PathEvent {path,kind:Some(fs::PathEventKind::Changed)})),
                Err(error)=> {let _=weak.update(cx,|m,cx| {m.error=Some(format!("Campaign watch failed: {error}"));cx.notify();});},
            }
            // An open buffer wins over disk, including dirty conflict contents.
            // Reserve revisions before I/O so later editor changes always win.
            let jobs=weak.update(cx,|model,cx| {
                let open=workspace.upgrade().map(|w|w.read(cx).items_of_type::<editor::Editor>(cx).filter_map(|e| {
                    let view=e.read(cx); let buffer=view.buffer().read(cx).as_singleton()?;
                    let path=buffer.read(cx).file()?.as_local()?.abs_path(cx);
                    Some((path,view.text(cx)))
                }).collect::<std::collections::BTreeMap<_,_>>()).unwrap_or_default();
                let mut jobs=Vec::new();
                for event in &batch {
                    if event.path.extension().is_none_or(|e|e!="md") { continue; }
                    let Some(id)=model.catalogue.documents.values().find(|d|model.store.root().join(&d.path)==event.path.as_path()).map(|d|d.id) else { continue; };
                    model.document_revision+=1;
                    jobs.push((id,model.document_revision,event.path.to_path_buf(),open.get(event.path.as_path()).cloned()));
                }
                jobs
            });
            let Ok(jobs)=jobs else { break; };
            if !jobs.is_empty() {
                let parse=cx.background_executor().spawn(async move {
                    jobs.into_iter().map(|(id,revision,path,open)| {
                        let text=match open { Some(text)=>Ok(text),None=>std::fs::read_to_string(path) };
                        let text=match text { Err(error) if error.kind()==std::io::ErrorKind::NotFound=>Ok(String::new()), other=>other };
                        text.map(|text|campaign_documents::PreparedDocument::new(id,revision,text))
                    }).collect::<Vec<_>>()
                });
                let parsed=parse.await;
                let _=weak.update(cx,|model,cx| {
                    for result in parsed {
                        match result {
                            Ok(document)=> { model.index.apply(document); },
                            Err(error)=>model.error=Some(format!("Index refresh failed: {error}")),
                        }
                    }
                    cx.notify();
                });
            }
            if !batch.iter().any(|event|event.path.file_name().is_some_and(|name|name=="metadata.toml"||name=="campaign.toml"||name=="characters.toml")) { continue; }
            let poll=weak.update(cx,|m,_|m.store.request(|store|store.external_snapshot()));
            let Ok(poll)=poll else {break;};
            match poll.await {
                Ok(Some(snapshot))=> {
                    let followup=weak.update(cx,|m,cx| {
                        if m.dirty || m.saves_pending>0 || m.restoring {
                            let state=m.engine.state().clone();
                            m.error=Some("External edits conflict with unsaved changes; both versions are preserved".into());
                            cx.notify();
                            m.store.request(move |store|store.preserve_unsaved(&state))
                        } else {
                            m.engine=CampaignEngine::new(snapshot.campaign.clone()).expect("Storage validated external campaign");
                            m.catalogue=Catalogue::from_campaign(m.engine.state());
                            cx.emit(()); cx.notify();
                            m.store.request(move |store|store.accept_external(snapshot))
                        }
                    });
                    if let Ok(followup)=followup {
                        let result=followup.await;
                        let _=weak.update(cx,|m,cx| {
                            if let Err(error)=result {m.error=Some(format!("External change: {error:#}"));m.dirty=true;}
                            else if m.dirty {m.has_recovery=true;}
                            cx.notify();
                        });
                    }
                },
                Ok(None)=>(),
                Err(error)=> {let _=weak.update(cx,|m,cx| {m.error=Some(format!("External change: {error:#}"));cx.notify();});},
            }
        }
    }).detach();
}

pub fn open_document(
    model: &Entity<CampaignModel>,
    workspace: &WeakEntity<Workspace>,
    id: DocumentId,
    window: &mut Window,
    cx: &mut App,
) {
    open_document_heading(model, workspace, id, None, window, cx)
}

pub fn open_document_heading(
    model: &Entity<CampaignModel>,
    workspace: &WeakEntity<Workspace>,
    id: DocumentId,
    heading: Option<String>,
    window: &mut Window,
    cx: &mut App,
) {
    let Some(workspace) = workspace.upgrade() else {
        return;
    };
    if let Some(panel) = workspace.read(cx).panel::<super::navigator::Navigator>(cx) {
        cx.defer(move |cx| panel.update(cx, |panel, cx| panel.show_related(id, cx)));
    }
    if let DocumentId::Encounter(id) = id {
        let existing = workspace
            .read(cx)
            .items_of_type::<super::encounter::EncounterView>(cx)
            .find(|view| view.read(cx).encounter_id() == id);
        if let Some(existing) = existing {
            workspace.update(cx, |w, cx| {
                w.activate_item(&existing, true, true, window, cx)
            });
            return;
        }
        let item = cx.new(|cx| {
            super::encounter::EncounterView::new(model.clone(), workspace.downgrade(), id, cx)
        });
        workspace.update(cx, |w, cx| {
            w.add_item_to_active_pane(Box::new(item), None, true, window, cx)
        });
    } else {
        let state = model.read(cx);
        let Some(document) = state.catalogue.documents.get(&id) else {
            return;
        };
        let path = state.store.root().join(&document.path);
        let barrier = model.read(cx).store.barrier();
        let opening_workspace = workspace.clone();
        let opening_window = window.window_handle();
        let task = cx.spawn(async move |cx| {
            barrier.await?;
            cx.update_window(opening_window, |_, window, cx| {
                opening_workspace.update(cx, |w, cx| {
                    w.open_abs_path(path, Default::default(), window, cx)
                })
            })?
            .await
        });
        let model = model.downgrade();
        let window_handle = window.window_handle();
        cx.spawn(async move |cx| match task.await {
            Ok(item) => {
                if let Some(editor) = cx.update(|cx| item.act_as::<editor::Editor>(cx)) {
                    let _ = model.update(cx, |m, cx| {
                        if let Some(document) = m.catalogue.documents.get(&id) {
                            editor.read(cx).buffer().clone().update(cx, |buffer, cx| {
                                buffer.set_title(document.name.clone(), cx)
                            });
                        }
                    });
                    if let Some(heading) = heading {
                        let _ = cx.update_window(window_handle, |_, window, cx| {
                            editor.update(cx, |e, cx| {
                                if let Some(offset) =
                                    campaign_documents::heading_offset(&e.text(cx), &heading)
                                {
                                    let offset = editor::MultiBufferOffset(offset);
                                    e.change_selections(Default::default(), window, cx, |s| {
                                        s.select_ranges([offset..offset])
                                    });
                                }
                            });
                        });
                    }
                }
            }
            Err(error) => {
                let _ = model.update(cx, |m, cx| {
                    m.error = Some(format!("Open failed: {error:#}"));
                    cx.notify();
                });
            }
        })
        .detach();
    }
}
