// Reads, validates, and writes the Game directory. Validation and loading are the same code.
import type { Dirent } from "node:fs";
import { readdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { parse, type TomlError } from "smol-toml";
import type { z } from "zod";
import { audioFile, parseTracks, videoFile } from "../shared/display.ts";
import { imageFile, linkTargets } from "../shared/notes.ts";
import {
	AtmosphereSettings,
	Combat,
	Config,
	type Kind,
	Metadata,
	Runtime,
	Statblock,
} from "../shared/schema.ts";
import {
	type Atmosphere,
	type GameState,
	hash,
	type Note,
	type Problem,
} from "../shared/state.ts";

const noteFiles = new Set(["note.md", "metadata.toml", "statblock.toml"]);

const topEntries = new Set(["notes", "combats", "atmospheres", "runtime.toml"]);

/** Loads the whole Game. Bad data never throws: it is ignored and reported in `problems`. */
export async function loadGame(
	dir: string,
): Promise<Omit<GameState, "config">> {
	const problems: Problem[] = [];
	const notes: GameState["notes"] = {};
	const combats: GameState["combats"] = {};
	const atmospheres: GameState["atmospheres"] = {};
	const top = await list(dir);
	if (!top)
		return {
			notes,
			combats,
			atmospheres,
			runtime: {},
			problems: [{ file: dir, message: "Game directory does not exist" }],
		};
	for (const entry of top) {
		if (!topEntries.has(entry.name))
			problems.push({
				file: entry.name,
				message:
					"unexpected entry; a Game holds notes/, combats/, atmospheres/, and runtime.toml",
			});
	}
	const noteDirs = await list(join(dir, "notes"));
	if (!noteDirs)
		problems.push({ file: "notes", message: "missing notes directory" });
	for (const entry of noteDirs ?? []) {
		const rel = `notes/${entry.name}`;
		if (entry.isDirectory())
			notes[entry.name] = await loadNote(dir, rel, problems);
		else
			problems.push({
				file: rel,
				message: "unexpected file; each note is a directory",
			});
	}
	for (const entry of (await list(join(dir, "combats"))) ?? []) {
		const file = `combats/${entry.name}`;
		const name = entry.name.match(/^(.+)\.toml$/)?.[1];
		if (!entry.isFile() || !name) {
			problems.push({
				file,
				message: "unexpected entry; combats/ holds <Name>.toml files",
			});
			continue;
		}
		const combat = await readToml(dir, file, Combat, problems);
		if (combat) combats[name] = combat;
	}
	for (const entry of (await list(join(dir, "atmospheres"))) ?? []) {
		const rel = `atmospheres/${entry.name}`;
		if (entry.isDirectory())
			atmospheres[entry.name] = await loadAtmosphere(dir, rel, problems);
		else
			problems.push({
				file: rel,
				message: "unexpected file; each atmosphere is a directory",
			});
	}
	const runtime =
		(await readToml(dir, "runtime.toml", Runtime, problems)) ?? {};
	const game = { notes, combats, atmospheres, runtime };
	// A file that loaded only in part reports just its own problems, as if it were skipped.
	const partial = new Set(problems.map((p) => p.file));
	const references: Problem[] = [];
	checkReferences(game, references);
	problems.push(...references.filter((p) => !partial.has(p.file)));
	return { ...game, problems };
}

async function loadAtmosphere(
	dir: string,
	rel: string,
	problems: Problem[],
): Promise<Atmosphere> {
	const wallpapers: string[] = [];
	let music: string[] = [];
	for (const entry of (await list(join(dir, rel))) ?? []) {
		const { name } = entry;
		if (entry.isDirectory() && name === "music")
			music = await loadMusic(dir, `${rel}/music`, problems);
		else if (/^wallpaper\./.test(name) && isMedia(name, videoFile))
			wallpapers.push(name);
		else if (!(entry.isFile() && name === "atmosphere.toml"))
			problems.push({
				file: `${rel}/${name}`,
				message:
					"unexpected entry; an atmosphere holds atmosphere.toml, a wallpaper.<ext> video or image, and music/",
			});
	}
	if (wallpapers.length > 1)
		problems.push({ file: rel, message: "more than one wallpaper file" });
	const settings =
		(await readToml(
			dir,
			`${rel}/atmosphere.toml`,
			AtmosphereSettings,
			problems,
		)) ?? {};
	return {
		settings,
		...(wallpapers[0] && { wallpaper: wallpapers[0] }),
		tracks: parseTracks(music),
	};
}

/** File names in `music/`: audio files and their cover art. */
async function loadMusic(dir: string, rel: string, problems: Problem[]) {
	const files: string[] = [];
	for (const entry of (await list(join(dir, rel))) ?? []) {
		if (entry.isFile() && isMedia(entry.name, audioFile))
			files.push(entry.name);
		else
			problems.push({
				file: `${rel}/${entry.name}`,
				message: "unexpected entry; music/ holds audio files and cover art",
			});
	}
	return files;
}

const isMedia = (name: string, kind: RegExp) =>
	kind.test(name) || imageFile.test(name);

/** Reports references to missing things, or to notes of the wrong kind. What refers to them loads anyway. */
function checkReferences(
	{
		notes,
		combats,
		atmospheres,
		runtime,
	}: Omit<GameState, "config" | "problems">,
	problems: Problem[],
) {
	const expectAtmosphere = (file: string, key: string, name?: string) => {
		if (name !== undefined && !Object.hasOwn(atmospheres, name))
			problems.push({
				file,
				field: key,
				message: `no atmosphere named “${name}”`,
			});
	};
	const expect = (file: string, path: string[], title: string, kind: Kind) => {
		if (notes[title]?.metadata.kind !== kind)
			problems.push({
				file,
				field: field(path),
				message: `no ${kind} note titled “${title}”`,
			});
	};
	for (const [name, combat] of Object.entries(combats)) {
		const file = `combats/${name}.toml`;
		if (combat.session) expect(file, ["session"], combat.session, "session");
		expectAtmosphere(file, "atmosphere", combat.atmosphere);
		const combatants = combat.combatants ?? {};
		if (combat.turn !== undefined && !combatants[combat.turn])
			problems.push({
				file,
				field: "turn",
				message: `no combatant labeled “${combat.turn}”`,
			});
		for (const [label, c] of Object.entries(combatants)) {
			const at = ["combatants", label];
			expect(file, [...at, "creature"], c.creature, "creature");
			const metadata = notes[c.creature]?.metadata;
			if (c.hp && metadata?.kind === "creature" && metadata.pc)
				problems.push({
					file,
					field: field([...at, "hp"]),
					message: "a PC's HP lives in its metadata.toml",
				});
		}
	}
	if (runtime.session)
		expect("runtime.toml", ["session"], runtime.session, "session");
	if (runtime.combat && !combats[runtime.combat])
		problems.push({
			file: "runtime.toml",
			field: "combat",
			message: `no combat named “${runtime.combat}”`,
		});
	expectAtmosphere("runtime.toml", "atmosphere", runtime.atmosphere);
	expectAtmosphere(
		"runtime.toml",
		"restore_atmosphere",
		runtime.restore_atmosphere,
	);
	if (runtime.image) {
		const [title = "", file] = runtime.image.split("/");
		const images = Object.hasOwn(notes, title) ? notes[title]?.images : [];
		if (!file || !images?.includes(file))
			problems.push({
				file: "runtime.toml",
				field: "image",
				message: `no image “${runtime.image}”; expected "<Note title>/<file>"`,
			});
	}
	const defaults = Object.keys(atmospheres).filter(
		(name) => atmospheres[name]?.settings.default,
	);
	for (const name of defaults.slice(1))
		problems.push({
			file: `atmospheres/${name}/atmosphere.toml`,
			field: "default",
			message: `“${defaults[0]}” is already the default atmosphere`,
		});
}

async function loadNote(
	dir: string,
	rel: string,
	problems: Problem[],
): Promise<Note> {
	const images: string[] = [];
	for (const entry of (await list(join(dir, rel))) ?? []) {
		if (entry.isFile() && imageFile.test(entry.name)) images.push(entry.name);
		else if (!entry.isFile() || !noteFiles.has(entry.name)) {
			problems.push({
				file: `${rel}/${entry.name}`,
				message:
					"unexpected entry; a note holds note.md, metadata.toml, statblock.toml, and images",
			});
		}
	}
	const body = await read(join(dir, rel, "note.md"));
	if (body === undefined)
		problems.push({ file: `${rel}/note.md`, message: "missing" });

	const metadataFile = `${rel}/metadata.toml`;
	const metadata =
		(await readToml(dir, metadataFile, Metadata, problems)) ?? {};
	const partial = problems.some((p) => p.file === metadataFile);
	const roles = partial ? [] : Object.entries(metadata.images ?? {});
	for (const [image] of roles) {
		if (!images.includes(image)) {
			problems.push({
				file: metadataFile,
				field: field(["images", image]),
				message: "no such image in this note",
			});
		}
	}
	if (roles.filter(([, role]) => role === "main").length > 1) {
		problems.push({
			file: metadataFile,
			field: "images",
			message: "only one image may be main",
		});
	}

	const statblock = await readToml(
		dir,
		`${rel}/statblock.toml`,
		Statblock,
		problems,
	);
	return {
		metadata,
		...(statblock && { statblock }),
		images,
		bodyVersion: hash(body ?? ""),
		links: linkTargets(body ?? ""),
	};
}

export type SearchHit = {
	title: string;
	line: number;
	column: number;
	/** The matching line, cut to start shortly before the match. */
	text: string;
};

/** Lines of note bodies that contain `query`, ignoring case. */
export async function searchNotes(
	dir: string,
	titles: string[],
	query: string,
): Promise<SearchHit[]> {
	const needle = query.trim().toLowerCase();
	const hits: SearchHit[] = [];
	if (!needle) return hits;
	for (const title of titles) {
		const body = (await read(join(dir, "notes", title, "note.md"))) ?? "";
		for (const [line, text] of body.split("\n").entries()) {
			const column = text.toLowerCase().indexOf(needle);
			if (column < 0) continue;
			const start = Math.max(0, column - 30);
			const cut = (start ? "…" : "") + text.slice(start).trim();
			hits.push({ title, line, column, text: cut });
			if (hits.length === 50) return hits;
		}
	}
	return hits;
}

/** Loads the user config. Problems in it are reported like Game problems, with the absolute path. */
export async function loadConfig(file: string) {
	const problems: Problem[] = [];
	const config = (await readToml("", file, Config, problems)) ?? {};
	return { config, problems };
}

async function readToml<T>(
	dir: string,
	file: string,
	schema: z.ZodType<T>,
	problems: Problem[],
) {
	const text = await read(join(dir, file));
	if (text === undefined) return;
	let data: unknown;
	try {
		data = parse(text);
	} catch (e) {
		const { line, column, message } = e as TomlError;
		const reason = message
			.split("\n")[0]
			?.replace("Invalid TOML document: ", "");
		problems.push({
			file,
			message: `invalid TOML at line ${line}, column ${column}: ${reason}`,
		});
		return;
	}
	return validate(schema, data, file, problems) ?? recover(schema, data);
}

/**
 * The valid part of `data`, or undefined. Drops each unknown key and bad value, or the table or array item
 * missing a required field, then checks again, since a fix can reveal more (an invalid `kind`, say).
 */
function recover<T>(schema: z.ZodType<T>, data: unknown) {
	for (let round = 0; round < 5; round++) {
		const result = schema.safeParse(data);
		if (result.success) return result.data;
		const targets = result.error.issues
			.flatMap((issue) =>
				issue.code === "unrecognized_keys"
					? issue.keys.map((key) => [...issue.path, key])
					: [issue.path],
			)
			.map((path) => (at(data, path) === undefined ? path.slice(0, -1) : path));
		const arrays = new Set<unknown[]>();
		for (const path of targets) {
			const [key, parent] = [path.at(-1), at(data, path.slice(0, -1))];
			if (key === undefined) return;
			if (typeof parent !== "object" || parent === null) continue;
			delete (parent as Record<PropertyKey, unknown>)[key];
			if (Array.isArray(parent)) arrays.add(parent);
		}
		// Deleting leaves holes, which filter skips. Indices stay put until every target is gone.
		for (const a of arrays) a.splice(0, a.length, ...a.filter(() => true));
	}
}

const at = (data: unknown, path: PropertyKey[]) =>
	path.reduce<unknown>(
		(o, k) => (o as Record<PropertyKey, unknown> | undefined)?.[k],
		data,
	);

/** Checks `data` against `schema`, reporting each issue in `problems`. */
export function validate<T>(
	schema: z.ZodType<T>,
	data: unknown,
	file: string,
	problems: Problem[],
) {
	const result = schema.safeParse(data, {
		error: (issue) => (issue.input === undefined ? "missing" : undefined),
	});
	if (result.success) return result.data;
	for (const issue of result.error.issues) {
		if (issue.code === "unrecognized_keys") {
			for (const key of issue.keys)
				problems.push({
					file,
					field: field([...issue.path, key]),
					message: "unknown field",
				});
		} else {
			problems.push({
				file,
				...(issue.path.length && { field: field(issue.path) }),
				message: issue.message,
			});
		}
	}
}

/** Formats a path the way it reads in TOML: `sections[1].entries[0].name`, `images."map.png"`. */
function field(path: PropertyKey[]) {
	return path
		.map((p) =>
			typeof p === "number"
				? `[${p}]`
				: /^[\w-]+$/.test(String(p))
					? `.${String(p)}`
					: `.${JSON.stringify(p)}`,
		)
		.join("")
		.slice(1);
}

/** Directory entries without dotfiles, sorted, or undefined if the directory is missing. */
async function list(dir: string): Promise<Dirent[] | undefined> {
	const entries = await readdir(dir, { withFileTypes: true }).catch(ifMissing);
	return entries
		?.filter((e) => !e.name.startsWith("."))
		.sort((a, b) => a.name.localeCompare(b.name));
}

export const read = (file: string) => readFile(file, "utf8").catch(ifMissing);

function ifMissing(e: NodeJS.ErrnoException): undefined {
	if (e.code !== "ENOENT") throw e;
}

export async function writeAtomic(file: string, data: string) {
	const temp = join(dirname(file), `.${basename(file)}.tmp`);
	await writeFile(temp, data);
	await rename(temp, file);
}

/**
 * Edits `draft` (an Immer draft of `base`) until it deep-equals `fresh`, assigning only what differs.
 * Immer then emits patches for real changes only, so reloading files we just wrote is a no-op.
 */
export function reconcile(
	draft: Record<string, unknown>,
	base: Record<string, unknown>,
	fresh: Record<string, unknown>,
) {
	for (const key of Object.keys(base)) if (!(key in fresh)) delete draft[key];
	for (const [key, value] of Object.entries(fresh)) {
		if (isDeepStrictEqual(base[key], value)) continue;
		if (isRecord(base[key]) && isRecord(value))
			reconcile(draft[key] as Record<string, unknown>, base[key], value);
		else draft[key] = value;
	}
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);
