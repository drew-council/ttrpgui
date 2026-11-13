// The control window: sidebar, tabs, the table bar, plus the picker and toasts on top.
import { cn } from "cn";
import { XIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "#components/ui/button.tsx";
import { Toaster } from "#components/ui/sonner.tsx";
import { TooltipProvider } from "#components/ui/tooltip.tsx";
import { useKeybinds } from "./actions.ts";
import { Bar } from "./Bar.tsx";
import { ActionButton } from "./controls.tsx";
import { Picker } from "./Picker.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { getGame, useGame } from "./sync.ts";
import { closeTab, toast, ui } from "./ui.ts";
import { TabBody, TabLabel, tabExists, Welcome } from "./views.tsx";

export function Control() {
	useKeybinds();
	useProblemToasts();
	useEffect(forgetMissingTabs, []);
	const { sidebar, active, picker } = ui.use((s) => s);
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
					<div className="@container min-h-0 flex-1 overflow-y-auto">
						{active ? <TabBody key={active} tab={active} /> : <Welcome />}
					</div>
				</main>
				<Bar />
			</div>
			{picker && <Picker key={picker.title} spec={picker} />}
			<Toaster
				position="bottom-right"
				offset={{ right: "1rem", bottom: "3rem" }}
				duration={6000}
				expand
				closeButton
			/>
		</TooltipProvider>
	);
}

function TabBar() {
	const tabs = ui.use((s) => s.tabs);
	const active = ui.use((s) => s.active);
	return (
		<div className="flex h-9 flex-none border-b bg-card">
			<span className="flex flex-none items-center gap-0.5 px-1">
				<ActionButton id="toggle-sidebar" />
				<ActionButton id="go-back" />
				<ActionButton id="go-forward" />
			</span>
			<div
				role="tablist"
				className="flex min-w-0 flex-1 overflow-x-auto border-l [scrollbar-width:none]"
			>
				{tabs.map((tab) => (
					// biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users switch tabs with Actions.
					<div
						key={tab}
						role="tab"
						tabIndex={-1}
						aria-selected={tab === active}
						onClick={() => ui.set({ active: tab })}
						onAuxClick={(e) => e.button === 1 && closeTab(tab)}
						onMouseDown={(e) => e.button === 1 && e.preventDefault()}
						className="group flex max-w-60 min-w-0 flex-none cursor-pointer items-center gap-2 border-r pr-1 pl-3 text-muted-foreground aria-selected:-mb-px aria-selected:bg-background aria-selected:text-foreground aria-selected:shadow-[inset_0_2px_var(--primary)]"
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
