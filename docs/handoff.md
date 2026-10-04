# Handoff — 2026-10-03 (operational baseline)

The baseline is complete: every requirement in
[original-requirements.md](original-requirements.md) has a passing check or an
explicit decision in [baseline.md](baseline.md), with observed results in
[verification.md](verification.md) and design in [architecture.md](architecture.md).
This replaces the earlier mid-implementation handoff.

## Constraints to keep

- Link Zed editor/Vim/workspace **Rust crates**. Never launch external Zed.
- **Never run the application on the user's live desktop.** Use the headless
  rehearsals and the private Weston supervisor (`scripts/native_check.py`).
  Verification hides `DISPLAY`, `WAYLAND_DISPLAY`, `WAYLAND_SOCKET` and
  `DBUS_SESSION_BUS_ADDRESS`: on Linux even GPUI's headless file chooser uses the
  desktop portal over D-Bus. Rehearsals never call the chooser
  (`markdown_actions::RehearsalImage` supplies the file).
- Keep the launcher safeguards: helper/help arguments are handled before GPUI
  and storage, unknown arguments are rejected, and an OS instance lock is held.
- Cargo jobs are capped at two (`.cargo/config.toml`); build with `nice -n 10`.
- Use `nix develop`, **not** `nix develop path:.`. Use `uv run` and Ruff for
  Python; Nushell for scripts.
- **Never `cargo fmt --all`** (it reformats vendored upstream code and breaks
  patch reproducibility). Use
  `cargo fmt -p ttrpgui -p campaign_domain -p campaign_storage -p campaign_documents`.
  `nu scripts/bootstrap.nu --strict` detects any drift.

## Upstream patches

Zed is pinned to `ee832fc6…` (PR 62593 fork) in `upstream/zed.lock.toml` with
six patches (described in THIRD_PARTY_NOTICES.md). To change upstream code:

1. Edit `upstream/zed`, then regenerate the affected patch (or add a new one)
   as a plain unified diff against a fresh bootstrap of the previous series
   (`nu scripts/bootstrap.nu --destination /tmp/<dir>/zed`).
2. Add new patches to `upstream/zed.lock.toml`.
3. Fresh-bootstrap the full series into a new directory, prove the local tree is
   identical (`diff -rq --exclude=target --exclude=.git`), then copy that
   directory's `.ttrpgui-source` marker into `upstream/zed`. Never edit the
   marker to hide a failed comparison.
4. Run `nu scripts/bootstrap.nu --strict`.

Idempotent validation reverses the whole series newest-first in a temporary
copy of the touched files, so overlapping patches validate correctly.

## What changed in this session

- Bootstrap: whole-series reverse validation; `--strict` archive comparison;
  removed formatting drift in three upstream files; patch 6 added.
- Formatting proof: the old check raced GPUI's deferred `dispatch_action`; the
  rehearsal now uses real keystrokes and covers multiple ranges, toggling,
  palette actions, splits, focus and one-step undo.
- Image import: rehearsed end to end (worker import, anchored insert, undo,
  rejection).
- Link maintenance: one serialized loop; rapid rename/undo and Retry after
  failure work; second Ctrl+Shift+Q quits after a reported failure.
- **Fixed two application bugs found by new rehearsals:** panes had no search
  toolbars, so Vim `/` and project search did nothing. GPUI's fallback prompt
  was mouse-only, now replaced by Zed's keyboard prompt (`ui_prompt`).
- Navigator category groups; session page encounter header; completed
  encounters refuse edits with an explanation; prose conflicts shown in status.
- Long-note performance: p95 21.4 → ~13.5 ms (patch 6); sustained-save
  measurement added to the performance gate.
- Smoke hang guard raised from 15 to 30 s (it is not a performance gate).

## Known limits and decisions

- **Editing surface**: live Markdown with source revealed at the selection
  (ADR 001). Rich semantic WYSIWYG editing is not implemented.
- **Moves**: the application offers no page move (UUID directories; renames
  never move files). Moving an encounter between sessions would be a new
  feature: relocate prose/assets/open buffers in one journaled batch; link
  maintenance already handles path changes.
- **Performance claims** are CPU frame-construction times (headless or software
  compositor), not presentation latency on the user's display. The long-note
  gate has ~3 ms of headroom on this machine.
- The navigator's header rows share the list's 88 px row height (uniform list).
- Expected log noise is listed in verification.md (bogus `/tmp/.git`, inotify
  cleanup, an upstream selection-persistence foreign-key race).

## Reproduction

```sh
nix develop
nu scripts/verify-editor.nu --neovim --performance   # everything headless, ~12 min
nix develop -c nix shell --inputs-from . nixpkgs#weston -c \
  uv run scripts/native_check.py --scenario note --binary target/release/ttrpgui --require-performance
nu scripts/package.nu --release                       # dist/ttrpgui/bin/ttrpgui
```

Individual headless runs: `--smoke-test`, `--campaign-smoke-test`,
`--performance-smoke-test` (release), and `--session-smoke-test prepare` then
`restore` with the same `TTRPGUI_DATA_DIR`. Use external
`^mktemp -d /tmp/ttrpgui-proof.XXXXXX` to retain data from a failing run.
`TTRPGUI_NATIVE_MOTIONS=N` makes the native note probe take more samples for
profiling.
