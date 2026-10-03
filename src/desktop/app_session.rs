use super::campaign::{CampaignModel, wait_saved};
use gpui::{App, AppContext, Entity, Window};
use workspace::Workspace;

pub fn init(
    model: Option<Entity<CampaignModel>>,
    workspace: &Entity<Workspace>,
    window: &Window,
    cx: &mut App,
) {
    // Ctrl-Q is a Vim command inside editors. Give application quit a distinct
    // shortcut so modal editing retains the upstream keymap.
    cx.bind_keys([gpui::KeyBinding::new(
        "ctrl-shift-q",
        zed_actions::Quit,
        None,
    )]);
    let workspace = workspace.downgrade();
    let window = window.window_handle();
    let pending = std::rc::Rc::new(std::cell::Cell::new(false));
    cx.on_action(move |_: &zed_actions::Quit, cx| {
        if pending.replace(true) {
            return;
        }
        let pending = pending.clone();
        let model = model.clone();
        let workspace = workspace.clone();
        cx.spawn(async move |cx| {
            let result: anyhow::Result<bool> = async {
                if let Some(model) = &model {
                    wait_saved(model, cx).await?;
                }
                let Some(workspace) = workspace.upgrade() else {
                    return Ok(true);
                };
                let approved = cx
                    .update_window(window, |_, window, cx| {
                        workspace.update(cx, |w, cx| {
                            w.prepare_to_close(workspace::CloseIntent::Quit, window, cx)
                        })
                    })?
                    .await?;
                if approved {
                    let items = cx.update_window(window, |_, window, cx| {
                        workspace.update(cx, |w, cx| {
                            let items = w
                                .items(cx)
                                .filter_map(|item| item.to_serializable_item_handle(cx))
                                .collect::<Vec<_>>();
                            items
                                .into_iter()
                                .filter_map(|item| item.serialize(w, false, window, cx))
                                .collect::<Vec<_>>()
                        })
                    })?;
                    for item in items {
                        item.await?;
                    }
                    let views = cx.update_window(window, |_, window, cx| {
                        let w = workspace.read(cx);
                        let workspace_id = w.database_id();
                        let editors = w.items_of_type::<editor::Editor>(cx).collect::<Vec<_>>();
                        editors
                            .into_iter()
                            .filter_map(|editor| {
                                workspace_id.map(|id| {
                                    editor.update(cx, |e, cx| e.flush_view_state(id, window, cx))
                                })
                            })
                            .collect::<Vec<_>>()
                    })?;
                    for view in views {
                        view.await?;
                    }
                    cx.update_window(window, |_, window, cx| {
                        workspace.update(cx, |w, cx| w.flush_serialization(window, cx))
                    })?
                    .await;
                }
                Ok(approved)
            }
            .await;
            pending.set(false);
            match result {
                Ok(true) => cx.update(|cx| cx.quit()),
                Ok(false) => (),
                Err(error) => {
                    if let Some(model) = model {
                        model.update(cx, |m, cx| {
                            m.error =
                                Some(format!("Could not finish saving before quit: {error:#}"));
                            cx.notify();
                        });
                    } else {
                        eprintln!("Could not finish saving before quit: {error:#}");
                    }
                }
            }
        })
        .detach();
    });
}
