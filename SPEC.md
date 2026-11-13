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

