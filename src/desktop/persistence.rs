//! A single disk worker owns the campaign lock and serializes every mutation.
//! Requests are queued before futures are returned, so dropping a view cannot
//! cancel an already-authorized save.
use campaign_domain::Campaign;
use campaign_storage::CampaignStore;
use futures::{FutureExt, future::BoxFuture};
use std::{
    path::{Path, PathBuf},
    sync::mpsc,
};

type Job = Box<dyn FnOnce(&mut CampaignStore) + Send>;

enum Work {
    Request(Job),
    Save(
        Campaign,
        futures::channel::oneshot::Sender<Result<(), SaveFailure>>,
    ),
}

#[derive(Debug, Clone)]
pub struct SaveFailure {
    pub recovery_preserved: bool,
    message: String,
}
impl std::fmt::Display for SaveFailure {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}
impl std::error::Error for SaveFailure {}
#[derive(Clone)]
pub struct Persistence {
    root: PathBuf,
    sender: mpsc::Sender<Work>,
}
impl Persistence {
    pub fn new(mut store: CampaignStore) -> anyhow::Result<Self> {
        let root = store.root().to_path_buf();
        let (sender, receiver) = mpsc::channel::<Work>();
        std::thread::Builder::new()
            .name("campaign-storage".into())
            .spawn(move || {
                let mut pending = None;
                while let Some(work) = pending.take().or_else(|| receiver.recv().ok()) {
                    match work {
                        Work::Request(job) => job(&mut store),
                        Work::Save(mut campaign, reply) => {
                            let mut replies = vec![reply];
                            // Coalesce only contiguous snapshots. A document
                            // edit, recovery operation or barrier retains its
                            // exact place in the persistence sequence.
                            while let Ok(next) = receiver.try_recv() {
                                match next {
                                    Work::Save(newest, reply) => {
                                        campaign = newest;
                                        replies.push(reply);
                                    }
                                    request => {
                                        pending = Some(request);
                                        break;
                                    }
                                }
                            }
                            let result = save_snapshot(&mut store, &campaign);
                            for reply in replies {
                                let _ = reply.send(result.clone());
                            }
                        }
                    }
                }
            })?;
        Ok(Self { root, sender })
    }
    pub fn root(&self) -> &Path {
        &self.root
    }
    pub fn request<T: Send + 'static>(
        &self,
        operation: impl FnOnce(&mut CampaignStore) -> anyhow::Result<T> + Send + 'static,
    ) -> BoxFuture<'static, anyhow::Result<T>> {
        let (send, receive) = futures::channel::oneshot::channel();
        let queued = self.sender.send(Work::Request(Box::new(move |store| {
            let _ = send.send(operation(store));
        })));
        async move {
            queued.map_err(|_| anyhow::anyhow!("Campaign storage worker stopped"))?;
            receive
                .await
                .map_err(|_| anyhow::anyhow!("Campaign storage worker stopped"))?
        }
        .boxed()
    }
    pub fn save(&self, campaign: Campaign) -> BoxFuture<'static, anyhow::Result<()>> {
        let (send, receive) = futures::channel::oneshot::channel();
        let queued = self.sender.send(Work::Save(campaign, send));
        async move {
            queued.map_err(|_| anyhow::anyhow!("Campaign storage worker stopped"))?;
            receive
                .await
                .map_err(|_| anyhow::anyhow!("Campaign storage worker stopped"))?
                .map_err(Into::into)
        }
        .boxed()
    }
    pub fn edit_documents(
        &self,
        edits: std::collections::BTreeMap<String, (String, String)>,
    ) -> BoxFuture<'static, anyhow::Result<()>> {
        self.request(move |store| store.edit_documents(edits))
    }
    pub fn barrier(&self) -> BoxFuture<'static, anyhow::Result<()>> {
        self.request(|_| Ok(()))
    }
    /// After GPUI's event loop exits, drain saves before the process exits.
    /// This never blocks a rendered interaction and avoids GPUI's short quit timeout.
    pub fn finish(&self) -> anyhow::Result<()> {
        let (send, receive) = mpsc::sync_channel(1);
        self.sender
            .send(Work::Request(Box::new(move |_| {
                let _ = send.send(());
            })))
            .map_err(|_| anyhow::anyhow!("Campaign storage worker stopped"))?;
        receive.recv().map_err(Into::into)
    }
}

fn save_snapshot(store: &mut CampaignStore, campaign: &Campaign) -> Result<(), SaveFailure> {
    if let Err(error) = store.save(campaign) {
        let recovery = store.preserve_unsaved(campaign);
        let recovery_preserved = recovery.is_ok();
        let message = match recovery {
            Ok(()) => format!("Save failed: {error:#}; unsaved recovery preserved"),
            Err(recovery) => {
                format!("Save failed: {error:#}; recovery copy also failed: {recovery:#}")
            }
        };
        return Err(SaveFailure {
            recovery_preserved,
            message,
        });
    }
    store.clear_unsaved().map_err(|error| SaveFailure {
        recovery_preserved: store.unsaved().ok().flatten().is_some(),
        message: format!("Campaign saved, but recovery cleanup failed: {error:#}"),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn failed_worker_save_reports_real_recovery_and_preserves_external_files() {
        let root =
            std::env::temp_dir().join(format!("ttrpgui-worker-test-{}", uuid::Uuid::new_v4()));
        let mut campaign = Campaign::new("Original");
        let store = CampaignStore::create(&root, &campaign).unwrap();
        let persistence = Persistence::new(store).unwrap();
        std::fs::write(root.join("campaign.toml"), "external malformed bytes").unwrap();
        campaign.config.name = "Unsaved work".into();
        let error = futures::executor::block_on(persistence.save(campaign.clone())).unwrap_err();
        assert!(
            error
                .downcast_ref::<SaveFailure>()
                .unwrap()
                .recovery_preserved
        );
        let recovery =
            futures::executor::block_on(persistence.request(|store| store.unsaved())).unwrap();
        assert_eq!(recovery, Some(campaign.clone()));
        assert_eq!(
            std::fs::read_to_string(root.join("campaign.toml")).unwrap(),
            "external malformed bytes"
        );
        std::fs::remove_file(root.join(".unsaved.toml")).unwrap();
        std::fs::create_dir(root.join(".unsaved.toml")).unwrap();
        let error = futures::executor::block_on(persistence.save(campaign)).unwrap_err();
        assert!(
            !error
                .downcast_ref::<SaveFailure>()
                .unwrap()
                .recovery_preserved
        );
        persistence.finish().unwrap();
        drop(persistence);
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn queued_saves_survive_dropped_futures_and_drain_in_order() {
        let root =
            std::env::temp_dir().join(format!("ttrpgui-worker-test-{}", uuid::Uuid::new_v4()));
        let mut campaign = Campaign::new("Initial");
        let store = CampaignStore::create(&root, &campaign).unwrap();
        let persistence = Persistence::new(store).unwrap();
        let (release, wait) = mpsc::sync_channel(1);
        let blocked = persistence.request(move |_| {
            wait.recv()?;
            Ok(())
        });
        campaign.config.name = "First".into();
        drop(persistence.save(campaign.clone()));
        campaign.config.name = "Second".into();
        drop(persistence.save(campaign.clone()));
        // Coalescing must stop at this read, even with a newer queued save.
        let intermediate = persistence.request(|store| store.reload());
        campaign.config.name = "Third".into();
        drop(persistence.save(campaign.clone()));
        release.send(()).unwrap();
        drop(blocked);
        let at_barrier = futures::executor::block_on(intermediate).unwrap();
        assert_eq!(at_barrier.config.name, "Second");
        persistence.finish().unwrap();
        let loaded =
            futures::executor::block_on(persistence.request(|store| store.reload())).unwrap();
        assert_eq!(loaded, campaign);
        drop(persistence);
        std::fs::remove_dir_all(root).unwrap();
    }
}
