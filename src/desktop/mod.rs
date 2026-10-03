mod app_session;
mod campaign;
mod editor_workspace;
mod encounter;
mod fields;
mod link_completion;
mod link_maintenance;
mod markdown_actions;
mod navigator;
mod performance;
mod persistence;
mod rehearsal;
mod visuals;
mod watcher;

use std::{cell::Cell, path::PathBuf, rc::Rc, sync::Arc, time::Duration};

use anyhow::Context as _;
use gpui::{App, AppContext as _, UpdateGlobal};
use settings::SettingsStore;
use theme::ActiveTheme as _;
use workspace::{AppState, OpenMode, Workspace};

/// Compose the native campaign app using one Zed/GPUI dependency graph.
pub fn run(
    smoke: bool,
    campaign_root: Option<PathBuf>,
    session_probe: Option<bool>,
    performance_probe: bool,
) -> anyhow::Result<()> {
    zlog::init();
    zlog::init_output_stderr();
    let root = if let Some(path) = std::env::var_os("TTRPGUI_DATA_DIR") {
        PathBuf::from(path)
    } else if let Some(path) = std::env::var_os("XDG_DATA_HOME") {
        PathBuf::from(path).join("ttrpgui")
    } else {
        PathBuf::from(
            std::env::var_os("HOME").context("Set HOME, XDG_DATA_HOME, or TTRPGUI_DATA_DIR")?,
        )
        .join(".local/share/ttrpgui")
    };
    std::fs::create_dir_all(&root)?;
    let instance = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(root.join("instance.lock"))?;
    instance
        .try_lock()
        .context("a ttrpgui instance is already running")?;
    let data = if session_probe.is_some() {
        root.join("session-rehearsal")
    } else if smoke {
        root.join(format!("smoke-{}", uuid::Uuid::new_v4()))
    } else {
        root.clone()
    };
    let state = data.join("state");
    std::fs::create_dir_all(&state)?;
    paths::set_custom_data_dir(state.to_str().context("non-UTF-8 state directory")?);

    // Work on copies: the regression fixtures must not change during rehearsals.
    let documents = data.join("documents");
    std::fs::create_dir_all(&documents)?;
    let mut paths = Vec::new();
    for (name, contents) in [
        (
            "session.md",
            include_str!("../../fixtures/editor/session.md"),
        ),
        (
            "location.md",
            include_str!("../../fixtures/editor/location.md"),
        ),
    ] {
        let path = documents.join(name);
        if !path.exists() {
            std::fs::write(&path, contents)?;
        }
        paths.push(path);
    }

    if performance_probe {
        performance::seed(&data.join("campaign"))?;
    }
    let campaign = if smoke && campaign_root.is_none() {
        None
    } else {
        Some(campaign::CampaignModel::open(if smoke {
            data.join("campaign")
        } else {
            campaign_root.unwrap_or_else(|| root.join("campaign"))
        })?)
    };
    if let Some(campaign) = &campaign {
        paths = vec![campaign.store.root().to_path_buf()];
    }

    let persistence = campaign.as_ref().map(|model| model.store.clone());
    let outcome = Rc::new(Cell::new(false));
    let result = outcome.clone();
    let application = if smoke {
        gpui_platform::headless()
    } else {
        gpui_platform::application()
    };
    application.with_assets(assets::Assets).run(move |cx| {
        if smoke {
            let deadline_outcome = result.clone();
            cx.spawn(async move |cx| {
                cx.background_executor()
                    .timer(Duration::from_secs(15))
                    .await;
                cx.update(|cx| {
                    deadline_outcome.set(false);
                    eprintln!("Editor smoke test exceeded its 15-second deadline");
                    cx.quit();
                });
            })
            .detach();
        }
        if let Err(error) = initialize(
            cx,
            paths,
            smoke,
            result,
            campaign,
            session_probe,
            performance_probe,
        ) {
            eprintln!("Failed to start editor proof: {error:#}");
            cx.quit();
        }
    });
    if let Some(persistence) = persistence {
        persistence.finish()?;
    }
    drop(instance);
    if smoke && session_probe.is_none() {
        std::fs::remove_dir_all(data)?;
    }
    anyhow::ensure!(outcome.get(), "editor startup or verification failed");
    Ok(())
}

fn initialize(
    cx: &mut App,
    paths: Vec<PathBuf>,
    smoke: bool,
    outcome: Rc<Cell<bool>>,
    campaign: Option<campaign::CampaignModel>,
    session_probe: Option<bool>,
    performance_probe: bool,
) -> anyhow::Result<()> {
    release_channel::init(semver::Version::new(0, 1, 0), cx);
    cx.set_global(db::AppDatabase::new());
    gpui_tokio::init(cx);
    settings::init(cx);
    SettingsStore::update_global(cx, |store, cx| {
        store
            .set_user_settings(include_str!("../../assets/editor-settings.json"), cx)
            .result()
    })?;
    theme_settings::init(theme::LoadThemes::All(Box::new(assets::Assets)), cx);
    theme_settings::load_user_theme(
        &theme::ThemeRegistry::global(cx),
        include_bytes!("../../assets/themes/catppuccin-mauve.json"),
    )?;
    theme_settings::reload_theme(cx);
    visuals::init_controls(cx);
    assets::Assets.load_fonts(cx)?;
    menu::init();
    zed_actions::init();
    feature_flags::FeatureFlagStore::init(cx);
    let trusted_fixtures = [(
        None,
        paths
            .iter()
            .filter_map(|path| {
                if path.is_dir() {
                    Some(path.clone())
                } else {
                    path.parent().map(std::path::Path::to_path_buf)
                }
            })
            .collect(),
    )]
    .into_iter()
    .collect();
    project::trusted_worktrees::init(trusted_fixtures, cx);

    cx.set_http_client(Arc::new(reqwest_client::ReqwestClient::new()));
    let fs: Arc<dyn fs::Fs> = Arc::new(fs::RealFs::new(None, cx.background_executor().clone()));
    <dyn fs::Fs>::set_global(fs.clone(), cx);
    let client = client::Client::production(cx);
    client::Client::set_global(client.clone(), cx);
    client::init(&client, cx);
    project::Project::init(&client, cx);

    let node_runtime = node_runtime::NodeRuntime::unavailable();
    let languages = Arc::new(language::LanguageRegistry::new(
        cx.background_executor().clone(),
    ));
    // Register only the two Markdown grammars. Campaign notes do not need
    // programming-language servers, grammar downloads, or language toolchains.
    for (name, grammar) in [
        ("markdown", tree_sitter_md::LANGUAGE.into()),
        ("markdown-inline", tree_sitter_md::INLINE_LANGUAGE.into()),
    ] {
        languages.add(Arc::new(
            language::Language::new(grammars::load_config(name), Some(grammar))
                .with_queries(grammars::load_queries(name))?,
        ));
    }
    languages.set_theme(cx.theme().clone());
    cx.observe_global::<theme::GlobalTheme>({
        let languages = languages.clone();
        move |cx| languages.set_theme(cx.theme().clone())
    })
    .detach();
    let user_store = cx.new(|cx| client::UserStore::new(client.clone(), cx));
    let workspace_store = cx.new(|cx| workspace::WorkspaceStore::new(client.clone(), cx));
    let session = gpui::block_on(session::Session::new(
        uuid::Uuid::new_v4().to_string(),
        db::kvp::KeyValueStore::global(cx),
    ));
    let session = cx.new(|cx| session::AppSession::new(session, cx));
    let app_state = Arc::new(AppState {
        client,
        fs,
        languages,
        user_store,
        workspace_store,
        node_runtime,
        session,
        build_window_options: |_, _| gpui::WindowOptions {
            app_id: Some("io.ttrpgui.desktop".into()),
            ..Default::default()
        },
    });
    AppState::set_global(app_state.clone(), cx);

    editor::init(cx);
    workspace::init(app_state.clone(), cx);
    command_palette::init(cx);
    file_finder::init(cx);
    search::init(cx);
    vim::init(cx);
    markdown_live_preview::init(cx);
    editor_workspace::init(cx)?;
    markdown_actions::init(cx);
    encounter::init(cx);
    navigator::init(cx);
    cx.bind_keys([gpui::KeyBinding::new(
        "ctrl-alt-c",
        navigator::ToggleNavigator,
        None,
    )]);
    cx.observe_new(|workspace: &mut Workspace, _, _cx| {
        workspace.register_action(|w, _: &navigator::ToggleNavigator, window, cx| {
            w.toggle_panel_focus::<navigator::Navigator>(window, cx);
        });
    })
    .detach();
    let campaign = campaign.map(|model| cx.new(|_| model));
    if let Some(model) = &campaign {
        cx.set_global(campaign::ActiveCampaign(model.clone()));
        workspace::register_serializable_item::<encounter::EncounterView>(cx);
    }

    let open = Workspace::new_local(paths, app_state, None, None, None, OpenMode::NewWindow, cx);
    cx.spawn(async move |cx| match open.await {
        Ok(opened) => {
            let workspace = opened.workspace;
            let result = opened.window.update(cx, |_, window, cx| {
                window.set_window_title("ttrpgui — campaign workspace");
                app_session::init(campaign.clone(), &workspace, window, cx);
                if let Some(model) = &campaign {
                    link_completion::init(model, &workspace, window, cx);
                    link_maintenance::init(model, &workspace, cx);
                    watcher::watch(model, &workspace, cx);
                    let panel = cx.new(|cx| {
                        navigator::Navigator::new(model.clone(), workspace.downgrade(), window, cx)
                    });
                    workspace.update(cx, |w, cx| w.add_panel(panel, window, cx));
                    let first = model
                        .read(cx)
                        .catalogue
                        .documents
                        .keys()
                        .find(|id| matches!(id, campaign_documents::DocumentId::Note(_)))
                        .copied()
                        .or_else(|| {
                            model
                                .read(cx)
                                .engine
                                .state()
                                .active_encounter()
                                .map(|e| campaign_documents::DocumentId::Encounter(e.id))
                        });
                    if let Some(first) = first.filter(|_| {
                        session_probe.is_none() && workspace.read(cx).items(cx).next().is_none()
                    }) {
                        campaign::open_document(model, &workspace.downgrade(), first, window, cx);
                    }
                }
                let split = workspace.update(cx, |workspace, cx| {
                    if smoke && campaign.is_none() && workspace.panes().len() == 1 {
                        Some(workspace.split_and_clone(
                            workspace.active_pane().clone(),
                            workspace::SplitDirection::Right,
                            window,
                            cx,
                        ))
                    } else {
                        None
                    }
                });
                cx.activate(true);
                split
            });
            match result {
                Ok(split) => {
                    if let Some(split) = split {
                        split.await;
                    }
                    if !smoke {
                        outcome.set(true);
                        if std::env::var_os("TTRPGUI_NATIVE_CHECK").is_some() {
                            let workspace = workspace.clone();
                            let window = opened.window.into();
                            cx.spawn(async move |cx| {
                                if let Err(error) =
                                    rehearsal::native_note(&workspace, window, cx).await
                                {
                                    eprintln!("Native editor check failed: {error:#}");
                                }
                            })
                            .detach();
                        }
                    }
                    if performance_probe {
                        let result = performance::verify(
                            campaign.as_ref().unwrap(),
                            &workspace,
                            opened.window.into(),
                            cx,
                        )
                        .await;
                        if let Err(error) = &result {
                            eprintln!("Performance rehearsal failed: {error:#}");
                        }
                        outcome.set(result.is_ok());
                        cx.update(|cx| cx.quit());
                        return;
                    }
                    if let Some(restoring) = session_probe {
                        let verified = rehearsal::session(
                            restoring,
                            campaign.as_ref().unwrap(),
                            &workspace,
                            opened.window.into(),
                            cx,
                        )
                        .await;
                        match verified {
                            Ok(()) => {
                                outcome.set(true);
                                let _ = cx.update_window(opened.window.into(), |_, window, cx| {
                                    window.dispatch_keystroke(
                                        gpui::Keystroke::parse("ctrl-shift-q").unwrap(),
                                        cx,
                                    );
                                });
                            }
                            Err(error) => {
                                eprintln!("Session rehearsal failed: {error:#}");
                                cx.update(|cx| cx.quit());
                            }
                        }
                        return;
                    }
                    if smoke {
                        let parsing = workspace.read_with(cx, |w, cx| {
                            w.items_of_type::<editor::Editor>(cx)
                                .filter_map(|e| e.read(cx).buffer().read(cx).as_singleton())
                                .map(|b| b.read(cx).parsing_idle())
                                .collect::<Vec<_>>()
                        });
                        futures::future::join_all(parsing).await;
                        // Deliver parse events to editor addons before drawing.
                        cx.background_executor()
                            .timer(Duration::from_millis(1))
                            .await;
                        if let Some(model) = &campaign {
                            if let Err(error) =
                                rehearsal::links(model, &workspace, opened.window.into(), cx).await
                            {
                                eprintln!("Link rehearsal failed: {error:#}");
                                cx.update(|cx| cx.quit());
                                return;
                            }
                        }
                        let verified = cx.update_window(opened.window.into(), |_, window, cx| {
                            let result = if let Some(model) = &campaign {
                                encounter::verify(model, &workspace, window, cx)
                            } else {
                                editor_workspace::verify(&workspace, window, cx)?;
                                markdown_actions::verify(&workspace, window, cx)
                            };
                            if let Err(error) = &result {
                                eprintln!("Editor smoke test: {error:#}");
                            }
                            result
                        });
                        let mut verified = verified.and_then(|result| result);
                        if verified.is_ok() {
                            if let Some(model) = &campaign {
                                verified = encounter::verify_description(
                                    model,
                                    &workspace,
                                    opened.window.into(),
                                    cx,
                                )
                                .await;
                                if verified.is_ok() {
                                    verified = campaign::wait_saved(model, cx).await;
                                }
                            }
                        }
                        if verified.is_ok() && campaign.is_some() {
                            verified =
                                rehearsal::restore(&workspace, opened.window.into(), cx).await;
                        }
                        if verified.is_ok() {
                            if let Some(model) = &campaign {
                                verified = rehearsal::rename_links(
                                    model,
                                    &workspace,
                                    opened.window.into(),
                                    cx,
                                )
                                .await;
                                if verified.is_ok() {
                                    verified = navigator::verify(
                                        model,
                                        &workspace,
                                        opened.window.into(),
                                        cx,
                                    )
                                    .await;
                                    if verified.is_ok() {
                                        verified = encounter::verify_session(
                                            model,
                                            &workspace,
                                            opened.window.into(),
                                            cx,
                                        )
                                        .await;
                                    }
                                    if verified.is_ok() {
                                        verified = rehearsal::external_changes(model, cx).await;
                                    }
                                }
                            }
                        }
                        if let Err(error) = &verified {
                            eprintln!("Editor smoke test: {error:#}");
                        }
                        outcome.set(verified.is_ok());
                        cx.update(|cx| cx.quit());
                    }
                }
                Err(error) => {
                    eprintln!("Failed to present editor workspace: {error:#}");
                    cx.update(|cx| cx.quit());
                }
            }
        }
        Err(error) => {
            eprintln!("Failed to open editor documents: {error:#}");
            cx.update(|cx| cx.quit());
        }
    })
    .detach();
    Ok(())
}
