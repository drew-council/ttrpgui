// The table bar along the bottom of the control window, the game master's remote. Two ends with quiet space between:
// the screen, the table, the shown image, and trouble on the left; the music and the palette pinned right. Amber marks
// only what is live. As the bar narrows, names give way in a fixed order (`order`).
import { cn } from "cn";
import {
	ChevronDownIcon,
	ChevronsUpDownIcon,
	CloudFogIcon,
	MonitorIcon,
	MonitorOffIcon,
	PlayIcon,
	SwordsIcon,
	TriangleAlertIcon,
	Volume1Icon,
	Volume2Icon,
	VolumeXIcon,
	XIcon,
} from "lucide-react";
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { Button } from "#components/ui/button.tsx";
import {
	DropdownMenuItem,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuSeparator,
} from "#components/ui/dropdown-menu.tsx";
import { Slider } from "#components/ui/slider.tsx";
import { Tooltip, TooltipTrigger } from "#components/ui/tooltip.tsx";
import { activeAtmosphere, nowPlaying } from "../shared/display.ts";
import { atmosphereTab } from "./Atmospheres.tsx";
import { actions, switchAtmosphere } from "./actions.ts";
import {
	ActionButton,
	ActionItem,
	ActionMenu,
	afterMenu,
	bindOf,
	capText,
	Tip,
	ToolButton,
	useAvailable,
} from "./controls.tsx";
import { gameUrl } from "./Display.tsx";
import { send, useGame, useStatus } from "./sync.ts";
import { combatTab } from "./Tracker.tsx";
import { clickOpens, openTab, ui } from "./ui.ts";

/** A group's controls join the bar's own row, so `fit` sees every name in one place; a gap sets groups apart. */
const group = "contents *:first:ml-6";

/** A name in the bar. */
const name = cn(capText, "min-w-0 truncate max-w-80");

/** The order names give way as the bar narrows. Only the next one shrinks (`data-gives`); once it would drop below
 * `floor` rem it hides (`data-hide-<name>`) and the next starts. The artist goes first, whole; then the atmosphere and
 * track shrink to `floor` (`data-floor`); last the track goes, leaving its buttons. A name is readable or gone. */
const order = [
	"artist",
	"session",
	"image",
	"combat",
	"rest",
	"track",
] as const;
const floor = 5;

/** Whether everything fits: the last control ends inside the bar's padding (`scrollWidth` misses an overflow narrower
 * than the padding), and no button is squeezed narrower than its content, which it centers, so it spills left. */
function fits(bar: HTMLElement) {
	const end = bar.lastElementChild?.getBoundingClientRect().right ?? 0;
	const { right } = bar.getBoundingClientRect();
	return (
		end <= right - parseFloat(getComputedStyle(bar).paddingRight) + 0.1 &&
		[...bar.querySelectorAll("button")].every((button) => {
			const first = button.firstElementChild?.getBoundingClientRect();
			return (
				button.scrollWidth <= button.clientWidth + 1 &&
				(!first?.width ||
					first.left >= button.getBoundingClientRect().left - 0.5)
			);
		})
	);
}

function fit(bar: HTMLElement) {
	const least =
		floor * parseFloat(getComputedStyle(document.documentElement).fontSize);
	// Measure every name whole.
	delete bar.dataset.gives;
	for (const name of bar.querySelectorAll<HTMLElement>("[data-floor]")) {
		name.style.minWidth = "";
		name.style.minWidth = `${Math.min(name.scrollWidth, least)}px`;
	}
	for (const [level, gives] of order.entries()) {
		for (const [i, hidden] of order.entries())
			bar.toggleAttribute(`data-hide-${hidden}`, i < level);
		bar.dataset.gives = gives;
		const name = bar.querySelector<HTMLElement>(`[data-name=${gives}]`);
		const readable =
			!name || name.clientWidth >= Math.min(name.scrollWidth, least) - 0.5;
		if (fits(bar) && readable) return;
	}
}

/** Its buttons transition only colors, so `fit` measures settled widths. */
export function Bar() {
	const ref = useRef<HTMLElement>(null);
	// Refits whenever the bar's width or content changes.
	useLayoutEffect(() => {
		const bar = ref.current;
		if (!bar) return;
		const refit = () => fit(bar);
		const resize = new ResizeObserver(refit);
		resize.observe(bar);
		const content = new MutationObserver(refit);
		content.observe(bar, {
			subtree: true,
			childList: true,
			characterData: true,
		});
		document.fonts.ready.then(refit);
		return () => {
			resize.disconnect();
			content.disconnect();
		};
	}, []);
	return (
		<footer
			ref={ref}
			className="col-span-full flex h-9 min-w-0 items-center gap-0.5 border-t bg-card px-2 text-xs text-muted-foreground [&_button]:text-xs [&_button]:font-normal [&_button]:transition-[color,background-color,box-shadow] [&_svg]:size-3.5!"
		>
			<Screen />
			<Table />
			<Shown />
			<Trouble />
			<span className="min-w-6 flex-1" />
			<Music />
			<ActionButton id="command-palette" label="" className="ml-6" />
		</footer>
	);
}

/** What the players see: whether the display window is open (Electron only), and the atmosphere. */
function Screen() {
	const open = ui.use((s) => s.display);
	const atmosphere = useGame((g) => activeAtmosphere(g.atmospheres, g.runtime));
	return (
		<>
			{window.ttrpgui && (
				<ActionButton
					id={open ? "close-display" : "open-display"}
					icon={open ? MonitorIcon : MonitorOffIcon}
					className={cn(
						open &&
							"text-primary hover:text-primary [&_svg]:drop-shadow-[0_0_0.25rem_var(--primary)]",
					)}
				/>
			)}
			{atmosphere ? (
				<AtmosphereSwitcher active={atmosphere} />
			) : (
				<span className={cn(capText, "flex-none px-2")}>No atmosphere</span>
			)}
		</>
	);
}

/** The image on the display: show one, or its thumbnail and note's name to show another, and hide. */
function Shown() {
	const image = useGame((game) => game.runtime.image);
	const [note, file = ""] = image?.split("/") ?? [];
	const shown = `${note}: ${file.replace(/\.[^.]+$/, "")}`;
	return (
		<div className={group}>
			{image ? (
				<>
					<ActionButton
						id="show-image"
						icon={null}
						label={
							<>
								<img
									src={gameUrl("notes", ...image.split("/"))}
									alt=""
									className="size-5 flex-none rounded-sm object-cover ring-1 ring-primary"
								/>
								<span
									data-name="image"
									className={cn(name, "in-data-hide-image:hidden")}
								>
									{note}
								</span>
							</>
						}
						title={`Showing ${shown}. Show another`}
						aria-label={`Show another image on the display, now ${shown}`}
						className="min-w-0 px-1 in-data-[gives=image]:shrink"
					/>
					<ActionButton id="hide-image" icon={XIcon} className="text-faint" />
				</>
			) : (
				<ActionButton
					id="show-image"
					title="No image shown. Show one on the display"
				/>
			)}
		</div>
	);
}

/** A name with a menu behind it: the atmosphere switcher (`switcher`, a choice among names) and the live session. */
function MenuName({
	tooltip,
	label,
	switcher,
	children,
	className,
	menu,
}: {
	tooltip: ReactNode;
	label: string;
	switcher?: boolean;
	children: ReactNode;
	className?: string;
	menu: ReactNode;
}) {
	const Chevron = switcher ? ChevronsUpDownIcon : ChevronDownIcon;
	return (
		<ActionMenu
			tooltip={tooltip}
			trigger={
				<Button
					variant="ghost"
					size="sm"
					aria-label={label}
					className={cn("gap-1.5 pr-1.5 pl-2", className)}
				>
					{children}
					<Chevron className="text-faint" />
				</Button>
			}
		>
			{menu}
		</ActionMenu>
	);
}

/** The active Atmosphere; choosing another switches to it. */
function AtmosphereSwitcher({ active }: { active: string }) {
	const names = useGame((game) => game.atmospheres);
	return (
		<MenuName
			tooltip={
				<Tip title="Switch atmosphere" bind={bindOf("switch-atmosphere")} />
			}
			label={`Switch atmosphere, now ${active}`}
			switcher
			className="min-w-0 text-foreground in-data-hide-combat:shrink"
			menu={
				<>
					<DropdownMenuRadioGroup
						value={active}
						onValueChange={switchAtmosphere}
					>
						{Object.keys(names)
							.sort()
							.map((name) => (
								<DropdownMenuRadioItem key={name} value={name} inset>
									{name}
								</DropdownMenuRadioItem>
							))}
					</DropdownMenuRadioGroup>
					<DropdownMenuSeparator />
					<DropdownMenuItem
						onSelect={() => afterMenu(() => openTab(atmosphereTab(active)))}
					>
						<CloudFogIcon />
						Open “{active}”
					</DropdownMenuItem>
				</>
			}
		>
			<span
				data-floor
				className={cn(name, "font-medium in-data-[gives=track]:max-w-20")}
			>
				{active}
			</span>
		</MenuName>
	);
}

/** Go live, or the live session with a menu to open or end it; then the running combat. */
function Table() {
	const live = useGame((game) => game.runtime.session);
	const combat = useGame((game) => game.runtime.combat);
	const round = useGame((game) => game.combats[combat ?? ""]?.round);
	return (
		<div className={group}>
			{live ? (
				<MenuName
					tooltip={
						<Tip
							title={`${live} is live`}
							detail={actions["open-live-session"].title}
							detailBind={bindOf("open-live-session")}
						/>
					}
					label={`Live session, ${live}`}
					className="min-w-0 in-data-[gives=session]:shrink"
					menu={
						<>
							<ActionItem id="open-live-session" />
							<ActionItem id="end-session" destructive />
						</>
					}
				>
					<span className="size-1.5 flex-none rounded-full bg-primary shadow-[0_0_0.375rem_var(--primary)]" />
					<span
						data-name="session"
						className={cn(name, "in-data-hide-session:hidden")}
					>
						{live}
					</span>
					<span className={cn(capText, "hidden in-data-hide-session:block")}>
						Live
					</span>
				</MenuName>
			) : (
				<ActionButton id="go-live" />
			)}
			{combat && (
				<ToolButton
					icon={SwordsIcon}
					label={
						<>
							<span
								data-name="combat"
								className={cn(name, "in-data-hide-combat:hidden")}
							>
								{combat}
							</span>
							{round !== undefined && (
								<span className={cn(capText, "flex-none text-primary")}>
									round {round}
								</span>
							)}
						</>
					}
					title="Open the running combat"
					aria-label={`Open the running combat, ${combat}${round === undefined ? "" : `, round ${round}`}`}
					className="min-w-0 in-data-[gives=combat]:shrink"
					{...clickOpens((newTab) => openTab(combatTab(combat), newTab))}
				/>
			)}
		</div>
	);
}

/** Something is wrong: the server is unreachable, or files have problems. */
function Trouble() {
	const status = useStatus();
	const problems = useGame((game) => game.problems.length);
	return (
		<>
			<span
				role="status"
				className={cn(
					capText,
					"ml-6 flex-none px-2 text-destructive",
					status === "connected" && "sr-only",
				)}
			>
				{status === "connected" ? "Connected" : "Reconnecting…"}
			</span>
			{problems > 0 && (
				<ToolButton
					icon={TriangleAlertIcon}
					label={problems === 1 ? "1 problem" : `${problems} problems`}
					title={actions["show-problems"].title}
					bind={bindOf("show-problems")}
					className="ml-6 flex-none text-destructive hover:text-destructive"
					{...clickOpens((newTab) => openTab("problems", newTab))}
				/>
			)}
		</>
	);
}

/** Why the music is not heard, leading so it comes and goes without moving anything; what is playing; play or pause,
 * skip, mute, and the volume. Inside Electron a closed display means silence, and those words open it. */
function Music() {
	const track = useGame((g) => nowPlaying(g.atmospheres, g.runtime));
	const paused = useGame((game) => game.runtime.music?.paused);
	const saved = useGame((game) => game.runtime.music?.volume) ?? 100;
	const silent = ui.use((s) => !!window.ttrpgui && !s.display);
	const playable = useAvailable("toggle-music");
	// The handle follows a drag at once; the volume is sent when the drag ends.
	const [drag, setDrag] = useState<number>();
	const volume = drag ?? saved;
	const VolumeIcon =
		volume === 0 ? VolumeXIcon : volume < 50 ? Volume1Icon : Volume2Icon;
	const state = track && (paused ? "Paused" : volume === 0 ? "Muted" : "");
	// The slider focuses its handle on a press; a control must not take focus, so a drag gives it back.
	const before = useRef<Element>(null);
	return (
		<>
			{playable && silent ? (
				<ActionButton
					id="open-display"
					icon={null}
					label="Display closed"
					aria-label="Display closed, open the display"
					className="mr-1 flex-none px-2 in-data-[gives=track]:hidden"
				/>
			) : (
				// The wider word always holds its room, at the outer edge where room is quiet, so a change moves nothing.
				<span className="mr-1 grid flex-none justify-items-end px-2 *:[grid-area:1/1] in-data-[gives=track]:hidden">
					<span className={cn(capText, "invisible")}>Paused</span>
					<span className={capText}>{state}</span>
				</span>
			)}
			<span className="flex max-w-80 min-w-0 shrink-0 items-center gap-3.5 pr-2 in-data-hide-combat:shrink in-data-[gives=track]:hidden">
				<span
					data-floor
					className={cn(
						capText,
						"truncate",
						track && "font-medium",
						track && !silent && "text-foreground",
					)}
				>
					{track ? track.title : playable ? "Not playing" : "No tracks"}
				</span>
				{track?.artist && (
					<span
						data-name="artist"
						className={`${capText} truncate text-[color-mix(in_srgb,var(--muted-foreground)_40%,var(--faint))] in-data-hide-artist:hidden`}
					>
						{track.artist}
					</span>
				)}
			</span>
			<ActionButton
				id="toggle-music"
				icon={track && !paused ? undefined : PlayIcon}
				title={track ? (paused ? "Resume music" : "Pause music") : "Play music"}
				detail={
					silent ? "Nothing sounds while the display is closed" : undefined
				}
				className={cn(playable && (paused || !track) && "text-foreground")}
			/>
			<ActionButton id="next-track" />
			<ActionButton
				id="toggle-mute"
				icon={VolumeIcon}
				title={volume === 0 ? "Unmute music" : "Mute music"}
				className={cn(playable && volume === 0 && "text-foreground")}
			/>
			<Tooltip>
				<TooltipTrigger asChild>
					<span
						className="group/volume flex flex-none items-center pr-2"
						onPointerDownCapture={() => {
							before.current = document.activeElement;
						}}
						onPointerUp={() => {
							const was = before.current;
							before.current = null;
							if (was instanceof HTMLElement && was !== document.body)
								was.focus();
							else if (document.activeElement instanceof HTMLElement)
								document.activeElement.blur();
						}}
					>
						<Slider
							// The handle is what takes focus, so it carries the name.
							ref={(root) =>
								root
									?.querySelector("[role=slider]")
									?.setAttribute("aria-label", "Music volume")
							}
							disabled={!playable}
							className={cn(
								"h-7 w-15 **:data-[slot=slider-range]:bg-faint **:data-[slot=slider-thumb]:size-2.5 **:data-[slot=slider-thumb]:border-0 **:data-[slot=slider-thumb]:bg-muted-foreground **:data-[slot=slider-thumb]:ring-foreground/15",
								"**:data-[slot=slider-thumb]:focus-visible:bg-foreground **:data-[slot=slider-thumb]:focus-visible:ring-0 **:data-[slot=slider-thumb]:focus-visible:outline-2 **:data-[slot=slider-thumb]:focus-visible:outline-solid **:data-[slot=slider-thumb]:focus-visible:outline-offset-2 **:data-[slot=slider-thumb]:focus-visible:outline-ring",
								"group-hover/volume:not-data-disabled:**:data-[slot=slider-range]:bg-muted-foreground group-hover/volume:not-data-disabled:**:data-[slot=slider-thumb]:bg-foreground",
								"data-disabled:**:data-[slot=slider-range]:invisible data-disabled:**:data-[slot=slider-thumb]:invisible",
								drag !== undefined &&
									"**:data-[slot=slider-range]:bg-muted-foreground **:data-[slot=slider-thumb]:bg-foreground",
							)}
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
				<Tip
					title={playable ? `Music volume ${volume}%` : "Music volume"}
					bind={[bindOf("volume-down"), bindOf("volume-up")]}
					detail={actions["volume-up"].unavailable?.()}
				/>
			</Tooltip>
		</>
	);
}
