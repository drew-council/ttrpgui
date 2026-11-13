// Per-client UI state: tabs, sidebar, the open picker, stat block editing, and the tracker selection.
// Tabs and the sidebar survive a reload.
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
	/** Tab ids like `note:Cinder Drake` or `problems`. See `views.tsx`. */
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

/** Shows `tab` and focuses its main element. A tab not yet open replaces the active one, or opens beside it when `newTab`. */
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

/** Shows a message for a few seconds. The control window's `Toaster` renders it. */
export const toast = (message: string) => sonner(message);
