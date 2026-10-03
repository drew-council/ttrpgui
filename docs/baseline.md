# Original baseline audit

This checklist is the release gate, not a claim that the application is finished.
“Implemented” means code exists; “verified” requires the named check. Historical
editor results are distinguished from checks run against the current tree.

**Handoff update (2026-10-03):** implementation stopped at the user's request.
The brief is [original-requirements.md](original-requirements.md), and the current
stopping point is [handoff.md](handoff.md). The formatting editor proof and
bootstrap idempotence currently fail; this is not a finished baseline.

## Editor foundation

| Requirement | Implementation / evidence | Remaining acceptance |
| --- | --- | --- |
| Native Zed editor and Vim libraries; no external Zed | Pinned linked crates, launcher subprocess tests; current 564 Vim tests pass | Final combined editor acceptance |
| Exact revisions, one GPUI graph, notices and patches | Zed and GPUI Kit lock TOML, Cargo.lock, notices; fresh five-patch bootstrap passed | Fix overlapping-patch reverse validation and stale local marker |
| Two Markdown tabs and split, one authoritative buffer | Editor smoke rehearsal; three-view restart rehearsal | Current complete combined rehearsal |
| Zed counts, operators, objects, registers, marks, search, repeat, macros, visual modes, undo | Current 564 Vim tests and 15 live Neovim command comparisons pass | Final combined application acceptance |
| Native headings, styled prose, lists, links, tables, images | Live addon; selection reveals source | Long image-rich note and proportional wrapping rehearsal |
| Parent-document table editing, focus, cancellation, undo | Patch 1 removes separate cell editor; addon tests | Current structural table action coverage audit |
| Explicit source toggle and unsupported syntax preservation | Ctrl+Alt+M; same Markdown buffer in both modes | Current smoke suite |
| Incremental rendering, stale parse results rejected | Upstream anchored incremental addon; revision-checked search index | Large document timing |
| Rich editing experiment and supported-surface decision | ADR 001 accepts source-on-edit fallback; new formatting actions compile | Formatting smoke fails; richer-block experiment review and image import integration |

## Workspace and campaign navigation

| Requirement | Implementation / evidence | Remaining acceptance |
| --- | --- | --- |
| Tabs, both split axes, pane navigation, tab movement, history, palette | Zed Workspace/Pane/action system reused | Keyboard-only rehearsal of tab movement/history |
| Restore tabs, active items, focus, cursor and scroll; split consistency | Real two-process session rehearsal; patch 3 flushes views on quit | Rehearsal includes exact pane bounds |
| Collapsible campaign navigator and typed fuzzy picker with aliases/thumbnails | Native panel; virtual list; name/alias search; portable portraits | Category/session expansion and creation flow parity |
| Full-text search as workspace item | Zed project search initialized | Keyboard search rehearsal |
| Contextual shortcuts, focus scoping, Esc cancellation, explicit quit | Encounter contexts; Vim draft fields; Ctrl+Shift+Q; connected keyboard combat route passed | Final workspace/search/ambiguous-link keyboard coverage |
| Catppuccin Mocha semantic tokens and non-color state indicators | Shared palette, Kit theme, borders, selection count, LOW/DOWN labels | Fresh offscreen screenshot inspection |
| Session pages list encounters; parent session/location/creature links | Structured related-page navigation and encounter links | In-page encounter listing review |
| New page types remain ordinary workspace items | Editor documents and SerializableItem EncounterView | No plugin framework required |

## Combat and original TUI parity

The reference is the implementation and tests in `../ttrpgtui`, including flows
omitted from its README. It is read-only reference material.

| Requirement | Implementation / evidence | Remaining acceptance |
| --- | --- | --- |
| Session/encounter creation, reopening, automatic campaign roster | Keyboard creation/roster and encounter deserialization passed | Final combined release route |
| Optional AC/initiative, descending initiative, unknown last | Domain regression tests | Current UI regression |
| Single/bulk health, initiative and description; one undo per mutation | Domain, multiline description, bulk initiative/damage/reset keyboard checks pass | Final combined release route |
| Healing capped, negative HP, independent monster copies | Domain tests and library rehearsal | Current tests |
| Renaming, multiple individually identified copies | r/n shortcuts, UUID participants, local name override; keyboard rename/library copies pass | Final release route |
| Multiline Vim description, first selected row prefill | Full Zed draft editor; async description rehearsal | Current regression result |
| j/k and wrap, first/last, Space, +/-/_ adjustment, Esc clear | Encounter key context and stable UUID cursor/selection | Explicit wrap/selection assertion |
| Initiative reorder retains cursor/selection | Encounter rehearsal | Current combined suite |
| Library add with quantity/initiative; immediately create new; save local to library | Connected keyboard route passed, including Ctrl+N and Ctrl+Shift+L | Final release route |
| Encounter description distinct from library notes | Participant.description field | Already covered by typed model |
| Persistent HP, Reset health, independent copies, immutable history | Domain tests and connected keyboard lifecycle/reset/undo route passed | Final release route |
| Planned/active/completed; one active per campaign; viewing history never mutates HP | Domain and keyboard start/complete/next-encounter/history checks passed | Final completed-edit rejection UI case |
| Automatic save, visible errors, recoverable work | Worker queue, status/error UI, storage and worker tests | Failed-save UI/recovery rehearsal |

## Files, interconnection and maintainability

| Requirement | Implementation / evidence | Remaining acceptance |
| --- | --- | --- |
| Portable UUID directories, TOML metadata, Markdown, assets, templates, roster | Storage roundtrip/path checks; template helpers; native image import code and storage test | Image chooser/import/editor undo integration |
| Creature definitions vs persistent state vs participant state vs history | Distinct domain types and lifecycle tests | Current domain suite |
| Relative links, wiki labels, headings; [[ completion; ambiguity picker | Link parser/resolver, completion and heading rehearsal | Ambiguous-link GUI rehearsal |
| Backlinks plus structured related relationships | SearchIndex and Catalogue.related | Current tests |
| Application-managed rename/move updates links | Open/closed rename, aliases and undo/redo passed; relative move rewrite helper tested | Managed move UI/transaction absent; retry rapid or failed link maintenance |
| GPUI-free domain; storage/documents/editor/desktop boundaries | Separate crates/modules; entrypoint composes initialization | Keep substantial new features in own modules |
| Typed IDs/commands/document handles/item factories | Domain IDs, document IDs, entity handles | No whole-state plugin layer |
| Atomic replacement and recoverable multi-file batches | Journal tests including interruption/conflicting external edits | Current storage suite |
| External clean reload, dirty conflict preserves both versions | Watcher and recovery tests; external add/delete rehearsal | Dirty prose conflict rehearsal |
| Derived indexes/thumbnails; revision rejects stale results | Document index tests and watcher revision guards | Large campaign responsiveness |
| Linux/Wayland native packaging; GPL-3.0-or-later and notices | Nix package script, source recipe, LICENSE/notices | Fresh packaged binary check |

## Performance and final rehearsal

| Required scenario | Existing evidence | Remaining acceptance |
| --- | --- | --- |
| 10,000 pages, warm fuzzy search within 50 ms | Optimized input + query + CPU frame max 2.91 ms, passed | Final packaged runtime measurement |
| 100 encounter participants, smooth 60 Hz interaction | Optimized navigation CPU frame p95 4.72 ms, max 5.41 ms | Actual presentation limits documented; packaged check |
| Long image-rich note | 619 KB / 100 PNG native fixture verified; debug motion/frame max 483.79 ms before final Vim settings optimization | Optimized native run and 60 Hz CPU gate still outstanding |
| Large campaign saves remain responsive | Ordered worker/coalescing tests pass; optimized health mutation + frame 5.15 ms | Sustained queue pressure/durability measurement |
| Complete keyboard-only campaign session | Connected creation/start/copy/edit/reset/undo/complete/next/history route passed | Final release route with workspace/search/restart/failure flows |

Out of scope remains D&D Beyond, Logseq migration, multiplayer, cloud sync and
full D&D rules automation. Basic stats are HP, AC and initiative; prose stores
richer stat blocks. Fresh campaign data is the default.
