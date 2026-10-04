mod rehearsal;
mod render;
pub use rehearsal::verify;

use super::{
    campaign::{CampaignModel, open_document},
    fields::Fields,
};
use campaign_documents::DocumentId;
use campaign_domain::*;
use gpui::{prelude::*, *};
use workspace::{
    Workspace,
    dock::{DockPosition, Panel, PanelEvent},
};

actions!(
    campaign,
    [
        ToggleNavigator,
        PickerNext,
        PickerPrevious,
        PickerConfirm,
        PickerCancel,
        CollapseSession,
        ExpandSession,
        CreateSession,
        CreateEncounter,
        FocusPageFilter,
        RetrySave,
        RestoreUnsavedRecovery
    ]
);
pub fn init(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("j", PickerNext, Some("CampaignBrowser")),
        KeyBinding::new("down", PickerNext, Some("CampaignBrowser")),
        KeyBinding::new("k", PickerPrevious, Some("CampaignBrowser")),
        KeyBinding::new("up", PickerPrevious, Some("CampaignBrowser")),
        KeyBinding::new("enter", PickerConfirm, Some("CampaignBrowser")),
        KeyBinding::new("h", CollapseSession, Some("CampaignBrowser")),
        KeyBinding::new("left", CollapseSession, Some("CampaignBrowser")),
        KeyBinding::new("l", ExpandSession, Some("CampaignBrowser")),
        KeyBinding::new("right", ExpandSession, Some("CampaignBrowser")),
        KeyBinding::new("n", CreateEncounter, Some("CampaignBrowser")),
        KeyBinding::new("s", CreateSession, Some("CampaignBrowser")),
        KeyBinding::new("/", FocusPageFilter, Some("CampaignBrowser")),
        KeyBinding::new(
            "ctrl-o",
            ToggleNavigator,
            Some("CampaignBrowser || CampaignPicker"),
        ),
        KeyBinding::new("down", PickerNext, Some("CampaignPicker > Editor")),
        KeyBinding::new("up", PickerPrevious, Some("CampaignPicker > Editor")),
        KeyBinding::new("enter", PickerConfirm, Some("CampaignPicker > Editor")),
        KeyBinding::new("escape", PickerCancel, Some("CampaignPicker > Editor")),
    ]);
}
/// Browse-mode page groups. Filtered and picker lists are flat.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
enum Group {
    Sessions,
    Creatures,
    Locations,
    Notes,
}
impl Group {
    fn of(id: DocumentId) -> Self {
        match id {
            DocumentId::Session(_) | DocumentId::Encounter(_) => Self::Sessions,
            DocumentId::Creature(_) => Self::Creatures,
            DocumentId::Location(_) => Self::Locations,
            DocumentId::Note(_) => Self::Notes,
        }
    }
    fn label(self) -> &'static str {
        match self {
            Self::Sessions => "Sessions",
            Self::Creatures => "Creatures",
            Self::Locations => "Locations",
            Self::Notes => "Notes",
        }
    }
}
#[derive(Clone, PartialEq, Debug)]
enum Row {
    Group(Group, usize),
    Page(DocumentId, String),
}
impl Row {
    fn page(&self) -> Option<DocumentId> {
        match self {
            Self::Page(id, _) => Some(*id),
            Self::Group(..) => None,
        }
    }
}

#[derive(Clone, Copy)]
enum Create {
    Creature,
    Character,
    Location,
    Session,
    Note,
    Encounter(SessionId),
    Edit(DocumentId),
}
pub struct Navigator {
    model: Entity<CampaignModel>,
    workspace: WeakEntity<Workspace>,
    focus: FocusHandle,
    form: Option<(Create, Fields)>,
    error: Option<String>,
    filter: Entity<editor::Editor>,
    selected: Option<DocumentId>,
    picker_cursor: usize,
    scroll: UniformListScrollHandle,
    pending_link: Option<super::link_completion::PendingLink>,
    restricted: Option<std::collections::BTreeSet<DocumentId>>,
    heading: Option<String>,
    collapsed_sessions: std::collections::BTreeSet<SessionId>,
    collapsed_groups: std::collections::BTreeSet<Group>,
}
impl Navigator {
    pub(super) fn focus_session(
        &mut self,
        session: SessionId,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.filter.update(cx, |e, cx| e.set_text("", window, cx));
        self.collapsed_groups.remove(&Group::Sessions);
        self.picker_cursor = self.row_of(DocumentId::Session(session), cx).unwrap_or(0);
        self.selected = Some(DocumentId::Session(session));
        window.focus(&self.focus, cx);
        cx.notify();
    }
    fn row_of(&self, id: DocumentId, cx: &App) -> Option<usize> {
        self.pages(cx).iter().position(|row| row.page() == Some(id))
    }
    fn row_of_group(&self, group: Group, cx: &App) -> Option<usize> {
        self.pages(cx)
            .iter()
            .position(|row| matches!(row, Row::Group(g, _) if *g == group))
    }
    pub(super) fn filter_handle(&self) -> Entity<editor::Editor> {
        self.filter.clone()
    }

    pub fn show_related(&mut self, id: DocumentId, cx: &mut Context<Self>) {
        self.selected = Some(id);
        cx.notify();
    }
    /// Pages currently listed, in order, without group headers.
    pub fn visible_pages(&self, cx: &App) -> Vec<DocumentId> {
        self.pages(cx).iter().filter_map(Row::page).collect()
    }
    pub fn link_pending(&self) -> bool {
        self.pending_link.is_some()
    }
    pub fn new(
        model: Entity<CampaignModel>,
        workspace: WeakEntity<Workspace>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) -> Self {
        cx.observe(&model, |_, _, cx| cx.notify()).detach();
        let filter = cx.new(|cx| {
            let mut editor = editor::Editor::single_line(window, cx);
            editor.set_placeholder_text("Find pages and aliases…", window, cx);
            editor
        });
        cx.observe(&filter, |_, _, cx| cx.notify()).detach();
        Self {
            model,
            workspace,
            focus: cx.focus_handle(),
            form: None,
            error: None,
            filter,
            selected: None,
            picker_cursor: 0,
            scroll: UniformListScrollHandle::new(),
            pending_link: None,
            restricted: None,
            heading: None,
            collapsed_sessions: Default::default(),
            collapsed_groups: Default::default(),
        }
    }
    fn picker_move(&mut self, backwards: bool, cx: &mut Context<Self>) {
        self.picker_cursor = if backwards {
            self.picker_cursor.saturating_sub(1)
        } else {
            self.picker_cursor + 1
        };
        self.picker_cursor = self
            .picker_cursor
            .min(self.pages(cx).len().saturating_sub(1));
        self.scroll
            .scroll_to_item(self.picker_cursor, ScrollStrategy::Nearest);
        self.selected = self
            .pages(cx)
            .get(self.picker_cursor)
            .and_then(Row::page)
            .or(self.selected);
        cx.notify();
    }
    fn selected_session(&self, cx: &App) -> Option<SessionId> {
        match self.pages(cx).get(self.picker_cursor).and_then(Row::page) {
            Some(DocumentId::Session(id)) => Some(id),
            Some(DocumentId::Encounter(id)) => {
                Some(self.model.read(cx).engine.state().encounters[&id].session)
            }
            _ => None,
        }
    }
    /// Tree navigation: `h` collapses the nearest expanded parent and moves to
    /// it; `l` expands the session or group under the cursor.
    fn expand_session(&mut self, expanded: bool, cx: &mut Context<Self>) {
        let row = self.pages(cx).get(self.picker_cursor).cloned();
        let group = match row {
            Some(Row::Group(group, _)) => Some(group),
            Some(Row::Page(DocumentId::Session(session), _)) => {
                if expanded || !self.collapsed_sessions.contains(&session) {
                    if expanded {
                        self.collapsed_sessions.remove(&session);
                    } else {
                        self.collapsed_sessions.insert(session);
                    }
                    self.selected = Some(DocumentId::Session(session));
                    cx.notify();
                    return;
                }
                Some(Group::Sessions)
            }
            Some(Row::Page(DocumentId::Encounter(_), _)) => {
                if !expanded && let Some(session) = self.selected_session(cx) {
                    self.collapsed_sessions.insert(session);
                    self.picker_cursor = self.row_of(DocumentId::Session(session), cx).unwrap_or(0);
                    self.selected = Some(DocumentId::Session(session));
                    cx.notify();
                }
                return;
            }
            Some(Row::Page(id, _)) => (!expanded).then(|| Group::of(id)),
            None => None,
        };
        if let Some(group) = group {
            self.set_group_collapsed(group, !expanded, cx);
        }
    }
    fn set_group_collapsed(&mut self, group: Group, collapsed: bool, cx: &mut Context<Self>) {
        if collapsed {
            self.collapsed_groups.insert(group);
        } else {
            self.collapsed_groups.remove(&group);
        }
        if let Some(row) = self.row_of_group(group, cx) {
            self.picker_cursor = row;
            self.scroll.scroll_to_item(row, ScrollStrategy::Nearest);
        }
        cx.notify();
    }
    fn browsing(&self, cx: &App) -> bool {
        self.restricted.is_none()
            && self.pending_link.is_none()
            && self.filter.read(cx).text(cx).is_empty()
    }
    fn pages(&self, cx: &App) -> Vec<Row> {
        let pages = self.documents(cx);
        if !self.browsing(cx) {
            return pages
                .into_iter()
                .map(|(id, name)| Row::Page(id, name))
                .collect();
        }
        let mut rows = Vec::with_capacity(pages.len() + 4);
        let mut index = 0;
        for group in [
            Group::Sessions,
            Group::Creatures,
            Group::Locations,
            Group::Notes,
        ] {
            let count = pages[index..]
                .iter()
                .take_while(|(id, _)| Group::of(*id) == group)
                .count();
            rows.push(Row::Group(group, count));
            if !self.collapsed_groups.contains(&group) {
                rows.extend(
                    pages[index..index + count]
                        .iter()
                        .cloned()
                        .map(|(id, name)| Row::Page(id, name)),
                );
            }
            index += count;
        }
        rows
    }
    /// Matching documents; browse mode orders them by group and hierarchy.
    fn documents(&self, cx: &App) -> Vec<(DocumentId, String)> {
        let model = self.model.read(cx);
        let query = self.filter.read(cx).text(cx);
        let mut pages = model
            .catalogue
            .search(&query, if query.is_empty() || self.restricted.is_some() { usize::MAX } else { 200 })
            .into_iter()
            .filter(|d| {
                self.restricted
                    .as_ref()
                    .is_none_or(|ids| ids.contains(&d.id))
            })
            .filter(|d| !(query.is_empty() && self.restricted.is_none()
                && matches!(d.id, DocumentId::Encounter(id) if self.collapsed_sessions.contains(&model.engine.state().encounters[&id].session))))
            .map(|d| (d.id, d.name.clone()))
            .collect::<Vec<_>>();
        if query.is_empty() && self.restricted.is_none() {
            let state = model.engine.state();
            pages.sort_by_cached_key(|(id, name)| match id {
                DocumentId::Session(id) => {
                    (0, state.sessions[id].name.to_lowercase(), 0, String::new())
                }
                DocumentId::Encounter(id) => {
                    let e = &state.encounters[id];
                    (
                        0,
                        state.sessions[&e.session].name.to_lowercase(),
                        1,
                        name.to_lowercase(),
                    )
                }
                DocumentId::Creature(_) => (1, String::new(), 0, name.to_lowercase()),
                DocumentId::Location(_) => (2, String::new(), 0, name.to_lowercase()),
                DocumentId::Note(_) => (3, String::new(), 0, name.to_lowercase()),
            });
        }
        if !(query.is_empty() && self.restricted.is_none()) {
            pages.truncate(200);
        }
        pages
    }
    fn picker_open(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let results = self.pages(cx);
        match results.get(self.picker_cursor.min(results.len().saturating_sub(1))) {
            Some(Row::Page(id, _)) => {
                let id = *id;
                self.selected = Some(id);
                self.choose(id, window, cx);
            }
            Some(Row::Group(group, _)) => {
                let group = *group;
                let collapsed = !self.collapsed_groups.contains(&group);
                self.set_group_collapsed(group, collapsed, cx);
            }
            None => (),
        }
        cx.notify();
    }
    pub fn complete_link(
        &mut self,
        editor: WeakEntity<editor::Editor>,
        source: DocumentId,
        range: std::ops::Range<editor::Anchor>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.restricted = None;
        self.heading = None;
        self.pending_link = Some(super::link_completion::PendingLink {
            editor,
            source,
            range,
        });
        self.filter.update(cx, |e, cx| e.set_text("", window, cx));
        self.picker_cursor = 0;
        window.focus(&self.filter.read(cx).focus_handle(cx), cx);
        cx.notify();
    }
    pub fn resolve_ambiguous(
        &mut self,
        candidates: Vec<DocumentId>,
        heading: Option<String>,
        window: &mut Window,
        cx: &mut Context<Self>,
    ) {
        self.restricted = Some(candidates.into_iter().collect());
        self.heading = heading;
        self.filter.update(cx, |e, cx| e.set_text("", window, cx));
        self.picker_cursor = 0;
        window.focus(&self.filter.read(cx).focus_handle(cx), cx);
        cx.notify();
    }
    fn choose(&mut self, id: DocumentId, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(pending) = self.pending_link.take() {
            if let Err(error) = super::link_completion::insert(pending, id, &self.model, window, cx)
            {
                self.error = Some(error.to_string());
            }
        } else {
            super::campaign::open_document_heading(
                &self.model,
                &self.workspace,
                id,
                self.heading.take(),
                window,
                cx,
            );
        }
        self.restricted = None;
    }
    fn create(&mut self, kind: Create, window: &mut Window, cx: &mut Context<Self>) {
        let mut values = vec![("Name", String::new())];
        if matches!(kind, Create::Note | Create::Session | Create::Location) {
            values.push(("Template filename (optional)", String::new()));
        }
        if matches!(kind, Create::Creature | Create::Character) {
            values.extend([
                ("Maximum HP", "10".into()),
                ("AC (optional)", String::new()),
            ]);
        }
        if let Create::Edit(id) = kind {
            let model = self.model.read(cx);
            let Some(document) = model.catalogue.documents.get(&id) else {
                return;
            };
            values = vec![
                ("Name", document.name.clone()),
                ("Aliases (comma separated)", document.aliases.join(", ")),
            ];
            match id {
                DocumentId::Creature(id) => {
                    let c = &model.engine.state().creatures[&id];
                    values.extend([
                        ("Maximum HP", c.max_hp.to_string()),
                        (
                            "AC (optional)",
                            c.ac.map(|n| n.to_string()).unwrap_or_default(),
                        ),
                        (
                            "Portrait path (relative to page)",
                            c.portrait.clone().unwrap_or_default(),
                        ),
                    ]);
                }
                DocumentId::Location(id) => values.push((
                    "Image path (relative to page)",
                    model.engine.state().locations[&id]
                        .portrait
                        .clone()
                        .unwrap_or_default(),
                )),
                _ => (),
            }
        }
        let fields = Fields::new(&values, window, cx);
        fields.focus(window, cx);
        self.form = Some((kind, fields));
        self.error = None;
        cx.notify();
    }
    fn submit(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let Some((kind, fields)) = &self.form else {
            return;
        };
        let name = fields.value(0, cx);
        let template = if matches!(kind, Create::Note | Create::Session | Create::Location)
            && !fields.value(1, cx).trim().is_empty()
        {
            match campaign_documents::instantiate_template(
                self.model.read(cx).store.root(),
                fields.value(1, cx).trim(),
                &name,
            ) {
                Ok(text) => Some(text),
                Err(error) => {
                    self.error = Some(error.to_string());
                    cx.notify();
                    return;
                }
            }
        } else {
            None
        };
        let result = (|| -> anyhow::Result<Command> {
            Ok(match kind {
                Create::Creature | Create::Character => Command::CreateCreature(Creature::new(
                    name,
                    fields.value(1, cx).trim().parse::<i32>()?,
                    optional_number(&fields.value(2, cx))?,
                    if matches!(kind, Create::Character) {
                        CreatureKind::Persistent
                    } else {
                        CreatureKind::Template
                    },
                )),
                Create::Location => Command::CreateLocation(Location::new(name)),
                Create::Session => Command::CreateSession(Session::new(name)),
                Create::Note => Command::CreateNote(Note::new(name)),
                Create::Encounter(session) => Command::CreateEncounter {
                    id: EncounterId::new(),
                    session: *session,
                    name,
                    location: None,
                },
                Create::Edit(id) => {
                    let state = self.model.read(cx).engine.state();
                    let old = self
                        .model
                        .read(cx)
                        .catalogue
                        .documents
                        .get(id)
                        .ok_or_else(|| anyhow::anyhow!("Page was removed"))?;
                    let mut aliases: Vec<String> = fields
                        .value(1, cx)
                        .split(',')
                        .map(str::trim)
                        .filter(|a| !a.is_empty())
                        .map(str::to_owned)
                        .collect();
                    if name != old.name && !aliases.contains(&old.name) {
                        aliases.push(old.name.clone());
                    }
                    match *id {
                        DocumentId::Creature(id) => {
                            let mut c = state.creatures[&id].clone();
                            c.name = name;
                            c.aliases = aliases;
                            c.max_hp = fields.value(2, cx).trim().parse()?;
                            c.ac = optional_number(&fields.value(3, cx))?;
                            c.portrait = optional_text(fields.value(4, cx));
                            Command::UpdateCreature(c)
                        }
                        DocumentId::Location(id) => {
                            let mut l = state.locations[&id].clone();
                            l.name = name;
                            l.aliases = aliases;
                            l.portrait = optional_text(fields.value(2, cx));
                            Command::UpdateLocation(l)
                        }
                        DocumentId::Session(id) => {
                            let mut s = state.sessions[&id].clone();
                            s.name = name;
                            s.aliases = aliases;
                            Command::UpdateSession(s)
                        }
                        DocumentId::Note(id) => {
                            let mut n = state.notes[&id].clone();
                            n.name = name;
                            n.aliases = aliases;
                            Command::UpdateNote(n)
                        }
                        DocumentId::Encounter(id) => Command::RenameEncounter { id, name },
                    }
                }
            })
        })();
        match result {
            Ok(command) => {
                let created = match &command {
                    Command::CreateNote(n) => Some(DocumentId::Note(n.id)),
                    Command::CreateSession(s) => Some(DocumentId::Session(s.id)),
                    Command::CreateLocation(l) => Some(DocumentId::Location(l.id)),
                    Command::CreateCreature(c) => Some(DocumentId::Creature(c.id)),
                    Command::CreateEncounter { id, .. } => Some(DocumentId::Encounter(*id)),
                    _ => None,
                };
                if self
                    .model
                    .update(cx, |m, cx| m.execute(command, cx))
                    .is_some()
                {
                    if let (Some(id), Some(text)) = (created, template) {
                        let result = self.model.update(cx, |m, _| {
                            let path = m.catalogue.documents[&id]
                                .path
                                .to_string_lossy()
                                .into_owned();
                            m.store
                                .edit_documents([(path, (String::new(), text))].into())
                        });
                        cx.spawn(async move |panel, cx| {
                            if let Err(error) = result.await {
                                let _ = panel.update(cx, |p, cx| {
                                    p.error = Some(format!(
                                        "Page created; template could not be saved: {error:#}"
                                    ));
                                    cx.notify();
                                });
                            }
                        })
                        .detach();
                    }
                    if let Some(id) = created {
                        self.selected = Some(id);
                        self.collapsed_groups.remove(&Group::of(id));
                        if let DocumentId::Encounter(encounter) = id {
                            let session =
                                self.model.read(cx).engine.state().encounters[&encounter].session;
                            self.collapsed_sessions.remove(&session);
                        }
                        self.picker_cursor = self.row_of(id, cx).unwrap_or(0);
                        self.choose(id, window, cx);
                    }
                    self.form = None;
                    window.focus(&self.focus, cx);
                }
            }
            Err(e) => self.error = Some(format!("Enter valid whole numbers: {e}")),
        }
        cx.notify();
    }
}
pub fn optional_number(value: &str) -> anyhow::Result<Option<i32>> {
    if value.trim().is_empty() {
        Ok(None)
    } else {
        Ok(Some(value.trim().parse()?))
    }
}
fn optional_text(value: String) -> Option<String> {
    if value.trim().is_empty() {
        None
    } else {
        Some(value)
    }
}
impl Focusable for Navigator {
    fn focus_handle(&self, _: &App) -> FocusHandle {
        self.focus.clone()
    }
}
impl EventEmitter<PanelEvent> for Navigator {}
impl Panel for Navigator {
    fn activation_focus_handle(&self, cx: &App) -> FocusHandle {
        self.filter.read(cx).focus_handle(cx)
    }
    fn persistent_name() -> &'static str {
        "Campaign"
    }
    fn panel_key() -> &'static str {
        "campaign"
    }
    fn position(&self, _: &Window, _: &App) -> DockPosition {
        DockPosition::Left
    }
    fn position_is_valid(&self, p: DockPosition) -> bool {
        p == DockPosition::Left
    }
    fn set_position(&mut self, _: DockPosition, _: &mut Window, _: &mut Context<Self>) {}
    fn default_size(&self, _: &Window, _: &App) -> Pixels {
        px(340.)
    }
    fn icon(&self, _: &Window, _: &App) -> Option<ui::IconName> {
        Some(ui::IconName::Book)
    }
    fn icon_tooltip(&self, _: &Window, _: &App) -> Option<&'static str> {
        Some("Campaign navigator")
    }
    fn toggle_action(&self) -> Box<dyn Action> {
        Box::new(ToggleNavigator)
    }
    fn starts_open(&self, _: &Window, _: &App) -> bool {
        true
    }
    fn activation_priority(&self) -> u32 {
        10
    }
}
pub fn button(
    id: impl Into<SharedString>,
    label: &str,
    click: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
) -> gpui_component::button::Button {
    use gpui_component::Sizable;
    gpui_component::button::Button::new(ElementId::Name(id.into()))
        .label(label.to_owned())
        .small()
        .tab_index(0)
        .on_click(click)
}

pub fn primary_button(
    id: impl Into<SharedString>,
    label: &str,
    click: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
) -> gpui_component::button::Button {
    use gpui_component::button::ButtonVariants;
    button(id, label, click).primary()
}

pub fn link_button(
    id: impl Into<SharedString>,
    label: &str,
    click: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
) -> gpui_component::button::Button {
    use gpui_component::button::ButtonVariants;
    button(id, label, click).link()
}
