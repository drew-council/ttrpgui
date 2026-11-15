// Notes grouped by kind, and combats, with a filter. Adding a group is one entry in `groups`.
// Groups collapse. Keys: j/k and g/G move over group headers and rows, Enter opens a row or toggles a header,
// h or Left collapses the cursor's group, l or Right expands it. While filtering, every group with a match shows open.
import { cn } from "cn";
import { ChevronRightIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Input } from "#components/ui/input.tsx";
import { Kbd } from "#components/ui/kbd.tsx";
import type { ActionId } from "../shared/keys.ts";
import { localDate, noteLabel, sessionOrder } from "../shared/notes.ts";
import type { GameState } from "../shared/state.ts";
import { atmosphereTab } from "./Atmospheres.tsx";
import { ActionButton } from "./controls.tsx";
import { listClass, rowClass, useListNav } from "./list.ts";
import { useGame } from "./sync.ts";
import { combatTab } from "./Tracker.tsx";
import { activeTab, clickOpens, noteTab, openTab, ui } from "./ui.ts";
import {
	type DisplayKind,
	KindMark,
	kindOf,
	NoteName,
	parseTab,
} from "./views.tsx";

const byName = (a: string, b: string) =>
	a.localeCompare(b, undefined, { numeric: true });

const notesOf =
	(kind: DisplayKind, order = (_: GameState) => byName) =>
	(game: GameState) =>
		Object.keys(game.notes)
			.filter((title) => kindOf(game.notes[title]) === kind)
			.sort(order(game))
			.map(noteTab);

/** Each group's tabs, its kind, and the Action that creates one. A new creature is an NPC until marked as a PC. */
const groups: {
	label: string;
	tabs: (game: GameState) => string[];
	kind: DisplayKind;
	create?: ActionId;
}[] = [
	{
		label: "Sessions",
		tabs: notesOf("session", (game) => sessionOrder(game.notes)),
		kind: "session",
		create: "new-session",
	},
	{ label: "PCs", tabs: notesOf("pc"), kind: "pc" },
	{
		label: "NPCs",
		tabs: notesOf("npc"),
		kind: "npc",
		create: "new-creature",
	},
	{
		label: "Vehicles",
		tabs: notesOf("vehicle"),
		kind: "vehicle",
		create: "new-vehicle",
	},
	{
		label: "Locations",
		tabs: notesOf("location"),
		kind: "location",
		create: "new-location",
	},
	{
		label: "Notes",
		tabs: notesOf("note"),
		kind: "note",
		create: "new-note",
	},
	{
		label: "Combats",
		tabs: (game) => Object.keys(game.combats).sort(byName).map(combatTab),
		kind: "combat",
		create: "new-combat",
	},
	{
		label: "Atmospheres",
		tabs: (game) =>
			Object.keys(game.atmospheres).sort(byName).map(atmosphereTab),
		kind: "atmosphere",
		create: "new-atmosphere",
	},
];

/** What a row shows and the filter matches: a note's label and title, or a name. */
function rowText(tab: string, game: GameState) {
	const [view, arg] = parseTab(tab);
	return view === "note" ? `${noteLabel(arg, game.notes[arg])} ${arg}` : arg;
}

/** Focuses the list with the cursor on the active tab's row, while the sidebar shows. */
let focusList: (() => void) | undefined;

/** Shows the sidebar and focuses its list. */
export function focusSidebar() {
	// The list must mount before it can take focus.
	flushSync(() => ui.set({ sidebar: true }));
	focusList?.();
}

/** The active tab's row, or the header of a collapsed group holding it: it sits in the page's color, as its tab does. */
const current = "aria-[current]:bg-background aria-[current]:text-foreground";

const setOpen = (label: string, open: boolean) =>
	ui.set({
		collapsed: [
			...ui.get().collapsed.filter((l) => l !== label),
			...(open ? [] : [label]),
		],
	});

export function Sidebar() {
	const game = useGame((game) => game);
	const active = ui.use(activeTab);
	const collapsed = ui.use((s) => s.collapsed);
	const [filter, setFilter] = useState("");
	const input = useRef<HTMLInputElement>(null);
	const needle = filter.trim().toLowerCase();
	const shown = useMemo(
		() =>
			groups
				.map(({ tabs, ...group }) => ({
					...group,
					tabs: tabs(game).filter((tab) =>
						rowText(tab, game).toLowerCase().includes(needle),
					),
					open: !!needle || !collapsed.includes(group.label),
				}))
				// Empty groups show while unfiltered, so their kind can be created.
				.filter((group) => group.tabs.length || (!needle && group.create)),
		[game, needle, collapsed],
	);
	// The cursor's stops: each header unless filtering, then each shown row.
	const rows: { group: string; tab?: string }[] = shown.flatMap((group) => [
		...(needle ? [] : [{ group: group.label }]),
		...(group.open
			? group.tabs.map((tab) => ({ group: group.label, tab }))
			: []),
	]);
	const at = (group: string, tab?: string) =>
		rows.findIndex((row) => row.group === group && row.tab === tab);
	const nav = useListNav(rows.length, (i, newTab) => {
		const row = rows[i];
		if (row?.tab) openTab(row.tab, newTab);
		else if (row) toggle(row.group, collapsed.includes(row.group));
	});
	// The active tab's row, else the header of the collapsed group holding it.
	const holder = shown.find((group) => group.tabs.includes(active ?? ""));
	const activeAt = holder
		? at(holder.label, holder.open ? active : undefined)
		: -1;
	const option = (i: number) =>
		nav.ref.current?.querySelectorAll('[role="option"]')[i];
	/** Opens or collapses a group with the cursor on its header. A collapse from deep in the group would leave the
	 * header out of view, so it scrolls back to it. */
	const toggle = (group: string, open: boolean) => {
		const header = at(group);
		flushSync(() => {
			setOpen(group, open);
			nav.setIndex(header);
		});
		if (!open) option(header)?.scrollIntoView({ block: "nearest" });
	};
	focusList = () => {
		const i = activeAt < 0 ? nav.index : activeAt;
		nav.setIndex(i);
		option(i)?.scrollIntoView({ block: "nearest" });
		nav.ref.current?.focus();
	};
	// biome-ignore lint/correctness/useExhaustiveDependencies: reveals the active row when the active tab changes.
	useEffect(() => {
		nav.ref.current
			?.querySelector("[aria-current]")
			?.scrollIntoView({ block: "nearest" });
	}, [active]);
	// Rows show a year only on dates from other years; then every date takes the wider column.
	const year = localDate().slice(0, 4);
	const yearly = Object.values(game.notes).some(
		({ metadata }) =>
			metadata.kind === "session" &&
			metadata.date &&
			!metadata.date.startsWith(year),
	);

	return (
		<nav
			// The cursor also shows while typing in the filter, since arrows and Enter act on it.
			className="group/list row-start-1 flex min-h-0 flex-col border-r bg-card"
			onKeyDown={nav.onKeyDown}
		>
			<div className="flex items-center gap-1 py-3 pr-2 pl-3">
				<div className="relative flex-1">
					<Input
						ref={input}
						value={filter}
						placeholder="Filter notes"
						aria-label="Filter notes"
						className="pr-8 md:text-base"
						onChange={(e) => {
							setFilter(e.target.value);
							nav.setIndex(0);
							nav.ref.current?.scrollTo({ top: 0 });
						}}
						onKeyDown={(e) => {
							if (e.key !== "Escape") return;
							flushSync(() => setFilter(""));
							focusList?.();
						}}
					/>
					<Kbd className="absolute top-1/2 right-2 -translate-y-1/2">/</Kbd>
				</div>
				<ActionButton id="search-notes" />
			</div>
			{rows.length === 0 && (
				<p className="px-4 text-muted-foreground">
					Nothing matches “{filter}”.
				</p>
			)}
			<div
				className={cn(listClass, "flex-1 overflow-y-auto px-2 pb-4")}
				role="listbox"
				ref={nav.ref}
				tabIndex={0}
				onKeyDown={(e) => {
					if (e.key === "/") {
						e.preventDefault();
						input.current?.focus();
						return;
					}
					const row = rows[nav.index];
					const plain = !e.ctrlKey && !e.altKey && !e.metaKey;
					const open = {
						l: true,
						ArrowRight: true,
						h: false,
						ArrowLeft: false,
					}[e.key];
					if (!row || !plain || needle || open === undefined) return;
					e.preventDefault();
					if (open) setOpen(row.group, true);
					else toggle(row.group, false);
				}}
			>
				{shown.map((group) => {
					const header = at(group.label);
					const holdsActive = !group.open && group.tabs.includes(active ?? "");
					return (
						<section key={group.label} className="not-first:mt-1">
							{/* A hairline under the header while rows scroll beneath it. */}
							<h2 className="sticky top-0 z-10 -mx-2 bg-card px-2 [container-type:scroll-state]">
								{/* biome-ignore lint/a11y/useKeyWithClickEvents: the header's keys are the list's. */}
								{/* biome-ignore lint/a11y/noStaticElementInteractions: an option, except while filtering. */}
								<div
									// Not a cursor stop while filtering.
									{...(!needle && {
										role: "option",
										tabIndex: -1,
										"aria-selected": header === nav.index,
										"aria-expanded": group.open,
									})}
									aria-current={holdsActive || undefined}
									className={cn(
										rowClass,
										"h-8 gap-1.5 pr-0.5 pl-1",
										current,
										needle && "cursor-default hover:bg-transparent",
										"[@container_scroll-state(stuck:top)]:after:absolute [@container_scroll-state(stuck:top)]:after:inset-x-0 [@container_scroll-state(stuck:top)]:after:bottom-0 [@container_scroll-state(stuck:top)]:after:h-px [@container_scroll-state(stuck:top)]:after:bg-border",
									)}
									onClick={() => {
										if (!needle) toggle(group.label, !group.open);
									}}
								>
									<ChevronRightIcon
										className={cn(
											"size-3.5 flex-none text-faint transition-transform motion-reduce:transition-none",
											group.open && "rotate-90",
											needle && "invisible",
										)}
									/>
									<span
										className="font-serif text-base font-semibold italic"
										style={{ color: `var(--kind-${group.kind})` }}
									>
										{group.label}
									</span>
									<span className="flex flex-1 pl-1">
										{holdsActive && <KindMark kind={group.kind} />}
									</span>
									<span className="text-sm text-faint tabular-nums">
										{group.tabs.length}
									</span>
									{/* biome-ignore lint/a11y/noStaticElementInteractions: keeps the button's click from toggling the group. */}
									{/* biome-ignore lint/a11y/useKeyWithClickEvents: the header's keys are the list's. */}
									<span
										className="flex w-6"
										onClickCapture={() => setOpen(group.label, true)}
										onClick={(e) => e.stopPropagation()}
									>
										{group.create && (
											<ActionButton
												id={group.create}
												tabIndex={-1}
												className="size-6 text-faint"
											/>
										)}
									</span>
								</div>
							</h2>
							{group.open &&
								group.tabs.map((tab) => {
									const i = at(group.label, tab);
									const [view, arg] = parseTab(tab);
									return (
										<div
											key={tab}
											role="option"
											tabIndex={-1}
											aria-selected={i === nav.index}
											aria-current={tab === active || undefined}
											title={
												view === "note" ? noteLabel(arg, game.notes[arg]) : arg
											}
											className={cn(
												rowClass,
												"scroll-mt-9 py-[0.2rem] pr-2 pl-1 text-muted-foreground",
												current,
											)}
											{...clickOpens((newTab) => {
												nav.setIndex(i);
												openTab(tab, newTab);
											})}
										>
											<span className="flex w-3.5 flex-none justify-center">
												{tab === active && <KindMark kind={group.kind} />}
											</span>
											{view === "note" ? (
												<NoteName
													title={arg}
													dateWidth={yearly ? "min-w-17" : "min-w-12"}
												/>
											) : (
												<span className="min-w-0 flex-1 truncate">{arg}</span>
											)}
										</div>
									);
								})}
						</section>
					);
				})}
			</div>
		</nav>
	);
}
