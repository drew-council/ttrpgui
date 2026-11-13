// The atmosphere view: its links, whether it is the default, and the media it has. Actions edit the rest.
import { activeAtmosphere, videoFile } from "../shared/display.ts";
import type { Atmosphere } from "../shared/state.ts";
import { ActionButton, ActionItem, ActionMenu } from "./controls.tsx";
import { gameUrl } from "./Display.tsx";
import { SaveInput } from "./StatBlock.tsx";
import { send, useGame } from "./sync.ts";
import { KindMark, page, pageMeta, pageTitle, Section } from "./views.tsx";

export const atmosphereTab = (name: string) => `atmosphere:${name}`;

const links = [
	["wallpaper", "Wallpaper link", "A YouTube video"],
	["wallpaper_section", "Wallpaper section", "The first two minutes"],
	["music", "Music link", "A YouTube Music playlist"],
] as const;

export function AtmosphereView({ arg: name }: { arg: string }) {
	const atmosphere = useGame((g) => g.atmospheres[name] as Atmosphere);
	const active = useGame(
		(g) => activeAtmosphere(g.atmospheres, g.runtime) === name,
	);
	const { settings, wallpaper, tracks } = atmosphere;
	const dir = `atmospheres/${name}/`;
	return (
		<section className={page}>
			<header>
				<h1 className={pageTitle}>{name}</h1>
				<div className={pageMeta}>
					<KindMark kind="atmosphere" className="-mr-2" />
					<span>{settings.default ? "Default atmosphere" : "Atmosphere"}</span>
					{active && <span className="font-bold text-primary">Active</span>}
					<span className="ml-auto flex items-center gap-0.5">
						{!active && <ActionButton id="switch-atmosphere" />}
						{!settings.default && <ActionButton id="set-default-atmosphere" />}
						<ActionMenu>
							<ActionItem id="rename-atmosphere" />
							<ActionItem id="delete-atmosphere" destructive />
						</ActionMenu>
					</span>
				</div>
			</header>
			<dl className="mt-6 grid gap-2">
				{links.map(([key, label, placeholder]) => (
					<div key={key} className="grid grid-cols-[9rem_1fr] items-center">
						<dt className="text-sm text-muted-foreground">{label}</dt>
						<dd>
							<SaveInput
								label={label}
								placeholder={placeholder}
								saved={settings[key] ?? ""}
								className="md:text-base"
								onSave={(text) =>
									send({
										type: "setAtmosphere",
										name,
										fields: { [key]: text.trim() || null },
									})
								}
							/>
						</dd>
					</div>
				))}
			</dl>
			<p className="mt-4 flex items-center gap-3 text-sm text-faint">
				<ActionButton
					id="sync-atmosphere"
					variant="outline"
					className="border-primary font-bold text-primary dark:border-primary"
				/>
				Downloads what is missing from the links with yt-dlp.
			</p>
			<Section label="Wallpaper">
				{wallpaper ? (
					<figure>
						{videoFile.test(wallpaper) ? (
							<video
								className={preview}
								src={gameUrl("atmospheres", name, wallpaper)}
								muted
							/>
						) : (
							<img
								className={preview}
								src={gameUrl("atmospheres", name, wallpaper)}
								alt=""
							/>
						)}
						<figcaption className="mt-1 text-sm text-faint">
							{wallpaper}
						</figcaption>
					</figure>
				) : (
					<p className="text-muted-foreground">
						None. Sync the link, or put a video or image named wallpaper.webm or
						wallpaper.png in {dir}.
					</p>
				)}
			</Section>
			<Section
				label={`Music: ${tracks.length === 1 ? "1 track" : `${tracks.length} tracks`}`}
			>
				{tracks.length ? (
					<ul>
						{tracks.map((t) => (
							<li key={t.file} className="flex items-center gap-2 px-2 py-1">
								{t.art ? (
									<img
										className={art}
										src={gameUrl("atmospheres", name, "music", t.art)}
										alt=""
									/>
								) : (
									<span className={art} />
								)}
								<span className="min-w-0 flex-1 truncate">{t.title}</span>
								<span className="text-sm text-faint">{t.artist}</span>
							</li>
						))}
					</ul>
				) : (
					<p className="text-muted-foreground">
						None. Sync the link, or put audio files named “Artist - Title.opus”
						in {dir}music/, with cover art beside each as “Artist - Title.jpg”.
					</p>
				)}
			</Section>
		</section>
	);
}

const preview = "block h-56 w-full rounded-lg object-cover";
const art = "size-9 flex-none rounded-sm bg-popover object-cover";
