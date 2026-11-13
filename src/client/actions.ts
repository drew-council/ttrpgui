// The Action registry: everything the user can do. Every available Action is in the command palette.
// Ids and default binds live in `src/shared/keys.ts`; the user config overrides them.
import {
	ArrowDownIcon,
	ArrowLeftIcon,
	ArrowRightIcon,
	ArrowUpIcon,
	BedIcon,
	BrainIcon,
	CalendarDaysIcon,
	CalendarPlusIcon,
	CalendarXIcon,
	CircleCheckIcon,
	CircleStopIcon,
	CloudFogIcon,
	CloudOffIcon,
	CrownIcon,
	DicesIcon,
	DownloadIcon,
	FlagIcon,
	FolderOpenIcon,
	HashIcon,
	HeartCrackIcon,
	HeartPlusIcon,
	HeartPulseIcon,
	ImageIcon,
	ImageOffIcon,
	ListPlusIcon,
	type LucideIcon,
	MonitorOffIcon,
	MonitorUpIcon,
	NotebookPenIcon,
	PanelLeftIcon,
	PauseIcon,
	PencilIcon,
	PlusIcon,
	RadioIcon,
	Redo2Icon,
	ShapesIcon,
	ShieldCheckIcon,
	ShieldPlusIcon,
	SkipForwardIcon,
	SkullIcon,
	SquareCheckIcon,
	SquarePenIcon,
	SquareXIcon,
	StarIcon,
	StepForwardIcon,
	SwordsIcon,
	TagIcon,
	TerminalIcon,
	TextSearchIcon,
	TrashIcon,
	Undo2Icon,
	UserCheckIcon,
	UserMinusIcon,
	UserPlusIcon,
	UserXIcon,
	VenetianMaskIcon,
} from "lucide-react";
import { useEffect } from "react";
import type { SearchHit } from "../server/game.ts";
import type { Mutation } from "../server/mutations.ts";
import { activeAtmosphere } from "../shared/display.ts";
import {
	type ActionId,
	bindHas,
	binds,
	eventKey,
	formatKey,
} from "../shared/keys.ts";
import { localDate } from "../shared/notes.ts";
import type { Kind } from "../shared/schema.ts";
import { signed } from "../shared/statblock.ts";
import type { GameState, Note } from "../shared/state.ts";
import { atmosphereTab } from "./Atmospheres.tsx";
import { isTextField } from "./list.ts";
import { followLink, linkUnderCursor } from "./MarkdownBox.tsx";
import { focusSidebar } from "./Sidebar.tsx";
import {
	addEntry,
	addSection,
	formCursor,
	moveItem,
	removeItem,
	stopEditing,
} from "./StatBlock.tsx";
import { getGame, send } from "./sync.ts";
import {
	addCombatant,
	askNumber,
	checkConcentration,
	combatTab,
	cursorLabel,
	describe,
	focusNote,
	type Target,
	target,
	toggleCondition,
	toggleSelect,
	trackerFocused,
} from "./Tracker.tsx";
import {
	ask,
	closeTab,
	cycleTab,
	type Item,
	newTab,
	noteTab,
	openTab,
	pick,
	replaceTab,
	toast,
	travel,
	travelTarget,
	ui,
	zoom,
} from "./ui.ts";
import {
	chooseImageRole,
	kindLabels,
	kindOf,
	parseTab,
	roleLabel,
	tabExists,
} from "./views.tsx";

declare global {
	interface Window {
		/** Set by the Electron preload. */
		ttrpgui?: { openGame(): void; display(open: boolean): void };
	}
}

export type Action = {
	title: string;
	/** Whether it can run now. `control` is true for a GUI control shown where the Action applies, such as a button in
	 * the combat view's toolbar: it skips the focus checks that only decide where keys go. */
	when?: (control?: boolean) => boolean;
	run: () => void;
	/** Shown on its button. Without one, the button shows only the icon. */
	icon?: LucideIcon;
	/** Short text for its button, where the icon alone would be unclear. */
	label?: string;
};

/** The argument of the active tab, if it is a `view` tab whose target is in `existing`. */
function activeTab(view: string, existing: object) {
	const [v, arg] = parseTab(ui.get().active ?? "");
	return v === view && Object.hasOwn(existing, arg) ? arg : undefined;
}

/** The title of the note in the active tab, if it exists. */
const activeNote = () => activeTab("note", getGame().notes);

const kinds: [Kind | undefined, string][] = [
	[undefined, "Plain note"],
	["session", "Session"],
	["creature", "Creature"],
	["location", "Location"],
];

/** An Action that asks for a name, creates the `noun` with it, and opens its tab. */
const create = (
	noun: string,
	spec: { title: string; placeholder: string; value?: string },
	mutation: (name: string) => Mutation,
	tab: (name: string) => string,
): Action => ({
	title: `New ${noun}`,
	run: () =>
		ask(
			spec,
			(name) => (name ? `Create ${noun} “${name}”` : undefined),
			async (name, newTab) => {
				if (await send(mutation(name))) openTab(tab(name), newTab);
			},
		),
});

const newNote = (kind: Kind | undefined, noun: string) =>
	create(
		noun,
		// A Session's title defaults to its date, which defaults to today.
		{
			title: `New ${noun}`,
			placeholder: "Title",
			value: kind === "session" ? localDate() : undefined,
		},
		(title) => ({ type: "createNote", title, kind }),
		noteTab,
	);

/** Makes Actions on what the active `view` tab shows, available when it exists and passes `test`. */
const onTab =
	<T>(view: string, all: (game: GameState) => Record<string, T>) =>
	(run: (arg: string) => void, test: (target: T) => boolean = () => true) => ({
		when: () => {
			const arg = activeTab(view, all(getGame()));
			return arg !== undefined && test(all(getGame())[arg] as T);
		},
		run: () => run(activeTab(view, all(getGame())) as string),
	});

const onNote = onTab("note", (game) => game.notes);
const inCombatTab = onTab("combat", (game) => game.combats);
const inAtmosphereTab = onTab("atmosphere", (game) => game.atmospheres);

const isCreature = (note: Note) => note.metadata.kind === "creature";

/** Asks for a new name for `from`. `after` runs once the rename applies. */
function rename(
	from: string,
	mutation: (to: string) => Mutation,
	after: (to: string) => void,
	detail?: string,
) {
	pick({
		title: `Rename “${from}”`,
		value: from,
		items: [],
		fromQuery: (to) =>
			to && to !== from
				? {
						label: `Rename to “${to}”`,
						detail,
						run: async () => {
							if (await send(mutation(to))) after(to);
						},
					}
				: undefined,
	});
}

/** Asks before deleting `name`, then closes its tab. */
function confirmDelete(
	title: string,
	name: string,
	mutation: Mutation,
	tab: string,
) {
	pick({
		title,
		items: [
			{ label: "Keep it", run() {} },
			{
				label: `Delete “${name}”`,
				run: async () => {
					if (await send(mutation)) closeTab(tab);
				},
			},
		],
	});
}

const setFields = (title: string, fields: Record<string, unknown>) =>
	send({ type: "setMetadata", title, fields });

const inSection = () => formCursor()?.section !== undefined;

const follow = (newTab: boolean) => ({
	when: () => linkUnderCursor() !== undefined,
	run: () => followLink(linkUnderCursor() as string, newTab),
});

/** The name of the Combat in the active tab, if it exists. */
const activeCombat = () => activeTab("combat", getGame().combats);

/** An Action on the focused tracker. By default it needs a Combatant to act on. */
const onTracker = (
	title: string,
	run: (t: Target) => void,
	when = () => target().labels.length > 0,
): Action => ({
	title,
	when: (control) => (control || trackerFocused()) && when(),
	run: () => run(target()),
});

/** A Mutation that acts on tracker targets, without them. */
type TargetMutation = Mutation extends infer M
	? M extends Target
		? Omit<M, keyof Target>
		: never
	: never;

const sendFor = (title: string, mutation: TargetMutation) =>
	onTracker(title, (t) => send({ ...mutation, ...t } as Mutation));

const anyTime = () => true;
const running = () => getGame().runtime.combat === target().combat;

/** A tracker Action that sends `type` for the whole Combat. */
const sendForCombat = (
	title: string,
	type:
		| "startCombat"
		| "endCombat"
		| "nextTurn"
		| "rollInitiative"
		| "undo"
		| "redo",
	when = anyTime,
) => onTracker(title, ({ combat }) => send({ type, combat }), when);

/** A tracker Action that asks for a number and sends it as `amount`. */
const amount = (
	title: string,
	type: Extract<Mutation, { amount: number }>["type"],
	label: (n: number) => string,
	min = 0,
	after?: (t: Target, n: number) => void,
) =>
	onTracker(title, (t) =>
		askNumber(
			{ title: `${title}: ${describe(t.labels)}`, label, min },
			async (n) => {
				if (await send({ type, ...t, amount: n } as Mutation)) after?.(t, n);
			},
		),
	);

const liveSession = () => getGame().runtime.session;

/** Session titles with the one today, else the next upcoming, first; then the rest, newest first. */
function sessionItems(run: (title: string) => void) {
	const { notes } = getGame();
	const date = (title: string) => {
		const metadata = notes[title]?.metadata;
		return (metadata?.kind === "session" && metadata.date) || "";
	};
	const titles = Object.keys(notes)
		.filter((title) => notes[title]?.metadata.kind === "session")
		.sort((a, b) => date(b).localeCompare(date(a)) || a.localeCompare(b));
	const next = titles.filter((title) => date(title) >= localDate()).at(-1);
	return [next, ...titles.filter((title) => title !== next)]
		.filter((title) => title !== undefined)
		.map((title) => ({
			label: title,
			detail: date(title),
			run: () => run(title),
		}));
}

async function goLive(title: string) {
	const session = title.trim();
	if (
		(Object.hasOwn(getGame().notes, session) ||
			(await send({ type: "createNote", title: session, kind: "session" }))) &&
		(await send({ type: "goLive", session }))
	)
		openTab(noteTab(session));
}

async function search(query: string) {
	const res = await fetch(`/search?q=${encodeURIComponent(query)}`);
	const hits: SearchHit[] = await res.json();
	return hits.map(({ title, line, column, text }) => ({
		label: text,
		detail: title,
		run(newTab: boolean) {
			const tab = noteTab(title);
			openTab(tab, newTab);
			ui.set({ reveal: { tab, line, column } });
		},
	}));
}

/** Atmosphere names, the active one first, for a picker. */
function atmosphereItems(run: (name: string) => void) {
	const { atmospheres, runtime } = getGame();
	const active = activeAtmosphere(atmospheres, runtime);
	return Object.keys(atmospheres)
		.sort((a, b) => Number(b === active) - Number(a === active))
		.map((name) => ({
			label: name,
			detail: name === active ? "Active" : undefined,
			run: () => run(name),
		}));
}

export const switchAtmosphere = (name: string) =>
	send({ type: "switchAtmosphere", name });

/** An Action on the Atmosphere in the active tab, else on one picked. */
const onAtmosphere = (title: string, run: (name: string) => void): Action => ({
	title,
	when: () => Object.keys(getGame().atmospheres).length > 0,
	run() {
		const name = activeTab("atmosphere", getGame().atmospheres);
		if (name) run(name);
		else pick({ title, items: atmosphereItems(run) });
	},
});

/** Every image in the Game, those of the note at hand first: the active note, or the Combatant under the cursor. */
function showImage() {
	const { notes, combats } = getGame();
	const cursor =
		combats[activeCombat() ?? ""]?.combatants?.[cursorLabel() ?? ""];
	const here = activeNote() ?? cursor?.creature;
	const titles = Object.keys(notes).sort(
		(a, b) => Number(b === here) - Number(a === here) || a.localeCompare(b),
	);
	pick({
		title: "Show an image on the display",
		placeholder: "Note or file",
		items: titles.flatMap((title) => {
			const note = notes[title] as (typeof notes)[string];
			return note.images.map((file) => ({
				label: `${title}/${file}`,
				detail: roleLabel(note, file),
				run: () => send({ type: "showImage", image: `${title}/${file}` }),
			}));
		}),
	});
}

const music = () => getGame().runtime.music ?? {};

const volume = (step: number) => () =>
	send({
		type: "setMusic",
		volume: Math.max(0, Math.min(100, (music().volume ?? 100) + step)),
	});

const electron = () => window.ttrpgui !== undefined;

/** Goes back (-1) or forward (1) in the active tab, past what no longer exists or is open in another tab. */
const go = (direction: -1 | 1) => {
	const exists = (tab: string) => tabExists(tab, getGame());
	return {
		when: () => travelTarget(direction, exists) !== undefined,
		run: () => travel(direction, exists),
	};
};

const zoomBy = (step: -1 | 0 | 1) => () =>
	toast(`Zoom ${Math.round(zoom(step) * 100)}%`, "zoom");

export const actions: Record<ActionId, Action> = {
	"command-palette": {
		title: "Show all commands",
		icon: TerminalIcon,
		label: "Commands",
		run() {
			const keys = binds(getGame().config.keys);
			pick({
				title: "Run a command",
				items: available().map((id) => ({
					label: actions[id].title,
					hint: keys[id] && formatKey(keys[id]),
					run: actions[id].run,
				})),
			});
		},
	},
	"quick-open": {
		title: "Open or create a note, or open a combat or atmosphere",
		run() {
			const { notes, combats, atmospheres } = getGame();
			const item = (label: string, detail: string, tab: string): Item => ({
				label,
				detail,
				run: (newTab) => openTab(tab, newTab),
			});
			ask(
				{
					title: "Open a note",
					placeholder: "Title",
					items: [
						...Object.keys(notes)
							.sort()
							.map((t) => item(t, kindLabels[kindOf(notes[t])], noteTab(t))),
						...Object.keys(combats).map((name) =>
							item(name, kindLabels.combat, combatTab(name)),
						),
						...Object.keys(atmospheres).map((name) =>
							item(name, kindLabels.atmosphere, atmosphereTab(name)),
						),
					],
				},
				(title) =>
					title && !Object.hasOwn(notes, title)
						? `Create note “${title}”`
						: undefined,
				followLink,
			);
		},
	},
	"toggle-sidebar": {
		title: "Toggle sidebar",
		icon: PanelLeftIcon,
		run: () => ui.set({ sidebar: !ui.get().sidebar }),
	},
	"focus-sidebar": { title: "Focus sidebar", run: focusSidebar },
	"close-tab": {
		title: "Close tab",
		when: () => ui.get().active !== undefined,
		run: () => closeTab(ui.get().active as string),
	},
	"next-tab": {
		title: "Next tab",
		when: () => ui.get().tabs.length > 1,
		run: () => cycleTab(1),
	},
	"previous-tab": {
		title: "Previous tab",
		when: () => ui.get().tabs.length > 1,
		run: () => cycleTab(-1),
	},
	"new-tab": { title: "New tab", run: newTab, icon: PlusIcon },
	"go-back": { title: "Go back", ...go(-1), icon: ArrowLeftIcon },
	"go-forward": { title: "Go forward", ...go(1), icon: ArrowRightIcon },
	"zoom-in": { title: "Zoom in", run: zoomBy(1) },
	"zoom-out": { title: "Zoom out", run: zoomBy(-1) },
	"reset-zoom": { title: "Reset zoom", run: zoomBy(0) },
	"new-note": { ...newNote(undefined, "note"), icon: PlusIcon },
	"new-session": { ...newNote("session", "session"), icon: PlusIcon },
	"new-creature": { ...newNote("creature", "creature"), icon: PlusIcon },
	"new-location": { ...newNote("location", "location"), icon: PlusIcon },
	"rename-note": {
		title: "Rename note",
		icon: PencilIcon,
		...onNote((from) =>
			rename(
				from,
				(to) => ({ type: "renameNote", from, to }),
				(to) => replaceTab(noteTab(from), noteTab(to)),
				"Updates every link",
			),
		),
	},
	"delete-note": {
		title: "Delete note",
		icon: TrashIcon,
		...onNote((title) =>
			confirmDelete(
				`Delete “${title}”? Links to it will be left dangling.`,
				title,
				{ type: "deleteNote", title },
				noteTab(title),
			),
		),
	},
	"change-kind": {
		title: "Change note kind",
		icon: ShapesIcon,
		...onNote((title) => {
			const current = getGame().notes[title]?.metadata.kind;
			pick({
				title: `Change the kind of “${title}”`,
				items: kinds.map(([kind, label]) => ({
					label,
					detail: kind === current ? "Current" : undefined,
					run: () => send({ type: "setKind", title, kind }),
				})),
			});
		}),
	},
	"follow-link": { title: "Follow link under cursor", ...follow(false) },
	"follow-link-new-tab": {
		title: "Follow link under cursor in a new tab",
		...follow(true),
	},
	"search-notes": {
		title: "Search note text",
		icon: TextSearchIcon,
		run: () =>
			pick({
				title: "Search note text",
				placeholder: "Text",
				items: [],
				load: search,
			}),
	},
	"set-image-role": {
		title: "Set image role",
		icon: TagIcon,
		...onNote(
			(title) => {
				const note = getGame().notes[title] as Note;
				pick({
					title: `Set the role of an image in “${title}”`,
					items: note.images.map((image) => ({
						label: image,
						detail: roleLabel(note, image),
						run: () => chooseImageRole(title, image),
					})),
				});
			},
			(note) => note.images.length > 0,
		),
	},
	"mark-pc": {
		title: "Mark as PC",
		icon: UserCheckIcon,
		label: "Mark as PC",
		...onNote(
			(title) => setFields(title, { pc: true }),
			({ metadata: m }) => m.kind === "creature" && !m.pc,
		),
	},
	"mark-npc": {
		title: "Mark as NPC",
		icon: UserXIcon,
		label: "Mark as NPC",
		...onNote(
			(title) => setFields(title, { pc: null }),
			({ metadata: m }) => m.kind === "creature" && !!m.pc,
		),
	},
	"set-display-name": {
		title: "Set display name",
		icon: VenetianMaskIcon,
		label: "Display name",
		...onNote((title) => {
			const metadata = getGame().notes[title]?.metadata;
			ask(
				{
					title: `What players see for “${title}”`,
					placeholder: title,
					value: metadata?.kind === "creature" ? metadata.display_name : "",
				},
				(name) => (name ? `Show players “${name}”` : "Show players the title"),
				(name) => setFields(title, { display_name: name || null }),
			);
		}, isCreature),
	},
	"set-session-date": {
		title: "Set session date",
		icon: CalendarDaysIcon,
		label: "Set date",
		...onNote(
			(title) => {
				const metadata = getGame().notes[title]?.metadata;
				ask(
					{
						title: `Date of “${title}”`,
						placeholder: "YYYY-MM-DD",
						value:
							(metadata?.kind === "session" && metadata.date) || localDate(),
					},
					(date) => (date ? `Set the date to ${date}` : "Clear the date"),
					(date) => setFields(title, { date: date || null }),
				);
			},
			(note) => note.metadata.kind === "session",
		),
	},
	"edit-statblock": {
		title: "Edit stat block",
		icon: SquarePenIcon,
		label: "Edit stat block",
		...onNote(
			(title) =>
				ui.get().editing === title ? stopEditing() : ui.set({ editing: title }),
			isCreature,
		),
	},
	"add-statblock-section": {
		title: "Add stat block section",
		icon: ListPlusIcon,
		label: "Section",
		when: () => formCursor() !== undefined,
		run: addSection,
	},
	"add-statblock-entry": {
		title: "Add stat block entry",
		icon: PlusIcon,
		label: "Entry",
		when: () => formCursor() !== undefined,
		run: addEntry,
	},
	"remove-statblock-item": {
		title: "Remove stat block entry or section",
		icon: TrashIcon,
		when: inSection,
		run: removeItem,
	},
	"move-statblock-item-up": {
		title: "Move stat block entry or section up",
		icon: ArrowUpIcon,
		when: inSection,
		run: moveItem(-1),
	},
	"move-statblock-item-down": {
		title: "Move stat block entry or section down",
		icon: ArrowDownIcon,
		when: inSection,
		run: moveItem(1),
	},
	"show-problems": {
		title: "Show problems",
		run: () => openTab("problems"),
	},
	"open-game": {
		title: "Open another Game",
		icon: FolderOpenIcon,
		when: electron,
		run: () => window.ttrpgui?.openGame(),
	},
	"new-combat": {
		...create(
			"combat",
			{ title: "New combat. Every PC joins it.", placeholder: "Name" },
			(name) => ({ type: "createCombat", name }),
			combatTab,
		),
		icon: PlusIcon,
	},
	"rename-combat": {
		title: "Rename combat",
		icon: PencilIcon,
		...inCombatTab((from) =>
			rename(
				from,
				(to) => ({ type: "renameCombat", from, to }),
				(to) => replaceTab(combatTab(from), combatTab(to)),
			),
		),
	},
	"delete-combat": {
		title: "Delete combat",
		icon: TrashIcon,
		...inCombatTab((name) =>
			confirmDelete(
				`Delete the combat “${name}”?`,
				name,
				{ type: "deleteCombat", name },
				combatTab(name),
			),
		),
	},
	"attach-session": {
		title: "Attach combat to a session",
		icon: CalendarPlusIcon,
		...inCombatTab((combat) =>
			pick({
				title: `Attach “${combat}” to a session`,
				items: sessionItems((session) =>
					send({ type: "setCombatSession", combat, session }),
				),
			}),
		),
	},
	"detach-session": {
		title: "Detach combat from its session",
		icon: CalendarXIcon,
		...inCombatTab(
			(combat) => send({ type: "setCombatSession", combat }),
			(c) => c.session !== undefined,
		),
	},
	"start-combat": {
		...sendForCombat("Start combat", "startCombat", () => !running()),
		icon: SwordsIcon,
		label: "Start combat",
	},
	"end-combat": {
		...sendForCombat("End combat", "endCombat", running),
		icon: FlagIcon,
		label: "End combat",
	},
	"next-turn": {
		...sendForCombat("Next turn", "nextTurn", running),
		icon: StepForwardIcon,
		label: "Next turn",
	},
	"roll-initiative": {
		...sendForCombat("Roll initiative for NPCs without it", "rollInitiative"),
		icon: DicesIcon,
		label: "Roll",
	},
	"set-initiative": {
		...amount(
			"Set initiative",
			"setInitiative",
			(n) => `Set initiative to ${n}`,
			-Infinity,
		),
		icon: HashIcon,
	},
	"add-combatant": {
		...onTracker(
			"Add combatant",
			({ combat }) => addCombatant(combat),
			anyTime,
		),
		icon: UserPlusIcon,
		label: "Add",
	},
	"remove-combatant": {
		...onTracker("Remove combatant", async (t) => {
			if (await send({ type: "removeCombatants", ...t }))
				ui.set({ selected: [] });
		}),
		icon: UserMinusIcon,
	},
	"rename-combatant": {
		...onTracker("Rename combatant", ({ combat }) => {
			const label = cursorLabel() as string;
			rename(
				label,
				(to) => ({ type: "renameCombatant", combat, label, to }),
				(to) =>
					ui.set({
						selected: ui.get().selected.map((l) => (l === label ? to : l)),
					}),
			);
		}),
		icon: PencilIcon,
	},
	"edit-combatant-note": {
		...onTracker("Edit combatant note", focusNote),
		icon: NotebookPenIcon,
	},
	"toggle-select": {
		...onTracker("Select or deselect combatant", () => toggleSelect()),
		icon: SquareCheckIcon,
	},
	"clear-selection": {
		...onTracker(
			"Clear selection",
			() => ui.set({ selected: [] }),
			() => ui.get().selected.length > 0,
		),
		icon: SquareXIcon,
	},
	damage: {
		...amount(
			"Damage",
			"damage",
			(n) => `Deal ${n} damage`,
			0,
			checkConcentration,
		),
		icon: HeartCrackIcon,
		label: "Damage",
	},
	heal: {
		...amount("Heal", "heal", (n) => `Heal ${n} HP`),
		icon: HeartPlusIcon,
		label: "Heal",
	},
	"set-temp-hp": {
		...amount("Set temp HP", "setTempHp", (n) => `Set temp HP to ${n}`),
		icon: ShieldPlusIcon,
	},
	"set-max-hp-adjustment": {
		...amount(
			"Adjust max HP",
			"setMaxAdjust",
			(n) => `Set the max HP adjustment to ${signed(n)}`,
			-Infinity,
		),
		icon: HeartPulseIcon,
	},
	"toggle-condition": {
		...onTracker("Toggle condition", toggleCondition),
		icon: TagIcon,
		label: "Condition",
	},
	"toggle-concentration": {
		...sendFor("Toggle concentration", {
			type: "toggleConcentration",
		}),
		icon: BrainIcon,
	},
	"death-save-success": {
		...sendFor("Record a death save success", {
			type: "deathSave",
			failure: false,
		}),
		icon: CircleCheckIcon,
	},
	"death-save-failure": {
		...sendFor("Record a death save failure", {
			type: "deathSave",
			failure: true,
		}),
		icon: SkullIcon,
	},
	"spend-legendary-action": {
		...sendFor("Spend a legendary action", {
			type: "spendLegendary",
			kind: "actions",
		}),
		icon: CrownIcon,
	},
	"spend-legendary-resistance": {
		...sendFor("Spend a legendary resistance", {
			type: "spendLegendary",
			kind: "resistances",
		}),
		icon: ShieldCheckIcon,
	},
	"undo-combat": {
		...sendForCombat("Undo combat edit", "undo"),
		icon: Undo2Icon,
	},
	"redo-combat": {
		...sendForCombat("Redo combat edit", "redo"),
		icon: Redo2Icon,
	},
	"go-live": {
		title: "Go live with a session",
		icon: RadioIcon,
		label: "Go live",
		run: () =>
			ask(
				{
					title: "Go live with a session",
					placeholder: "Session",
					items: sessionItems(goLive),
				},
				(title) =>
					title && !Object.hasOwn(getGame().notes, title)
						? `Create session “${title}” and go live`
						: undefined,
				goLive,
			),
	},
	"go-live-with-this-session": {
		title: "Go live with this session",
		icon: RadioIcon,
		label: "Go live",
		...onNote(
			goLive,
			(note) =>
				note.metadata.kind === "session" && activeNote() !== liveSession(),
		),
	},
	"end-session": {
		title: "End the live session",
		icon: CircleStopIcon,
		label: "End session",
		when: () => liveSession() !== undefined,
		run: () => send({ type: "endSession" }),
	},
	"open-live-session": {
		title: "Open the live session",
		when: () => liveSession() !== undefined,
		run: () => openTab(noteTab(liveSession() as string)),
	},
	"party-rest": {
		title: "Party rest: restore every PC to full HP",
		icon: BedIcon,
		run: () =>
			pick({
				title: "Restore every PC to full HP?",
				items: [
					{ label: "Not yet", run() {} },
					{ label: "Rest", run: () => send({ type: "partyRest" }) },
				],
			}),
	},
	"open-display": {
		title: "Open the player display",
		icon: MonitorUpIcon,
		when: electron,
		run: () => window.ttrpgui?.display(true),
	},
	"close-display": {
		title: "Close the player display",
		icon: MonitorOffIcon,
		when: electron,
		run: () => window.ttrpgui?.display(false),
	},
	"show-image": {
		title: "Show an image on the display",
		run: showImage,
		icon: ImageIcon,
	},
	"hide-image": {
		title: "Hide the image on the display",
		icon: ImageOffIcon,
		when: () => getGame().runtime.image !== undefined,
		run: () => send({ type: "showImage" }),
	},
	"new-atmosphere": {
		...create(
			"atmosphere",
			{ title: "New atmosphere", placeholder: "Name" },
			(name) => ({ type: "createAtmosphere", name }),
			atmosphereTab,
		),
		icon: PlusIcon,
	},
	"switch-atmosphere": {
		...onAtmosphere("Switch atmosphere", switchAtmosphere),
		icon: CloudFogIcon,
		label: "Make active",
	},
	"set-default-atmosphere": {
		...onAtmosphere("Set the default atmosphere", (name) =>
			send({ type: "setDefaultAtmosphere", name }),
		),
		icon: StarIcon,
		label: "Make default",
	},
	"rename-atmosphere": {
		title: "Rename atmosphere",
		icon: PencilIcon,
		...inAtmosphereTab((from) =>
			rename(
				from,
				(to) => ({ type: "renameAtmosphere", from, to }),
				(to) => replaceTab(atmosphereTab(from), atmosphereTab(to)),
			),
		),
	},
	"delete-atmosphere": {
		title: "Delete atmosphere",
		icon: TrashIcon,
		...inAtmosphereTab((name) =>
			confirmDelete(
				`Delete the atmosphere “${name}” and its media?`,
				name,
				{ type: "deleteAtmosphere", name },
				atmosphereTab(name),
			),
		),
	},
	"sync-atmosphere": {
		...onAtmosphere("Sync atmosphere media", (name) =>
			send({ type: "syncAtmosphere", name }),
		),
		icon: DownloadIcon,
		label: "Sync media",
	},
	"set-combat-atmosphere": {
		title: "Set the combat's atmosphere",
		icon: CloudFogIcon,
		...inCombatTab((combat) =>
			pick({
				title: `Atmosphere for “${combat}”`,
				items: atmosphereItems((atmosphere) =>
					send({ type: "setCombatAtmosphere", combat, atmosphere }),
				),
			}),
		),
	},
	"clear-combat-atmosphere": {
		title: "Clear the combat's atmosphere",
		icon: CloudOffIcon,
		...inCombatTab(
			(combat) => send({ type: "setCombatAtmosphere", combat }),
			(c) => c.atmosphere !== undefined,
		),
	},
	"toggle-music": {
		title: "Pause or resume music",
		icon: PauseIcon,
		run: () => send({ type: "setMusic", paused: !music().paused }),
	},
	"next-track": {
		title: "Skip to another track",
		icon: SkipForwardIcon,
		run: () => send({ type: "nextTrack", after: music().track }),
	},
	"volume-up": { title: "Music volume up", run: volume(10) },
	"volume-down": { title: "Music volume down", run: volume(-10) },
};

const ids = Object.keys(actions) as ActionId[];

/** Whether `id` can run now, from the keyboard or, with `control`, from a GUI control. See `Action.when`. */
export const canRun = (id: ActionId, control = false) =>
	actions[id].when?.(control) ?? true;

const available = () => ids.filter((id) => canRun(id));

/** The mouse's back and forward buttons. */
const mouseActions: Record<number, ActionId> = {
	3: "go-back",
	4: "go-forward",
};

/** Runs bound Actions, and back and forward for the mouse's buttons. While the user types, only binds with Ctrl, Alt, or
 * Meta, and function keys, fire. */
export function useKeybinds() {
	useEffect(() => {
		function onKeyDown(e: KeyboardEvent) {
			if (e.defaultPrevented || e.isComposing) return;
			const typing = !(
				e.ctrlKey ||
				e.altKey ||
				e.metaKey ||
				/^F\d/.test(e.key)
			);
			if (typing && isTextField(e.target)) return;
			const key = eventKey(e);
			const keys = binds(getGame().config.keys);
			const id = available().find((id) => bindHas(keys[id], key));
			if (!id) return;
			e.preventDefault();
			actions[id].run();
		}
		// The page itself MUST NOT navigate, which a browser does on the release unless prevented.
		function onMouseUp(e: MouseEvent) {
			const id = mouseActions[e.button];
			if (!id) return;
			e.preventDefault();
			if (actions[id].when?.() ?? true) actions[id].run();
		}
		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("mouseup", onMouseUp);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("mouseup", onMouseUp);
		};
	}, []);
}
