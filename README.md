# ttrpgui

A native Linux/Wayland campaign workspace built around Zed's editor and Vim.
The current implementation is the **editor proof**: two Markdown tabs, an initial
shared-document split, live Markdown, source-on-edit tables, command palette,
search, and Catppuccin Mocha. Campaign management is not implemented yet.

## Run

```sh
nix develop
nu scripts/bootstrap.nu
cargo run --locked
```

Bootstrap downloads the exact upstream source archive, checks its SHA-256, and
applies the recorded patch series. It preserves existing checkouts. The first
build compiles a substantial part of Zed; the Nix shell supplies native libraries.
Application code and the upstream source use a single compatible GPUI graph.

The demonstration edits copies of the fixtures under `.editor-proof/documents`.
Its Zed database/configuration lives in `.editor-proof/state`, independently of
any existing Zed installation. On the first launch, two tabs open and the active
document is cloned into a right-hand pane. Later launches reuse the saved layout.

- Ctrl+Alt+M: toggle Markdown source/live presentation in the focused editor.
- Ctrl+Shift+P: command palette; use it for splits, tab movement, and saving.
- Ctrl+P: quick open. Vim `/`: buffer search.
- Tables and images reveal Markdown when the editing selection reaches them.
- Clicking a table cell focuses its source in the same full Vim editor.
- Escape returns to Vim Normal mode; `u`/Ctrl+R undo/redo document edits.

## Verify

```sh
nu scripts/verify-editor.nu
nu scripts/verify-editor.nu --neovim
```

The second command also runs the new live-Markdown comparisons against Neovim.
Upstream Vim tests and their comparison harness are preserved. See
[verification](docs/verification.md) for results, limitations, and the remaining
acceptance checklist, and [the architecture decision](docs/architecture.md) for
the supported editing surface and campaign delivery boundaries.

GPL-3.0-or-later. See [third-party notices](THIRD_PARTY_NOTICES.md).
