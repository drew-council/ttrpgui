// Tab views. A tab id is `view:arg` (or just `view`); adding a view is one entry in `views`.
import { EditorView } from "@codemirror/view";
import { cn } from "cn";
import { CalendarDaysIcon, MonitorUpIcon, TagIcon } from "lucide-react";
import { type FC, type ReactNode, useEffect, useRef, useState } from "react";
import { Badge } from "#components/ui/badge.tsx";
import { DropdownMenuSeparator } from "#components/ui/dropdown-menu.tsx";
import { Kbd } from "#components/ui/kbd.tsx";
import { canFight } from "../shared/combat.ts";
import { binds, formatKey } from "../shared/keys.ts";
import {
	backlinks,
	formatDate,
	imageFile,
	isDateTitle,
	labelParts,
	mainImage,
	noteLabel,
	sessionOrder,
} from "../shared/notes.ts";
import { type ImageRole, imageRoles } from "../shared/schema.ts";
import type { GameState, Note } from "../shared/state.ts";
import { AtmosphereView } from "./Atmospheres.tsx";
import {
	ActionButton,
	ActionItem,
	ActionMenu,
	capText,
	ToolButton,
} from "./controls.tsx";
import { listClass, rowClass, useListNav } from "./list.ts";
import { MarkdownBox } from "./MarkdownBox.tsx";
import { SaveInput, StatBlock } from "./StatBlock.tsx";
import { getGame, send, useGame } from "./sync.ts";
import { CombatView, combatTab } from "./Tracker.tsx";
import { clickOpens, noteTab, openTab, pick, ui } from "./ui.ts";

type View = {
	/** Shown in tabs and the sidebar. */
	Label: FC<{ arg: string }>;
	/** Renders only while `exists`. */
	Body: FC<{ arg: string }>;
	/** Whether the tab still points at something. Defaults to true. */
	exists?: (arg: string, game: GameState) => boolean;
};

export const views: Record<string, View> = {
	note: {
		Label: NoteLabel,
		Body: NoteView,
		exists: (title, game) => Object.hasOwn(game.notes, title),
	},
	combat: {
		Label: ({ arg }) => <KindLabel kind="combat" name={arg} />,
		Body: CombatView,
		exists: (name, game) => Object.hasOwn(game.combats, name),
	},
	atmosphere: {
		Label: ({ arg }) => <KindLabel kind="atmosphere" name={arg} />,
		Body: AtmosphereView,
		exists: (name, game) => Object.hasOwn(game.atmospheres, name),
	},
	problems: { Label: () => "Problems", Body: ProblemsView },
	/** An empty tab: `new:<unique>`. */
	new: { Label: () => "New tab", Body: Welcome },
};

/** Focuses a view's main element when its tab shows, and again each time `openTab` opens it. Not while the picker is open. */
export function useTabFocus(focus: () => void) {
	const refocus = ui.use((s) => s.refocus);
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs on mount and on each refocus.
	useEffect(() => {
		if (!ui.get().picker) focus();
	}, [refocus]);
}

export function parseTab(tab: string): [view: string, arg: string] {
	const at = tab.indexOf(":");
	return at < 0 ? [tab, ""] : [tab.slice(0, at), tab.slice(at + 1)];
}

/** Whether a tab id still points at something, such as a note that was not deleted or renamed. */
export function tabExists(tab: string, game: GameState) {
	const [view, arg] = parseTab(tab);
	return views[view]?.exists?.(arg, game) ?? view in views;
}

export function TabLabel({ tab }: { tab: string }) {
	const [view, arg] = parseTab(tab);
	const Label = views[view]?.Label;
	return Label ? <Label arg={arg} /> : tab;
}

export function TabBody({ tab }: { tab: string }) {
	const [view, arg] = parseTab(tab);
	const exists = useGame((game) => views[view]?.exists?.(arg, game) ?? true);
	const Body = views[view]?.Body;
	if (!exists)
		return (
			<p className="p-4 text-muted-foreground">
				“{arg}” no longer exists. It was renamed or deleted outside this window.
			</p>
		);
	return Body ? <Body arg={arg} /> : null;
}

export const kindLabels = {
	session: "Session",
	pc: "PC",
	npc: "NPC",
	location: "Location",
	vehicle: "Vehicle",
	note: "Note",
	combat: "Combat",
	atmosphere: "Atmosphere",
};
export type DisplayKind = keyof typeof kindLabels;

/** A note's kind, with creatures split into PCs and NPCs. */
export function kindOf(note: Note | undefined): DisplayKind {
	const metadata = note?.metadata;
	if (metadata?.kind === "creature") return metadata.pc ? "pc" : "npc";
	return metadata?.kind ?? "note";
}

const kindColors: Record<DisplayKind, string> = {
	session: "bg-kind-session",
	pc: "bg-kind-pc",
	npc: "bg-kind-npc",
	location: "bg-kind-location",
	vehicle: "bg-kind-vehicle",
	note: "shadow-[inset_0_0_0_1.5px_var(--kind-note)]",
	combat: "bg-kind-combat",
	atmosphere: "bg-kind-atmosphere",
};

/** A small lozenge colored by kind; plain notes are hollow. */
export const KindMark = ({
	kind,
	className,
}: {
	kind: DisplayKind;
	className?: string;
}) => (
	<span
		className={cn(
			"size-[0.45rem] flex-none rotate-45 rounded-[1px]",
			kindColors[kind],
			className,
		)}
		aria-hidden
	/>
);

const KindLabel = ({ kind, name }: { kind: DisplayKind; name: string }) => (
	<>
		<KindMark kind={kind} />
		<span className="min-w-0 flex-1 truncate">{name}</span>
	</>
);

/** A centered page column, and the big italic title atop it. */
export const page = "mx-auto max-w-[46rem] px-8 pt-8 pb-12";
export const pageTitle =
	"font-serif text-4xl/[1.1] font-semibold italic wrap-anywhere";
/** The line of facts under a page title. */
export const pageMeta =
	"mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground";

function NoteLabel({ arg: title }: { arg: string }) {
	const kind = useGame((game) => kindOf(game.notes[title]));
	return (
		<>
			<KindMark kind={kind} />
			<NoteName title={title} />
		</>
	);
}

/** A note's label as a row shows it: a Session's short date, muted when a name follows, then its name in the row's
 * color. `dateWidth` gives dates one width, so they read as a column. */
export function NoteName({
	title,
	dateWidth,
}: {
	title: string;
	dateWidth?: string;
}) {
	const date = useGame((game) => labelParts(title, game.notes[title]).date);
	const name = useGame((game) => labelParts(title, game.notes[title]).name);
	return (
		<span className="min-w-0 flex-1 truncate">
			{date && (
				<span
					className={cn(
						"tabular-nums",
						name && "text-faint",
						dateWidth && ["inline-block", dateWidth],
					)}
				>
					{formatDate(date, true)}
				</span>
			)}
			{date && name && " "}
			{name}
		</span>
	);
}

/** The Session whose page should focus its name field when it opens, such as one just created. */
let naming: string | undefined;
export const nameSession = (title: string) => {
	naming = title;
};

function NoteView({ arg: title }: { arg: string }) {
	const notes = useGame((game) => game.notes);
	const combats = useGame((game) => game.combats);
	const note = notes[title] as Note;
	const [body, setBody] = useState<string>();
	const loaded = body !== undefined;
	const editor = useRef<EditorView>(null);
	const wrapper = useRef<HTMLDivElement>(null);
	const nameField = useRef<HTMLInputElement>(null);
	const tab = noteTab(title);
	const reveal = ui.use((s) => (s.reveal?.tab === tab ? s.reveal : undefined));
	const editing = ui.use((s) => s.editing === title);
	const version = note.bodyVersion;
	// biome-ignore lint/correctness/useExhaustiveDependencies: refetches when note.md changes.
	useEffect(() => {
		let live = true;
		fetch(`${noteDir(title)}note.md`, { cache: "no-store" })
			.then((res) => (res.ok ? res.text() : ""))
			.then((text) => live && setBody(text));
		return () => {
			live = false;
		};
	}, [title, version]);

	// The wrapper passes focus to the editor. Until the text loads it holds focus, and hands it over on load if it still has it.
	// Without scrolling, as the editor focuses: in the narrow layout the text sits below the stat block.
	const focusText = () =>
		editor.current
			? editor.current.focus()
			: wrapper.current?.focus({ preventScroll: true });
	useTabFocus(() => {
		if (naming !== title) return focusText();
		naming = undefined;
		nameField.current?.focus();
	});
	useEffect(() => {
		if (loaded && document.activeElement === wrapper.current)
			editor.current?.focus();
	}, [loaded]);
	// Closing the stat block form returns to the text box, as Escape in the editor does.
	useEffect(() => {
		if (!editing) return;
		return () =>
			(editor.current?.dom.parentElement ?? wrapper.current)?.focus();
	}, [editing]);

	useEffect(() => {
		const view = editor.current;
		if (!reveal || !view || !loaded) return;
		const { doc } = view.state;
		const line = doc.line(Math.min(reveal.line + 1, doc.lines));
		const pos = Math.min(line.from + reveal.column, line.to);
		view.dispatch({
			selection: { anchor: pos },
			effects: EditorView.scrollIntoView(pos, { y: "center" }),
		});
		ui.set({ reveal: undefined });
	}, [reveal, loaded]);

	const { metadata, images } = note;
	const kind = kindOf(note);
	const main = mainImage(note);
	const maps = images.filter((image) => metadata.images?.[image] === "map");
	// A creature's or vehicle's portrait and stat block sit beside its title and text, or below the title when narrow.
	const aside = canFight(note);
	// Natural size up to a cap, so small images are not blown up and none are cropped.
	const picture = (image: string | undefined, small = false) =>
		image && (
			<img
				className={cn(
					"block max-w-full rounded-xl",
					small ? "max-h-56" : "mt-6 max-h-80",
				)}
				src={noteDir(title) + encodeURIComponent(image)}
				alt=""
			/>
		);
	return (
		<article
			className={cn(
				page,
				aside &&
					"grid max-w-[80rem] grid-cols-[minmax(0,1fr)_minmax(20rem,28rem)] grid-rows-[auto_auto_1fr] gap-x-8 @max-[56rem]:grid-cols-[minmax(0,1fr)] @max-[56rem]:grid-rows-none",
			)}
		>
			<header>
				{metadata.kind === "session" ? (
					<h1>
						<SaveInput
							ref={nameField}
							label="Session name"
							saved={metadata.name ?? ""}
							// An older Session's title stands in for its name; else its date in words.
							placeholder={
								!isDateTitle(title)
									? title
									: metadata.date
										? longDate(metadata.date)
										: "Add a name"
							}
							onSave={(name) =>
								send({
									type: "setMetadata",
									title,
									fields: { name: name.trim() || null },
								})
							}
							onDone={focusText}
							className={cn(
								pageTitle,
								"-mx-2 h-auto rounded-lg border-transparent px-2 py-0.5 hover:border-input focus-visible:border-input focus-visible:ring-0 md:text-4xl/[1.1] dark:bg-transparent dark:focus-visible:bg-input/30",
								// The stand-in reads as the title until the field has focus.
								(!isDateTitle(title) || metadata.date) &&
									"placeholder:text-foreground",
								"focus:placeholder:text-faint",
							)}
						/>
					</h1>
				) : (
					<h1 className={pageTitle}>{noteLabel(title, note)}</h1>
				)}
				<div className={pageMeta}>
					<KindMark kind={kind} className="-mr-2" />
					<span className={capText}>{kindLabels[kind]}</span>
					{"display_name" in metadata && metadata.display_name && (
						<span className={capText}>
							Players see “{metadata.display_name}”
						</span>
					)}
					{metadata.kind === "session" && (
						<SessionDate title={title} date={metadata.date} />
					)}
					<NoteActions title={title} note={note} />
				</div>
			</header>
			{metadata.kind === "location" && picture(main)}
			{aside && (
				<aside className="col-start-2 row-span-full grid content-start gap-4 @max-[56rem]:col-auto @max-[56rem]:row-auto @max-[56rem]:mt-6">
					{picture(main, true)}
					<StatBlock title={title} editing={editing} />
				</aside>
			)}
			<div>
				{/* biome-ignore lint/a11y/noStaticElementInteractions: focus passes through to the editor. */}
				<div
					className="note-body mt-6 outline-none"
					ref={wrapper}
					tabIndex={-1}
					onFocus={(e) =>
						e.target === e.currentTarget && editor.current?.focus()
					}
				>
					{loaded && (
						<MarkdownBox
							value={body}
							onSave={(text) => send({ type: "saveNote", title, body: text })}
							imageBase={noteDir(title)}
							onImage={(file) => addImage(title, file)}
							placeholder="Empty note. Start writing…"
							view={editor}
						/>
					)}
				</div>
				{metadata.kind === "vehicle" && (
					<Section label={maps.length > 1 ? "Maps" : "Map"}>
						{maps.map((image) => (
							<img
								key={image}
								className="mb-4 block w-full rounded-xl"
								src={noteDir(title) + encodeURIComponent(image)}
								alt={image}
							/>
						))}
						{!maps.length && (
							<p className="text-muted-foreground italic">
								Paste or drop the deck plan into the note, then set its role to
								Map.
							</p>
						)}
					</Section>
				)}
				<ListBox
					label="Images"
					items={images}
					open={(image) => chooseImageRole(title, image)}
				>
					{(image) => (
						<>
							<img
								className="h-9 w-12 rounded-sm object-cover"
								src={noteDir(title) + encodeURIComponent(image)}
								alt=""
							/>
							<span className="min-w-0 flex-1 truncate">{image}</span>
							<span className="text-sm text-faint">
								{roleLabel(note, image)}
							</span>
							<ImageControls title={title} image={image} />
						</>
					)}
				</ListBox>
				<ListBox
					label="Combats"
					items={Object.keys(combats).filter(
						(name) => combats[name]?.session === title,
					)}
					open={(name, newTab) => openTab(combatTab(name), newTab)}
				>
					{(name) => <KindLabel kind="combat" name={name} />}
				</ListBox>
				<ListBox
					label="Linked from"
					items={backlinks(notes, title).sort(sessionOrder(notes))}
					open={(other, newTab) => openTab(noteTab(other), newTab)}
				>
					{(other) => <NoteLabel arg={other} />}
				</ListBox>
			</div>
		</article>
	);
}

/** `2026-11-07` as `Saturday, November 7`. */
const longDate = (iso: string) =>
	new Date(`${iso}T12:00`).toLocaleDateString("en-US", {
		weekday: "long",
		month: "long",
		day: "numeric",
	});

/** A Session's date as a quiet button that opens the native date picker, which yields only whole dates or a clear. */
function SessionDate({ title, date }: { title: string; date?: string }) {
	const input = useRef<HTMLInputElement>(null);
	return (
		<span className="relative -mx-1.5 flex">
			<ToolButton
				icon={CalendarDaysIcon}
				label={date ? formatDate(date) : "Add a date"}
				title="Set the date"
				className="text-sm font-normal tabular-nums"
				onClick={() => input.current?.showPicker()}
			/>
			<input
				ref={input}
				type="date"
				tabIndex={-1}
				aria-hidden
				className="pointer-events-none absolute bottom-0 left-0 size-0 opacity-0"
				value={date ?? ""}
				onChange={(e) =>
					send({
						type: "setMetadata",
						title,
						fields: { date: e.target.value || null },
					})
				}
			/>
		</span>
	);
}

/** Header Actions by kind, then the rest in a menu. */
function NoteActions({ title, note }: { title: string; note: Note }) {
	const { metadata } = note;
	const live = useGame((game) => game.runtime.session === title);
	return (
		<span className="ml-auto flex flex-wrap items-center gap-0.5">
			{canFight(note) && <ActionButton id="edit-statblock" />}
			{metadata.kind === "creature" && (
				<ActionButton id={metadata.pc ? "mark-npc" : "mark-pc"} />
			)}
			{canFight(note) && <ActionButton id="set-display-name" />}
			{metadata.kind === "session" && (
				<ActionButton id={live ? "end-session" : "go-live-with-this-session"} />
			)}
			<ActionMenu>
				<ActionItem id="rename-note" />
				<ActionItem id="change-kind" />
				<ActionItem id="set-image-role" />
				<DropdownMenuSeparator />
				<ActionItem id="delete-note" destructive />
			</ActionMenu>
		</span>
	);
}

/** Show or hide one image on the display, and set its role. Clicks stay off the row. */
function ImageControls({ title, image }: { title: string; image: string }) {
	const path = `${title}/${image}`;
	const shown = useGame((game) => game.runtime.image === path);
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: only keeps the buttons' clicks from the row.
		// biome-ignore lint/a11y/useKeyWithClickEvents: the row's keys are the list's.
		<span
			className="flex items-center"
			onClick={(e) => e.stopPropagation()}
			onAuxClick={(e) => e.stopPropagation()}
		>
			{shown ? (
				<ActionButton id="hide-image" tabIndex={-1} className="text-primary" />
			) : (
				<ToolButton
					icon={MonitorUpIcon}
					title="Show on the display"
					tabIndex={-1}
					onClick={() => send({ type: "showImage", image: path })}
				/>
			)}
			<ToolButton
				icon={TagIcon}
				title="Set its role"
				tabIndex={-1}
				onClick={() => chooseImageRole(title, image)}
			/>
		</span>
	);
}

const noteDir = (title: string) => `/game/notes/${encodeURIComponent(title)}/`;

/** Stores a pasted or dropped image under a free, safe file name and returns that name. */
async function addImage(title: string, file: File) {
	const images = getGame().notes[title]?.images ?? [];
	let base = file.name.replace(/[^\w.-]+/g, "-").replace(/^[.-]+/, "");
	if (!imageFile.test(base))
		base = `image.${file.type === "image/jpeg" ? "jpg" : file.type.slice(6)}`;
	let name = base;
	for (let n = 2; images.includes(name); n++)
		name = base.replace(/(\.\w+)$/, `-${n}$1`);
	const data = new Uint8Array(await file.arrayBuffer()).toBase64();
	if (await send({ type: "addImage", title, name, data })) return name;
}

const roleLabels: Record<ImageRole | "none", string> = {
	main: "Main",
	map: "Map",
	landscape: "Landscape",
	none: "No role",
};

export function roleLabel(note: Note, image: string) {
	const role = note.metadata.images?.[image];
	if (role) return roleLabels[role];
	return mainImage(note) === image ? "Main (only image)" : roleLabels.none;
}

export function chooseImageRole(title: string, image: string) {
	const current = getGame().notes[title]?.metadata.images?.[image];
	pick({
		title: `Role of “${image}” in “${title}”`,
		items: [...imageRoles, undefined].map((role) => ({
			label: roleLabels[role ?? "none"],
			detail: role === current ? "Current" : undefined,
			run: () => send({ type: "setImageRole", title, image, role }),
		})),
	});
}

/** A keyboard list with a heading, hidden when empty. */
function ListBox<T extends string>({
	label,
	items,
	open,
	children,
}: {
	label: string;
	items: T[];
	open: (item: T, newTab: boolean) => void;
	children: (item: T) => ReactNode;
}) {
	const nav = useListNav(items.length, (i, newTab) =>
		open(items[i] as T, newTab),
	);
	if (!items.length) return null;
	return (
		<Section label={label}>
			<div
				className={listClass}
				role="listbox"
				aria-label={label}
				ref={nav.ref}
				tabIndex={0}
				onKeyDown={nav.onKeyDown}
			>
				{items.map((item, i) => (
					<div
						key={item}
						role="option"
						tabIndex={-1}
						aria-selected={i === nav.index}
						className={cn(rowClass, "px-2 py-1")}
						{...clickOpens((newTab) => {
							nav.setIndex(i);
							open(item, newTab);
						})}
					>
						{children(item)}
					</div>
				))}
			</div>
		</Section>
	);
}

/** A titled part of a page, below its main content. */
export const Section = ({
	label,
	children,
}: {
	label: ReactNode;
	children: ReactNode;
}) => (
	<section className="mt-6">
		<h2 className="mb-2 border-b pb-1 text-sm font-bold text-muted-foreground">
			{label}
		</h2>
		{children}
	</section>
);

function ProblemsView() {
	const problems = useGame((game) => game.problems);
	const notes = useGame((game) => game.notes);
	const noteOf = (file: string) => {
		const [dir, title] = file.split("/");
		return dir === "notes" && title && Object.hasOwn(notes, title)
			? title
			: undefined;
	};
	const nav = useListNav(problems.length, (index, newTab) => {
		const title = noteOf(problems[index]?.file ?? "");
		if (title) openTab(noteTab(title), newTab);
	});
	useTabFocus(() => nav.ref.current?.focus());

	return (
		<section className={page}>
			<h1 className={pageTitle}>Problems</h1>
			{problems.length === 0 ? (
				<p className="p-4 text-muted-foreground">
					No problems. Every file in this Game is valid.
				</p>
			) : (
				<div
					className={cn(listClass, "mt-6")}
					role="listbox"
					ref={nav.ref}
					tabIndex={0}
					onKeyDown={nav.onKeyDown}
				>
					{problems.map((problem, i) => (
						<div
							key={JSON.stringify(problem)}
							role="option"
							tabIndex={-1}
							aria-selected={i === nav.index}
							className={cn(rowClass, "flex-col items-start gap-0 px-3 py-2")}
							{...clickOpens((newTab) => {
								nav.setIndex(i);
								const title = noteOf(problem.file);
								if (title) openTab(noteTab(title), newTab);
							})}
						>
							<span className="flex flex-wrap gap-2 font-medium wrap-anywhere">
								{problem.file}
								{problem.field && (
									<Badge
										variant="secondary"
										className="rounded-sm font-normal text-kind-location"
									>
										{problem.field}
									</Badge>
								)}
							</span>
							<span className="text-muted-foreground">{problem.message}</span>
						</div>
					))}
				</div>
			)}
		</section>
	);
}

/** No tab open, or an empty one: the few keys worth knowing. */
export function Welcome() {
	const keys = binds(getGame().config.keys);
	const hints: [string, string][] = [
		[keys["quick-open"], "Open or create a note"],
		[keys["command-palette"], "Show all commands"],
		[keys["focus-sidebar"], "Browse notes in the sidebar"],
		["ctrl+enter", "Open in a new tab. So do Ctrl+click and middle-click."],
		[keys["new-tab"], "New tab"],
	];
	return (
		<div className="grid h-full place-content-center gap-6 p-8">
			<h1 className={cn(pageTitle, "text-faint")}>No note open</h1>
			<dl className="grid gap-2">
				{hints
					.filter(([key]) => key)
					.map(([key, what]) => (
						<div
							key={what}
							className="grid grid-cols-[5.5rem_1fr] items-baseline"
						>
							<dt>
								<Kbd>{formatKey(key)}</Kbd>
							</dt>
							<dd className="text-muted-foreground">{what}</dd>
						</div>
					))}
			</dl>
			{window.ttrpgui && (
				<ActionButton
					id="open-game"
					label="Open another Game"
					className="justify-self-start -ml-2"
				/>
			)}
		</div>
	);
}
