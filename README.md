# ttrpgui

A native Linux/Wayland campaign workspace that links Zed's editor, Vim, and
workspace Rust crates into one application. It does not launch or require an
external Zed program. Markdown uses a native live presentation with source
revealed for editing complex blocks, plus an explicit source toggle.

The application includes campaign pages, session/encounter relationships,
creature libraries, persistent character health, keyboard combat controls,
undoable bulk changes, portable TOML/Markdown storage, and native tabs/splits.
See [verification](docs/verification.md) for measured results and outstanding
release acceptance work.

## Build and run

```sh
nix develop
nu scripts/bootstrap.nu
cargo run --locked
# Or open a portable campaign directory:
cargo run --locked -- --campaign /path/to/campaign
```

Bootstrap verifies the pinned upstream archive and applies the documented patch
series. The first build is substantial; Cargo concurrency is capped at two jobs.
The Nix shell supplies build/runtime libraries. All linked GPUI crates use the
same dependency graph.

By default, campaign data is under `$XDG_DATA_HOME/ttrpgui/campaign` (normally
`~/.local/share/ttrpgui/campaign`). Application settings and workspace state use
that application's data directory. `TTRPGUI_DATA_DIR` overrides it. Campaign prose
is ordinary `notes.md`; structured metadata is TOML in stable UUID directories.
A new campaign starts with Session 1 and a Welcome note.

## Keyboard controls

- Ctrl+Alt+C: campaign navigator. Search page names and aliases; arrows and Enter
  choose a result. Session rows offer encounter creation.
- Ctrl+Alt+M: source/live Markdown toggle. Vim retains its normal editor behavior.
- `[[`: campaign link completion; generated links are relative Markdown.
  Ctrl+Enter follows links, including headings and ambiguous-name resolution.
- Ctrl+Shift+P: command palette, including pane splits and tab movement.
  Ctrl+P: file picker. Use the Search command for full-text workspace search.
- Encounter focus: j/k, g/G, Space selection; +/- health, i initiative,
  n rename, d description, a add creature; u/Ctrl+R undo/redo.
- Creature picker: type a name or alias, arrows/Enter choose, then enter quantity
  and optional initiative. Ctrl+N creates an encounter-only creature.
- Shift+F10: encounter context menu. Escape cancels interactions or clears
  selection. Quitting is an explicit application action.

Completed encounters retain snapshots. Persistent characters carry health into
new encounters; monster copies have independent health. Reset health is undoable.
Save failures remain visible, and unsaved structured work has a recovery copy.
Explicit recovery backs up conflicting external metadata under `.recovery`.

## Verification and packaging

```sh
nu scripts/verify-editor.nu
nu scripts/verify-editor.nu --neovim
nu scripts/package.nu
```

Automated application rehearsals use GPUI's headless platform, with a startup
deadline and isolated data. Neovim is only a comparison-test dependency. For an
isolated native rendering check, with Weston available in the environment:

```sh
uv run scripts/native_check.py
```

That supervisor uses a private offscreen compositor and software renderer, then
terminates its own processes. It never connects to the user's desktop display.
The package is available at `dist/ttrpgui/bin/ttrpgui`; packaging opens no windows.
Use `--release` with the packaging script for an optimized build.

[Architecture](docs/architecture.md) describes the supported editing surface and
module boundaries. GPL-3.0-or-later; [third-party notices](THIRD_PARTY_NOTICES.md)
retain upstream attribution and license information.
