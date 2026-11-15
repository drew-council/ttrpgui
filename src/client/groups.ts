// Tab groups: side-by-side columns of tabs, as pure functions over `Groups`. `ui.ts` keeps one.
import { moved } from "./history.ts";

/** A column of tabs and the one it shows. */
export type Group = { tabs: string[]; active?: string };
/** The groups left to right, never none, and the index of the focused one. Only a lone group is ever empty. */
export type Groups = { groups: Group[]; focus: number };

/** Saved tab state as `Groups`, or in the older shape, one list of tabs, as one group. */
export function restored(saved: {
	groups?: Group[];
	focus?: number;
	tabs?: string[];
	active?: string;
}): Groups {
	const groups = saved.groups?.length
		? saved.groups
		: [{ tabs: saved.tabs ?? [], active: saved.active }];
	const focus = Math.min(Math.max(saved.focus ?? 0, 0), groups.length - 1);
	return { groups, focus };
}

/** The index of the group holding `tab`, or -1. */
export const groupOf = (s: Groups, tab: string) =>
	s.groups.findIndex((g) => g.tabs.includes(tab));

/** Every open tab, group by group. */
export const allTabs = (s: Groups) => s.groups.flatMap((g) => g.tabs);

/** Whether `a` and `b` hold the same tabs in the same places, showing the same ones. */
export const sameGroups = (a: Groups, b: Groups) =>
	JSON.stringify(a.groups) === JSON.stringify(b.groups);

/** `s` without `tab`. Its group shows the next tab, else the one before. An emptied group goes, unless it is the only
 * one; focus then moves to its left neighbor, else its right. */
export function without(s: Groups, tab: string): Groups {
	const at = groupOf(s, tab);
	const group = s.groups[at];
	if (!group) return s;
	const tabs = group.tabs.filter((t) => t !== tab);
	if (!tabs.length && s.groups.length > 1)
		return {
			groups: s.groups.toSpliced(at, 1),
			focus: s.focus > at || (s.focus === at && at > 0) ? s.focus - 1 : s.focus,
		};
	const active =
		group.active === tab
			? tabs[Math.min(group.tabs.indexOf(tab), tabs.length - 1)]
			: group.active;
	return { ...s, groups: s.groups.with(at, { tabs, active }) };
}

/** Moves `tab`, from wherever it is, into group `to` at the gap before its tab `gap`; with no `gap`, into a new group
 * made at index `to`. It shows there, and its group takes focus. */
export function placed(
	s: Groups,
	tab: string,
	to: number,
	gap?: number,
): Groups {
	const from = groupOf(s, tab);
	const target: Group | undefined =
		gap === undefined ? { tabs: [] } : s.groups[to];
	if (!target) return s;
	if (from === to && gap !== undefined)
		return {
			groups: s.groups.with(to, {
				tabs: moved(target.tabs, tab, gap),
				active: tab,
			}),
			focus: to,
		};
	const groups = without(
		{
			groups: gap === undefined ? s.groups.toSpliced(to, 0, target) : s.groups,
			focus: 0,
		},
		tab,
	).groups;
	const at = groups.indexOf(target);
	return {
		groups: groups.with(at, {
			tabs: target.tabs.toSpliced(gap ?? 0, 0, tab),
			active: tab,
		}),
		focus: at,
	};
}
