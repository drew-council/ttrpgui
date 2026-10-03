use super::*;
use crate::desktop::visuals::palette;

impl Render for Navigator {
    fn render(&mut self, window: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let model = self.model.read(cx);
        let title = model.engine.state().config.name.clone();
        let status = model
            .error
            .clone()
            .or_else(|| self.error.clone())
            .unwrap_or_else(|| {
                if model.saves_pending > 0 || model.link_updates_pending > 0 {
                    "Saving…".into()
                } else if model.dirty {
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
        let pages = self.pages(cx);
        let mut content = div()
            .id("campaign-navigator")
            .track_focus(&self.focus)
            .key_context(if self.form.is_some() {
                "CampaignField"
            } else if self.focus.is_focused(window) {
                "CampaignBrowser"
            } else {
                "CampaignPicker"
            })
            .tab_group()
            .size_full()
            .flex()
            .flex_col()
            .gap_2()
            .p_3()
            .bg(rgb(palette::MANTLE))
            .text_color(rgb(palette::TEXT))
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
                cx.listener(|this, _: &CollapseSession, _, cx| this.expand_session(false, cx)),
            )
            .on_action(cx.listener(|this, _: &ExpandSession, _, cx| this.expand_session(true, cx)))
            .on_action(cx.listener(|this, _: &CreateSession, window, cx| {
                this.create(Create::Session, window, cx)
            }))
            .on_action(cx.listener(|this, _: &CreateEncounter, window, cx| {
                if let Some(session) = this.selected_session(cx) {
                    this.create(Create::Encounter(session), window, cx);
                }
            }))
            .on_action(cx.listener(|this, _: &FocusPageFilter, window, cx| {
                window.focus(&this.filter.read(cx).focus_handle(cx), cx);
            }))
            .on_action(cx.listener(
                |this, _: &crate::desktop::encounter::SubmitField, window, cx| {
                    this.submit(window, cx)
                },
            ))
            .on_action(cx.listener(
                |this, _: &crate::desktop::encounter::CancelField, window, cx| {
                    this.form = None;
                    window.focus(&this.focus, cx);
                    cx.notify();
                },
            ))
            .on_action(cx.listener(
                |this, _: &crate::desktop::encounter::NextField, window, cx| {
                    if let Some((_, fields)) = &this.form {
                        fields.cycle(false, window, cx);
                    }
                },
            ))
            .on_action(cx.listener(
                |this, _: &crate::desktop::encounter::PreviousField, window, cx| {
                    if let Some((_, fields)) = &this.form {
                        fields.cycle(true, window, cx);
                    }
                },
            ))
            .on_action(cx.listener(|this, _: &PickerNext, _, cx| this.picker_move(false, cx)))
            .on_action(cx.listener(|this, _: &PickerPrevious, _, cx| this.picker_move(true, cx)))
            .on_action(
                cx.listener(|this, _: &PickerConfirm, window, cx| this.picker_open(window, cx)),
            )
            .on_action(cx.listener(|this, _: &PickerCancel, window, cx| {
                this.restricted = None;
                this.heading = None;
                this.picker_cursor = 0;
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
                .child(primary_button(
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
                .border_color(rgb(palette::SELECTED_SURFACE))
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
                detail = detail.child(link_button(
                    format!("related-{related_id:?}"),
                    &label,
                    cx.listener(move |this, _, window, cx| {
                        open_document(&this.model, &this.workspace, related_id, window, cx)
                    }),
                ));
            }
            content = content.child(detail);
        }
        self.picker_cursor = self.picker_cursor.min(pages.len().saturating_sub(1));
        let list = uniform_list(
            "campaign-pages",
            pages.len(),
            cx.processor(move |this, range: std::ops::Range<usize>, window, cx| {
                range
                    .map(|index| {
                        let (id, name) = pages[index].clone();
                        let portrait = this
                            .model
                            .read(cx)
                            .catalogue
                            .documents
                            .get(&id)
                            .and_then(|d| d.portrait.as_ref())
                            .map(|p| this.model.read(cx).store.root().join(p));
                        let mut row = div()
                            .h(px(88.))
                            .overflow_hidden()
                            .flex()
                            .flex_col()
                            .border_1()
                            .border_color(rgb(
                                if (this.filter.read(cx).focus_handle(cx).is_focused(window)
                                    || this.focus.is_focused(window))
                                    && this.picker_cursor == index
                                {
                                    palette::ACCENT
                                } else {
                                    palette::MANTLE
                                },
                            ))
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .gap_2()
                                    .child(crate::desktop::visuals::portrait(portrait, &name))
                                    .child(
                                        button(
                                            format!("page-{id:?}"),
                                            &format!("{} · {name}", id.kind()),
                                            cx.listener(move |this, _, window, cx| {
                                                this.selected = Some(id);
                                                this.choose(id, window, cx);
                                                cx.notify();
                                            }),
                                        )
                                        .flex_1(),
                                    ),
                            );
                        if matches!(id, DocumentId::Encounter(_)) && query.is_empty() {
                            row = row.pl_4();
                        }
                        if let DocumentId::Session(session) = id {
                            let expanded = !this.collapsed_sessions.contains(&session);
                            row = row.child(
                                div()
                                    .flex()
                                    .gap_1()
                                    .child(button(
                                        format!("expand-{session}"),
                                        if expanded { "Collapse" } else { "Expand" },
                                        cx.listener(move |this, _, _, cx| {
                                            if expanded {
                                                this.collapsed_sessions.insert(session);
                                            } else {
                                                this.collapsed_sessions.remove(&session);
                                            }
                                            cx.notify();
                                        }),
                                    ))
                                    .child(button(
                                        format!("encounter-{session}"),
                                        "+ Encounter",
                                        cx.listener(move |this, _, window, cx| {
                                            this.create(Create::Encounter(session), window, cx)
                                        }),
                                    )),
                            );
                        }
                        row.into_any_element()
                    })
                    .collect::<Vec<_>>()
            }),
        )
        .track_scroll(&self.scroll)
        .flex_1()
        .min_h_0();
        if recovery {
            content = content.child(button(
                "restore-recovery",
                "Restore unsaved recovery",
                cx.listener(|this, _, _, cx| this.model.update(cx, |m, cx| m.restore_unsaved(cx))),
            ));
        }
        content.child(list).child(div().text_xs().child("Esc: browse · j/k: move · h/l: collapse/expand · n: encounter · s: session · /: find")).child(button(
            "retry-save",
            "Retry save",
            cx.listener(|this, _, _, cx| this.model.update(cx, |m, cx| m.save(cx))),
        ))
    }
}
