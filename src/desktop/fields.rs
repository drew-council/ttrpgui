use crate::desktop::visuals::palette;
use editor::Editor;
use gpui::{App, AppContext, Context, Entity, Focusable, Window};

pub struct Fields {
    pub inputs: Vec<(&'static str, Entity<Editor>)>,
    pub multiline: bool,
}
impl Fields {
    pub fn new(values: &[(&'static str, String)], window: &mut Window, cx: &mut App) -> Self {
        Self::build(values, false, window, cx)
    }
    pub fn multiline(
        label: &'static str,
        value: String,
        window: &mut Window,
        cx: &mut App,
    ) -> Self {
        Self::build(&[(label, value)], true, window, cx)
    }
    fn build(
        values: &[(&'static str, String)],
        multiline: bool,
        window: &mut Window,
        cx: &mut App,
    ) -> Self {
        Self {
            multiline,
            inputs: values
                .iter()
                .map(|(label, value)| {
                    let editor = cx.new(|cx| {
                        if multiline {
                            Editor::multi_line(window, cx)
                        } else {
                            Editor::single_line(window, cx)
                        }
                    });
                    editor.update(cx, |e, cx| {
                        e.set_text(value.as_str(), window, cx);
                        // Prefill is the draft's initial state, never an edit
                        // that can merge with the user's first Vim transaction.
                        if let Some(buffer) = e.buffer().read(cx).as_singleton() {
                            buffer.update(cx, |buffer, _| {
                                buffer.finalize_last_transaction();
                                if let Some(entry) = buffer.peek_undo_stack() {
                                    buffer.forget_transaction(entry.transaction_id());
                                }
                            });
                        }
                    });
                    (*label, editor)
                })
                .collect(),
        }
    }
    pub fn value(&self, index: usize, cx: &App) -> String {
        self.inputs[index].1.read(cx).text(cx)
    }
    pub fn cycle(&self, backwards: bool, window: &mut Window, cx: &mut App) {
        if self.inputs.is_empty() {
            return;
        }
        let current = self
            .inputs
            .iter()
            .position(|(_, e)| e.read(cx).focus_handle(cx).is_focused(window))
            .unwrap_or(0);
        let count = self.inputs.len();
        let next = if backwards {
            (current + count - 1) % count
        } else {
            (current + 1) % count
        };
        window.focus(&self.inputs[next].1.read(cx).focus_handle(cx), cx);
    }
    pub fn focus(&self, window: &mut Window, cx: &mut App) {
        if let Some((_, e)) = self.inputs.first() {
            window.focus(&e.read(cx).focus_handle(cx), cx);
        }
    }
    pub fn render<T: 'static>(&self, _cx: &mut Context<T>) -> gpui_component::form::Form {
        use gpui::{div, prelude::*};
        gpui_component::form::v_form().children(self.inputs.iter().map(|(label, input)| {
            gpui_component::form::field().label(*label).child(
                div()
                    .p_2()
                    .bg(gpui::rgb(palette::SURFACE))
                    .rounded_md()
                    .when(self.multiline, |frame| frame.h(gpui::px(220.)))
                    .child(input.clone()),
            )
        }))
    }
}
