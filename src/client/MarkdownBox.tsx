// The one markdown text box, for note bodies and every embedded text field. The text stays plain and
// round-trips byte for byte; live preview only decorates it. Autosaves when typing stops and before it goes away.
import {
	autocompletion,
	type CompletionContext,
	completionStatus,
} from "@codemirror/autocomplete";
import {
	defaultKeymap,
	history,
	historyKeymap,
	indentWithTab,
} from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import {
	HighlightStyle,
	syntaxHighlighting,
	syntaxTree,
} from "@codemirror/language";
import { EditorState, Prec, type Range, Transaction } from "@codemirror/state";
import {
	Decoration,
	type DecorationSet,
	EditorView,
	keymap,
	placeholder as placeholderText,
	ViewPlugin,
	type ViewUpdate,
	WidgetType,
} from "@codemirror/view";
import { tags } from "@lezer/highlight";
import type { MarkdownConfig } from "@lezer/markdown";
import { type RefObject, useEffect, useRef } from "react";
import { parseLinks } from "../shared/notes.ts";
import { getGame, send, useGame } from "./sync.ts";
import { noteTab, openTab } from "./ui.ts";

type Props = {
	/** The saved text. A change that is not an echo of our own save replaces the text, keeping the cursor. */
	value: string;
	/** Without it, the box is read-only. */
	onSave?: (text: string) => void;
	/** URL relative image paths resolve against, ending in `/`. */
	imageBase?: string;
	/** Stores a pasted or dropped image; resolves to the path to reference, or undefined on failure. */
	onImage?: (file: File) => Promise<string | undefined>;
	placeholder?: string;
	view?: RefObject<EditorView | null>;
};

const saveDelay = 500;

export function MarkdownBox(props: Props) {
	const parent = useRef<HTMLDivElement>(null);
	const latest = useRef(props);
	latest.current = props;
	const editor = useRef<EditorView>(null);
	const receive = useRef<(value: string) => void>(null);
	const notes = useGame((game) => game.notes);

	useEffect(() => {
		const { value, imageBase = "", placeholder, onSave } = latest.current;
		// Texts we saved whose echo may still arrive as `value`.
		const sent: string[] = [];
		let timer: ReturnType<typeof setTimeout> | undefined;
		const flush = () => {
			if (timer === undefined) return;
			clearTimeout(timer);
			timer = undefined;
			const text = view.state.doc.toString();
			sent.push(text);
			latest.current.onSave?.(text);
		};
		const view = new EditorView({
			parent: parent.current as HTMLDivElement,
			state: EditorState.create({
				doc: value,
				extensions: [
					EditorState.lineSeparator.of("\n"),
					EditorView.lineWrapping,
					history(),
					// Ahead of autocompletion, which otherwise eats Escape while a query is pending after each keystroke.
					Prec.highest(
						keymap.of([
							{
								key: "Escape",
								run: (v) => completionStatus(v.state) !== "active" && leave(v),
							},
						]),
					),
					keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
					onSave
						? []
						: [EditorState.readOnly.of(true), EditorView.editable.of(false)],
					markdown({
						base: markdownLanguage,
						extensions: wikiLinks,
						completeHTMLTags: false,
					}),
					syntaxHighlighting(highlight),
					livePreview(imageBase),
					autocompletion({ override: [completeTitles], icons: false }),
					placeholder ? placeholderText(placeholder) : [],
					EditorView.domEventHandlers({
						blur: flush,
						mousedown: (e) => {
							const link = (e.target as HTMLElement).closest("[data-link]");
							if (!link) return false;
							e.preventDefault();
							void followLink(
								link.getAttribute("data-link") as string,
								e.ctrlKey || e.metaKey,
							);
							return true;
						},
						paste: (e) => insertImages(e.clipboardData?.files),
						drop: (e) =>
							insertImages(
								e.dataTransfer?.files,
								view.posAtCoords({ x: e.clientX, y: e.clientY }),
							),
					}),
					EditorView.updateListener.of((update) => {
						const ours = update.transactions.some(
							(tr) => tr.docChanged && !tr.annotation(Transaction.remote),
						);
						if (!ours) return;
						clearTimeout(timer);
						timer = setTimeout(flush, saveDelay);
					}),
				],
			}),
		});

		function insertImages(files?: FileList, at?: number | null) {
			const { onImage } = latest.current;
			const images = [...(files ?? [])].filter((f) =>
				f.type.startsWith("image/"),
			);
			if (!onImage || !images.length) return false;
			void Promise.all(images.map(onImage)).then((paths) => {
				const insert = paths
					.filter((path) => path !== undefined)
					.map((path) => `![](${path})`)
					.join("\n");
				const from = Math.min(
					at ?? view.state.selection.main.head,
					view.state.doc.length,
				);
				if (insert)
					view.dispatch({
						changes: { from, insert },
						selection: { anchor: from + insert.length },
					});
			});
			return true;
		}

		receive.current = (incoming) => {
			const echo = sent.indexOf(incoming);
			if (echo >= 0) {
				sent.splice(0, echo + 1);
				return;
			}
			// An outside change wins over unsaved edits: files on disk are the truth.
			sent.length = 0;
			clearTimeout(timer);
			timer = undefined;
			const doc = view.state.doc.toString();
			if (doc === incoming) return;
			// Replace only the changed span, so the cursor maps through it.
			let start = 0;
			while (start < doc.length && doc[start] === incoming[start]) start++;
			let end = 0;
			while (
				end < Math.min(doc.length, incoming.length) - start &&
				doc[doc.length - 1 - end] === incoming[incoming.length - 1 - end]
			)
				end++;
			view.dispatch({
				changes: {
					from: start,
					to: doc.length - end,
					insert: incoming.slice(start, incoming.length - end),
				},
				annotations: [
					Transaction.remote.of(true),
					Transaction.addToHistory.of(false),
				],
			});
		};

		editor.current = view;
		if (latest.current.view) latest.current.view.current = view;
		window.addEventListener("beforeunload", flush);
		return () => {
			window.removeEventListener("beforeunload", flush);
			flush();
			view.destroy();
		};
	}, []);

	useEffect(() => receive.current?.(props.value), [props.value]);

	// Links turn dangling or resolved as notes come and go: an empty update makes the preview recheck them.
	// biome-ignore lint/correctness/useExhaustiveDependencies: it runs when notes change.
	useEffect(() => editor.current?.dispatch({}), [notes]);

	// Escape focuses the box itself, so plain-key binds work; Enter goes back in.
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: Enter returns to the editor inside.
		<div
			className="md"
			ref={parent}
			tabIndex={props.onSave ? -1 : undefined}
			onKeyDown={(e) => {
				if (e.target !== e.currentTarget || e.key !== "Enter") return;
				e.preventDefault();
				editor.current?.focus();
			}}
		/>
	);
}

/** The title of the wiki link under the cursor in the focused text box. */
export function linkUnderCursor() {
	const focused = document.activeElement;
	const dom =
		focused?.closest(".cm-editor") ??
		focused?.querySelector(":scope > .cm-editor");
	const view = dom instanceof HTMLElement && EditorView.findFromDOM(dom);
	if (!view) return;
	const { state } = view;
	const head = state.selection.main.head;
	const line = state.doc.lineAt(head);
	const at = head - line.from;
	return parseLinks(line.text).find((l) => l.from <= at && at <= l.to)?.title;
}

/** Opens the note a link points to, creating a plain note if it does not exist. */
export async function followLink(title: string, newTab: boolean) {
	const exists = Object.hasOwn(getGame().notes, title);
	if (exists || (await send({ type: "createNote", title })))
		openTab(noteTab(title), newTab);
}

/** Escape hands focus to the box around the editor. The next Tab then moves past the editor instead of into it. */
function leave(view: EditorView) {
	const { contentDOM } = view;
	contentDOM.tabIndex = -1;
	view.dom.parentElement?.focus();
	document.addEventListener(
		"focusin",
		() => contentDOM.removeAttribute("tabindex"),
		{ once: true },
	);
	return true;
}

/** Parses `[[...]]` with the shared link rules, so links inside code stay code. */
const wikiLinks: MarkdownConfig = {
	defineNodes: ["WikiLink"],
	parseInline: [
		{
			name: "WikiLink",
			before: "Link",
			parse(cx, next, pos) {
				if (next !== 91 || cx.char(pos + 1) !== 91) return -1;
				const [link] = parseLinks(cx.slice(pos, cx.end));
				if (link?.from !== 0) return -1;
				return cx.addElement(cx.elt("WikiLink", pos, pos + link.to));
			},
		},
	],
};

function completeTitles(context: CompletionContext) {
	const match = context.matchBefore(/\[\[[^[\]|#\n]*/);
	if (!match) return null;
	const close =
		context.state.sliceDoc(context.pos, context.pos + 2) === "]]" ? "" : "]]";
	return {
		from: match.from + 2,
		options: Object.keys(getGame().notes).map((title) => ({
			label: title,
			apply: title + close,
		})),
		validFor: /^[^[\]|#\n]*$/,
	};
}

const highlight = HighlightStyle.define([
	{ tag: tags.emphasis, class: "md-em" },
	{ tag: tags.strong, class: "md-strong" },
	{ tag: tags.strikethrough, class: "md-strike" },
	{ tag: tags.link, class: "md-link" },
	{ tag: tags.monospace, class: "md-code" },
	{
		tag: [
			tags.processingInstruction,
			tags.url,
			tags.labelName,
			tags.contentSeparator,
		],
		class: "md-mark",
	},
]);

class ImageWidget extends WidgetType {
	src: string;
	constructor(src: string) {
		super();
		this.src = src;
	}
	override eq(other: ImageWidget) {
		return other.src === this.src;
	}
	toDOM() {
		const img = document.createElement("img");
		img.className = "md-image";
		img.src = this.src;
		return img;
	}
}

class BulletWidget extends WidgetType {
	override eq() {
		return true;
	}
	toDOM() {
		const span = document.createElement("span");
		span.className = "md-bullet";
		span.textContent = "•";
		return span;
	}
}

const hide = Decoration.replace({});
const bullet = Decoration.replace({ widget: new BulletWidget() });
const lineClasses: Record<string, string> = {
	ATXHeading1: "md-h1",
	ATXHeading2: "md-h2",
	ATXHeading3: "md-h3",
	ATXHeading4: "md-h4",
	ATXHeading5: "md-h4",
	ATXHeading6: "md-h4",
	Blockquote: "md-quote",
	FencedCode: "md-codeblock",
	Table: "md-table",
};

/**
 * Obsidian-style live preview: markup is hidden unless the cursor touches its element (its line, for
 * headings, quotes, and lists). Wiki links show their label, and images render after their source.
 */
function livePreview(imageBase: string) {
	const build = (view: EditorView) => {
		const { state } = view;
		const { notes } = getGame();
		const decorations: Range<Decoration>[] = [];
		const touched = (from: number, to: number) =>
			!state.readOnly &&
			state.selection.ranges.some((r) => r.from <= to && r.to >= from);
		const lineTouched = (pos: number) => {
			const line = state.doc.lineAt(pos);
			return touched(line.from, line.to);
		};
		/** The mark plus the space after it. */
		const markAndSpace = (from: number, to: number) =>
			hide.range(from, state.sliceDoc(to, to + 1) === " " ? to + 1 : to);

		syntaxTree(state).iterate({
			...view.viewport,
			enter(node) {
				const { name, from, to } = node;
				const parent = node.node.parent;
				const lineClass = lineClasses[name];
				if (lineClass) {
					for (let pos = from; pos <= to; ) {
						const line = state.doc.lineAt(pos);
						decorations.push(
							Decoration.line({ class: lineClass }).range(line.from),
						);
						pos = line.to + 1;
					}
				}
				switch (name) {
					case "HeaderMark":
					case "QuoteMark":
						if (!lineTouched(from)) decorations.push(markAndSpace(from, to));
						break;
					case "ListMark":
						if (parent?.parent?.name === "BulletList" && !lineTouched(from))
							decorations.push(bullet.range(from, to));
						break;
					case "EmphasisMark":
					case "StrikethroughMark":
						if (parent && !touched(parent.from, parent.to))
							decorations.push(hide.range(from, to));
						break;
					case "CodeMark":
						if (
							parent?.name === "InlineCode" &&
							!touched(parent.from, parent.to)
						)
							decorations.push(hide.range(from, to));
						break;
					case "LinkMark":
					case "URL":
					case "LinkTitle":
						if (parent?.name === "Link" && !touched(parent.from, parent.to))
							decorations.push(hide.range(from, to));
						break;
					case "HorizontalRule":
						if (!lineTouched(from))
							decorations.push(
								Decoration.line({ class: "md-hr" }).range(from),
								hide.range(from, to),
							);
						break;
					case "Image": {
						const url = node.node.getChild("URL");
						if (!url) break;
						const src = new URL(
							state.sliceDoc(url.from, url.to),
							location.origin + imageBase,
						).href;
						const widget = new ImageWidget(src);
						decorations.push(
							touched(from, to)
								? Decoration.widget({ widget, side: 1 }).range(to)
								: Decoration.replace({ widget }).range(from, to),
						);
						return false;
					}
					case "WikiLink": {
						const [link] = parseLinks(state.sliceDoc(from, to));
						if (!link) break;
						const exists = Object.hasOwn(notes, link.title);
						const className = exists
							? "md-wikilink"
							: "md-wikilink md-dangling";
						if (touched(from, to)) {
							decorations.push(
								Decoration.mark({ class: className }).range(from, to),
							);
							break;
						}
						const label = link.label ? to - 2 - link.label.length : from + 2;
						decorations.push(
							hide.range(from, label),
							Decoration.mark({
								class: className,
								attributes: { "data-link": link.title },
							}).range(label, to - 2),
							hide.range(to - 2, to),
						);
						break;
					}
				}
			},
		});
		return Decoration.set(decorations, true);
	};

	return ViewPlugin.fromClass(
		class {
			notes = getGame().notes;
			decorations: DecorationSet;
			constructor(view: EditorView) {
				this.decorations = build(view);
			}
			update(update: ViewUpdate) {
				if (
					this.notes !== getGame().notes ||
					update.docChanged ||
					update.selectionSet ||
					update.viewportChanged ||
					syntaxTree(update.startState) !== syntaxTree(update.state)
				) {
					this.notes = getGame().notes;
					this.decorations = build(update.view);
				}
			}
		},
		{ decorations: (plugin) => plugin.decorations },
	);
}
