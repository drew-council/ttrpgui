use super::{
    campaign::{CampaignModel, open_document},
    fields::Fields,
    navigator::{button, optional_number},
};
use campaign_documents::DocumentId;
use campaign_domain::*;
use gpui::{prelude::*, *};
use std::collections::BTreeSet;
use workspace::{Workspace, item::Item};

actions!(
    campaign,
    [
        CombatSelect,
        CombatDown,
        CombatUp,
        CombatFirst,
        CombatLast,
        CombatHeal,
        CombatDamage,
        CombatInitiative,
        CombatRename,
        CombatDescription,
        CombatAdd,
        CombatUndo,
        CombatRedo,
        CombatCancel,
        SubmitField,
        CancelField,
        NextField,
        PreviousField
    ]
);
pub fn init(cx: &mut App) {
    macro_rules! bind { ($($key:literal=>$action:ident),* $(,)?)=> { cx.bind_keys([$(KeyBinding::new($key,$action,Some("CampaignEncounter"))),*]); }; }
    bind!("space"=>CombatSelect,"j"=>CombatDown,"down"=>CombatDown,"k"=>CombatUp,"up"=>CombatUp,"g"=>CombatFirst,"shift-g"=>CombatLast,"home"=>CombatFirst,"end"=>CombatLast,"+"=>CombatHeal,"="=>CombatHeal,"-"=>CombatDamage,"i"=>CombatInitiative,"n"=>CombatRename,"d"=>CombatDescription,"a"=>CombatAdd,"u"=>CombatUndo,"ctrl-r"=>CombatRedo,"escape"=>CombatCancel);
    cx.bind_keys([
        KeyBinding::new(
            "enter",
            SubmitField,
            Some("CampaignField || CampaignField > Editor"),
        ),
        KeyBinding::new(
            "escape",
            CancelField,
            Some("CampaignField || CampaignField > Editor"),
        ),
        KeyBinding::new(
            "tab",
            NextField,
            Some("CampaignField || CampaignField > Editor"),
        ),
        KeyBinding::new(
            "shift-tab",
            PreviousField,
            Some("CampaignField || CampaignField > Editor"),
        ),
    ]);
}

#[derive(Clone, Copy)]
enum Edit {
    Health(i32),
    Initiative,
    Description,
    Rename,
    Add(CreatureId),
    Local,
    EncounterName,
    Location,
}
pub struct EncounterView {
    model: Entity<CampaignModel>,
    workspace: WeakEntity<Workspace>,
    id: EncounterId,
    focus: FocusHandle,
    cursor: Option<ParticipantId>,
    selected: BTreeSet<ParticipantId>,
    edit: Option<(Edit, Fields)>,
    library: bool,
    error: Option<String>,
    scroll: UniformListScrollHandle,
}
impl EncounterView {
    pub fn new(
        model: Entity<CampaignModel>,
        workspace: WeakEntity<Workspace>,
        id: EncounterId,
        cx: &mut Context<Self>,
    ) -> Self {
        cx.observe(&model, |this, _, cx| {
            this.reconcile(cx);
            cx.notify();
        })
        .detach();
        let cursor = model
            .read(cx)
            .engine
            .state()
            .encounters
            .get(&id)
            .and_then(|e| e.sorted_participants().first().map(|p| p.id));
        Self {
            model,
            workspace,
            id,
            focus: cx.focus_handle(),
            cursor,
            selected: BTreeSet::new(),
            edit: None,
            library: false,
            error: None,
            scroll: UniformListScrollHandle::new(),
        }
    }
    fn reconcile(&mut self, cx: &App) {
        if let Some(e) = self.model.read(cx).engine.state().encounters.get(&self.id) {
            self.selected.retain(|id| e.participants.contains_key(id));
            if !self
                .cursor
                .is_some_and(|id| e.participants.contains_key(&id))
            {
                self.cursor = e.sorted_participants().first().map(|p| p.id);
            }
        }
    }
    fn targets(&self) -> BTreeSet<ParticipantId> {
        if self.selected.is_empty() {
            self.cursor.into_iter().collect()
        } else {
            self.selected.clone()
        }
    }
    fn command(&mut self, command: Command, cx: &mut Context<Self>) {
        self.model.update(cx, |m, cx| m.execute(command, cx));
        self.reconcile(cx);
        cx.notify();
    }
    fn begin(&mut self, kind: Edit, window: &mut Window, cx: &mut Context<Self>) {
        let participant = self.cursor.and_then(|id| {
            self.model
                .read(cx)
                .engine
                .state()
                .encounters
                .get(&self.id)?
                .participants
                .get(&id)
        });
        let values = match kind {
            Edit::Health(_) => vec![("Amount", "1".into())],
            Edit::Initiative => vec![(
                "Initiative (blank = unknown)",
                participant
                    .and_then(|p| p.initiative)
                    .map(|i| i.to_string())
                    .unwrap_or_default(),
            )],
            Edit::Description => vec![(
                "Encounter description",
                participant
                    .map(|p| p.description.clone())
                    .unwrap_or_default(),
            )],
            Edit::Rename => vec![(
                "Name",
                participant
                    .map(|p| p.display_name().to_owned())
                    .unwrap_or_default(),
            )],
            Edit::EncounterName => vec![(
                "Encounter name",
                self.model.read(cx).engine.state().encounters[&self.id]
                    .name
                    .clone(),
            )],
            Edit::Location => vec![("Location name or alias (blank clears)", String::new())],
            Edit::Add(_) => vec![
                ("Quantity", "1".into()),
                ("Initiative (optional)", String::new()),
            ],
            Edit::Local => vec![
                ("Name", String::new()),
                ("Maximum HP", "10".into()),
                ("AC (optional)", String::new()),
                ("Quantity", "1".into()),
                ("Initiative (optional)", String::new()),
            ],
        };
        let fields = Fields::new(&values, window, cx);
        fields.focus(window, cx);
        self.edit = Some((kind, fields));
        self.library = false;
        self.error = None;
        cx.notify();
    }
    fn submit(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some((kind, fields)) = &self.edit else {
            return;
        };
        let encounter = self.id;
        let participants = self.targets();
        let command = (|| -> anyhow::Result<Command> {
            Ok(match kind {
                Edit::Health(sign) => {
                    let amount: i32 = fields.value(0, cx).trim().parse()?;
                    anyhow::ensure!(amount >= 0, "Amount must be nonnegative");
                    Command::AdjustHealth {
                        encounter,
                        participants,
                        delta: amount.saturating_mul(*sign),
                    }
                }
                Edit::Initiative => Command::SetInitiative {
                    encounter,
                    participants,
                    initiative: optional_number(&fields.value(0, cx))?,
                },
                Edit::Description => Command::SetDescription {
                    encounter,
                    participants,
                    description: fields.value(0, cx),
                },
                Edit::Rename => Command::RenameParticipant {
                    encounter,
                    participant: self
                        .cursor
                        .ok_or_else(|| anyhow::anyhow!("Choose a participant"))?,
                    name: fields.value(0, cx),
                },
                Edit::EncounterName => Command::RenameEncounter {
                    id: encounter,
                    name: fields.value(0, cx),
                },
                Edit::Location => {
                    let name = fields.value(0, cx);
                    let name = name.trim();
                    let location = if name.is_empty() {
                        None
                    } else {
                        let matches: Vec<_> = self
                            .model
                            .read(cx)
                            .engine
                            .state()
                            .locations
                            .values()
                            .filter(|l| {
                                l.name.eq_ignore_ascii_case(name)
                                    || l.aliases.iter().any(|a| a.eq_ignore_ascii_case(name))
                            })
                            .map(|l| l.id)
                            .collect();
                        anyhow::ensure!(
                            matches.len() == 1,
                            "Choose a unique location name or alias"
                        );
                        Some(matches[0])
                    };
                    Command::SetLocation {
                        encounter,
                        location,
                    }
                }
                Edit::Add(creature) => Command::AddCreatures {
                    encounter,
                    creature: *creature,
                    quantity: fields.value(0, cx).trim().parse()?,
                    initiative: optional_number(&fields.value(1, cx))?,
                },
                Edit::Local => Command::AddLocalCreature {
                    encounter,
                    creature: Creature::new(
                        fields.value(0, cx),
                        fields.value(1, cx).trim().parse()?,
                        optional_number(&fields.value(2, cx))?,
                        CreatureKind::Template,
                    ),
                    quantity: fields.value(3, cx).trim().parse()?,
                    initiative: optional_number(&fields.value(4, cx))?,
                },
            })
        })();
        match command {
            Ok(command) => {
                if let Some(change) = self.model.update(cx, |m, cx| m.execute(command, cx)) {
                    self.cursor = change.added_participants.first().copied().or(self.cursor);
                    self.edit = None;
                    self.error = None;
                    window.focus(&self.focus, cx);
                }
            }
            Err(error) => self.error = Some(error.to_string()),
        }
        cx.notify();
    }
    fn key(&mut self, event: &KeyDownEvent, window: &mut Window, cx: &mut Context<Self>) {
        let key = event.keystroke.key.as_str();
        if key == "tab" {
            if let Some((_, fields)) = &self.edit {
                fields.cycle(event.keystroke.modifiers.shift, window, cx);
            } else if event.keystroke.modifiers.shift {
                window.focus_prev(cx);
            } else {
                window.focus_next(cx);
            }
            cx.stop_propagation();
            return;
        }
        if self.edit.is_some() {
            match key {
                "enter" => self.submit(window, cx),
                "escape" => {
                    self.edit = None;
                    window.focus(&self.focus, cx);
                    cx.notify();
                }
                _ => return,
            }
            cx.stop_propagation();
            return;
        }
        if !self.focus.is_focused(window) {
            return;
        }
        match key {
            "j" | "down" | "k" | "up" | "g" | "home" | "end" => {
                let rows =
                    self.model.read(cx).engine.state().encounters[&self.id].sorted_participants();
                if rows.is_empty() {
                    return;
                }
                let current = rows
                    .iter()
                    .position(|p| Some(p.id) == self.cursor)
                    .unwrap_or(0);
                let next = match key {
                    "j" | "down" => (current + 1).min(rows.len() - 1),
                    "k" | "up" => current.saturating_sub(1),
                    "end" => rows.len() - 1,
                    "g" if event.keystroke.modifiers.shift => rows.len() - 1,
                    _ => 0,
                };
                self.cursor = Some(rows[next].id);
                self.scroll.scroll_to_item(next, ScrollStrategy::Top);
            }
            "space" => {
                if let Some(id) = self.cursor {
                    if !self.selected.remove(&id) {
                        self.selected.insert(id);
                    }
                }
            }
            "+" | "=" => self.begin(Edit::Health(1), window, cx),
            "-" => self.begin(Edit::Health(-1), window, cx),
            "i" => self.begin(Edit::Initiative, window, cx),
            "n" => self.begin(Edit::Rename, window, cx),
            "d" => self.begin(Edit::Description, window, cx),
            "a" => self.library = true,
            "u" => self.model.update(cx, |m, cx| m.undo(cx)),
            "r" if event.keystroke.modifiers.control => self.model.update(cx, |m, cx| m.redo(cx)),
            "escape" => {
                self.selected.clear();
                self.library = false;
            }
            _ => return,
        }
        cx.stop_propagation();
        cx.emit(());
        cx.notify();
    }
}
impl Focusable for EncounterView {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}
impl EventEmitter<()> for EncounterView {}
impl Item for EncounterView {
    type Event = ();
    fn can_split(&self) -> bool {
        true
    }
    fn clone_on_split(
        &self,
        _: Option<workspace::WorkspaceId>,
        _: &mut Window,
        cx: &mut Context<Self>,
    ) -> Task<Option<Entity<Self>>> {
        let model = self.model.clone();
        let workspace = self.workspace.clone();
        let id = self.id;
        let cursor = self.cursor;
        let selected = self.selected.clone();
        let view = cx.new(|cx| {
            let mut view = Self::new(model, workspace, id, cx);
            view.cursor = cursor;
            view.selected = selected;
            view
        });
        Task::ready(Some(view))
    }
    fn tab_content_text(&self, _: usize, cx: &App) -> SharedString {
        self.model
            .read(cx)
            .engine
            .state()
            .encounters
            .get(&self.id)
            .map(|e| e.name.clone())
            .unwrap_or_else(|| "Encounter removed".into())
            .into()
    }
    fn is_dirty(&self, cx: &App) -> bool {
        self.model.read(cx).dirty
    }
}

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
            let model = cx.global::<super::campaign::ActiveCampaign>().0.clone();
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
impl Render for EncounterView {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let state = self.model.read(cx);
        let Some(encounter) = state.engine.state().encounters.get(&self.id).cloned() else {
            return div()
                .id("removed-encounter")
                .p_4()
                .child("This encounter was removed by undo.");
        };
        let rows = encounter
            .sorted_participants()
            .into_iter()
            .cloned()
            .collect::<Vec<_>>();
        let library = state
            .engine
            .state()
            .creatures
            .values()
            .cloned()
            .collect::<Vec<_>>();
        let error = self.error.clone().or_else(|| state.error.clone());
        let mut root = div()
            .id("encounter")
            .track_focus(&self.focus)
            .key_context(if self.edit.is_some() {
                "CampaignField"
            } else if self.focus.is_focused(window) {
                "CampaignEncounter"
            } else {
                "CampaignControls"
            })
            .tab_group()
            .size_full()
            .flex()
            .flex_col()
            .gap_3()
            .p_4()
            .bg(rgb(0x1e1e2e))
            .text_color(rgb(0xcdd6f4))
            .capture_key_down(cx.listener(Self::key))
            .on_mouse_down(
                MouseButton::Left,
                cx.listener(|this, _, window, cx| {
                    if this.edit.is_none() {
                        window.focus(&this.focus, cx);
                    }
                }),
            )
            .child(
                div()
                    .flex()
                    .justify_between()
                    .child(div().text_xl().child(encounter.name.clone()))
                    .child(format!("{:?}", encounter.status)),
            )
            .child(button(
                "parent-session",
                "Open session notes",
                cx.listener(move |this, _, window, cx| {
                    open_document(
                        &this.model,
                        &this.workspace,
                        DocumentId::Session(encounter.session),
                        window,
                        cx,
                    )
                }),
            ));
        macro_rules! handler { ($($action:ident=>$key:literal),* $(,)?)=> { $(root=root.on_action(cx.listener(|this,_:&$action,window,cx|this.key(&KeyDownEvent { keystroke:Keystroke::parse($key).unwrap(),is_held:false,prefer_character_input:false },window,cx)));)* }; }
        handler!(CombatSelect=>"space",CombatDown=>"j",CombatUp=>"k",CombatFirst=>"g",CombatLast=>"end",CombatHeal=>"+",CombatDamage=>"-",CombatInitiative=>"i",CombatRename=>"n",CombatDescription=>"d",CombatAdd=>"a",CombatUndo=>"u",CombatRedo=>"ctrl-r",CombatCancel=>"escape",SubmitField=>"enter",CancelField=>"escape",NextField=>"tab",PreviousField=>"shift-tab");
        if let Some(error) = error {
            root = root.child(
                div()
                    .p_2()
                    .border_1()
                    .border_color(rgb(0xf38ba8))
                    .child(error),
            );
        }
        if let Some(location) = encounter.location {
            root = root.child(button(
                "encounter-location",
                "Open location",
                cx.listener(move |this, _, window, cx| {
                    open_document(
                        &this.model,
                        &this.workspace,
                        DocumentId::Location(location),
                        window,
                        cx,
                    )
                }),
            ));
        }
        if let Some((_, fields)) = &self.edit {
            return root
                .child(fields.render(cx))
                .child(button(
                    "apply",
                    "Apply · Enter",
                    cx.listener(|this, _, window, cx| this.submit(window, cx)),
                ))
                .child(button(
                    "cancel",
                    "Cancel · Esc",
                    cx.listener(|this, _, window, cx| {
                        this.edit = None;
                        window.focus(&this.focus, cx);
                        cx.notify();
                    }),
                ));
        }
        if self.library {
            let mut choices = div()
                .id("creature-library")
                .overflow_y_scroll()
                .flex()
                .flex_col()
                .gap_2()
                .child("Add from campaign library")
                .child(button(
                    "new-local",
                    "Create new encounter creature",
                    cx.listener(|this, _, window, cx| this.begin(Edit::Local, window, cx)),
                ));
            for creature in library {
                choices = choices.child(button(
                    format!("library-{}", creature.id),
                    &format!("{} · {} HP", creature.name, creature.max_hp),
                    cx.listener(move |this, _, window, cx| {
                        this.begin(Edit::Add(creature.id), window, cx)
                    }),
                ));
            }
            return root.child(choices).child(button(
                "close-library",
                "Cancel · Esc",
                cx.listener(|this, _, _, cx| {
                    this.library = false;
                    cx.notify();
                }),
            ));
        }
        let mut toolbar = div().flex().flex_wrap().gap_2();
        if encounter.status == EncounterStatus::Planned {
            toolbar = toolbar.child(button(
                "start",
                "Start encounter",
                cx.listener(|this, _, _, cx| this.command(Command::Start(this.id), cx)),
            ));
        }
        if encounter.status == EncounterStatus::Active {
            toolbar = toolbar.child(button(
                "complete",
                "Complete encounter",
                cx.listener(|this, _, _, cx| this.command(Command::Complete(this.id), cx)),
            ));
        }
        if encounter.status != EncounterStatus::Completed {
            toolbar = toolbar.child(button(
                "set-location",
                "Set location",
                cx.listener(|this, _, window, cx| this.begin(Edit::Location, window, cx)),
            ));
            toolbar = toolbar
                .child(button(
                    "add",
                    "Add creature · a",
                    cx.listener(|this, _, window, cx| {
                        this.library = true;
                        window.focus(&this.focus, cx);
                        cx.notify();
                    }),
                ))
                .child(button(
                    "rename-encounter",
                    "Rename encounter",
                    cx.listener(|this, _, window, cx| this.begin(Edit::EncounterName, window, cx)),
                ));
            for (index, (label, kind)) in [
                ("Heal +", Edit::Health(1)),
                ("Damage −", Edit::Health(-1)),
                ("Initiative · i", Edit::Initiative),
                ("Rename · n", Edit::Rename),
                ("Description · d", Edit::Description),
            ]
            .into_iter()
            .enumerate()
            {
                toolbar = toolbar.child(button(
                    format!("edit-{index}"),
                    label,
                    cx.listener(move |this, _, window, cx| this.begin(kind, window, cx)),
                ));
            }
            toolbar = toolbar
                .child(button(
                    "reset",
                    "Reset health",
                    cx.listener(|this, _, _, cx| {
                        this.command(
                            Command::ResetHealth {
                                encounter: this.id,
                                participants: this.targets(),
                            },
                            cx,
                        )
                    }),
                ))
                .child(button(
                    "remove",
                    "Remove selected",
                    cx.listener(|this, _, _, cx| {
                        this.command(
                            Command::RemoveParticipants {
                                encounter: this.id,
                                participants: this.targets(),
                            },
                            cx,
                        )
                    }),
                ));
        }
        toolbar = toolbar
            .child(button(
                "undo",
                "Undo · u",
                cx.listener(|this, _, _, cx| this.model.update(cx, |m, cx| m.undo(cx))),
            ))
            .child(button(
                "redo",
                "Redo · Ctrl+R",
                cx.listener(|this, _, _, cx| this.model.update(cx, |m, cx| m.redo(cx))),
            ));
        root = root.child(toolbar).child(format!(
            "{} selected · {} participants",
            self.selected.len(),
            rows.len()
        ));
        let completed = encounter.status == EncounterStatus::Completed;
        let list = uniform_list(
            "participants",
            rows.len(),
            cx.processor(move |this, range: std::ops::Range<usize>, _, cx| {
                range
                    .map(|index| {
                        this.render_row(&rows[index], completed, cx)
                            .into_any_element()
                    })
                    .collect::<Vec<_>>()
            }),
        )
        .track_scroll(&self.scroll)
        .flex_1()
        .min_h_0();
        root.child(list).child(div().text_xs().child("j/k Move · g/G First/last · Space Select · Esc Clear selection · Combat shortcuts apply only here"))
    }
}

pub fn verify(
    model: &Entity<CampaignModel>,
    workspace: &Entity<Workspace>,
    window: &mut Window,
    cx: &mut App,
) -> anyhow::Result<()> {
    use anyhow::ensure;
    let session = *model
        .read(cx)
        .engine
        .state()
        .sessions
        .keys()
        .next()
        .unwrap();
    let encounter = EncounterId::new();
    let hero = Creature::new("Rehearsal hero", 20, None, CreatureKind::Persistent);
    let hero_id = hero.id;
    model.update(cx, |m, cx| {
        m.execute(Command::CreateCreature(hero), cx);
        m.execute(Command::SetRoster([hero_id].into()), cx);
        m.execute(
            Command::CreateEncounter {
                id: encounter,
                session,
                name: "Rehearsal".into(),
                location: None,
            },
            cx,
        );
        m.execute(
            Command::AddLocalCreature {
                encounter,
                creature: Creature::new("Goblin", 7, Some(13), CreatureKind::Template),
                quantity: 99,
                initiative: Some(10),
            },
            cx,
        );
        m.execute(Command::Start(encounter), cx);
    });
    ensure!(
        model.read(cx).error.is_none(),
        "Campaign setup failed: {:?}",
        model.read(cx).error
    );
    let view = cx.new(|cx| EncounterView::new(model.clone(), workspace.downgrade(), encounter, cx));
    workspace.update(cx, |w, cx| {
        w.add_item_to_active_pane(Box::new(view.clone()), None, true, window, cx)
    });
    window.focus(&view.read(cx).focus_handle(cx), cx);
    window.refresh();
    let _ = window.draw(cx);
    let press = |key: &str, window: &mut Window, cx: &mut App| {
        window.dispatch_keystroke(Keystroke::parse(key).unwrap(), cx);
        window.refresh();
        let _ = window.draw(cx);
    };
    press("space", window, cx);
    let target = view.read(cx).cursor.unwrap();
    ensure!(
        view.read(cx).selected.contains(&target),
        "Space did not select a participant"
    );
    press("-", window, cx);
    ensure!(
        view.read(cx).edit.is_some(),
        "Damage key did not open an anchored field"
    );
    let field = view.read(cx).edit.as_ref().unwrap().1.inputs[0].1.clone();
    field.update(cx, |e, cx| e.set_text("9", window, cx));
    press("enter", window, cx);
    ensure!(view.read(cx).edit.is_none(), "Enter did not submit field");
    ensure!(
        model.read(cx).engine.state().encounters[&encounter].participants[&target].hp == -2,
        "Damage did not use campaign transaction"
    );
    press("u", window, cx);
    ensure!(
        model.read(cx).engine.state().encounters[&encounter].participants[&target].hp == 7,
        "Encounter undo failed"
    );
    press("ctrl-r", window, cx);
    ensure!(
        model.read(cx).engine.state().encounters[&encounter].participants[&target].hp == -2,
        "Encounter redo failed"
    );
    press("i", window, cx);
    let field = view.read(cx).edit.as_ref().unwrap().1.inputs[0].1.clone();
    field.update(cx, |e, cx| e.set_text("30", window, cx));
    press("enter", window, cx);
    ensure!(
        view.read(cx).cursor == Some(target) && view.read(cx).selected.contains(&target),
        "Initiative sort lost focus or selection"
    );
    press("d", window, cx);
    let revision = model.read(cx).engine.revision();
    press("j", window, cx);
    ensure!(
        model.read(cx).engine.revision() == revision,
        "Typing in a field triggered a combat mutation"
    );
    press("escape", window, cx);
    ensure!(view.read(cx).edit.is_none(), "Escape did not cancel field");
    ensure!(
        model.read(cx).engine.revision() == revision,
        "Cancel committed a field"
    );
    press("escape", window, cx);
    ensure!(
        view.read(cx).selected.is_empty(),
        "Escape did not clear selection"
    );
    ensure!(
        !model.read(cx).dirty && model.read(cx).error.is_none(),
        "Rehearsal did not persist"
    );
    let begin = std::time::Instant::now();
    for _ in 0..10 {
        window.refresh();
        let _ = window.draw(cx);
    }
    println!(
        "Campaign smoke test passed: 100 participants, keyboard selection, damage, undo/redo, stable initiative focus, field cancellation, automatic save. Ten headless layout frames: {:?}",
        begin.elapsed()
    );
    Ok(())
}

impl EncounterView {
    fn render_row(
        &mut self,
        p: &Participant,
        completed: bool,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let id = p.id;
        let selected = self.selected.contains(&id);
        let focused = self.cursor == Some(id);
        let label = format!("{} {}", if selected { "☑" } else { "☐" }, p.display_name());
        let mut row = div()
            .id(format!("participant-{id}"))
            .flex()
            .flex_col()
            .gap_1()
            .p_3()
            .border_2()
            .rounded_md()
            .border_color(rgb(if focused { 0xcba6f7 } else { 0x313244 }))
            .bg(rgb(if selected { 0x45475a } else { 0x313244 }))
            .on_click(cx.listener(move |this, _, window, cx| {
                this.cursor = Some(id);
                window.focus(&this.focus, cx);
                cx.notify();
            }))
            .child(div().flex().justify_between().child(label).child(format!(
                        "Initiative {} · AC {}",
                        p.initiative
                            .map(|v| v.to_string())
                            .unwrap_or_else(|| "—".into()),
                        p.ac.map(|v| v.to_string()).unwrap_or_else(|| "—".into())
                    )))
            .child(
                div()
                    .text_color(rgb(if p.hp <= 0 {
                        0xf38ba8
                    } else if p.hp <= p.max_hp / 2 {
                        0xf9e2af
                    } else {
                        0xa6e3a1
                    }))
                    .child(format!(
                        "{} / {} HP{}",
                        p.hp,
                        p.max_hp,
                        if p.hp <= 0 {
                            " · DOWN"
                        } else if p.hp <= p.max_hp / 2 {
                            " · LOW"
                        } else {
                            ""
                        }
                    )),
            )
            .child(div().text_ellipsis().child(p.description.clone()));
        let portrait = p.portrait.as_ref().map(|portrait| {
            let state = self.model.read(cx);
            let directory = p
                .creature
                .map(|id| format!("creatures/{id}"))
                .unwrap_or_else(|| {
                    campaign_storage::encounter_directory(
                        &state.engine.state().encounters[&self.id],
                    )
                });
            state.store.root().join(directory).join(portrait)
        });
        row = row.child(
            div()
                .flex()
                .gap_2()
                .child(super::visuals::portrait(portrait, p.display_name()))
                .child(button(
                    format!("select-{id}"),
                    if selected { "Deselect" } else { "Select" },
                    cx.listener(move |this, _, window, cx| {
                        this.cursor = Some(id);
                        if !this.selected.remove(&id) {
                            this.selected.insert(id);
                        }
                        window.focus(&this.focus, cx);
                        cx.notify();
                    }),
                )),
        );
        if let Some(creature) = p.creature {
            row = row.child(button(
                format!("notes-{id}"),
                "Creature notes",
                cx.listener(move |this, _, window, cx| {
                    open_document(
                        &this.model,
                        &this.workspace,
                        DocumentId::Creature(creature),
                        window,
                        cx,
                    )
                }),
            ));
        } else if !completed {
            row = row.child(button(
                format!("save-library-{id}"),
                "Save to library",
                cx.listener(move |this, _, _, cx| {
                    this.command(
                        Command::SaveToLibrary {
                            encounter: this.id,
                            participant: id,
                            id: CreatureId::new(),
                        },
                        cx,
                    )
                }),
            ));
        }
        div().h(px(208.)).pb_2().child(row)
    }
}
