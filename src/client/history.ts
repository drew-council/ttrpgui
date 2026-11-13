// Each tab's back and forward history, as pure functions over one tab's `History`. `ui.ts` keeps one per tab id.

/** The tab ids a tab showed before (`back`) and after (`forward`) what it shows now. Each list ends with the nearest. */
export type History = { back: string[]; forward: string[] };

export const emptyHistory: History = { back: [], forward: [] };

/** The most entries a tab remembers behind it. */
export const historyCap = 50;

/** The history once a plain open replaces `from`: it goes on the back list and forward clears. */
export const pushed = (history: History, from: string): History => ({
	back: [...history.back, from].slice(-historyCap),
	forward: [],
});

/** Steps back (-1) or forward (1) from `current` to the nearest entry that `can` accepts. Entries it passes over stay
 * on the other side, in order, so a later step can still reach them. */
export function step(
	history: History,
	current: string,
	direction: -1 | 1,
	can: (tab: string) => boolean,
): { tab: string; history: History } | undefined {
	const [from, to] =
		direction < 0
			? [history.back, history.forward]
			: [history.forward, history.back];
	const at = from.findLastIndex(can);
	if (at < 0) return;
	const rest = from.slice(0, at);
	const other = [...to, current, ...from.slice(at + 1).reverse()];
	return {
		tab: from[at] as string,
		history:
			direction < 0
				? { back: rest, forward: other }
				: { back: other, forward: rest },
	};
}

/** `history` with every `from` entry renamed to `to`. */
export function renamed(history: History, from: string, to: string): History {
	const rename = (tab: string) => (tab === from ? to : tab);
	return {
		back: history.back.map(rename),
		forward: history.forward.map(rename),
	};
}
