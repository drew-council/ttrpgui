//! Session pages list their encounters in a header block above the Markdown.
//! The block belongs to the Zed editor showing the session's `notes.md`; the
//! document text and its undo history are untouched.
use super::campaign::{CampaignModel, open_document};
use campaign_documents::DocumentId;
use campaign_domain::{EncounterId, EncounterStatus, SessionId};
use editor::{
    Editor,
    display_map::{BlockPlacement, BlockProperties, BlockStyle, CustomBlockId},
};
use gpui::{prelude::*, *};
use std::{collections::HashSet, sync::Arc};
use workspace::Workspace;

/// What the header shows; the block is rebuilt only when this changes.
#[derive(Clone, PartialEq)]
struct Row {
    id: EncounterId,
    name: String,
    status: EncounterStatus,
    participants: usize,
}

struct SessionHeader {
    session: SessionId,
    rows: Option<Vec<Row>>,
    block: Option<CustomBlockId>,
    _observation: Subscription,
}

impl editor::Addon for SessionHeader {
    fn to_any(&self) -> &dyn std::any::Any {
        self
    }
    fn to_any_mut(&mut self) -> Option<&mut dyn std::any::Any> {
        Some(self)
    }
}

pub fn init(model: &Entity<CampaignModel>, workspace: &Entity<Workspace>, cx: &mut App) {
    let existing = workspace
        .read(cx)
        .items_of_type::<Editor>(cx)
        .collect::<Vec<_>>();
    let weak_workspace = workspace.downgrade();
    for editor in existing {
        let (model, workspace) = (model.clone(), weak_workspace.clone());
        editor.update(cx, |editor, cx| attach(editor, model, workspace, cx));
    }
    let model = model.clone();
    cx.observe_new(move |editor: &mut Editor, _, cx| {
        attach(editor, model.clone(), weak_workspace.clone(), cx)
    })
    .detach();
}

fn session_for(editor: &Editor, model: &CampaignModel, cx: &App) -> Option<SessionId> {
    if !editor.mode().is_full() {
        return None;
    }
    let buffer = editor.buffer().read(cx).as_singleton()?;
    let path = buffer.read(cx).file()?.as_local()?.abs_path(cx);
    model
        .catalogue
        .documents
        .values()
        .find_map(|document| match document.id {
            DocumentId::Session(id) if model.store.root().join(&document.path) == path => Some(id),
            _ => None,
        })
}

fn attach(
    editor: &mut Editor,
    model: Entity<CampaignModel>,
    workspace: WeakEntity<Workspace>,
    cx: &mut Context<Editor>,
) {
    let Some(session) = session_for(editor, model.read(cx), cx) else {
        return;
    };
    let observed = workspace.clone();
    let observation = cx.observe(&model, move |editor, model, cx| {
        refresh(editor, &model, &observed, cx)
    });
    editor.register_addon(SessionHeader {
        session,
        rows: None,
        block: None,
        _observation: observation,
    });
    refresh(editor, &model, &workspace, cx);
}

/// Insert the header on attach and after campaign changes; called from the
/// model observation so headers follow creation, renames, status and undo.
fn refresh(
    editor: &mut Editor,
    model: &Entity<CampaignModel>,
    workspace: &WeakEntity<Workspace>,
    cx: &mut Context<Editor>,
) {
    let Some(header) = editor.addon::<SessionHeader>() else {
        return;
    };
    let session = header.session;
    let state = model.read(cx).engine.state();
    if !state.sessions.contains_key(&session) {
        return;
    }
    let mut rows = state
        .encounters
        .values()
        .filter(|e| e.session == session)
        .map(|e| Row {
            id: e.id,
            name: e.name.clone(),
            status: e.status,
            participants: e.participants.len(),
        })
        .collect::<Vec<_>>();
    rows.sort_by_cached_key(|row| (row.name.to_lowercase(), row.id));
    if header.rows.as_ref() == Some(&rows) {
        return;
    }
    let previous = header.block;
    if let Some(block) = previous {
        editor.remove_blocks(HashSet::from_iter([block]), None, cx);
    }
    let render = render(rows.clone(), model.clone(), workspace.clone());
    let snapshot = editor.buffer().read(cx).snapshot(cx);
    let placement = BlockPlacement::Above(snapshot.anchor_before(editor::MultiBufferOffset(0)));
    let height = 2 + rows.len().max(1) as u32;
    let block = editor
        .insert_blocks(
            [BlockProperties {
                placement,
                height: Some(height),
                style: BlockStyle::Flex,
                render,
                priority: 0,
            }],
            None,
            cx,
        )
        .into_iter()
        .next();
    if let Some(header) = editor.addon_mut::<SessionHeader>() {
        header.rows = Some(rows);
        header.block = block;
    }
}

/// Encounters listed in a session page's header, for rehearsal assertions.
pub fn listed_encounters(editor: &Editor) -> Option<Vec<EncounterId>> {
    editor
        .addon::<SessionHeader>()
        .and_then(|header| header.rows.as_ref())
        .map(|rows| rows.iter().map(|row| row.id).collect())
}

fn render(
    rows: Vec<Row>,
    model: Entity<CampaignModel>,
    workspace: WeakEntity<Workspace>,
) -> editor::display_map::RenderBlock {
    use super::visuals::palette;
    Arc::new(move |cx| {
        let mut list = div()
            .id(SharedString::from(format!(
                "session-encounters-{:?}",
                cx.block_id
            )))
            .pl(cx.anchor_x)
            .py_1()
            .flex()
            .flex_col()
            .text_color(rgb(palette::TEXT))
            .child(
                div()
                    .text_sm()
                    .text_color(rgb(palette::ACCENT))
                    .child(format!("Encounters in this session ({})", rows.len())),
            );
        if rows.is_empty() {
            list =
                list.child(div().text_sm().child(
                    "None yet — select the session in the navigator and press n to add one.",
                ));
        }
        for row in &rows {
            let (model, workspace, id) = (model.clone(), workspace.clone(), row.id);
            let status = match row.status {
                EncounterStatus::Planned => "planned",
                EncounterStatus::Active => "● active",
                EncounterStatus::Completed => "✓ completed",
            };
            list = list.child(
                div()
                    .id(SharedString::from(format!("session-encounter-{}", row.id)))
                    .text_sm()
                    .text_color(rgb(palette::LINK))
                    .cursor_pointer()
                    .hover(|style| style.underline())
                    .child(format!(
                        "{} — {status}, {} participant{}",
                        row.name,
                        row.participants,
                        if row.participants == 1 { "" } else { "s" }
                    ))
                    .on_click(move |_, window, cx| {
                        open_document(&model, &workspace, DocumentId::Encounter(id), window, cx)
                    }),
            );
        }
        list.into_any_element()
    })
}

pub async fn verify(
    model: &Entity<CampaignModel>,
    workspace: &Entity<Workspace>,
    window: AnyWindowHandle,
    cx: &mut AsyncApp,
) -> anyhow::Result<()> {
    use anyhow::{Context as _, ensure};
    use campaign_domain::Command;
    let (session, path) = model.read_with(cx, |m, _| {
        let session = m
            .engine
            .state()
            .encounters
            .values()
            .next()
            .map(|e| e.session)
            .unwrap_or_else(|| *m.engine.state().sessions.keys().next().unwrap());
        let path = m
            .store
            .root()
            .join(&m.catalogue.documents[&DocumentId::Session(session)].path);
        (session, path)
    });
    let expected = |cx: &mut AsyncApp| {
        model.read_with(cx, |m, _| {
            let mut rows = m
                .engine
                .state()
                .encounters
                .values()
                .filter(|e| e.session == session)
                .map(|e| (e.name.to_lowercase(), e.id))
                .collect::<Vec<_>>();
            rows.sort();
            rows.into_iter().map(|(_, id)| id).collect::<Vec<_>>()
        })
    };
    let item = window
        .update(cx, |_, window, cx| {
            workspace.update(cx, |w, cx| {
                w.open_abs_path(path, Default::default(), window, cx)
            })
        })?
        .await?;
    let editor = cx
        .update(|cx| item.act_as::<Editor>(cx))
        .context("Session page did not open in an editor")?;
    let listed = |cx: &mut AsyncApp| editor.read_with(cx, |e, _| listed_encounters(e));
    ensure!(
        listed(cx) == Some(expected(cx)),
        "Session page header does not list its encounters: {:?} vs {:?}",
        listed(cx),
        expected(cx)
    );
    let added = EncounterId::new();
    model.update(cx, |m, cx| {
        m.execute(
            Command::CreateEncounter {
                id: added,
                session,
                name: "Header rehearsal".into(),
                location: None,
            },
            cx,
        );
    });
    ensure!(
        listed(cx).is_some_and(|ids| ids.contains(&added)) && listed(cx) == Some(expected(cx)),
        "Session page header did not follow a new encounter"
    );
    model.update(cx, |m, cx| m.undo(cx));
    ensure!(
        listed(cx).is_some_and(|ids| !ids.contains(&added)),
        "Session page header did not follow undo"
    );
    super::campaign::wait_saved(model, cx).await?;
    println!(
        "Session page rehearsal passed: the session document lists its encounters with status in a header block that follows creation and undo."
    );
    Ok(())
}
