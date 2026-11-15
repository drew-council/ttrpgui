import { expect, test } from "bun:test";
import {
	type Groups,
	placed,
	restored,
	sameGroups,
	without,
} from "./groups.ts";

const two: Groups = {
	groups: [
		{ tabs: ["a", "b"], active: "a" },
		{ tabs: ["c"], active: "c" },
	],
	focus: 0,
};

test("the old single list of tabs loads as one group", () => {
	expect(restored({ tabs: ["a", "b"], active: "b" })).toEqual({
		groups: [{ tabs: ["a", "b"], active: "b" }],
		focus: 0,
	});
	expect(restored({})).toEqual({ groups: [{ tabs: [] }], focus: 0 });
	expect(restored({ ...two, focus: 5 }).focus).toBe(1);
});

test("closing a tab shows its neighbor in its group", () => {
	expect(without(two, "a").groups[0]).toEqual({ tabs: ["b"], active: "b" });
	expect(without(two, "b").groups[0]).toEqual({ tabs: ["a"], active: "a" });
});

test("closing a group's last tab drops the group and focuses a neighbor", () => {
	expect(without({ ...two, focus: 1 }, "c")).toEqual({
		groups: [two.groups[0] as never],
		focus: 0,
	});
	const three: Groups = {
		groups: [{ tabs: ["a"] }, { tabs: ["b"] }, { tabs: ["c"] }],
		focus: 2,
	};
	expect(without(three, "a").focus).toBe(1);
	expect(without({ ...three, focus: 0 }, "a").focus).toBe(0);
	expect(without({ ...three, focus: 1 }, "b").focus).toBe(0);
});

test("the only group stays when its last tab closes", () => {
	const one: Groups = { groups: [{ tabs: ["a"], active: "a" }], focus: 0 };
	expect(without(one, "a")).toEqual({ groups: [{ tabs: [] }], focus: 0 });
});

test("a tab moves into another group at a place, shows there, and focuses it", () => {
	expect(placed(two, "b", 1, 0)).toEqual({
		groups: [
			{ tabs: ["a"], active: "a" },
			{ tabs: ["b", "c"], active: "b" },
		],
		focus: 1,
	});
	expect(placed(two, "c", 0, 1)).toEqual({
		groups: [{ tabs: ["a", "c", "b"], active: "c" }],
		focus: 0,
	});
});

test("a tab reorders within its group", () => {
	expect(placed(two, "a", 0, 2).groups[0]).toEqual({
		tabs: ["b", "a"],
		active: "a",
	});
});

test("a tab splits into a new group on either side", () => {
	expect(placed(two, "b", 1)).toEqual({
		groups: [
			{ tabs: ["a"], active: "a" },
			{ tabs: ["b"], active: "b" },
			{ tabs: ["c"], active: "c" },
		],
		focus: 1,
	});
	expect(placed(two, "c", 0)).toEqual({
		groups: [
			{ tabs: ["c"], active: "c" },
			{ tabs: ["a", "b"], active: "a" },
		],
		focus: 0,
	});
});

test("splitting a group's only tab beside itself changes nothing", () => {
	expect(sameGroups(placed(two, "c", 1), two)).toBe(true);
	expect(sameGroups(placed(two, "c", 2), two)).toBe(true);
	expect(sameGroups(placed(two, "a", 0), two)).toBe(false);
});
