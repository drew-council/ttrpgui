# Editor gate verification

The source-on-edit editor foundation has passed its automated integration gate.
The complete campaign application and performance acceptance remain in progress.

| Check | Observed result |
| --- | --- |
| Checksum-verified bootstrap into a fresh directory | Passed |
| Idempotent bootstrap and reverse patch verification | Passed |
| Application compilation | Passed with initial campaign integration |
| Markdown addon suite | 31 passed, including parent-buffer cell focus |
| New Vim/Markdown integration tests | 5 passed, including clipboard and recorded Neovim cases |
| Launcher helper, invalid arguments, instance lock | 3 passed for editor foundation; campaign recheck in progress |
| Headless workspace composition | Passed: two tabs, split buffers, shared edit/undo, Vim/focus |
| Full upstream Vim suite | 564 passed with final source-display patch, two test threads |
| Neovim comparisons with live Markdown enabled | 15 live scenarios passed; genuine trace retained |
| Native rendering | Passed on private offscreen Weston with software rendering; screenshot inspected |
| Domain rules | 5 regression tests passed |
| Portable links, backlinks, stale indexing | 5 tests passed |
| 10,000-page warm fuzzy query | 2.44 ms in unoptimized document-layer test; excludes UI rendering |

Use `nu scripts/verify-editor.nu` in `nix develop` to reproduce the automated
checks. Add `--neovim` for the live Neovim comparison cases. Neovim is not used by
the application. Both source trees are available after `scripts/bootstrap.nu`.

## Native launch incident and prevention

The initial native launch used the **ttrpgui binary linked to Zed crates**, not
an external Zed program. Its entrypoint failed to handle the workspace library's
`--printenv` helper invocation, which recursively created application windows.
Those proof processes were stopped and their absence was checked. The launcher
now handles helper/help arguments before GPUI or persistence initialization,
rejects unknown arguments, and holds an OS file lock for the GUI lifetime. The
subprocess tests run without display variables and enforce a five-second limit.
Build concurrency is two jobs. Further automated app checks use GPUI's headless
platform, with no compositor/GPU and a 15-second deadline.

## Remaining acceptance work

- Native rendering and pointer/keyboard rehearsal after the headless gate.
- Visual block selections, wrapped proportional text, clipboard, image loading,
  missing assets, and undo across structural table actions.
- Split content/cursor consistency and saved tab/layout restoration.
- Richer editable-block experiment and supported-surface decision.
- Actual long-note/image rendering and interaction timing on the target machine.

No 60 Hz or 50 ms result has been measured or claimed. The 10,000-page and
100-participant scenarios require the campaign/document layers, which follow
editor acceptance. Domain, portable storage, campaign linking/search, combat,
recovery, and packaging acceptance remain outstanding.
