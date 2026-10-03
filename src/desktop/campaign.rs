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
    pub(super) link_updates_pending: usize,
    pub(super) link_error: Option<String>,
    pub(super) save_serial: u64,
    pub(super) restoring: bool,
    pub catalogue: std::sync::Arc<Catalogue>,
    catalogue_revision: u64,
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
            link_updates_pending: 0,
            link_error: None,
            save_serial: 0,
            restoring: false,
            catalogue: std::sync::Arc::new(catalogue),
            catalogue_revision: 0,
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
    pub(super) fn replace_catalogue(&mut self) {
        let next = Catalogue::from_campaign(self.engine.state());
        for id in self.catalogue.documents.keys() {
            if !next.documents.contains_key(id) {
                self.index.remove(*id);
            }
        }
        self.catalogue = std::sync::Arc::new(next);
        self.catalogue_revision = self.engine.documents_revision();
    }
    fn changed(&mut self, cx: &mut Context<Self>) {
        self.dirty = true;
        if self.catalogue_revision != self.engine.documents_revision() {
            self.replace_catalogue();
        }
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
                            if let Some(failure) =
                                error.downcast_ref::<super::persistence::SaveFailure>()
                            {
                                m.has_recovery = failure.recovery_preserved;
                            }
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
        self.save_serial += 1;
        let recovered = self.store.request(|store| store.restore_unsaved());
        cx.spawn(async move |model, cx| {
            let result = recovered.await;
            let _ = model.update(cx, |m, cx| {
                m.restoring = false;
                match result.and_then(|state| CampaignEngine::new(state).map_err(Into::into)) {
                    Ok(engine) => {
                        m.engine = engine;
                        m.replace_catalogue();
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
    wait_structured_saved(model, cx).await?;
    while model.read_with(cx, |m, _| m.link_updates_pending > 0) {
        cx.background_executor()
            .timer(std::time::Duration::from_millis(5))
            .await;
    }
    wait_structured_saved(model, cx).await?;
    model.read_with(cx, |m, _| {
        anyhow::ensure!(
            m.link_error.is_none(),
            "{}",
            m.link_error.as_deref().unwrap_or_default()
        );
        Ok(())
    })
}

pub(super) async fn wait_structured_saved(
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
