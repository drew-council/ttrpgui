// The table bar along the bottom of the control window: the game master's remote for the session and the player
// display. It reads the same synced state the rest of the app does.
import { cn } from "cn";
import { ChevronsUpDownIcon, PlayIcon, SwordsIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "#components/ui/button.tsx";
import {
	DropdownMenuItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
} from "#components/ui/dropdown-menu.tsx";
import { Kbd } from "#components/ui/kbd.tsx";
import { Separator } from "#components/ui/separator.tsx";
import { Slider } from "#components/ui/slider.tsx";
import { activeAtmosphere, nowPlaying } from "../shared/display.ts";
import { atmosphereTab } from "./Atmospheres.tsx";
import { actions, switchAtmosphere } from "./actions.ts";
import {
	ActionButton,
	ActionMenu,
	afterMenu,
	bindOf,
	ToolButton,
	useAvailable,
} from "./controls.tsx";
import { send, useGame, useStatus } from "./sync.ts";
import { combatTab } from "./Tracker.tsx";
import { clickOpens, noteTab, openTab } from "./ui.ts";
import { KindMark } from "./views.tsx";

/** Leaves only the icon below a width; the text stays for screen readers. */
const iconBelow64 = "@max-[64rem]/bar:[&>span]:sr-only";

const divider = <Separator orientation="vertical" className="mx-1 my-2.5" />;

export function Bar() {
	const status = useStatus();
	const problems = useGame((game) => game.problems.length);
	const live = useGame((game) => game.runtime.session);
	const combat = useGame((game) => game.runtime.combat);
	const round = useGame((game) => game.combats[combat ?? ""]?.round);
	const image = useGame((game) => game.runtime.image);
	const display = useAvailable("open-display");
	const openGame = useAvailable("open-game");
	const palette = bindOf("command-palette");
	return (
		<footer className="@container/bar col-span-full flex h-9 min-w-0 items-center gap-0.5 border-t bg-card px-2 text-sm text-muted-foreground">
			<span
				role="status"
				title={status === "connected" ? "Connected" : undefined}
				className={cn(
					"mr-1.5 flex flex-none items-center gap-2 before:size-[0.45rem] before:rounded-full before:bg-kind-pc",
					status !== "connected" && "text-destructive before:bg-destructive",
				)}
			>
				{status === "connected" ? (
					<span className="sr-only">Connected</span>
				) : (
					"Reconnecting…"
				)}
			</span>
			{live ? (
				<>
					<ToolButton
						label={
							<>
								<span className="font-normal text-faint">Live</span>{" "}
								<span className="max-w-48 truncate">{live}</span>
							</>
						}
						title={actions["open-live-session"].title}
						bind={bindOf("open-live-session")}
						className="font-bold text-primary"
						{...clickOpens((newTab) => openTab(noteTab(live), newTab))}
					/>
					<ActionButton id="end-session" className={iconBelow64} />
				</>
			) : (
				<ActionButton id="go-live" />
			)}
			{combat && (
				<ToolButton
					icon={SwordsIcon}
					label={
						<span className="max-w-48 truncate">
							{combat}, round {round}
						</span>
					}
					title="Open the running combat"
					className="text-kind-combat"
					{...clickOpens((newTab) => openTab(combatTab(combat), newTab))}
				/>
			)}
			{divider}
			{display && (
				<>
					<ActionButton id="open-display" />
					<ActionButton id="close-display" />
					{divider}
				</>
			)}
			<AtmosphereSwitcher />
			<Music />
			{divider}
			<ActionButton id="show-image" />
			{image && (
				<>
					<span
						className="max-w-60 min-w-0 truncate @max-[56rem]/bar:hidden"
						title={image}
					>
						{image}
					</span>
					<ActionButton id="hide-image" />
				</>
			)}
			<span className="min-w-2 flex-1" />
			{problems > 0 && (
				<Button
					variant="ghost"
					size="sm"
					className="flex-none font-bold text-destructive"
					{...clickOpens((newTab) => openTab("problems", newTab))}
				>
					{problems === 1 ? "1 problem" : `${problems} problems`}
				</Button>
			)}
			{openGame && <ActionButton id="open-game" />}
			<ActionButton
				id="command-palette"
				className={cn("flex-none", iconBelow64)}
			/>
			{palette && (
				<Kbd className="-ml-1 flex-none @max-[56rem]/bar:hidden">{palette}</Kbd>
			)}
		</footer>
	);
}

/** The active Atmosphere; choosing another switches to it. */
function AtmosphereSwitcher() {
	const names = useGame((game) => game.atmospheres);
	const active = useGame((g) => activeAtmosphere(g.atmospheres, g.runtime));
	if (!active) return null;
	return (
		<ActionMenu
			label="Switch atmosphere"
			trigger={
				<Button
					variant="ghost"
					size="sm"
					aria-label={`Atmosphere: ${active}. Switch atmosphere`}
					className="max-w-52 min-w-0 flex-shrink text-muted-foreground"
				>
					<KindMark kind="atmosphere" />
					<span className="truncate">{active}</span>
					<ChevronsUpDownIcon className="text-faint" />
				</Button>
			}
		>
			<DropdownMenuRadioGroup value={active} onValueChange={switchAtmosphere}>
				{Object.keys(names)
					.sort()
					.map((name) => (
						<DropdownMenuRadioItem key={name} value={name}>
							{name}
						</DropdownMenuRadioItem>
					))}
			</DropdownMenuRadioGroup>
			<DropdownMenuSeparator />
			<DropdownMenuItem
				onSelect={() => afterMenu(() => openTab(atmosphereTab(active)))}
			>
				Open “{active}”
			</DropdownMenuItem>
		</ActionMenu>
	);
}

/** Play or pause, skip, what is playing, and the volume. */
function Music() {
	const track = useGame((g) => nowPlaying(g.atmospheres, g.runtime));
	const paused = useGame((game) => game.runtime.music?.paused);
	const saved = useGame((game) => game.runtime.music?.volume) ?? 100;
	// The handle follows a drag at once; the volume is sent when the drag ends.
	const [drag, setDrag] = useState<number>();
	const volume = drag ?? saved;
	return (
		<>
			<ActionButton
				id="toggle-music"
				icon={paused ? PlayIcon : undefined}
				className={cn(paused && "text-primary")}
			/>
			<ActionButton id="next-track" />
			{/* A fixed width, so the volume stays put when the track changes. */}
			<span
				className={cn(
					"mx-1 w-72 min-w-0 truncate",
					paused ? "text-faint" : "text-foreground",
				)}
			>
				{track ? (
					<>
						{track.title}
						{track.artist && (
							<span className="ml-2 text-faint @max-[72rem]/bar:hidden">
								{track.artist}
							</span>
						)}
					</>
				) : (
					<span className="text-faint">No music</span>
				)}
			</span>
			<Slider
				aria-label="Music volume"
				className="w-20 flex-none @max-[48rem]/bar:w-12"
				min={0}
				max={100}
				step={5}
				value={[volume]}
				onValueChange={([v]) => setDrag(v)}
				onValueCommit={async ([v]) => {
					if (v === undefined) return;
					await send({ type: "setMusic", volume: v });
					setDrag((d) => (d === v ? undefined : d));
				}}
			/>
			<span className="w-10 flex-none text-right text-xs tabular-nums">
				{volume}%
			</span>
		</>
	);
}
