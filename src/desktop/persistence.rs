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
#[derive(Clone)]
pub struct Persistence {
    root: PathBuf,
    sender: mpsc::Sender<Job>,
}
impl Persistence {
    pub fn new(mut store: CampaignStore) -> anyhow::Result<Self> {
        let root = store.root().to_path_buf();
        let (sender, receiver) = mpsc::channel::<Job>();
        std::thread::Builder::new()
            .name("campaign-storage".into())
            .spawn(move || {
                while let Ok(job) = receiver.recv() {
                    job(&mut store);
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
        let queued = self.sender.send(Box::new(move |store| {
            let _ = send.send(operation(store));
        }));
        async move {
            queued.map_err(|_| anyhow::anyhow!("Campaign storage worker stopped"))?;
            receive
                .await
                .map_err(|_| anyhow::anyhow!("Campaign storage worker stopped"))?
        }
        .boxed()
    }
    pub fn save(&self, campaign: Campaign) -> BoxFuture<'static, anyhow::Result<()>> {
        self.request(move |store| {
            if let Err(error) = store.save(&campaign) {
                if let Err(recovery) = store.preserve_unsaved(&campaign) {
                    anyhow::bail!(
                        "Save failed: {error:#}; recovery copy also failed: {recovery:#}"
                    );
                }
                anyhow::bail!("Save failed: {error:#}; unsaved recovery preserved");
            }
            store.clear_unsaved()?;
            Ok(())
        })
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
            .send(Box::new(move |_| {
                let _ = send.send(());
            }))
            .map_err(|_| anyhow::anyhow!("Campaign storage worker stopped"))?;
        receive.recv().map_err(Into::into)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
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
        release.send(()).unwrap();
        drop(blocked);
        persistence.finish().unwrap();
        let loaded =
            futures::executor::block_on(persistence.request(|store| store.reload())).unwrap();
        assert_eq!(loaded, campaign);
        drop(persistence);
        std::fs::remove_dir_all(root).unwrap();
    }
}
