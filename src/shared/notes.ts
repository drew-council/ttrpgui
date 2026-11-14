// Note content rules shared by the server and the client: wiki links, image files, the main picture, dates, and labels.
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

const months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split(" ");

/** `2026-10-11` as `Oct 11, 2026`; when `short`, `Oct 11` in the current year, else `Oct 11 ’25`. Read from the
 * string so no time zone can shift it. */
export function formatDate(iso: string, short = false) {
	const [year = "", month, day] = iso.split("-");
	const md = `${months[Number(month) - 1]} ${Number(day)}`;
	if (!short) return `${md}, ${year}`;
	return year === localDate().slice(0, 4) ? md : `${md} ’${year.slice(2)}`;
}

const sessionDate = (note?: Note) =>
	(note?.metadata.kind === "session" && note.metadata.date) || undefined;

/** A title made from a date, as "New session" makes: `2026-11-14`, `2026-11-14 (2)`. Labels never show it. */
export const isDateTitle = (title: string) =>
	/^\d{4}-\d{2}-\d{2}( \(\d+\))?$/.test(title);

/** A note's title as people see it, in parts. A Session shows its date (ISO), then its name, else its title unless
 * made from a date; with neither, "Undated session". Every other note shows its title. */
export function labelParts(
	title: string,
	note?: Note,
): { date?: string; name?: string } {
	if (note?.metadata.kind !== "session") return { name: title };
	const { date, name } = note.metadata;
	const shown = name || (isDateTitle(title) ? undefined : title);
	return date || shown ? { date, name: shown } : { name: "Undated session" };
}

/** A note's title as plain text: `Oct 11, 2026 · Aruun`. See `labelParts`. */
export const noteLabel = (title: string, note?: Note) => {
	const { date, name } = labelParts(title, note);
	return [date && formatDate(date), name].filter(Boolean).join(" · ");
};

/** Compares Session titles: most recent date first, the later title first within a day, then undated ones by title.
 * Other notes count as undated. */
export const sessionOrder =
	(notes: Record<string, Note>) => (a: string, b: string) =>
		(sessionDate(notes[b]) ?? "").localeCompare(sessionDate(notes[a]) ?? "") ||
		(sessionDate(notes[a]) ? -1 : 1) *
			a.localeCompare(b, undefined, { numeric: true });
