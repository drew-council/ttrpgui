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
    // Zed binds whole-pane moves under Ctrl-W; add moving the active tab to
    // the neighbouring pane alongside them.
    for (key, direction) in [
        ("h", workspace::SplitDirection::Left),
        ("j", workspace::SplitDirection::Down),
        ("k", workspace::SplitDirection::Up),
        ("l", workspace::SplitDirection::Right),
    ] {
        cx.bind_keys([KeyBinding::new(
            &format!("ctrl-w m {key}"),
            workspace::MoveItemToPaneInDirection {
                direction,
                focus: true,
                clone: false,
            },
            Some("VimControl && !menu || !Editor && !Terminal"),
        )]);
    }
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
        // As in Zed, every document pane carries the search toolbars: Vim's
        // `/` drives the buffer search bar and project search tabs render
        // their query input in the project search bar.
        for pane in workspace.panes().to_vec() {
            initialize_pane(workspace, &pane, window, cx);
        }
        cx.subscribe_in(&cx.entity(), window, |workspace, _, event, window, cx| {
            if let workspace::Event::PaneAdded(pane) = event {
                initialize_pane(workspace, pane, window, cx);
            }
        })
        .detach();
    })
    .detach();
    Ok(())
}

fn initialize_pane(
    workspace: &workspace::Workspace,
    pane: &gpui::Entity<workspace::Pane>,
    window: &mut gpui::Window,
    cx: &mut gpui::Context<workspace::Workspace>,
) {
    let languages = workspace.project().read(cx).languages().clone();
    pane.update(cx, |pane, cx| {
        pane.toolbar().update(cx, |toolbar, cx| {
            let buffer_search =
                cx.new(|cx| search::BufferSearchBar::new(Some(languages), window, cx));
            toolbar.add_item(buffer_search, window, cx);
            let project_search = cx.new(|_| search::project_search::ProjectSearchBar::new());
            toolbar.add_item(project_search, window, cx);
        })
    });
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
    let presentation = markdown_live_preview::presentation_status(left.read(cx), cx)
        .context("Markdown presentation addon was not attached")?;
    let language = left_buffer
        .read(cx)
        .language()
        .map(|language| language.name());
    ensure!(
        language
            .as_ref()
            .is_some_and(|name| name.as_ref() == "Markdown"),
        "Document language was {language:?}, expected Markdown"
    );
    ensure!(
        presentation.enabled && presentation.rendered_blocks > 0,
        "Live Markdown did not render the regression fixture: {presentation:?}; grammar={}, parsing={:?}, syntax_layers={}",
        left_buffer
            .read(cx)
            .language()
            .is_some_and(|l| l.grammar().is_some()),
        *left_buffer.read(cx).parse_status().borrow(),
        left_buffer.read(cx).snapshot().syntax_layers().count()
    );
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

/// Vim `/` search drives the pane's buffer search bar; it must exist in the
/// application's panes, not only in upstream test fixtures.
pub async fn verify_vim_search(
    workspace: &gpui::Entity<workspace::Workspace>,
    window: gpui::AnyWindowHandle,
    cx: &mut gpui::AsyncApp,
) -> anyhow::Result<()> {
    use super::rehearsal::press;
    use anyhow::{Context as _, ensure};
    use editor::ToOffset as _;
    use gpui::Focusable as _;
    let editor = workspace
        .read_with(cx, |w, cx| w.active_item_as::<editor::Editor>(cx))
        .context("Search editor missing")?;
    window.update(cx, |_, window, cx| {
        window.focus(&editor.focus_handle(cx), cx);
        editor.update(cx, |e, cx| {
            e.set_text("alpha beta gamma\nbeta again\n", window, cx);
            let start = editor::MultiBufferOffset(0);
            e.change_selections(Default::default(), window, cx, |s| {
                s.select_ranges([start..start])
            });
        });
        window.refresh();
        window.draw(cx).clear(cx);
    })?;
    let cursor = |cx: &mut gpui::AsyncApp| {
        editor.read_with(cx, |e, cx| {
            e.selections
                .newest_anchor()
                .head()
                .to_offset(&e.buffer().read(cx).snapshot(cx))
                .0
        })
    };
    for key in ["/", "b", "e", "t", "a"] {
        press(window, key, cx)?;
    }
    // Matches are computed in the background before Enter can jump.
    for _ in 0..100 {
        cx.background_executor()
            .timer(std::time::Duration::from_millis(10))
            .await;
        let searching = window.update(cx, |_, window, _| {
            window
                .context_stack()
                .iter()
                .any(|context| context.contains("BufferSearchBar"))
        })?;
        ensure!(searching, "Vim / did not focus the pane search bar");
        if cursor(cx) == 6 {
            break;
        }
    }
    press(window, "enter", cx)?;
    for _ in 0..100 {
        if cursor(cx) == 6 {
            break;
        }
        cx.background_executor()
            .timer(std::time::Duration::from_millis(10))
            .await;
    }
    ensure!(
        cursor(cx) == 6,
        "Vim / did not move to the first match: {}",
        cursor(cx)
    );
    ensure!(
        window.update(cx, |_, window, cx| editor
            .focus_handle(cx)
            .is_focused(window))?,
        "Vim / search did not return focus to the document"
    );
    press(window, "n", cx)?;
    ensure!(
        cursor(cx) == 17,
        "Vim n did not move to the next match: {}",
        cursor(cx)
    );
    press(window, "shift-n", cx)?;
    ensure!(cursor(cx) == 6, "Vim N did not move back: {}", cursor(cx));
    println!(
        "Vim search rehearsal passed: / opens the pane search bar, Enter jumps and returns focus, n/N repeat."
    );
    Ok(())
}
