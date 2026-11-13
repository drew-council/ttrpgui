// Per-client UI state: tabs, sidebar, the open picker, stat block editing, the tracker selection, and zoom.
// Tabs, the sidebar, and each page's zoom survive a reload.
import type { MouseEvent } from "react";
import { flushSync } from "react-dom";
import { toast as sonner } from "sonner";
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
	sidebar: true,
	selected: [],
	refocus: 0,
	...restore(),
});
ui.subscribe(() => {
	const { tabs, active, sidebar } = ui.get();
	localStorage.setItem(storageKey, JSON.stringify({ tabs, active, sidebar }));
});

export const noteTab = (title: string) => `note:${title}`;

/** Shows `tab` and focuses its main element. A tab not yet open replaces the active one, or opens beside it when `newTab`.
 * Every way of opening something ends here. */
export function openTab(tab: string, newTab = false) {
	const { active, refocus } = ui.get();
	const tabs = [...ui.get().tabs];
	if (!tabs.includes(tab)) {
		const at = active ? tabs.indexOf(active) : -1;
		tabs.splice(
			at < 0 ? tabs.length : at + Number(newTab),
			newTab ? 0 : 1,
			tab,
		);
	}
	ui.set({ tabs, active: tab, refocus: refocus + 1 });
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
	const { tabs, active } = ui.get();
	const rest = tabs.filter((t) => t !== tab);
	const next = rest[Math.min(tabs.indexOf(tab), rest.length - 1)];
	ui.set({ tabs: rest, active: active === tab ? next : active });
}

export function replaceTab(from: string, to: string) {
	const { tabs, active } = ui.get();
	ui.set({
		tabs: tabs.map((t) => (t === from ? to : t)),
		active: active === from ? to : active,
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
