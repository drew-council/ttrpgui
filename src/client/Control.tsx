// The control window: sidebar, tab groups, the table bar, plus the popups and toasts on top.
import { cn } from "cn";
import { XIcon } from "lucide-react";
import {
	type DragEvent,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Button } from "#components/ui/button.tsx";
import { Toaster } from "#components/ui/sonner.tsx";
import { TooltipProvider } from "#components/ui/tooltip.tsx";
import { useKeybinds } from "./actions.ts";
import { Bar } from "./Bar.tsx";
import { Confirm } from "./Confirm.tsx";
import { ActionButton, GroupContext } from "./controls.tsx";
import { allTabs, type Group, groupOf, placed, without } from "./groups.ts";
import { Picker } from "./Picker.tsx";
import { PrivacyScreen } from "./PrivacyScreen.tsx";
import { Roller } from "./Roller.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { getGame, useGame } from "./sync.ts";
import {
	change,
	closeTab,
	groupArea,
	minGroupWidth,
	mountKey,
	moveTab,
	places,
	savePlace,
	toast,
	ui,
} from "./ui.ts";
import {
	focusMain,
	focusPane,
	PaneContext,
	placeOf,
	restorePlace,
	TabBody,
	TabLabel,
	tabExists,
	useNewPane,
	Welcome,
} from "./views.tsx";

export function Control() {
	useKeybinds();
	useProblemToasts();
	useEffect(forgetMissingTabs, []);
	const { sidebar, groups, focus, drag, picker, confirm, roller } = ui.use(
		(s) => s,
	);
	const placedIn = groups.flatMap((g, i) =>
		g.tabs.map((tab) => [tab, i] as const),
	);
	return (
		<TooltipProvider>
			<div
				className={cn(
					"grid h-full grid-rows-[minmax(0,1fr)_auto]",
					sidebar
						? "grid-cols-[15.5rem_minmax(0,1fr)]"
						: "grid-cols-[minmax(0,1fr)]",
				)}
			>
				{sidebar && <Sidebar />}
				{/* A column per group: its tab bar on top, its panes stacked under it. Too narrow for them, it scrolls. */}
				<main
					ref={groupArea}
					className="relative grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-x-auto"
					style={{
						gridTemplateColumns: `repeat(${groups.length}, minmax(${minGroupWidth}rem, 1fr))`,
					}}
				>
					{groups.map((_, i) => (
						// biome-ignore lint/suspicious/noArrayIndexKey: a tab bar is its group's place.
						<TabBar key={i} group={i} />
					))}
					{/* One flat list in mount key order, placed by CSS, so switching, reordering, renaming, or moving tabs
					    between groups moves and remounts no element. */}
					{placedIn
						.map(([tab, group]) => [mountKey(tab), tab, group] as const)
						.sort(([a], [b]) => (a < b ? -1 : 1))
						.map(([key, tab, group]) => (
							<TabPane
								key={key}
								tab={tab}
								group={group}
								shown={groups[group]?.active === tab}
								focused={group === focus}
							/>
						))}
					{!placedIn.length && <TabPane group={0} shown focused />}
					{drag &&
						groups.map((_, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: a drop zone is its group's place.
							<DropZone key={i} group={i} tab={drag} />
						))}
				</main>
				<Bar />
			</div>
			{roller && <Roller />}
			{picker && <Picker key={picker.title} spec={picker} />}
			{confirm && <Confirm key={confirm.title} spec={confirm} />}
			<Toaster
				// Under the dialogs (z-50), so an open popup covers it.
				className="toaster group z-40!"
				position="bottom-right"
				offset={{ right: "1rem", bottom: "3rem" }}
				duration={6000}
				expand
				closeButton
			/>
			<PrivacyScreen />
		</TooltipProvider>
	);
}

/** Focuses group `group` if it is not focused. */
const focusOn = (group: number) =>
	ui.get().focus !== group && ui.set({ focus: group });

/** An open tab's view in its group's column, or the welcome hints with none open. Every open tab's view stays mounted
 * once shown and only its group's active one shows, so a tab shown again finds its scroll positions, focus, text, and
 * state as they were. Its view mounts when it first shows. When its tab shows in the focused group, focus goes back to
 * the element in it that had focus, else to its main element; `openTab` on a tab already shown focuses its main
 * element, and so does a closed popup whose focus has nowhere to return. Focus or a press inside focuses its group. A
 * view that unmounts leaves its place (`savePlace`), which it finds again when its tab comes back. */
function TabPane({
	tab,
	group,
	shown,
	focused,
}: {
	tab?: string;
	group: number;
	shown: boolean;
	focused: boolean;
}) {
	const pane = useNewPane(tab ? mountKey(tab) : "");
	const refocus = ui.use((s) => s.refocus);
	const popup = ui.use((s) => !!(s.picker || s.confirm || s.roller));
	/** The group it shows in with focus, else -1. */
	const at = shown && focused ? group : -1;
	const was = useRef(-1);
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs when it shows with focus, and on each refocus while it does.
	useEffect(() => {
		const appeared = at !== was.current;
		was.current = at;
		if (at < 0 || popup) return;
		// Focus already landed in it, as from a click.
		if (appeared && pane.root?.contains(document.activeElement)) return;
		if (appeared) focusPane(pane);
		else focusMain(pane);
	}, [at, refocus]);
	// A closed popup returns focus to where it was. If that is gone or hidden, as after switching tabs under it, focus
	// comes here.
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs when a popup closes.
	useEffect(() => {
		const lost = document.activeElement;
		if (
			at >= 0 &&
			!popup &&
			(!lost || lost === document.body || lost.closest("[inert]"))
		)
			focusPane(pane);
	}, [popup]);
	const [seen, setSeen] = useState(shown);
	if (shown && !seen) setSeen(true);
	const now = useRef(tab);
	now.current = tab;
	// Before its elements go, so it can still read them.
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs when its view first shows, and as it unmounts.
	useLayoutEffect(() => {
		if (!seen || !tab) return;
		const place = places.get(tab);
		// A search result's place in it wins.
		const stop =
			place && ui.get().reveal?.tab !== tab
				? restorePlace(pane, place)
				: undefined;
		return () => {
			stop?.();
			if (now.current) savePlace(now.current, placeOf(pane));
		};
	}, [seen]);
	// The view rerenders on its own state, not on its tab showing or hiding.
	const body = useMemo(
		() => seen && (tab ? <TabBody tab={tab} /> : <Welcome />),
		[tab, seen],
	);
	return (
		<PaneContext value={pane}>
			<GroupContext value={group}>
				{/* Hidden, it skips rendering and takes no focus or input. Its layout stays, so its scroll positions do. Outside
			    the focused group, its view mutes its cursors (`in-data-unfocused:`). */}
				<div
					inert={!shown}
					data-unfocused={!focused || undefined}
					style={{ gridArea: `2 / ${group + 1} / 3 / ${group + 2}` }}
					className={cn(
						"absolute inset-0",
						group > 0 && "border-l",
						!shown && "invisible [content-visibility:hidden]",
					)}
				>
					<div
						ref={(root) => {
							pane.root = root;
						}}
						role="tabpanel"
						tabIndex={-1}
						className="@container h-full overflow-y-auto outline-none"
						// Focus moves in before the press acts, so what it runs, or a menu it opens, sees this group focused.
						onPointerDownCapture={() => {
							focusOn(group);
							if (!pane.root?.contains(document.activeElement)) focusPane(pane);
						}}
						onFocus={(e) => {
							if (e.currentTarget.contains(e.target)) pane.last = e.target;
							focusOn(group);
						}}
					>
						{body}
					</div>
				</div>
			</GroupContext>
		</PaneContext>
	);
}

/** The drag data type that carries a dragged tab's id. Any drop target MAY read it. */
export const tabDrag = "application/x-ttrpgui-tab";

/** A drag's insertion mark: a caret-like bar, clear of the active tab's amber stripe. */
const insertMark =
	"before:absolute before:inset-y-1.5 before:z-10 before:w-0.5 before:rounded-full before:bg-foreground";

type Side = "left" | "right" | "middle";

/** While a tab is dragged, the drop target over group `group`'s content. Its left or right quarter makes a new group
 * on that side, the middle of another group moves the tab to its end. The part a drop would fill tints; a drop that
 * would change nothing, or make a group there is no room for, is refused. */
function DropZone({ group, tab }: { group: number; tab: string }) {
	const [side, setSide] = useState<Side>();
	const target = (e: DragEvent) => {
		const r = e.currentTarget.getBoundingClientRect();
		const x = (e.clientX - r.left) / r.width;
		const side: Side = x < 0.25 ? "left" : x > 0.75 ? "right" : "middle";
		const s = ui.get();
		const next = change(
			s,
			side !== "middle"
				? placed(s, tab, group + Number(side === "right"))
				: groupOf(s, tab) !== group
					? placed(s, tab, group, s.groups[group]?.tabs.length)
					: s,
		);
		return next && { side, next };
	};
	const over = (e: DragEvent) => {
		const to = target(e);
		setSide(to?.side);
		if (!to) return;
		e.preventDefault();
		e.dataTransfer.dropEffect = "move";
	};
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: a drop target for the mouse; the keyboard moves tabs with Actions.
		<div
			style={{ gridArea: `2 / ${group + 1} / 3 / ${group + 2}` }}
			className="absolute inset-0 z-20"
			onDragEnter={over}
			onDragOver={over}
			onDragLeave={() => setSide(undefined)}
			onDrop={(e) => {
				const to = target(e);
				setSide(undefined);
				if (!to) return;
				e.preventDefault();
				ui.set({ ...to.next, drag: undefined });
			}}
		>
			{side && (
				<div
					className={cn(
						"pointer-events-none absolute inset-y-0 bg-primary/12",
						side === "left" && "left-0 w-1/2",
						side === "right" && "right-0 w-1/2",
						side === "middle" && "inset-x-0",
					)}
				/>
			)}
		</div>
	);
}

const noGroup: Group = { tabs: [] };

/** Group `group`'s tab bar. Its active tab's marker shows in full only while the group has focus. A press in it focuses
 * the group first, so its buttons act on it. A wheel scrolls its tabs sideways. */
function TabBar({ group }: { group: number }) {
	const { tabs, active } = ui.use((s) => s.groups[group] ?? noGroup);
	const focused = ui.use((s) => s.focus === group);
	const tablist = useRef<HTMLDivElement>(null);
	/** Where a dragged tab would land: the gap before `tabs[gap]`. */
	const [gap, setGap] = useState<number>();
	const gapAt = (e: DragEvent) =>
		[...(tablist.current?.querySelectorAll('[role="tab"]') ?? [])].filter(
			(t) => {
				const r = t.getBoundingClientRect();
				return r.left + r.width / 2 < e.clientX;
			},
		).length;
	// Chromium sends dragenter, not dragover, on a move into another element, and takes the drop effect from it.
	const dragOver = (e: DragEvent) => {
		if (!e.dataTransfer.types.includes(tabDrag)) return;
		e.preventDefault();
		e.dataTransfer.dropEffect = "move";
		setGap(gapAt(e));
	};
	// biome-ignore lint/correctness/useExhaustiveDependencies: scrolls when the active tab or the tabs change.
	useEffect(() => {
		tablist.current
			?.querySelector('[aria-selected="true"]')
			?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [active, tabs]);
	return (
		<GroupContext value={group}>
			<div
				style={{ gridColumn: group + 1 }}
				className={cn(
					"flex h-9 min-w-0 border-b bg-card",
					group > 0 && "border-l",
				)}
				onPointerDownCapture={() => focusOn(group)}
			>
				<span className="flex flex-none items-center gap-0.5 px-1">
					{group === 0 && <ActionButton id="toggle-sidebar" />}
					<ActionButton id="go-back" />
					<ActionButton id="go-forward" />
				</span>
				<div
					role="tablist"
					ref={tablist}
					className="flex min-w-0 flex-1 scroll-pr-10 overflow-x-auto border-l [scrollbar-width:none]"
					onWheel={(e) => {
						if (!e.deltaX) e.currentTarget.scrollLeft += e.deltaY;
					}}
					onDragEnter={dragOver}
					onDragOver={dragOver}
					onDragLeave={(e) => {
						if (!e.currentTarget.contains(e.relatedTarget as Node))
							setGap(undefined);
					}}
					onDrop={(e) => {
						const tab = e.dataTransfer.getData(tabDrag);
						if (!tab) return;
						e.preventDefault();
						moveTab(tab, group, gapAt(e));
						setGap(undefined);
						ui.set({ drag: undefined });
					}}
				>
					{tabs.map((tab, i) => (
						// biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users switch tabs with Actions.
						<div
							key={tab}
							role="tab"
							tabIndex={-1}
							aria-selected={tab === active}
							draggable
							onDragStart={(e) => {
								e.dataTransfer.setData(tabDrag, tab);
								e.dataTransfer.effectAllowed = "move";
								// Changing the page as the drag starts would cancel it.
								setTimeout(() => ui.set({ drag: tab }));
							}}
							// A press focuses it, since refusing focus would stop it dragging. A click or a drag hands focus to the
							// shown view, as showing a tab does.
							onDragEnd={() => {
								setGap(undefined);
								ui.set({ drag: undefined });
								focusPane();
							}}
							onClick={() => {
								moveTab(tab, group, i);
								focusPane();
							}}
							onAuxClick={(e) => e.button === 1 && closeTab(tab)}
							onMouseDown={(e) => e.button === 1 && e.preventDefault()}
							className={cn(
								"group relative flex max-w-60 min-w-0 flex-none cursor-pointer items-center gap-2 border-r bg-card pr-1 pl-3 text-muted-foreground aria-selected:-mb-px aria-selected:bg-background aria-selected:text-foreground",
								focused
									? "aria-selected:shadow-[inset_0_2px_var(--primary)]"
									: "aria-selected:shadow-[inset_0_2px_var(--faint)]",
								// A drag's insertion mark: at this tab's left, or at the last tab's right for the end.
								gap === i && `${insertMark} before:left-0`,
								gap === tabs.length &&
									i === tabs.length - 1 &&
									`${insertMark} before:-right-px`,
							)}
						>
							<TabLabel tab={tab} />
							<Button
								variant="ghost"
								size="icon-xs"
								aria-label="Close tab"
								className="invisible text-faint group-hover:visible group-aria-selected:visible"
								// Focus stays in the view rather than falling to the page with the closed tab.
								onMouseDown={(e) => e.preventDefault()}
								onClick={(e) => {
									e.stopPropagation();
									closeTab(tab);
								}}
							>
								<XIcon />
							</Button>
						</div>
					))}
					{/* Stays in view when the tabs overflow. */}
					<span className="sticky right-0 flex flex-none items-center bg-card px-1">
						<ActionButton id="new-tab" />
					</span>
				</div>
			</div>
		</GroupContext>
	);
}

/** Toasts problems that were not there before. The first snapshot only seeds the set. */
function useProblemToasts() {
	const problems = useGame((game) => game.problems);
	const seen = useRef<Set<string>>(null);
	useEffect(() => {
		const keys = problems.map((p) => JSON.stringify(p));
		const before = seen.current;
		seen.current = new Set(keys);
		if (!before) return;
		const fresh = problems.filter((_, i) => !before.has(keys[i] as string));
		const [first] = fresh;
		if (fresh.length === 1 && first)
			toast(`Problem in ${first.file}: ${first.message}`);
		else if (fresh.length > 1)
			toast(`${fresh.length} new problems. See the problems list.`);
	}, [problems]);
}

/** Drops saved tabs whose target is gone, such as notes deleted while the app was closed, and their history. */
function forgetMissingTabs() {
	const game = getGame();
	const s = ui.get();
	const missing = allTabs(s).filter((tab) => !tabExists(tab, game));
	const { groups, focus } = missing.reduce(without, s);
	const kept = allTabs({ groups, focus });
	ui.set({
		groups,
		focus,
		history: Object.fromEntries(
			Object.entries(s.history).filter(([tab]) => kept.includes(tab)),
		),
	});
}
