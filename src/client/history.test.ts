import { expect, test } from "bun:test";
import {
	emptyHistory,
	type History,
	historyCap,
	pushed,
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
