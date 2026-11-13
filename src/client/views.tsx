// Tab views. A tab id is `view:arg` (or just `view`); adding a view is one entry in `views`.
import { EditorView } from "@codemirror/view";
import { cn } from "cn";
import { type FC, type ReactNode, useEffect, useRef, useState } from "react";
import { Badge } from "#components/ui/badge.tsx";
import { backlinks, imageFile, mainImage } from "../shared/notes.ts";
import { type ImageRole, imageRoles } from "../shared/schema.ts";
import type { GameState, Note } from "../shared/state.ts";
import { AtmosphereView } from "./Atmospheres.tsx";
import { listClass, rowClass, useListNav } from "./list.ts";
import { MarkdownBox } from "./MarkdownBox.tsx";
import { StatBlock } from "./StatBlock.tsx";
import { getGame, send, useGame } from "./sync.ts";
import { CombatView, combatTab } from "./Tracker.tsx";
import { noteTab, openTab, pick, ui } from "./ui.ts";

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
};

export function parseTab(tab: string): [view: string, arg: string] {
	const at = tab.indexOf(":");
	return at < 0 ? [tab, ""] : [tab.slice(0, at), tab.slice(at + 1)];
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
	return <KindLabel kind={kind} name={title} />;
}

function NoteView({ arg: title }: { arg: string }) {
	const notes = useGame((game) => game.notes);
	const combats = useGame((game) => game.combats);
	const note = notes[title] as Note;
	const [body, setBody] = useState<string>();
	const editor = useRef<EditorView>(null);
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

	useEffect(() => {
		const view = editor.current;
		if (!reveal || !view || body === undefined) return;
		const { doc } = view.state;
		const line = doc.line(Math.min(reveal.line + 1, doc.lines));
		const pos = Math.min(line.from + reveal.column, line.to);
		view.dispatch({
			selection: { anchor: pos },
			effects: EditorView.scrollIntoView(pos, { y: "center" }),
		});
		view.focus();
		ui.set({ reveal: undefined });
	}, [reveal, body]);

	const { metadata, images } = note;
	const kind = kindOf(note);
	const main = mainImage(note);
	const creature = metadata.kind === "creature";
	// Natural size up to a cap, so small images are not blown up and none are cropped.
	const picture = main && (
		<img
			className={cn(
				"block max-w-full rounded-xl",
				creature ? "max-h-56" : "mt-6 max-h-80",
			)}
			src={noteDir(title) + encodeURIComponent(main)}
			alt=""
		/>
	);
	return (
		// A creature's portrait and stat block sit beside its title and text, or below the title when narrow.
		<article
			className={cn(
				page,
				creature &&
					"grid max-w-[80rem] grid-cols-[minmax(0,1fr)_minmax(20rem,28rem)] grid-rows-[auto_auto_1fr] gap-x-8 @max-[56rem]:grid-cols-[minmax(0,1fr)] @max-[56rem]:grid-rows-none",
			)}
		>
			<header>
				<h1 className={pageTitle}>{title}</h1>
				<p className={pageMeta}>
					<KindMark kind={kind} className="-mr-2" />
					{kindLabels[kind]}
					{metadata.kind === "session" && metadata.date && (
						<span>{formatDate(metadata.date)}</span>
					)}
					{metadata.kind === "creature" && metadata.display_name && (
						<span>Players see “{metadata.display_name}”</span>
					)}
				</p>
			</header>
			{metadata.kind === "location" && picture}
			{creature && (
				<aside className="col-start-2 row-span-full grid content-start gap-4 @max-[56rem]:col-auto @max-[56rem]:row-auto @max-[56rem]:mt-6">
					{picture}
					<StatBlock title={title} editing={editing} />
				</aside>
			)}
			<div>
				<div data-note-body className="note-body mt-6">
					{body !== undefined && (
						<MarkdownBox
							value={body}
							onSave={(text) => send({ type: "saveNote", title, body: text })}
							imageBase={noteDir(title)}
							onImage={(file) => addImage(title, file)}
							placeholder="Empty note. Start writing…"
							autoFocus={!ui.get().picker}
							view={editor}
						/>
					)}
				</div>
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
					items={backlinks(notes, title)}
					open={(other, newTab) => openTab(noteTab(other), newTab)}
				>
					{(other) => <NoteLabel arg={other} />}
				</ListBox>
			</div>
		</article>
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
					// biome-ignore lint/a11y/useKeyWithClickEvents: the list handles keys.
					<div
						key={item}
						role="option"
						tabIndex={-1}
						aria-selected={i === nav.index}
						className={cn(rowClass, "px-2 py-1")}
						onClick={(e) => {
							nav.setIndex(i);
							open(item, e.ctrlKey || e.metaKey);
						}}
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

const formatDate = (iso: string) =>
	new Date(`${iso}T00:00`).toLocaleDateString(undefined, {
		year: "numeric",
		month: "long",
		day: "numeric",
	});

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
	const { ref } = nav;
	useEffect(() => ref.current?.focus(), [ref]);

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
						// biome-ignore lint/a11y/useKeyWithClickEvents: the list handles keys.
						<div
							key={JSON.stringify(problem)}
							role="option"
							tabIndex={-1}
							aria-selected={i === nav.index}
							className={cn(rowClass, "flex-col items-start gap-0 px-3 py-2")}
							onClick={(e) => {
								nav.setIndex(i);
								const title = noteOf(problem.file);
								if (title) openTab(noteTab(title), e.ctrlKey || e.metaKey);
							}}
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
