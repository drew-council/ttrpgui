import { expect, test } from "bun:test";
import { backlinks, mainImage, parseLinks, renameLinks } from "./notes.ts";
import type { Note } from "./state.ts";

test("parseLinks finds plain, heading, and labeled links", () => {
	expect(parseLinks("a [[B]] [[C#Lair|the lair]] [[]] [[D|]] [x](y)")).toEqual([
		{ from: 2, to: 7, title: "B", label: undefined },
		{ from: 8, to: 27, title: "C", label: "the lair" },
		{ from: 33, to: 39, title: "D", label: "" },
	]);
});

test("renameLinks rewrites plain, labeled, and heading links only", () => {
	const body =
		"[[Old]] and [[Old|the old one]] and [[Old#Lair]]. Not [[Older]], [[old]], or [Old].";
	expect(renameLinks(body, "Old", "New $1")).toBe(
		"[[New $1]] and [[New $1|the old one]] and [[New $1#Lair]]. Not [[Older]], [[old]], or [Old].",
	);
	expect(renameLinks("[[A (b).c]]", "A (b).c", "D")).toBe("[[D]]");
});

const note = (links: string[], images: string[] = [], roles = {}): Note => ({
	metadata: { images: roles },
	images,
	links,
	bodyVersion: "",
});

test("backlinks lists the other notes linking to a title", () => {
	const notes = { A: note(["B", "A"]), B: note(["A"]), C: note([]) };
	expect(backlinks(notes, "A")).toEqual(["B"]);
	expect(backlinks(notes, "B")).toEqual(["A"]);
});

test("the main picture is the main image, else the only image without a role", () => {
	expect(mainImage(note([], ["a.png", "b.png"], { "b.png": "main" }))).toBe(
		"b.png",
	);
	expect(mainImage(note([], ["a.png", "b.png"]))).toBeUndefined();
	expect(mainImage(note([], ["a.png"]))).toBe("a.png");
	expect(mainImage(note([], ["a.png"], { "a.png": "map" }))).toBeUndefined();
	expect(mainImage(note([]))).toBeUndefined();
});
