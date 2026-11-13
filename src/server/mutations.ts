// Mutations are the only way clients change the Game. Each one edits files; the server then reloads,
// so state always follows disk. Throwing rejects the mutation. Adding a function adds a mutation.
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { stringify } from "smol-toml";
import type { z } from "zod";
import * as combats from "../shared/combat.ts";
import { hpOf, isPc, type Rule, rules } from "../shared/combat.ts";
import * as display from "../shared/display.ts";
import { imageFile, localDate, renameLinks } from "../shared/notes.ts";
import {
	AtmosphereSettings,
	type Combat,
	type ImageRole,
	type Kind,
	Metadata,
	Runtime,
	Statblock,
} from "../shared/schema.ts";
import type { GameState, Problem } from "../shared/state.ts";
import { download, downloading } from "./download.ts";
import { read, validate, writeAtomic } from "./game.ts";

/** Relative path to contents; undefined means no file. */
type Files = Record<string, string | undefined>;

/** Undo and redo stacks per Combat, in memory only. Each entry holds what an edit's files held before it. */
export type History = Map<string, { undo: Files[]; redo: Files[] }>;

type Game = {
	dir: string;
	state: GameState;
	history: History;
	/** Toasts `message` on every client. */
	notify: (message: string) => void;
};

const mutations = {
	async createNote(
		{ dir, state }: Game,
		{ title, kind }: { title: string; kind?: Kind },
	) {
		title = newTitle(state.notes, title);
		const metadata = valid(Metadata, {
			kind,
			...(kind === "session" && { date: localDate() }),
		});
		const noteDir = join(dir, "notes", title);
		await mkdir(noteDir);
		await writeFile(join(noteDir, "note.md"), "");
		await writeToml(join(noteDir, "metadata.toml"), metadata);
	},

	/** Renames a note, rewriting links to it and references from combats and runtime.toml. */
	async renameNote(game: Game, { from, to }: { from: string; to: string }) {
		const { dir, state } = game;
		existing(state.notes, from);
		to = newTitle(state.notes, to);
		await rename(join(dir, "notes", from), join(dir, "notes", to));
		for (const title of Object.keys(state.notes)) {
			const file = join(dir, "notes", title === from ? to : title, "note.md");
			const body = await read(file);
			if (body === undefined) continue;
			const next = renameLinks(body, from, to);
			if (next !== body) await writeAtomic(file, next);
		}
		const moved = (title: string) => (title === from ? to : title);
		await editCombats(game, (combat) => ({
			...combat,
			session: combat.session && moved(combat.session),
			combatants: Object.fromEntries(
				Object.entries(combat.combatants ?? {}).map(([label, c]) => [
					label,
					{ ...c, creature: moved(c.creature) },
				]),
			),
		}));
		const { session, image } = state.runtime;
		await setRuntime(game, {
			session: session && moved(session),
			image: image?.replace(/^[^/]+/, moved),
		});
	},

	async deleteNote(game: Game, { title }: { title: string }) {
		existing(game.state.notes, title);
		await rm(join(game.dir, "notes", title), { recursive: true });
		if (game.state.runtime.image?.startsWith(`${title}/`))
			await setRuntime(game, { image: undefined });
	},

	setKind(game: Game, { title, kind }: { title: string; kind?: Kind }) {
		// Kind-specific fields such as `pc` or `date` do not carry over.
		return editMetadata(game, title, ({ images }) => ({ kind, images }));
	},

	/** Sets or, with null, clears metadata fields such as `pc`, `display_name`, or `date`. */
	setMetadata(
		game: Game,
		{ title, fields }: { title: string; fields: Record<string, unknown> },
	) {
		return editMetadata(game, title, (metadata) => merge(metadata, fields));
	},

	/** Replaces statblock.toml, or removes it when empty. */
	saveStatblock(
		game: Game,
		{ title, statblock }: { title: string; statblock: Statblock },
	) {
		existing(game.state.notes, title);
		return saveToml(
			game,
			`notes/${title}/statblock.toml`,
			Statblock,
			statblock,
		);
	},

	async saveNote(
		{ dir, state }: Game,
		{ title, body }: { title: string; body: string },
	) {
		existing(state.notes, title);
		await writeAtomic(join(dir, "notes", title, "note.md"), body);
	},

	/** Stores an image in the note directory. `data` is base64. */
	async addImage(
		{ dir, state }: Game,
		{ title, name, data }: { title: string; name: string; data: string },
	) {
		const { images } = existing(state.notes, title);
		if (!/^\w[\w.-]*$/.test(name) || !imageFile.test(name))
			throw new Error(`“${name}” is not a valid image file name`);
		if (images.includes(name))
			throw new Error(`“${title}” already has an image named “${name}”`);
		await writeFile(
			join(dir, "notes", title, name),
			Buffer.from(data, "base64"),
		);
	},

	/** Sets an image's role. A new main image demotes the old one. */
	setImageRole(
		game: Game,
		{ title, image, role }: { title: string; image: string; role?: ImageRole },
	) {
		if (!existing(game.state.notes, title).images.includes(image))
			throw new Error(`“${title}” has no image named “${image}”`);
		return editMetadata(game, title, (metadata) => {
			const images = Object.fromEntries(
				Object.entries(metadata.images ?? {}).filter(
					([name, r]) => name !== image && !(role === "main" && r === "main"),
				),
			);
			if (role) images[image] = role;
			return {
				...metadata,
				images: Object.keys(images).length ? images : undefined,
			};
		});
	},

	/** A new Combat starts with every PC in it. */
	async createCombat({ dir, state }: Game, { name }: { name: string }) {
		name = newTitle(state.combats, name, "combat");
		const pcs = Object.keys(state.notes).filter((title) =>
			isPc(state.notes, { creature: title }),
		);
		await mkdir(join(dir, "combats"), { recursive: true });
		await writeAtomic(
			join(dir, combatFile(name)),
			combatToml({
				combatants: Object.fromEntries(pcs.map((t) => [t, { creature: t }])),
			}),
		);
	},

	async renameCombat(game: Game, { from, to }: { from: string; to: string }) {
		const { dir, state, history } = game;
		existing(state.combats, from, "combat");
		to = newTitle(state.combats, to, "combat");
		await rename(join(dir, combatFile(from)), join(dir, combatFile(to)));
		// Its history names files under the old name.
		history.delete(from);
		if (state.runtime.combat === from) await setRuntime(game, { combat: to });
	},

	async deleteCombat(game: Game, { name }: { name: string }) {
		existing(game.state.combats, name, "combat");
		await rm(join(game.dir, combatFile(name)));
		game.history.delete(name);
		if (game.state.runtime.combat === name)
			await editRuntime(game, (runtime) => {
				delete runtime.combat;
				display.leaveCombat(runtime, game.state.atmospheres);
			});
	},

	addCombatants: onCombat<{ creature: string; count: number }>(
		(combat, payload, { notes }) => {
			expectKind(notes, payload.creature, "creature");
			combats.addCombatants(combat, payload);
		},
	),
	removeCombatants: onCombat<{ labels: string[] }>((combat, p, { notes }) =>
		combats.removeCombatants(combat, notes, p.labels),
	),
	renameCombatant: onCombat<{ label: string; to: string }>((combat, p) =>
		combats.renameCombatant(combat, p.label, p.to),
	),
	rollInitiative: onCombat((combat, _, { notes }) =>
		combats.rollInitiative(combat, notes, Math.random),
	),
	nextTurn: onCombat((combat, _, { notes }) => combats.nextTurn(combat, notes)),
	setCombatSession: onCombat<{ session?: string }>(
		(combat, { session }, { notes }) => {
			if (session) expectKind(notes, session, "session");
			combat.session = session;
		},
	),
	setCombatAtmosphere: onCombat<{ atmosphere?: string }>(
		(combat, { atmosphere }, state) => {
			if (atmosphere) existing(state.atmospheres, atmosphere, "atmosphere");
			combat.atmosphere = atmosphere;
		},
	),
	/**
	 * One Combat runs at a time. Started while live, it joins the live Session unless it has one.
	 * It switches to its Atmosphere, and End switches back.
	 */
	startCombat: onCombat((combat, payload, state, runtime) => {
		if (runtime.combat && runtime.combat !== payload.combat)
			throw new Error(`End “${runtime.combat}” first`);
		combats.start(combat, state.notes);
		if (runtime.combat !== payload.combat)
			display.enterCombat(runtime, state.atmospheres, combat);
		runtime.combat = payload.combat;
		combat.session ??= runtime.session;
	}),
	endCombat: onCombat((combat, payload, state, runtime) => {
		combats.end(combat);
		if (runtime.combat !== payload.combat) return;
		delete runtime.combat;
		display.leaveCombat(runtime, state.atmospheres);
	}),
	damage: onCombatants(rules.damage),
	heal: onCombatants(rules.heal),
	setTempHp: onCombatants(rules.setTempHp),
	setMaxAdjust: onCombatants(rules.setMaxAdjust),
	setInitiative: onCombatants(rules.setInitiative),
	addCondition: onCombatants(rules.addCondition),
	removeCondition: onCombatants(rules.removeCondition),
	toggleConcentration: onCombatants(rules.toggleConcentration),
	deathSave: onCombatants(rules.deathSave),
	spendLegendary: onCombatants(rules.spendLegendary),
	setCombatantNote: onCombatants(rules.setNote),

	undo: (game: Game, { combat }: { combat: string }) =>
		step(game, combat, "undo", "redo"),
	redo: (game: Game, { combat }: { combat: string }) =>
		step(game, combat, "redo", "undo"),

	goLive(game: Game, { session }: { session: string }) {
		expectKind(game.state.notes, session, "session");
		return setRuntime(game, { session });
	},
	endSession: (game: Game, _: unknown) =>
		setRuntime(game, { session: undefined }),

	/** The first Atmosphere becomes the default. */
	async createAtmosphere({ dir, state }: Game, { name }: { name: string }) {
		name = newTitle(state.atmospheres, name, "atmosphere");
		await mkdir(join(dir, atmosphereDir(name), "music"), { recursive: true });
		if (!Object.values(state.atmospheres).some((a) => a.settings.default))
			await writeToml(join(dir, atmosphereDir(name), "atmosphere.toml"), {
				default: true,
			});
	},

	async renameAtmosphere(
		game: Game,
		{ from, to }: { from: string; to: string },
	) {
		idle(game, from);
		to = newTitle(game.state.atmospheres, to, "atmosphere");
		const { dir } = game;
		await rename(join(dir, atmosphereDir(from)), join(dir, atmosphereDir(to)));
		await moveAtmosphereReferences(game, from, to);
	},

	async deleteAtmosphere(game: Game, { name }: { name: string }) {
		idle(game, name);
		await rm(join(game.dir, atmosphereDir(name)), { recursive: true });
		await moveAtmosphereReferences(game, name, undefined);
	},

	/** Sets or, with null, clears fields of atmosphere.toml, such as `wallpaper` or `music`. */
	setAtmosphere: (
		game: Game,
		{ name, fields }: { name: string; fields: Record<string, unknown> },
	) => editAtmosphere(game, name, fields),

	async setDefaultAtmosphere(game: Game, { name }: { name: string }) {
		existing(game.state.atmospheres, name, "atmosphere");
		for (const [other, { settings }] of Object.entries(game.state.atmospheres))
			if (other === name ? !settings.default : settings.default)
				await editAtmosphere(game, other, { default: other === name || null });
	},

	switchAtmosphere(game: Game, { name }: { name: string }) {
		existing(game.state.atmospheres, name, "atmosphere");
		return editRuntime(game, (runtime) =>
			display.switchAtmosphere(runtime, game.state.atmospheres, name),
		);
	},

	/** Starts downloading an Atmosphere's links and returns at once. Notices report how it ends. */
	syncAtmosphere(game: Game, { name }: { name: string }) {
		const atmosphere = idle(game, name);
		if (!atmosphere.settings.wallpaper && !atmosphere.settings.music)
			throw new Error(`“${name}” has no wallpaper or music link to sync`);
		game.notify(`Syncing “${name}”…`);
		download(
			join(game.dir, atmosphereDir(name)),
			atmosphere,
			game.state.config.ytdlp_args,
		).then(
			() => game.notify(`Synced “${name}”`),
			(e: Error) => game.notify(`Sync of “${name}” failed: ${e.message}`),
		);
	},

	/** Shuffles to another track of the active Atmosphere, unless the track already changed from `after`. */
	nextTrack(game: Game, { after }: { after?: string }) {
		const { atmospheres, runtime } = game.state;
		if (runtime.music?.track !== after) return;
		const active = display.activeAtmosphere(atmospheres, runtime);
		const tracks = atmospheres[active ?? ""]?.tracks.map((t) => t.file) ?? [];
		const track = display.nextTrack(tracks, after, Math.random);
		return editRuntime(game, (r) => {
			r.music = { ...r.music, track };
		});
	},

	setMusic: (
		game: Game,
		{ paused, volume }: { paused?: boolean; volume?: number },
	) =>
		editRuntime(game, (r) => {
			r.music = {
				...r.music,
				paused: (paused ?? r.music?.paused) || undefined,
				volume: volume ?? r.music?.volume,
			};
		}),

	/** Shows `<Note title>/<file>` on the display, or hides the image. */
	showImage(game: Game, { image }: { image?: string }) {
		if (image) {
			const [title = "", file = ""] = image.split("/");
			if (!existing(game.state.notes, title).images.includes(file))
				throw new Error(`“${title}” has no image named “${file}”`);
		}
		return setRuntime(game, { image });
	},

	/** Restores every PC to full HP. */
	async partyRest(game: Game, _: unknown) {
		for (const [title, { metadata }] of Object.entries(game.state.notes))
			if (metadata.kind === "creature" && metadata.hp)
				await editMetadata(game, title, () => ({ ...metadata, hp: undefined }));
	},
};

type Mutations = typeof mutations;
export type Mutation = {
	[K in keyof Mutations]: { type: K } & Parameters<Mutations[K]>[1];
}[keyof Mutations];

export function runMutation(game: Game, mutation: Mutation) {
	if (!Object.hasOwn(mutations, mutation.type))
		throw new Error(`Unknown mutation "${mutation.type}"`);
	const run = mutations[mutation.type] as (g: Game, m: Mutation) => unknown;
	return run(game, mutation);
}

/** `raw` trimmed, if it is a valid title (also used for file names) and not in `taken`. */
function newTitle(taken: object, raw: string, noun = "note") {
	const title = raw.trim();
	if (!title || title.startsWith(".") || /[/\\[\]|#\p{Cc}]/u.test(title))
		throw new Error(
			`“${title}” is not a valid title: it cannot be empty, start with “.”, or contain / \\ [ ] | #`,
		);
	if (Object.hasOwn(taken, title))
		throw new Error(`A ${noun} named “${title}” already exists`);
	return title;
}

function existing<T>(all: Record<string, T>, name: string, noun = "note") {
	if (!Object.hasOwn(all, name)) throw new Error(`No ${noun} named “${name}”`);
	return all[name] as T;
}

/** An Atmosphere that is not downloading, so its directory may change. */
function idle({ dir, state }: Game, name: string) {
	const atmosphere = existing(state.atmospheres, name, "atmosphere");
	if (downloading(join(dir, atmosphereDir(name))))
		throw new Error(`Wait for “${name}” to finish syncing`);
	return atmosphere;
}

const atmosphereDir = (name: string) => `atmospheres/${name}`;

function editAtmosphere(
	game: Game,
	name: string,
	fields: Record<string, unknown>,
) {
	const { settings } = existing(game.state.atmospheres, name, "atmosphere");
	const file = `${atmosphereDir(name)}/atmosphere.toml`;
	return saveToml(game, file, AtmosphereSettings, merge(settings, fields));
}

/** Points Combats and runtime.toml at `to` instead of `from`, or at nothing. */
async function moveAtmosphereReferences(
	game: Game,
	from: string,
	to: string | undefined,
) {
	const moved = (name?: string) => (name === from ? to : name);
	await editCombats(game, (combat) => ({
		...combat,
		atmosphere: moved(combat.atmosphere),
	}));
	const { atmosphere, restore_atmosphere } = game.state.runtime;
	await setRuntime(game, {
		atmosphere: moved(atmosphere),
		restore_atmosphere: moved(restore_atmosphere),
	});
}

function expectKind(notes: GameState["notes"], title: string, kind: Kind) {
	if (!Object.hasOwn(notes, title) || notes[title]?.metadata.kind !== kind)
		throw new Error(`No ${kind} note titled “${title}”`);
}

const combatFile = (name: string) => `combats/${name}.toml`;

/** Writes each Combat that `edit` changes. Its undo history names what changed, so it goes. */
async function editCombats(game: Game, edit: (combat: Combat) => Combat) {
	for (const [name, combat] of Object.entries(game.state.combats)) {
		const next = combatToml(edit(combat));
		if (next === combatToml(combat)) continue;
		await writeAtomic(join(game.dir, combatFile(name)), next);
		game.history.delete(name);
	}
}

type Recipe<P> = (
	combat: Combat,
	payload: { combat: string } & P,
	state: GameState,
	runtime: Runtime,
) => void;

/**
 * A mutation that edits one Combat, and maybe runtime.toml, through `recipe`, recorded for undo.
 * PCs' HP moves onto their Combatants for the recipe and back to their metadata.toml after.
 */
function onCombat<P>(recipe: Recipe<P>) {
	return async (game: Game, payload: { combat: string } & P) => {
		const { state } = game;
		const name = payload.combat;
		const combat = structuredClone(existing(state.combats, name, "combat"));
		const runtime = structuredClone(state.runtime);
		const pcs = Object.values(combat.combatants ?? {}).filter((c) =>
			isPc(state.notes, c),
		);
		for (const c of pcs) c.hp = structuredClone(hpOf(state.notes, c));
		recipe(combat, payload, state, runtime);

		const files: Files = {};
		for (const c of pcs) {
			const { metadata } = existing(state.notes, c.creature);
			const file = `notes/${c.creature}/metadata.toml`;
			if (!isDeepStrictEqual(c.hp ?? {}, hpOf(state.notes, c))) {
				fixFirst(state, file);
				files[file] = tomlText({ ...metadata, hp: c.hp });
			}
			delete c.hp;
		}
		files[combatFile(name)] = combatToml(combat);
		if (!isDeepStrictEqual(runtime, state.runtime))
			files["runtime.toml"] = tomlText(runtime);
		const before = await swap(game.dir, files);
		if (!Object.keys(before).length) return;
		const entry = game.history.get(name) ?? { undo: [], redo: [] };
		game.history.set(name, entry);
		entry.undo.push(before);
		entry.redo = [];
	};
}

/** A mutation applying a per-Combatant rule to `labels`. */
function onCombatants<P>(rule: Rule<P>) {
	return onCombat<{ labels: string[] } & P>((combat, payload, { notes }) =>
		combats.edit(combat, notes, payload.labels, rule, payload),
	);
}

/** Writes `files` and returns what the changed ones held before. */
async function swap(dir: string, files: Files) {
	const before: Files = {};
	for (const [file, text] of Object.entries(files)) {
		const old = await read(join(dir, file));
		if (old === text) continue;
		before[file] = old;
		if (text === undefined) await rm(join(dir, file), { force: true });
		else await writeAtomic(join(dir, file), text);
	}
	return before;
}

/** Moves one entry from the `from` stack to the `to` stack, restoring its files. */
async function step(
	{ dir, history }: Game,
	combat: string,
	from: "undo" | "redo",
	to: "undo" | "redo",
) {
	const entry = history.get(combat);
	const files = entry?.[from].pop();
	if (!entry || !files) throw new Error(`Nothing to ${from}`);
	entry[to].push(await swap(dir, files));
}

/** Writes runtime.toml as `recipe` edits it, if that changes anything. */
async function editRuntime(
	{ dir, state }: Game,
	recipe: (runtime: Runtime) => void,
) {
	const runtime = structuredClone(state.runtime);
	recipe(runtime);
	if (tomlText(runtime) !== tomlText(state.runtime))
		await writeToml(join(dir, "runtime.toml"), valid(Runtime, runtime));
}

const setRuntime = (game: Game, fields: Partial<Runtime>) =>
	editRuntime(game, (runtime) => Object.assign(runtime, fields));

/** `fields` over `data`, where null clears a field. */
const merge = (data: object, fields: Record<string, unknown>) =>
	Object.fromEntries(
		Object.entries({ ...data, ...fields }).filter(([, v]) => v !== null),
	);

function editMetadata(
	game: Game,
	title: string,
	edit: (metadata: Metadata) => object,
) {
	const { metadata } = existing(game.state.notes, title);
	return saveToml(
		game,
		`notes/${title}/metadata.toml`,
		Metadata,
		edit(metadata),
	);
}

/** Validates `data`, then writes it to `file`, unless the file has problems that the write would hide. */
function saveToml<T extends object>(
	{ dir, state }: Game,
	file: string,
	schema: z.ZodType<T>,
	data: unknown,
) {
	fixFirst(state, file);
	return writeToml(join(dir, file), valid(schema, data));
}

/** Refuses to overwrite a file whose problems would hide data. */
function fixFirst(state: GameState, file: string) {
	if (state.problems.some((p) => p.file === file))
		throw new Error(`Fix ${file} first`);
}

/** `data` checked against `schema`, or an error listing every problem. */
function valid<T>(schema: z.ZodType<T>, data: unknown) {
	const problems: Problem[] = [];
	const result = validate(schema, data, "", problems);
	if (result === undefined)
		throw new Error(
			`Not saved: ${problems.map((p) => [p.field, p.message].filter(Boolean).join(": ")).join("; ")}`,
		);
	return result;
}

/** Writes a TOML file, or removes it when nothing is left. */
async function writeToml(file: string, data: object) {
	const text = tomlText(data);
	if (text === undefined) await rm(file, { force: true });
	else await writeAtomic(file, text);
}

/**
 * TOML without undefined, null, or empty top-level fields, or undefined when nothing is left.
 * Strings with line breaks are written as multi-line strings, which read better by hand.
 */
function tomlText(data: object) {
	const kept = Object.fromEntries(
		Object.entries(JSON.parse(JSON.stringify(data))).filter(
			([, v]) => v !== null && (typeof v !== "object" || Object.keys(v).length),
		),
	);
	if (!Object.keys(kept).length) return;
	return stringify(kept).replace(
		/^(.+? = )"(.*\\n.*)"$/gm,
		(_, key: string, s: string) =>
			`${key}"""\n${s.replace(/(?<!\\)((?:\\\\)*)\\n/g, "$1\n")}"""`,
	);
}

/** A Combat's TOML, possibly empty, with each Combatant's small tables inline: `hp = { current = 4 }`. */
const combatToml = (combat: Combat) =>
	(tomlText(combat) ?? "").replace(
		/\n\[combatants\..+\.(hp|conditions|death_saves)\]\n((?:.+\n)+)/g,
		(_, key: string, body: string) =>
			`${key} = { ${body.trim().split("\n").join(", ")} }\n`,
	);
