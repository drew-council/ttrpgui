// The combat view: the tracker on the left; the note and stat block of the Combatant under the cursor on the right.
// Tracker Actions (in actions.ts) act on `target()`: the selection, else the cursor row.
import { cn } from "cn";
import { useEffect, useMemo, useRef } from "react";
import { Badge } from "#components/ui/badge.tsx";
import { Button } from "#components/ui/button.tsx";
import { Progress } from "#components/ui/progress.tsx";
import {
	concentrationDC,
	conditionNames,
	currentHp,
	hpOf,
	isPc,
	maxHp,
	order,
	statblockOf,
} from "../shared/combat.ts";
import type { Combat, Combatant } from "../shared/schema.ts";
import { toInt } from "../shared/statblock.ts";
import type { Note } from "../shared/state.ts";
import { useListNav } from "./list.ts";
import { MarkdownBox } from "./MarkdownBox.tsx";
import { fieldBox, StatBlock } from "./StatBlock.tsx";
import { getGame, send, useGame } from "./sync.ts";
import { ask, type Item, noteTab, openTab, toast, ui } from "./ui.ts";
import { KindMark, kindLabels, kindOf, pageMeta, pageTitle } from "./views.tsx";

export const combatTab = (name: string) => `combat:${name}`;

/** The tracker as last rendered: its Combat, labels in turn order, and the cursor row. */
let tracker: { combat: string; labels: string[]; cursor?: string } | undefined;

export const trackerFocused = () =>
	tracker !== undefined && !!document.activeElement?.closest("[data-tracker]");

export type Target = { combat: string; labels: string[] };

/** What tracker Actions act on: the selected rows, else the cursor row. */
export function target(): Target {
	const { combat = "", labels = [], cursor } = tracker ?? {};
	const selected = ui.get().selected.filter((l) => labels.includes(l));
	return {
		combat,
		labels: selected.length ? selected : cursor ? [cursor] : [],
	};
}

export const cursorLabel = () => tracker?.cursor;

export const describe = (labels: string[]) =>
	labels.length > 3 ? `${labels.length} combatants` : labels.join(", ");

export function toggleSelect() {
	const { cursor } = tracker ?? {};
	if (!cursor) return;
	const { selected } = ui.get();
	ui.set({
		selected: selected.includes(cursor)
			? selected.filter((l) => l !== cursor)
			: [...selected, cursor],
	});
}

export const focusNote = () =>
	document
		.querySelector<HTMLElement>("[data-combatant-note] .cm-content")
		?.focus();

const focusTracker = () =>
	document.querySelector<HTMLElement>("[data-tracker]")?.focus();

const combatantsOf = ({ combat, labels }: Target) =>
	labels.map((l) => getGame().combats[combat]?.combatants?.[l]);

/** Prompts for a whole number of at least `min`. */
export function askNumber(
	spec: {
		title: string;
		label: (n: number) => string;
		min?: number;
		value?: string;
		items?: Item[];
	},
	apply: (n: number) => void,
) {
	const { label, min = 0, ...rest } = spec;
	const parse = (query: string) => {
		const n = toInt(query);
		return typeof n === "number" && n >= min ? n : undefined;
	};
	ask(
		{ placeholder: "Number", ...rest },
		(query) => {
			const n = parse(query);
			return n === undefined ? undefined : label(n);
		},
		(query) => apply(parse(query) as number),
	);
}

/** Toasts the concentration save DC for targets that are concentrating. */
export function checkConcentration(t: Target, damage: number) {
	const who = t.labels.filter((_, i) => combatantsOf(t)[i]?.concentrating);
	if (who.length)
		toast(`Concentration save DC ${concentrationDC(damage)}: ${describe(who)}`);
}

/** Picks a creature, or names a new one, then asks how many to add. */
export function addCombatant(combat: string) {
	const { notes } = getGame();
	const add = (creature: string) =>
		askNumber(
			{
				title: `How many “${creature}”?`,
				label: (n) => `Add ${n}`,
				min: 1,
				value: "1",
			},
			(count) => send({ type: "addCombatants", combat, creature, count }),
		);
	ask(
		{
			title: "Add a combatant",
			placeholder: "Creature",
			items: Object.keys(notes)
				.filter((title) => notes[title]?.metadata.kind === "creature")
				.sort()
				.map((title) => ({
					label: title,
					detail: kindLabels[kindOf(notes[title])],
					run: () => add(title),
				})),
		},
		(title) =>
			title && !Object.hasOwn(notes, title)
				? `New creature “${title}”`
				: undefined,
		(title) =>
			ask(
				{ title: `HP and AC of “${title}”`, placeholder: "HP AC, like 11 13" },
				(query) => {
					const [hp, ac] = query.match(/^(\d+)\s+(\d+)$/)?.slice(1) ?? [];
					return hp && `Create “${title}” with ${hp} HP and AC ${ac}`;
				},
				async (query) => {
					const [hp = 0, ac = 0] = query.split(/\s+/).map(Number);
					if (
						(await send({ type: "createNote", title, kind: "creature" })) &&
						(await send({
							type: "saveStatblock",
							title,
							statblock: { hp, ac },
						}))
					)
						add(title);
				},
			),
	);
}

/** Removes a condition every target has; otherwise adds it, asking for a number of rounds. */
export function toggleCondition(t: Target) {
	const combatants = combatantsOf(t);
	const has = (name: string) =>
		combatants.every((c) => c?.conditions?.[name] !== undefined);
	const present = combatants.flatMap((c) => Object.keys(c?.conditions ?? {}));
	const names = [...new Set([...present, ...conditionNames])];
	const add = (name: string) =>
		askNumber(
			{
				title: `How many rounds of ${name}?`,
				label: (n) => `${name} for ${n} ${n === 1 ? "round" : "rounds"}`,
				min: 1,
				items: [
					{
						label: "Until removed",
						run: () => send({ type: "addCondition", ...t, name }),
					},
				],
			},
			(rounds) => send({ type: "addCondition", ...t, name, rounds }),
		);
	ask(
		{
			title: `Toggle a condition on ${describe(t.labels)}`,
			placeholder: "Condition",
			items: names.map((name) => ({
				label: name,
				detail: has(name) ? "Remove" : undefined,
				run: () =>
					has(name) ? send({ type: "removeCondition", ...t, name }) : add(name),
			})),
		},
		(name) =>
			name && !names.some((n) => n.toLowerCase() === name.toLowerCase())
				? `Add “${name}”`
				: undefined,
		add,
	);
}

export function CombatView({ arg: name }: { arg: string }) {
	const combat = useGame((game) => game.combats[name] as Combat);
	const notes = useGame((game) => game.notes);
	const running = useGame((game) => game.runtime.combat === name);
	const selected = ui.use((s) => s.selected);
	const labels = useMemo(() => order(combat, notes), [combat, notes]);
	const nav = useListNav(labels.length, (i, newTab) => {
		const c = combat.combatants?.[labels[i] as string];
		if (c) openTab(noteTab(c.creature), newTab);
	});
	const cursor = labels[nav.index];
	tracker = { combat: name, labels, cursor };
	const { ref, setIndex } = nav;
	useEffect(() => {
		ref.current?.focus();
		return () => ui.set({ selected: [] });
	}, [ref]);
	// The cursor follows the turn; otherwise it stays on its Combatant when the order changes, even when renamed.
	const turn = combat.turn;
	const last = useRef<{ turn?: string; cursor?: string; labels?: string[] }>(
		{},
	);
	useEffect(() => {
		const { cursor: was, labels: before = [] } = last.current;
		const added = labels.filter((l) => !before.includes(l));
		const renamed =
			was && !labels.includes(was) && added.length === 1 ? added[0] : was;
		const follow = turn === last.current.turn ? renamed : turn;
		last.current.turn = turn;
		last.current.labels = labels;
		const i = labels.indexOf(follow ?? "");
		if (i < 0) return;
		setIndex(i);
		ref.current?.children[i]?.scrollIntoView({ block: "nearest" });
	}, [labels, turn, setIndex, ref]);
	useEffect(() => {
		last.current.cursor = cursor;
	});

	const c = cursor === undefined ? undefined : combat.combatants?.[cursor];
	return (
		<section className="mx-auto grid h-full max-w-[110rem] grid-cols-[minmax(0,1fr)_minmax(20rem,28rem)] grid-rows-[auto_auto_minmax(0,1fr)] gap-x-6 px-6 pt-4 @min-[100rem]:grid-cols-[minmax(0,1fr)_34rem] @max-[52rem]:h-auto @max-[52rem]:grid-cols-[minmax(0,1fr)] @max-[52rem]:grid-rows-none">
			<header>
				<h1 className={cn(pageTitle, "text-2xl/[1.1]")}>{name}</h1>
				<p className={cn(pageMeta, "mb-3")}>
					<span className={cn(running && "font-bold text-primary")}>
						{running ? `Round ${combat.round}` : "Not running"}
					</span>
					{combat.session && (
						<Button
							variant="link"
							className="h-auto p-0 font-normal text-muted-foreground hover:text-foreground"
							onClick={() => openTab(noteTab(combat.session as string))}
						>
							{combat.session}
						</Button>
					)}
				</p>
			</header>
			<div
				className={cn(
					columns,
					"border-b pb-1 text-xs font-bold tracking-[0.06em] text-faint uppercase",
				)}
				aria-hidden
			>
				<span className="col-start-2">Init</span>
				<span>Combatant</span>
				<span className="text-center">AC</span>
				<span className="text-right">HP</span>
			</div>
			<div
				className="group/tracker flex flex-col gap-0.5 overflow-y-auto pt-2 pb-6 outline-none"
				data-tracker
				role="listbox"
				aria-label="Combatants"
				aria-multiselectable
				ref={nav.ref}
				tabIndex={0}
				onKeyDown={nav.onKeyDown}
			>
				{labels.map((label, i) => {
					const active = running && label === turn;
					return (
						// biome-ignore lint/a11y/useKeyWithClickEvents: the list handles keys.
						<div
							key={label}
							role="option"
							tabIndex={-1}
							aria-selected={i === nav.index}
							data-turn={active || undefined}
							data-picked={selected.includes(label) || undefined}
							onClick={() => nav.setIndex(i)}
							// Cursor: an outline, brighter while the tracker has focus. Selection: blue. Active turn: amber. They combine.
							className={cn(
								columns,
								"min-h-11 shrink-0 rounded-lg border border-transparent py-1 aria-selected:border-border group-focus/tracker:aria-selected:border-muted-foreground data-picked:shadow-[inset_3px_0_var(--select)] data-picked:not-data-turn:bg-select/14 data-turn:bg-primary/14",
							)}
						>
							<Row
								label={label}
								c={combat.combatants?.[label] as Combatant}
								notes={notes}
								turn={active}
							/>
						</div>
					);
				})}
			</div>
			{!labels.length && (
				<p className="py-4 text-muted-foreground">
					No combatants. Run “Add combatant”.
				</p>
			)}
			{c && cursor && (
				<aside className="col-start-2 row-span-full min-h-0 overflow-y-auto border-l pb-6 pl-6 @max-[52rem]:col-auto @max-[52rem]:row-auto @max-[52rem]:mt-6 @max-[52rem]:border-0 @max-[52rem]:pl-0">
					<h2 className="mb-2 flex flex-wrap items-baseline gap-x-3 font-serif text-2xl/[1.2] font-semibold italic">
						{cursor}
						{c.creature !== cursor && (
							<span className="font-sans text-sm font-normal text-muted-foreground not-italic">
								{c.creature}
							</span>
						)}
					</h2>
					{/* biome-ignore lint/a11y/noStaticElementInteractions: Escape in the note returns to the tracker. */}
					<div
						className={cn(fieldBox, "md-small mb-4 px-2 py-1")}
						data-combatant-note
						onKeyDown={(e) => {
							if (e.key === "Escape") {
								e.preventDefault();
								focusTracker();
							}
						}}
					>
						<MarkdownBox
							key={`${name}\0${cursor}`}
							value={c.note ?? ""}
							placeholder="Notes on this combatant"
							onSave={(note) =>
								send({
									type: "setCombatantNote",
									combat: name,
									labels: [cursor],
									note,
								})
							}
						/>
					</div>
					<StatBlock title={c.creature} />
				</aside>
			)}
		</section>
	);
}

/** The tracker's columns: turn mark, initiative, combatant, AC, HP. Shared by the heading and the rows. */
const columns =
	"grid grid-cols-[1.25rem_2.5rem_minmax(0,1fr)_2.5rem_minmax(7rem,18%)] items-center gap-x-3 pr-3";
const figure = "font-serif text-lg/none font-semibold tabular-nums lining-nums";
const chip = "border-border";
const danger = "border-destructive font-bold text-destructive";

function Row({
	label,
	c,
	notes,
	turn,
}: {
	label: string;
	c: Combatant;
	notes: Record<string, Note>;
	turn: boolean;
}) {
	const sb = statblockOf(notes, c);
	const hp = hpOf(notes, c);
	const max = maxHp(sb, hp);
	const current = currentHp(sb, hp);
	const note = notes[c.creature];
	const pc = isPc(notes, c);
	const missing = note?.metadata.kind !== "creature";
	const down = max > 0 && current <= 0;
	const hurt = !down && current * 2 <= max;
	const saves = c.death_saves ?? {};
	return (
		<>
			<span className="text-center text-primary" aria-hidden>
				{turn && "▶"}
			</span>
			<span className={cn(figure, "text-center", turn && "text-primary")}>
				{c.initiative ?? "–"}
			</span>
			<span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
				<span
					className={cn(
						"flex min-w-0 items-center gap-2 text-lg font-medium",
						turn && "text-primary",
					)}
				>
					<KindMark kind={kindOf(note)} />
					<span
						className={cn("truncate", down && !pc && "text-faint line-through")}
					>
						{label}
					</span>
					{c.note && (
						<span className="text-faint" title="Has a note">
							✎
						</span>
					)}
				</span>
				{missing && (
					<Badge variant="secondary" className={cn(chip, danger)}>
						No creature “{c.creature}”
					</Badge>
				)}
				{down &&
					(pc ? (
						<Badge variant="secondary" className={cn(chip, danger)}>
							Dying{" "}
							<Pips n={saves.success ?? 0} max={3} className="text-kind-pc" />
							<Pips
								n={saves.failure ?? 0}
								max={3}
								className="text-destructive"
							/>
						</Badge>
					) : (
						<Badge variant="secondary" className={cn(chip, danger)}>
							Down
						</Badge>
					))}
				{c.concentrating && (
					<Badge
						variant="secondary"
						className={cn(chip, "border-kind-session text-kind-session")}
					>
						Conc.
					</Badge>
				)}
				{Object.entries(c.conditions ?? {}).map(([name, rounds]) => (
					<Badge key={name} variant="secondary" className={chip}>
						{name}
						{rounds !== true && <b className="text-primary">{rounds}</b>}
					</Badge>
				))}
				{sb.legendary_actions ? (
					<Badge
						variant="secondary"
						className={cn(chip, "text-kind-npc")}
						title="Legendary actions"
					>
						LA{" "}
						<Pips
							n={c.legendary_actions ?? sb.legendary_actions}
							max={sb.legendary_actions}
						/>
					</Badge>
				) : null}
				{sb.legendary_resistances ? (
					<Badge
						variant="secondary"
						className={cn(chip, "text-kind-npc")}
						title="Legendary resistances"
					>
						LR{" "}
						<Pips
							n={c.legendary_resistances ?? sb.legendary_resistances}
							max={sb.legendary_resistances}
						/>
					</Badge>
				) : null}
			</span>
			<span className={cn(figure, "text-center text-muted-foreground")}>
				{sb.ac ?? "–"}
			</span>
			<span
				className={cn(
					"grid gap-[3px] text-right",
					hurt && "text-primary",
					down && "text-destructive",
				)}
			>
				<span className={figure}>
					{current}
					<small className="text-sm text-faint">/{max}</small>
					{hp.temp ? (
						<span className="ml-1 text-sm text-kind-location">+{hp.temp}</span>
					) : null}
				</span>
				<Progress
					value={max ? (100 * current) / max : 0}
					className={cn(
						"bg-border",
						hurt ? "*:bg-primary" : down ? "*:bg-transparent" : "*:bg-kind-pc",
					)}
				/>
			</span>
		</>
	);
}

/** `n` of `max` filled dots. */
function Pips({
	n,
	max,
	className,
}: {
	n: number;
	max: number;
	className?: string;
}) {
	return (
		<span className={cn("tracking-[0.1em]", className)}>
			{Array.from({ length: max }, (_, i) => (i < n ? "●" : "○")).join("")}
		</span>
	);
}
