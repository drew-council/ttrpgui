import { expect, test } from "bun:test";
import {
	formatBonuses,
	modifier,
	parseBonuses,
	parseSaves,
	signed,
	toInt,
} from "./statblock.ts";

test("ability modifiers round down", () => {
	expect([1, 8, 9, 10, 11, 21, 30].map(modifier)).toEqual([
		-5, -1, -1, 0, 0, 5, 10,
	]);
	expect([signed(3), signed(0), signed(-1)]).toEqual(["+3", "+0", "−1"]);
});

test("bonuses read back the way they are shown", () => {
	const skills = { perception: 8, sleight_of_hand: -1 };
	expect(formatBonuses(skills)).toBe("Perception +8, Sleight of Hand −1");
	expect(parseBonuses(formatBonuses(skills))).toEqual(skills);
	expect(parseBonuses("stealth 6,Animal  Handling -2")).toEqual({
		stealth: 6,
		animal_handling: -2,
	});
	expect(parseSaves("Dexterity +6, Con +8")).toEqual({ dex: 6, con: 8 });
	// Text that does not parse is left for the schema to reject.
	expect(parseBonuses("Perception")).toBe("Perception");
	expect(parseBonuses("+5")).toBe("+5");
	expect([toInt(" +3 "), toInt("−1"), toInt("17 (natural armor)")]).toEqual([
		3,
		-1,
		"17 (natural armor)",
	]);
});
