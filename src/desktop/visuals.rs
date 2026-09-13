use gpui::{prelude::*, *};
use std::{path::PathBuf, sync::Arc};

pub fn portrait(path: Option<PathBuf>, name: &str) -> AnyElement {
    let initials = name
        .split_whitespace()
        .filter_map(|word| word.chars().next())
        .take(2)
        .collect::<String>();
    let frame = div()
        .size(px(36.))
        .rounded_md()
        .overflow_hidden()
        .flex()
        .items_center()
        .justify_center()
        .bg(rgb(0x45475a));
    if let Some(path) = path {
        frame
            .child(
                img(Arc::<std::path::Path>::from(path))
                    .size_full()
                    .object_fit(ObjectFit::Cover)
                    .with_fallback(|| {
                        div()
                            .size_full()
                            .flex()
                            .items_center()
                            .justify_center()
                            .text_color(rgb(0xf9e2af))
                            .child("!")
                            .into_any_element()
                    }),
            )
            .into_any_element()
    } else {
        frame.child(initials).into_any_element()
    }
}
