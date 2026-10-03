# Baseline verification

Implementation stopped for user-requested handoff on 2026-10-03. The baseline is
incomplete. Read [handoff.md](handoff.md) for known failures and next steps,
[original-requirements.md](original-requirements.md) for the brief, and
[baseline.md](baseline.md) for the release checklist.

## Current checks (2026-10-03)

| Check | Observed result |
| --- | --- |
| Application build on one linked GPUI graph, including GPUI Kit | Passed |
| Fresh checksum-verified Zed + Kit bootstrap, five-patch series | Forward application passed at `/tmp/ttrpgui-bootstrap-viewport/zed` |
| Bootstrap idempotence and reverse patch verification | **Failed**: independent reverse checks cannot validate overlapping patches; local source marker also remains stale |
| Domain rules | 7 tests passed, including document-revision invalidation through undo/redo |
| Documents, templates, links, headings, stale indexing | 7 tests passed |
| Storage, interruption, external conflicts, atomic batches, recovery, image import | 10 tests passed |
| Dedicated save worker: dropped futures, ordered barriers/coalescing, failed-save recovery | 2 tests passed |
| Launcher helper, unknown arguments, OS instance lock | 3 subprocess tests passed without displays |
| Upstream Markdown addon | 32 tests passed after viewport changes |
| Upstream Vim | 564 tests passed after viewport/settings changes |
| Live Neovim campaign comparisons | 5 tests passed, including 15 recorded command scenarios |
| Upstream editor deserialization | 2 tests passed |
| Application Markdown parsing and native presentation | Passed after awaiting asynchronous parsing and propagating language themes |
| Combat/library rehearsal | Passed with 100 participants, selection, negative HP, initiative reorder, undo/redo, quantity and independent copies |
| Description rehearsal | Passed: multiline Vim draft, text undo, mode-aware Esc, first-selected prefill, one-step bulk apply/undo |
| Rename integrity | Passed: open editor transactions, closed journaled files, wiki labels, relative links/headings, domain undo/redo |
| Navigator keyboard flow | Passed: session expansion, session creation, encounter creation under selected parent, automatic roster, tab opening |
| Connected keyboard campaign lifecycle | Passed: start, local/library copies, bulk initiative/damage/reset/undo, rename, completion, carried character HP, immutable history |
| External changes | Passed: clean metadata reload, closed prose indexing, externally added/deleted pages, dirty conflict preservation, explicit recovery |
| Two-process restart | Passed: exact pane bounds for both split axes, tabs, focus, independent cursors/scroll, shared buffer and unsaved text |
| Native combat rendering | Passed on private software Wayland display; screenshot inspected |
| Native image-rich note | Parsed 618,948 bytes, 100 PNG assets, 200 blocks, 9,000 inline markers; screenshot showed image, heading, bold text, links, Unicode and wrapping |
| Python native supervisor | Ruff passed |
| Native formatting actions and editor proof | **Failed**: new BoldSelection dispatch did not edit the checked document; original two-tab/shared-buffer assertion passed |
| Optimized application build | Passed; `target/release/ttrpgui` available |

The root workspace totals 29 passing tests. The preserved Neovim trace was
rerun successfully against the current viewport implementation. Neovim remains
a comparison-test dependency and is never used by the application. Earlier
two-process restart/editor-deserialization evidence should be rerun after the
final fixes; see handoff.md for raw log locations.

## Measurements

Latest optimized check passed (process exit 0):

| End-to-end CPU measurement | Observed result |
| --- | --- |
| 10,000-page warm picker: input, fuzzy query, CPU frame | median 2.72 ms, max 2.91 ms |
| 100-participant key navigation and CPU frame | p50 2.76 ms, p95 4.72 ms, max 5.41 ms |
| Health mutation, queued save and CPU frame with 10,000 pages | 5.15 ms |
| Initial durable creation of the portable fixture | 17.67 seconds, before UI-loop deadline |

The 50 ms picker gate and 16.67 ms combat CPU-budget gates passed. These are
headless CPU frames, **not hardware presentation latency** or proof of the user's
display sustaining 60 Hz. Raw log: `/tmp/ttrpgui-optimized-performance.log`.

The 619 KB image-rich note was verified on private software Wayland. The last
native debug measurement after viewport lookup: ready in 2.58 seconds, Vim
motion/frame median 481.59 ms and max 483.79 ms (six samples). This preceded the
final removal of redundant Vim settings source scopes. It still missed the
interaction target. **Optimized native long-note measurement is outstanding.**
The supervisor now measures 24 motions and supports `--require-performance`.
No smooth 60 Hz long-note result is claimed.

## Reproduction and desktop isolation

After fixing bootstrap and formatting, run `nu scripts/verify-editor.nu` from
`nix develop`. `--neovim` enables live comparisons and `--performance` adds the
optimized 10k-page/100-participant gate. The script currently fails at bootstrap.
Cargo
build concurrency is capped at two jobs. Headless application rehearsals use
isolated data and enforce a 15-second event-loop deadline.

For native rendering, use `uv run scripts/native_check.py` with Weston in the
shell. `--scenario note` creates a long image-rich note, verifies actual parsed
presentation, and measures Vim motions. The Nix development shell supplies a
software Vulkan ICD from the same pinned libc/LLVM graph as the binary. The
supervisor strips desktop display/socket variables, starts its own offscreen
compositor, limits software rendering threads, and terminates only its owned
process groups in a finally block. No native proof process remained afterward.

The original launch incident was recursive invocation of the **linked ttrpgui
binary**, caused by an unhandled `--printenv` helper argument. It was not an
external Zed application. The entrypoint now handles helper/help arguments
before GPUI or storage initialization, rejects unknown arguments, and holds an
OS instance lock. Launcher subprocess regressions verify these protections.

Final packaging, optimized long-note performance and remaining editor/workspace/
external-conflict acceptance remain release gates. See handoff.md for the
concrete repair order and baseline.md for unresolved requirements.
