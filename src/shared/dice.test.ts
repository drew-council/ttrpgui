import { expect, test } from "bun:test";
import {
	type Entry,
	hasDice,
	parse,
	type Rolled,
	rollAll,
	showNumber,
} from "./dice.ts";

const entries = (text: string): Entry[] => {
	const parsed = parse(text);
	if (parsed.error) throw new Error(parsed.error);
	return parsed.entries;
};
/** A `random` that makes the next dice of `sides` sides show `faces`. */
const showing = (sides: number, ...faces: number[]) => {
	let i = 0;
	return () => ((faces[i++] ?? 1) - 1) / sides;
};
const totals = (text: string, random = Math.random) =>
	(rollAll(entries(text), random) as Rolled[]).map((r) => r.total);
const error = (text: string) => {
	const { error, unfinished = false } = parse(text);
	return error && [error, unfinished];
};

test("arithmetic follows precedence and parentheses", () => {
	expect(totals("2+3*4")).toEqual([14]);
	expect(totals("(2+3)*4")).toEqual([20]);
	expect(totals("10-4-3")).toEqual([3]);
	expect(totals("-2*-3")).toEqual([6]);
	expect(totals(" +3 ")).toEqual([3]);
	expect(totals("−1")).toEqual([-1]);
});

test("division rounds down at each division", () => {
	expect(totals("45/2")).toEqual([22]);
	expect(totals("(3-6)/2")).toEqual([-2]);
	expect(totals("(-7)/2")).toEqual([-4]);
	expect(totals("7/2*2")).toEqual([6]);
	expect(totals("7/2/2")).toEqual([1]);
	expect(totals("27/2")).toEqual([13]);
	expect(totals("0/-3")).toEqual([0]);
});

test("a leading minus negates the whole term", () => {
	expect(totals("-7/2")).toEqual([-3]);
	expect(totals("-7/2+10")).toEqual(totals("10-7/2"));
	expect(totals("2*-3")).toEqual([-6]);
	expect(totals("(-7/2)")).toEqual([-3]);
});

test("dice sum their faces", () => {
	const [roll] = rollAll(entries("2d6+3"), showing(6, 4, 6)) as Rolled[];
	expect(roll?.total).toBe(13);
	expect(roll?.expr).toMatchObject({
		left: {
			type: "dice",
			dice: [
				{ face: 4, dropped: false },
				{ face: 6, dropped: false },
			],
		},
	});
	expect(totals("D20", showing(20, 17))).toEqual([17]);
	expect(totals("5d10+(3-5)/2", showing(10, 1, 2, 3, 4, 5))).toEqual([14]);
});

test("keep highest and lowest drop the rest", () => {
	const dice = (text: string, random: () => number) =>
		(rollAll(entries(text), random) as Rolled[]).map((r) => [
			r.total,
			r.expr.type === "dice" && r.expr.dice?.map((d) => d.dropped),
		]);
	expect(dice("2d20kh1", showing(20, 4, 17))).toEqual([[17, [true, false]]]);
	expect(dice("2d20kl1", showing(20, 4, 17))).toEqual([[4, [false, true]]]);
	expect(dice("2d20kh", showing(20, 9, 9))).toEqual([[9, [false, true]]]);
	expect(dice("4d6k3", showing(6, 1, 5, 3, 6))).toEqual([
		[14, [true, false, false, false]],
	]);
	expect(dice("4d6kh3", showing(6, 1, 5, 3, 6))).toEqual([
		[14, [true, false, false, false]],
	]);
});

test("repeats and lists are separate rolls", () => {
	expect(totals("3x 1d20+5", showing(20, 1, 10, 20))).toEqual([6, 15, 25]);
	expect(totals("2×d4", showing(4, 1, 3))).toEqual([1, 3]);
	expect(totals("1d4+1, 10/3", showing(4, 2))).toEqual([3, 3]);
	expect(error("3x2")).toEqual(["x repeats a roll; * multiplies", true]);
	expect(error("3x2, d6")).toEqual(["x repeats a roll; * multiplies", false]);
	expect(totals("1d20+5 x3", showing(20, 1, 10, 20))).toEqual([6, 15, 25]);
	expect(error("5 x3")).toEqual(["x repeats a roll; * multiplies", true]);
	expect(error("2d6+X3")).toEqual(["Unexpected “X”", false]);
	expect(entries("2x d6, 3").map((e) => e.times)).toEqual([2, 1]);
	expect(totals("2*3")).toEqual([6]);
});

test("caps say which limit", () => {
	expect(error("101d6")).toEqual(["Roll 1 to 100 dice at a time", false]);
	expect(error("0d6")).toEqual(["Roll 1 to 100 dice at a time", false]);
	expect(error("d1001")).toEqual(["Dice have 1 to 1,000 sides", false]);
	expect(error("2d20kh3")).toEqual([
		"Cannot keep more dice than it rolls",
		false,
	]);
	expect(error("2d20kh0")).toEqual(["Keep at least 1 die", false]);
	expect(error("21x d6")).toEqual(["Repeat 1 to 20 times", false]);
	expect(error("15x d6, 10x d4")).toEqual(["At most 20 rolls at once", false]);
	expect(error("10000000")).toEqual(["Numbers go up to 1,000,000", false]);
	expect(error("1000000*1000000*1000000")).toEqual([
		"The result is too large",
		false,
	]);
});

test("unfinished input is not wrong input", () => {
	for (const text of ["", "2d6+", "(1d8", "3x", "2d", "1d6,", "-", "d6 x"])
		expect(error(text)?.[1]).toBe(true);
	for (const text of ["2d6)", "abc", "2d6 3", "2d20kz", "3x,", "1/0"])
		expect(error(text)?.[1]).toBe(false);
	expect(error("1/0")).toEqual(["Division by zero", false]);
	expect(error("1d6/0")).toEqual(["Division by zero", false]);
	expect(error("1d6/(2-2)+1")).toEqual(["Division by zero", false]);
	expect(error("2d6 3")).toEqual(["Unexpected “3”", false]);
	expect(error("2d")).toEqual(["Missing the number of sides", true]);
	expect(error("(1d8")).toEqual(["Missing )", true]);
	expect(error("2d6+")).toEqual(["Missing a number", true]);
});

test("unfinished input keeps what is there, with holes", () => {
	const shape = (text: string) => parse(text).entries;
	const hole = { type: "hole" };
	expect(shape("2d6+")).toMatchObject([
		{ expr: { op: "+", left: { type: "dice" }, right: hole } },
	]);
	expect(shape("(2d6")).toMatchObject([
		{ expr: { type: "group", arg: { type: "dice" }, unclosed: true } },
	]);
	expect(shape("2d")).toMatchObject([{ expr: { type: "hole", text: "2d" } }]);
	expect(shape("3x")).toMatchObject([{ times: 3, expr: hole }]);
	expect(shape("1d20+5,")).toMatchObject([{ times: 1 }, { expr: hole }]);
	expect(shape("(2d6+")).toMatchObject([
		{ expr: { type: "group", arg: { right: hole }, unclosed: true } },
	]);
	expect(shape("2d6 3")).toEqual([]);
});

test("a division by zero after rolling is reported", () => {
	expect(rollAll(entries("1/(1d2-1)"), showing(2, 1))).toBe("Division by zero");
});

test("showNumber groups digits and uses a real minus", () => {
	expect(showNumber(1000000)).toBe("1,000,000");
	expect(showNumber(-1234)).toBe("−1,234");
});

test("hasDice", () => {
	expect(entries("(2+d4)*2").map((e) => hasDice(e.expr))).toEqual([true]);
	expect(entries("-(2+4)").map((e) => hasDice(e.expr))).toEqual([false]);
});
