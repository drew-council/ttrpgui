# ADR 001: Keep Zed's editing model authoritative

Status: source-on-edit editor foundation accepted for campaign integration.
The complete campaign release and performance gates remain under verification.
Implementation stopped for user-requested handoff on 2026-10-03; see
[handoff.md](handoff.md) for the failing formatting/bootstrap checks and remaining
work. The original brief is in [original-requirements.md](original-requirements.md).

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
Markdown in both modes. There is no source/preview pair or second document model.
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
564 upstream Vim tests and 32 Markdown-addon tests passed with the current
viewport patch series; the live Neovim comparisons also pass. These do not
substitute for the currently failing application formatting proof. See
verification.md for current checks and historical results.

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

Renames retain old names as aliases and rewrite resolvable links. Open files
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

See `verification.md` for release acceptance still requiring work, including
large-campaign persistence and end-to-end rendering measurements. Moving disk
writes off the UI thread does not by itself establish smooth large-campaign
interaction. The original requirements are tracked in baseline.md.
