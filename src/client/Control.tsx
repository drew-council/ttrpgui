// The control window: sidebar, tabs, the table bar, plus the popups and toasts on top.
import { cn } from "cn";
import { XIcon } from "lucide-react";
import { type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "#components/ui/button.tsx";
import { Toaster } from "#components/ui/sonner.tsx";
import { TooltipProvider } from "#components/ui/tooltip.tsx";
import { useKeybinds } from "./actions.ts";
import { Bar } from "./Bar.tsx";
import { Confirm } from "./Confirm.tsx";
import { ActionButton } from "./controls.tsx";
import { focusAgain } from "./MarkdownBox.tsx";
import { Picker } from "./Picker.tsx";
import { PrivacyScreen } from "./PrivacyScreen.tsx";
import { Roller } from "./Roller.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { getGame, useGame } from "./sync.ts";
import { closeTab, mountKey, moveTab, toast, ui } from "./ui.ts";
import {
	focusMain,
	PaneContext,
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
	const { sidebar, tabs, active, picker, confirm, roller } = ui.use((s) => s);
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
				<main className="flex min-h-0 flex-col">
					<TabBar />
					<div className="relative min-h-0 flex-1">
						{/* In mount key order, so switching, reordering, or renaming tabs moves no element. */}
						{tabs
							.map((tab) => [mountKey(tab), tab] as const)
							.sort(([a], [b]) => (a < b ? -1 : 1))
							.map(([key, tab]) => (
								<TabPane key={key} tab={tab} shown={tab === active} />
							))}
						{!tabs.length && <TabPane shown />}
					</div>
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

/** An open tab's view, or the welcome hints with none open. Every open tab's view stays mounted and only the active
 * one shows, so a tab shown again finds its scroll positions, focus, text, and state as they were. When its tab shows
 * again, focus goes back to the element in it that had focus, else to its main element; `openTab` on a tab already
 * shown focuses its main element. */
function TabPane({ tab, shown }: { tab?: string; shown: boolean }) {
	const pane = useNewPane(tab ? mountKey(tab) : "");
	const refocus = ui.use((s) => s.refocus);
	const wasShown = useRef(false);
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs when the tab shows, and on each refocus while it does.
	useEffect(() => {
		const appeared = shown && !wasShown.current;
		wasShown.current = shown;
		if (!shown || ui.get().picker) return;
		const { last, root } = pane;
		if (appeared && last instanceof HTMLElement && root?.contains(last))
			focusAgain(last);
		else focusMain(pane);
	}, [shown, refocus]);
	// The view rerenders on its own state, not on its tab showing or hiding.
	const body = useMemo(
		() => (tab ? <TabBody tab={tab} /> : <Welcome />),
		[tab],
	);
	return (
		<PaneContext value={pane}>
			{/* Hidden, it skips rendering and takes no focus or input. Its layout stays, so its scroll positions do. */}
			<div
				inert={!shown}
				className={cn(
					"absolute inset-0",
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
					onFocus={(e) => {
						if (e.currentTarget.contains(e.target)) pane.last = e.target;
					}}
				>
					{body}
				</div>
			</div>
		</PaneContext>
	);
}

/** The drag data type that carries a dragged tab's id. Any drop target MAY read it. */
export const tabDrag = "application/x-ttrpgui-tab";

const insertMark =
	"before:absolute before:inset-y-0 before:z-10 before:w-0.5 before:bg-primary";

function TabBar() {
	const tabs = ui.use((s) => s.tabs);
	const active = ui.use((s) => s.active);
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
		<div className="flex h-9 flex-none border-b bg-card">
			<span className="flex flex-none items-center gap-0.5 px-1">
				<ActionButton id="toggle-sidebar" />
				<ActionButton id="go-back" />
				<ActionButton id="go-forward" />
			</span>
			<div
				role="tablist"
				ref={tablist}
				className="flex min-w-0 flex-1 overflow-x-auto border-l [scrollbar-width:none]"
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
					moveTab(tab, gapAt(e));
					setGap(undefined);
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
						}}
						onDragEnd={() => setGap(undefined)}
						onClick={() => ui.set({ active: tab })}
						onAuxClick={(e) => e.button === 1 && closeTab(tab)}
						onMouseDown={(e) => e.button === 1 && e.preventDefault()}
						className={cn(
							"group relative flex max-w-60 min-w-0 flex-none cursor-pointer items-center gap-2 border-r bg-card pr-1 pl-3 text-muted-foreground aria-selected:-mb-px aria-selected:bg-background aria-selected:text-foreground aria-selected:shadow-[inset_0_2px_var(--primary)]",
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
							onClick={(e) => {
								e.stopPropagation();
								closeTab(tab);
							}}
						>
							<XIcon />
						</Button>
					</div>
				))}
				<span className="flex flex-none items-center px-1">
					<ActionButton id="new-tab" />
				</span>
			</div>
		</div>
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
	const { tabs, active, history } = ui.get();
	const kept = tabs.filter((tab) => tabExists(tab, game));
	ui.set({
		tabs: kept,
		active: active && kept.includes(active) ? active : kept[0],
		history: Object.fromEntries(
			Object.entries(history).filter(([tab]) => kept.includes(tab)),
		),
	});
}
