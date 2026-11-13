import { expect, test } from "bun:test";
import { cp, mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { localDate } from "../shared/notes.ts";
import type { Statblock } from "../shared/schema.ts";
import { loadGame } from "./game.ts";
import { type History, type Mutation, runMutation } from "./mutations.ts";

/** A temp copy of the sample Game whose `state` reloads after each mutation. */
async function tempGame() {
	const dir = await mkdtemp(join(tmpdir(), "ttrpgui-test-"));
	await cp("fixtures/sample-game", dir, { recursive: true });
	const history: History = new Map();
	const game = {
		dir,
		state: await loadGame(dir),
		async run(mutation: Mutation) {
			await runMutation(
				{ dir, state: { ...game.state, config: {} }, history, notify() {} },
				mutation,
			);
			game.state = await loadGame(dir);
		},
	};
	return game;
}

test("mutations change files, and the reloaded Game reflects them", async () => {
	const game = await tempGame();
	const { dir, run } = game;

	await run({ type: "renameNote", from: "Cinder Drake", to: "Ash Wyrm" });
	expect(game.state.notes["Ash Wyrm"]?.statblock?.legendary_actions).toBe(3);
	expect(game.state.notes["Cinder Drake"]).toBeUndefined();
	const body = await readFile(
		join(dir, "notes/Rumors and Hooks/note.md"),
		"utf8",
	);
	expect(body).toContain("See [[Ash Wyrm]].");

	await run({ type: "createNote", title: " Ogre ", kind: "creature" });
	expect(game.state.notes.Ogre?.metadata).toEqual({ kind: "creature" });
	await run({ type: "setKind", title: "Ash Wyrm", kind: "location" });
	expect(game.state.notes["Ash Wyrm"]?.metadata).toEqual({
		kind: "location",
		images: { "portrait.png": "main" },
	});
	await run({ type: "setKind", title: "Ogre" });
	expect(game.state.notes.Ogre?.metadata).toEqual({});
	await run({ type: "saveNote", title: "Ogre", body: "Big. [[Ash Wyrm]]\r\n" });
	expect(await readFile(join(dir, "notes/Ogre/note.md"), "utf8")).toBe(
		"Big. [[Ash Wyrm]]\r\n",
	);
	expect(game.state.notes.Ogre?.links).toEqual(["Ash Wyrm"]);
	await run({ type: "addImage", title: "Ogre", name: "a.png", data: "AA==" });
	await run({ type: "addImage", title: "Ogre", name: "b.png", data: "AA==" });
	await run({
		type: "setImageRole",
		title: "Ogre",
		image: "a.png",
		role: "main",
	});
	await run({
		type: "setImageRole",
		title: "Ogre",
		image: "b.png",
		role: "main",
	});
	expect(game.state.notes.Ogre?.metadata.images).toEqual({ "b.png": "main" });
	await run({ type: "setImageRole", title: "Ogre", image: "b.png" });
	expect(game.state.notes.Ogre?.metadata).toEqual({});
	await run({ type: "deleteNote", title: "Ogre" });
	expect(game.state.notes.Ogre).toBeUndefined();
	// The rename followed into the combat, which now points at a Location.
	expect(game.state.problems.map((p) => p.message)).toEqual([
		"no creature note titled “Ash Wyrm”",
	]);

	await expect(run({ type: "createNote", title: "Ash Wyrm" })).rejects.toThrow(
		"already exists",
	);
	await expect(run({ type: "createNote", title: "a/b" })).rejects.toThrow(
		"not a valid title",
	);
	await expect(
		run({ type: "deleteNote", title: "constructor" }),
	).rejects.toThrow("No note");
	await expect(
		run({ type: "addImage", title: "Ash Wyrm", name: "../x.png", data: "" }),
	).rejects.toThrow("not a valid image");
});

test("stat blocks and metadata are validated, then written as readable TOML", async () => {
	const game = await tempGame();
	const { dir, run } = game;
	const file = join(dir, "notes/Goblin Skulker/statblock.toml");
	const statblock: Statblock = {
		ac: 15,
		skills: { stealth: 6 },
		sections: [
			{
				name: "Actions",
				entries: [{ name: "Bite", text: 'Two\nlines, a "quote", and \\n.' }],
			},
		],
	};
	await run({ type: "saveStatblock", title: "Goblin Skulker", statblock });
	expect(game.state.notes["Goblin Skulker"]?.statblock).toEqual(statblock);
	expect(await readFile(file, "utf8")).toContain('text = """\nTwo\nlines');

	const bad = { ac: "15", saves: { luck: 1 } } as unknown as Statblock;
	await expect(
		run({ type: "saveStatblock", title: "Goblin Skulker", statblock: bad }),
	).rejects.toThrow(
		"Not saved: ac: Invalid input: expected number, received string; saves.luck: unknown field",
	);
	expect(game.state.notes["Goblin Skulker"]?.statblock).toEqual(statblock);
	await run({ type: "saveStatblock", title: "Goblin Skulker", statblock: {} });
	expect(await Bun.file(file).exists()).toBe(false);

	await run({
		type: "setMetadata",
		title: "Goblin Skulker",
		fields: { pc: true, display_name: "Snik" },
	});
	expect(game.state.notes["Goblin Skulker"]?.metadata).toEqual({
		kind: "creature",
		pc: true,
		display_name: "Snik",
	});
	await run({
		type: "setMetadata",
		title: "Goblin Skulker",
		fields: { pc: null },
	});
	expect(game.state.notes["Goblin Skulker"]?.metadata).toEqual({
		kind: "creature",
		display_name: "Snik",
	});
	await expect(
		run({ type: "setMetadata", title: "Session 1", fields: { date: "soon" } }),
	).rejects.toThrow("date: expected a date like 2026-11-07");

	await run({ type: "createNote", title: "Session 2", kind: "session" });
	expect(game.state.notes["Session 2"]?.metadata).toEqual({
		kind: "session",
		date: localDate(),
	});
});

test("combat edits write PC HP to metadata, and undo and redo restore every file", async () => {
	const game = await tempGame();
	const { dir, run } = game;
	const combat = "Ambush";
	const file = (path: string) => readFile(join(dir, path), "utf8");
	await run({ type: "createCombat", name: combat });
	expect(Object.keys(game.state.combats[combat]?.combatants ?? {})).toEqual([
		"Mira Quickfoot",
		"Thorin Ashvale",
	]);
	await run({
		type: "addCombatants",
		combat,
		creature: "Goblin Skulker",
		count: 2,
	});
	const labels = ["Mira Quickfoot", "Goblin Skulker A"];
	await run({ type: "damage", combat, labels, amount: 10 });
	// Mira had 27 HP and 5 temp; the goblin's 9 HP stops at 0.
	const mira = game.state.notes["Mira Quickfoot"]?.metadata;
	expect(mira?.kind === "creature" && mira.hp).toEqual({ current: 22 });
	expect(await file("combats/Ambush.toml")).toContain(
		'[combatants."Goblin Skulker A"]\ncreature = "Goblin Skulker"\nhp = { current = 0 }\n',
	);
	await run({ type: "undo", combat });
	await run({ type: "undo", combat });
	expect(game.state.combats[combat]?.combatants?.["Goblin Skulker A"]).toBe(
		undefined,
	);
	expect(await file("notes/Mira Quickfoot/metadata.toml")).toContain(
		"temp = 5",
	);
	await run({ type: "redo", combat });
	await run({ type: "redo", combat });
	expect(await file("notes/Mira Quickfoot/metadata.toml")).toContain(
		"current = 22",
	);
	await expect(run({ type: "redo", combat })).rejects.toThrow(
		"Nothing to redo",
	);

	await run({ type: "goLive", session: "Session 1" });
	await run({ type: "startCombat", combat });
	expect(game.state.runtime).toEqual({ session: "Session 1", combat });
	expect(game.state.combats[combat]?.session).toBe("Session 1");
	await run({ type: "renameNote", from: "Goblin Skulker", to: "Goblin" });
	await run({ type: "renameNote", from: "Session 1", to: "Session One" });
	expect(game.state.combats[combat]?.session).toBe("Session One");
	expect(game.state.runtime.session).toBe("Session One");
	expect(game.state.combats[combat]?.combatants?.["Goblin Skulker B"]).toEqual({
		creature: "Goblin",
	});
	await run({ type: "partyRest" });
	expect(game.state.notes["Mira Quickfoot"]?.metadata).toEqual({
		kind: "creature",
		pc: true,
	});
	expect(game.state.problems).toEqual([]);
});

test("atmospheres switch around combat, and renames and deletes keep references", async () => {
	const game = await tempGame();
	const { run } = game;
	const runtime = () => game.state.runtime;
	await run({ type: "switchAtmosphere", name: "Market Day" });
	await run({ type: "nextTrack" });
	expect(runtime().music?.track).toBe("Harbor Fiddlers - Fish and Copper.opus");
	// A stale report changes nothing.
	await run({ type: "nextTrack", after: "Gone.opus" });
	await run({ type: "setMusic", paused: true, volume: 40 });
	await expect(run({ type: "setMusic", volume: 140 })).rejects.toThrow(
		"music.volume",
	);

	const combat = "The Drake Awakens";
	await run({ type: "startCombat", combat });
	expect(runtime()).toEqual({
		combat,
		atmosphere: "Dragonfire",
		restore_atmosphere: "Market Day",
		music: { paused: true, volume: 40 },
	});
	await run({ type: "renameAtmosphere", from: "Market Day", to: "Fair" });
	await run({ type: "renameAtmosphere", from: "Dragonfire", to: "Lair" });
	expect(game.state.combats[combat]?.atmosphere).toBe("Lair");
	await run({ type: "endCombat", combat });
	expect(runtime().atmosphere).toBe("Fair");

	await run({ type: "showImage", image: "Emberfall Keep/keep-map.png" });
	await run({ type: "renameNote", from: "Emberfall Keep", to: "The Keep" });
	expect(runtime().image).toBe("The Keep/keep-map.png");
	await run({ type: "deleteNote", title: "The Keep" });
	await run({ type: "deleteAtmosphere", name: "Lair" });
	await run({ type: "createAtmosphere", name: "Rain" });
	await run({ type: "setDefaultAtmosphere", name: "Rain" });
	expect(game.state.atmospheres["Emberfall Night"]?.settings).toEqual({});
	expect(game.state.atmospheres.Rain?.settings).toEqual({ default: true });
	expect(runtime().image).toBeUndefined();
	expect(game.state.combats[combat]?.atmosphere).toBeUndefined();
	expect(game.state.problems).toEqual([]);
});

test("renaming a combat clears its undo history, so undo cannot bring back the old file", async () => {
	const game = await tempGame();
	const combat = "Gatehouse Skirmish";
	await game.run({ type: "startCombat", combat });
	await game.run({ type: "renameCombat", from: combat, to: "Gate Fight" });
	await expect(
		game.run({ type: "undo", combat: "Gate Fight" }),
	).rejects.toThrow("Nothing to undo");
	expect(Object.keys(game.state.combats).sort()).toEqual([
		"Gate Fight",
		"The Drake Awakens",
	]);
});
