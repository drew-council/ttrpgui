mod persistence;
mod rehearsal;
mod render;
pub use rehearsal::verify;

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
        CombatMenu,
        LibraryNext,
        LibraryPrevious,
        LibraryChoose,
        LibraryCancel,
        LibraryCreate,
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
        KeyBinding::new("down", LibraryNext, Some("CampaignLibrary > Editor")),
        KeyBinding::new("up", LibraryPrevious, Some("CampaignLibrary > Editor")),
        KeyBinding::new("enter", LibraryChoose, Some("CampaignLibrary > Editor")),
        KeyBinding::new("escape", LibraryCancel, Some("CampaignLibrary > Editor")),
        KeyBinding::new("ctrl-n", LibraryCreate, Some("CampaignLibrary > Editor")),
        KeyBinding::new("shift-f10", CombatMenu, Some("CampaignEncounter")),
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
    library_filter: Option<Entity<editor::Editor>>,
    library_cursor: usize,
    library_scroll: UniformListScrollHandle,
    error: Option<String>,
    scroll: UniformListScrollHandle,
    context_menu: Option<(Entity<ui::ContextMenu>, Point<Pixels>, Subscription)>,
}
impl EncounterView {
    pub fn encounter_id(&self) -> EncounterId {
        self.id
    }
    fn open_library(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if self.model.read(cx).engine.state().encounters[&self.id].status
            == EncounterStatus::Completed
        {
            return;
        }
        let filter = cx.new(|cx| {
            let mut e = editor::Editor::single_line(window, cx);
            e.set_placeholder_text("Find creatures and aliases…", window, cx);
            e
        });
        cx.observe(&filter, |this, _, cx| {
            this.library_cursor = 0;
            this.library_scroll.scroll_to_item(0, ScrollStrategy::Top);
            cx.notify();
        })
        .detach();
        window.focus(&filter.read(cx).focus_handle(cx), cx);
        self.library_filter = Some(filter);
        self.library_cursor = 0;
        self.library = true;
        cx.notify();
    }
    fn library_results(&self, cx: &App) -> Vec<Creature> {
        let model = self.model.read(cx);
        let query = self
            .library_filter
            .as_ref()
            .map(|e| e.read(cx).text(cx))
            .unwrap_or_default();
        model
            .catalogue
            .search(&query, usize::MAX)
            .into_iter()
            .filter_map(|d| match d.id {
                DocumentId::Creature(id) => model.engine.state().creatures.get(&id).cloned(),
                _ => None,
            })
            .take(200)
            .collect()
    }
    fn library_move(&mut self, backwards: bool, cx: &mut Context<Self>) {
        self.library_cursor = if backwards {
            self.library_cursor.saturating_sub(1)
        } else {
            self.library_cursor + 1
        }
        .min(self.library_results(cx).len().saturating_sub(1));
        self.library_scroll
            .scroll_to_item(self.library_cursor, ScrollStrategy::Nearest);
        cx.notify();
    }
    fn library_choose(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(creature) = self.library_results(cx).get(self.library_cursor) {
            self.begin(Edit::Add(creature.id), window, cx);
        }
    }
    pub fn selection_state(&self) -> (Option<ParticipantId>, BTreeSet<ParticipantId>) {
        (self.cursor, self.selected.clone())
    }
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
            library_filter: None,
            library_cursor: 0,
            library_scroll: UniformListScrollHandle::new(),
            error: None,
            scroll: UniformListScrollHandle::new(),
            context_menu: None,
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
    fn show_context_menu(
        &mut self,
        position: Point<Pixels>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        let completed = self.model.read(cx).engine.state().encounters[&self.id].status
            == EncounterStatus::Completed;
        let menu = ui::ContextMenu::build(window, cx, |menu, _, _| {
            menu.context(self.focus.clone())
                .action_disabled_when(completed, "Heal", Box::new(CombatHeal))
                .action_disabled_when(completed, "Damage", Box::new(CombatDamage))
                .action_disabled_when(completed, "Set initiative", Box::new(CombatInitiative))
                .action_disabled_when(completed, "Rename", Box::new(CombatRename))
                .action_disabled_when(
                    completed,
                    "Encounter description",
                    Box::new(CombatDescription),
                )
                .separator()
                .action("Undo", Box::new(CombatUndo))
                .action("Redo", Box::new(CombatRedo))
        });
        window.focus(&menu.read(cx).focus_handle(cx), cx);
        let subscription =
            cx.subscribe_in(&menu, window, |this, _, _: &DismissEvent, window, cx| {
                this.context_menu = None;
                window.focus(&this.focus, cx);
                cx.notify();
            });
        self.context_menu = Some((menu, position, subscription));
        cx.notify();
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
            "a" => self.open_library(window, cx),
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
