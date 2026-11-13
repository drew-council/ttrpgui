// Combat rules as plain edits of Combat data: turn order, turns, HP, conditions, and initiative.
// Each edits its argument in place, so callers pass a copy. Mutations are thin wrappers around them.
import type { Combat, Combatant, Hp, Statblock } from "./schema.ts";
import type { Note } from "./state.ts";

type Notes = Record<string, Note>;

export const conditionNames = [
	"Blinded",
	"Charmed",
	"Deafened",
	"Exhaustion",
	"Frightened",
	"Grappled",
	"Incapacitated",
	"Invisible",
	"Paralyzed",
	"Petrified",
	"Poisoned",
	"Prone",
	"Restrained",
	"Stunned",
	"Unconscious",
];

export const statblockOf = (notes: Notes, c: Combatant): Statblock =>
	notes[c.creature]?.statblock ?? {};

export function isPc(notes: Notes, c: Combatant) {
	const metadata = notes[c.creature]?.metadata;
	return metadata?.kind === "creature" && !!metadata.pc;
}

/** A Combatant's HP state: a PC's comes from its metadata, an NPC's from the Combat. */
export function hpOf(notes: Notes, c: Combatant): Hp {
	const metadata = notes[c.creature]?.metadata;
	return (
		(metadata?.kind === "creature" && metadata.pc ? metadata.hp : c.hp) ?? {}
	);
}

export const maxHp = (sb: Statblock, hp: Hp) =>
	(sb.hp ?? 0) + (hp.max_adjust ?? 0);

export const currentHp = (sb: Statblock, hp: Hp) => hp.current ?? maxHp(sb, hp);

export const concentrationDC = (damage: number) =>
	Math.max(10, Math.floor(damage / 2));

/** Labels in turn order: initiative descending, then initiative bonus, then label. No initiative goes last. */
export function order(combat: Combat, notes: Notes): string[] {
	const combatants = combat.combatants ?? {};
	const key = (label: string): [number, number] => {
		const c = combatants[label] as Combatant;
		return [c.initiative ?? -Infinity, statblockOf(notes, c).initiative ?? 0];
	};
	return Object.keys(combatants).sort((a, b) => {
		const [initA, bonusA] = key(a);
		const [initB, bonusB] = key(b);
		// -Infinity minus -Infinity is NaN, which falls through like a tie.
		return (
			initB - initA ||
			bonusB - bonusA ||
			a.localeCompare(b, undefined, { numeric: true })
		);
	});
}

function hpDraft(c: Combatant) {
	c.hp ??= {};
	return c.hp;
}

/** A per-Combatant rule. `c.hp` holds its HP state, a PC's included. */
export type Rule<P> = (c: Combatant, payload: P, sb: Statblock) => void;
type Amount = { amount: number };

export const rules = {
	/** Temp HP absorbs damage first. HP stops at 0. */
	damage(c: Combatant, { amount }: Amount, sb: Statblock) {
		const hp = hpDraft(c);
		const absorbed = Math.min(hp.temp ?? 0, amount);
		hp.temp = (hp.temp ?? 0) - absorbed;
		hp.current = Math.max(0, currentHp(sb, hp) - amount + absorbed);
	},
	/** Healing stops at max HP and clears death saves. */
	heal(c: Combatant, { amount }: Amount, sb: Statblock) {
		const hp = hpDraft(c);
		hp.current = Math.min(maxHp(sb, hp), currentHp(sb, hp) + amount);
		delete c.death_saves;
	},
	/** A new temp HP value replaces the old one. */
	setTempHp(c: Combatant, { amount }: Amount) {
		hpDraft(c).temp = amount;
	},
	/** Raising max HP raises current HP as much, as Aid does. Lowering it caps current HP. */
	setMaxAdjust(c: Combatant, { amount }: Amount, sb: Statblock) {
		const hp = hpDraft(c);
		const current = currentHp(sb, hp);
		const gain = Math.max(0, amount - (hp.max_adjust ?? 0));
		hp.max_adjust = amount;
		hp.current = Math.min(maxHp(sb, hp), current + gain);
	},
	setInitiative(c: Combatant, { amount }: Amount) {
		c.initiative = amount;
	},
	/** Without `rounds`, the condition lasts until removed. */
	addCondition(c: Combatant, p: { name: string; rounds?: number }) {
		c.conditions = { ...c.conditions, [p.name]: p.rounds ?? true };
	},
	removeCondition(c: Combatant, { name }: { name: string }) {
		delete c.conditions?.[name];
	},
	toggleConcentration(c: Combatant) {
		c.concentrating = !c.concentrating;
	},
	deathSave(c: Combatant, { failure }: { failure: boolean }, sb: Statblock) {
		if (currentHp(sb, c.hp ?? {}) > 0)
			throw new Error("Death saves are only for creatures at 0 HP");
		const key = failure ? "failure" : "success";
		const saves = c.death_saves ?? {};
		c.death_saves = { ...saves, [key]: Math.min(3, (saves[key] ?? 0) + 1) };
	},
	spendLegendary(
		c: Combatant,
		{ kind }: { kind: "actions" | "resistances" },
		sb: Statblock,
	) {
		const key = `legendary_${kind}` as const;
		const left = c[key] ?? sb[key] ?? 0;
		if (left <= 0) throw new Error(`No legendary ${kind} left`);
		c[key] = left - 1;
	},
	setNote(c: Combatant, { note }: { note: string }) {
		c.note = note;
	},
};

/** Applies `rule` to each labeled Combatant. */
export function edit<P>(
	combat: Combat,
	notes: Notes,
	labels: string[],
	rule: Rule<P>,
	payload: P,
) {
	for (const label of labels) {
		const c = combat.combatants?.[label];
		if (!c) throw new Error(`No combatant labeled “${label}”`);
		const sb = statblockOf(notes, c);
		rule(c, payload, sb);
		tidy(c, sb);
	}
}

/** Drops values that equal their defaults, so files stay small. */
function tidy(c: Combatant, sb: Statblock) {
	const { hp } = c;
	if (hp) {
		if (!hp.temp) delete hp.temp;
		if (!hp.max_adjust) delete hp.max_adjust;
		if (hp.current === maxHp(sb, hp)) delete hp.current;
		if (!Object.keys(hp).length) delete c.hp;
	}
	if (c.conditions && !Object.keys(c.conditions).length) delete c.conditions;
	if (!c.concentrating) delete c.concentrating;
	if (c.legendary_actions === sb.legendary_actions) delete c.legendary_actions;
	if (!c.note) delete c.note;
}

/** Labels for `count` new Combatants of `title`: the title alone, else "Goblin A", "Goblin B", and so on. */
export function newLabels(title: string, count: number, taken: string[]) {
	if (count === 1 && !taken.includes(title) && !taken.includes(`${title} A`))
		return [title];
	const labels: string[] = [];
	for (let i = 0; labels.length < count; i++) {
		const label = `${title} ${i < 26 ? String.fromCharCode(65 + i) : i + 1}`;
		if (!taken.includes(label)) labels.push(label);
	}
	return labels;
}

export function addCombatants(
	combat: Combat,
	{ creature, count }: { creature: string; count: number },
) {
	if (!Number.isInteger(count) || count < 1 || count > 50)
		throw new Error("Add between 1 and 50 combatants");
	const combatants = combat.combatants ?? {};
	for (const label of newLabels(creature, count, Object.keys(combatants)))
		combatants[label] = { creature };
	combat.combatants = combatants;
}

/** Removes Combatants. Removing the active one passes the turn on. */
export function removeCombatants(
	combat: Combat,
	notes: Notes,
	labels: string[],
) {
	const before = order(combat, notes);
	for (const label of labels) delete combat.combatants?.[label];
	if (combat.turn !== undefined && !combat.combatants?.[combat.turn])
		moveTurn(combat, before);
}

export function renameCombatant(combat: Combat, label: string, raw: string) {
	const combatants = combat.combatants ?? {};
	const to = raw.trim();
	if (!combatants[label]) throw new Error(`No combatant labeled “${label}”`);
	if (!to) throw new Error("A label cannot be empty");
	if (Object.hasOwn(combatants, to))
		throw new Error(`“${to}” is already in this combat`);
	combat.combatants = Object.fromEntries(
		Object.entries(combatants).map(([l, c]) => [l === label ? to : l, c]),
	);
	if (combat.turn === label) combat.turn = to;
}

/** Rolls d20 plus initiative bonus once per Creature, for NPCs without initiative. `random` returns [0, 1). */
export function rollInitiative(
	combat: Combat,
	notes: Notes,
	random: () => number,
) {
	const rolls = new Map<string, number>();
	for (const c of Object.values(combat.combatants ?? {})) {
		if (c.initiative !== undefined || isPc(notes, c)) continue;
		const roll =
			rolls.get(c.creature) ??
			1 + Math.floor(random() * 20) + (statblockOf(notes, c).initiative ?? 0);
		rolls.set(c.creature, roll);
		c.initiative = roll;
	}
}

/** Starts round 1 with the first Combatant in order. Nobody has acted yet. */
export function start(combat: Combat, notes: Notes) {
	end(combat);
	combat.round = 1;
	moveTurn(combat, order(combat, notes));
	if (combat.turn === undefined) throw new Error("Add combatants first");
}

export function end(combat: Combat) {
	delete combat.round;
	delete combat.turn;
	for (const c of Object.values(combat.combatants ?? {})) delete c.acted;
}

/** Ends the active Combatant's turn, ticking its conditions down, and starts the next one's. */
export function nextTurn(combat: Combat, notes: Notes) {
	if (combat.round === undefined) throw new Error("This combat is not running");
	const active = combat.combatants?.[combat.turn ?? ""];
	const conditions = active?.conditions ?? {};
	for (const [name, rounds] of Object.entries(conditions)) {
		if (rounds === true) continue;
		if (rounds > 1) conditions[name] = rounds - 1;
		else delete conditions[name];
	}
	if (active && !Object.keys(conditions).length) delete active.conditions;
	moveTurn(combat, order(combat, notes));
}

/**
 * Gives the turn to the next Combatant after the active one in `labels` that still exists, adding a
 * round on wrapping. Its legendary actions refill and it counts as having acted.
 */
function moveTurn(combat: Combat, labels: string[]) {
	const at = labels.indexOf(combat.turn ?? "");
	for (let i = at + 1; i <= at + labels.length; i++) {
		const label = labels[i % labels.length] as string;
		const c = combat.combatants?.[label];
		if (!c) continue;
		if (i >= labels.length) combat.round = (combat.round ?? 0) + 1;
		combat.turn = label;
		c.acted = true;
		delete c.legendary_actions;
		return;
	}
	delete combat.turn;
}
