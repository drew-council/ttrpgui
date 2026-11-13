// Notes grouped by kind, and combats, with a filter. Adding a group is one entry in `groups`.
import { cn } from "cn";
import { type RefObject, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Input } from "#components/ui/input.tsx";
import { Kbd } from "#components/ui/kbd.tsx";
import type { ActionId } from "../shared/keys.ts";
import type { GameState } from "../shared/state.ts";
import { atmosphereTab } from "./Atmospheres.tsx";
import { ActionButton } from "./controls.tsx";
import { listClass, rowClass, useListNav } from "./list.ts";
import { useGame } from "./sync.ts";
import { combatTab } from "./Tracker.tsx";
import { clickOpens, noteTab, openTab, ui } from "./ui.ts";
import { type DisplayKind, kindOf, parseTab, TabLabel } from "./views.tsx";

const notesOf = (kind: DisplayKind) => (game: GameState) =>
	Object.keys(game.notes)
		.filter((title) => kindOf(game.notes[title]) === kind)
		.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
		.map(noteTab);

/** Each group's tabs, and the Action that creates one of its kind. A new creature is an NPC until marked as a PC. */
const groups: {
	label: string;
	tabs: (game: GameState) => string[];
	create?: ActionId;
}[] = [
	{ label: "Sessions", tabs: notesOf("session"), create: "new-session" },
	{ label: "PCs", tabs: notesOf("pc") },
	{ label: "NPCs", tabs: notesOf("npc"), create: "new-creature" },
	{ label: "Locations", tabs: notesOf("location"), create: "new-location" },
	{ label: "Notes", tabs: notesOf("note"), create: "new-note" },
	{
		label: "Combats",
		tabs: (game) => Object.keys(game.combats).sort().map(combatTab),
		create: "new-combat",
	},
	{
		label: "Atmospheres",
		tabs: (game) => Object.keys(game.atmospheres).sort().map(atmosphereTab),
		create: "new-atmosphere",
	},
];

/** The list, while the sidebar shows. */
let list: RefObject<HTMLDivElement | null> | undefined;

/** Shows the sidebar and focuses its list. */
export function focusSidebar() {
	// The list must mount before it can take focus.
	flushSync(() => ui.set({ sidebar: true }));
	list?.current?.focus();
}

export function Sidebar() {
	const game = useGame((game) => game);
	const active = ui.use((s) => s.active);
	const [filter, setFilter] = useState("");
	const input = useRef<HTMLInputElement>(null);
	const shown = useMemo(() => {
		const needle = filter.trim().toLowerCase();
		// Empty groups show while unfiltered, so their kind can be created.
		return groups
			.map(({ tabs, ...group }) => ({
				...group,
				tabs: tabs(game).filter((tab) =>
					parseTab(tab)[1].toLowerCase().includes(needle),
				),
			}))
			.filter((group) => group.tabs.length || (!needle && group.create));
	}, [game, filter]);
	const flat = shown.flatMap((group) => group.tabs);
	const nav = useListNav(flat.length, (i, newTab) =>
		openTab(flat[i] as string, newTab),
	);
	list = nav.ref;

	return (
		<nav
			className="row-start-1 flex min-h-0 flex-col border-r bg-card"
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
						}}
						onKeyDown={(e) => {
							if (e.key !== "Escape") return;
							setFilter("");
							nav.ref.current?.focus();
						}}
					/>
					<Kbd className="absolute top-1/2 right-2 -translate-y-1/2">/</Kbd>
				</div>
				<ActionButton id="search-notes" />
			</div>
			<div
				className={cn(listClass, "flex-1 overflow-y-auto px-2 pb-4")}
				role="listbox"
				ref={nav.ref}
				tabIndex={0}
				onKeyDown={(e) => {
					if (e.key !== "/") return;
					e.preventDefault();
					input.current?.focus();
				}}
			>
				{shown.map((group) => (
					<section key={group.label} className="not-first:mt-3">
						<h2 className="flex h-7 items-center gap-1 pl-2 text-sm font-bold text-muted-foreground">
							<span className="flex-1">{group.label}</span>
							<span className="font-normal text-faint">
								{group.tabs.length}
							</span>
							{group.create ? (
								<ActionButton
									id={group.create}
									tabIndex={-1}
									className="size-6 text-faint"
								/>
							) : (
								<span className="w-6" />
							)}
						</h2>
						{group.tabs.map((tab) => {
							const i = flat.indexOf(tab);
							return (
								<div
									key={tab}
									role="option"
									tabIndex={-1}
									aria-selected={i === nav.index}
									aria-current={tab === active || undefined}
									className={cn(
										rowClass,
										"py-[0.2rem] pr-2 pl-3 text-muted-foreground aria-[current]:bg-accent aria-[current]:font-medium aria-[current]:text-foreground",
									)}
									{...clickOpens((newTab) => {
										nav.setIndex(i);
										openTab(tab, newTab);
									})}
								>
									<TabLabel tab={tab} />
								</div>
							);
						})}
					</section>
				))}
			</div>
			{flat.length === 0 && (
				<p className="p-4 text-muted-foreground">
					{filter ? `Nothing matches “${filter}”.` : "No notes yet."}
				</p>
			)}
		</nav>
	);
}
