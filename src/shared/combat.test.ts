import { expect, test } from "bun:test";
import {
	addCombatants,
	concentrationDC,
	edit,
	newLabels,
	nextTurn,
	order,
	type Rule,
	removeCombatants,
	rollInitiative,
	rules,
	start,
} from "./combat.ts";
import type { Combat, Statblock } from "./schema.ts";
import type { Note } from "./state.ts";

const creature = (statblock: Statblock, pc = false): Note => ({
	metadata: { kind: "creature", ...(pc && { pc }) },
	statblock,
	images: [],
	bodyVersion: "",
	links: [],
});
const notes = {
	Goblin: creature({ hp: 7, initiative: 2 }),
	Orc: creature({ hp: 15, initiative: 1 }),
	Drake: creature({ hp: 100, initiative: 2, legendary_actions: 3 }),
	Mira: creature({ hp: 30, initiative: 4 }, true),
};

test("turn order: initiative, then bonus, then label; none last", () => {
	const combat: Combat = {
		combatants: {
			"Goblin B": { creature: "Goblin", initiative: 12 },
			"Goblin A": { creature: "Goblin", initiative: 12 },
			Orc: { creature: "Orc", initiative: 12 },
			Drake: { creature: "Drake" },
			Mira: { creature: "Mira", initiative: 18 },
		},
	};
	expect(order(combat, notes)).toEqual([
		"Mira",
		"Goblin A",
		"Goblin B",
		"Orc",
		"Drake",
	]);
});

test("turns advance, wrap into a new round, tick conditions, and refill legendary actions", () => {
	const combat: Combat = {
		combatants: {
			Mira: { creature: "Mira", initiative: 18 },
			Drake: { creature: "Drake", initiative: 10, legendary_actions: 0 },
		},
	};
	start(combat, notes);
	expect([combat.round, combat.turn]).toEqual([1, "Mira"]);
	expect(combat.combatants?.Drake?.acted).toBeUndefined();
	edit(combat, notes, ["Mira"], rules.addCondition, {
		name: "Poisoned",
		rounds: 2,
	});
	edit(combat, notes, ["Drake"], rules.addCondition, { name: "Prone" });

	nextTurn(combat, notes);
	expect([combat.round, combat.turn]).toEqual([1, "Drake"]);
	// The condition ticks at the end of its own Combatant's turn.
	expect(combat.combatants?.Mira?.conditions).toEqual({ Poisoned: 1 });
	expect(combat.combatants?.Drake).toEqual({
		creature: "Drake",
		initiative: 10,
		conditions: { Prone: true },
		acted: true,
	});

	nextTurn(combat, notes);
	expect([combat.round, combat.turn]).toEqual([2, "Mira"]);
	expect(combat.combatants?.Drake?.conditions).toEqual({ Prone: true });
	nextTurn(combat, notes);
	expect(combat.combatants?.Mira?.conditions).toBeUndefined();
});

test("removing the active Combatant passes the turn on", () => {
	const combat: Combat = {
		combatants: {
			A: { creature: "Goblin", initiative: 3 },
			B: { creature: "Goblin", initiative: 2 },
		},
	};
	start(combat, notes);
	removeCombatants(combat, notes, ["A"]);
	expect([combat.round, combat.turn]).toEqual([1, "B"]);
	removeCombatants(combat, notes, ["B"]);
	expect(combat.turn).toBeUndefined();
});

test("temp HP absorbs damage, a new value replaces it, and healing stops at max", () => {
	const combat: Combat = { combatants: { Orc: { creature: "Orc" } } };
	const orc = <P>(rule: Rule<P>, payload: P) =>
		edit(combat, notes, ["Orc"], rule, payload);
	orc(rules.setTempHp, { amount: 5 });
	orc(rules.setTempHp, { amount: 3 });
	orc(rules.damage, { amount: 5 });
	expect(combat.combatants?.Orc?.hp).toEqual({ current: 13 });
	orc(rules.damage, { amount: 20 });
	expect(combat.combatants?.Orc?.hp).toEqual({ current: 0 });
	orc(rules.deathSave, { failure: true });
	expect(combat.combatants?.Orc?.death_saves).toEqual({ failure: 1 });
	orc(rules.heal, { amount: 50 });
	expect(combat.combatants?.Orc).toEqual({ creature: "Orc" });

	orc(rules.damage, { amount: 5 });
	orc(rules.setMaxAdjust, { amount: 5 });
	expect(combat.combatants?.Orc?.hp).toEqual({ current: 15, max_adjust: 5 });
	orc(rules.setMaxAdjust, { amount: -10 });
	expect(combat.combatants?.Orc?.hp).toEqual({ max_adjust: -10 });
	expect(() => orc(rules.deathSave, { failure: false })).toThrow("0 HP");
	expect([concentrationDC(7), concentrationDC(31)]).toEqual([10, 15]);
});

test("legendary actions are spent down to zero", () => {
	const combat: Combat = { combatants: { Drake: { creature: "Drake" } } };
	const spend = () =>
		edit(combat, notes, ["Drake"], rules.spendLegendary, { kind: "actions" });
	spend();
	spend();
	spend();
	expect(combat.combatants?.Drake?.legendary_actions).toBe(0);
	expect(spend).toThrow("No legendary actions left");
});

test("initiative rolls once per NPC Creature and skips PCs and typed values", () => {
	const combat: Combat = {
		combatants: {
			Mira: { creature: "Mira" },
			"Goblin A": { creature: "Goblin" },
			"Goblin B": { creature: "Goblin" },
			Orc: { creature: "Orc", initiative: 5 },
			Drake: { creature: "Drake" },
		},
	};
	const rolls = [0.5, 0.95];
	rollInitiative(combat, notes, () => rolls.shift() ?? 0);
	const initiative = Object.entries(combat.combatants ?? {}).map(
		([label, c]) => [label, c.initiative],
	);
	expect(initiative).toEqual([
		["Mira", undefined],
		["Goblin A", 13],
		["Goblin B", 13],
		["Orc", 5],
		["Drake", 22],
	]);
});

test("new labels are letters after the title, skipping taken ones", () => {
	expect(newLabels("Orc", 1, [])).toEqual(["Orc"]);
	expect(newLabels("Orc", 1, ["Orc"])).toEqual(["Orc A"]);
	expect(newLabels("Orc", 2, ["Orc A"])).toEqual(["Orc B", "Orc C"]);
	const combat: Combat = {};
	addCombatants(combat, { creature: "Goblin", count: 3 });
	expect(Object.keys(combat.combatants ?? {})).toEqual([
		"Goblin A",
		"Goblin B",
		"Goblin C",
	]);
});
