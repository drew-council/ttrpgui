import { expect, test } from "bun:test";
import {
	backlinks,
	formatDate,
	localDate,
	mainImage,
	noteLabel,
	parseLinks,
	renameLinks,
	sessionOrder,
} from "./notes.ts";
import type { Metadata } from "./schema.ts";
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

const session = (date?: string, name?: string): Note => ({
	metadata: { kind: "session", date, name },
	images: [],
	links: [],
	bodyVersion: "",
});

test("a Session shows its date, then its name, else its title unless made from a date", () => {
	expect(noteLabel("2026-01-01", session("2026-01-01"))).toBe("Jan 1, 2026");
	expect(noteLabel("2026-10-11", session("2026-10-11", "Aruun"))).toBe(
		"Oct 11, 2026 · Aruun",
	);
	expect(noteLabel("Session 1", session("2025-12-31"))).toBe(
		"Dec 31, 2025 · Session 1",
	);
	// A second session made the same day.
	expect(noteLabel("2026-11-14 (2)", session("2026-11-14"))).toBe(
		"Nov 14, 2026",
	);
	expect(noteLabel("2026-11-14 (2)", session("2026-11-14", "Docks"))).toBe(
		"Nov 14, 2026 · Docks",
	);
	// Undated: the name, else the title, else a stand-in for a date title.
	expect(noteLabel("2026-11-14", session(undefined, "Aruun"))).toBe("Aruun");
	expect(noteLabel("Finale", session(undefined, "Last Stand"))).toBe(
		"Last Stand",
	);
	expect(noteLabel("Finale", session())).toBe("Finale");
	expect(noteLabel("2026-11-14 (2)", session())).toBe("Undated session");
	const plain: Metadata = { kind: "creature" };
	expect(noteLabel("2026-10-11", { ...session(), metadata: plain })).toBe(
		"2026-10-11",
	);
});

test("a short date drops the year only in the current year", () => {
	const year = localDate().slice(0, 4);
	expect(formatDate(`${year}-03-08`, true)).toBe("Mar 8");
	expect(formatDate(`${year}-03-08`)).toBe(`Mar 8, ${year}`);
	expect(formatDate("1999-12-31", true)).toBe("Dec 31 ’99");
	expect(formatDate("1999-12-31")).toBe("Dec 31, 1999");
});

test("Sessions sort most recent first, the later title first within a day, then undated ones by title", () => {
	const notes = {
		Old: session("2025-12-20"),
		"Session 10": session(),
		New: session("2026-11-21"),
		"Session 9": session(),
		"2026-01-02": session("2026-01-02"),
		"2026-01-02 (2)": session("2026-01-02"),
	};
	expect(Object.keys(notes).sort(sessionOrder(notes))).toEqual([
		"New",
		"2026-01-02 (2)",
		"2026-01-02",
		"Old",
		"Session 9",
		"Session 10",
	]);
});
