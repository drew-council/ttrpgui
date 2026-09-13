use editor::Editor;
use gpui::{App, AppContext, Context, Entity, Focusable, Window};

pub struct Fields {
    pub inputs: Vec<(&'static str, Entity<Editor>)>,
}
impl Fields {
    pub fn new(values: &[(&'static str, String)], window: &mut Window, cx: &mut App) -> Self {
        Self {
            inputs: values
                .iter()
                .map(|(label, value)| {
                    let editor = cx.new(|cx| Editor::single_line(window, cx));
                    editor.update(cx, |e, cx| e.set_text(value.as_str(), window, cx));
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
    pub fn render<T: 'static>(&self, _cx: &mut Context<T>) -> gpui::Div {
        use gpui::{div, prelude::*};
        div()
            .flex()
            .flex_col()
            .gap_2()
            .children(self.inputs.iter().map(|(label, input)| {
                div().flex().flex_col().gap_1().child(*label).child(
                    div()
                        .p_2()
                        .bg(gpui::rgb(0x313244))
                        .rounded_md()
                        .child(input.clone()),
                )
            }))
    }
}
