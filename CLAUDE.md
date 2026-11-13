# ttrpgui

Keyboard-driven app for planning and running TTRPGs. `SPEC.md` is the product spec; its "Architecture" and "Decisions" sections are binding.

The code MUST stay simple. Prefer the 200-line 90% solution over the 2,000-line perfect one. Reuse before adding. No speculative abstractions.

## Architecture

A headless Node server owns the Game directory and the one shared state tree. Clients are web pages it serves. Electron is a thin shell around both.

- `src/shared/schema.ts`: zod schemas for the on-disk formats and the user config. All strict: unknown keys are violations.
- `src/shared/state.ts`: the synced `GameState` and the socket messages.
- `src/shared/notes.ts`: note content rules shared by server and client: wiki link parsing (`parseLinks`, `renameLinks`, `backlinks`), `imageFile`, and `mainImage`. Never parse links anywhere else.
- `src/shared/statblock.ts`: ability modifiers and the text forms of bonuses (`Dex +6, Con +8`), as shown and as typed.
- `src/shared/combat.ts`: the pure combat rules over Combat data: turn order, turns, per-Combatant `rules` (damage, conditions, ...), initiative rolls. Unit tested.
- `src/shared/display.ts`: the pure display rules: track names (`parseTracks`), the active Atmosphere, shuffle (`nextTrack`), switching around combat, and `playerTracker`, the one place that decides what players may see. Unit tested.
- `src/shared/keys.ts`: every `Action` id with its default bind, the key syntax (`ctrl+k`, `shift+g` or `G`, `j`, `+`, `f2`; alternatives separated by spaces: `= +`), and `binds(config.keys)`, the user config over the defaults.
- `src/server/game.ts`: `loadGame` loads and validates the Game in one pass; a file with problems loads its valid parts and reports only its schema problems; `loadConfig` does the same for the user config; `reconcile` for reloads; `searchNotes` for full-text search.
- `src/server/mutations.ts`: mutations, the only way clients change the Game. Each one edits files. Metadata, stat block, and atmosphere writes go through `saveToml`: it validates against the schema and refuses to overwrite a file that has problems. Combat mutations wrap `combat.ts` rules with `onCombat`/`onCombatants`, which also keep undo history. See "Combat".
- `src/server/download.ts`: runs `yt-dlp` for an Atmosphere's links, outside the mutation queue. Wallpapers are SDR only. A failure that looks like YouTube wants sign-in says how to fix it.
- `src/server/server.ts`: `startServer({ gameDir, configFile, host, port })`. HTTP (built client, Game files under `/game/`, and `/search?q=`), WebSocket sync on `/ws`, and the file watcher. MUST stay Node-compatible: no Bun or Electron APIs.
- `src/cli.ts`: `serve` and `validate`. `src/electron.ts` and `src/preload.cjs`: start the server in-process, open the control window, open and close the display window, and switch Games. `electron.ts` also disables Chromium's Wayland color management (`WaylandWpColorManagerV1`): with it, Hyprland hands a fullscreen window HDR and switches the monitor into HDR.
- `src/client/`: one React app (Vite). `/control` → `Control.tsx`, `/display` → `Display.tsx`.
  - `sync.ts`: the state mirror. `useGame(selector)`, `getGame()`, `useStatus()`, and `send(mutation)`, which resolves `true` once applied or toasts the error and resolves `false`.
  - `ui.ts`: per-client state (tabs and their history, sidebar, picker) in a tiny store from `store.ts`. Tabs, their history, and the sidebar persist in localStorage. `toast()` shows a Sonner toast. See "Tabs" and "Zoom".
  - `history.ts`: the pure per-tab back and forward history. Unit tested.
  - `actions.ts`: the `Action` registry (title, `when`, `run`, and for its GUI control an `icon` and short `label`), keybind dispatch, and the mouse's back and forward buttons. `controls.tsx`: the GUI form of an Action. See "Controls". `Picker.tsx`: the one fuzzy picker (shadcn Command in a Dialog; fuzzysort ranks and highlights, cmdk's filter is off), also used for prompts and confirmations. `list.ts`: the one list behavior (`j`/`k`, arrows, `g`/`G`, Enter, Ctrl+Enter for a new tab) and its classes (`listClass`, `rowClass`).
  - `MarkdownBox.tsx`: the one markdown text box (CodeMirror 6). See "Text editing".
  - `views.tsx`: tab views (note, combat, atmosphere, problems). The note view holds the body's `MarkdownBox`, then its images and backlinks as lists. A Creature adds an aside with its portrait and `StatBlock`; a Location shows its main picture; a Session lists its combats. `Sidebar.tsx`: notes grouped by kind, and combats; `focusSidebar()`.
  - `Bar.tsx`: the table bar along the bottom, the game master's remote: session, running combat, display, atmosphere switcher, music, shown image, problems, Commands.
  - `Tracker.tsx`: the combat view (tracker left; the cursor's note and `StatBlock` right) and the helpers tracker Actions use: `target()` (the selection, else the cursor row), `askNumber`, and the add-combatant and condition pickers.
  - `Display.tsx`: the player display. On `/display`, one rem is 1/54 of the screen's short side times the page zoom (`applyZoom` in `ui.ts`), so every size scales to any screen. It handles F and the zoom binds itself. `Fade` crossfades the wallpaper and the shown image (`data-layer`).
  - `Atmospheres.tsx`: the atmosphere tab view.
  - `StatBlock.tsx`: `<StatBlock title={t} editing? />`, the one stat block, read-only or as a form with the same rows. Fields save on blur; edits run one at a time so each builds on the last. The section and entry Actions act at `formCursor()`, read from where focus is. Also `SaveInput`, the one-line field that saves on blur, and `fieldBox`, the classes that make a box around a `MarkdownBox` look like an input.
  - `components/ui/`: vendored shadcn/ui components. See "Styling".
  - `theme.css`: the one theme (Tailwind, shadcn's variables, the app's tokens). `markdown.css`: CodeMirror content styles. There are no other stylesheets.
- `harness/`: Playwright helpers for agents. `fixtures/sample-game` is a realistic Game; `fixtures/broken-game` holds one of each violation.

Node 24 and Electron 45 run the `.ts` sources directly (type stripping). Only the client is built. Imports use explicit `.ts` extensions, and TypeScript MUST stay erasable (no enums, no namespaces, no parameter properties).

## Sync

Files on disk are the truth. State is always the result of loading them: the server mutates state only with Immer `produceWithPatches` around `reconcile`, which diffs a fresh `loadGame` against state, so only real changes produce patches. A new client gets a snapshot, then patches. Nothing is optimistic.

A mutation edits files, then the server reloads and answers the sender after broadcasting the patches. Any outside change in the Game directory or the config file triggers the same debounced reload; reloading files the server just wrote is a no-op. Mutations and reloads run one at a time through a queue. Note bodies are not in state: fetch `/game/notes/<Title>/note.md` and refetch when `bodyVersion` changes. Images are served from the same path. Each note's outgoing link titles (`links`) are in state, so backlinks need no fetch.

The user config (`$XDG_CONFIG_HOME/ttrpgui/config.toml`, a `[keys]` table of Action id to bind, `""` to unbind) is part of state, so every client gets the same binds. Its problems join the Game's.

## Combat

A Combat is `combats/<Name>.toml`; Combatants reference Creature notes by title and own only their state (labels are keys). Base max HP and AC always come from the stat block. A PC's HP lives in its `metadata.toml` `hp` table: `onCombat` copies it onto the Combatant for the rule, then writes it back, so rules never care. `runtime.toml` holds the live Session and the running Combat. Renaming a note rewrites references in both.

Undo: before a combat mutation writes, `onCombat` records what each file it changes held (a PC's metadata included); undo restores them and records the reverse for redo. One stack per Combat, in server memory. Combat creation, rename, and deletion are not undoable; renaming a Combat, or a note it references, clears its history, since entries name files.

Tracker Actions use `onTracker` in `actions.ts`: available only while the tracker has focus, acting on `target()`.

## Display and atmospheres

An Atmosphere is `atmospheres/<Name>/`: an optional `atmosphere.toml` (links, `default`), `wallpaper.<ext>`, and `music/`. Playback only uses those files; `syncAtmosphere` starts `download.ts` and returns at once, files appear through the normal reload, and `notify` toasts how it ended. Partial downloads stay in dot directories, which the loader and watcher ignore.

`runtime.toml` holds the active Atmosphere, what End restores, the shown image, and the music (track, paused, volume). The display client plays the track and sends `nextTrack` when it ends or when no track of the active Atmosphere is current; the server shuffles. Audio plays only on `/display`. Renaming or deleting a note or Atmosphere rewrites `runtime.toml` and Combats.

## Text editing

All text editing MUST use `MarkdownBox`: `<MarkdownBox value={text} onSave={(t) => send(...)} />`. Optional: `imageBase` (URL that relative image paths resolve against), `onImage` (store a pasted or dropped image, resolve to its path), `placeholder`, `view` (a ref to the `EditorView`). Without `onSave` it is read-only.

- The text is plain and round-trips byte for byte. Live preview is decorations only: markup hides unless the cursor touches it.
- It saves 500 ms after typing stops, on blur, on unmount, and before unload. A new `value` that echoes one of its own saves is ignored. Any other new `value` replaces the text with a minimal change, so the cursor stays; unsaved edits lose to it.
- `[[` completes titles. A link shows its label; a missing target looks dashed. Click or `follow-link` (Alt+Enter, Ctrl+Alt+Enter for a new tab) opens it, creating a plain note if missing.
- Images use relative markdown (`![](file.png)`) and render inline. A pasted or dropped image goes through the `addImage` mutation into the note directory. Roles live in `metadata.toml` (`setImageRole`).
- Tab and Shift+Tab indent. Escape focuses the box itself (Enter returns), and the next Tab moves past the editor.

## Tabs

A tab id is `view:arg` (see `views.tsx`); an empty tab is `new:<random>`, whose view shows the welcome hints. Ids are unique, so opening something already open switches to its tab.

- `openTab(tab, newTab)` is the one way to open anything: a tab not yet open replaces the active one, or opens beside it when `newTab`. `newTab()` opens an empty tab beside the active one.
- Each tab has a history (`history.ts`), kept in `ui.ts` by tab id: when a plain open replaces a tab, the old id goes on its back list and forward clears. A new tab, or a filled empty tab, starts with none. `travel` (the `go-back` and `go-forward` Actions, the tab bar arrows, Alt+Left/Right, mouse buttons 3 and 4) shows the nearest entry that exists and is not open in any tab, and passes over the rest, which stay for later. `closeTab` drops a tab's history; `replaceTab` renames through every history. `MarkdownBox` leaves Alt+Left/Right to the app.
- Every mouse open goes through `clickOpens(open)` (spread on the row): a click opens, Ctrl/Cmd+click or a middle-click opens in a new tab, and a middle press does not paste the primary selection. Code that sees the raw event (the picker, wiki links in `MarkdownBox`) uses `wantsNewTab(e)`. Keyboard: Enter, and Ctrl+Enter for a new tab, in `useListNav` and the picker.

## Zoom

Each page zooms alone through its root font size (`zoom`, `applyZoom` in `ui.ts`), stored per page in localStorage. Native zoom would not do: Chromium shares it per origin, so both windows would zoom together. Sizes MUST be in rem (Tailwind spacing and text sizes) so they scale; px is only for hairlines, radii, and shadows.

## Focus

Where focus sits decides which keys work. Code moves focus by ref, never with a document-wide query.

- A view's `Body` names its main element once with `useTabFocus(() => ref.current?.focus())` (`views.tsx`). It runs when the tab shows, and again each time `openTab` opens the tab (it bumps `refocus` in `ui.ts`). `ui.ts` knows nothing about views.
- A note's wrapper passes focus to its editor. Until the text loads it holds focus, and hands it over on load only if focus is still there.
- `pick` remembers what had focus; `closePicker` unmounts the dialog with `flushSync` (Radix traps focus while it is open), then returns focus there. The chosen item's `run` may then move it.
- Leaving goes back by ref: Escape in the combatant note focuses the tracker; closing the stat block form focuses the note's text box.

## Controls

Buttons and menu items run Actions; they never reimplement one. `controls.tsx`:

- `<ActionButton id />`: icon, plus text when the registry has a `label`; a tooltip with the title and current bind; disabled while unavailable. `label`, `icon`, and Button props (`variant`, `className`, `tabIndex`) override. `ToolButton` is the same button for the few controls that are not Actions (an image row's show, the live session's name).
- `<ActionMenu>` is a "More" (⋯) menu, or takes a `trigger`; `<ActionItem id destructive? />` is its item, with the bind as the shortcut. The chosen item runs after the menu closes and focus is back where it was before it opened (`afterMenu`), so the Action sees what the keyboard would and a picker returns focus there.
- `useAvailable(id)` rerenders on synced state, `ui`, and focus changes. Controls ask `canRun(id, true)`: `when(true)` skips checks that only decide where keys go (tracker focus), since the control's place already says it.
- Neither takes focus on a press, so stat block form buttons act at the focused field and tracker Actions keep their target.
- Disable a control that does not apply now, so a toolbar does not jump; hide one that can never apply here (display controls outside Electron). Where two Actions alternate (start or end combat, PC or NPC), show the one that applies.
- Space is scarce at 1280x800: icon buttons with tooltips, text only where the icon is unclear, the rest in the ⋯ menu.

## On-disk format

`<game>/notes/<Title>/` holds `note.md`, an optional `metadata.toml` (kind, roles, and so on), an optional `statblock.toml`, and images. `<game>/combats/<Name>.toml` and `<game>/runtime.toml` are described under "Combat", `<game>/atmospheres/<Name>/` above. `schema.ts` is the truth; README's "Game directory format" documents it for people and agents and MUST stay in step. Dotfiles are ignored.

## How to

- **Add a mutation:** add a function to `mutations` in `src/server/mutations.ts` that edits files. Its payload type becomes part of `Mutation` automatically. Throw to reject; the client toasts the message.
- **Add a combatant operation:** add a rule to `rules` in `src/shared/combat.ts`, a line `name: onCombatants(rules.name)` to `mutations`, and an Action (`sendFor`, `amount`, or `onTracker`).
- **Add an Action:** add its id and default bind (`""` for none) to `defaultKeys` in `src/shared/keys.ts`, then its title, optional `when`, and `run` to `actions` in `src/client/actions.ts`. TypeScript enforces that both lists match. It appears in the palette automatically. If someone would look for it on screen, give it an `icon` (lucide), a `label` if the icon alone is unclear, and put `<ActionButton id="..." />` or `<ActionItem id="..." />` where it belongs (see "Controls"). Use `pick()` for any choice, and `ask()` for text input (`load` fetches rows per query, as search does). `onNote`, `inCombatTab`, and `inAtmosphereTab` make an Action on the active tab; `rename` and `confirmDelete` are the shared prompts.
- **Add a view:** add an entry to `views` in `src/client/views.tsx` (`Label`, `Body`, optional `exists`; `Body` renders only while `exists`, so it need not handle a missing target). Its `Body` calls `useTabFocus` if it has a main element to focus. Open it with `openTab("<view>:<arg>")`. Lists inside it use `useListNav` with `listClass` and `rowClass`.
- **Add a sidebar group:** add an entry to `groups` in `src/client/Sidebar.tsx` that returns tab ids.
- **Add a file type** (for example `atmospheres/*.toml`): add a strict schema to `schema.ts`, load it in `loadGame` with `readToml` (it reports problems), add its key to `GameState`, and allow its path in `loadGame`'s top-level entry check. Mutations write it. Add a broken case to `fixtures/broken-game` and to the validator test.

## Styling

Tailwind CSS 4 and shadcn/ui (Radix, cmdk, Sonner, lucide icons). `src/client/theme.css` is the one theme: the CSS variables shadcn components read (`--background`, `--primary`, `--muted`, ...) and the app's own tokens (`--faint`, `--kind-*`, `--select`, and the display's `glass` and `glow`), all exposed as utilities (`bg-primary`, `text-faint`, `bg-kind-pc`, `font-serif`, `bg-glass`, `text-shadow-glow`). The app is dark only; `index.html` sets `class="dark"`.

- If shadcn has a component for the job, use it; never write a custom equivalent. Add one with `bunx shadcn add <name>`. It lands in `src/client/components/ui/` and is imported as `#components/ui/<name>.tsx` (`package.json` `imports`, which Vite and TypeScript resolve natively). Those files are vendored: Biome formats them but does not lint them, and they change only for theming. Style a use with `className`, not by editing the component.
- Everything else is Tailwind utilities in JSX, merged with `cn` from the `cn` package. No new CSS files. Share a class string as a constant only when it truly repeats.
- `markdown.css` styles CodeMirror content and decorations, which utilities cannot reach. It is unlayered so it outranks CodeMirror's own theme, and it reads theme variables. Since utilities cannot override it, a wrapper opts in with a styling class: `note-body` (tall text box), `md-small` (stat block and combatant note text), `md-entry` (an entry name, from `--name`, runs in before the text).
- Shared: `ActionButton`, `ToolButton`, `ActionMenu`, and `ActionItem` (`controls.tsx`), `listClass` and `rowClass` (`list.ts`), `page`, `pageTitle`, and `pageMeta` (`views.tsx`), and `fieldBox` (`StatBlock.tsx`). `Section` (`views.tsx`) is the titled block under a page. Chips are shadcn `Badge`; the kind lozenge is `KindMark`.
- Class names are for styling only. Code finds elements with refs, or with `data-*` attributes when the lookup crosses components (`data-tracker`, `data-statblock`, `data-section`, `data-entry`, `data-picked`, `data-turn`, `data-layer`). Tests use roles, labels, and these attributes.
- Radix overlays trap focus and catch keys. The picker turns off cmdk's vim keys so app binds still fire; see "Focus" for `closePicker`.

## Commands

Run inside the dev shell (`direnv allow`, or prefix with `nix develop -c`). Biome, Electron, Xvfb, and the Playwright browsers only exist there.

- `bun start [-- --game DIR]`: build the client and launch Electron. Without `--game` it reopens the last Game (`$XDG_STATE_HOME/ttrpgui/last-game`), else shows a folder picker.
- `bun run dev`: Vite with hot reload, plus the game server on port 7373. `GAME=DIR` picks the Game; the default is a temp copy of the sample.
- `bun run cli serve --game DIR [--port N] [--lan]` and `bun run cli validate DIR`.
- `bun run check` (tsc and Biome), `bun test` (unit tests), `nix fmt`. Biome reads `biome.json` in both.
- `bunx shadcn add <name>`: add a shadcn/ui component (`components.json` configures it).

## Screenshots and UI checks

NEVER open windows on the user's desktop. Browsers run headless; Electron runs under Xvfb. Tests and scripts MUST NOT touch the real config or state directories: `bootGame` uses a temp config file, and the smoke check sets temp XDG directories.

- `bun run shots [fixture] [outDir]`: builds, serves a temp copy of `fixtures/<fixture>` (default `sample-game`), and writes `shots/control.png` (1280x800) and `shots/display.png` (1920x1080). `shots/` is gitignored.
- `bun run smoke`: launches the real Electron app under `xvfb-run`, checks the preload, opens the display window and checks music plays, and writes `shots/electron-control.png` and `shots/electron-display.png`.
- Display checks: drive both pages from one script. The harness browser runs with `--mute-audio`, so media plays silently and `audio.currentTime` advances; it blocks sound until a click, so first click `getByRole("button", { name: "Click to start the music" })`. Each fixture track lasts 6 seconds. Check 1920x1080 and 2560x1440 (`display.setViewportSize`). Test sync against a fake `yt-dlp` on PATH, or the real one with a short `wallpaper_section` and `ytdlp_args = ["--playlist-items", "1-2"]` in the temp config.
- Custom checks: write a script that imports `harness/harness.ts` and run it with `node` after `bun run build`.

```ts
import { bootGame, openViews } from "./harness/harness.ts";
const game = await bootGame(); // { gameDir, configFile, url, close }: temp copies you may edit
const { browser, control, display } = await openViews(game.url); // Playwright pages, already connected
await control.getByText("Cinder Drake").waitFor();
await control.screenshot({ path: "shots/x.png" });
await browser.close();
await game.close();
```
