# Editor gate verification

The gate remains under verification. Passing source tests is not a claim that
the complete campaign application or rich editing surface is finished.

| Check | Observed result |
| --- | --- |
| Checksum-verified bootstrap into a fresh directory | Passed |
| Idempotent bootstrap and reverse patch verification | Passed |
| Application compilation | Passed before the latest headless-test additions; rechecking |
| Markdown addon suite | 31 passed, including parent-buffer cell focus |
| New Vim/Markdown integration tests | 3 passed |
| Launcher helper, invalid arguments, instance lock | 3 passed before the latest headless-test additions; rechecking |
| Headless workspace composition | Pending |
| Full upstream Vim suite | Pending |
| Neovim comparisons with live Markdown enabled | Pending |

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
