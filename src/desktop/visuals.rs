use gpui::{prelude::*, *};
use std::{path::PathBuf, sync::Arc};

pub fn init_controls(cx: &mut App) {
    gpui_component::init(cx);
    gpui_component::Theme::change(gpui_component::ThemeMode::Dark, None, cx);
    let theme = gpui_component::Theme::global_mut(cx);
    theme.background = rgb(palette::BASE).into();
    theme.foreground = rgb(palette::TEXT).into();
    theme.secondary = rgb(palette::SURFACE).into();
    theme.secondary_foreground = rgb(palette::TEXT).into();
    theme.secondary_hover = rgb(palette::SELECTED_SURFACE).into();
    theme.secondary_active = rgb(palette::SELECTED_SURFACE).into();
    theme.primary = rgb(palette::ACCENT).into();
    theme.primary_foreground = rgb(palette::BASE).into();
    theme.primary_hover = rgb(palette::ACCENT).into();
    theme.primary_active = rgb(palette::ACCENT).into();
    theme.ring = rgb(palette::ACCENT).into();
    theme.link = rgb(palette::LINK).into();
    theme.link_hover = rgb(palette::LINK).into();
    theme.link_active = rgb(palette::LINK).into();
    theme.border = rgb(palette::SELECTED_SURFACE).into();
    theme.shadow = false;
}

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
        .bg(rgb(palette::SELECTED_SURFACE));
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
                            .text_color(rgb(palette::WARNING))
                            .child("!")
                            .into_any_element()
                    }),
            )
            .into_any_element()
    } else {
        frame.child(initials).into_any_element()
    }
}

/// Semantic Catppuccin Mocha colors, shared by campaign controls.
pub mod palette {
    pub const BASE: u32 = 0x1e1e2e;
    pub const MANTLE: u32 = 0x181825;
    pub const SURFACE: u32 = 0x313244;
    pub const SELECTED_SURFACE: u32 = 0x45475a;
    pub const ACCENT: u32 = 0xcba6f7;
    pub const TEXT: u32 = 0xcdd6f4;
    pub const DANGER: u32 = 0xf38ba8;
    pub const WARNING: u32 = 0xf9e2af;
    pub const HEALTHY: u32 = 0xa6e3a1;
    pub const LINK: u32 = 0x89b4fa;
}
