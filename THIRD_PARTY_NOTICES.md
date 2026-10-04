# Third-party notices

The application is GPL-3.0-or-later; see `LICENSE`. The original scaffold's
MIT and Apache license texts remain as historical notices.

## Zed and live Markdown

- Source: https://github.com/harrywang/zed
- Revision: `ee832fc61bfe2a7e7662727b414cd4aed1e23733`
- Addon proposal: https://github.com/zed-industries/zed/pull/62593
- Authors: Zed Industries contributors; live Markdown contributed by Harry Wang
  and the contributors identified in the upstream commit.
- Editor, Vim, workspace and addon: GPL-3.0-or-later. GPUI and some supporting
  crates: Apache-2.0. Each crate's manifest retains its own license declaration.
- Bootstrap preserves the complete upstream source and license notices.
- Local changes, applied in order by `scripts/bootstrap.nu` (pinned in
  `upstream/zed.lock.toml`):
  - `patches/zed/0001-parent-buffer-markdown.patch` removes the separate table
    editor, reveals source for keyboard editing, and adds an addon
    source-display scope around Vim editor operations;
  - `0002-vim-markdown-regressions.patch` adds campaign Vim/Markdown
    regressions, a preserved Neovim trace and their dependencies;
  - `0003-durable-editor-view-state.patch` makes editor view state flush
    awaitable on quit and avoids duplicate restored text in shared splits;
  - `0004-presentation-status.patch` exposes parsed/rendered presentation
    status for integration checks;
  - `0005-viewport-presentation.patch` limits large-note presentation to the
    viewport and indexes inline markers for viewport queries;
  - `0006-concealment-row-coalescing.patch` merges same-row concealment edits
    and narrows the viewport margin, reducing Vim source-scope cost.

## Catppuccin for Zed

- Source: https://github.com/catppuccin/zed
- Revision: `6fd105a51a0a0ba96579c86df0f58193a51001a3`
- Files: `assets/themes/catppuccin-mauve.json`, `assets/themes/LICENSE`.
- Copyright Catppuccin contributors; MIT license, preserved alongside the asset.
- The official Mauve-accent theme is loaded unchanged; Mocha is the app default.

## GPUI Kit components

- Source: https://github.com/longbridge/gpui-kit (formerly gpui-component).
- Package: `gpui-component` 0.5.1, revision `0f0ab35233212f8f3277028995caf0c41e13ee6c`.
- Copyright Longbridge and contributors; Apache-2.0. The checksum-verified
  upstream package preserves its license notices.
- Local compatibility changes are in
  `patches/gpui-component/0001-pinned-gpui-compatibility.patch`: use the editor's
  Tree-sitter version and GPUI APIs for anchors, focus, geometry and text paint.
- The campaign uses its buttons and form layout; Zed owns workspace docking
  and document editing. Component overlays requiring a Kit window root are
  not enabled in the campaign workspace.

Velotype and other projects in the design plan are research references only;
no source from those projects is included.
