# Original project requirements

This is the implementation brief from the user's original plan, summarized for
handoff. It describes the intended baseline. [baseline.md](baseline.md) maps each
requirement to its verification or to an explicit decision, and
[handoff.md](handoff.md) records current limits. The full original plan remains
in the conversation.

## Constraints and direction

- Build a fully native GPUI campaign application, Linux/Wayland first. Reuse
  **linked Zed Rust editor, Vim and workspace libraries**; never depend on or
  launch an external Zed application.
- Preserve Zed's actual editing model and Vim implementation together:
  selections, anchors, transactions, registers, repeat, macros and text undo.
  Preserve upstream tests and the Neovim comparison harness. Neovim is a test
  reference only, never an application dependency.
- Pin exact upstream revisions, use one compatible GPUI graph, keep application
  code separate from exported upstream patches, and preserve attribution.
- Start from Zed PR 62593's native live Markdown addon, audit/adapt it, and use
  suitable Velotype presentation/source-mapping techniques if useful. Do not
  synchronize two independent Zed/Velotype editors or document models. Markion
  is secondary prior art. Modalkit, embedded Neovim and a web editor are excluded.
- GPL-3.0-or-later application; retain upstream licenses and notices.
- Fresh campaign data; structured stats initially HP, AC and initiative. Richer
  stat blocks remain ordinary Markdown.
- D&D Beyond, Logseq migration, multiplayer, cloud sync and full rules automation
  are outside this first release.
- Later user steering: adopt useful [GPUI Kit](https://gpui-kit.com/) controls.
  Avoid desktop disruption: do not launch GUI proofs into the running desktop
  or flood it with windows. Use isolated headless/offscreen verification.
- Use `uv` for all Python execution; do not assume `python`/`python3`. Use Ruff
  to check Python, not Python compilation. Prefer Nushell for shell scripts.

## Editor gate comes first

Begin with two Markdown tabs and a split sharing authoritative document buffers.
Zed owns editing and Vim state; Markdown presentation maps to stable buffer
positions. Formatting, links, images and table actions must submit edits through
the same document transaction system. Parse/render incrementally and discard
stale results by revision.

Preferred behavior is direct editing of rendered content while preserving
formatting during ordinary Vim operations. Explicitly investigate deletion
across formatting boundaries, proportional wrapped text, selections across
blocks, table focus/cancellation and shared undo. Concealing punctuation alone
does not establish that behavior.

If reliable semantic editing would require substantially rewriting Vim or the
document engine, the accepted first-release fallback is **native live Markdown
with source revealed for editing affected constructs**. Source-plus-preview is
not the intended default. Keep an explicit source toggle and preserve all
unsupported Markdown during editing and saving.

The addon's separate single-line table-cell editor must be replaced with parent
document editing, with focus, Vim, cancellation and undo checked. Deliver a
working demonstration, regressions and an architecture decision stating the
supported editing surface before substantial campaign UI work.

## Workspace and keyboard experience

- Reuse Zed Workspace/Pane/tab/split/action/command-palette mechanisms. Campaign
  pages and encounters are workspace items, extensible without a new navigation
  system or a premature plugin framework.
- Default to one main tab group. Support both split axes, keyboard pane
  navigation, moving tabs between panes, history and previous layout restoration.
  Multiple views share a document's content but retain independent cursors/scroll.
- Collapsible campaign navigator for sessions, encounters, creatures, locations
  and notes. A unified fuzzy picker searches names/aliases and shows type and
  portrait/location thumbnails. Full-text search opens as a workspace item.
- Preserve Zed Vim inside editors. Encounter lists support j/k, first/last,
  Space selection, +/- health, initiative entry, rename, description editing,
  undo and redo. Scope shortcuts to focused controls so typing cannot trigger
  combat commands. Esc cancels an interaction or clears selection; quit is an
  explicit application action. Show contextual shortcuts and active mode.
- Anchored field editors, inline validation, explicit selection counts, portraits,
  readable health indicators and keyboard-accessible contextual menus.
- Use semantic Catppuccin Mocha colors: Base content, Mantle/Crust surroundings,
  Surface controls, Mauve primary/focus, Blue links, appropriate status colors.
  Focus, selection and low health must have cues beyond color.

## Combat feature and flow parity

Port the **implementation** of `ttrpgtui`, including behavior absent from its
README. The local reference is `../ttrpgtui`; keep it read-only.

- Session creation and session/encounter hierarchy; encounter creation,
  reopening and automatic campaign roster inclusion.
- Optional initiative and AC; descending initiative, unknown values last.
- Single and bulk health, initiative and description changes. A bulk mutation is
  one undoable action. Heal at most to maximum HP; retain negative HP.
- Creature rename and multiple individually identified copies. Monster health
  is independent. Maintain cursor/focus/selection identity when initiative sorts.
- Automatic save, visible persistence failures and undo/redo for mutations.
- Encounter description is separate from the creature's campaign notes.
- Adding opens a campaign creature-library picker with quantity and initiative.
  Create-new remains immediately available. Save encounter-only creatures to
  the library later.
- Creature/location links open normal page tabs. Encounter location, parent
  session and participants are navigable; session pages list their encounters.

## Campaign model and portable files

Use a campaign directory as the source of truth: human-editable TOML metadata,
ordinary Markdown prose, optional assets. Creatures, locations, sessions and
notes each have a directory. Encounters live under sessions. Campaign config
holds the default roster; templates have a dedicated directory.

Use stable UUID relationships and distinguish:

1. Creature definitions: name, maximum HP, optional AC, portrait, notes and
   persistent-character versus reusable-template kind.
2. Persistent character state: current HP carried between encounters.
3. Encounter participants: independent ID, initiative, local name/description
   overrides and encounter state.
4. Historical snapshots: completed encounters keep recorded values; changing a
   library definition must not rewrite them.

Lifecycle is planned, active, completed, with one active encounter per campaign.
Starting resolves participant state. Completing preserves history. Merely
viewing an older encounter cannot modify current character health. Reset health
for a character or selected characters restores maximum HP and is undoable.

Support relative Markdown links and `[[page]]`, `[[page|label]]`, and headings.
Typing `[[` invokes completion; generated links default to relative Markdown for
portability. Resolve ambiguous names with a picker. Maintain backlinks and update
affected links on application-managed moves/renames. Include structured related
relationships in navigation.

## Maintainable boundaries and persistence

| Boundary | Responsibility |
| --- | --- |
| Domain | Typed campaign entities/commands, validation, combat rules and structured undo; no GPUI |
| Storage | TOML/Markdown, atomic writes, recoverable batches, filesystem watching/recovery |
| Documents | Identity/handles, links, templates, backlinks, search indexing |
| Editor integration | Pinned Zed/Vim integration and Markdown presentation patches |
| Desktop | Workspace items, navigator, encounter controls and shared components |

Keep entrypoints limited to initialization/composition. Split substantial desktop
features into state, commands and rendering. Prefer typed IDs, commands, change
notifications, document handles and workspace-item factories over passing one
whole-app object everywhere.

Provide atomic file replacement and recoverable batches across multiple files.
Show save status. Reload clean external changes; preserve both versions for
dirty conflicts. Search indexes and thumbnails are derived caches.

## Delivery and required verification

The intended sequence is editor proof, campaign foundation, combat parity,
interconnection, then recovery/performance/packaging and complete session rehearsal.

Required evidence includes:

- Vim counts/operators/objects/registers/marks/search/repeat/macros/visual modes
  and undo across presentation; formatting boundaries, cross-block selection,
  cells, images, Unicode, wrapping, clipboard and source switching.
- All combat flows, one-step bulk undo, reorder without lost focus, persistent
  HP, reset, independent copies and historical snapshots.
- Rename/link integrity, ambiguous names, missing assets, failed writes,
  interrupted multi-file saves and external edits.
- Shared documents across splits and restart restoration of tabs/focus/layout.
- Measurements with **10,000 pages**, a **long image-rich note** and **100
  participants**. Target smooth 60 Hz interaction and warm fuzzy results within
  50 ms on the user's machine; measure rather than assume GPUI guarantees it.
- A packaged native application and a complete keyboard-only campaign session.

Do not mark the baseline finished merely because it builds or a subset of tests
passes. Record material failures and limits, particularly the chosen Markdown
surface and the difference between CPU frame measurements and presentation time.
