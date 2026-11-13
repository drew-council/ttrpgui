// The player display: the active Atmosphere's wallpaper and music, the shown image, and the player tracker.
// Audio plays only here. What players may see of a Combat comes from `playerTracker`.
import { cn } from "cn";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Badge } from "#components/ui/badge.tsx";
import { Button } from "#components/ui/button.tsx";
import { Kbd } from "#components/ui/kbd.tsx";
import {
	activeAtmosphere,
	nowPlaying,
	type PlayerRow,
	playerTracker,
	videoFile,
} from "../shared/display.ts";
import { bindHas, binds, eventKey } from "../shared/keys.ts";
import { getGame, send, useGame } from "./sync.ts";
import { zoom } from "./ui.ts";
import { KindMark } from "./views.tsx";

/** URL of a file in the Game. */
export const gameUrl = (...path: string[]) =>
	`/game/${path.map(encodeURIComponent).join("/")}`;

export function Display() {
	const name = useGame((g) => activeAtmosphere(g.atmospheres, g.runtime));
	const wallpaper = useGame((g) => g.atmospheres[name ?? ""]?.wallpaper);
	const image = useGame((g) => g.runtime.image);
	const combat = useGame((g) => g.combats[g.runtime.combat ?? ""]);
	const notes = useGame((g) => g.notes);
	const tracker = combat && playerTracker(combat, notes);
	const idle = useIdle();
	return (
		// The wallpaper is the scene; everything else keeps to the edges, and the accent marks only what is happening now.
		// A gradient along the bottom keeps the now-playing text legible over a bright wallpaper.
		// biome-ignore lint/a11y/noStaticElementInteractions: a double-click anywhere toggles fullscreen; F is the keyboard path.
		<div
			className="relative grid h-full grid-cols-[minmax(0,1fr)_auto] grid-rows-[minmax(0,1fr)_auto] overflow-hidden bg-background bg-[radial-gradient(circle_at_30%_110%,rgb(242_185_91/0.12),transparent_60%)] select-none before:pointer-events-none before:absolute before:inset-x-0 before:bottom-0 before:z-1 before:h-64 before:bg-[linear-gradient(to_top,rgb(12_9_16/0.85),rgb(12_9_16/0.45)_50%,transparent)] data-idle:cursor-none"
			data-idle={idle || undefined}
			onDoubleClick={toggleFullscreen}
		>
			<Fade
				layer="wallpaper"
				className="absolute inset-0 z-0"
				value={name && wallpaper && gameUrl("atmospheres", name, wallpaper)}
			>
				{(src) =>
					videoFile.test(src) ? (
						<video
							className={cover}
							src={src}
							autoPlay
							muted
							loop
							playsInline
						/>
					) : (
						<img className={cover} src={src} alt="" />
					)
				}
			</Fade>
			{/* Scaled to fit, so small images still read large. The shadows follow the picture, not its box. */}
			<Fade
				layer="shown"
				className="relative z-2 col-start-1 row-start-1 min-h-0 px-20 pt-16 pb-4"
				value={image && gameUrl("notes", ...image.split("/"))}
			>
				{(src) => (
					<img
						className="block size-full object-contain [filter:drop-shadow(0_0_0.15rem_rgb(242_185_91/0.6))_drop-shadow(0_1.5rem_2.5rem_rgb(8_5_12/0.75))]"
						src={src}
						alt=""
					/>
				)}
			</Fade>
			{tracker && <PlayerTracker {...tracker} />}
			{name && <Music atmosphere={name} />}
			{!idle && !document.fullscreenElement && (
				<p className="absolute top-6 right-8 z-3 text-muted-foreground text-shadow-glow">
					Double-click or press <Kbd>F</Kbd> for fullscreen
				</p>
			)}
		</div>
	);
}

const cover = "block size-full object-cover";
/** The display fades everything in slowly. Reduced motion still runs the animations, since Fade waits for their end. */
const fadeIn = "animate-in fill-mode-both fade-in motion-reduce:duration-1";

/** Plays the current track, reports its end so the server picks the next, and shows what is playing. */
function Music({ atmosphere }: { atmosphere: string }) {
	const track = useGame((g) => nowPlaying(g.atmospheres, g.runtime));
	const count = useGame((g) => g.atmospheres[atmosphere]?.tracks.length ?? 0);
	const {
		track: current,
		paused,
		volume = 100,
	} = useGame((g) => g.runtime.music) ?? {};
	const audio = useRef<HTMLAudioElement>(null);
	const [blocked, setBlocked] = useState(false);
	const file = track?.file;
	// No track of this Atmosphere is current, such as after a switch: ask for one.
	useEffect(() => {
		if (!file && count) send({ type: "nextTrack", after: current });
	}, [file, count, current]);
	useEffect(() => {
		const element = audio.current;
		if (!element || !file) return;
		element.volume = volume / 100;
		if (paused) element.pause();
		else
			element.play().then(
				() => setBlocked(false),
				(e: Error) => setBlocked(e.name === "NotAllowedError"),
			);
	}, [file, paused, volume]);

	if (!track) return null;
	const play = () => audio.current?.play().then(() => setBlocked(false));
	const art =
		"size-22 flex-none rounded-lg object-cover shadow-[0_0.5rem_1.5rem_rgb(8_5_12/0.6)]";
	return (
		<>
			{/* biome-ignore lint/a11y/useMediaCaption: music has no captions. */}
			<audio
				ref={audio}
				src={gameUrl("atmospheres", atmosphere, "music", track.file)}
				loop={count === 1}
				onEnded={() => send({ type: "nextTrack", after: track.file })}
			/>
			<div
				key={track.file}
				className={cn(
					fadeIn,
					"relative z-2 col-start-1 row-start-2 flex min-w-0 items-center gap-5 px-14 pt-4 pb-12 duration-1600 text-shadow-glow",
					paused && "opacity-60",
				)}
			>
				{track.art ? (
					<img
						className={art}
						src={gameUrl("atmospheres", atmosphere, "music", track.art)}
						alt=""
					/>
				) : (
					<span
						className={cn(
							art,
							"grid place-items-center bg-glass text-[2.5rem] text-primary",
						)}
						aria-hidden
					>
						♪
					</span>
				)}
				<p
					className={cn(
						"flex min-w-0 flex-col border-l-[0.2rem] border-primary pl-5",
						paused && "border-faint",
					)}
				>
					<span className="truncate font-serif text-[2rem]/[1.15] font-semibold">
						{track.title}
					</span>
					<span className="text-[1.375rem] opacity-75">
						{paused ? "Paused" : track.artist}
					</span>
				</p>
			</div>
			{blocked && (
				<Button
					variant="outline"
					className="absolute top-1/2 left-1/2 z-2 h-auto -translate-1/2 rounded-full border-primary bg-glass px-8 py-4 text-2xl font-normal text-foreground hover:bg-glass dark:border-primary dark:bg-glass dark:hover:bg-glass"
					onClick={play}
				>
					Click to start the music
				</Button>
			)}
		</>
	);
}

/** A sheet down the right edge, like a playbill of who acts when. */
function PlayerTracker({
	round,
	active,
	onDeck,
	order,
}: NonNullable<ReturnType<typeof playerTracker>>) {
	const list = useRef<HTMLOListElement>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: scrolls when the turn moves.
	useEffect(() => {
		list.current
			?.querySelector("[data-active]")
			?.scrollIntoView({ block: "nearest", behavior: "smooth" });
	}, [active?.key]);
	return (
		<aside
			className={cn(
				fadeIn,
				"relative z-2 col-start-2 row-span-2 row-start-1 flex min-h-0 w-[31rem] flex-col border-l border-primary/20 bg-glass px-10 pt-12 pb-8 duration-800 backdrop-blur-[1.5rem]",
			)}
		>
			<p className="mb-7 font-serif text-[1.75rem]/none font-medium text-primary italic">
				Round {round}
			</p>
			{active && (
				<div
					key={active.key}
					className={cn(
						fadeIn,
						"grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-6 duration-800",
					)}
				>
					<span className="row-span-2 grid size-30 place-items-center overflow-hidden rounded-full bg-popover font-serif text-[3.5rem]/none font-semibold text-primary shadow-[0_0_0_0.25rem_var(--primary),0_0_3rem_rgb(242_185_91/0.35)]">
						{active.portrait ? (
							<img
								className="size-full object-cover"
								src={gameUrl("notes", ...active.portrait.split("/"))}
								alt=""
							/>
						) : (
							active.label[0]
						)}
					</span>
					<h2 className="self-end font-serif text-[2.5rem]/[1.05] font-semibold text-balance wrap-anywhere">
						{active.label}
					</h2>
					<Conditions row={active} className="mt-2 self-start text-[1.2rem]" />
				</div>
			)}
			{onDeck && (
				<p className="mt-6 border-y py-3 text-[1.375rem] text-muted-foreground">
					On deck <b className="ml-2 text-kind-pc">{onDeck}</b>
				</p>
			)}
			<ol
				ref={list}
				className="-mx-3 mt-5 min-h-0 flex-1 overflow-hidden [mask-image:linear-gradient(to_bottom,black_85%,transparent)]"
			>
				{order.map((row) => (
					<li
						key={row.key}
						data-active={row.active || undefined}
						className={cn(
							fadeIn,
							"flex flex-wrap items-baseline gap-x-3 rounded-lg px-3 py-[0.2rem] font-serif text-[1.4rem]/[1.35] font-medium duration-800 data-active:bg-primary/14 data-active:text-primary data-active:shadow-[inset_0.2rem_0_var(--primary)]",
						)}
					>
						<span className="flex min-w-0 items-center gap-3 truncate">
							<KindMark
								kind={row.pc ? "pc" : "npc"}
								className="size-[0.55rem] rounded-none"
							/>
							{row.label}
						</span>
						<Conditions row={row} className="text-base/normal" />
					</li>
				))}
			</ol>
		</aside>
	);
}

const Conditions = ({
	row,
	className,
}: {
	row: PlayerRow;
	className: string;
}) =>
	row.conditions.length > 0 && (
		<span className="flex flex-wrap gap-[0.4rem]">
			{row.conditions.map((c) => (
				<Badge
					key={c}
					variant="destructive"
					className={cn(
						"h-auto px-[0.6rem] py-[0.05rem] font-sans text-[#f8c2b8]",
						className,
					)}
				>
					{c}
				</Badge>
			))}
		</span>
	);

/** Shows `value` through `children`, fading the old one out as a new one fades in. */
function Fade({
	layer,
	className,
	value,
	children,
}: {
	layer: string;
	className: string;
	value?: string;
	children: (value: string) => ReactNode;
}) {
	const [layers, setLayers] = useState<{ value: string; out?: true }[]>([]);
	useEffect(() => {
		setLayers((all) => [
			...all
				.filter((l) => l.value !== value)
				.map((l) => ({ value: l.value, out: true as const })),
			...(value ? [{ value }] : []),
		]);
	}, [value]);
	return layers.map((l) => (
		<div
			key={l.value}
			data-layer={layer}
			className={cn(
				fadeIn,
				"duration-1600",
				l.out && "animate-out fade-out",
				className,
			)}
			onAnimationEnd={(e) => {
				if (l.out && e.target === e.currentTarget)
					setLayers((all) => all.filter((m) => m.value !== l.value || !m.out));
			}}
		>
			{children(l.value)}
		</div>
	));
}

function toggleFullscreen() {
	if (document.fullscreenElement) void document.exitFullscreen();
	else void document.documentElement.requestFullscreen();
}

const zooms = [
	["zoom-in", 1],
	["zoom-out", -1],
	["reset-zoom", 0],
] as const;

/** True once the pointer has rested a few seconds, which hides it and the fullscreen hint. F toggles fullscreen;
 * the zoom binds zoom this page only. */
function useIdle() {
	const [idle, setIdle] = useState(false);
	useEffect(() => {
		let timer: ReturnType<typeof setTimeout>;
		const wake = () => {
			setIdle(false);
			clearTimeout(timer);
			timer = setTimeout(() => setIdle(true), 4000);
		};
		const onKey = (e: KeyboardEvent) => {
			const keys = binds(getGame().config.keys);
			const step = zooms.find(([id]) => bindHas(keys[id], eventKey(e)))?.[1];
			if (step !== undefined) zoom(step);
			else if (e.key === "f" || e.key === "F11") toggleFullscreen();
			else return;
			e.preventDefault();
		};
		wake();
		window.addEventListener("mousemove", wake);
		window.addEventListener("keydown", onKey);
		document.addEventListener("fullscreenchange", wake);
		return () => {
			clearTimeout(timer);
			window.removeEventListener("mousemove", wake);
			window.removeEventListener("keydown", onKey);
			document.removeEventListener("fullscreenchange", wake);
		};
	}, []);
	return idle;
}
