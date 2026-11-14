// Per-client UI state: tabs and their history, sidebar, the open picker, stat block editing, the tracker selection, and
// zoom. Tabs, their history, the sidebar, and each page's zoom survive a reload.
import type { MouseEvent } from "react";
import { flushSync } from "react-dom";
import { toast as sonner } from "sonner";
import {
	emptyHistory,
	type History,
	pushed,
	renamed,
	step,
} from "./history.ts";
import { createStore } from "./store.ts";

/** A picker row. `run` gets whether the user asked for a new tab. */
export type Item = {
	label: string;
	detail?: string;
	hint?: string;
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
};

type Ui = {
	/** Tab ids like `note:Cinder Drake`, `problems`, or `new:k3j9x` for an empty tab. See `views.tsx`. */
	tabs: string[];
	active?: string;
	/** Each tab's back and forward history, by tab id. A tab without one has none. */
	history: Record<string, History>;
	sidebar: boolean;
	picker?: PickerSpec;
	/** The creature whose stat block is open as a form. */
	editing?: string;
	/** A place in a note tab to move the cursor to, consumed by the note view. */
	reveal?: { tab: string; line: number; column: number };
	/** Labels of the Combatants selected in the open tracker. */
	selected: string[];
	/** Bumped by `openTab`: the shown view focuses its main element again. See `useTabFocus`. */
	refocus: number;
	/** Whether the player display window is open. Electron only. */
	display: boolean;
};

const storageKey = "ttrpgui.ui";
function restore(): Partial<Ui> {
	try {
		return JSON.parse(localStorage.getItem(storageKey) ?? "{}");
	} catch {
		return {};
	}
}

export const ui = createStore<Ui>({
	tabs: [],
	history: {},
	sidebar: true,
	selected: [],
	refocus: 0,
	display: false,
	...restore(),
});
ui.subscribe(() => {
	const { tabs, active, history, sidebar } = ui.get();
	localStorage.setItem(
		storageKey,
		JSON.stringify({ tabs, active, history, sidebar }),
	);
});

export const noteTab = (title: string) => `note:${title}`;

/** Shows `tab` and focuses its main element. A tab not yet open replaces the active one, which goes on that tab's back
 * history, or opens beside it with no history when `newTab`. Every way of opening something ends here. */
export function openTab(tab: string, newTab = false) {
	const { active, refocus } = ui.get();
	const tabs = [...ui.get().tabs];
	let { history } = ui.get();
	if (!tabs.includes(tab)) {
		const at = active ? tabs.indexOf(active) : -1;
		const replaced = newTab || at < 0 ? undefined : active;
		tabs.splice(
			at < 0 ? tabs.length : at + Number(newTab),
			replaced ? 1 : 0,
			tab,
		);
		// An empty tab is nothing to go back to.
		if (replaced && !replaced.startsWith("new:"))
			history = {
				...withoutHistory(history, replaced),
				[tab]: pushed(history[replaced] ?? emptyHistory, replaced),
			};
	}
	ui.set({ tabs, active: tab, history, refocus: refocus + 1 });
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
) {
	const { tabs, active, history } = ui.get();
	if (!active) return;
	return step(
		history[active] ?? emptyHistory,
		active,
		direction,
		(tab) => exists(tab) && !tabs.includes(tab),
	);
}

/** Goes back (-1) or forward (1) in the active tab and focuses what it shows. */
export function travel(direction: -1 | 1, exists: (tab: string) => boolean) {
	const target = travelTarget(direction, exists);
	const { tabs, active, history, refocus } = ui.get();
	if (!target || !active) return;
	ui.set({
		tabs: tabs.map((t) => (t === active ? target.tab : t)),
		active: target.tab,
		history: {
			...withoutHistory(history, active),
			[target.tab]: target.history,
		},
		refocus: refocus + 1,
	});
}

/** Opens an empty tab beside the active one. The next plain open fills it. */
export const newTab = () =>
	openTab(`new:${Math.random().toString(36).slice(2, 8)}`, true);

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

export function closeTab(tab: string) {
	const { tabs, active, history } = ui.get();
	const rest = tabs.filter((t) => t !== tab);
	const next = rest[Math.min(tabs.indexOf(tab), rest.length - 1)];
	ui.set({
		tabs: rest,
		active: active === tab ? next : active,
		history: withoutHistory(history, tab),
	});
}

/** Renames `from` to `to` in the tabs and every tab's history, as after renaming what they show. */
export function replaceTab(from: string, to: string) {
	const { tabs, active, history } = ui.get();
	const rename = (t: string) => (t === from ? to : t);
	ui.set({
		tabs: tabs.map(rename),
		active: active && rename(active),
		history: Object.fromEntries(
			Object.entries(history).map(([t, h]) => [
				rename(t),
				renamed(h, from, to),
			]),
		),
	});
}

export function cycleTab(step: number) {
	const { tabs, active } = ui.get();
	const at = active ? tabs.indexOf(active) : 0;
	ui.set({ active: tabs[(at + step + tabs.length) % tabs.length] });
}

let returnFocus: Element | null = null;

export function pick(picker: PickerSpec) {
	if (!ui.get().picker) returnFocus = document.activeElement;
	ui.set({ picker });
}

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

/** Closes the picker and returns focus to where it was. A running item may then move it. */
export function closePicker() {
	// The dialog's focus trap must be gone before focus can leave it.
	flushSync(() => ui.set({ picker: undefined }));
	if (returnFocus instanceof HTMLElement) returnFocus.focus();
}

/** Shows a message for a few seconds. The control window's `Toaster` renders it. A toast with the same `id` replaces it. */
export const toast = (message: string, id?: string) => sonner(message, { id });

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
