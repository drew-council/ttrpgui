// The table bar along the bottom of the control window: the game master's remote for the session and the player
// display. It reads the same synced state the rest of the app does. Three zones: the session on the left, the deck
// (everything the players see and hear) centered, the app on the right. Side zones never shrink below their content,
// so the deck stays put until one of them needs its room.
import { cn } from "cn";
import {
	ChevronsUpDownIcon,
	PlayIcon,
	SwordsIcon,
	Volume1Icon,
	Volume2Icon,
	VolumeXIcon,
} from "lucide-react";
import { useState } from "react";
import { Button } from "#components/ui/button.tsx";
import {
	DropdownMenuItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
} from "#components/ui/dropdown-menu.tsx";
import { Kbd } from "#components/ui/kbd.tsx";
import { Slider } from "#components/ui/slider.tsx";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#components/ui/tooltip.tsx";
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
const iconBelow68 = "@max-[68rem]/bar:[&>span]:sr-only";

/** One part of the deck. Each after the first starts with a short hairline. */
const part =
	"flex min-w-0 items-center gap-0.5 not-first:before:mx-1 not-first:before:h-4 not-first:before:w-px not-first:before:flex-none not-first:before:bg-border";

export function Bar() {
	const status = useStatus();
	const problems = useGame((game) => game.problems.length);
	const live = useGame((game) => game.runtime.session);
	const combat = useGame((game) => game.runtime.combat);
	const round = useGame((game) => game.combats[combat ?? ""]?.round);
	const image = useGame((game) => game.runtime.image);
	const atmosphere = useGame((g) => activeAtmosphere(g.atmospheres, g.runtime));
	const display = useAvailable("open-display");
	const openGame = useAvailable("open-game");
	const palette = bindOf("command-palette");
	return (
		<footer className="@container/bar col-span-full grid h-10 min-w-0 grid-cols-[minmax(max-content,1fr)_minmax(0,56rem)_minmax(max-content,1fr)] items-center gap-4 border-t bg-card px-2 text-xs text-muted-foreground">
			<div className="flex min-w-0 items-center gap-0.5">
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
									<span className="max-w-40 truncate @max-[60rem]/bar:max-w-28">
										{live}
									</span>
								</>
							}
							title={actions["open-live-session"].title}
							bind={bindOf("open-live-session")}
							className="font-bold text-primary"
							{...clickOpens((newTab) => openTab(noteTab(live), newTab))}
						/>
						<ActionButton id="end-session" className={iconBelow68} />
					</>
				) : (
					<ActionButton id="go-live" />
				)}
				{combat && (
					<ToolButton
						icon={SwordsIcon}
						label={
							<span className="truncate">
								{combat}, round {round}
							</span>
						}
						title="Open the running combat"
						className="max-w-56 min-w-0 text-kind-combat @max-[60rem]/bar:max-w-40"
						{...clickOpens((newTab) => openTab(combatTab(combat), newTab))}
					/>
				)}
			</div>
			<div className="flex min-w-0 items-center rounded-lg border bg-background p-0.5 shadow-[inset_0_1px_2px_rgb(8_5_12/0.4)]">
				{display && (
					<div className={cn(part, "flex-none")}>
						<ActionButton id="open-display" />
						<ActionButton id="close-display" />
					</div>
				)}
				{atmosphere && (
					<div className={cn(part, "max-w-56")}>
						<AtmosphereSwitcher active={atmosphere} />
					</div>
				)}
				<div className={cn(part, "min-w-auto flex-[1_1_20rem]")}>
					<Music />
				</div>
				<div className={cn(part, "flex-none")}>
					<ActionButton id="show-image" />
					{image && (
						<>
							<span
								className="max-w-40 min-w-0 truncate @max-[60rem]/bar:hidden"
								title={image}
							>
								{image}
							</span>
							<ActionButton id="hide-image" />
						</>
					)}
				</div>
			</div>
			<div className="flex items-center justify-end gap-0.5">
				{problems > 0 && (
					<Button
						variant="ghost"
						size="sm"
						className="font-bold text-destructive"
						{...clickOpens((newTab) => openTab("problems", newTab))}
					>
						{problems === 1 ? "1 problem" : `${problems} problems`}
					</Button>
				)}
				{openGame && <ActionButton id="open-game" />}
				<ActionButton id="command-palette" className={iconBelow68} />
				{palette && (
					<Kbd className="-ml-1 @max-[60rem]/bar:hidden">{palette}</Kbd>
				)}
			</div>
		</footer>
	);
}

/** The active Atmosphere; choosing another switches to it. */
function AtmosphereSwitcher({ active }: { active: string }) {
	const names = useGame((game) => game.atmospheres);
	return (
		<ActionMenu
			label="Switch atmosphere"
			trigger={
				<Button
					variant="ghost"
					size="sm"
					aria-label={`Atmosphere: ${active}. Switch atmosphere`}
					className="min-w-0 shrink text-muted-foreground"
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

/** Play or pause, skip, the volume, then what is playing. The text comes last, so the controls never move. It keeps
 * room for a few words, sized without its text, so the atmosphere name truncates too. */
function Music() {
	const track = useGame((g) => nowPlaying(g.atmospheres, g.runtime));
	const paused = useGame((game) => game.runtime.music?.paused);
	const saved = useGame((game) => game.runtime.music?.volume) ?? 100;
	// The handle follows a drag at once; the volume is sent when the drag ends.
	const [drag, setDrag] = useState<number>();
	const volume = drag ?? saved;
	const VolumeIcon =
		volume === 0 ? VolumeXIcon : volume < 50 ? Volume1Icon : Volume2Icon;
	return (
		<>
			<ActionButton
				id="toggle-music"
				icon={paused ? PlayIcon : undefined}
				className={cn(paused && "text-primary")}
			/>
			<ActionButton id="next-track" />
			<Tooltip>
				<TooltipTrigger asChild>
					<span className="mr-2 ml-1.5 flex flex-none items-center gap-1.5">
						<VolumeIcon className="size-3.5 flex-none text-faint" />
						<Slider
							aria-label="Music volume"
							className="w-20 @max-[60rem]/bar:w-12"
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
					</span>
				</TooltipTrigger>
				<TooltipContent>Music volume {volume}%</TooltipContent>
			</Tooltip>
			<span
				className={cn(
					"min-w-24 flex-1 truncate pr-2 contain-inline-size @max-[60rem]/bar:min-w-16",
					paused ? "text-faint" : "text-foreground",
				)}
			>
				{track ? (
					<>
						{track.title}
						{track.artist && (
							<span className="ml-2 text-faint @max-[76rem]/bar:hidden">
								{track.artist}
							</span>
						)}
					</>
				) : (
					<span className="text-faint">No music</span>
				)}
			</span>
		</>
	);
}
