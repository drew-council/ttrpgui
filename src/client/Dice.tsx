// The one rendering of a dice expression from `dice.ts`: typeset as typed, or rolled with each die's face where its
// term sits. Floor brackets show that a division rounds down. A rolled row shows each dice-free part as its value.
// Unfinished input shows a faint `…` where more is needed.
import { cn } from "cn";
import type { ReactNode } from "react";
import {
	type Expr,
	hasDice,
	isNumber,
	showNumber,
	value,
} from "../shared/dice.ts";
import type { RollEntry } from "./ui.ts";

const signs = { "+": "+", "-": "−", "*": "×", "/": "÷" };

function Term({ expr, rolled }: { expr: Expr; rolled: boolean }) {
	// Once rolled, a part without dice shows its value.
	const term = (e: Expr) => (
		<Term
			expr={rolled && !hasDice(e) ? { type: "number", value: value(e) } : e}
			rolled={rolled}
		/>
	);
	switch (expr.type) {
		case "number":
			return showNumber(expr.value);
		case "hole":
			return (
				<>
					<span className="font-medium">{expr.text}</span>
					<span className="text-faint">…</span>
				</>
			);
		case "negate":
			return <>−{term(expr.arg)}</>;
		case "group":
			return (
				<>
					({term(expr.arg)}
					<span className={cn(expr.unclosed && "text-faint")}>)</span>
				</>
			);
		case "op": {
			const right = rolled && !hasDice(expr.right) ? value(expr.right) : NaN;
			// `+ −1` reads as `− 1`.
			const flip = right < 0 && /[+-]/.test(expr.op);
			const inner = (
				<>
					{term(expr.left)}{" "}
					{signs[flip ? (expr.op === "+" ? "-" : "+") : expr.op]}{" "}
					{flip ? showNumber(-right) : term(expr.right)}
				</>
			);
			return expr.op === "/" ? <>⌊{inner}⌋</> : inner;
		}
		case "dice": {
			const { count, sides, keep, dice } = expr;
			const name = (
				<span className={cn(dice ? "text-faint" : "font-medium")}>
					{count}d{sides}
					{keep && `${keep.highest ? "kh" : "kl"}${keep.n}`}
				</span>
			);
			if (!dice) return name;
			return (
				<span className="inline-flex flex-wrap items-baseline gap-1">
					{name}
					{dice.map(({ face, dropped }, i) => {
						const Face = dropped ? "s" : "span";
						return (
							<Face
								// biome-ignore lint/suspicious/noArrayIndexKey: dice are positions in a roll.
								key={i}
								data-face={
									sides === 20 && (face === 20 || face === 1) ? face : undefined
								}
								className={cn(
									"min-w-[1.6em] rounded-sm bg-muted px-1 text-center font-semibold",
									!dropped &&
										"data-[face=1]:text-destructive data-[face=20]:text-kind-pc data-[face=20]:shadow-[inset_0_0_0_1px_var(--kind-pc)]",
									dropped &&
										"bg-transparent font-normal text-muted-foreground decoration-2 shadow-[inset_0_0_0_1px_var(--border)]",
								)}
							>
								{face}
							</Face>
						);
					})}
				</span>
			);
		}
	}
}

/** `expr`, repeated `times` when more than once, and on the right its `total` when known, unless `expr` is a plain
 * number, else `note`. */
export function Dice({
	expr,
	times = 1,
	total,
	note,
	className,
}: {
	expr: Expr;
	times?: number;
	total?: number;
	note?: ReactNode;
	className?: string;
}) {
	return (
		<span
			className={cn(
				"flex items-baseline gap-3 lining-nums tabular-nums",
				className,
			)}
		>
			<span className="min-w-0 flex-1">
				{times > 1 && (
					<span className="text-muted-foreground">{times} rolls of </span>
				)}
				<Term expr={expr} rolled={total !== undefined && hasDice(expr)} />
			</span>
			{total !== undefined && !isNumber(expr) ? (
				// Out of the line box, so a total never makes its row taller.
				<span className="-my-1.5 font-serif text-2xl/none font-semibold">
					<span className="font-sans text-base font-normal text-faint">= </span>
					{showNumber(total)}
				</span>
			) : (
				note
			)}
		</span>
	);
}

/** An entry of the dice roller's list, under its label. */
export const Rolls = ({ roll }: { roll: RollEntry }) => (
	<div className="grid w-full gap-1.5 lining-nums">
		{roll.label && (
			<span className="text-sm text-muted-foreground">{roll.label}</span>
		)}
		{roll.rolls.map((r, i) => (
			// biome-ignore lint/suspicious/noArrayIndexKey: rolls are positions in an entry.
			<span key={i} className="flex items-baseline gap-2">
				{roll.rolls.length > 1 && (
					<span className="w-5 shrink-0 text-right text-sm text-faint">
						{i + 1}
					</span>
				)}
				<Dice expr={r.expr} total={r.total} className="flex-1" />
			</span>
		))}
	</div>
);
