// The control window: sidebar, tabs, status line, plus the picker and toasts on top.
import { cn } from "cn";
import { PlusIcon, XIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "#components/ui/button.tsx";
import { Kbd } from "#components/ui/kbd.tsx";
import { Toaster } from "#components/ui/sonner.tsx";
import {
	Tooltip,
	TooltipContent,
	TooltipProvider,
	TooltipTrigger,
} from "#components/ui/tooltip.tsx";
import { activeAtmosphere, nowPlaying } from "../shared/display.ts";
import { binds, formatKey } from "../shared/keys.ts";
import { atmosphereTab } from "./Atmospheres.tsx";
import { useKeybinds } from "./actions.ts";
import { Picker } from "./Picker.tsx";
import { Sidebar } from "./Sidebar.tsx";
import { getGame, send, useGame, useStatus } from "./sync.ts";
import { combatTab } from "./Tracker.tsx";
import {
	clickOpens,
	closeTab,
	newTab,
	noteTab,
	openTab,
	toast,
	ui,
} from "./ui.ts";
import { parseTab, TabBody, TabLabel, views, Welcome } from "./views.tsx";

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
				<StatusLine />
			</div>
			{picker && <Picker key={picker.title} spec={picker} />}
			<Toaster
				position="bottom-right"
				offset={{ right: "1rem", bottom: "2.625rem" }}
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
	const newTabKey = binds(getGame().config.keys)["new-tab"];
	return (
		<div
			role="tablist"
			className="flex h-9 flex-none overflow-x-auto border-b bg-card [scrollbar-width:none]"
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
			<Tooltip>
				<TooltipTrigger asChild>
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="New tab"
						className="mx-1 flex-none self-center text-muted-foreground"
						onClick={newTab}
					>
						<PlusIcon />
					</Button>
				</TooltipTrigger>
				<TooltipContent>
					New tab {newTabKey && <Kbd>{formatKey(newTabKey)}</Kbd>}
				</TooltipContent>
			</Tooltip>
		</div>
	);
}

/** A status line entry that opens or does something. */
const statusButton = "-mx-2 font-normal text-muted-foreground";

function StatusLine() {
	const status = useStatus();
	const problems = useGame((game) => game.problems.length);
	const live = useGame((game) => game.runtime.session);
	const combat = useGame((game) => game.runtime.combat);
	const round = useGame((game) => game.combats[combat ?? ""]?.round);
	const atmosphere = useGame((g) => activeAtmosphere(g.atmospheres, g.runtime));
	const track = useGame((g) => nowPlaying(g.atmospheres, g.runtime));
	const { paused, volume } = useGame((game) => game.runtime.music) ?? {};
	const image = useGame((game) => game.runtime.image);
	const palette = binds(getGame().config.keys)["command-palette"];
	return (
		<footer className="col-span-full flex h-6.5 items-center gap-4 border-t bg-card px-3 text-xs text-muted-foreground">
			<span
				className={cn(
					"flex items-center gap-2 before:size-[0.45rem] before:rounded-full before:bg-kind-pc",
					status !== "connected" && "text-destructive before:bg-destructive",
				)}
			>
				{status === "connected" ? "Connected" : "Reconnecting…"}
			</span>
			{live && (
				<Button
					variant="ghost"
					size="xs"
					className={cn(statusButton, "font-bold text-primary")}
					{...clickOpens((n) => openTab(noteTab(live), n))}
				>
					Live: {live}
				</Button>
			)}
			{combat && (
				<Button
					variant="ghost"
					size="xs"
					className={statusButton}
					{...clickOpens((n) => openTab(combatTab(combat), n))}
				>
					{combat}, round {round}
				</Button>
			)}
			{atmosphere && (
				<Button
					variant="ghost"
					size="xs"
					className={statusButton}
					{...clickOpens((n) => openTab(atmosphereTab(atmosphere), n))}
				>
					{atmosphere}
				</Button>
			)}
			{track && (
				<span className="min-w-0 truncate">
					♪ {track.title}
					{track.artist && `, ${track.artist}`}
					{paused && " (paused)"}
					{volume !== undefined && ` at ${volume}%`}
				</span>
			)}
			{image && (
				<Tooltip>
					<TooltipTrigger asChild>
						<Button
							variant="ghost"
							size="xs"
							className={statusButton}
							onClick={() => send({ type: "showImage" })}
						>
							Showing {image}
						</Button>
					</TooltipTrigger>
					<TooltipContent>Hide it</TooltipContent>
				</Tooltip>
			)}
			{problems > 0 && (
				<Button
					variant="ghost"
					size="xs"
					className={cn(statusButton, "font-bold text-destructive")}
					{...clickOpens((n) => openTab("problems", n))}
				>
					{problems === 1 ? "1 problem" : `${problems} problems`}
				</Button>
			)}
			{palette && (
				<span className="ml-auto flex items-center gap-1">
					<Kbd>{formatKey(palette)}</Kbd> Commands
				</span>
			)}
		</footer>
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

/** Drops saved tabs whose target is gone, such as notes deleted while the app was closed. */
function forgetMissingTabs() {
	const game = getGame();
	const { tabs, active } = ui.get();
	const kept = tabs.filter((tab) => {
		const [view, arg] = parseTab(tab);
		return views[view]?.exists?.(arg, game) ?? view in views;
	});
	ui.set({
		tabs: kept,
		active: active && kept.includes(active) ? active : kept[0],
	});
}
