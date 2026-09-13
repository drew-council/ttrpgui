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
        PickerCancel
    ]
);
pub fn init(cx: &mut App) {
    cx.bind_keys([
        KeyBinding::new("down", PickerNext, Some("CampaignPicker > Editor")),
        KeyBinding::new("up", PickerPrevious, Some("CampaignPicker > Editor")),
        KeyBinding::new("enter", PickerConfirm, Some("CampaignPicker > Editor")),
        KeyBinding::new("escape", PickerCancel, Some("CampaignPicker > Editor")),
    ]);
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
    pending_link: Option<super::link_completion::PendingLink>,
}
impl Navigator {
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
            pending_link: None,
        }
    }
    fn picker_move(&mut self, backwards: bool, cx: &mut Context<Self>) {
        self.picker_cursor = if backwards {
            self.picker_cursor.saturating_sub(1)
        } else {
            self.picker_cursor + 1
        };
        cx.notify();
    }
    fn picker_open(&mut self, window: &mut Window, cx: &mut Context<Self>) {
        let query = self.filter.read(cx).text(cx);
        let results = self.model.read(cx).catalogue.search(&query, 200);
        if let Some(document) = results.get(self.picker_cursor.min(results.len().saturating_sub(1)))
        {
            let id = document.id;
            self.selected = Some(id);
            self.choose(id, window, cx);
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
    fn choose(&mut self, id: DocumentId, window: &mut Window, cx: &mut Context<Self>) {
        if let Some(pending) = self.pending_link.take() {
            if let Err(error) = super::link_completion::insert(pending, id, &self.model, window, cx)
            {
                self.error = Some(error.to_string());
            }
        } else {
            open_document(&self.model, &self.workspace, id, window, cx);
        }
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
        let before = matches!(kind, Create::Edit(_)).then(|| {
            campaign_documents::Catalogue::from_campaign(self.model.read(cx).engine.state())
        });
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
                    if let Some(before) = before {
                        if let Err(error) = super::link_completion::update_renamed_links(
                            before,
                            &self.model,
                            &self.workspace,
                            cx,
                        ) {
                            self.error = Some(format!(
                                "Page saved, but link updates need attention: {error:#}"
                            ));
                        }
                    }
                    if let (Some(id), Some(text)) = (created, template) {
                        let result = self.model.update(cx, |m, _| {
                            let path = m.catalogue.documents[&id]
                                .path
                                .to_string_lossy()
                                .into_owned();
                            m.store
                                .edit_documents([(path, (String::new(), text))].into())
                        });
                        if let Err(error) = result {
                            self.error = Some(format!(
                                "Page created; template could not be saved: {error:#}"
                            ));
                        }
                    }
                    if let Some(id) = created {
                        self.selected = Some(id);
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
        px(280.)
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
impl Render for Navigator {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let model = self.model.read(cx);
        let title = model.engine.state().config.name.clone();
        let status = model
            .error
            .clone()
            .or_else(|| self.error.clone())
            .unwrap_or_else(|| {
                if model.dirty {
                    "Unsaved changes".into()
                } else {
                    "Saved".into()
                }
            });
        let query = self.filter.read(cx).text(cx);
        let recovery = model.has_recovery;
        let details = self.selected.and_then(|id| {
            model.catalogue.documents.get(&id).map(|d| {
                let mut related = model.catalogue.related(id, model.engine.state());
                related.extend(model.index.backlinks(id, &model.catalogue));
                related.sort();
                related.dedup();
                (id, d.name.clone(), related)
            })
        });
        let roster = model.engine.state().config.roster.clone();
        let persistent=self.selected.is_some_and(|id|matches!(id,DocumentId::Creature(id) if model.engine.state().creatures[&id].kind==CreatureKind::Persistent));
        let pages = model
            .catalogue
            .search(&query, 200)
            .into_iter()
            .map(|d| (d.id, d.name.clone()))
            .collect::<Vec<_>>();
        let mut content = div()
            .id("campaign-navigator")
            .track_focus(&self.focus)
            .key_context(if self.form.is_some() {
                "CampaignField"
            } else {
                "CampaignPicker"
            })
            .tab_group()
            .size_full()
            .flex()
            .flex_col()
            .gap_2()
            .p_3()
            .bg(rgb(0x181825))
            .text_color(rgb(0xcdd6f4))
            .capture_key_down(cx.listener(|this, event: &KeyDownEvent, window, cx| {
                if event.keystroke.key == "tab" {
                    if let Some((_, fields)) = &this.form {
                        fields.cycle(event.keystroke.modifiers.shift, window, cx);
                    } else if event.keystroke.modifiers.shift {
                        window.focus_prev(cx);
                    } else {
                        window.focus_next(cx);
                    }
                    cx.stop_propagation();
                    return;
                }
                if this.form.is_some() {
                    match event.keystroke.key.as_str() {
                        "enter" => {
                            this.submit(window, cx);
                            cx.stop_propagation();
                        }
                        "escape" => {
                            this.form = None;
                            window.focus(&this.focus, cx);
                            cx.notify();
                            cx.stop_propagation();
                        }
                        _ => (),
                    }
                }
            }))
            .child(div().text_lg().child(title))
            .child(div().text_xs().child(status));
        content = content
            .on_action(
                cx.listener(|this, _: &super::encounter::SubmitField, window, cx| {
                    this.submit(window, cx)
                }),
            )
            .on_action(
                cx.listener(|this, _: &super::encounter::CancelField, window, cx| {
                    this.form = None;
                    window.focus(&this.focus, cx);
                    cx.notify();
                }),
            )
            .on_action(
                cx.listener(|this, _: &super::encounter::NextField, window, cx| {
                    if let Some((_, fields)) = &this.form {
                        fields.cycle(false, window, cx);
                    }
                }),
            )
            .on_action(
                cx.listener(|this, _: &super::encounter::PreviousField, window, cx| {
                    if let Some((_, fields)) = &this.form {
                        fields.cycle(true, window, cx);
                    }
                }),
            )
            .on_action(cx.listener(|this, _: &PickerNext, _, cx| this.picker_move(false, cx)))
            .on_action(cx.listener(|this, _: &PickerPrevious, _, cx| this.picker_move(true, cx)))
            .on_action(
                cx.listener(|this, _: &PickerConfirm, window, cx| this.picker_open(window, cx)),
            )
            .on_action(cx.listener(|this, _: &PickerCancel, window, cx| {
                this.filter.update(cx, |e, cx| e.set_text("", window, cx));
                if let Some(pending) = this.pending_link.take().and_then(|p| p.editor.upgrade()) {
                    window.focus(&pending.read(cx).focus_handle(cx), cx);
                } else {
                    window.focus(&this.focus, cx);
                }
                cx.notify();
            }));
        if let Some((_, fields)) = &self.form {
            let names = campaign_documents::template_names(self.model.read(cx).store.root())
                .unwrap_or_default()
                .join(", ");
            return content
                .child(fields.render(cx))
                .child(div().text_xs().child(format!("Templates: {names}")))
                .child(button(
                    "create-save",
                    "Save · Enter",
                    cx.listener(|this, _, window, cx| this.submit(window, cx)),
                ))
                .child(button(
                    "create-cancel",
                    "Cancel · Esc",
                    cx.listener(|this, _, window, cx| {
                        this.form = None;
                        window.focus(&this.focus, cx);
                        cx.notify();
                    }),
                ));
        }
        content = content.child(self.filter.clone());
        let mut actions = div().flex().flex_wrap().gap_1();
        for (index, (label, kind)) in [
            ("+ Character", Create::Character),
            ("+ Creature", Create::Creature),
            ("+ Location", Create::Location),
            ("+ Session", Create::Session),
            ("+ Note", Create::Note),
        ]
        .into_iter()
        .enumerate()
        {
            actions = actions.child(button(
                format!("create-{index}"),
                label,
                cx.listener(move |this, _, window, cx| this.create(kind, window, cx)),
            ));
        }
        content = content.child(actions);
        if let Some((id, name, related)) = details {
            let mut detail = div()
                .flex()
                .flex_col()
                .gap_1()
                .p_2()
                .border_1()
                .border_color(rgb(0x45475a))
                .child(name)
                .child(button(
                    "edit-metadata",
                    "Edit page details",
                    cx.listener(move |this, _, window, cx| {
                        this.create(Create::Edit(id), window, cx)
                    }),
                ));
            if let DocumentId::Creature(creature) = id {
                detail = detail.child(button(
                    "roster",
                    if roster.contains(&creature) {
                        "☑ Default encounter roster"
                    } else {
                        "☐ Default encounter roster"
                    },
                    cx.listener(move |this, _, _, cx| {
                        this.model.update(cx, |m, cx| {
                            let mut roster = m.engine.state().config.roster.clone();
                            if !roster.remove(&creature) {
                                roster.insert(creature);
                            }
                            m.execute(Command::SetRoster(roster), cx);
                        });
                    }),
                ));
                if persistent {
                    detail = detail.child(button(
                        "reset-character",
                        "Reset character health",
                        cx.listener(move |this, _, _, cx| {
                            this.model.update(cx, |m, cx| {
                                m.execute(Command::ResetCharacters([creature].into()), cx);
                            });
                        }),
                    ));
                }
            }
            for related_id in related {
                let label = self
                    .model
                    .read(cx)
                    .catalogue
                    .documents
                    .get(&related_id)
                    .map(|d| format!("{} · {}", related_id.kind(), d.name))
                    .unwrap_or_default();
                detail = detail.child(button(
                    format!("related-{related_id:?}"),
                    &label,
                    cx.listener(move |this, _, window, cx| {
                        open_document(&this.model, &this.workspace, related_id, window, cx)
                    }),
                ));
            }
            content = content.child(detail);
        }
        let mut list = div()
            .id("campaign-pages")
            .flex_1()
            .overflow_y_scroll()
            .flex()
            .flex_col()
            .gap_1();
        self.picker_cursor = self.picker_cursor.min(pages.len().saturating_sub(1));
        for (index, (id, name)) in pages.into_iter().enumerate() {
            let portrait = self
                .model
                .read(cx)
                .catalogue
                .documents
                .get(&id)
                .and_then(|d| d.portrait.as_ref())
                .map(|p| self.model.read(cx).store.root().join(p));
            let mut row = div()
                .flex()
                .flex_col()
                .border_1()
                .border_color(rgb(
                    if self.filter.read(cx).focus_handle(cx).is_focused(window)
                        && self.picker_cursor == index
                    {
                        0xcba6f7
                    } else {
                        0x181825
                    },
                ))
                .child(button(
                    format!("page-{id:?}"),
                    &format!("{} · {name}", id.kind()),
                    cx.listener(move |this, _, window, cx| {
                        this.selected = Some(id);
                        this.choose(id, window, cx);
                        cx.notify();
                    }),
                ));
            row = row.child(super::visuals::portrait(portrait, &name));
            if let DocumentId::Session(session) = id {
                row = row.child(button(
                    format!("encounter-{session}"),
                    "+ Encounter",
                    cx.listener(move |this, _, window, cx| {
                        this.create(Create::Encounter(session), window, cx)
                    }),
                ));
            }
            list = list.child(row);
        }
        if recovery {
            content = content.child(button(
                "restore-recovery",
                "Restore unsaved recovery",
                cx.listener(|this, _, _, cx| this.model.update(cx, |m, cx| m.restore_unsaved(cx))),
            ));
        }
        content.child(list).child(button(
            "retry-save",
            "Retry save",
            cx.listener(|this, _, _, cx| this.model.update(cx, |m, cx| m.save(cx))),
        ))
    }
}

pub fn button(
    id: impl Into<SharedString>,
    label: &str,
    click: impl Fn(&ClickEvent, &mut Window, &mut App) + 'static,
) -> Stateful<Div> {
    div()
        .id(ElementId::Name(id.into()))
        .tab_index(0)
        .focus(|style| style.border_1().border_color(rgb(0xcba6f7)))
        .px_2()
        .py_1()
        .rounded_sm()
        .cursor_pointer()
        .bg(rgb(0x313244))
        .hover(|s| s.bg(rgb(0x45475a)))
        .child(label.to_owned())
        .on_click(click)
}
