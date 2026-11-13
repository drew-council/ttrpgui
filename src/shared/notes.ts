// Note content rules shared by the server and the client: wiki links, image files, the main picture, and dates.
import type { Note } from "./state.ts";

export const imageFile = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

/** `[[Title]]`, `[[Title#heading]]`, `[[Title|label]]`. Titles cannot contain `[ ] | #`. */
const wikiLink = /\[\[([^[\]|#\n]+)(#[^[\]|\n]*)?(?:\|([^[\]\n]*))?\]\]/g;

export type WikiLink = {
	from: number;
	to: number;
	title: string;
	label?: string;
};

/** Every wiki link in `text`, in order. */
export function parseLinks(text: string): WikiLink[] {
	return [...text.matchAll(wikiLink)].map((m) => ({
		from: m.index,
		to: m.index + m[0].length,
		title: m[1] as string,
		label: m[3],
	}));
}

/** The distinct titles `body` links to. */
export const linkTargets = (body: string) => [
	...new Set(parseLinks(body).map((link) => link.title)),
];

/** Titles of the notes that link to `title`. */
export const backlinks = (notes: Record<string, Note>, title: string) =>
	Object.keys(notes).filter(
		(other) => other !== title && notes[other]?.links.includes(title),
	);

/** Rewrites links to `from` so they point at `to`, keeping headings and labels. */
export const renameLinks = (body: string, from: string, to: string) =>
	body.replace(wikiLink, (link, title: string, heading = "", label?: string) =>
		title === from
			? `[[${to}${heading}${label === undefined ? "" : `|${label}`}]]`
			: link,
	);

/** The image with role main, else the note's only image unless it has another role. */
export function mainImage({ metadata, images }: Note) {
	const roles = metadata.images ?? {};
	const main = images.find((image) => roles[image] === "main");
	if (main || images.length !== 1) return main;
	return roles[images[0] as string] ? undefined : images[0];
}

/** Today as `2026-11-07`, in local time: a new Session's date. */
export function localDate() {
	const d = new Date();
	return [d.getFullYear(), d.getMonth() + 1, d.getDate()]
		.map((n) => String(n).padStart(2, "0"))
		.join("-");
}
