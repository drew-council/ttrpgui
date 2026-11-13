# `ttrpgui` Specification

This application is a keyboard-driven application for planning and running TTRPGs.

It should have nice ctrl+k navigation where i can quickly search to pull things up. There should also be a similarly implemented "command palette" where i can invoke `Action`s. These actions should also be set with keybinds, probably set in some user config.

> For this spec, things wrapped in backticks are things I'm expecting in the data model.

At the core is a single `Game` which is a directory holding a collection of files that are all owned by the application.

## Notetaking

For `Note`s, the application owns a collection of markdown files. These files work similarly to LogSeq or Obsidian and have similar editing style, where pages are allowed to link to each other.
Each page is its own directory with a markdown file in it for the text contents. These pages also have adjacent TOML sidecars storing metadata about the `Note`. There can also be pictures in the directory specific to that `Note`.

There are multiple kinds of `Note` that are handled differently. However, these really work more like "filters" or "tags" than true separate categories. In the `Note`s views, they are rendered mostly the same. The kind mostly impacts how they might integrate into other parts of the application.

> I expect that some library or codebase already implements 90% of what we want here, so you should take on whatever library makes sense to facilitate this.

### Session

A `Session`'s doc holds all the data for a given `Session`. It has references to each combat run (see combat section). It has general `Note`s specific to that date when the `Session` was run.

### Creature

Every `Creature` in the game has a doc. These include party PCs, NPCs, etc. (probably a "kind" field in the metadata somewhere)

Critically, `Creature` also have full stat blocks. These should be roughly modeled after what D&D uses, and we can tweak down the line to make work in other systems as-needed. Should be easy to read an external stat block and fill out one for a `Creature`. Needs to acommadate things like actions, features, etc. so it can help the DM quickly see what options are avail.

Creature `Note`s document details about that `Creature`. There's also a standardized `Location` for the picture for a `Creature`.

### Location

Locations also get `Note`s. There's a `Location` for the main "display" picture, and there may be more adjacent pictures that can be viewed potentially in some way (unclear atm).
Good to distingusish "map" from "landscape" pictures. maps are actual grids for playing on, but often times we also have landscape renderings of the `Location`.

### Other `Note` kinds?

Currently unclear, none come to mind as of yet. May expand in the future.

## Combat

See my project ~/personal/ttrpgtui/ , that is effectively how i want this to roughly work. However, that application doesn't have nice interactivity with the mouse and such. Also, it should properly interlink where each `Creature` in the combat is actually referencing a `Creature`'s statblock from their page. We want to avoid storing duplicate data here.

There should also be a button to automatically roll initiative for all non-PC players (a feature i've wanted when using `ttrpgtui`).

Probably also makes sense to associate a `Combat` optionally to an `Atmosphere` that gets started when combat does.

## Display

All of what was previously described lives on the main window. Optionally, a second window should be possible to open from the application for use as a display to the players.

There should be some way, for a given `Game`, to specify certain `Atmosphere`s. Each of these should have some kind of animated wallpaper that gets displayed. There is always some `Atmosphere` active while a game is active.
> Not sure where these animated backgrounds will be sourced from... Maybe YouTube videos? For that case, could possibly just use `yt-dlp` to download the videos fully so we don't have to stream constantly each time.

I also would like to have music playing. I subscribe to YouTube Premium and want to use YouTube Music for streaming of music ideally. Each `Atmosphere` should have an associated YouTube Music `Playlist` that shuffle-plays while that atmosphere is live. The bottom of the screen should have a nice "now playing" kind of display for the players.
> May also make sense to use `yt-dlp` for this? See what libraries/bindings exist, idk

Then, there should be a way to show/hide images from the `Note`s.

# Testing Setup

We need a way to instrument running both of the windows in an accessible way for an agent to go through and validate the various features. Should be fairly intuitive for an electron app, I'm sure this has been done before.

# Architecture

The application is a headless server with clients.

- The server owns the `Game` directory and all shared state. It MUST run without any window.
- The control window and the display window are clients. They connect over a socket and receive updates as they happen.
- State sync SHOULD use an existing library.
- One launch starts the server and the control window together. The same program MUST be able to start the server alone.
- The server listens on localhost by default. A launch option opens it to the LAN. Auth is never a concern.
- v1 assumes one control client and one display client. Later, control and display MAY be separate LAN devices, and player devices MAY become clients.
- Shared state: `Game` data, live `Session`, active `Atmosphere`, running `Combat`, shown image, combat undo history.
- Per-client state: cursor, selection, open tabs.
- Audio plays from the display client only.

# Decisions

Settled in the design interview. Where this section and the text above differ, this section wins.

## General

- The code MUST stay simple. A 90% solution in a tenth of the code is preferred.
- React and TypeScript.
- One `Game` is open at a time. The app reopens the last one. Switching is a full reload and is rare.
- Keybinds live in one user-level config file. Most `Action`s have no bind. Every `Action` appears in the command palette.
- Lists use `j`/`k`. The `ttrpgtui` binds carry over: `g`/`G`, `Space` multi-select, `+`/`-` HP, `i` initiative, `n` new, `r` rename, `d` description, `u`/`Ctrl+R` undo and redo.
- All text editing MUST reuse one markdown text box. Modal editing is deferred.
- The control window often runs on a small screen (about 1280x800). The display usually runs on a 16:9 TV. These are considerations, not hard targets. Touch is not used.

## Notes

- Obsidian-style: free-form markdown, live preview, `[[wiki links]]`. Use an existing library.
- All notes sit in one flat directory. Each note is a directory holding `note.md`, `metadata.toml`, an optional `statblock.toml`, and its images.
- Titles are unique. Links resolve by title.
- A `Note` has zero or one kind: `Session`, `Creature`, `Location`.
- The control window has tabs and a collapsible sidebar. The sidebar lists notes grouped by kind, and combats, with a filter box.
- Ctrl+K fuzzy-matches titles of notes and combats. A missing title can be created as a plain note.
- Full-text search is a separate `Action`.
- `Action`s create a note of a given kind and change a note's kind.
- Renaming rewrites every link to the note. Deleting asks for confirmation and leaves broken links. Each note lists its backlinks. No graph view.
- A `Creature` note shows its portrait and stat block beside the text. A `Location` note shows its main picture. A `Session` note shows its date and its combats.
- Images are pasted or dropped into a note, or placed in its directory. An image role is main, map, landscape, or none. A note's only image is its main picture.
- Outside changes to any file MUST show in the app immediately. Files on disk are the truth.

## Validation

- The program's CLI MUST validate a `Game` and report every violation with file, field, and problem.
- The app MUST use the same checks. It skips bad data and stays operational.
- The app shows a toast when a problem appears and keeps a problems list.

## Creatures

- A `Creature` is a PC or an NPC. This does not constrain stat block shape.
- A `Creature` MAY have a display name, which is what players see.
- Every stat block field is optional. Known fields: AC, HP, speed, abilities, saves, skills, resistances and immunities, senses, languages, CR, initiative bonus, legendary action count, legendary resistance count.
- All other content is an ordered list of freely named sections. Each holds entries of a name plus markdown text.
- The layout is neutral between 5e 2014 and 2024.
- Initiative is the only thing the app rolls. No spell slot tracking in v1.
- No stat block import in v1. D&D Beyond import is a future feature.

## Combat

- A `Combatant` references a `Creature`. Many `Combatant`s MAY share one `Creature`.
- Adding an unknown name creates a stub NPC `Creature`. Adding with a count creates "Goblin A", "Goblin B".
- A `Combatant` owns its label, current HP, temp HP, max HP adjustment, initiative, conditions, counters, and note. Base max HP and AC come from the `Creature`.
- Every new `Combat` starts with all PCs in it.
- PCs carry current HP, temp HP, and max HP adjustment between combats. A "party rest" `Action` restores them. NPCs start at full. This area needs a future pass.
- A `Combat` has a name, its `Combatant`s, an optional `Session`, and an optional `Atmosphere`. The `Combat` links to the `Session`, not the reverse.
- A `Combat` MAY be free-floating. A `Combat` started in live mode attaches to the live `Session`.
- Start and End are explicit `Action`s. Start switches to the `Combat`'s `Atmosphere`. End restores the earlier one. One `Combat` runs at a time. An ended `Combat` MAY be started again.
- The tracker marks the active `Combatant`. A next-turn `Action` advances it. Wrapping adds one to the round counter.
- A roll `Action` rolls d20 plus initiative bonus once per `Creature`, only for NPCs with no initiative. PC initiative is typed. Ties sort by bonus, then name.
- Conditions come from the standard list or free text. An optional round count ticks down at the end of that `Combatant`'s turn and drops the condition at zero.
- Temp HP absorbs damage first. A new value replaces the old one.
- Concentration is a toggle. Damage to a concentrating `Combatant` shows the save DC.
- PCs at 0 HP get death save pips. NPCs at 0 HP show as down.
- Legendary counters appear when the stat block defines them. Legendary actions refill at the start of that creature's turn.
- `Combatant`s can be removed. Undo and redo cover combat edits.
- The control view shows the tracker on the left and the stat block of the `Combatant` under the cursor on the right. One key opens that `Creature`'s note.

## Live mode

- "Go live" picks the `Session` being run. "End session" leaves live mode.
- While live, the `Session` note is one key away.
- Live mode SHOULD change little else for now.

## Display

- An `Action` opens the display window in either mode. It is closed by default.
- Wallpaper and music play only while the display is open.
- The display shows the wallpaper, a now-playing bar, one inset image, and the combat tracker while a `Combat` runs.
- The player tracker shows the round, the active `Combatant` with portrait, and the next PC as "on deck".
- PCs are listed from the start. An NPC appears in its slot after its first turn.
- Players see display names and conditions. They MUST NOT see HP, AC, or stat blocks.
- A show-image `Action` opens a fuzzy picker over every image, matched by note title, then file name. A hide `Action` clears it.
- No grid, tokens, or fog of war.

## Atmosphere

- Atmospheres are TOML files in the `Game`. Each has a name, a wallpaper, and music.
- A wallpaper is a YouTube link, downloaded once and looped muted, or a local video or still image.
- Music is a YouTube Music playlist downloaded with `yt-dlp`, or a folder of local files. It shuffles.
- Each `Game` has one default `Atmosphere`. An `Action` switches the active one.
- `Action`s sync a playlist, pause, skip, and set volume.

