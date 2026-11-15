// The combat view: the tracker on the left; the note and stat block of the Combatant under the cursor on the right.
// Tracker Actions (in actions.ts) act on `target()`: the selection, else the cursor row.
import type { EditorView } from "@codemirror/view";
import { cn } from "cn";
import { CrosshairIcon } from "lucide-react";
import {
	type Dispatch,
	type RefObject,
	type SetStateAction,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Badge } from "#components/ui/badge.tsx";
import { Button } from "#components/ui/button.tsx";
import {
	DropdownMenuLabel,
	DropdownMenuSeparator,
} from "#components/ui/dropdown-menu.tsx";
import { Progress } from "#components/ui/progress.tsx";
import { Separator } from "#components/ui/separator.tsx";
import {
	canFight,
	concentrationDC,
	conditionNames,
	currentHp,
	hpOf,
	isPc,
	maxHp,
	order,
	statblockOf,
} from "../shared/combat.ts";
import {
	hasDice,
	isNumber,
	parse,
	rollAll,
	showNumber,
	value,
} from "../shared/dice.ts";
import { noteLabel } from "../shared/notes.ts";
import type { Combat, Combatant } from "../shared/schema.ts";
import type { Note } from "../shared/state.ts";
import { renameCombat } from "./actions.ts";
import { ActionButton, ActionItem, ActionMenu } from "./controls.tsx";
import { Dice, Rolls } from "./Dice.tsx";
import { useListNav } from "./list.ts";
import { MarkdownBox } from "./MarkdownBox.tsx";
import { fieldBox, StatBlock } from "./StatBlock.tsx";
import { getGame, send, useGame } from "./sync.ts";
import {
	addRoll,
	ask,
	clickOpens,
	type Item,
	noteTab,
	openTab,
	pick,
	places,
	toast,
} from "./ui.ts";
import {
	activePane,
	argOf,
	KindMark,
	kindLabels,
	kindOf,
	pageMeta,
	paneArg,
	TitleField,
	usePane,
	useTabFocus,
} from "./views.tsx";

export const combatTab = (name: string) => `combat:${name}`;

/** A combat view's tracker as last rendered, kept in its pane: labels in turn order, the cursor row, the selection,
 * the list, and the editor of the cursor row's note. */
export type Tracker = {
	labels: string[];
	cursor?: string;
	selected: string[];
	select: Dispatch<SetStateAction<string[]>>;
	list: RefObject<HTMLDivElement | null>;
	note: RefObject<EditorView | null>;
};

/** The active view's tracker. */
const tracker = () => activePane()?.tracker;

export const trackerFocused = () =>
	!!tracker()?.list.current?.contains(document.activeElement);

export type Target = { combat: string; labels: string[] };

/** The selected rows, else the cursor row. */
const aim = ({ labels, cursor, selected }: Tracker) => {
	const picked = selected.filter((l) => labels.includes(l));
	return picked.length ? picked : cursor ? [cursor] : [];
};

/** What tracker Actions act on: in the active view's Combat, the selected rows, else the cursor row. */
export function target(): Target {
	const pane = activePane();
	return pane?.tracker
		? { combat: argOf(pane), labels: aim(pane.tracker) }
		: { combat: "", labels: [] };
}

export const cursorLabel = () => tracker()?.cursor;

export const describe = (labels: string[]) =>
	labels.length > 3 ? `${labels.length} combatants` : labels.join(", ");

/** Adds `label` to a selection, or takes it out. */
const toggled = (label: string) => (selected: string[]) =>
	selected.includes(label)
		? selected.filter((l) => l !== label)
		: [...selected, label];

/** Selects or deselects the cursor row of the active view's tracker. */
export function toggleSelect() {
	const t = tracker();
	if (t?.cursor) t.select(toggled(t.cursor));
}

export const focusNote = () => tracker()?.note.current?.focus();

const combatantsOf = ({ combat, labels }: Target) =>
	labels.map((l) => getGame().combats[combat]?.combatants?.[l]);

/** Where a label puts a dice expression. */
const slot = "\0";

/** Prompts for a whole number of at least `min`, or arithmetic, or dice (`dice.ts`). `label` says what Enter does with
 * a number, or places `slot` where the dice go. Dice roll once on Enter, the total raised to `min`. The roll joins the
 * dice roller's list and a toast, labeled with what it did to `subject`, who or what it affects. */
export function askNumber(
	spec: {
		title: string;
		label: (n: string) => string;
		subject: string;
		min?: number;
		value?: string;
		items?: Item[];
	},
	apply: (n: number) => void,
) {
	const { label, subject, min = 0, ...rest } = spec;
	const note = (text: string, className: string): Item => ({
		label: text,
		view: <span className={className}>{text}</span>,
		disabled: true,
		run() {},
	});
	pick({
		placeholder: "Number, or dice like 2d6+3",
		items: [],
		...rest,
		fromQuery(query) {
			if (!query) return;
			const { entries, error } = parse(query);
			const [entry, ...more] = entries;
			if (!entry) return note(error ?? "", "text-destructive");
			if (more.length || entry.times > 1)
				return note("One roll only here", "text-destructive");
			const { expr } = entry;
			if (!error && !hasDice(expr)) {
				const n = value(expr);
				if (n < min)
					return note(`At least ${showNumber(min)}`, "text-destructive");
				return {
					label: label(showNumber(n)),
					view: isNumber(expr) ? undefined : (
						<span className="flex items-baseline gap-3">
							{label(showNumber(n))}
							<Dice expr={expr} className="text-sm text-muted-foreground" />
						</span>
					),
					run: () => apply(n),
				};
			}
			const [before, after] = label(slot).split(slot);
			// Unfinished input keeps the same row, with the parser's message.
			return {
				label: query,
				detail: error ?? "Enter rolls",
				disabled: !!error,
				view: (
					<span className="flex flex-wrap items-baseline gap-x-1">
						{before}
						<Dice expr={expr} />
						{after}
					</span>
				),
				run() {
					const rolls = rollAll([entry]);
					if (typeof rolls === "string") return toast(rolls);
					const [rolled] = rolls;
					if (!rolled) return;
					const n = Math.max(min, rolled.total);
					apply(n);
					const raised = ` · ${showNumber(rolled.total)} raised to the minimum`;
					const what = `${label(showNumber(n))} · ${subject}`;
					const roll = addRoll({
						text: query,
						rolls: [{ ...rolled, total: n }],
						label: n === rolled.total ? what : what + raised,
					});
					// One id, so a new roll replaces the last roll's toast.
					toast(
						<div className="max-h-48 w-full overflow-hidden">
							<Rolls roll={roll} />
						</div>,
						"roll",
					);
				},
			};
		},
	});
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
				subject: creature,
				min: 1,
				value: "1",
			},
			(count) => send({ type: "addCombatants", combat, creature, count }),
		);
	ask(
		{
			title: "Add a combatant",
			placeholder: "Creature",
			recent: "creatures",
			items: Object.keys(notes)
				.filter((title) => canFight(notes[title]))
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
				label: (n) => `${name} for ${n} ${n === "1" ? "round" : "rounds"}`,
				subject: describe(t.labels),
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
			recent: "conditions",
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
	const pane = usePane();
	// Its place, when it comes back by Back or Forward or is reopened. See `restorePlace`.
	const [place] = useState(() => places.get(combatTab(name)));
	const [selected, select] = useState(place?.selected ?? []);
	const note = useRef<EditorView>(null);
	const labels = useMemo(() => order(combat, notes), [combat, notes]);
	const openCreature = (i: number, newTab: boolean) => {
		const c = combat.combatants?.[labels[i] as string];
		if (c) openTab(noteTab(c.creature), newTab);
	};
	const nav = useListNav(labels.length, openCreature);
	const cursor = labels[nav.index];
	const t = { labels, cursor, selected, select, list: nav.ref, note };
	pane.tracker = t;
	const { ref, setIndex } = nav;
	useTabFocus(() => ref.current?.focus());
	// The cursor follows the turn; otherwise it stays on its Combatant when the order changes, even when renamed.
	const turn = combat.turn;
	const last = useRef<{ turn?: string; cursor?: string; labels?: string[] }>(
		place ? { turn: combat.turn, cursor: place.cursor } : {},
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
		// A hidden view never scrolls.
		if (ref.current?.checkVisibility())
			ref.current.children[i]?.scrollIntoView({ block: "nearest" });
	}, [labels, turn, setIndex, ref]);
	useEffect(() => {
		last.current.cursor = cursor;
	});

	const c = cursor === undefined ? undefined : combat.combatants?.[cursor];
	return (
		<section className="mx-auto grid h-full max-w-[110rem] grid-cols-[minmax(0,1fr)_minmax(20rem,28rem)] grid-rows-[auto_auto_auto_minmax(0,1fr)] gap-x-6 px-6 pt-3 @max-[30rem]:px-3 @min-[100rem]:grid-cols-[minmax(0,1fr)_34rem] @max-[52rem]:h-auto @max-[52rem]:grid-cols-[minmax(0,1fr)] @max-[52rem]:grid-rows-none">
			<header className="col-span-full flex flex-wrap items-baseline gap-x-5">
				<TitleField
					name={name}
					rename={renameCombat}
					// Its negative margins make it 1rem wider than the heading.
					className="w-auto max-w-[calc(100%+1rem)] text-2xl field-sizing-content md:text-2xl"
				/>
				<p className={cn(pageMeta, "mt-0")}>
					<span className={cn(running && "font-bold text-primary")}>
						{running ? `Round ${combat.round}` : "Not running"}
					</span>
					{combat.session && (
						<Button
							variant="link"
							className="h-auto p-0 font-normal text-muted-foreground hover:text-foreground"
							{...clickOpens((newTab) =>
								openTab(noteTab(combat.session as string), newTab),
							)}
						>
							{noteLabel(combat.session, notes[combat.session])}
						</Button>
					)}
				</p>
			</header>
			<Toolbar
				running={running}
				who={describe(aim(t))}
				focusTracker={() =>
					ref.current?.contains(document.activeElement) || ref.current?.focus()
				}
			/>
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
						<div
							key={label}
							role="option"
							tabIndex={-1}
							aria-selected={i === nav.index}
							data-turn={active || undefined}
							data-picked={selected.includes(label) || undefined}
							// A plain click moves the cursor; a new-tab click opens the Creature; a Shift+click selects.
							{...clickOpens((newTab) => {
								nav.setIndex(i);
								if (newTab) openCreature(i, true);
							})}
							onClickCapture={(e) => {
								if (!e.shiftKey) return;
								e.stopPropagation();
								nav.setIndex(i);
								select(toggled(label));
							}}
							onMouseDownCapture={(e) => {
								if (!e.shiftKey) return;
								// Not a text selection; the tracker keeps focus.
								e.preventDefault();
								ref.current?.focus();
							}}
							// Cursor: an outline, brighter while the tracker has focus, fainter outside the focused group. Selection: blue. Active turn: amber. They combine.
							className={cn(
								columns,
								"min-h-11 shrink-0 rounded-lg border border-transparent py-1 aria-selected:border-border group-focus/tracker:aria-selected:border-muted-foreground in-data-unfocused:aria-selected:border-border/40 data-picked:shadow-[inset_3px_0_var(--select)] data-picked:not-data-turn:bg-select/14 data-turn:bg-primary/14",
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
					No combatants. Add some with “Add” above.
				</p>
			)}
			{c && cursor && (
				<aside className="col-start-2 row-span-2 row-start-3 min-h-0 overflow-y-auto border-l pb-6 pl-6 @max-[52rem]:col-auto @max-[52rem]:row-auto @max-[52rem]:row-start-auto @max-[52rem]:mt-6 @max-[52rem]:border-0 @max-[52rem]:pl-0">
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
						onKeyDown={(e) => {
							if (e.key === "Escape") {
								e.preventDefault();
								ref.current?.focus();
							}
						}}
					>
						<MarkdownBox
							key={cursor}
							value={c.note ?? ""}
							placeholder="Notes on this combatant"
							view={note}
							onSave={async (text) =>
								send({
									type: "setCombatantNote",
									combat: await paneArg(pane),
									labels: [cursor],
									note: text,
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

/** The combat's Actions, then those on the tracker's target: the selection, else the cursor row. A press first focuses
 * the tracker, unless it has focus, so the keys work after and a picker returns there. */
function Toolbar({
	running,
	who,
	focusTracker,
}: {
	running: boolean;
	who: string;
	focusTracker: () => void;
}) {
	const lead = "border-primary/50 text-primary dark:border-primary/50";
	return (
		<div
			role="toolbar"
			aria-label="Combat"
			className="sticky top-0 z-10 col-span-full mt-2 mb-3 flex flex-wrap items-center gap-0.5 border-y bg-background py-1"
			onPointerDownCapture={(e) => {
				// Menus render elsewhere in the page, but their events pass through here.
				if (e.currentTarget.contains(e.target as Node)) focusTracker();
			}}
		>
			{running ? (
				<ActionButton id="end-combat" />
			) : (
				<ActionButton id="start-combat" variant="outline" className={lead} />
			)}
			<ActionButton
				id="next-turn"
				variant={running ? "outline" : "ghost"}
				className={cn(running && lead)}
			/>
			<ActionButton id="roll-initiative" />
			<ActionButton id="add-combatant" />
			<ActionButton id="undo-combat" />
			<ActionButton id="redo-combat" />
			<Separator orientation="vertical" className="mx-1.5 my-1" />
			<span
				className="mr-1 flex max-w-52 min-w-0 items-center gap-1.5 text-sm text-foreground"
				title={who}
			>
				<CrosshairIcon className="size-4 flex-none text-faint" />
				<span className="truncate">
					{who || <span className="text-faint">No combatant</span>}
				</span>
			</span>
			<ActionButton id="damage" />
			<ActionButton id="heal" />
			<ActionButton id="toggle-condition" />
			<ActionButton id="set-temp-hp" />
			<ActionButton id="set-initiative" />
			<ActionButton id="toggle-concentration" />
			<ActionButton id="toggle-select" />
			<span className="ml-auto" />
			<ActionMenu>
				<DropdownMenuLabel>{who || "Combatant"}</DropdownMenuLabel>
				<ActionItem id="set-max-hp-adjustment" />
				<ActionItem id="death-save-success" />
				<ActionItem id="death-save-failure" />
				<ActionItem id="spend-legendary-action" />
				<ActionItem id="spend-legendary-resistance" />
				<ActionItem id="rename-combatant" />
				<ActionItem id="edit-combatant-note" />
				<ActionItem id="clear-selection" />
				<ActionItem id="remove-combatant" destructive />
				<DropdownMenuSeparator />
				<DropdownMenuLabel>Combat</DropdownMenuLabel>
				<ActionItem id="set-combat-atmosphere" />
				<ActionItem id="clear-combat-atmosphere" />
				<ActionItem id="attach-session" />
				<ActionItem id="detach-session" />
				<ActionItem id="party-rest" />
				<ActionItem id="rename-combat" />
				<ActionItem id="delete-combat" destructive />
			</ActionMenu>
		</div>
	);
}

/** The tracker's columns: turn mark, initiative, combatant, AC, HP. Shared by the heading and the rows. */
// Narrower in a narrow view, such as a tab group beside another, so names keep room.
const columns =
	"grid grid-cols-[1.25rem_2.5rem_minmax(0,1fr)_2.5rem_minmax(7rem,18%)] items-center gap-x-3 pr-3 @max-[30rem]:grid-cols-[0.75rem_1.75rem_minmax(0,1fr)_1.75rem_5rem] @max-[30rem]:gap-x-2 @max-[30rem]:pr-1";
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
	const missing = !canFight(note);
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
