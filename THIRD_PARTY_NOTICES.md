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
- Local changes: `patches/zed/0001-parent-buffer-markdown.patch` removes the
  separate table editor, reveals source for keyboard editing, and adds an
  addon source-display scope around Vim editor operations;
  `0002-vim-markdown-regressions.patch` adds integration tests and their dependencies.

## Catppuccin for Zed

- Source: https://github.com/catppuccin/zed
- Revision: `6fd105a51a0a0ba96579c86df0f58193a51001a3`
- Files: `assets/themes/catppuccin-mauve.json`, `assets/themes/LICENSE`.
- Copyright Catppuccin contributors; MIT license, preserved alongside the asset.
- The official Mauve-accent theme is loaded unchanged; Mocha is the app default.

Velotype and other projects in the design plan are research references only;
no source from those projects is included.
