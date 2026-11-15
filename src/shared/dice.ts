// Dice expressions: `2d6+3`, `d20`, `2d20kh1`, `4d6kl3`, `4d6k3` (`k` is `kh`), `5d10+(3-5)/2`, and at the top level a list of rolls that are
// not summed: `3x d20+5, 1d8+3 x2`. Division rounds down at each division. Parse while typing; roll on Enter.
// Every number the user types for a roll or an amount goes through here.

export type Die = { face: number; dropped: boolean };
export type Expr =
	| { type: "number"; value: number }
	| {
			type: "dice";
			count: number;
			sides: number;
			keep?: { highest: boolean; n: number };
			/** Set once rolled. */
			dice?: Die[];
	  }
	| { type: "negate"; arg: Expr }
	/** `unclosed` while the `)` is not typed yet. */
	| { type: "group"; arg: Expr; unclosed?: boolean }
	/** Where unfinished input needs more, after `text`, such as `2d`. */
	| { type: "hole"; text?: string }
	| { type: "op"; op: "+" | "-" | "*" | "/"; left: Expr; right: Expr };
/** `times` separate rolls of `expr`. */
export type Entry = { times: number; expr: Expr };
/** `error` says why the input cannot roll. `unfinished`: typing more may fix it, such as `2d6+` or `(1d8`; then
 * `entries` holds what is there, with holes where more is needed. Wrong input has no entries. */
export type Parsed = { entries: Entry[]; error?: string; unfinished?: true };
export type Rolled = { expr: Expr; total: number };

/** `n` with a real minus sign. */
export const showNumber = (n: number) =>
	(n < 0 ? "−" : "") + Math.abs(n).toLocaleString("en-US");

export const limits = { dice: 100, sides: 1000, number: 1_000_000, rolls: 20 };

class DiceError extends Error {}

/** One die: a face from 1 to `sides`. `random` returns a number in [0, 1). */
export const rollDie = (sides: number, random = Math.random) =>
	1 + Math.floor(random() * sides);

/** Whether `expr` is a number as typed, such as `5` or `-5`. */
export const isNumber = (expr: Expr) =>
	expr.type === "number" ||
	(expr.type === "negate" && expr.arg.type === "number");

export function parse(text: string): Parsed {
	let at = 0;
	/** Why the input is unfinished, once it ends where more is needed. */
	let missing: string | undefined;
	const space = () => {
		while (/\s/.test(text[at] ?? "")) at++;
	};
	const eat = (token: string) => {
		space();
		const found = text.slice(at, at + token.length).toLowerCase() === token;
		if (found) at += token.length;
		return found;
	};
	const wrong = (message: string): never => {
		throw new DiceError(message);
	};
	/** Wrong, unless the input ends here: then more typing may fix it, and `hole` stands for what is missing. */
	const fail = <T = Expr>(message: string, hole = { type: "hole" } as T): T => {
		space();
		if (at < text.length) wrong(message);
		missing ??= message;
		return hole;
	};
	const repeat = () => eat("x") || eat("×");
	const int = () => {
		space();
		const digits = /^\d+/.exec(text.slice(at))?.[0];
		if (!digits) return;
		at += digits.length;
		const n = Number(digits);
		return n > limits.number
			? wrong(`Numbers go up to ${showNumber(limits.number)}`)
			: n;
	};

	function atom(): Expr {
		if (eat("(")) {
			const arg = sum();
			const unclosed = !eat(")") && fail("Missing )", true);
			return { type: "group", arg, unclosed };
		}
		const count = int();
		if (!eat("d")) {
			if (count !== undefined) return { type: "number", value: count };
			space();
			return fail(text[at] ? `Unexpected “${text[at]}”` : "Missing a number");
		}
		const n = count ?? 1;
		const sides =
			int() ??
			fail<Expr>("Missing the number of sides", {
				type: "hole",
				text: `${n}d`,
			});
		if (typeof sides !== "number") return sides;
		if (n < 1 || n > limits.dice)
			wrong(`Roll 1 to ${limits.dice} dice at a time`);
		if (sides < 1 || sides > limits.sides)
			wrong(`Dice have 1 to ${showNumber(limits.sides)} sides`);
		if (!eat("k")) return { type: "dice", count: n, sides };
		const highest = !eat("l");
		if (highest) eat("h");
		const keep = int() ?? 1;
		if (keep < 1) wrong("Keep at least 1 die");
		if (keep > n) wrong("Cannot keep more dice than it rolls");
		return { type: "dice", count: n, sides, keep: { highest, n: keep } };
	}
	function unary(): Expr {
		if (eat("-") || eat("−")) return { type: "negate", arg: unary() };
		return eat("+") ? unary() : atom();
	}
	function product(): Expr {
		let left = unary();
		for (;;) {
			const op = eat("*") ? "*" : eat("/") ? "/" : undefined;
			if (!op) return left;
			const right = unary();
			if (op === "/" && !missing && !hasDice(right) && value(right) === 0)
				wrong("Division by zero");
			left = { type: "op", op, left, right };
		}
	}
	/** A leading minus negates the whole term, so `-7/2` is `0-7/2`. */
	function sum(): Expr {
		let left: Expr =
			eat("-") || eat("−") ? { type: "negate", arg: product() } : product();
		for (;;) {
			const op = eat("+") ? "+" : eat("-") || eat("−") ? "-" : undefined;
			if (!op) return left;
			left = { type: "op", op, left, right: product() };
		}
	}
	/** `3x expr` or `expr x3`. */
	function entry(): Entry {
		const start = at;
		let times = int();
		if (times === undefined || !repeat()) {
			at = start;
			times = undefined;
		}
		const expr = sum();
		if (times === undefined && repeat())
			times = int() ?? fail("Missing the number of rolls", 1);
		if (times === undefined) return { times: 1, expr };
		if (times < 1 || times > limits.rolls)
			wrong(`Repeat 1 to ${limits.rolls} times`);
		if (!missing && !hasDice(expr)) fail("x repeats a roll; * multiplies");
		return { times, expr };
	}

	try {
		const entries = [entry()];
		while (eat(",")) entries.push(entry());
		space();
		if (at < text.length) wrong(`Unexpected “${text[at]}”`);
		if (entries.reduce((n, e) => n + e.times, 0) > limits.rolls)
			wrong(`At most ${limits.rolls} rolls at once`);
		if (missing) return { entries, error: missing, unfinished: true };
		// Without dice, the value is known now, so its errors show now.
		for (const { expr } of entries) if (!hasDice(expr)) value(expr);
		return { entries };
	} catch (e) {
		if (!(e instanceof DiceError)) throw e;
		return { entries: [], error: e.message };
	}
}

export function hasDice(expr: Expr): boolean {
	if (expr.type === "dice") return true;
	if (expr.type === "op") return hasDice(expr.left) || hasDice(expr.right);
	return "arg" in expr && hasDice(expr.arg);
}

/** A copy of `expr` with every die rolled. `random` returns a number in [0, 1). */
export function roll(expr: Expr, random = Math.random): Expr {
	switch (expr.type) {
		case "number":
		case "hole":
			return expr;
		case "negate":
		case "group":
			return { ...expr, arg: roll(expr.arg, random) };
		case "op":
			return {
				...expr,
				left: roll(expr.left, random),
				right: roll(expr.right, random),
			};
		case "dice": {
			const { count, sides, keep } = expr;
			const faces = Array.from({ length: count }, () => rollDie(sides, random));
			const kept = faces
				.toSorted((a, b) => (keep?.highest ? b - a : a - b))
				.slice(0, keep?.n ?? count);
			// Each kept face keeps one die showing it.
			const dice = faces.map((face) => {
				const i = kept.indexOf(face);
				if (i >= 0) kept.splice(i, 1);
				return { face, dropped: i < 0 };
			});
			return { ...expr, dice };
		}
	}
}

/** The value of an expression without dice, or with its dice rolled. Throws a division by zero. */
export function value(expr: Expr): number {
	const n = ((): number => {
		switch (expr.type) {
			case "number":
				return expr.value;
			case "negate":
				return -value(expr.arg);
			case "group":
				return value(expr.arg);
			case "hole":
				throw new Error("The input is unfinished");
			case "dice":
				if (!expr.dice) throw new Error("The dice are not rolled");
				return expr.dice.reduce((n, d) => n + (d.dropped ? 0 : d.face), 0);
			case "op": {
				const [a, b] = [value(expr.left), value(expr.right)];
				if (expr.op === "+") return a + b;
				if (expr.op === "-") return a - b;
				if (expr.op === "*") return a * b;
				if (b === 0) throw new DiceError("Division by zero");
				return Math.floor(a / b);
			}
		}
	})();
	if (!Number.isSafeInteger(n)) throw new DiceError("The result is too large");
	// Turns -0 into 0.
	return n + 0;
}

/** Rolls each entry `times` times, or returns why it cannot, such as a division by zero. */
export function rollAll(
	entries: Entry[],
	random = Math.random,
): Rolled[] | string {
	try {
		return entries.flatMap(({ times, expr }) =>
			Array.from({ length: times }, () => {
				const rolled = roll(expr, random);
				return { expr: rolled, total: value(rolled) };
			}),
		);
	} catch (e) {
		if (e instanceof DiceError) return e.message;
		throw e;
	}
}
