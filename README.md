# ttrpgui

A keyboard-driven app for planning and running tabletop RPGs. See `SPEC.md` for the design and `CLAUDE.md` for a map of the code.

It is a headless server that owns a Game directory, with web clients for the control and display views. The desktop app is Electron running the server and the control window together. The server can also run alone and serve the views to any browser on the LAN.

## Game night

1. `bun start` (inside the dev shell). It reopens the last Game; `bun start -- --game DIR` opens another, and an empty directory becomes a new Game.
2. "Go live with a session" (Ctrl+P) picks or creates the Session. Ctrl+L opens it.
3. "Open the player display" opens the second window. Drag it to the TV and press F for fullscreen. Music and wallpaper start there.
4. Open a prepared combat with Ctrl+K and press Shift+S to start it. Closing the control window quits everything.

Table state lives in the Game (`runtime.toml`), so a restart picks up the running combat, the shown image, and the music. Undo history does not survive a restart.

## Server alone

`bun run cli serve --game DIR` serves `/control` and `/display` on `localhost:7373` for any browser. `--lan` listens on every interface and prints the display URL for each LAN address; there is no auth. `--port N` picks another port. Starting a second copy on a port in use fails with an error.

In a browser tab, the browser keeps Ctrl+W, Ctrl+N, Ctrl+Tab, and Ctrl+Shift+Tab for itself; rebind those Actions (see Keys) or use the desktop app. Opening and closing the display window are desktop-app Actions; in a browser, open `/display` yourself.

## Development

This project uses Nix and direnv. Run `direnv allow`, or prefix commands with `nix develop -c`. The shell provides Bun, Node.js, Biome, Electron, Xvfb, Playwright's browsers, and `yt-dlp` and `ffmpeg` for syncing atmospheres.

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

Sync runs `yt-dlp` in the background and fetches only what is missing: the wallpaper if there is no `wallpaper.*` (delete it to fetch a new one), and tracks not yet in `music/`. The wallpaper is video only, at most 1080p, preferring VP9 WebM. Tracks are Opus audio with their thumbnail as cover art. A notice reports when it ends or why it failed; files appear as they finish. Private playlists need cookies: add `ytdlp_args = ["--cookies-from-browser", "firefox"]` to the user config (see Keys).

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

"Go live with a session" marks the Session being run; Ctrl+L opens its note, and a combat started while live joins it.

## Player display

"Open the player display" opens a second window for the players; in a browser it is `/display` on the server. Double-click it or press F for fullscreen. It shows the active atmosphere's wallpaper and a now-playing bar, one image the game master shows, and, while a combat runs, the round, whose turn it is, the next PC as "on deck", and the turn order. Players see display names and conditions, and never HP, AC, stat blocks, or notes. PCs are listed from the start; an NPC appears once it has had a turn. Music and wallpaper play only while a display is open, and sound comes only from the display. A browser may block sound until the first click, and says so.

| Key           | Command                                  | Key         | Command                 |
| ------------- | ---------------------------------------- | ----------- | ----------------------- |
| `Alt+I`       | show an image; the open note's come first | `Alt+Shift+I` | hide the image        |
| `Alt+A`       | switch atmosphere                        | `Alt+M`     | pause or resume music   |
| `Alt+N`       | skip to another track                    | `Alt+=` `Alt+-` | volume up, down     |

"New atmosphere", "Set the default atmosphere", "Sync atmosphere media", and "Set the combat's atmosphere" are in the palette. The sidebar lists atmospheres; each opens a view of its links and media.

## Keys

Ctrl+P lists every command with its key; the palette shows only the commands that apply where focus is. Ctrl+K opens a note, combat, or atmosphere by title (it matches word starts and initials, like `cdra` or `cd` for Cinder Drake) or creates a note. Plain-letter keys never fire while typing; Escape leaves a text box so they work again.

| Where               | Key                       | Command                                          |
| ------------------- | ------------------------- | ------------------------------------------------ |
| Anywhere            | `Ctrl+P` / `Ctrl+K`       | command palette / open or create                 |
|                     | `Ctrl+N`                  | new note                                         |
|                     | `Ctrl+Shift+F`            | search note text                                 |
|                     | `Ctrl+B` / `Ctrl+E`       | toggle / focus the sidebar (`/` filters it)      |
|                     | `Ctrl+W`                  | close tab                                        |
|                     | `Ctrl+Tab` / `Ctrl+Shift+Tab` | next / previous tab                          |
|                     | `Ctrl+L`                  | open the live session                            |
|                     | `F2`                      | rename the note, combat, or atmosphere in the tab |
| Lists               | `j` `k` `g` `G`, arrows   | move                                             |
|                     | `Enter` / `Ctrl+Enter`    | open / open in a new tab                         |
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

## License

Licensed under either of Apache License, Version 2.0 or MIT license at your option.
