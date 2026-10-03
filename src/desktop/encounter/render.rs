use super::*;
use crate::desktop::navigator::{link_button, primary_button};
use crate::desktop::visuals::palette;

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
        let error = self.error.clone().or_else(|| state.error.clone());
        let mut root = div()
            .id("encounter")
            .relative()
            .track_focus(&self.focus)
            .key_context(if self.edit.is_some() {
                "CampaignField"
            } else if self.library {
                "CampaignLibrary"
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
            .bg(rgb(palette::BASE))
            .text_color(rgb(palette::TEXT))
            .on_action(cx.listener(|this, _: &LibraryNext, _, cx| this.library_move(false, cx)))
            .on_action(cx.listener(|this, _: &LibraryPrevious, _, cx| this.library_move(true, cx)))
            .on_action(
                cx.listener(|this, _: &LibraryChoose, window, cx| this.library_choose(window, cx)),
            )
            .on_action(cx.listener(|this, _: &LibraryCreate, window, cx| {
                this.begin(Edit::Local, window, cx)
            }))
            .on_action(cx.listener(|this, _: &LibraryCancel, window, cx| {
                this.library = false;
                window.focus(&this.focus, cx);
                cx.notify();
            }))
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
            .child(link_button(
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
        root = root.on_action(cx.listener(|this, _: &CombatMenu, window, cx| {
            this.show_context_menu(
                point(window.viewport_size().width * 0.5, px(280.)),
                window,
                cx,
            )
        }));
        if let Some(error) = error {
            root = root.child(
                div()
                    .p_2()
                    .border_1()
                    .border_color(rgb(palette::DANGER))
                    .child(error),
            );
        }
        if let Some(location) = encounter.location {
            root = root.child(link_button(
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
        let overlay = self.edit.as_ref().map(|(_, fields)| {
            div()
                .id("encounter-field")
                .absolute()
                .right_4()
                .top(px(140.))
                .w(px(340.))
                .max_h(px(560.))
                .overflow_y_scroll()
                .occlude()
                .p_4()
                .flex()
                .flex_col()
                .gap_3()
                .bg(rgb(palette::MANTLE))
                .border_2()
                .border_color(rgb(palette::ACCENT))
                .rounded_md()
                .child(format!("Editing {} participant(s)", self.targets().len()))
                .child(fields.render(cx))
                .child(primary_button(
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
                ))
        });
        if self.library {
            let library = self.library_results(cx);
            let choices = uniform_list(
                "creature-library",
                library.len(),
                cx.processor(move |this, range: std::ops::Range<usize>, _, cx| {
                    range
                        .map(|index| {
                            let creature = &library[index];
                            let id = creature.id;
                            let portrait = creature.portrait.as_ref().map(|p| {
                                this.model
                                    .read(cx)
                                    .store
                                    .root()
                                    .join(format!("creatures/{id}"))
                                    .join(p)
                            });
                            div()
                                .h(px(64.))
                                .flex()
                                .items_center()
                                .gap_2()
                                .border_1()
                                .border_color(rgb(if index == this.library_cursor {
                                    palette::ACCENT
                                } else {
                                    palette::SURFACE
                                }))
                                .child(crate::desktop::visuals::portrait(portrait, &creature.name))
                                .child(
                                    button(
                                        format!("library-{id}"),
                                        &format!("{} · {} HP", creature.name, creature.max_hp),
                                        cx.listener(move |this, _, window, cx| {
                                            this.begin(Edit::Add(id), window, cx)
                                        }),
                                    )
                                    .flex_1(),
                                )
                                .into_any_element()
                        })
                        .collect::<Vec<_>>()
                }),
            )
            .track_scroll(&self.library_scroll)
            .flex_1()
            .min_h_0();
            return root
                .child("Add from campaign library")
                .children(self.library_filter.clone())
                .child(button(
                    "new-local",
                    "Create new encounter creature · Ctrl+N",
                    cx.listener(|this, _, window, cx| this.begin(Edit::Local, window, cx)),
                ))
                .child(choices)
                .child(button(
                    "close-library",
                    "Cancel · Esc",
                    cx.listener(|this, _, window, cx| {
                        this.library = false;
                        window.focus(&this.focus, cx);
                        cx.notify();
                    }),
                ));
        }
        let mut toolbar = div().flex().flex_wrap().gap_2();
        if encounter.status == EncounterStatus::Planned {
            toolbar = toolbar.child(primary_button(
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
                        this.open_library(window, cx);
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
        root.child(list)
            .child(div().text_xs().child(
                "j/k Move · g/G First/last · Space Select · Shift+F10 Menu · Esc Clear selection",
            ))
            .children(overlay)
            .children(self.context_menu.as_ref().map(|(menu, position, _)| {
                deferred(
                    anchored()
                        .position(*position)
                        .anchor(gpui::Anchor::TopLeft)
                        .child(menu.clone()),
                )
                .with_priority(2)
            }))
    }
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
            .on_mouse_down(
                MouseButton::Right,
                cx.listener(move |this, event: &MouseDownEvent, window, cx| {
                    this.cursor = Some(id);
                    if !this.selected.contains(&id) {
                        this.selected.clear();
                    }
                    this.show_context_menu(event.position, window, cx);
                    cx.stop_propagation();
                }),
            )
            .flex()
            .flex_col()
            .gap_1()
            .p_3()
            .border_2()
            .rounded_md()
            .border_color(rgb(if focused {
                palette::ACCENT
            } else {
                palette::SURFACE
            }))
            .bg(rgb(if selected {
                palette::SELECTED_SURFACE
            } else {
                palette::SURFACE
            }))
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
                        palette::DANGER
                    } else if p.hp <= p.max_hp / 2 {
                        palette::WARNING
                    } else {
                        palette::HEALTHY
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
                .child(crate::desktop::visuals::portrait(
                    portrait,
                    p.display_name(),
                ))
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
            row = row.child(link_button(
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
