// The dice roller: one input that typesets as you type, and this window's rolls, newest first. Enter rolls and keeps
// the text selected, so Enter rolls again and typing replaces it. Up and Down recall earlier texts, and Down past the
// newest brings back the draft. Dice-free input is a calculator.
import { cn } from "cn";
import { DicesIcon } from "lucide-react";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { Dialog, DialogContent, DialogTitle } from "#components/ui/dialog.tsx";
import { InputGroup, InputGroupAddon } from "#components/ui/input-group.tsx";
import { Kbd } from "#components/ui/kbd.tsx";
import { hasDice, parse, rollAll, value } from "../shared/dice.ts";
import { ToolButton } from "./controls.tsx";
import { Dice, Rolls } from "./Dice.tsx";
import { addRoll, closePopup, ui } from "./ui.ts";

/** The last text, shown again on reopening. */
let lastText = "";

export function Roller() {
	const rolls = ui.use((s) => s.rolls);
	const [text, setText] = useState(lastText);
	const [error, setError] = useState<string>();
	/** Earlier texts, newest first, for Up and Down. */
	const texts = [...new Set(rolls.map((r) => r.text))];
	const input = useRef<HTMLInputElement>(null);
	const list = useRef<HTMLOListElement>(null);
	/** The text before Up, which Down past the newest brings back. */
	const draft = useRef("");
	const { entries, error: problem, unfinished } = parse(text);
	const message = (error ?? problem) && (
		<span
			className={cn(
				"text-sm",
				error || !unfinished ? "text-destructive" : "text-muted-foreground",
			)}
		>
			{error ?? problem}
		</span>
	);
	const edit = (t: string) => {
		setText(t);
		lastText = t;
		setError(undefined);
	};

	function submit() {
		if (!text.trim()) return;
		// Enter on an unfinished input turns its message into an error.
		if (problem) return setError(problem);
		const rolled = rollAll(entries);
		if (typeof rolled === "string") setError(rolled);
		else flushSync(() => addRoll({ text, rolls: rolled }));
		list.current?.scrollTo({ top: 0 });
		input.current?.select();
	}

	return (
		<Dialog open onOpenChange={(open) => open || closePopup()}>
			<DialogContent
				showCloseButton={false}
				aria-describedby={undefined}
				// closePopup returns focus itself.
				onCloseAutoFocus={(e) => e.preventDefault()}
				className="top-[12vh] flex max-h-[70vh] translate-y-0 flex-col gap-0 overflow-hidden rounded-xl border p-0 shadow-overlay ring-0 sm:max-w-[38rem]"
			>
				<DialogTitle className="px-3 pt-2 pb-1.5 text-sm font-normal text-muted-foreground">
					Roll dice
				</DialogTitle>
				<div className="p-1 pb-0">
					<InputGroup className="h-8! rounded-lg! border-input/30 bg-input/30 shadow-none! *:data-[slot=input-group-addon]:pl-2!">
						<input
							ref={input}
							value={text}
							aria-label="Dice or arithmetic"
							placeholder="Dice or arithmetic, then Enter"
							className="w-full text-base lining-nums outline-hidden"
							onFocus={(e) => e.currentTarget.select()}
							onChange={(e) => edit(e.target.value)}
							onKeyDown={(e) => {
								const page =
									e.key === "PageDown" ? 1 : e.key === "PageUp" ? -1 : 0;
								const step =
									e.key === "ArrowUp" ? 1 : e.key === "ArrowDown" ? -1 : 0;
								const now = texts.indexOf(text);
								const at = now + step;
								const rows = list.current;
								if (page && rows)
									rows.scrollBy({ top: page * rows.clientHeight * 0.9 });
								else if (step && at >= -1 && at < texts.length) {
									if (now < 0) draft.current = text;
									edit(texts[at] ?? draft.current);
								} else if (e.key === "Enter") submit();
								else return;
								e.preventDefault();
							}}
						/>
						<InputGroupAddon>
							<DicesIcon className="size-4 shrink-0 opacity-50" />
						</InputGroupAddon>
						<InputGroupAddon align="inline-end" className="pr-1">
							<ToolButton
								label="Roll"
								title="Roll"
								bind="Enter"
								onClick={submit}
							/>
						</InputGroupAddon>
					</InputGroup>
				</div>
				<div
					role="status"
					className="flex min-h-14 shrink-0 flex-col justify-center gap-1 px-3 py-3 text-base"
				>
					{!text.trim() ? (
						<span className="text-sm text-faint lining-nums">
							Like <Kbd>2d6+3</Kbd> <Kbd>2d20kh1</Kbd> advantage{" "}
							<Kbd>2d20kl1</Kbd> disadvantage <Kbd>3x d20+5</Kbd> three rolls{" "}
							<Kbd>45/2</Kbd> rounds down
						</span>
					) : entries.length ? (
						entries.map((entry, i) => (
							<Dice
								// biome-ignore lint/suspicious/noArrayIndexKey: entries are positions in the input.
								key={i}
								expr={entry.expr}
								times={entry.times}
								total={
									problem || hasDice(entry.expr) ? undefined : value(entry.expr)
								}
								note={i === entries.length - 1 && message}
							/>
						))
					) : (
						message
					)}
				</div>
				<ol ref={list} className="overflow-y-auto" aria-label="Rolls">
					{rolls.map((roll) => (
						<li
							key={roll.id}
							className="border-t px-3 py-2 text-base first:animate-in first:bg-muted/40 first:duration-500 first:fade-in motion-reduce:duration-1"
						>
							<Rolls roll={roll} />
						</li>
					))}
				</ol>
			</DialogContent>
		</Dialog>
	);
}
