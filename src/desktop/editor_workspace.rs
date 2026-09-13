use gpui::{App, AppContext as _, KeyBinding};

pub fn init(cx: &mut App) -> anyhow::Result<()> {
    for path in [settings::DEFAULT_KEYMAP_PATH, settings::VIM_KEYMAP_PATH] {
        cx.bind_keys(settings::KeymapFile::load_asset_allow_partial_failure(
            path, cx,
        )?);
    }
    cx.bind_keys([KeyBinding::new(
        "ctrl-alt-m",
        markdown_live_preview::ToggleLivePreview,
        Some("Editor"),
    )]);
    cx.set_global(workspace::PaneSearchBarCallbacks {
        setup_search_bar: |languages, toolbar, window, cx| {
            let search = cx.new(|cx| search::BufferSearchBar::new(languages, window, cx));
            toolbar.update(cx, |toolbar, cx| toolbar.add_item(search, window, cx));
        },
        wrap_div_with_search_actions: search::buffer_search::register_pane_search_actions,
    });
    cx.observe_new(|workspace: &mut workspace::Workspace, window, cx| {
        let Some(window) = window else { return };
        let indicator = cx.new(|cx| vim::ModeIndicator::new(window, cx));
        workspace.status_bar().update(cx, |bar, cx| {
            bar.add_right_item(indicator, window, cx);
        });
    })
    .detach();
    Ok(())
}

/// Exercise the actual workspace composition without a compositor or GPU.
pub fn verify(
    workspace: &gpui::Entity<workspace::Workspace>,
    window: &mut gpui::Window,
    cx: &mut App,
) -> anyhow::Result<()> {
    use anyhow::{Context as _, ensure};
    use gpui::Focusable as _;
    let workspace = workspace.read(cx);
    ensure!(workspace.panes().len() == 2, "expected two panes");
    let left = workspace.panes()[0].read(cx);
    let right = workspace.panes()[1].read(cx);
    ensure!(
        left.items().count() == 2 && right.items().count() == 1,
        "expected two document tabs and one split view"
    );
    let left = left
        .active_item()
        .context("left pane is empty")?
        .act_as::<editor::Editor>(cx)
        .context("left item is not an editor")?;
    let right = right
        .active_item()
        .context("right pane is empty")?
        .act_as::<editor::Editor>(cx)
        .context("right item is not an editor")?;
    ensure!(left != right, "split reused the same view");
    let left_buffer = left
        .read(cx)
        .buffer()
        .read(cx)
        .as_singleton()
        .context("left document missing")?;
    let right_buffer = right
        .read(cx)
        .buffer()
        .read(cx)
        .as_singleton()
        .context("right document missing")?;
    ensure!(
        left_buffer == right_buffer,
        "split did not share the authoritative buffer"
    );
    for view in [&left, &right] {
        let context = view.update(cx, |editor, cx| editor.key_context(window, cx));
        ensure!(
            context
                .get("vim_mode")
                .is_some_and(|mode| mode.as_ref() == "normal"),
            "Vim Normal mode was not attached to a document view"
        );
    }
    let text = left.read(cx).text(cx);
    window.focus(&right.read(cx).focus_handle(cx), cx);
    ensure!(
        right.read(cx).focus_handle(cx).is_focused(window),
        "split cannot receive focus"
    );
    ensure!(text == right.read(cx).text(cx), "split text differs");
    right.update(cx, |editor, cx| {
        editor.edit(
            [(
                editor::MultiBufferOffset(0)..editor::MultiBufferOffset(0),
                "Shared edit\n",
            )],
            cx,
        );
    });
    ensure!(
        left.read(cx).text(cx) == format!("Shared edit\n{text}"),
        "edit did not propagate to the other view"
    );
    left.update(cx, |editor, cx| {
        editor.undo(&editor::actions::Undo, window, cx)
    });
    ensure!(
        right.read(cx).text(cx) == text,
        "undo did not propagate back to the split"
    );
    println!(
        "Editor smoke test passed: two tabs, independent views, shared edit/undo, Vim Normal mode, focus working."
    );
    Ok(())
}
