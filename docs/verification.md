# Baseline verification

Results observed on 2026-10-03 against the current tree (six-patch Zed series,
GPUI Kit 0.5.1). The checklist these satisfy is [baseline.md](baseline.md); the
brief is [original-requirements.md](original-requirements.md); the current
status and known limits are in [handoff.md](handoff.md).

## One-command reproduction

```sh
nix develop
nu scripts/verify-editor.nu --neovim --performance
```

This runs, in order: bootstrap validation, `cargo check`, the root workspace
tests, the headless editor and campaign rehearsals, the two-process restart
rehearsal, the optimized 10,000-page performance gates, the Markdown addon
tests, all upstream Vim tests and the live Neovim comparisons. Headless runs
hide `DISPLAY`, `WAYLAND_DISPLAY`, `WAYLAND_SOCKET` and
`DBUS_SESSION_BUS_ADDRESS`, so nothing can reach the desktop (on Linux even
GPUI's headless file chooser goes through the desktop portal over D-Bus).

Native rendering checks run separately on a private offscreen Weston:

```sh
nix develop -c nix shell --inputs-from . nixpkgs#weston -c \
  uv run scripts/native_check.py --scenario note --binary target/release/ttrpgui --require-performance
# --scenario combat | session  render the encounter and a session page.
```

Packaging: `nix develop -c nu scripts/package.nu --release`.

## Source reproducibility

| Check | Result |
| --- | --- |
| `bootstrap.nu --strict`: download the pinned archive, verify SHA-256, apply all six patches, compare every source file with the local checkout | Passed; identical |
| Fresh bootstrap into a new directory, then a second (idempotent) invocation | Passed |
| Idempotent validation reverses the whole series newest-first in an owned temporary copy of the touched files (`--fuzz=0`) | Passed; a tampered patched file is rejected |
| Local checkout formatting drift (`items.rs`, `fold_map.rs`, `display_map.rs`) | Removed; local tree now byte-identical to archive + patches |
| Patch 6 applies with zero fuzz and reproduces the local files | Passed |

## Automated suites

| Suite | Result |
| --- | --- |
| Root workspace: documents 7, domain 7, storage 10, save worker 2, launcher 3 | **29 passed** |
| Upstream editor fold-map tests incl. new `test_concealment_edits_merge_per_row` and randomized fold tests | **9 passed** |
| Markdown live-preview addon | **32 passed** |
| Upstream Vim | **564 passed** |
| Live Neovim campaign comparisons (15 recorded command scenarios) | **5 passed** |

## Headless application rehearsals

All pass with the debug build and with the packaged release binary run outside
the development shell. Each is a real GPUI application with isolated data and a
30-second hang guard.

`--smoke-test` (plain editor):

| Rehearsal | Covers |
| --- | --- |
| Editor workspace | Two tabs and a split sharing one buffer, independent views, shared edit/undo, Vim Normal mode, focus |
| Native Markdown actions | Ctrl+Alt+B over two disjoint selections in one transaction; one Vim `u` reverts; Ctrl+Alt+I toggles; palette strike/code inline and heading/bullet per line; edits reach the split; focus retained; presentation re-enabled |
| Vim search | `/` opens the pane search bar, Enter jumps and returns focus, `n`/`N` repeat |

`--campaign-smoke-test`:

| Rehearsal | Covers |
| --- | --- |
| Links | `[[` completion through the picker, portable relative link, Vim undo, Ctrl+Enter to a heading |
| Combat/library | 100 participants; cursor wrap at both ends, g/G/Home/End, explicit two-row selection and toggling; damage to negative HP; undo/redo; initiative reorder keeps cursor and selection; field cancellation and focus scoping; library quantity and independent copies as one undo; Shift+F10 menu |
| Description | Multiline Vim draft, draft undo, mode-aware Escape, first-selected prefill, one-step bulk commit/undo |
| Encounter tab | Serialize/restore identity and selection; split views have independent focus |
| Rename integrity | Open-buffer and closed-file link rewriting with labels/headings; undo/redo; rename then undo while preparation is in flight; consecutive renames; an unreadable closed page produces a visible failure that Retry resumes without losing the rename |
| Navigator | Session collapse/expand; Sessions/Creatures/Locations/Notes groups collapse with h, expand with l or Enter, and search still finds pages in collapsed groups; keyboard session and encounter creation; roster inclusion; tab opening |
| Keyboard session | Create, start, local/library copies, bulk initiative/damage/reset/undo, rename, save to library, complete, next encounter with carried HP, history unchanged by viewing, editing keys on a completed encounter explain instead of opening fields |
| External changes | Clean metadata reload, closed prose indexing, external page add/delete, dirty structured conflict preserved, explicit recovery |
| Image import | InsertImage via the storage worker into page-relative `assets/`, inserted at the anchored cursor, original file untouched, focus kept, one-step undo, non-images rejected visibly |
| Session page | The session document's header block lists its encounters and follows creation and undo |
| Workspace keyboard | Palette runs "pane: split right"; Ctrl-W m h moves a tab to the left pane with focus; ambiguous `[[Beta page]]` opens a restricted picker and Down/Enter opens the second page; Ctrl-O/Ctrl-I history; Ctrl+Shift+F project search as a tab finds text |
| Prose conflict | Dirty page changed on disk keeps both versions, is reported in the status, survives autosave; Ctrl+S then Enter overwrites, Ctrl+S then l, Enter discards edits |

`--session-smoke-test prepare` then `restore` (two processes, one data
directory): three panes across both split axes, exact pane bounds, tabs, active
items, focus, independent cursors/scroll, unsaved text and shared buffers
restored. Passed.

## Measurements

Optimized build, headless, isolated data (`--performance-smoke-test`). Same
results from `target/release` and from the packaged binary:

| Measurement | Result | Gate |
| --- | --- | --- |
| Durable creation of 10,000 pages + 100 participants | ~18 s, before the UI deadline starts | — |
| Warm picker: input + fuzzy query + CPU frame | median 2.7–3.2 ms, max 3.6 ms | < 50 ms, passed |
| 100-participant navigation: key + CPU frame | p95 4.4–5.5 ms | < 16.67 ms, passed |
| Health mutation + queued save + CPU frame | 5.4–5.8 ms | < 16.67 ms, passed |
| Sustained: 120 mutations at frame rate, each + queued save + CPU frame | p95 6.3–6.6 ms, max 9.8 ms | < 16.67 ms, passed |
| Save queue drain after the last of those edits | 0.18–0.33 s; reloaded disk state equals memory | Durability, passed |

Native, private software Wayland (Weston + lavapipe, two rasterizer threads),
619 KB note with 100 PNG images, 9,000 inline markers:

| Measurement | Result |
| --- | --- |
| Parsed and presented | ready in ~0.65 s; screenshot shows heading, image, bold, links, Unicode, wrapping |
| Idle frame construction | median 3.6 ms |
| 24 Vim j/k motions, key dispatch + CPU frame | median 11.6–11.7 ms, p95 13.4–13.9 ms; `--require-performance` (< 16.67 ms) passed |
| Before this work | ~480 ms per motion (debug); optimized before patch 6: median 18.2 ms, p95 21.4 ms (failed) |

Patch 6 diagnosis: each Vim operation suspends and restores the addon's
concealments. Per-stage timing showed the tab map rescanning each long line
once per concealed marker (1.44 ms for 128 edits). Merging same-row edits cut
that to 0.37 ms, and a ±30-row viewport margin (from ±60) roughly halved the
concealments involved.

These are **CPU frame-construction times**, not hardware presentation latency,
and they were measured on a software compositor, not on the user's display. No
claim is made that the user's display sustains 60 Hz.

## Native rendering

Screenshots from the private compositor were inspected for the note, combat and
session scenarios, both for the build tree and the packaged binary: Catppuccin
colours, navigator group headers with counts, focus border, selection count,
LOW label, contextual shortcuts, portrait fallback, the session page's encounter
header, and Vim mode indicator. Artifacts: `.editor-proof/native-*` (ignored).

## Packaging

`nu scripts/package.nu --release` validates bootstrap, builds, and produces
`dist/ttrpgui` (Nix store): wrapped binary with the runtime library closure,
desktop entry, LICENSE, THIRD_PARTY_NOTICES and the application source with the
pinned bootstrap recipe (109 files). The packaged binary passed `--help`, both
headless suites and the performance gates outside `nix develop`, and the native
note (with the performance gate) and combat checks.

## Log noise that is expected

- Git errors about `/tmp/.git`: fixtures under `/tmp` sit below an unrelated
  bogus Git directory. Do not delete it.
- `WatchNotFound`/inotify messages during fixture cleanup.
- `persisting editor selections ... FOREIGN KEY constraint failed`: an upstream
  Zed race. Selection saves fire ~100 ms after a change and reference the
  editor's item row, which the workspace writes on its own schedule. The quit
  path (patch 3) writes item rows before selections, and the restart rehearsal
  verifies restored cursors.
- `No selection history for undone transaction` in the editor smoke: the test
  edits through `Editor::edit` without a selection transaction, then undoes.
- The missing portrait in native fixtures is intentional (fallback is visible).
