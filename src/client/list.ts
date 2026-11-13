// The one list behavior: j/k or arrows move, g/G jump to the ends, Enter opens (Ctrl+Enter in a new tab).
// Letter keys are ignored while typing, so a list can sit under a text box.
import { type KeyboardEvent, useCallback, useRef, useState } from "react";

/** Classes for a `useListNav` list and its rows: the cursor row shows while the list has focus. */
export const listClass = "group/list outline-none";
export const rowClass =
	"flex cursor-pointer items-center gap-2 rounded-sm hover:bg-accent group-focus-within/list:aria-selected:bg-primary/14 group-focus-within/list:aria-selected:text-foreground group-focus-within/list:aria-selected:shadow-[inset_2px_0_var(--primary)]";

export const isTextField = (target: EventTarget | null) =>
	target instanceof HTMLElement &&
	(target.isContentEditable ||
		/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

export function useListNav(
	count: number,
	open: (index: number, newTab: boolean) => void,
) {
	const [cursor, setCursor] = useState(0);
	// The cursor as of the last key, which may not have rendered yet.
	const latest = useRef(0);
	const setIndex = useCallback((i: number) => {
		latest.current = i;
		setCursor(i);
	}, []);
	const clamp = (i: number) => Math.max(0, Math.min(i, count - 1));
	const index = clamp(cursor);
	const ref = useRef<HTMLDivElement>(null);

	function onKeyDown(e: KeyboardEvent) {
		const at = clamp(latest.current);
		const letters =
			!e.ctrlKey && !e.altKey && !e.metaKey && !isTextField(e.target);
		const moves: Record<string, number> = {
			ArrowDown: at + 1,
			ArrowUp: at - 1,
			...(letters && { j: at + 1, k: at - 1, g: 0, G: count - 1 }),
		};
		const move = moves[e.key];
		if (move !== undefined) {
			const next = clamp(move);
			setIndex(next);
			// Scrolls only on keys, so a list low on a page never pulls the page down.
			ref.current
				?.querySelectorAll('[role="option"]')
				[next]?.scrollIntoView({ block: "nearest" });
		} else if (e.key === "Enter" && count) open(at, e.ctrlKey || e.metaKey);
		else return;
		e.preventDefault();
	}

	return { index, setIndex, ref, onKeyDown };
}
