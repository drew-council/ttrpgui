use super::campaign::{CampaignModel, wait_saved};
use gpui::{App, AppContext, Entity, Window};
use workspace::Workspace;

pub fn init(
    model: Option<Entity<CampaignModel>>,
    workspace: &Entity<Workspace>,
    window: &Window,
    cx: &mut App,
) {
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
            let result = async {
                if let Some(model) = &model {
                    wait_saved(model, cx).await?;
                }
                let Some(workspace) = workspace.upgrade() else {
                    return Ok(true);
                };
                cx.update_window(window, |_, window, cx| {
                    workspace.update(cx, |w, cx| {
                        w.prepare_to_close(workspace::CloseIntent::Quit, window, cx)
                    })
                })?
                .await
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
