import { expect, test } from "bun:test";
import {
	emptyHistory,
	type History,
	historyCap,
	moved,
	pushed,
	recency,
	remembered,
	renamed,
	step,
} from "./history.ts";

const any = () => true;

/** Opens each of `tabs` in turn in one tab that starts at `first`. */
function opened(first: string, ...tabs: string[]) {
	let history = emptyHistory;
	let current = first;
	for (const tab of tabs) {
		history = pushed(history, current);
		current = tab;
	}
	return { history, current };
}

test("a plain open pushes what the tab showed and clears forward", () => {
	expect(opened("a", "b", "c").history).toEqual({
		back: ["a", "b"],
		forward: [],
	});
	expect(pushed({ back: ["a"], forward: ["x"] }, "b")).toEqual({
		back: ["a", "b"],
		forward: [],
	});
});

test("back then forward returns to where it was", () => {
	const { history, current } = opened("a", "b", "c");
	const back = step(history, current, -1, any);
	expect(back).toEqual({ tab: "b", history: { back: ["a"], forward: ["c"] } });
	const again = step(back?.history as History, "b", -1, any);
	expect(again).toEqual({
		tab: "a",
		history: { back: [], forward: ["c", "b"] },
	});
	expect(step(again?.history as History, "a", -1, any)).toBeUndefined();
	const forward = step(again?.history as History, "a", 1, any);
	expect(forward).toEqual({
		tab: "b",
		history: { back: ["a"], forward: ["c"] },
	});
	expect(step(forward?.history as History, "b", 1, any)?.tab).toBe("c");
});

test("the back list keeps only the newest entries", () => {
	const tabs = Array.from({ length: historyCap + 10 }, (_, i) => `note:${i}`);
	const { history } = opened("note:start", ...tabs);
	expect(history.back).toHaveLength(historyCap);
	expect(history.back.at(-1)).toBe(`note:${historyCap + 8}`);
});

test("entries that cannot be shown are passed over and kept in order", () => {
	const { history, current } = opened("a", "gone", "b", "open", "c");
	const can = (tab: string) => tab !== "gone" && tab !== "open";
	const back = step(history, current, -1, can);
	expect(back).toEqual({
		tab: "b",
		history: { back: ["a", "gone"], forward: ["c", "open"] },
	});
	expect(step(back?.history as History, "b", -1, can)?.tab).toBe("a");
	// Once the entry can be shown again, forward reaches it.
	expect(step(back?.history as History, "b", 1, any)?.tab).toBe("open");
	expect(step(back?.history as History, "b", 1, can)?.tab).toBe("c");
	expect(step(history, current, -1, () => false)).toBeUndefined();
});

test("a rename carries through both lists", () => {
	expect(
		renamed({ back: ["a", "b", "a"], forward: ["a", "c"] }, "a", "z"),
	).toEqual({ back: ["z", "b", "z"], forward: ["z", "c"] });
});

test("a recent list puts the latest first, once, capped", () => {
	expect(remembered(["a", "b", "c"], "b")).toEqual(["b", "a", "c"]);
	expect(remembered([], "a")).toEqual(["a"]);
	const full = Array.from({ length: historyCap }, (_, i) => String(i));
	expect(remembered(full, "new")).toEqual(["new", ...full.slice(0, -1)]);
});

test("recent keys lead in order and the rest keep theirs", () => {
	const rank = recency(["c", "a"]);
	const items = ["a", "b", "c", "d"];
	expect(items.toSorted((x, y) => rank(x) - rank(y))).toEqual([
		"c",
		"a",
		"b",
		"d",
	]);
	expect(rank("b")).toBe(rank("d"));
});

test("moved puts a tab in a gap and keeps the rest in order", () => {
	const tabs = ["a", "b", "c", "d"];
	expect(moved(tabs, "a", 3)).toEqual(["b", "c", "a", "d"]);
	expect(moved(tabs, "d", 1)).toEqual(["a", "d", "b", "c"]);
	expect(moved(tabs, "a", 4)).toEqual(["b", "c", "d", "a"]);
	expect(moved(tabs, "d", 0)).toEqual(["d", "a", "b", "c"]);
	expect(moved(tabs, "b", 1)).toEqual(tabs);
	expect(moved(tabs, "b", 2)).toEqual(tabs);
	expect(moved(tabs, "x", 0)).toBe(tabs);
});

test("moved stops at the ends", () => {
	expect(moved(["a", "b"], "a", -1)).toEqual(["a", "b"]);
	expect(moved(["a", "b"], "b", 3)).toEqual(["a", "b"]);
});
