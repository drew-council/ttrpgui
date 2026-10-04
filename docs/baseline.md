# Baseline audit

This is the release gate for the brief in
[original-requirements.md](original-requirements.md). "Verified" names an
observed check in [verification.md](verification.md). Deliberate limits are
listed as such rather than as passes; see [handoff.md](handoff.md).

Status as of 2026-10-03: **every baseline requirement has a passing check or a
documented decision.** Decisions that narrow the brief are marked *Decision*.

## Editor foundation

| Requirement | Evidence |
| --- | --- |
| Linked Zed editor/Vim/workspace crates; no external Zed | Pinned crates; launcher subprocess tests; 564 Vim tests |
| Exact revisions, one GPUI graph, notices, exported patches | Zed + GPUI Kit lock files; six patches; `bootstrap.nu --strict` byte-identical; fresh and idempotent bootstrap; notices list every patch |
| Two Markdown tabs and a split on one authoritative buffer | Editor smoke rehearsal; restart rehearsal |
| Counts, operators, objects, registers, marks, search, repeat, macros, visual modes, undo across presentation | 564 Vim tests; 15 live Neovim scenarios crossing bold text, tables, images, quotes and headings; application-level `/`, `n`, `N` |
| Headings, styled prose, lists, links, tables, images, Unicode, wrapping | 32 addon tests; native screenshots |
| Parent-buffer table editing, focus, cancellation, undo | Patch 1 removes the separate cell editor; addon tests for cell clicks without mutation, structural changes, row/column move/delete, keyboard reveal; Vim table parent-undo test |
| Formatting, links, images and tables edit the same transaction system | Formatting rehearsal (multi-range, toggle, one undo); link completion; image import rehearsal (one undo); table tests |
| Explicit source toggle, unsupported syntax preserved | Ctrl+Alt+M; Vim source-toggle test |
| Incremental rendering, stale results rejected | Upstream anchored incremental addon; viewport presentation; revision-checked index |
| Supported editing surface decided | *Decision*: ADR 001 source-on-edit live Markdown. Rich semantic WYSIWYG editing is not provided |

## Workspace and navigation

| Requirement | Evidence |
| --- | --- |
| Tabs, both split axes, pane navigation, moving tabs between panes, history, palette | Workspace keyboard rehearsal (palette split, Ctrl-W m h, Ctrl-O/Ctrl-I); restart rehearsal |
| Restore tabs, active items, focus, cursor, scroll, layout | Two-process restart rehearsal |
| Shared document content, independent cursors/scroll | Editor smoke and restart rehearsals |
| Collapsible navigator for sessions, encounters, creatures, locations, notes | Navigator rehearsal: session hierarchy and category groups |
| Fuzzy picker over names/aliases with type and thumbnails | Picker rehearsals; 10k-page gate; portraits in screenshots |
| Full-text search as a workspace item | Workspace keyboard rehearsal (Ctrl+Shift+F) |
| Vim inside editors; scoped shortcuts; Esc cancels; explicit quit | Encounter/description rehearsals; Ctrl+Shift+Q; focus-scoping assertion |
| Contextual shortcuts and mode | Shortcut bars and Vim mode indicator in screenshots |
| Anchored fields, inline validation, selection counts, portraits, health cues, keyboard menus | Encounter rehearsals; screenshots (LOW label, counts) |
| Keyboard-operable prompts | Zed's themed in-window prompt (Enter/Esc/h/l); conflict rehearsal |
| Catppuccin Mocha semantics; non-colour focus/selection/low-health cues | Screenshots |
| Session pages list their encounters | Session page header block; rehearsal and screenshot |
| Page types are workspace items without a plugin framework | Editor items and serializable `EncounterView` |

## Combat parity with `../ttrpgtui`

| Requirement | Evidence |
| --- | --- |
| Session/encounter creation, reopening, automatic roster | Navigator and keyboard session rehearsals |
| Optional AC/initiative, descending initiative, unknown last | Domain tests |
| Single and bulk health/initiative/description, one undo each | Domain tests; combat, description and session rehearsals |
| Heal capped at max, negative HP kept, independent monster copies | Domain tests; combat rehearsal (-2 HP) |
| Rename, individually identified copies, identity-preserving sort | Combat and session rehearsals |
| j/k with wrap, first/last, Space, +/-, Esc | Combat rehearsal assertions |
| Library add with quantity/initiative; create new; save to library | Combat and session rehearsals |
| Encounter description separate from library notes | Typed model |
| Persistent HP, reset (undoable), immutable history | Domain tests; session rehearsal |
| Planned/active/completed; one active; viewing history never mutates | Domain tests; session rehearsal; completed encounters refuse edits with an explanation |
| Automatic save, visible failures, undo/redo | Worker tests; status line; retry rehearsal |

## Files, links and persistence

| Requirement | Evidence |
| --- | --- |
| Portable UUID directories, TOML, Markdown, assets, templates, roster | Storage tests; image import rehearsal |
| Definitions vs persistent state vs participants vs history | Domain types and tests |
| Relative links, `[[page]]`, labels, headings, `[[` completion, ambiguity picker | Link and workspace keyboard rehearsals |
| Backlinks and structured related navigation | Index tests; navigator details |
| Link updates on managed renames | Rename rehearsal including rapid rename/undo and failure + Retry |
| Link updates on managed moves | *Decision*: the application offers no move. Identity is UUID-based and renames never move directories. Path-change rewriting exists and is tested for a future move feature |
| Atomic replacement, recoverable multi-file batches | Storage journal tests |
| Clean external reload; dirty conflicts keep both versions | External-change rehearsal (structured); prose conflict rehearsal |
| Derived indexes; stale results rejected | Index tests; watcher revision guards |
| GPUI-free domain; storage/documents/editor/desktop boundaries | Crate and module structure |

## Performance and release

| Requirement | Evidence |
| --- | --- |
| 10,000 pages, warm fuzzy results < 50 ms | Max 3.6 ms (CPU frame included) |
| 100 participants at 60 Hz | p95 4.4–5.5 ms CPU frame |
| Long image-rich note | 619 KB / 100 images: Vim motion p95 13.4–13.9 ms CPU frame on a software compositor |
| Large campaign saves stay responsive and durable | 120 frame-rate mutations p95 ≤ 6.6 ms; drain ≤ 0.33 s; disk equals memory |
| Packaged native application | `dist/ttrpgui`; packaged headless, performance and native checks pass |
| Complete keyboard-only campaign session | Campaign rehearsal chain plus restart rehearsal |

*Limit*: frame figures are CPU construction times measured headless or on a
software compositor. They are not hardware presentation latency, and nothing
was measured on the user's display, by design (no desktop launches).

Out of scope, unchanged: D&D Beyond, Logseq migration, multiplayer, cloud sync,
full rules automation. Structured stats are HP, AC and initiative; richer stat
blocks are Markdown prose.
