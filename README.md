# ttrpgui

A keyboard-driven app for planning and running tabletop RPGs. Everything also has a button or menu item. See `SPEC.md` for the design and `CLAUDE.md` for a map of the code.

It is a headless server that owns a Game directory, with web clients for the control and display views. The desktop app is Electron running the server and the control window together. The server can also run alone and serve the views to any browser on the LAN.

## Game night

1. `bun start` (inside the dev shell). It reopens the last Game; `bun start -- --game DIR` opens another, and an empty directory becomes a new Game.
2. "Go live" in the table bar (or "Go live with a session" in Ctrl+P) picks or creates the Session. Its name in the bar opens a menu to open or end it; Ctrl+L opens it.
3. The monitor button in the bar ("Open the player display") opens the second window; it lights up while the window is open, and a second press closes it. Drag it to the TV and press F for fullscreen. Music and wallpaper start there.
4. Open a prepared combat from the sidebar or with Ctrl+K, and press "Start combat" (Shift+S). Closing the control window quits everything.

Table state lives in the Game (`runtime.toml`), so a restart picks up the running combat, the shown image, and the music. Undo history does not survive a restart.

## Where the controls are

Every command is in the palette (Ctrl+P) with its key. The ones you would look for on screen also have a control, with the command and its key in a tooltip:

- **Table bar**, along the bottom. On the left: the player display toggle (Electron only), the active atmosphere as a switcher, the live session (Go live, or its name with a menu that opens or ends it), the running combat and round, the shown image (show, a thumbnail with its note's name, hide), then problems. On the right, where they never move: the track, play or pause, skip, mute, a volume slider, and the command palette. Play starts a track when none is current. Before the track it says "Paused" or "Muted", and in Electron "Display closed" while the display window is closed, since only the display makes sound; click it to open the display. A dimmed control's tooltip says why it is dimmed, such as "No tracks in Market Day". "Open another Game" is on an empty tab and in Ctrl+P.
- **Tab bar**: the sidebar toggle, back, forward, and new tab.
- **Sidebar**: a search button beside the filter, and a + on each group that creates one of its kind. A new creature is an NPC; "Mark as PC" in its header makes it a PC.
- **Combat view**, a toolbar under the title: start or end, next turn, roll, add, undo, redo; then, for the selection or the cursor row, damage, heal, condition, temp HP, initiative, concentration, and select. The ⋯ menu holds the rest: max HP, death saves, legendary counters, rename, note, clear selection, remove, and the combat's atmosphere, session, party rest, rename, and delete. Shift+click selects rows.
- **Note header**: by kind, "Edit stat block", "Mark as PC" or "Mark as NPC", and "Display name" for a creature; "Go live" or "End session" and "Set date" for a session. Its ⋯ menu renames, changes the kind, sets an image role, or deletes. Each image row can show the image on the display, hide it, or set its role.
- **Stat block form**: Section, Entry, move up and down, remove, and Done, acting at the field with focus.
- **Atmosphere view**: "Make active" and "Make default" in the header, rename and delete in its ⋯ menu, and "Sync media" under the links.

## Server alone

`bun run cli serve --game DIR` serves `/control` and `/display` on `localhost:7373` for any browser. `--lan` listens on every interface and prints the display URL for each LAN address; there is no auth. `--port N` picks another port. Starting a second copy on a port in use fails with an error.

In a browser tab, the browser keeps Ctrl+W, Ctrl+N, Ctrl+T, Ctrl+Tab, and Ctrl+Shift+Tab for itself; rebind those Actions (see Keys), use the tab bar's + button, or use the desktop app. Opening and closing the display window are desktop-app Actions; in a browser, open `/display` yourself.

## Development

This project uses Nix and direnv. Run `direnv allow`, or prefix commands with `nix develop -c`. The shell provides Bun, Node.js, Biome, Electron, Xvfb, Playwright's browsers, and `yt-dlp` and `ffmpeg` for syncing atmospheres. Nixpkgs builds `yt-dlp` with Deno, which it needs to solve YouTube's JavaScript challenges.

```sh
bun install
bun start                    # build and launch the desktop app
bun start -- --game DIR      # open a specific Game
bun run dev                  # hot-reloading client and server on a temp copy of the sample Game
bun run cli serve --game DIR # server only, on localhost:7373 (--port N, --lan)
bun run cli validate DIR     # report every problem in a Game; exits 1 if any exist
bun run check                # tsc and Biome
bun test                     # unit tests
bun run shots                # screenshots of /control and /display in headless Chromium
bun run smoke                # boot the real Electron app and its display window under Xvfb
bunx shadcn add NAME         # add a shadcn/ui component to src/client/components/ui
nix fmt
```

The client is React with Tailwind CSS and shadcn/ui; `CLAUDE.md` describes the styling conventions.

Electron runs with the Nix runtime. Its npm package provides the types and launcher. The npm `playwright` version is pinned to nixpkgs' `playwright-driver`.

## Game directory format

A Game is a directory of plain files. People and agents MAY write them by hand; the app shows every change immediately. Unknown files and fields are problems. Check a Game with:

```sh
bun run cli validate DIR     # lists each problem as file: field: message; exits 1 if any
```

```
my-game/
  notes/
    Cinder Drake/      # one directory per note; the directory name is the title
      note.md          # markdown body; link with [[Title]], [[Title#Heading]], or [[Title|label]]
      metadata.toml    # optional
      statblock.toml   # optional
      portrait.png     # images: png, jpg, gif, webp, avif, svg
  combats/
    Gatehouse Skirmish.toml  # one file per combat; the file name is its name
  atmospheres/
    Emberfall Night/   # one directory per atmosphere; the directory name is its name
      atmosphere.toml  # optional: links to sync from, and whether it is the default
      wallpaper.webm   # optional: a video (webm, mp4, mkv, mov, ogv) or an image, looped muted
      music/           # optional: audio files and their cover art, shuffled
  runtime.toml         # optional: shared table state such as the running combat
```

Titles are unique and MUST NOT start with `.` or contain `/ \ [ ] | #`. Every note directory MUST hold `note.md`, even if empty. Dotfiles are ignored. `fixtures/sample-game` is a complete example.

In a file with problems, each unknown field and bad value is ignored, as is a table or list item missing a required field, and the rest loads. A file that is not valid TOML is ignored whole. Problems stay listed until fixed, and the app refuses to write a file that has problems. Run the validator after every hand edit.

### `metadata.toml`

Every field is optional, and so is the file: without it a note is a plain note.

| Field          | Kind     | Meaning                                                                  |
| -------------- | -------- | ------------------------------------------------------------------------ |
| `kind`         |          | `"session"`, `"creature"`, or `"location"`                               |
| `date`         | session  | `2026-11-07`, as a TOML date or a string                                 |
| `pc`           | creature | `true` for a PC; absent means NPC                                        |
| `display_name` | creature | what players see instead of the title                                    |
| `hp`           | creature | PC state between combats: `current`, `temp`, `max_adjust`                |
| `images`       | any      | image file to role: `"main"`, `"map"`, or `"landscape"`                  |

The main picture (a creature's portrait, a location's display picture) is the image with role `main`, else the note's only image if it has no role.

```toml
kind = "creature"
pc = true
display_name = "The Masked Captain"

[images]
"portrait.png" = "main"
```

### `statblock.toml`

Every field is optional. Numbers are whole numbers unless noted.

| Field                                                  | Meaning                                                    |
| ------------------------------------------------------ | ---------------------------------------------------------- |
| `ac`, `hp`                                             | armor class, hit point maximum                             |
| `initiative`                                           | initiative bonus                                           |
| `speed`, `senses`, `languages`                         | text                                                       |
| `vulnerabilities`, `resistances`, `immunities`         | text                                                       |
| `abilities`                                            | scores by `str`, `dex`, `con`, `int`, `wis`, `cha`         |
| `saves`                                                | bonuses by the same ability keys                           |
| `skills`                                               | bonuses by skill, lowercase with underscores               |
| `cr`                                                   | a number, or text like `"1/4"`                             |
| `legendary_actions`, `legendary_resistances`           | counts                                                     |
| `sections`                                             | ordered, freely named sections of entries                  |

Each section has a `name` and `entries`; each entry has a `name` and markdown `text`, which may hold `[[links]]`.

```toml
ac = 13
hp = 9
speed = "30 ft."
cr = "1/4"
abilities = { str = 8, dex = 15, con = 10, int = 10, wis = 8, cha = 8 }
skills = { stealth = 6, sleight_of_hand = 4 }

[[sections]]
name = "Actions"

[[sections.entries]]
name = "Scimitar"
text = "*Melee:* +4 to hit, 1d6 + 2 slashing."
```

In the app, "Edit stat block" (Ctrl+Shift+E) turns the stat block into a form. Tab moves through fields; saves and skills are typed as `Dex +6, Con +8`. Alt+S adds a section, Alt+E an entry, and Alt+Up/Down move them. Escape leaves the form.

### `combats/<Name>.toml`

Every field is optional; an empty file is an empty combat.

| Field        | Meaning                                                              |
| ------------ | -------------------------------------------------------------------- |
| `session`    | title of the Session note it belongs to                              |
| `round`      | set while it runs                                                    |
| `turn`       | label of the active combatant, set while it runs                     |
| `atmosphere` | name of the atmosphere that Start switches to; End switches back     |
| `combatants` | table of combatants by label                                         |

Each combatant references a Creature note and holds only its own state. Max HP and AC come from the creature's stat block, and a PC's HP lives in the PC's `metadata.toml`, so it carries from combat to combat.

| Field                   | Meaning                                                        |
| ----------------------- | -------------------------------------------------------------- |
| `creature`              | title of a Creature note (required)                            |
| `initiative`            | the rolled or typed total                                      |
| `hp`                    | NPCs only: `current` (absent means full), `temp`, `max_adjust` |
| `conditions`            | condition to rounds left, or `true` until removed              |
| `concentrating`         | `true` while concentrating                                     |
| `death_saves`           | `success` and `failure` counts                                 |
| `legendary_actions`     | uses left; absent means the stat block's full count            |
| `legendary_resistances` | uses left; absent means the stat block's full count            |
| `acted`                 | `true` once it has had a turn in the running combat            |
| `note`                  | markdown                                                       |

```toml
session = "Session 1"
round = 2
turn = "Goblin Skulker B"

[combatants."Thorin Ashvale"]
creature = "Thorin Ashvale"
initiative = 14
acted = true

[combatants."Goblin Skulker B"]
creature = "Goblin Skulker"
initiative = 12
acted = true
conditions = { Frightened = true, Poisoned = 2 }
hp = { current = 4 }
```

### `atmospheres/<Name>/`

An atmosphere is a wallpaper and music for the player display. Playback only uses the files in its directory: put them there by hand, or let "Sync atmosphere media" download them from the links in `atmosphere.toml`. Every field is optional, and so is the file.

| Field               | Meaning                                                                         |
| ------------------- | ------------------------------------------------------------------------------- |
| `default`           | `true` for the Game's default atmosphere; without one, the first by name is     |
| `wallpaper`         | link to download as `wallpaper.<ext>`, such as a YouTube video                  |
| `wallpaper_section` | the part of it to download, like `"1:00:00-1:02:00"`; default the first 2 minutes |
| `music`             | link to download into `music/`, such as a YouTube Music playlist                |

```toml
default = true
wallpaper = "https://www.youtube.com/watch?v=..."
wallpaper_section = "10:00-12:00"
music = "https://music.youtube.com/playlist?list=..."
```

A track's file name gives its artist and title: `Artist - Title.opus`, optionally with an id, `Artist - Title [id].opus`. Without ` - `, the whole name is the title. Cover art is an image beside it with the same name, such as `Artist - Title.jpg`. Audio may be opus, ogg, oga, mp3, m4a, aac, flac, or wav; opus, ogg, mp3, and flac play everywhere.

Sync runs `yt-dlp` in the background and fetches only what is missing: the wallpaper if there is no `wallpaper.*` (delete it to fetch a new one), and tracks not yet in `music/`. The wallpaper is video only, SDR, at most 1080p, preferring VP9 WebM. Tracks are Opus audio with their thumbnail as cover art. A notice reports when it ends or why it failed; files appear as they finish. Links from `www.youtube.com` and `music.youtube.com` both work, for a public or Unlisted video or playlist.

YouTube shows a private playlist, and your Liked Music, only to you, so without sign-in sync fails with "The playlist does not exist". Either:

- make the playlist Unlisted in YouTube Music (its menu, then Edit playlist, then Privacy), which works for any playlist except Liked Music; or
- let `yt-dlp` sign in as you with your browser's cookies: add `ytdlp_args = ["--cookies-from-browser", "firefox"]` to the user config (see Keys), naming the browser where you are signed in to YouTube (`firefox`, `chrome`, `chromium`, `brave`, ...). It reads the cookies on each sync. Close the browser first if `yt-dlp` cannot read its cookie database.

YouTube now and then refuses downloads with "HTTP Error 403: Forbidden" for a few minutes, even ones that worked before. Sync again later; it fetches only what is missing.

To limit how much a sync fetches, add `"--playlist-items", "1-20"` to `ytdlp_args`.

### `runtime.toml`

Shared table state, so a restart picks up where it left off. The app writes it; deleting it ends live mode and any running combat, and returns to the default atmosphere.

```toml
session = "Session 1"                   # the live Session
combat = "The Drake Awakens"            # the running combat
atmosphere = "Dragonfire"               # chosen with "Switch atmosphere"; absent means the default
restore_atmosphere = "Emberfall Night"  # what End switches back to
image = "Emberfall Keep/keep-map.png"   # shown on the display: <Note title>/<file>

[music]
track = "Cinder Drums - Molten Hoard.opus" # a file in the active atmosphere's music/
paused = true
volume = 80                                # percent; absent means 100
```

## Combat

"New combat" creates a combat with every PC in it; it opens in a tab, with the tracker on the left and the stat block of the combatant under the cursor on the right. These keys work while the tracker has focus, and every one is a command in the palette:

| Key            | Command                                    | Key       | Command                         |
| -------------- | ------------------------------------------ | --------- | ------------------------------- |
| `j` `k` `g` `G` | move                                      | `Enter`   | open the creature's note        |
| `Space`        | select or deselect                         | `Escape`  | clear the selection             |
| `n`            | add combatants                             | `x`       | remove combatant                |
| `r`            | rename combatant                           | `d`       | edit its note                   |
| `i`            | set initiative                             | `I`       | roll initiative for NPCs        |
| `-`            | damage                                     | `=` `+`   | heal                            |
| `h`            | set temp HP                                | `m`       | adjust max HP                   |
| `c`            | toggle a condition                         | `C`       | toggle concentration            |
| `s` `f`        | death save success, failure                | `l` `L`   | spend legendary action, resistance |
| `S` `E`        | start, end                                 | `t`       | next turn                       |
| `u`            | undo                                       | `Ctrl+R`  | redo                            |

Operations apply to the selection, or to the cursor row when nothing is selected. Undo history is per combat and shared by every control window. It is lost on restart and when the combat is renamed. Restarting an ended combat keeps NPC damage; NPCs added later start at full.

"Go live" marks the Session being run; Ctrl+L opens its note, and a combat started while live joins it.

## Player display

"Open the player display" opens a second window for the players; in a browser it is `/display` on the server. Double-click it or press F for fullscreen. It shows the active atmosphere's wallpaper and a now-playing bar, one image the game master shows, and, while a combat runs, the round, whose turn it is, the next PC as "on deck", and the turn order. Players see display names and conditions, and never HP, AC, stat blocks, or notes. PCs are listed from the start; an NPC appears once it has had a turn. Music and wallpaper play only while a display is open, and sound comes only from the display. A browser may block sound until the first click, and says so.

| Key           | Command                                  | Key         | Command                 |
| ------------- | ---------------------------------------- | ----------- | ----------------------- |
| `Alt+I`       | show an image; the open note's come first | `Alt+Shift+I` | hide the image        |
| `Alt+A`       | switch atmosphere                        | `Alt+M`     | play, pause, or resume music |
| `Alt+N`       | skip to another track                    | `Alt+=` `Alt+-` | volume up, down     |
| `Alt+0`       | mute, or unmute to the volume before     |             |                         |

On the display itself, F or a double-click toggles fullscreen, and `Ctrl+=` `Ctrl+-` `Ctrl+0` zoom it in, out, and back to 100% without touching the control window.

The sidebar lists atmospheres; each opens a view of its links and media, with "Make active", "Make default", and "Sync media". The combat's ⋯ menu sets the atmosphere its start switches to.

## Tabs

Tabs work as in a browser or Obsidian. A click or Enter on a note, combat, or atmosphere shows it in the current tab, or switches to its tab if it is already open. Ctrl+click, middle-click, or Ctrl+Enter opens it in a new tab next to the current one. That works in the sidebar, the pickers (Ctrl+K, search, and the rest), wiki links in note text, the lists in a note, the problems list, the table bar, and the combat tracker, where a plain click only moves the cursor and Ctrl+click or middle-click opens the creature. The + at the end of the tab bar, or Ctrl+T, opens an empty tab; the next thing you open fills it. Close a tab with its ×, a middle-click, or Ctrl+W.

Each tab has its own history. The arrows at the left of the tab bar, Alt+Left and Alt+Right (also in note text), or the mouse's back and forward buttons go back and forward in the current tab. Back skips what was deleted or renamed outside the app, and what is open in another tab; close that tab to go back to it there. A new tab starts with no history. Tabs and their history survive a restart.

## Zoom

Ctrl+= (or Ctrl++), Ctrl+-, and Ctrl+0 zoom the window you press them in, from 50% to 300%. Each window remembers its own zoom; the control window and the player display never zoom together.

## Keys

Ctrl+P lists every command with its key; the palette shows only the commands that apply where focus is. Ctrl+K opens a note, combat, or atmosphere by title (it matches word starts and initials, like `cdra` or `cd` for Cinder Drake) or creates a note. Plain-letter keys never fire while typing; Escape leaves a text box so they work again.

| Where               | Key                       | Command                                          |
| ------------------- | ------------------------- | ------------------------------------------------ |
| Anywhere            | `Ctrl+P` / `Ctrl+K`       | command palette / open or create                 |
|                     | `Ctrl+N`                  | new note                                         |
|                     | `Ctrl+Shift+F`            | search note text                                 |
|                     | `Ctrl+B` / `Ctrl+E`       | toggle / focus the sidebar (`/` filters it)      |
|                     | `Ctrl+T` / `Ctrl+W`       | new tab / close tab                              |
|                     | `Alt+Left` / `Alt+Right`, mouse back / forward | back / forward in the tab   |
|                     | `Ctrl+Tab` / `Ctrl+Shift+Tab` | next / previous tab                          |
|                     | `Ctrl+=` `Ctrl+-` / `Ctrl+0` | zoom in, out / reset                          |
|                     | `Ctrl+L`                  | open the live session                            |
|                     | `F2`                      | rename the note, combat, or atmosphere in the tab |
| Lists               | `j` `k` `g` `G`, arrows   | move                                             |
|                     | `Enter` / `Ctrl+Enter`    | open / open in a new tab                         |
| Anything you open   | click / `Ctrl+click`, middle-click | open / open in a new tab                 |
| Note text           | `Alt+Enter` / `Ctrl+Alt+Enter` | follow the link under the cursor / in a new tab |
|                     | `Escape` / `Enter`        | leave the text box / go back in                  |
| Creature note       | `Ctrl+Shift+E`            | edit the stat block (Escape leaves the form)     |
| Stat block form     | `Alt+S` / `Alt+E`         | add a section / an entry                         |
|                     | `Alt+Up` / `Alt+Down`     | move the entry or section                        |

The tracker and player display keys are listed above under Combat and Player display. All other commands have no key.

Rebind any command in `$XDG_CONFIG_HOME/ttrpgui/config.toml` (usually `~/.config/ttrpgui/config.toml`); changes apply immediately. Command ids are listed in `src/shared/keys.ts`. A bind is a key with optional `ctrl+`, `alt+`, `shift+`, `meta+` (`shift+g` or `G`), named keys like `f2`, `space`, `escape`, `arrowup`, or several alternatives separated by spaces:

```toml
ytdlp_args = ["--cookies-from-browser", "firefox"]  # extra yt-dlp arguments for every sync; must come before [keys]

[keys]
quick-open = "ctrl+o"
rename-note = "ctrl+r"
close-tab = ""        # unbind
heal = "= + shift+h"  # alternatives, separated by spaces
```

Nothing else is accepted. A mistake in the file is a problem in the problems list, and until it is fixed that bind is ignored, so its command falls back to its default key. Invalid TOML ignores the whole file.

## Troubleshooting

**Fullscreen display breaks on an HDR-capable monitor (Hyprland).** Hyprland offers HDR to a fullscreen window on a monitor that supports it and switches the monitor to HDR when the window takes it, which breaks a monitor running in 8-bit ("wide color gamut is enabled but the display is not in 10-bit mode"). The desktop app turns off Chromium's Wayland color management (`--disable-features=WaylandWpColorManagerV1`), so its windows stay plain sRGB and never ask for HDR. A browser showing `/display` does not get that switch; in Hyprland you can instead turn off auto HDR with `hl.config({ render = { cm_auto_hdr = 0 } })`.

## License

Licensed under either of Apache License, Version 2.0 or MIT license at your option.
