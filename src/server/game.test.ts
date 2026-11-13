import { expect, test } from "bun:test";
import { cp, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyPatches, enablePatches, produceWithPatches } from "immer";
import { loadConfig, loadGame, reconcile, searchNotes } from "./game.ts";

enablePatches();

async function tempGame() {
	const dir = await mkdtemp(join(tmpdir(), "ttrpgui-test-"));
	await cp("fixtures/sample-game", dir, { recursive: true });
	return dir;
}

test("sample game loads without problems", async () => {
	const { notes, combats, atmospheres, problems } = await loadGame(
		"fixtures/sample-game",
	);
	expect(problems).toEqual([]);
	const night = atmospheres["Emberfall Night"];
	expect(night?.settings).toEqual({ default: true });
	expect(night?.wallpaper).toBe("wallpaper.webm");
	expect(night?.tracks.map((t) => t.art)).toEqual([
		"Ash Choir - Embers Over Stone.webp",
		undefined,
		"The Lantern Guild - A Long Watch Upon the Eastern Wall.webp",
	]);
	expect(atmospheres["Market Day"]?.wallpaper).toBe("wallpaper.png");
	expect(Object.keys(notes)).toHaveLength(9);
	expect(Object.keys(combats)).toEqual([
		"Gatehouse Skirmish",
		"The Drake Awakens",
	]);
	expect(notes["Cinder Drake"]?.statblock?.legendary_actions).toBe(3);
	expect(notes["Session 1"]?.metadata).toEqual({
		kind: "session",
		date: "2026-11-07",
	});
});

test("broken game reports every violation with file and field", async () => {
	const { notes, combats, problems } = await loadGame("fixtures/broken-game");
	expect(problems.map((p) => [p.file, p.field ?? ""])).toEqual([
		["stray.txt", ""],
		["notes/Bad Fields/metadata.toml", "pc"],
		["notes/Bad Fields/metadata.toml", "colour"],
		["notes/Bad Images/notes.txt", ""],
		["notes/Bad Images/metadata.toml", "date"],
		["notes/Bad Images/metadata.toml", 'images."b.png"'],
		["notes/Bad Kind/metadata.toml", "kind"],
		["notes/Bad Roles/metadata.toml", 'images."missing.png"'],
		["notes/Bad Roles/metadata.toml", "images"],
		["notes/Bad Statblock/statblock.toml", "ac"],
		["notes/Bad Statblock/statblock.toml", "abilities.strength"],
		["notes/Bad Statblock/statblock.toml", "sections[0].entries[0].text"],
		["notes/Bad Toml/note.md", ""],
		["notes/Bad Toml/statblock.toml", ""],
		["notes/loose.md", ""],
		["combats/Bad Fields.toml", "round"],
		["combats/Bad Fields.toml", "combatants.Goblin.hp.current"],
		["combats/Bad Fields.toml", "combatants.Goblin.conditions.Prone"],
		["combats/Bad Fields.toml", "colour"],
		["combats/notes.txt", ""],
		["atmospheres/Bad/music/readme.md", ""],
		["atmospheres/Bad/notes.txt", ""],
		["atmospheres/Bad", ""],
		["atmospheres/Bad/atmosphere.toml", "wallpaper"],
		["atmospheres/Bad/atmosphere.toml", "wallpaper_section"],
		["atmospheres/Bad/atmosphere.toml", "colour"],
		["atmospheres/loose.toml", ""],
		["combats/Bad References.toml", "session"],
		["combats/Bad References.toml", "atmosphere"],
		["combats/Bad References.toml", "turn"],
		["combats/Bad References.toml", "combatants.Ghost.creature"],
		["combats/Bad References.toml", "combatants.Hero.hp"],
		["runtime.toml", "session"],
		["runtime.toml", "combat"],
		["runtime.toml", "atmosphere"],
		["runtime.toml", "image"],
		["atmospheres/Third/atmosphere.toml", "default"],
	]);
	// Bad parts are ignored, not fatal: every note directory and combat still loads.
	expect(Object.keys(notes)).toHaveLength(8);
	expect(Object.keys(combats)).toEqual(["Bad Fields", "Bad References"]);
	expect(notes["Bad Kind"]?.metadata).toEqual({});
	expect(notes["Bad Toml"]?.statblock).toBeUndefined();
});

test("a file with problems loads what is valid", async () => {
	const dir = await tempGame();
	const write = (file: string, text: string) =>
		writeFile(join(dir, file), text);
	const goblin = "notes/Goblin Skulker/statblock.toml";
	await write(
		goblin,
		(await readFile(join(dir, goblin), "utf8")).replace("ac = 13", 'ac = "13"'),
	);
	await write(
		"notes/Mira Quickfoot/metadata.toml",
		'kind = "creature"\npc = true\nhp = { current = 27 }\ncolour = "red"\n',
	);
	await write(
		"combats/Test.toml",
		`[combatants.Mira]
creature = "Mira Quickfoot"
initiative = "fast"

[combatants.Ghost]
initiative = 3
`,
	);
	const { notes, combats, problems } = await loadGame(dir);
	expect(notes["Mira Quickfoot"]?.metadata).toEqual({
		kind: "creature",
		pc: true,
		hp: { current: 27 },
	});
	const statblock = notes["Goblin Skulker"]?.statblock;
	expect(statblock?.ac).toBeUndefined();
	expect(statblock?.hp).toBe(9);
	expect(statblock?.sections).toHaveLength(2);
	// A combatant missing its creature is dropped; the rest stay.
	expect(combats.Test).toEqual({
		combatants: { Mira: { creature: "Mira Quickfoot" } },
	});
	expect(problems.map((p) => [p.file, p.field])).toEqual([
		["notes/Goblin Skulker/statblock.toml", "ac"],
		["notes/Mira Quickfoot/metadata.toml", "colour"],
		["combats/Test.toml", "combatants.Mira.initiative"],
		["combats/Test.toml", "combatants.Ghost.creature"],
	]);

	await write("combats/Test.toml", "round = = 1\n");
	expect((await loadGame(dir)).combats.Test).toBeUndefined();
});

test("a reload patches only what changed, and a client rebuilds the same state", async () => {
	const dir = await tempGame();
	const state = await loadGame(dir);
	const reload = async () => {
		const fresh = await loadGame(dir);
		return produceWithPatches(state, (d) => reconcile(d, state, fresh));
	};
	expect((await reload())[1]).toEqual([]);

	await writeFile(join(dir, "notes/Goblin Skulker/note.md"), "Sneaky.");
	const [next, patches] = await reload();
	expect(patches.map((p) => p.path)).toEqual([
		["notes", "Goblin Skulker", "bodyVersion"],
		["notes", "Goblin Skulker", "links"],
	]);
	const client = applyPatches(
		JSON.parse(JSON.stringify(state)),
		JSON.parse(JSON.stringify(patches)),
	);
	expect(client).toEqual(next);
});

test("the user config is optional and reports bad binds and unknown actions", async () => {
	const file = join(await mkdtemp(join(tmpdir(), "ttrpgui-test-")), "c.toml");
	expect(await loadConfig(file)).toEqual({ config: {}, problems: [] });

	await writeFile(file, '[keys]\nquick-open = "ctrl+o"\nclose-tab = ""\n');
	expect((await loadConfig(file)).config).toEqual({
		keys: { "quick-open": "ctrl+o", "close-tab": "" },
	});

	await writeFile(
		file,
		'[keys]\nclose-tab = "hyper+w"\nbogus = "j"\nquick-open = "ctrl+o"\n',
	);
	const { config, problems } = await loadConfig(file);
	expect(config).toEqual({ keys: { "quick-open": "ctrl+o" } });
	expect(problems.map((p) => [p.file, p.field, p.message])).toEqual([
		[file, "keys.close-tab", expect.stringContaining("expected a key")],
		[file, "keys.bogus", "unknown action"],
	]);
});

test("search finds lines containing the query, ignoring case", async () => {
	const { notes } = await loadGame("fixtures/sample-game");
	const hits = await searchNotes(
		"fixtures/sample-game",
		Object.keys(notes),
		" BELLS ",
	);
	expect(hits.map((h) => [h.title, h.line, h.column])).toEqual([
		["Captain Vex Morrow", 2, 43],
		["Cinder Drake", 2, 21],
		["Rumors and Hooks", 0, 14],
		["Rumors and Hooks", 1, 20],
	]);
	expect(hits[0]?.text).toBe(
		"…n Ashvale]]'s debt. Wants the bells the [[Cinder Drake]] hoards.",
	);
	expect(
		await searchNotes("fixtures/sample-game", ["Cinder Drake"], " "),
	).toEqual([]);
});
