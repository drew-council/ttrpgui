# ttrpgui

A keyboard-driven app for planning and running tabletop RPGs. Everything also has a button or menu item. See `SPEC.md` for the design and `CLAUDE.md` for a map of the code.

It is a headless server that owns a Game directory, with web clients for the control and display views. The desktop app is Electron running the server and the control window together. The server can also run alone and serve the views to any browser on the LAN.

## Install

`nix run github:drew-council/ttrpgui` runs the desktop app. To install it, add the flake as an input and put `inputs.ttrpgui.packages.${system}.default` in `environment.systemPackages` or `home.packages`. That installs `ttrpgui`, with a launcher entry named "ttrpgui", and `ttrpgui-cli` for `serve` and `validate` (see "Server alone"). It brings its own `yt-dlp` and `ffmpeg`. With `NIXOS_OZONE_WL=1` it runs as a native Wayland window.

Every launch shows the start page. On the left, **Open a Game**: recent Games, most recent first, and "Open folder…" (`O`) for any other folder. A folder that is not a Game yet is made one only after you say so. The "Host a display" switch (`H`) picks how the next Game opens, from the list or a folder: off, the notes and controls open here, with the player display a click away; on, this computer shows only the player display and serves the Game to the LAN for another computer to drive (see "Two machines"). It starts as the most recent Game was last opened and changes only when you flip it. The cursor starts on whatever you used last, so Enter resumes it. On the right, **Join a Game**: Games hosted on the LAN and servers joined before. A remembered server not seen on the LAN says "Not found". The × on a row, or Delete, forgets it. A server is remembered once it has answered. The page zooms with `Ctrl+=` `Ctrl+-` `Ctrl+0`. "Back to the start page" (on an empty tab and in Ctrl+P) returns there. Recents live in `$XDG_STATE_HOME/ttrpgui/recent.json`.

Flags skip the start page, for scripts: `--game DIR` opens a Game (an empty or missing directory becomes a new one), `--display` opens only its player display, `--lan` listens on every interface, and `--connect URL` joins a server. `--display` or `--lan` without `--game` reopen the last Game. `--port N` (default 7373) sets the port a Game is served on, also from the start page.

## Game night

1. `ttrpgui`, or `bun start` inside the dev shell. Press Enter to open the last Game, or pick another.
2. "Go live" in the table bar (or "Go live with a session" in Ctrl+P) picks or creates the Session. Its name in the bar opens a menu to open or end it; Ctrl+L opens it.
3. The monitor button in the bar ("Open the player display") opens the second window; it lights up while the window is open, and a second press closes it. Drag it to the TV and press F for fullscreen. Music and wallpaper start there.
4. Open a prepared combat from the sidebar or with Ctrl+K, and press "Start combat" (Shift+S). Closing the control window quits everything.

Table state lives in the Game (`runtime.toml`), so a restart picks up the running combat, the shown image, and the music. Undo history does not survive a restart.

## Where the controls are

Every command is in the palette (Ctrl+P) with its key. The ones you would look for on screen also have a control, with the command and its key in a tooltip:

- **Table bar**, along the bottom. On the left: the player display toggle (Electron only), the active atmosphere as a switcher, the live session (Go live, or its name with a menu that opens or ends it), the running combat and round, the shown image (show, a thumbnail with its note's name, hide), then problems. On the right, where they never move: the track, play or pause, skip, mute, a volume slider, the dice roller, the privacy screen (it hides the control window until the next key or click, which does nothing else), and the command palette. Play starts a track when none is current. Before the track it says "Paused" or "Muted", and in Electron "Display closed" while the display window is closed, since only the display makes sound; click it to open the display. A dimmed control's tooltip says why it is dimmed, such as "No tracks in Market Day". "Back to the start page" is on an empty tab and in Ctrl+P.
- **Tab bar**: the sidebar toggle, back, forward, and new tab. Each tab group has its own.
- **Sidebar**: a search button beside the filter, and groups by kind: Sessions (newest first), PCs, NPCs, Vehicles, Locations, Notes, Combats, Atmospheres. Each group header collapses it with a click, and has a count and a + that creates one of its kind (expanding the group). A new creature is an NPC; "Mark as PC" in its header makes it a PC. "New session" creates a session titled and dated today without asking and puts the cursor in its name. The active note is marked and scrolled into view, also on the header of a collapsed group that holds it; Ctrl+E starts the cursor there. The filter matches what rows show and note titles, and shows matches in collapsed groups too. Keys: `j` `k` `g` `G` move over headers and rows, `Enter` opens a row or toggles a header, `h` or Left collapses the cursor's group, `l` or Right expands it.
- **Combat view**, a toolbar under the title: start or end, next turn, roll, add, undo, redo; then, for the selection or the cursor row, damage, heal, condition, temp HP, initiative, concentration, and select. The ⋯ menu holds the rest: max HP, death saves, legendary counters, rename, note, clear selection, remove, and the combat's atmosphere, session, party rest, rename, and delete. Shift+click selects rows. Click the title, or press F2, to rename the combat.
- **Note header**: by kind, "Edit stat block", "Mark as PC" or "Mark as NPC", and "Display name" for a creature or vehicle; "Go live" or "End session" for a session, whose title is its name (type to rename, Enter to save, Escape to undo; unnamed, it shows the date in words) and whose date opens a calendar under it (arrows, PageUp and PageDown, Enter picks, Escape closes; Today and Clear; also "Set session date" in Ctrl+P). Any other note's title renames the note the same way, and updates every link; a long one ends in an ellipsis until clicked. F2 puts the cursor in the title, or in a session's name. A name that is taken stays in the field to fix, with the reason in a toast. Its ⋯ menu renames, changes the kind, sets an image role, or deletes. Each image row can show the image on the display, hide it, or set its role.
- **Stat block form**: Section, Entry, move up and down, remove, and Done, acting at the field with focus.
- **Atmosphere view**: click the title, or press F2, to rename. "Make active" and "Make default" in the header, rename and delete in its ⋯ menu, and "Sync media" under the links.

## Server alone

`bun run cli serve --game DIR` serves `/control` and `/display` on `localhost:7373` for any browser. `--lan` listens on every interface and prints the display URL for each LAN address; there is no auth. `--port N` picks another port. Starting a second copy on a port in use fails with an error.

In a browser tab, the browser keeps Ctrl+W, Ctrl+N, Ctrl+T, Ctrl+Tab, and Ctrl+Shift+Tab for itself; rebind those Actions (see Keys), use the tab bar's + button, or use the desktop app. Opening and closing the display window are desktop-app Actions; in a browser, open `/display` yourself.

## Two machines

One computer shows the player display; another drives it. Open `ttrpgui` on both.

- Display computer: pick the Game, turn on "Host a display" (`H`), and press Enter. It serves the Game to the LAN on port 7373 and shows only the player display, fullscreen and titled "Ironvale display — ttrpgui"; F leaves fullscreen and returns. While the pointer moves, the display says where to join it, such as "Join at igneous:7373 or 192.168.1.20:7373", and that closing the window stops hosting. Closing the window quits; the next launch shows the start page with "Host a display" already on. Its firewall must allow TCP 7373; on NixOS, `networking.firewall.allowedTCPPorts = [ 7373 ];`.
- Laptop: under "Join a Game" the display computer appears by itself, with its Game, its name, and its address, while the start page is open. Choose it. If it does not appear, type its name or address in the field (`/`), such as `igneous` or `192.168.1.20:7373`. The control window opens on that Game. Until the server answers, the window says so and keeps trying (Escape or "Back to the start page" goes back, with the address in the field); an address that answers but is not a ttrpgui Game is never loaded: the start page says so; a dropped connection shows "Reconnecting…" and recovers by itself. The display toggle is not there: the display window and the Game belong to the display computer. Pasted images and everything else go over the connection. "Back to the start page" leaves, and the server stays in the list for next time.

Discovery asks every address in each private IPv4 LAN's /24 for `GET /info` on port 7373 (or `--port N`), every few seconds; it needs nothing open on the laptop. It skips loopback, VPN, and container interfaces, and does not see other ports or subnets: type those addresses by hand. Only a display host or `ttrpgui-cli serve --lan` listens on the LAN; a Game opened normally listens on this computer only. A Game hosted on this computer is listed as "this computer".

A browser at `http://igneous:7373/control` also works, with the browser keeping some keys (see "Server alone"). `ttrpgui-cli serve --lan --game DIR` is a host without a window.

## Development

This project uses Nix and direnv. Run `direnv allow`, or prefix commands with `nix develop -c`. The shell provides Bun, Node.js, Biome, Electron, Xvfb, Playwright's browsers, and `yt-dlp` and `ffmpeg` for syncing atmospheres. Nixpkgs builds `yt-dlp` with Deno, which it needs to solve YouTube's JavaScript challenges.

```sh
bun install
bun start                    # build and launch the desktop app
bun start -- --game DIR      # open a specific Game, skipping the start page
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

Electron runs with the Nix runtime, in the dev shell and in the package. Its npm package provides only the types and launcher, so keep its version at nixpkgs' (45.2.3 now). That Electron MUST bundle a Node that strips types (22.18 or later; Electron 45 bundles Node 24). The npm `playwright` version is pinned to nixpkgs' `playwright-driver`.

`nix build` builds the package (`nix/package.nix`); the Vite client build is its only real step, a few seconds. Dependencies are a fixed-output derivation keyed by `bun.lock` and the dependency fields of `package.json`, so source edits never refetch them. After changing dependencies, `nix build` fails with a hash mismatch on `ttrpgui-node-modules`: put the `got:` hash in `nix/package.nix`. `TTRPGUI_BIN=result/bin/ttrpgui bun run smoke` runs the Electron smoke check against the package. `TTRPGUI_DISCOVER=127.0.0.1:7400,…` replaces the addresses the start page probes, so tests never probe the LAN or port 7373.

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
| `kind`         |          | `"session"`, `"creature"`, `"location"`, or `"vehicle"`                  |
| `date`         | session  | `2026-11-07`, as a TOML date or a string                                 |
| `name`         | session  | shown after the date, such as `"Aruun"`                                  |
| `pc`           | creature | `true` for a PC; absent means NPC                                        |
| `display_name` | creature, vehicle | what players see instead of the title                           |
| `hp`           | creature | PC state between combats: `current`, `temp`, `max_adjust`                |
| `images`       | any      | image file to role: `"main"`, `"map"`, or `"landscape"`                  |

The main picture (a creature's portrait, a location's display picture) is the image with role `main`, else the note's only image if it has no role.

A session shows as its date and then its name, else its title unless the title is a date (`2026-10-11`, or `2026-10-11 (2)` for a second that day): `notes/2026-10-11/` with `name = "Aruun"` reads "Oct 11, 2026 · Aruun", and a link like `[[2026-10-11]]` shows the same. Without a date it shows its name or title; one with neither but a date title reads "Undated session".

A vehicle, such as a ship, has a stat block like a creature's and its floor plans as images with role `map`, shown full width under its text. It can join combats and fights as an NPC.

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
| `creature`              | title of a Creature or vehicle note (required)                 |
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

A track's file name gives its artist and title: `Artist - Title.opus`, optionally with an id, `Artist - Title [id].opus`. Without ` - `, the whole name is the title. Cover art is an image beside it with the same name, such as `Artist - Title.jpg`. Music shuffles like a playlist: every track plays once before any repeats, and switching atmospheres keeps each one's place until the server restarts. A track that cannot play is skipped; art that cannot load is left out. Audio may be opus, ogg, oga, mp3, m4a, aac, flac, or wav; opus, ogg, mp3, and flac play everywhere.

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

Operations apply to the selection, or to the cursor row when nothing is selected. A number prompt (damage, heal, initiative, and the rest) also takes arithmetic, which shows its value as you type (`27/2` deals 13), or one dice roll (`2d6+3`): Enter rolls it, applies the total (raised to the prompt's minimum, such as 0 damage), and shows each die in a toast and at the top of the dice roller's list, labeled with what it did and to whom. One roll applies to every target. Undo history is per combat and shared by every control window. It is lost on restart and when the combat is renamed. Restarting an ended combat keeps NPC damage; NPCs added later start at full.

"Go live" marks the Session being run; Ctrl+L opens its note, and a combat started while live joins it.

## Dice

`Alt+R`, or the dice button in the table bar, opens the dice roller from anywhere, even while typing. It typesets the expression as you type; without dice it is a calculator and shows the value at once. Until the input is complete it shows `…` where more is needed and says what is missing. Enter, or the Roll button, rolls and adds the result to the top of the list, with every die and the total; the text stays selected, so Enter rolls again. Up and Down recall earlier inputs, and Down past the newest brings back what you were typing. PageUp and PageDown scroll the list. Escape closes it; the rolls stay until the window reloads. They are never saved or shown to the players.

| Input            | Meaning                                                        |
| ---------------- | -------------------------------------------------------------- |
| `2d6+3`, `d20`   | dice, then `+ - * /`, parentheses, and minus                   |
| `2d20kh1`, `2d20kl1` | advantage, disadvantage: keep the highest or lowest; dropped dice are struck through |
| `4d6kh3`, `4d6k3` | keep the highest 3 of 4; `k` alone is `kh`                    |
| `5d10+(3-6)/2`   | division rounds down at each division, so `(3-6)/2` is −2      |
| `3x d20+5`, `d20+5 x3` | three separate rolls, not summed, numbered               |
| `1d20+5, 1d8+3`  | separate rolls of different expressions                        |

A leading minus negates the whole term, so `-7/2` is −3, like `0-7/2`; `(-7)/2` is −4. `x` repeats a roll and `*` multiplies, so `3x2` is an error. A term rolls at most 100 dice of at most 1000 sides, and one Enter at most 20 rolls. A d20 showing 20 is green, a 1 is red. In a rolled row, a part without dice shows its value: `5d10+(3-5)/2` reads `5d10 … − 1`.

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

Tabs work as in a browser or Obsidian. A click or Enter on a note, combat, or atmosphere shows it in the current tab, or switches to its tab if it is already open. Ctrl+click, middle-click, or Ctrl+Enter opens it in a new tab next to the current one. That works in the sidebar, the pickers (Ctrl+K, search, and the rest), wiki links in note text, the lists in a note, the problems list, the table bar, and the combat tracker, where a plain click only moves the cursor and Ctrl+click or middle-click opens the creature. The + at the end of the tab bar (it stays in view when the tabs overflow), or Ctrl+T, opens an empty tab; the next thing you open fills it. Close a tab with its ×, a middle-click, or Ctrl+W. Drag a tab along the tab bar to move it; a line shows where it lands, and Escape cancels. Ctrl+Shift+PageUp and Ctrl+Shift+PageDown move the current tab left and right. A tab you come back to is as you left it: its scroll position, the cursor and undo history in its text, a half-filled stat block form, the tracker's cursor and selection. Back, Forward, and reopening a closed tab return to where you were in it: the scroll position and the cursor in its text.

Tabs split into side-by-side groups, each with its own tab bar and current tab. Drag a tab to the left or right quarter of a group to make a new group on that side (that half tints), to the middle of another group to move it there (the whole group tints), or onto a tab bar to drop it at that place. Ctrl+\ moves the current tab into a new group on the right; Ctrl+Alt+Left and Ctrl+Alt+Right move it to the previous or next group, or into a new one at the edge. Alt+Shift+Left and Alt+Shift+Right focus the previous or next group. A click in a group focuses it; its current tab's marker shows in full, the others' are muted. Commands, Ctrl+Tab, and opening act on the focused group; opening something already open in another group switches there. A group goes when its last tab does. Moving a tab keeps it as it was, and groups survive a restart.

Each tab has its own history. The arrows at the left of the tab bar, Alt+Left and Alt+Right (also in note text), or the mouse's back and forward buttons go back and forward in the current tab. Back skips what was deleted or renamed outside the app, and what is open in another tab, in any group; close that tab to go back to it there. A new tab starts with no history. Tabs and their history survive a restart.

## Zoom

Ctrl+= (or Ctrl++), Ctrl+-, and Ctrl+0 zoom the window you press them in, from 50% to 300%. Each window remembers its own zoom; the control window and the player display never zoom together.

## Keys

Ctrl+P lists every command with its key; the palette shows only the commands that apply where focus is. Ctrl+K opens a note, combat, or atmosphere by title (it matches word starts and initials, like `cdra` or `cd` for Cinder Drake) or creates a note. With nothing typed, it lists what you showed most recently first, the current tab aside, so Ctrl+K then Enter flips between two notes. The palette, the atmosphere switcher, and the creature and condition lists put your recent choices first the same way. These lists survive a restart. Plain-letter keys never fire while typing; Escape leaves a text box so they work again. A question such as "Delete …?" takes `Y` to confirm, or `N` or Escape to cancel; Enter or Space presses the highlighted button, which starts on the safe one. While a ⋯ menu is open, only its own keys work.

| Where               | Key                       | Command                                          |
| ------------------- | ------------------------- | ------------------------------------------------ |
| Anywhere            | `Ctrl+P` / `Ctrl+K`       | command palette / open or create                 |
|                     | `Ctrl+N`                  | new note                                         |
|                     | `Ctrl+Shift+F`            | search note text                                 |
|                     | `Ctrl+B` / `Ctrl+E`       | toggle / focus the sidebar (`/` filters it)      |
|                     | `Ctrl+T` / `Ctrl+W`       | new tab / close tab                              |
|                     | `Alt+Left` / `Alt+Right`, mouse back / forward | back / forward in the tab   |
|                     | `Ctrl+Tab` / `Ctrl+Shift+Tab` | next / previous tab                          |
|                     | `Ctrl+Shift+PageUp` / `Ctrl+Shift+PageDown` | move the tab left / right      |
|                     | `Ctrl+\`                  | move the tab into a new group on the right       |
|                     | `Ctrl+Alt+Left` / `Ctrl+Alt+Right` | move the tab to the previous / next group |
|                     | `Alt+Shift+Left` / `Alt+Shift+Right` | focus the previous / next group        |
|                     | `Ctrl+=` `Ctrl+-` / `Ctrl+0` | zoom in, out / reset                          |
|                     | `Ctrl+L`                  | open the live session                            |
|                     | `Ctrl+Shift+L`            | privacy screen: hide this window until a key or click |
|                     | `Alt+R`                   | roll dice                                        |
|                     | `F2`                      | rename the note, combat, or atmosphere in the tab: puts the cursor in its title |
| Start page          | `Tab`                     | switch between Open and Join                     |
|                     | `H` / `O`                 | host a display switch / open a folder            |
|                     | `/`                       | type an address to join                          |
|                     | `Delete`                  | forget the recent Game or server                 |
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
