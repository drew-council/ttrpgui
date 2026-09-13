use campaign_documents::{Catalogue, DocumentId};
use campaign_domain::*;
use campaign_storage::CampaignStore;
use gpui::{App, AppContext, Context, Entity, EventEmitter, WeakEntity, Window};
use std::path::PathBuf;
use workspace::Workspace;

pub struct CampaignModel {
    pub engine: CampaignEngine,
    pub store: CampaignStore,
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
            store,
            catalogue,
            error: None,
            dirty: false,
            has_recovery,
            index,
            document_revision: 1,
        })
    }
    pub fn execute(&mut self, command: Command, cx: &mut Context<Self>) -> Option<Change> {
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
        if self.engine.undo() {
            self.changed(cx);
        }
    }
    pub fn redo(&mut self, cx: &mut Context<Self>) {
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
        match self.store.save(self.engine.state()) {
            Ok(()) => {
                self.error = None;
                self.dirty = false;
                if let Err(error) = self.store.clear_unsaved() {
                    self.error = Some(format!("Saved, but recovery cleanup failed: {error}"));
                }
                self.has_recovery = false;
            }
            Err(error) => {
                self.error = Some(format!("Save failed: {error:#}"));
                match self.store.preserve_unsaved(self.engine.state()) {
                    Ok(()) => self.has_recovery = true,
                    Err(recovery) => {
                        self.error = Some(format!(
                            "Save failed: {error:#}; recovery copy also failed: {recovery:#}"
                        ))
                    }
                }
            }
        }
        cx.notify();
    }

    pub fn restore_unsaved(&mut self, cx: &mut Context<Self>) {
        let result = (|| -> anyhow::Result<()> {
            let recovered = self
                .store
                .unsaved()?
                .ok_or_else(|| anyhow::anyhow!("No recovery copy exists"))?;
            anyhow::ensure!(
                recovered.config.id == self.engine.state().config.id,
                "Recovery belongs to another campaign"
            );
            self.engine = CampaignEngine::new(recovered)?;
            Ok(())
        })();
        match result {
            Ok(()) => self.changed(cx),
            Err(error) => {
                self.error = Some(error.to_string());
                cx.notify();
            }
        }
    }
}

pub fn watch(model: &Entity<CampaignModel>, cx: &mut App) {
    use futures::StreamExt;
    let fs = <dyn fs::Fs>::global(cx);
    let root = model.read(cx).store.root().to_path_buf();
    let weak = model.downgrade();
    cx.spawn(async move |cx| {
        let (mut events,_watcher)=fs.watch(&root,std::time::Duration::from_millis(200)).await;
        while let Some(batch)=events.next().await {
            if !batch.iter().any(|event|event.path.extension().is_some_and(|e|e=="toml")) { continue; }
            if weak.update(cx,|model,cx| {
                let result=(||->anyhow::Result<()> {
                    if !model.store.has_external_changes()? { return Ok(()); }
                    if model.dirty {
                        model.store.preserve_unsaved(model.engine.state())?;
                        model.has_recovery=true;
                        anyhow::bail!("External edits conflict with unsaved changes; disk and recovery versions are preserved");
                    }
                    model.engine=CampaignEngine::new(model.store.reload()?)?;
                    model.catalogue=Catalogue::from_campaign(model.engine.state());
                    model.error=None;
                    cx.emit(());
                    Ok(())
                })();
                if let Err(error)=result { model.error=Some(format!("External change: {error:#}")); }
                cx.notify();
            }).is_err() { break; }
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
    let Some(workspace) = workspace.upgrade() else {
        return;
    };
    if let DocumentId::Encounter(id) = id {
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
        let task = workspace.update(cx, |w, cx| {
            w.open_abs_path(path, Default::default(), window, cx)
        });
        let model = model.downgrade();
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
