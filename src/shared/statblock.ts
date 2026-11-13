// Stat block rules: ability modifiers and the text forms of bonuses, as shown and as typed.

export const abilities = ["str", "dex", "con", "int", "wis", "cha"] as const;

export const modifier = (score: number) => Math.floor((score - 10) / 2);

/** `3` → `+3`, `-1` → `−1`. */
export const signed = (n: number) => (n < 0 ? `−${-n}` : `+${n}`);

/** `sleight_of_hand` → `Sleight of Hand`. */
const keyLabel = (key: string) =>
	key
		.split("_")
		.map((word, i) =>
			i && word === "of" ? word : word[0]?.toUpperCase() + word.slice(1),
		)
		.join(" ");

/** `{ perception: 8, stealth: 6 }` → `Perception +8, Stealth +6`. */
export const formatBonuses = (bonuses: Record<string, number>) =>
	Object.entries(bonuses)
		.map(([key, n]) => `${keyLabel(key)} ${signed(n)}`)
		.join(", ");

/** A whole number like `17`, `+3`, or `−1`. Anything else comes back unchanged, for the schema to reject. */
export function toInt(text: string): number | string {
	const n = text.trim().replace("−", "-");
	return /^[+-]?\d+$/.test(n) ? Number(n) : text;
}

/**
 * The reverse of `formatBonuses`: `Perception +8, Sleight of Hand +6` → `{ perception: 8, sleight_of_hand: 6 }`.
 * `key` turns a name into a key. Text that does not parse comes back unchanged, for the schema to reject.
 */
export function parseBonuses(
	text: string,
	key = (name: string) => name.toLowerCase().replace(/\s+/g, "_"),
): Record<string, number> | string {
	const bonuses: Record<string, number> = {};
	for (const item of text.split(",")) {
		const match = item.trim().match(/^(.*?)\s*([-+−]?\d+)$/);
		if (!match?.[1]) return text;
		bonuses[key(match[1])] = toInt(match[2] as string) as number;
	}
	return bonuses;
}

/** Saves name abilities by their first three letters: `Dex +6` or `Dexterity +6`. */
export const parseSaves = (text: string) =>
	parseBonuses(text, (name) => name.toLowerCase().slice(0, 3));
