# ADR 001: Keep Zed's editing model authoritative

Status: source-on-edit editor foundation accepted for campaign integration.
The complete campaign release and performance gates remain under verification.

The desktop composes Zed's `Workspace`, `Project`, `Editor`, `vim`, search,
command palette, and the live Markdown addon from **one source revision**.
`upstream/zed.lock.toml` pins the archive and its SHA-256; the root Cargo lockfile
pins the application's transitive dependencies. Upstream test code and its
Neovim comparison harness remain available. Neovim is a test dependency only.
Application composition is in `src/desktop`; upstream modifications are exported
as reviewable patches, rather than mixed into application code.

## Editing surface

The preferred rich surface is not yet proven. The current implementation uses
the plan's accepted **live Markdown with source-on-edit fallback**:

| Construct | Away from selection | At the editing selection |
| --- | --- | --- |
| Emphasis, inline code, links, list markers | Styled, concealed punctuation | Relevant source markers reveal |
| Headings, quotes, fenced blocks | Native block presentation | Parent buffer source reveals |
| Tables | Native table widget | Parent buffer source reveals, including cell clicks |
| Images | Native image widget | Parent buffer source reveals |
| Unsupported syntax | Preserved in Markdown | Ordinary source editing |

Ctrl+Alt+M toggles source/live presentation for the focused editor. Text remains
Markdown in both modes. There is no source/preview pair or second document model.
A split uses Zed's `clone_on_split`, retaining the same underlying project buffer
with independent selections and scroll state. Zed owns Vim modes, selections,
registers, transactions, text undo, and document saving.

The original addon's table-cell overlay was a single-line `Editor` with a
separate text buffer, a blur-time commit, and its own selection state. Patch 1
removes it. Clicking a cell resolves anchored ranges against the current buffer,
focuses the parent editor, and moves the caret to the cell's content without
editing text or switching Vim mode. Escape has ordinary Vim semantics: it exits
Insert/Visual mode; `u` undoes a committed text edit. There is no hidden draft to
commit on blur or cancel. Structural table actions still edit the parent buffer.

Keyboard selections must reveal tables and images as well as other blocks;
requiring a mouse-only source button would make these constructs inaccessible to
ordinary document editing. Formatting preservation means preserving Markdown
through source-backed transactions here, not promising semantic rich-text
operators that rewrite markup around arbitrary selections.

Live Neovim comparisons exposed display-coordinate failures at concealed inline
punctuation and multi-line replacement blocks. The editor now offers an addon
source-display scope. Vim's existing editor-update boundary enters that scope,
temporarily suspending only the Markdown addon's decorations, then restores
cached presentation before the next frame. This preserves upstream source
coordinates without replacing Vim's operators or the document engine. Tests
cover commands crossing bold text, tables, images, quotes, and headings. All
564 upstream Vim tests and 31 Markdown-addon tests pass with this patch.

## Prior art decision

[Zed PR 62593](https://github.com/zed-industries/zed/pull/62593) supplies the
presentation layer and concealment primitives at the pinned revision. Its
closure is not a correctness verdict. This project's tests must establish the
behavior we depend on.

[Velotype](https://github.com/manyougz/velotype) is a reference for rich blocks and
[source mapping](https://github.com/manyougz/velotype/blob/main/src/editor/source_mapping.rs).
A second editor with its own AST/source positions would introduce a second
selection/transaction model. No Velotype code has been imported. Richer editable
blocks remain a separate experiment until they can submit anchored edits through
the parent Zed buffer and pass the same Vim tests. Neither its performance nor
its Vim compatibility is assumed.

## Gate and remaining boundaries

The gate requires a launched demonstration, passing Markdown/Vim regressions,
keyboard traversal across rendered blocks, table focus and undo, Unicode and
clipboard behavior, and shared-buffer consistency. Compilation alone does not
pass it. See `verification.md` for actual results and unverified cases.

After acceptance, the intended workspace boundaries are:

- Domain: typed UUID entities, commands, validation, combat lifecycle, structured undo; no GPUI.
- Storage: TOML/Markdown, atomic replacement, recoverable batches, external conflicts.
- Documents: handles, templates, portable links, aliases, backlinks, derived search indexes.
- Editor integration: the pinned Zed graph and Markdown presentation patches.
- Desktop: workspace items, campaign navigator, library picker, encounters, shared controls.

The initial app opens fixture copies under `.editor-proof/documents` and keeps
its settings/database under `.editor-proof/state`. It does not open the user's
existing Zed profile or campaign data. This development-only path is not the
campaign storage design. Portable campaign directories, structured combat,
rename/link maintenance, release packaging, and the 10,000-page/100-participant
performance gate remain required work after editor acceptance.
