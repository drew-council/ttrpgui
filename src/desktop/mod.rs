mod editor_workspace;

use std::{cell::Cell, path::PathBuf, rc::Rc, sync::Arc, time::Duration};

use anyhow::Context as _;
use gpui::{App, AppContext as _, UpdateGlobal};
use settings::SettingsStore;
use workspace::{AppState, OpenMode, Workspace};

/// Compose the native editor proof using one Zed/GPUI dependency graph.
pub fn run(smoke: bool) -> anyhow::Result<()> {
    zlog::init();
    zlog::init_output_stderr();
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    std::fs::create_dir_all(root.join(".editor-proof"))?;
    let instance = std::fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create(true)
        .truncate(false)
        .open(root.join(".editor-proof/instance.lock"))?;
    instance
        .try_lock()
        .context("an editor proof instance is already running")?;
    let data = if smoke {
        root.join(".editor-proof")
            .join(format!("smoke-{}", uuid::Uuid::new_v4()))
    } else {
        root.join(".editor-proof")
    };
    let state = data.join("state");
    std::fs::create_dir_all(&state)?;
    paths::set_custom_data_dir(state.to_str().context("non-UTF-8 state directory")?);

    // Work on copies: the regression fixtures must not change during rehearsals.
    let documents = data.join("documents");
    std::fs::create_dir_all(&documents)?;
    let mut paths = Vec::new();
    for name in ["session.md", "location.md"] {
        let path = documents.join(name);
        if !path.exists() {
            std::fs::copy(root.join("fixtures/editor").join(name), &path)?;
        }
        paths.push(path);
    }

    let outcome = Rc::new(Cell::new(false));
    let result = outcome.clone();
    let application = if smoke {
        gpui_platform::headless()
    } else {
        gpui_platform::application()
    };
    application.with_assets(assets::Assets).run(move |cx| {
        if smoke {
            cx.spawn(async |cx| {
                cx.background_executor()
                    .timer(Duration::from_secs(15))
                    .await;
                cx.update(|cx| {
                    eprintln!("Editor smoke test exceeded its 15-second deadline");
                    cx.quit();
                });
            })
            .detach();
        }
        if let Err(error) = initialize(cx, paths, smoke, result) {
            eprintln!("Failed to start editor proof: {error:#}");
            cx.quit();
        }
    });
    drop(instance);
    if smoke {
        std::fs::remove_dir_all(data)?;
        anyhow::ensure!(outcome.get(), "editor smoke test failed");
    }
    Ok(())
}

fn initialize(
    cx: &mut App,
    paths: Vec<PathBuf>,
    smoke: bool,
    outcome: Rc<Cell<bool>>,
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
    assets::Assets.load_fonts(cx)?;
    menu::init();
    zed_actions::init();
    feature_flags::FeatureFlagStore::init(cx);
    project::trusted_worktrees::init(Default::default(), cx);

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

    let open = Workspace::new_local(paths, app_state, None, None, None, OpenMode::NewWindow, cx);
    cx.spawn(async move |cx| match open.await {
        Ok(opened) => {
            let workspace = opened.workspace;
            let result = opened.window.update(cx, |_, window, cx| {
                window.set_window_title("ttrpgui — editor proof");
                let split = workspace.update(cx, |workspace, cx| {
                    if workspace.panes().len() == 1 {
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
                    if smoke {
                        let verified = opened.window.update(cx, |_, window, cx| {
                            let result = editor_workspace::verify(&workspace, window, cx);
                            if let Err(error) = &result {
                                eprintln!("Editor smoke test: {error:#}");
                            }
                            outcome.set(result.is_ok());
                            cx.quit();
                        });
                        if let Err(error) = verified {
                            eprintln!("Editor smoke test: {error:#}");
                        }
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
