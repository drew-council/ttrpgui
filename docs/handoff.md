# Agent handoff — 2026-10-03

The user requested a stopping point and handoff. **Implementation has stopped;
the baseline is not complete.** Work is uncommitted in the shared working tree.
Do not reset it or replace it with a fresh application. No known owned build,
headless rehearsal or native proof remains running at handoff; the last release
build and performance process both completed with exit 0.

Read [original-requirements.md](original-requirements.md), then this file,
[baseline.md](baseline.md), [architecture.md](architecture.md) and
[verification.md](verification.md). This document supersedes older status
claims where they conflict. Re-read code before changing it.

## Most important constraints

- Link Zed editor/Vim/workspace **Rust crates**. Never launch external Zed.
- **Never run the application on the user's live desktop.** The user previously
  experienced a desktop freeze and many windows. Headless flags and the private
  software Weston supervisor are the authorized verification paths. Do not
  reconnect them to the real desktop or use broad process-kill commands.
- The earlier recursive launch was the linked application's unhandled
  `--printenv` helper invocation. The entrypoint now handles helper/help before
  GPUI/storage, rejects unsupported arguments, and holds an OS instance lock.
  Three launcher subprocess regressions pass. Keep these safeguards.
- Cargo concurrency is capped at two in `.cargo/config.toml`; large builds were
  run at reduced priority with `nice -n 10`. Do not increase parallelism. Host
  has about 32 GB RAM; monitor available memory rather than assuming safety.
- Cwd `/home/drew/personal/ttrpgui`. Use `nix develop`, **not `nix develop path:.`**
  (the latter can copy enormous ignored build/vendor directories).
- Use `uv run` for Python and Ruff for checks. Prefer Nushell. Do not spawn
  agents unless the user or applicable instructions explicitly requests it.
- **Do not use `cargo fmt --all`**: it can format vendored path dependencies and
  invalidate exported patches. Use `cargo fmt -p ttrpgui -p campaign_domain
  -p campaign_storage -p campaign_documents` as appropriate.

## Current architecture and dependencies

| Location | Role |
| --- | --- |
| `crates/domain` | GPUI-free UUID entities, validated commands, combat lifecycle, snapshots, bulk undo/redo |
| `crates/storage` | Portable TOML/Markdown hierarchy, campaign lock, fsynced recoverable journal, external conflict/recovery, image import |
| `crates/documents` | Catalogue, relative/wiki/heading links, aliases, backlinks, templates, Unicode search, revision-checked indexing |
| `src/desktop/mod.rs` | Composition of linked Zed Project/Workspace/Editor/Vim/addon and campaign services |
| `src/desktop/encounter` | Native encounter workspace item, controls/rendering/persistence/rehearsals |
| `src/desktop/navigator` | Library/page picker, session hierarchy, forms, related relationships |
| `src/desktop/persistence.rs` | Dedicated ordered storage worker; contiguous save snapshots coalesce without crossing request/barrier boundaries |
| `src/desktop/watcher.rs` | External structured/prose changes, new/deleted pages, dirty recovery |
| `src/desktop/link_maintenance.rs` | Background rename/undo/redo link preparation, open-buffer transactions, closed-file journals |
| `src/desktop/markdown_actions.rs` | New formatting actions and portable image import; integration is **not yet passing** |
| `src/desktop/app_session.rs` | Quit waits for saves/link work, item serialization, cursor/scroll and layout flush |
| `src/desktop/performance.rs` | Real 10k-page / 100-participant headless performance fixture and gates |

Zed is pinned to `ee832fc61bfe2a7e7662727b414cd4aed1e23733` (the PR 62593 fork).
Archive URL/checksum are in `upstream/zed.lock.toml`. Its source is materialized
at ignored `upstream/zed`. The patch series is:

1. `0001-parent-buffer-markdown.patch`: addon source-display hooks, Vim source
   scope, parent-buffer table editing, removal of independent cell editor.
2. `0002-vim-markdown-regressions.patch`: campaign/Vim regressions and preserved
   Neovim trace.
3. `0003-durable-editor-view-state.patch`: awaitable view-state flush, cancel
   throttled scroll/selection serialization, skip duplicate restored contents
   when two splits share one buffer.
4. `0004-presentation-status.patch`: public parsed/rendered presentation status
   for actual integration checks.
5. `0005-viewport-presentation.patch`: viewport presentation for large notes,
   sorted anchored inline markers and prefix-max-end lookup, avoid legacy-fold
   scanning when no untagged folds exist, scroll regression, and avoid source
   display suspension for Vim cursor/input settings.

All five patches are exported and fresh forward application succeeded. **The
bootstrap validator is currently broken for overlapping patches; see below.**
Temporary editor profiling instrumentation has been removed. The current local
patched files match the fresh checkout below, except two removed blank lines in
`crates/editor/src/items.rs`; that discrepancy is formatting only, but must be
accounted for in final source reproducibility.

GPUI Kit is integrated as `gpui-component` **0.5.1**, revision
`0f0ab35233212f8f3277028995caf0c41e13ee6c`, pinned checksum/archive in
`upstream/gpui-component.lock.toml`. `scripts/bootstrap-controls.nu` materializes
ignored `upstream/gpui-component`; `patches/gpui-component/0001-pinned-gpui-compatibility.patch`
adapts it to the pinned Zed GPUI API. Root `[patch.crates-io] gpui` ensures one
GPUI graph. Newer Kit versions require a different GPUI graph.

Kit supplies buttons, semantic theme and form layouts. Zed supplies document
editors and workspace items. Kit InputState/Root overlays were not adopted:
the existing window root is Zed MultiWorkspace and some Kit components assume
their own Root. Do not mount a second root/editor to synchronize them. Apache-2.0
Kit notices are preserved alongside application GPL-3.0-or-later/Zed notices.
Kit emits ten unused-import warnings; those are not current functional failures.

## Verified current behavior

These are actual checks, not a claim of release completion:

| Check | Result / raw log in `/tmp` |
| --- | --- |
| Root workspace suites | **29 passed**: documents 7, domain 7, storage 10, worker 2, launcher 3; `ttrpgui-current-workspace-tests.log` |
| Markdown addon after viewport work | **32 passed**, including large-note scrolling/source scope; `ttrpgui-viewport-addon-tests.log` |
| Upstream Vim after viewport/settings work | **564 passed**; `ttrpgui-viewport-vim-tests.log` |
| Live Neovim campaign comparisons | **5 tests passed**, including **15 command scenarios**; `ttrpgui-viewport-neovim-tests.log` |
| Optimized application build | **Passed**; `ttrpgui-release-build-final.log` |
| Full campaign headless rehearsal | **Passed**, including new keyboard lifecycle route; `ttrpgui-keyboard-session-smoke.log` |
| Formatting/editor headless rehearsal | **Failed: Native bold action did not edit the document**; `ttrpgui-format-smoke.log` |
| Fresh five-patch bootstrap | Forward application **passed** at `/tmp/ttrpgui-bootstrap-viewport/zed`; `ttrpgui-viewport-bootstrap.log` |
| Fresh bootstrap second invocation | **Failed**, reverse validation of patch 1 overlapping patch 5; `ttrpgui-viewport-bootstrap-idempotent.log` |
| Python supervisor | `uv run ruff check scripts/native_check.py` passed |

The campaign rehearsal covers link completion, portable insertion, heading
navigation, 100 combat participants, negative HP, undo/redo, identity-preserving
initiative reorder, library quantity/copies, context menu, multiline Vim draft
description/text undo/bulk commit, encounter tab serialization and splits,
rename integrity for open and closed documents with undo/redo, keyboard session
and encounter creation with roster inclusion, and external structured/closed
prose changes including conflict recovery.

The new `encounter/session_rehearsal.rs` continues the navigator's keyboard-created
encounter through start, local copies, bulk initiative/damage/reset and undo,
rename, save to library, library copies, completion, next encounter with carried
character HP, and viewing historical state without mutation. It passed. New
encounter-only shortcuts are Ctrl+Shift+S start, Ctrl+Shift+C complete,
Ctrl+Shift+H reset, Ctrl+Shift+L save cursor creature to library. Ctrl+Shift+Q quits;
Ctrl+Q remains Vim visual block. Existing n/r/j/k/Space/+/-/_/i/d/a/u/Ctrl+R remain.

Earlier current-foundation checks passed two upstream editor deserialize tests
and a **real two-process** restart with three panes, both split axes, exact pane
bounds, tabs, focus, independent cursor/scroll, shared buffers and dirty text.
Logs: `/tmp/ttrpgui-editor-restore-tests.log`, `/tmp/ttrpgui-parity-smoke.log`.
These should be rerun with the final application/patch state before release.

### Performance evidence

Latest **optimized** application, isolated headless check, exit 0:

| Measurement | Result |
| --- | --- |
| Durable creation of 10,000 portable pages + 100 participants | 17.67 seconds, outside UI deadline |
| Warm picker input + fuzzy query + CPU frame | median **2.72 ms**, max **2.91 ms**; passes 50 ms gate |
| 100-participant key navigation + CPU frame | p50 **2.76 ms**, p95 **4.72 ms**, max **5.41 ms** |
| 10,000-page campaign health mutation + queued save + CPU frame | **5.15 ms** |

Log `/tmp/ttrpgui-optimized-performance.log`. Both 60 Hz **CPU budget** assertions
passed. These are CPU-frame measurements, not hardware presentation latency or
proof of the user's actual display sustaining 60 Hz. Do not overclaim them.

For the native **618,948-byte note with 100 PNG assets**, actual rendering was
verified and screenshots inspected: heading, image, styled prose, links, Unicode
and proportional wrapping. It has 200 blocks/9,000 inline markers. Before the
viewport lookup it took about 1.46 seconds per Vim motion in debug; afterward
about 0.48 seconds, ready after 2.58 seconds. That debug native measurement
preceded the final removal of redundant Vim settings source scopes.

**The optimized image-rich native note has not been measured yet.** The supervisor
now waits for an explicit successful probe completion, runs 24 motions, reports
p95, and supports `--require-performance` to enforce a 16.67 ms CPU-frame budget.
The release binary is already built; use it for this next check. Native artifacts
are ignored `.editor-proof/native-note` / `native-combat`.

## Known failures and immediate next work

1. **Repair bootstrap validation before packaging/full verification.**
   `scripts/bootstrap.nu` independently reverse-dry-runs each earlier patch
   against a tree containing later patches. Patch 5 adds scroll handling near
   patch 1's event match, so patch 1 hunk 2 cannot reverse independently. The
   fresh forward application is correct. A safe candidate repair is to copy
   only patched files into an owned temporary tree and actually reverse the
   entire series in reverse order there; never reverse the user's working
   checkout. Then verify the source marker and fresh/idempotent bootstrap.
   The local `upstream/zed/.ttrpgui-source` marker **does not match the five-patch
   fingerprint** (still represents the older series), so default bootstrap also
   refuses it. Do not blindly change the marker to hide failed validation.
   Fresh source has the current marker. Account for `items.rs` blank-line drift.

2. **Fix or diagnose the new native formatting integration.**
   `markdown_actions.rs` compiles but `--smoke-test` fails after the original
   two-tab/shared-buffer check passes. `verify` dispatches BoldSelection and
   checks Workspace's active editor; earlier verification changed focus without
   rebuilding the dispatch tree. Possible cause: focused versus active editor
   or stale action-dispatch tree. This is a hypothesis, not a confirmed fix.
   Explicitly focus the checked editor and draw before dispatch, then inspect
   whether the registered action runs. Do not remove the assertion to pass.
   Add coverage for selected/multiple ranges and one-step undo. Ctrl+Alt+B/I
   are the new formatting shortcuts; other actions are palette actions.

3. **Verify portable image import through the desktop document.**
   `CampaignStore::import_image` has a passing storage test for relative assets,
   original-file preservation, invalid path/type rejection and later save.
   Native InsertImage selects a file and queues import through the worker, then
   edits stable captured anchors in the parent buffer transaction. The actual
   chooser/import/editor/undo route has **not** been rehearsed. Do not trigger
   a desktop file chooser during automation; test the async helper with an
   isolated fixture or controlled platform prompt. Inspect error/focus behavior.

4. Run the optimized offscreen long-note check, investigate any remaining source
   map/wrap cost, and retain an honest performance result. Patch 5 limits addon
   widgets/concealments near the viewport; emphasis highlights still span the
   whole note. Vim coordinate-changing operations still enter the source scope.
   Profile before inventing a second display/document model.

## Remaining baseline audit beyond the immediate failures

- Full keyboard checks for moving tabs between panes, navigation history,
  palette, project full-text search, ambiguous-link picker and focus scoping.
- Dirty **prose** external conflict through Zed's buffer/save path: structured
  dirty recovery is tested, but does not prove the prose case.
- Actual failed-save UI/retry/recovery route. Worker/storage failures are tested;
  `link_error` currently makes quit fail visibly, but Retry save does not retry
  or clear failed link maintenance. Rapid rename/undo while background link
  preparation runs currently produces an identity-change error rather than
  automatic retry. Preserve edits and make resolution practical.
- Session pages expose encounters in structured related navigation; review
  whether the intended session page experience needs an in-page list.
- Navigator has session collapse and a collapsible dock, but independent category
  collapse for creature/location/note groups is not implemented.
- Application-managed rename is tested. Relative move rewriting is unit-tested,
  but there is no managed-move UI/portable directory transaction. Do not claim
  moves are complete. Review the original conditional move requirement explicitly.
- Inspect parent-document table structural actions, focus/cancellation, images,
  wrapping and cross-block selections against the supported-surface decision.
  Rich semantic WYSIWYG remains unproven; the documented accepted baseline is
  source-on-edit live Markdown. No Velotype editor/code is mounted or imported.
- Strengthen explicit encounter wrap/selection assertions and final completed
  state editing/validation checks where existing tests leave gaps.
- Save coalescing passes ordered-barrier/dropped-future tests. Measure sustained
  queue pressure and durability under repeated edits in a large campaign.
- Finish package build, runtime/source notices, packaged binary headless and
  private-native checks, and final combined release rehearsal. Existing package
  script/bootstrap dependency means the bootstrap failure blocks packaging now.
- Update ADR/test counts and requirement audit only after observed checks pass.
  Do not declare complete with failing editor proof or unfinished acceptance.

### Log noise requiring interpretation

- Rehearsals find an unrelated bogus Git directory around `/tmp`; upstream
  project Git errors occur for these fixtures. Do not delete unrelated `/tmp/.git`.
- Cleanup while watchers live prints many WatchNotFound/inotify messages,
  especially for 10k pages. This is noisy cleanup, not a failed performance gate.
- Latest campaign rehearsal logged an editor-selection SQLite foreign-key
  failure despite passing assertions. Investigate/reproduce it for session
  hardening; do not assume every error log is harmless.
- Native missing portrait is intentional in the screenshot fixture and has a
  visible fallback. No high-impact native launch is needed to inspect it.

## Reproduction commands (next agent, not run at handoff)

After repairing bootstrap, the normal verification script is:

```sh
nix develop
nu scripts/verify-editor.nu --neovim
# Optional optimized 10k-page/100-participant gates:
nu scripts/verify-editor.nu --neovim --performance
```

The script currently stops at bootstrap, and later at formatting/editor proof.
Use individual checks to isolate those failures. `--performance-smoke-test`,
`--campaign-smoke-test`, `--smoke-test` and `--session-smoke-test prepare/restore`
are **headless**. Each enforces a 15-second UI-loop deadline; performance seeding
takes another ~18 seconds before that deadline starts. Keep a surrounding process
timeout as well. Give both session phases the same isolated `TTRPGUI_DATA_DIR`.
Use external Nushell `^mktemp -d /tmp/ttrpgui-proof.XXXXXX` if retaining failures;
Nushell's own mktemp rejects such templates and Nix-shell-owned temp dirs vanish.

The next native check can reuse the optimized binary without another full build:

```sh
nix develop -c nix shell --inputs-from . nixpkgs#weston -c uv run scripts/native_check.py --scenario note --binary target/release/ttrpgui --require-performance
```

The supervisor strips desktop socket/session variables, starts a private 0700
runtime/offscreen Weston, uses software Vulkan with two threads, screenshots,
and terminates only its owned process groups in `finally`. `flake.nix` supplies
`TTRPGUI_SOFTWARE_ICD` from pinned Mesa/libc; do not substitute the host ICD
(an earlier host/Nix libc mismatch broke native initialization).

```sh
nice -n 10 nix develop -c cargo build --release --locked -j 2
uv run ruff check scripts/native_check.py
# From nix develop, after bootstrap is repaired:
nu scripts/package.nu --release
```

Root and upstream target caches are substantial and already warm. Preserve them
for handoff. Raw evidence logs are copied to ignored `.editor-proof/handoff/`;
the `/tmp` filenames above are also available on this machine at handoff.
Keep substantive decisions/evidence in docs because temporary files may expire.
