// What the display shows: the active Atmosphere and its music, and the player tracker with what players may see.
import { isPc, order } from "./combat.ts";
import { imageFile, mainImage } from "./notes.ts";
import type { Combat, Combatant, Runtime } from "./schema.ts";
import type { Atmosphere, Note, Track } from "./state.ts";

type Atmospheres = Record<string, Atmosphere>;
type Notes = Record<string, Note>;

export const videoFile = /\.(webm|mp4|mkv|mov|ogv)$/i;
export const audioFile = /\.(opus|ogg|oga|mp3|m4a|aac|flac|wav)$/i;

/** Tracks from the files in `music/`: `Artist - Title [id].opus` with art in `Artist - Title [id].webp`. */
export function parseTracks(files: string[]): Track[] {
	const stem = (file: string) => file.replace(/\.[^.]+$/, "");
	return files
		.filter((file) => audioFile.test(file))
		.map((file) => {
			const name = stem(file);
			const art = files.find((f) => imageFile.test(f) && stem(f) === name);
			const [, artist, title = name] =
				name.replace(/ \[[^\]]+\]$/, "").match(/^(?:(.+?) - )?(.+)$/) ?? [];
			return {
				file,
				title,
				...(artist && { artist }),
				...(art && { art }),
			};
		});
}

/** The Atmosphere chosen with "Switch atmosphere", else the default, else the first by name. */
export function activeAtmosphere(atmospheres: Atmospheres, runtime: Runtime) {
	const names = Object.keys(atmospheres).sort();
	if (runtime.atmosphere && Object.hasOwn(atmospheres, runtime.atmosphere))
		return runtime.atmosphere;
	return names.find((name) => atmospheres[name]?.settings.default) ?? names[0];
}

/** The current track, if it is one of the active Atmosphere's. */
export function nowPlaying(atmospheres: Atmospheres, runtime: Runtime) {
	const active = atmospheres[activeAtmosphere(atmospheres, runtime) ?? ""];
	return active?.tracks.find((t) => t.file === runtime.music?.track);
}

/** Shuffle: any track but the current one, unless it is the only one. `random` returns [0, 1). */
export function nextTrack(
	tracks: string[],
	current: string | undefined,
	random: () => number,
) {
	const others = tracks.filter((t) => t !== current);
	const from = others.length ? others : tracks;
	return from[Math.floor(random() * from.length)];
}

/** Makes `name` active. A different Atmosphere drops the track, so the display starts one of its own. */
export function switchAtmosphere(
	runtime: Runtime,
	atmospheres: Atmospheres,
	name: string,
) {
	if (activeAtmosphere(atmospheres, runtime) !== name)
		delete runtime.music?.track;
	runtime.atmosphere = name;
}

/** On Start: switches to the Combat's Atmosphere, if it has one, and remembers the active one. */
export function enterCombat(
	runtime: Runtime,
	atmospheres: Atmospheres,
	combat: Combat,
) {
	const name = combat.atmosphere;
	if (!name || !Object.hasOwn(atmospheres, name)) return;
	runtime.restore_atmosphere = activeAtmosphere(atmospheres, runtime);
	switchAtmosphere(runtime, atmospheres, name);
}

/** On End: switches back to what was active before Start. */
export function leaveCombat(runtime: Runtime, atmospheres: Atmospheres) {
	const back = runtime.restore_atmosphere;
	delete runtime.restore_atmosphere;
	if (back && Object.hasOwn(atmospheres, back))
		switchAtmosphere(runtime, atmospheres, back);
}

/** One row of the player tracker. */
export type PlayerRow = {
	/** The Combatant's own label, unique, for React keys. Never shown. */
	key: string;
	label: string;
	pc: boolean;
	/** `Poisoned 2`, or just `Prone` with no limit. */
	conditions: string[];
	/** Path under `/game/notes/` of the Creature's main picture. */
	portrait?: string;
};

/**
 * The label players see: the Creature's display name replaces its title, so "Goblin Skulker B" reads "Goblin B".
 * A label without the title could give the Creature away, so it reads as the display name alone.
 */
function playerLabel(label: string, creature: string, notes: Notes) {
	const metadata = notes[creature]?.metadata;
	const name = metadata?.kind === "creature" && metadata.display_name;
	if (!name) return label;
	return label.includes(creature) ? label.replace(creature, name) : name;
}

/**
 * Everything players may see of a running Combat. PCs show from the start; an NPC shows once it has acted, and the
 * active Combatant always does. Players see display names and conditions, never HP, AC, notes, or counters.
 */
export function playerTracker(combat: Combat, notes: Notes) {
	if (combat.round === undefined) return;
	const combatants = combat.combatants ?? {};
	const { turn } = combat;
	const labels = order(combat, notes);
	const pc = (label: string) => isPc(notes, combatants[label] as Combatant);
	const row = (label: string): PlayerRow => {
		const { creature, conditions = {} } = combatants[label] as Combatant;
		const note = notes[creature];
		const image = note && mainImage(note);
		return {
			key: label,
			label: playerLabel(label, creature, notes),
			pc: pc(label),
			conditions: Object.entries(conditions).map(([name, rounds]) =>
				rounds === true ? name : `${name} ${rounds}`,
			),
			...(image && { portrait: `${creature}/${image}` }),
		};
	};
	const at = labels.indexOf(turn ?? "");
	const after = [...labels.slice(at + 1), ...labels.slice(0, at + 1)];
	const onDeck = after.find((label) => pc(label) && label !== turn);
	return {
		round: combat.round,
		active: at < 0 ? undefined : row(labels[at] as string),
		onDeck: onDeck && row(onDeck).label,
		order: labels
			.filter((l) => l === turn || combatants[l]?.acted || pc(l))
			.map((l) => ({ ...row(l), active: l === turn })),
	};
}
