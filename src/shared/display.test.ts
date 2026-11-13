import { expect, test } from "bun:test";
import { nextTurn, start } from "./combat.ts";
import {
	activeAtmosphere,
	enterCombat,
	leaveCombat,
	nextTrack,
	parseTracks,
	playerTracker,
	switchAtmosphere,
} from "./display.ts";
import type { Combat, Metadata, Runtime } from "./schema.ts";
import type { Atmosphere, Note } from "./state.ts";

test("track names give title, artist, and art; the id suffix is dropped", () => {
	expect(
		parseTracks([
			"Ash Choir - Embers - Live [dQw4w9WgXcQ].opus",
			"Ash Choir - Embers - Live [dQw4w9WgXcQ].webp",
			"Night Bells.mp3",
			"cover.jpg",
			"notes.txt",
		]),
	).toEqual([
		{
			file: "Ash Choir - Embers - Live [dQw4w9WgXcQ].opus",
			title: "Embers - Live",
			artist: "Ash Choir",
			art: "Ash Choir - Embers - Live [dQw4w9WgXcQ].webp",
		},
		{ file: "Night Bells.mp3", title: "Night Bells" },
	]);
});

test("shuffle picks another track, unless there is only one", () => {
	const tracks = ["a", "b", "c"];
	expect(nextTrack(tracks, "a", () => 0)).toBe("b");
	expect(nextTrack(tracks, "a", () => 0.99)).toBe("c");
	expect(nextTrack(tracks, undefined, () => 0)).toBe("a");
	expect(nextTrack(["a"], "a", () => 0.5)).toBe("a");
	expect(nextTrack([], undefined, () => 0)).toBeUndefined();
});

const atmosphere = (settings = {}): Atmosphere => ({ settings, tracks: [] });

test("the active atmosphere is the chosen one, else the default, else the first; combat switches and restores it", () => {
	const atmospheres = {
		Tavern: atmosphere(),
		Night: atmosphere({ default: true }),
		Fire: atmosphere(),
	};
	const runtime: Runtime = { music: { track: "song.opus", volume: 50 } };
	expect(activeAtmosphere(atmospheres, runtime)).toBe("Night");
	expect(activeAtmosphere({ B: atmosphere(), A: atmosphere() }, {})).toBe("A");
	expect(activeAtmosphere({}, {})).toBeUndefined();

	switchAtmosphere(runtime, atmospheres, "Tavern");
	expect(runtime).toEqual({ atmosphere: "Tavern", music: { volume: 50 } });

	enterCombat(runtime, atmospheres, {});
	expect(runtime.atmosphere).toBe("Tavern");
	enterCombat(runtime, atmospheres, { atmosphere: "Fire" });
	expect(runtime).toMatchObject({
		atmosphere: "Fire",
		restore_atmosphere: "Tavern",
	});
	switchAtmosphere(runtime, atmospheres, "Night");
	leaveCombat(runtime, atmospheres);
	expect(runtime).toEqual({ atmosphere: "Tavern", music: { volume: 50 } });
	leaveCombat(runtime, atmospheres);
	expect(runtime.atmosphere).toBe("Tavern");
});

const note = (metadata: Metadata, images: string[] = []): Note => ({
	metadata,
	images,
	bodyVersion: "",
	links: [],
});

test("players see PCs, NPCs once they have acted, display names, and conditions", () => {
	const notes = {
		Mira: note({ kind: "creature", pc: true }, ["mira.png"]),
		Thorin: note({ kind: "creature", pc: true }),
		"Goblin Skulker": note({ kind: "creature", display_name: "Goblin" }),
		Drake: note({ kind: "creature" }, ["drake.png"]),
	};
	const combat: Combat = {
		combatants: {
			Mira: { creature: "Mira", initiative: 20 },
			"Goblin Skulker A": {
				creature: "Goblin Skulker",
				initiative: 15,
				hp: { current: 2 },
				conditions: { Poisoned: 2, Prone: true },
				note: "Secret",
			},
			Drake: { creature: "Drake", initiative: 12 },
			Thorin: { creature: "Thorin", initiative: 5 },
		},
	};
	expect(playerTracker(combat, notes)).toBeUndefined();
	start(combat, notes);
	const names = () =>
		playerTracker(combat, notes)?.order.map(
			(r) => r.label + (r.active ? "*" : ""),
		);
	expect(names()).toEqual(["Mira*", "Thorin"]);
	expect(playerTracker(combat, notes)).toMatchObject({
		round: 1,
		active: { label: "Mira", pc: true, portrait: "Mira/mira.png" },
		onDeck: "Thorin",
	});

	nextTurn(combat, notes);
	expect(playerTracker(combat, notes)).toEqual({
		round: 1,
		active: {
			key: "Goblin Skulker A",
			label: "Goblin A",
			pc: false,
			conditions: ["Poisoned 2", "Prone"],
		},
		onDeck: "Thorin",
		order: [
			{
				key: "Mira",
				label: "Mira",
				pc: true,
				conditions: [],
				portrait: "Mira/mira.png",
				active: false,
			},
			{
				key: "Goblin Skulker A",
				label: "Goblin A",
				pc: false,
				conditions: ["Poisoned 2", "Prone"],
				active: true,
			},
			{
				key: "Thorin",
				label: "Thorin",
				pc: true,
				conditions: [],
				active: false,
			},
		],
	});

	nextTurn(combat, notes);
	nextTurn(combat, notes);
	expect(names()).toEqual(["Mira", "Goblin A", "Drake", "Thorin*"]);
	expect(playerTracker(combat, notes)?.onDeck).toBe("Mira");

	delete combat.combatants?.["Goblin Skulker A"];
	nextTurn(combat, notes);
	expect(names()).toEqual(["Mira*", "Drake", "Thorin"]);
	expect(playerTracker(combat, notes)?.round).toBe(2);

	// A renamed Combatant still hides its Creature behind the display name; without one, the label shows.
	const renamed: Combat = {
		round: 1,
		turn: "Sneak",
		combatants: {
			Sneak: { creature: "Goblin Skulker" },
			Wyrm: { creature: "Drake", acted: true },
		},
	};
	expect(playerTracker(renamed, notes)?.order.map((r) => r.label)).toEqual([
		"Goblin",
		"Wyrm",
	]);
});
