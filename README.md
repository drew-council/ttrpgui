# ttrpgui

A native Linux/Wayland campaign workspace that links Zed's editor, Vim, and
workspace Rust crates into one application. It does not launch or require an
external Zed program. Markdown uses a native live presentation with source
revealed for editing complex blocks, plus an explicit source toggle.

The application includes campaign pages, session/encounter relationships,
creature libraries, persistent character health, keyboard combat controls,
undoable bulk changes, portable TOML/Markdown storage, and native tabs/splits.
[Verification](docs/verification.md) records the checks and measurements,
[the baseline audit](docs/baseline.md) maps them to the
[original requirements](docs/original-requirements.md), and
[the handoff](docs/handoff.md) lists known limits and maintenance notes.

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

Buttons and form layouts use [GPUI Kit](https://gpui-kit.com/)'s
`gpui-component` layer. Its pinned 0.5.1 source is adapted to the same GPUI
revision as Zed; bootstrap verifies both source archives and patches.

By default, campaign data is under `$XDG_DATA_HOME/ttrpgui/campaign` (normally
`~/.local/share/ttrpgui/campaign`). Application settings and workspace state use
that application's data directory. `TTRPGUI_DATA_DIR` overrides it. Campaign prose
is ordinary `notes.md`; structured metadata is TOML in stable UUID directories.
A new campaign starts with Session 1 and a Welcome note.

## Keyboard controls

Workspace and documents:

- Ctrl+Alt+C: campaign navigator. Type to search names and aliases; arrows and
  Enter choose. In the browse list j/k move, h/l collapse/expand sessions and the
  Sessions/Creatures/Locations/Notes groups, n adds an encounter to the selected
  session, s creates a session, / focuses the filter.
- Ctrl+Shift+P: command palette (all actions, including Retry save and Restore
  unsaved recovery). Ctrl+Shift+F: project-wide search in its own tab.
- Ctrl-W h/j/k/l: move between panes (Vim). Ctrl-W m h/j/k/l: move the active tab
  to that neighbouring pane. Ctrl-O / Ctrl-I: back and forward through history.
- Vim is active in every editor, including `/` search with n/N.
- Ctrl+Alt+M: source/live Markdown toggle. Ctrl+Alt+B / Ctrl+Alt+I: bold / italic
  for every selection; strike, code, heading, bullet and Insert Image are in the
  palette. Each formatting action is a single undo step.
- `[[`: campaign link completion; generated links are relative Markdown.
  Ctrl+Enter follows links, including headings; ambiguous names open a picker.
- Session pages list their encounters above the notes.

Encounters (when the encounter list has focus):

- j/k (wrapping), g/G or Home/End, Space to select, Esc to clear.
- +/- health, i initiative, r rename, n create creature, d description,
  a add from library, u / Ctrl+R undo/redo, Shift+F10 context menu.
- Ctrl+Shift+S start, Ctrl+Shift+C complete, Ctrl+Shift+H reset health,
  Ctrl+Shift+L save the cursor creature to the library.
- Creature picker: type a name or alias, arrows/Enter choose, then quantity and
  optional initiative. Ctrl+N creates an encounter-only creature.

Quitting: Ctrl+Shift+Q waits for campaign saves and link updates, then saves the
workspace. If a save failed, it reports it; Retry save, or press Ctrl+Shift+Q
again to quit anyway (unsaved structured work stays in the recovery copy).
Ctrl+Q keeps its Vim meaning inside editors.

Completed encounters retain snapshots and refuse edits. Persistent characters
carry health into new encounters; monster copies have independent health. Reset
health is undoable. If an open page changes on disk while it has unsaved edits,
both versions are kept and the status line says so; saving asks whether to
overwrite or discard your edits. Explicit recovery backs up conflicting external
metadata under `.recovery`.

## Verification and packaging

```sh
nix develop
nu scripts/verify-editor.nu --neovim --performance
nu scripts/package.nu --release
```

Application rehearsals use GPUI's headless platform with isolated data, and the
script hides display and session-bus variables so nothing reaches the desktop.
Neovim is only a comparison-test dependency. For native rendering on a private
offscreen compositor (it never connects to the desktop display):

```sh
nix develop -c nix shell --inputs-from . nixpkgs#weston -c \
  uv run scripts/native_check.py --scenario note --binary target/release/ttrpgui --require-performance
```

`--scenario combat` and `--scenario session` render the encounter view and a
session page. The package is at `dist/ttrpgui/bin/ttrpgui`; packaging opens no
windows.

[Architecture](docs/architecture.md) describes the supported editing surface and
module boundaries. The [baseline audit](docs/baseline.md) tracks the original
release requirements. GPL-3.0-or-later; [third-party notices](THIRD_PARTY_NOTICES.md)
retain upstream attribution and license information.
