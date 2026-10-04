# ADR 001: Keep Zed's editing model authoritative

Status: accepted. The source-on-edit editor foundation and the campaign
baseline pass the checks in [verification.md](verification.md); the requirement
audit is [baseline.md](baseline.md) and current limits are in
[handoff.md](handoff.md). The brief is in
[original-requirements.md](original-requirements.md).

The desktop composes Zed's `Workspace`, `Project`, `Editor`, `vim`, search,
command palette, and the live Markdown addon from **one source revision**.
`upstream/zed.lock.toml` pins the archive and its SHA-256; the root Cargo lockfile
pins the application's transitive dependencies. Upstream test code and its
Neovim comparison harness remain available. Neovim is a test dependency only.
Application composition is in `src/desktop`; upstream modifications are exported
as reviewable patches, rather than mixed into application code.

## Editing surface

The preferred rich surface is not yet proven. The current implementation uses
the plan's accepted **live Markdown with source-on-edit fallback**:

| Construct | Away from selection | At the editing selection |
| --- | --- | --- |
| Emphasis, inline code, links, list markers | Styled, concealed punctuation | Relevant source markers reveal |
| Headings, quotes, fenced blocks | Native block presentation | Parent buffer source reveals |
| Tables | Native table widget | Parent buffer source reveals, including cell clicks |
| Images | Native image widget | Parent buffer source reveals |
| Unsupported syntax | Preserved in Markdown | Ordinary source editing |

Ctrl+Alt+M toggles source/live presentation for the focused editor. Text remains
Markdown in both modes. Formatting actions (Ctrl+Alt+B bold, Ctrl+Alt+I italic;
strike, code, heading, bullet and Insert Image from the palette) are editor
actions on the same buffer: each is one transaction over every selection, so a
single Vim `u` reverts it. Inline formats toggle when the selection already
carries the delimiters. Insert Image copies the chosen file into the page's
`assets/` through the storage worker and inserts a relative link at the cursor
anchor captured before the chooser opened. There is no source/preview pair or second document model.
A split uses Zed's `clone_on_split`, retaining the same underlying project buffer
with independent selections and scroll state. Zed owns Vim modes, selections,
registers, transactions, text undo, and document saving.

The original addon's table-cell overlay was a single-line `Editor` with a
separate text buffer, a blur-time commit, and its own selection state. Patch 1
removes it. Clicking a cell resolves anchored ranges against the current buffer,
focuses the parent editor, and moves the caret to the cell's content without
editing text or switching Vim mode. Escape has ordinary Vim semantics: it exits
Insert/Visual mode; `u` undoes a committed text edit. There is no hidden draft to
commit on blur or cancel. Structural table actions still edit the parent buffer.

Keyboard selections must reveal tables and images as well as other blocks;
requiring a mouse-only source button would make these constructs inaccessible to
ordinary document editing. Formatting preservation means preserving Markdown
through source-backed transactions here, not promising semantic rich-text
operators that rewrite markup around arbitrary selections.

Live Neovim comparisons exposed display-coordinate failures at concealed inline
punctuation and multi-line replacement blocks. The editor now offers an addon
source-display scope. Vim's existing editor-update boundary enters that scope,
temporarily suspending only the Markdown addon's decorations, then restores
cached presentation before the next frame. This preserves upstream source
coordinates without replacing Vim's operators or the document engine. Tests
cover commands crossing bold text, tables, images, quotes, and headings. All
564 upstream Vim tests and 32 Markdown-addon tests pass with the six-patch
series, as do the live Neovim comparisons and the application's formatting,
search and image rehearsals.

The suspend/restore around each Vim operation is the main interaction cost on
long notes. Patch 5 limits presentation to the viewport; patch 6 merges
same-row concealment edits (so tab and wrap maps rescan each line once) and
narrows the margin to ±30 buffer rows. Scrolling re-applies decorations, so the
margin only covers autoscroll within a frame.

## Prior art decision

[Zed PR 62593](https://github.com/zed-industries/zed/pull/62593) supplies the
presentation layer and concealment primitives at the pinned revision. Its
closure is not a correctness verdict. This project's tests must establish the
behavior we depend on.

[Velotype](https://github.com/manyougz/velotype) is a reference for rich blocks and
[source mapping](https://github.com/manyougz/velotype/blob/main/src/editor/source_mapping.rs).
A second editor with its own AST/source positions would introduce a second
selection/transaction model. No Velotype code has been imported. Richer editable
blocks remain a separate experiment until they can submit anchored edits through
the parent Zed buffer and pass the same Vim tests. Neither its performance nor
its Vim compatibility is assumed.

## Gate and remaining boundaries

The gate requires a launched demonstration, passing Markdown/Vim regressions,
keyboard traversal across rendered blocks, table focus and undo, Unicode and
clipboard behavior, and shared-buffer consistency. Compilation alone does not
pass it. See `verification.md` for actual results and unverified cases.

The implemented workspace boundaries are:

- `crates/domain`: typed UUID entities, commands, validation, combat lifecycle,
  and structured undo; no GPUI dependencies.
- `crates/storage`: human-readable TOML/Markdown, atomic file replacement,
  recoverable batches, external conflict checks, and explicit recovery backups.
- `crates/documents`: document identity, templates, portable links, aliases,
  backlinks, revision-checked derived search indexes, and fuzzy search.
- `patches/zed`: editor integration and Markdown presentation changes.
- `src/desktop`: native workspace composition, campaign navigation, encounters,
  fields, links, and shared semantic Catppuccin colors. Encounter rendering,
  persistence, and rehearsal code have separate modules.

Campaign buttons and form layouts use GPUI Kit's `gpui-component` layer. Version
0.5.1 is pinned with an Apache-2.0 notice and a compatibility patch for the Zed
GPUI revision. Newer Kit releases require a different GPUI graph. Kit supplies
controls; Zed retains workspace items, panes, editors and action dispatch. Draft
descriptions use a full Zed editor so multiline Vim undo remains available.

## Workspace integration

Zed's own binary configures several things this application must do itself:

- **Pane toolbars.** Every pane gets Zed's `BufferSearchBar` and
  `ProjectSearchBar` on creation (`editor_workspace::initialize_pane`). Vim's
  `/` drives the buffer search bar and project search tabs render their query
  input in the project search bar; without them both silently did nothing.
  (`PaneSearchBarCallbacks` is only consumed by Zed's terminal panel.)
- **Prompts.** Linux has no native dialogs and GPUI's fallback prompt is
  mouse-only, so `ui_prompt` installs Zed's themed in-window prompt (Enter,
  Esc, h/l). Save conflicts and close prompts are therefore keyboard-operable.
- **Tab movement.** Ctrl-W m h/j/k/l move the active tab to the neighbouring
  pane, alongside Zed's Ctrl-W pane commands.
- **File choosers.** On Linux even GPUI's headless platform opens file choosers
  through the desktop portal. Rehearsals supply an image through
  `RehearsalImage` instead of prompting, and verification hides the session bus.

Session pages carry a header block (`session_page.rs`) listing the session's
encounters with status and participant count. It is an editor block owned by
the page's Zed editor, refreshed from the campaign model; the Markdown text and
its undo history are untouched.

The navigator's browse list has collapsible Sessions, Creatures, Locations and
Notes groups with counts; h collapses to the nearest parent, l or Enter expands.
Filtered search, link completion and ambiguity pickers stay flat.

Completed encounters refuse editing keys with an explanation in the view; the
domain also rejects such commands.

## Campaign state and persistence

Campaign directories are portable. Creature, location, session, and note UUID
folders contain `metadata.toml`, `notes.md`, and optional relative assets.
Encounters live beneath their sessions; configuration and persistent character
HP have separate root TOML files. Templates are ordinary Markdown with a
`{{title}}` substitution. Search indexes and workspace layout are derived state.

Domain commands validate a candidate before committing one undo step. A bulk
edit remains one step. Persistent character HP is resolved when an encounter
starts, and completed encounters retain their own snapshots. A campaign has at
most one active encounter. Prose remains in Zed buffers and its undo history is
independent of structured domain history.

A durable journal records both sides of each multi-file mutation before file
replacement. Recovery preflights the whole batch and retains the journal on an
external conflict. Failed saves retain structured work in `.unsaved.toml`.
Explicit restoration first preserves exact external metadata in `.recovery`.
The Linux watcher registers subdirectories and scans newly created directories;
clean structured changes reload, while dirty changes preserve both versions.
Open prose buffers remain authoritative when updating the derived index.

One dedicated storage worker owns the campaign lock and executes queued writes
in order. Dropping the caller's future does not cancel an authorized save. The
UI shows queued, saved and failed state; recovery status reflects whether a
copy actually exists. Quit waits for pending campaign writes, serializes every
open item, flushes independent editor cursor/scroll state, and saves the pane
layout. Split restoration applies identical unsaved text only once to avoid
moving already-restored anchors in other views.

Renames retain old names as aliases and rewrite resolvable links. Link
maintenance is one serialized loop that remembers the catalogue the documents'
links currently reflect. It rewrites from there to the newest catalogue, starts
again if a rename lands while it is preparing, and on failure keeps that base:
Retry save (button or palette) resumes it, and quitting waits for it. A second
Ctrl+Shift+Q after a reported save failure quits anyway, leaving the recovery
copy and disk files in place.

Open prose follows Zed's buffer rules: a dirty page whose file changes on disk
is marked conflicted, autosave skips it, the navigator status names it, and an
explicit save asks to overwrite or discard the edits. Open files
receive editor transactions; closed files receive a recoverable compare-before-
write batch. Metadata and link edits are separate transactions, with retained
aliases protecting wiki-link resolution across an interrupted rename. Directory
identity is UUID-based, so renaming a page does not move its assets.

Application data defaults to `$XDG_DATA_HOME/ttrpgui`, with `TTRPGUI_DATA_DIR` as
an override. Explicit `--campaign` directories are independent of settings and
workspace state. Fixture copies are only used by the headless editor proof.
The launcher handles `--printenv` before initializing GPUI and holds an instance
lock. Packaging includes runtime library paths, attribution, and application
source with the pinned upstream bootstrap recipe.

The application offers no page move: identity is UUID-based and renames never
move directories. Relative-link rewriting on path changes exists and is tested
for a future move feature (for example moving an encounter between sessions,
which would also need its prose, assets and open buffers relocated in one
journaled batch).

Measured results, including sustained saves on a 10,000-page campaign, are in
verification.md. They are CPU frame-construction times, not display latency.
