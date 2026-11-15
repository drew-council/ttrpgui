// Per-client UI state: tab groups, their tabs' history and mount keys, sidebar, the open picker, confirmation, or menu,
// the privacy screen, the dice roller and its rolls, and zoom. Tab groups, their history, the sidebar and its collapsed
// groups, the pickers' recent lists, and each page's zoom survive a reload.
import type { MouseEvent, ReactNode } from "react";
import { flushSync } from "react-dom";
import { toast as sonner } from "sonner";
import type { Rolled } from "../shared/dice.ts";
import { bindHas, binds, eventKey } from "../shared/keys.ts";
import {
	allTabs,
	type Groups,
	groupOf,
	placed,
	restored,
	sameGroups,
	without,
} from "./groups.ts";
import {
	emptyHistory,
	type History,
	pushed,
	remembered,
	renamed,
	step,
} from "./history.ts";
import { createStore } from "./store.ts";

/** A picker row. `run` gets whether the user asked for a new tab. */
export type Item = {
	label: string;
	/** Also matched, such as the title behind a note's label. */
	title?: string;
	detail?: string;
	hint?: string;
	/** Shown instead of `label`, such as a typeset dice expression. */
	view?: ReactNode;
	/** Shown but not chosen, such as why a query is refused. */
	disabled?: boolean;
	/** Names the row in its picker's recent list where the label can change, such as a tab id. Defaults to the label. */
	key?: string;
	run: (newTab: boolean) => void;
};

export type PickerSpec = {
	title: string;
	placeholder?: string;
	items: Item[];
	/** Initial query. */
	value?: string;
	/** An extra last row built from the trimmed query, such as "Create note". */
	fromQuery?: (query: string) => Item | undefined;
	/** Replaces `items` whenever the query changes, such as with server search results. */
	load?: (query: string) => Promise<Item[]>;
	/** Opts in to recency: names the recent list. With an empty query, the rows chosen most recently lead. */
	recent?: string;
	/** The key of what is shown now, which never leads, such as the active tab. */
	current?: string;
};

/** A yes or no question. `yes` and `no` label the buttons by what they do. The chosen side runs after the dialog is
 * gone and focus is back where it was. */
export type ConfirmSpec = {
	title: string;
	/** What saying yes loses, or other context. */
	detail?: string;
	yes: string;
	/** Defaults to "Cancel". */
	no?: string;
	destructive?: boolean;
	run: () => void;
	cancel?: () => void;
};

type Ui = Groups & {
	/** The tab being dragged, while one is. See `Control.tsx`. */
	drag?: string;
	/** Each tab's back and forward history, by tab id. A tab without one has none. */
	history: Record<string, History>;
	sidebar: boolean;
	/** Labels of the collapsed sidebar groups. */
	collapsed: string[];
	/** Each picker's recent row keys, most recent first, by `PickerSpec.recent`. `tabs` holds the tabs shown. */
	recent: Record<string, string[]>;
	picker?: PickerSpec;
	confirm?: ConfirmSpec;
	/** Whether a dropdown menu is open. See `ActionMenu`. */
	menu: boolean;
	/** A place in a note tab to move the cursor to, consumed by the note view. */
	reveal?: { tab: string; line: number; column: number };
	/** Bumped by `openTab`: the shown view focuses its main element again. See `TabPane`. */
	refocus: number;
	/** Whether the player display window is open. Electron only. */
	display: boolean;
	/** Whether the privacy screen covers this window. See `PrivacyScreen`. */
	privacy: boolean;
	/** Whether the dice roller is open. See `Roller`. */
	roller: boolean;
	/** This window's rolls, newest first; `label` says what a number prompt did with one. Never persisted or synced:
	 * they are the game master's own. */
	rolls: { id: number; text: string; rolls: Rolled[]; label?: string }[];
};
export type RollEntry = Ui["rolls"][number];

const storageKey = "ttrpgui.ui";
function restore(): Partial<Ui> {
	try {
		const saved = JSON.parse(localStorage.getItem(storageKey) ?? "{}");
		const { tabs: _, active: __, ...rest } = saved;
		return { ...rest, ...restored(saved) };
	} catch {
		return restored({});
	}
}

export const ui = createStore<Ui>({
	groups: [],
	focus: 0,
	history: {},
	sidebar: true,
	collapsed: [],
	recent: {},
	menu: false,
	refocus: 0,
	display: false,
	privacy: false,
	roller: false,
	rolls: [],
	...restore(),
});
ui.subscribe(() => {
	const { groups, focus, history, sidebar, collapsed, recent } = ui.get();
	localStorage.setItem(
		storageKey,
		JSON.stringify({ groups, focus, history, sidebar, collapsed, recent }),
	);
});

/** Puts `key` first in the recent list `name`. */
export function remember(name: string, key: string) {
	const { recent } = ui.get();
	ui.set({
		recent: { ...recent, [name]: remembered(recent[name] ?? [], key) },
	});
}

let acting: number | undefined;

/** Runs `fn` as if group `group` had focus, as a control in that group sees its Actions. See `GroupContext`. */
export function asFocused<T>(group: number | undefined, fn: () => T) {
	const was = acting;
	acting = group ?? was;
	try {
		return fn();
	} finally {
		acting = was;
	}
}

/** The focused group's active tab: the one Actions act on. See `asFocused`. */
export const activeTab = (s: Groups = ui.get()) =>
	s.groups[acting ?? s.focus]?.active;

/** The focused group. */
const focused = (s: Groups = ui.get()) => s.groups[s.focus] ?? { tabs: [] };

/** `s` with its focused group's tabs and active tab changed. */
const withFocused = (s: Groups, tabs: string[], active?: string) =>
	s.groups.with(s.focus, { tabs, active });

// Quick open lists the tabs shown most recently first, however they were opened.
ui.subscribe(() => {
	const { recent } = ui.get();
	const active = activeTab();
	if (active && !active.startsWith("new:") && recent.tabs?.[0] !== active)
		remember("tabs", active);
});

export const noteTab = (title: string) => `note:${title}`;

/** Shows `tab` and focuses its main element. A tab open in a group shows there, and that group takes focus. A tab not
 * yet open goes in the focused group: it replaces the active one, which goes on that tab's back history, or opens
 * beside it with no history when `newTab`. Every way of opening something ends here. */
export function openTab(tab: string, newTab = false) {
	const s = ui.get();
	const refocus = s.refocus + 1;
	const open = groupOf(s, tab);
	if (open >= 0)
		return ui.set({
			...placed(s, tab, open, s.groups[open]?.tabs.indexOf(tab)),
			refocus,
		});
	const { tabs, active } = focused(s);
	const at = active ? tabs.indexOf(active) : -1;
	const replaced = newTab || at < 0 ? undefined : active;
	let { history } = s;
	// An empty tab is nothing to go back to.
	if (replaced && !replaced.startsWith("new:"))
		history = {
			...withoutHistory(history, replaced),
			[tab]: pushed(history[replaced] ?? emptyHistory, replaced),
		};
	ui.set({
		groups: withFocused(
			s,
			tabs.toSpliced(
				at < 0 ? tabs.length : at + Number(newTab),
				replaced ? 1 : 0,
				tab,
			),
			tab,
		),
		history,
		refocus,
	});
}

const withoutHistory = (history: Ui["history"], tab: string) => {
	const { [tab]: _, ...rest } = history;
	return rest;
};

/** Where the active tab's history leads back (-1) or forward (1): the nearest entry that `exists` and is not open in a
 * tab, since tab ids are unique. Undefined when there is none. */
export function travelTarget(
	direction: -1 | 1,
	exists: (tab: string) => boolean,
	s: Groups & Pick<Ui, "history"> = ui.get(),
) {
	const active = activeTab(s);
	if (!active) return;
	const open = allTabs(s);
	return step(
		s.history[active] ?? emptyHistory,
		active,
		direction,
		(tab) => exists(tab) && !open.includes(tab),
	);
}

/** Goes back (-1) or forward (1) in the active tab and focuses what it shows. */
export function travel(direction: -1 | 1, exists: (tab: string) => boolean) {
	const target = travelTarget(direction, exists);
	const s = ui.get();
	const { history, refocus } = s;
	const active = activeTab(s);
	if (!target || !active) return;
	const tabs = focused(s).tabs.map((t) => (t === active ? target.tab : t));
	ui.set({
		groups: withFocused(s, tabs, target.tab),
		history: {
			...withoutHistory(history, active),
			[target.tab]: target.history,
		},
		refocus: refocus + 1,
	});
}

const emptyTab = () => `new:${Math.random().toString(36).slice(2, 8)}`;

/** Opens an empty tab beside the active one. The next plain open fills it. */
export const newTab = () => openTab(emptyTab(), true);

/** Whether a click asks for a new tab: Ctrl or Cmd held, or the middle button. */
export const wantsNewTab = (e: {
	ctrlKey: boolean;
	metaKey: boolean;
	button: number;
}) => e.ctrlKey || e.metaKey || e.button === 1;

/** Mouse handlers for something that opens: a click opens it, Ctrl/Cmd+click or a middle-click in a new tab. */
export const clickOpens = (open: (newTab: boolean) => void) => ({
	onClick: (e: MouseEvent) => open(wantsNewTab(e)),
	onAuxClick: (e: MouseEvent) => e.button === 1 && open(true),
	// A middle press would otherwise paste the primary selection or start autoscroll.
	onMouseDown: (e: MouseEvent) => e.button === 1 && e.preventDefault(),
});

/** Closes `tab`. A group left empty goes, unless it is the only one. */
export function closeTab(tab: string) {
	const s = ui.get();
	ui.set({ ...without(s, tab), history: withoutHistory(s.history, tab) });
}

/** Where a tab's view was as it unmounted: its pane's scroll offset, or with its text box at the top, the position
 * there and how far below it; its text box's selection; its tracker's cursor and selection. */
export type Place = {
	top: number;
	line?: { pos: number; offset: number };
	anchor?: number;
	head?: number;
	cursor?: string;
	selected?: string[];
};
/** Places by tab id, in memory only. The least recently left go first. See `TabPane`. */
export const places = new Map<string, Place>();

/** Remembers `tab`'s place. */
export function savePlace(tab: string, place: Place) {
	places.delete(tab);
	places.set(tab, place);
	for (const old of places.keys()) if (places.size > 100) places.delete(old);
}

const mountKeys = new Map<string, string>();
let lastKey = 0;

/** The key an open tab's view mounts under. It stays through `replaceTab`, so a rename keeps the view and its state. */
export function mountKey(tab: string) {
	if (!mountKeys.has(tab)) mountKeys.set(tab, `#${++lastKey}`);
	return mountKeys.get(tab) as string;
}

/** The open tab mounted under `key`. */
export const tabOf = (key: string) =>
	allTabs(ui.get()).find((tab) => mountKey(tab) === key);

/** Renames `from` to `to` in the tabs, every tab's history, and the recent tabs, as after renaming what they show. Its
 * view stays mounted. */
export function replaceTab(from: string, to: string) {
	const { groups, history, recent } = ui.get();
	mountKeys.set(to, mountKey(from));
	mountKeys.delete(from);
	const place = places.get(from);
	if (place) savePlace(to, place);
	places.delete(from);
	const rename = (t: string) => (t === from ? to : t);
	ui.set({
		recent: { ...recent, tabs: [...new Set(recent.tabs?.map(rename))] },
		groups: groups.map((g) => ({
			tabs: g.tabs.map(rename),
			active: g.active && rename(g.active),
		})),
		history: Object.fromEntries(
			Object.entries(history).map(([t, h]) => [
				rename(t),
				renamed(h, from, to),
			]),
		),
	});
}

/** Shows the next (1) or previous (-1) tab in the focused group. */
export function cycleTab(step: number) {
	const s = ui.get();
	const { tabs, active } = focused(s);
	const at = active ? tabs.indexOf(active) : 0;
	ui.set({
		groups: withFocused(s, tabs, tabs[(at + step + tabs.length) % tabs.length]),
	});
}

/** Moves `tab` into group `to` at the gap before its tab `gap`, or with no `gap` into a new group made at index `to`.
 * It shows there and its group takes focus. Its history stays. */
export const moveTab = (tab: string, to: number, gap?: number) =>
	ui.set(placed(ui.get(), tab, to, gap));

/** Moves the active tab one place left (-1) or right (1) in its group, stopping at the ends. */
export function shiftTab(step: -1 | 1) {
	const s = ui.get();
	const { tabs, active } = focused(s);
	if (active)
		moveTab(active, s.focus, tabs.indexOf(active) + (step < 0 ? -1 : 2));
}

/** The narrowest a new tab group may be, in rem. */
export const minGroupWidth = 22;
/** The narrowest an open tab group gets before the groups scroll sideways, in rem. */
export const groupFloor = 18;
/** The element the tab groups share. `Control` sets it. */
export const groupArea: { current: HTMLElement | null } = { current: null };

/** Whether the group area has room for `count` groups. */
export function roomFor(count: number) {
	const rem = Number.parseFloat(
		getComputedStyle(document.documentElement).fontSize,
	);
	return (groupArea.current?.clientWidth ?? 0) >= count * minGroupWidth * rem;
}

/** `next`, unless it changes nothing or adds a group there is no room for. */
export const change = (s: Groups, next: Groups) =>
	sameGroups(s, next) ||
	(next.groups.length > s.groups.length && !roomFor(next.groups.length))
		? undefined
		: next;

/** Shows `next`, if any, or says there is no room for it. */
export function regroup(next: Groups | undefined) {
	if (next && change(ui.get(), next)) ui.set(next);
	else if (next) toast("No room for another group", "no-room");
}

/** Where moving the active tab to the next (1) or previous (-1) group puts it: the end of that group, else a new group
 * at that edge. Undefined when that changes nothing, as for the only tab of an edge group. See `regroup`. */
export function groupMove(step: -1 | 1) {
	const s = ui.get();
	const active = activeTab(s);
	if (!active) return;
	const to = s.focus + step;
	const next = s.groups[to]
		? placed(s, active, to, s.groups[to].tabs.length)
		: placed(s, active, Math.max(to, 0));
	return sameGroups(s, next) ? undefined : next;
}

/** Where moving the active tab into a new group to the right of its own puts it. Its group's only tab stays, and an
 * empty tab opens there instead. See `regroup`. */
export function splitMove() {
	const s = ui.get();
	const active = activeTab(s);
	if (!active) return;
	const next = placed(s, active, s.focus + 1);
	return sameGroups(s, next) ? placed(s, emptyTab(), s.focus + 1) : next;
}

/** Focuses the next (1) or previous (-1) group, which focuses its view. */
export function focusGroup(step: -1 | 1) {
	const { groups, focus } = ui.get();
	if (groups[focus + step]) ui.set({ focus: focus + step });
}

let returnFocus: Element | null = null;

const closed: Pick<Ui, "picker" | "confirm" | "roller"> = {
	picker: undefined,
	confirm: undefined,
	roller: false,
};
const popupOpen = () => {
	const { picker, confirm, roller } = ui.get();
	return !!(picker || confirm || roller);
};

/** Opens the picker, a confirmation, or the dice roller in place of the others. Focus returns to where it was before
 * the first opened. */
function popup(open: Partial<typeof closed>) {
	if (!popupOpen()) returnFocus = document.activeElement;
	ui.set({ ...closed, ...open });
}

export const pick = (picker: PickerSpec) => popup({ picker });
/** Asks a yes or no question. Use `pick` for a choice. */
export const confirm = (confirm: ConfirmSpec) => popup({ confirm });

/** Puts a roll at the top of the dice roller's list, from the roller or a number prompt, and returns it. */
export function addRoll(roll: Omit<RollEntry, "id">) {
	const entry = { ...roll, id: performance.now() };
	ui.set({ rolls: [entry, ...ui.get().rolls].slice(0, 50) });
	return entry;
}
export const openRoller = () => popup({ roller: true });

/** A text prompt. `label` names what Enter does with the trimmed query, or returns undefined to refuse it. */
export function ask(
	spec: Omit<PickerSpec, "items" | "fromQuery"> & { items?: Item[] },
	label: (query: string) => string | undefined,
	run: (query: string, newTab: boolean) => void,
) {
	pick({
		items: [],
		...spec,
		fromQuery(query) {
			const text = label(query);
			return text === undefined
				? undefined
				: { label: text, run: (newTab) => run(query, newTab) };
		},
	});
}

/** Closes the open popup and returns focus to where it was. A running item may then move it. */
export function closePopup() {
	if (!popupOpen()) return;
	// The dialog's focus trap must be gone before focus can leave it.
	flushSync(() => ui.set(closed));
	if (returnFocus instanceof HTMLElement)
		returnFocus.focus({ preventScroll: true });
}

/** Shows a message for a few seconds. The control window's `Toaster` renders it. A toast with the same `id` replaces it. */
export const toast = (message: ReactNode, id?: string) =>
	sonner(message, { id });

const displayPage = location.pathname.startsWith("/display");
const zoomKey = `ttrpgui.zoom.${displayPage ? "display" : "control"}`;
const zoomLevels = [
	0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3,
];
const savedZoom = () => Number(localStorage.getItem(zoomKey)) || 1;

/** Sets this page's zoom through its root font size, since every size is in rem. On the display one rem is also
 * 1/54 of the screen's short side, so it scales to any screen. Native zoom would not do: it is shared per origin. */
export function applyZoom(level = savedZoom()) {
	localStorage.setItem(zoomKey, String(level));
	document.documentElement.style.fontSize = displayPage
		? `calc(100vmin / 54 * ${level})`
		: `${level * 100}%`;
	return level;
}

/** Steps this page's zoom in (1) or out (-1), or resets it (0). Returns the new level. */
export function zoom(step: -1 | 0 | 1) {
	if (!step) return applyZoom(1);
	const last = zoomLevels.length - 1;
	const at = zoomLevels.findIndex((level) => level >= savedZoom());
	return applyZoom(
		zoomLevels[Math.max(0, Math.min((at < 0 ? last : at) + step, last))],
	);
}

const zoomSteps = [
	["zoom-in", 1],
	["zoom-out", -1],
	["reset-zoom", 0],
] as const;

/** Zooms if `e` is a zoom bind, for pages without the Action registry. Returns whether it was. */
export function zoomOnKey(e: KeyboardEvent, keys = binds()) {
	const step = zoomSteps.find(([id]) => bindHas(keys[id], eventKey(e)))?.[1];
	if (step !== undefined) zoom(step);
	return step !== undefined;
}
