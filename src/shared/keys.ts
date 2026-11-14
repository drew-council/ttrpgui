// Action ids, their default binds, and the key syntax: `ctrl+k`, `shift+g` (or `G`), `j`, `+`, `f2`.
// A bind MAY list alternatives separated by spaces: `= +`.

/** Every Action id with its default bind; "" means unbound. The client's registry MUST cover exactly these ids. */
export const defaultKeys = {
	"command-palette": "ctrl+p",
	"quick-open": "ctrl+k",
	"toggle-sidebar": "ctrl+b",
	"focus-sidebar": "ctrl+e",
	"close-tab": "ctrl+w",
	"next-tab": "ctrl+tab",
	"previous-tab": "ctrl+shift+tab",
	"new-tab": "ctrl+t",
	"go-back": "alt+arrowleft",
	"go-forward": "alt+arrowright",
	"zoom-in": "ctrl+= ctrl++",
	"zoom-out": "ctrl+-",
	"reset-zoom": "ctrl+0",
	"new-note": "ctrl+n",
	"new-session": "",
	"new-creature": "",
	"new-location": "",
	"rename-note": "f2",
	"delete-note": "",
	"change-kind": "",
	"follow-link": "alt+enter",
	"follow-link-new-tab": "ctrl+alt+enter",
	"search-notes": "ctrl+shift+f",
	"set-image-role": "",
	"mark-pc": "",
	"mark-npc": "",
	"set-display-name": "",
	"set-session-date": "",
	"edit-statblock": "ctrl+shift+e",
	"add-statblock-section": "alt+s",
	"add-statblock-entry": "alt+e",
	"remove-statblock-item": "",
	"move-statblock-item-up": "alt+arrowup",
	"move-statblock-item-down": "alt+arrowdown",
	"show-problems": "",
	"open-game": "",
	"new-combat": "",
	"rename-combat": "f2",
	"delete-combat": "",
	"attach-session": "",
	"detach-session": "",
	"start-combat": "shift+s",
	"end-combat": "shift+e",
	"next-turn": "t",
	"roll-initiative": "shift+i",
	"set-initiative": "i",
	"add-combatant": "n",
	"remove-combatant": "x",
	"rename-combatant": "r",
	"edit-combatant-note": "d",
	"toggle-select": "space",
	"clear-selection": "escape",
	damage: "-",
	heal: "= +",
	"set-temp-hp": "h",
	"set-max-hp-adjustment": "m",
	"toggle-condition": "c",
	"toggle-concentration": "shift+c",
	"death-save-success": "s",
	"death-save-failure": "f",
	"spend-legendary-action": "l",
	"spend-legendary-resistance": "shift+l",
	"undo-combat": "u",
	"redo-combat": "ctrl+r",
	"go-live": "",
	"go-live-with-this-session": "",
	"end-session": "",
	"open-live-session": "ctrl+l",
	"party-rest": "",
	"open-display": "",
	"close-display": "",
	"show-image": "alt+i",
	"hide-image": "alt+shift+i",
	"new-atmosphere": "",
	"switch-atmosphere": "alt+a",
	"set-default-atmosphere": "",
	"rename-atmosphere": "f2",
	"delete-atmosphere": "",
	"sync-atmosphere": "",
	"set-combat-atmosphere": "",
	"clear-combat-atmosphere": "",
	"toggle-music": "alt+m",
	"next-track": "alt+n",
	"toggle-mute": "alt+0",
	"volume-up": "alt+=",
	"volume-down": "alt+-",
};
export type ActionId = keyof typeof defaultKeys;

const modifiers = ["ctrl", "alt", "shift", "meta"];
const named =
	/^(enter|escape|tab|space|backspace|delete|insert|home|end|pageup|pagedown|arrow(up|down|left|right)|f\d{1,2})$/;

/** Shift is part of a symbol (`+`, `?`), so it is dropped for those. */
const implicitShift = (key: string) => key.length === 1 && !/[a-z]/.test(key);

function combine(mods: string[], key: string) {
	if (implicitShift(key)) mods = mods.filter((m) => m !== "shift");
	return [...modifiers.filter((m) => mods.includes(m)), key].join("+");
}

/** Canonical form of a bind like `Ctrl+Shift+P` or `= +`, or undefined if it is not valid. */
export function normalizeKey(spec: string): string | undefined {
	const keys = spec.trim().split(/\s+/).map(normalizeOne);
	return keys.every(Boolean) ? keys.join(" ") : undefined;
}

function normalizeOne(spec: string): string | undefined {
	const parts = spec.split(/\+(?!$)/);
	let key = parts.pop() ?? "";
	const mods = parts.map((p) => p.toLowerCase());
	if (/^[A-Z]$/.test(key)) mods.push("shift");
	key = key.toLowerCase();
	if (!(key.length === 1 || named.test(key))) return;
	if (mods.some((m) => !modifiers.includes(m))) return;
	return combine(mods, key);
}

type KeyEventLike = Pick<
	KeyboardEvent,
	"key" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey"
>;

/** The canonical bind a keyboard event matches. */
export function eventKey(e: KeyEventLike): string {
	const key = e.key === " " ? "space" : e.key.toLowerCase();
	const mods = [
		e.ctrlKey && "ctrl",
		e.altKey && "alt",
		e.shiftKey && "shift",
		e.metaKey && "meta",
	].filter((m) => m !== false);
	return combine(mods, key);
}

/** `ctrl+shift+p` → `Ctrl+Shift+P`; `alt+arrowleft` → `Alt+Left`; `= +` → `= / +`. */
export const formatKey = (bind: string) =>
	bind
		.split(" ")
		.map((key) =>
			key
				.split(/\+(?!$)/)
				.map((part) => part.replace(/^arrow(?=.)/, ""))
				.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
				.join("+"),
		)
		.join(" / ");

/** Whether a canonical `bind` includes the canonical `key`. */
export const bindHas = (bind: string, key: string) =>
	bind.split(" ").includes(key);

/** Each Action's canonical bind ("" if unbound): the user config's `keys` over the defaults. */
export function binds(
	keys: Record<string, string> = {},
): Record<ActionId, string> {
	const merged: Record<string, string> = { ...defaultKeys, ...keys };
	return Object.fromEntries(
		Object.keys(defaultKeys).map((id) => [
			id,
			normalizeKey(merged[id] ?? "") ?? "",
		]),
	) as Record<ActionId, string>;
}
