// A creature's stat block, read-only or as a form. Both render the same rows, so they cannot drift apart.
// Each field saves on blur through `saveStatblock`; the server validates it against the schema.
import { cn } from "cn";
import { produce } from "immer";
import { CheckIcon } from "lucide-react";
import { type CSSProperties, createRef, useEffect, useState } from "react";
import { Input } from "#components/ui/input.tsx";
import type { Statblock } from "../shared/schema.ts";
import {
	abilities,
	formatBonuses,
	modifier,
	parseBonuses,
	parseSaves,
	signed,
	toInt,
} from "../shared/statblock.ts";
import { ActionButton } from "./controls.tsx";
import { MarkdownBox } from "./MarkdownBox.tsx";
import { getGame, send, useGame } from "./sync.ts";
import { pick, toast, ui } from "./ui.ts";

type Field = {
	key: Exclude<keyof Statblock, "abilities" | "sections">;
	label: string;
	format?: (value: never) => string;
	/** Text to value. Empty text always clears the field. */
	parse?: (text: string) => unknown;
};

const stats: Field[] = [
	{ key: "ac", label: "AC", parse: toInt },
	{ key: "hp", label: "HP", parse: toInt },
	{ key: "initiative", label: "Init", format: signed, parse: toInt },
];

const props: Field[] = [
	{ key: "speed", label: "Speed" },
	{ key: "saves", label: "Saves", format: formatBonuses, parse: parseSaves },
	{
		key: "skills",
		label: "Skills",
		format: formatBonuses,
		parse: parseBonuses,
	},
	{ key: "vulnerabilities", label: "Vulnerable" },
	{ key: "resistances", label: "Resistant" },
	{ key: "immunities", label: "Immune" },
	{ key: "senses", label: "Senses" },
	{ key: "languages", label: "Languages" },
	{
		key: "cr",
		label: "CR",
		parse: (text) => (/^\d+(\.\d+)?$/.test(text) ? Number(text) : text),
	},
	{ key: "legendary_actions", label: "Legendary actions", parse: toInt },
	{
		key: "legendary_resistances",
		label: "Legendary resistances",
		parse: toInt,
	},
];

const sectionNames = [
	"Traits",
	"Actions",
	"Bonus Actions",
	"Reactions",
	"Legendary Actions",
];

/** The open form. Only the active note can open one. */
const form = createRef<HTMLDivElement>();

/** Shows the stat block of the creature titled `title`. `editing` turns every field into an input. */
export function StatBlock({
	title,
	editing = false,
}: {
	title: string;
	editing?: boolean;
}) {
	const statblock = useGame((game) => game.notes[title]?.statblock);
	const missing = useGame((game) => !Object.hasOwn(game.notes, title));
	const broken = useGame((game) =>
		game.problems.some((p) => p.file === `notes/${title}/statblock.toml`),
	);
	useEffect(() => {
		if (editing) form.current?.querySelector("input")?.focus();
	}, [editing]);

	if (!statblock && !editing)
		return (
			<p className={empty}>
				{missing
					? `No Creature note titled “${title}”.`
					: broken
						? "This stat block has problems. See the problems list."
						: "No stat block yet. Run “Edit stat block” to write one."}
			</p>
		);
	const sb = statblock ?? {};
	const shown = (field: Field) => editing || sb[field.key] !== undefined;
	const value = (field: Field, className?: string) =>
		editing ? (
			<SaveInput
				label={field.label}
				saved={format(field, sb[field.key])}
				className={cn(dense, className)}
				onSave={(text) =>
					editStatblock(title, (d) => {
						(d as Record<string, unknown>)[field.key] = parse(field, text);
					})
				}
			/>
		) : (
			format(field, sb[field.key])
		);

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: Escape leaves the form; the inputs inside take the keys.
		<div
			className="md-small"
			data-statblock
			data-editing={editing || undefined}
			data-title={title}
			ref={editing ? form : undefined}
			onKeyDown={(e) => {
				if (!editing || e.key !== "Escape" || e.isDefaultPrevented()) return;
				e.preventDefault();
				stopEditing();
			}}
		>
			{editing && (
				<div
					role="toolbar"
					aria-label="Stat block"
					className="sticky top-2 z-10 mb-3 flex items-center gap-0.5 rounded-lg border bg-card p-1 shadow-overlay"
				>
					<ActionButton id="add-statblock-section" />
					<ActionButton id="add-statblock-entry" />
					<ActionButton id="move-statblock-item-up" />
					<ActionButton id="move-statblock-item-down" />
					<ActionButton id="remove-statblock-item" />
					<ActionButton
						id="edit-statblock"
						label="Done"
						icon={CheckIcon}
						variant="outline"
						className="ml-auto border-primary/50 text-primary dark:border-primary/50"
					/>
				</div>
			)}
			<dl className="flex gap-2">
				{stats.filter(shown).map((field) => (
					<div
						key={field.key}
						className="flex-1 rounded-lg border bg-card px-2 py-1 text-center"
					>
						<dt className={cn(term, caps)}>{field.label}</dt>
						<dd className="font-serif text-2xl/[1.15] font-semibold">
							{value(field, "text-center")}
						</dd>
					</div>
				))}
			</dl>
			{(editing || sb.abilities) && (
				<dl className="grid grid-cols-6 gap-1 border-y py-2 text-center">
					{abilities.map((a) => {
						const score = sb.abilities?.[a];
						return (
							<div key={a}>
								<dt className={cn(term, caps)}>{a}</dt>
								<dd className="text-lg font-bold">
									{editing ? (
										<SaveInput
											label={a.toUpperCase()}
											saved={score === undefined ? "" : String(score)}
											className={cn(dense, "text-center")}
											onSave={(text) =>
												editStatblock(title, (d) => {
													d.abilities ??= {};
													d.abilities[a] = text.trim()
														? (toInt(text) as number)
														: undefined;
												})
											}
										/>
									) : (
										score !== undefined && (
											<>
												{signed(modifier(score))}
												<span className="block text-xs font-normal text-faint">
													{score}
												</span>
											</>
										)
									)}
								</dd>
							</div>
						);
					})}
				</dl>
			)}
			<dl className="text-sm">
				{props.filter(shown).map((field) => (
					<div
						key={field.key}
						className={cn(
							editing &&
								"mt-1 grid grid-cols-[9rem_minmax(0,1fr)] items-center",
						)}
					>
						<dt className={cn(term, "mr-2 inline")}>{field.label}</dt>
						<dd className="inline">{value(field)}</dd>
					</div>
				))}
			</dl>
			{sb.sections?.map((section, s) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: sections have no identity beyond their place.
				<section key={s} data-section={s} className="mt-4">
					<h3 className="mb-1 border-b border-primary pb-0.5 text-sm font-bold tracking-[0.08em] text-primary uppercase">
						{editing ? (
							<SaveInput
								label="Section name"
								saved={section.name}
								className={cn(dense, "uppercase")}
								onSave={(name) =>
									editStatblock(title, (d) => {
										const at = d.sections?.[s];
										if (at) at.name = name;
									})
								}
							/>
						) : (
							section.name
						)}
					</h3>
					<div className="grid gap-2">
						{section.entries.map((entry, e) => (
							<div
								// biome-ignore lint/suspicious/noArrayIndexKey: entries have no identity beyond their place. Switching modes remounts the text box, which is read-only or not from the start.
								key={`${editing}${e}`}
								className={cn(
									"md-entry",
									editing && "border-l-2 pl-2 focus-within:border-primary",
								)}
								data-entry={e}
								style={
									editing
										? undefined
										: ({
												"--name": JSON.stringify(
													entry.name ? `${entry.name}. ` : "",
												),
											} as CSSProperties)
								}
							>
								{editing && (
									<SaveInput
										label="Entry name"
										saved={entry.name}
										className={cn(dense, "font-bold")}
										onSave={(name) =>
											editEntry(title, s, e, (at) => {
												at.name = name;
											})
										}
									/>
								)}
								<div
									className={cn(
										editing && cn(fieldBox, "mt-0.5 rounded-sm px-1"),
									)}
								>
									<MarkdownBox
										value={entry.text}
										placeholder={editing ? "Text" : undefined}
										onSave={
											editing
												? (text) =>
														editEntry(title, s, e, (at) => {
															at.text = text;
														})
												: undefined
										}
									/>
								</div>
							</div>
						))}
					</div>
				</section>
			))}
			{editing && !sb.sections?.length && (
				<p className={cn(empty, "mt-4")}>
					Actions, traits, and the like go in sections. Add one with “Section”
					above.
				</p>
			)}
		</div>
	);
}

const term = "font-bold text-muted-foreground";
const caps = "text-xs tracking-[0.06em] uppercase";
const empty = "text-muted-foreground italic";
/** The form's inputs take the size of the value they stand in for. */
const dense =
	"h-auto rounded-sm px-1 py-0 text-[length:inherit] md:text-[length:inherit]";
/** A box that looks like an `Input`, for a `MarkdownBox` inside it. */
export const fieldBox =
	"rounded-lg border border-input bg-input/30 transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50";

const format = (field: Field, value: unknown) =>
	value === undefined ? "" : (field.format ?? String)(value as never);

const parse = (field: Field, text: string) =>
	text.trim() ? (field.parse ?? ((t) => t))(text.trim()) : undefined;

/** A one-line field that saves on blur. A new saved value replaces the draft; a rejected save reverts it. */
export function SaveInput({
	label,
	saved,
	onSave,
	placeholder,
	className,
}: {
	label: string;
	saved: string;
	onSave: (text: string) => Promise<boolean>;
	placeholder?: string;
	className?: string;
}) {
	const [draft, setDraft] = useState(saved);
	useEffect(() => setDraft(saved), [saved]);
	return (
		<Input
			aria-label={label}
			placeholder={placeholder}
			value={draft}
			className={className}
			onChange={(e) => setDraft(e.target.value)}
			onBlur={async () => {
				if (draft !== saved && !(await onSave(draft))) setDraft(saved);
			}}
		/>
	);
}

let queue = Promise.resolve(true);

/** Saves `recipe` applied to the latest stat block. Edits run one at a time, so each builds on the last. */
function editStatblock(title: string, recipe: (draft: Statblock) => void) {
	queue = queue
		.then(() => {
			const current = getGame().notes[title]?.statblock ?? {};
			const statblock = produce(current, recipe);
			return send({ type: "saveStatblock", title, statblock });
		})
		.catch((e: Error) => {
			toast(`Not saved: ${e.message}`);
			return false;
		});
	return queue;
}

type Entry = { name: string; text: string };

const editEntry = (
	title: string,
	s: number,
	e: number,
	recipe: (entry: Entry) => void,
) =>
	editStatblock(title, (d) => {
		const entry = d.sections?.[s]?.entries[e];
		if (entry) recipe(entry);
	});

type Cursor = { title: string; section?: number; entry?: number };

/** Where focus is in the open stat block form, if it is there. */
export function formCursor(): Cursor | undefined {
	const field = document.activeElement;
	const form = field?.closest<HTMLElement>("[data-statblock][data-editing]");
	if (!field || !form) return;
	const at = (name: string) => {
		const el = field.closest(`[data-${name}]`);
		return el ? Number(el.getAttribute(`data-${name}`)) : undefined;
	};
	return {
		title: form.dataset.title as string,
		section: at("section"),
		entry: at("entry"),
	};
}

/** Closes the form. The note view then focuses its text box. */
export function stopEditing() {
	// Blurring saves the field being edited before it unmounts.
	(document.activeElement as HTMLElement | null)?.blur();
	ui.set({ editing: undefined });
}

/** Focuses the name of a section, or of an entry in it. Falls back to the first field. */
function focusName(section: number, entry?: number) {
	const s = form.current?.querySelector(`[data-section="${section}"]`);
	const target =
		entry === undefined ? s : s?.querySelector(`[data-entry="${entry}"]`);
	(target ?? form.current)?.querySelector("input")?.focus();
}

/** Runs `op` at the cursor, after the field being edited saves: blurring saves it, and edits run in order. */
const atCursor = (op: (at: Cursor) => void) => () => {
	const at = formCursor();
	if (!at) return;
	const field = document.activeElement as HTMLElement;
	field.blur();
	field.focus();
	op(at);
};

const sectionsOf = (title: string) =>
	getGame().notes[title]?.statblock?.sections ?? [];

export const addSection = atCursor(({ title, section }) => {
	const used = sectionsOf(title).map((s) => s.name);
	const at = section === undefined ? used.length : section + 1;
	const add = async (name: string) => {
		const added = await editStatblock(title, (d) => {
			d.sections ??= [];
			d.sections.splice(at, 0, { name, entries: [{ name: "", text: "" }] });
		});
		if (added) focusName(at, 0);
	};
	pick({
		title: "Name the new section",
		placeholder: "Section name",
		items: sectionNames
			.filter((name) => !used.includes(name))
			.map((name) => ({ label: name, run: () => add(name) })),
		fromQuery: (name) =>
			name && !sectionNames.includes(name)
				? { label: `New section “${name}”`, run: () => add(name) }
				: undefined,
	});
});

/** Adds an empty entry after the cursor's entry, or first in its section. Outside any section, adds a section. */
export const addEntry = atCursor(async (at) => {
	const { title, section: s, entry = -1 } = at;
	if (s === undefined) return addSection();
	const added = await editStatblock(title, (d) => {
		d.sections?.[s]?.entries.splice(entry + 1, 0, { name: "", text: "" });
	});
	if (added) focusName(s, entry + 1);
});

/** Removes the cursor's entry, or its section when on a section name. Asks first unless the entry is blank. */
export const removeItem = atCursor(({ title, section: s, entry: e }) => {
	const section = s === undefined ? undefined : sectionsOf(title)[s];
	if (s === undefined || !section) return;
	const entry = e === undefined ? undefined : section.entries[e];
	const remove = async () => {
		const removed = await editStatblock(title, (d) => {
			if (e === undefined) d.sections?.splice(s, 1);
			else d.sections?.[s]?.entries.splice(e, 1);
		});
		if (!removed) return;
		if (e === undefined) focusName(Math.max(0, s - 1));
		else focusName(s, e > 0 ? e - 1 : undefined);
	};
	if (entry && !entry.name && !entry.text) return void remove();
	const what = entry
		? `the entry “${entry.name}”`
		: `the section “${section.name}” and everything in it`;
	pick({
		title: `Remove ${what}?`,
		items: [
			{ label: "Keep it", run: () => focusName(s, e) },
			{ label: "Remove", run: remove },
		],
	});
});

/** Moves the cursor's entry within its section, or its section when on a section name. */
export const moveItem = (step: number) =>
	atCursor(async ({ title, section: s, entry: e }) => {
		if (s === undefined) return;
		const sections = sectionsOf(title);
		const from = e ?? s;
		const to = from + step;
		const length =
			e === undefined ? sections.length : (sections[s]?.entries.length ?? 0);
		if (to < 0 || to >= length) return;
		const moved = await editStatblock(title, (d) => {
			const list: unknown[] | undefined =
				e === undefined ? d.sections : d.sections?.[s]?.entries;
			list?.splice(to, 0, ...list.splice(from, 1));
		});
		if (!moved) return;
		if (e === undefined) focusName(to);
		else focusName(s, to);
	});
