// The synced state tree and the socket messages.
import type { Patch } from "immer";
import type { Mutation } from "../server/mutations.ts";
import type {
	AtmosphereSettings,
	Combat,
	Config,
	Metadata,
	Runtime,
	Statblock,
} from "./schema.ts";

export type Problem = { file: string; field?: string; message: string };

/** Index entry for one note. The body is fetched from `/game/notes/<Title>/note.md`. */
export type Note = {
	metadata: Metadata;
	statblock?: Statblock;
	/** Image file names in the note directory. */
	images: string[];
	/** Changes whenever note.md changes. */
	bodyVersion: string;
	/** Titles this note's body links to, in order of first appearance. */
	links: string[];
};

/** A music file. Its name reads `Artist - Title [id].opus`; artist and id are optional. */
export type Track = {
	file: string;
	title: string;
	artist?: string;
	/** Cover art: an image beside it with the same name. */
	art?: string;
};

/** Index entry for one Atmosphere. Files are served from `/game/atmospheres/<Name>/`. */
export type Atmosphere = {
	settings: AtmosphereSettings;
	/** `wallpaper.<ext>`: a video or an image. */
	wallpaper?: string;
	/** Audio files in `music/`. */
	tracks: Track[];
};

export type GameState = {
	/** Keyed by title, which is also the directory name. */
	notes: Record<string, Note>;
	/** Keyed by name, which is also the file name. */
	combats: Record<string, Combat>;
	/** Keyed by name, which is also the directory name. */
	atmospheres: Record<string, Atmosphere>;
	runtime: Runtime;
	problems: Problem[];
	/** The user config, shared by every Game. */
	config: Config;
};

export type ClientMessage = { id: number; mutation: Mutation };

export type ServerMessage =
	| { type: "snapshot"; state: GameState }
	| { type: "patches"; patches: Patch[] }
	/** Answers one ClientMessage, after its patches. */
	| { type: "result"; id: number; error?: string }
	/** Something every client should toast, such as a finished download. */
	| { type: "notice"; message: string };

/** FNV-1a. Used as a cheap content version, not for security. */
export function hash(s: string): string {
	let h = 0x811c9dc5;
	for (let i = 0; i < s.length; i++)
		h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
	return (h >>> 0).toString(36);
}
