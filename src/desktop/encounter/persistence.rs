use super::*;

#[derive(serde::Serialize, serde::Deserialize)]
struct SavedEncounter {
    campaign: CampaignId,
    encounter: EncounterId,
    cursor: Option<ParticipantId>,
    selected: BTreeSet<ParticipantId>,
}
impl workspace::item::SerializableItem for EncounterView {
    fn serialized_item_kind() -> &'static str {
        "CampaignEncounter"
    }
    fn cleanup(
        _: workspace::WorkspaceId,
        _: Vec<u64>,
        _: &mut Window,
        _: &mut App,
    ) -> Task<anyhow::Result<()>> {
        Task::ready(Ok(()))
    }
    fn deserialize(
        _: Entity<project::Project>,
        workspace: WeakEntity<Workspace>,
        workspace_id: workspace::WorkspaceId,
        item: u64,
        _: &mut Window,
        cx: &mut App,
    ) -> Task<anyhow::Result<Entity<Self>>> {
        let result = (|| -> anyhow::Result<Entity<Self>> {
            let model = cx
                .global::<crate::desktop::campaign::ActiveCampaign>()
                .0
                .clone();
            let json = db::kvp::KeyValueStore::global(cx)
                .read_kvp(&format!("campaign-item/{workspace_id:?}/{item}"))?
                .ok_or_else(|| anyhow::anyhow!("Encounter tab state is missing"))?;
            let saved: SavedEncounter = serde_json::from_str(&json)?;
            anyhow::ensure!(
                model.read(cx).engine.state().config.id == saved.campaign,
                "Encounter tab belongs to another campaign"
            );
            anyhow::ensure!(
                model
                    .read(cx)
                    .engine
                    .state()
                    .encounters
                    .contains_key(&saved.encounter),
                "Encounter was removed"
            );
            Ok(cx.new(|cx| {
                let mut view = Self::new(model, workspace, saved.encounter, cx);
                view.cursor = saved.cursor;
                view.selected = saved.selected;
                view.reconcile(cx);
                view
            }))
        })();
        Task::ready(result)
    }
    fn serialize(
        &mut self,
        workspace: &mut Workspace,
        item: u64,
        _: bool,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) -> Option<Task<anyhow::Result<()>>> {
        self.reconcile(cx);
        let workspace_id = workspace.database_id()?;
        let saved = SavedEncounter {
            campaign: self.model.read(cx).engine.state().config.id,
            encounter: self.id,
            cursor: self.cursor,
            selected: self.selected.clone(),
        };
        let json = match serde_json::to_string(&saved) {
            Ok(json) => json,
            Err(error) => return Some(Task::ready(Err(error.into()))),
        };
        let db = db::kvp::KeyValueStore::global(cx);
        Some(cx.spawn(async move |_, _| {
            db.write_kvp(format!("campaign-item/{workspace_id:?}/{item}"), json)
                .await
        }))
    }
    fn should_serialize(&self, _: &()) -> bool {
        true
    }
}
