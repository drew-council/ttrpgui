import { expect, test } from "bun:test";
import { eventKey, formatKey, normalizeKey } from "./keys.ts";

test("normalizeKey canonicalizes binds and rejects nonsense", () => {
	expect(normalizeKey("Ctrl+Shift+P")).toBe("ctrl+shift+p");
	expect(normalizeKey("shift+ctrl+p")).toBe("ctrl+shift+p");
	expect(normalizeKey("G")).toBe("shift+g");
	expect(normalizeKey("+")).toBe("+");
	expect(normalizeKey("ctrl++")).toBe("ctrl++");
	expect(normalizeKey("shift+?")).toBe("?");
	expect(normalizeKey("F2")).toBe("f2");
	expect(normalizeKey("hyper+k")).toBeUndefined();
	expect(normalizeKey("ctrl+kk")).toBeUndefined();
	expect(normalizeKey("")).toBeUndefined();
	expect(normalizeKey(" =  + ")).toBe("= +");
	expect(normalizeKey("= hyper+k")).toBeUndefined();
});

test("eventKey matches the canonical bind", () => {
	const press = (key: string, mods: Partial<KeyboardEvent> = {}) =>
		eventKey({
			key,
			ctrlKey: false,
			altKey: false,
			shiftKey: false,
			metaKey: false,
			...mods,
		});
	expect(press("K", { ctrlKey: true, shiftKey: true })).toBe("ctrl+shift+k");
	expect(press("G", { shiftKey: true })).toBe("shift+g");
	expect(press("+", { shiftKey: true })).toBe("+");
	expect(press(" ")).toBe("space");
	expect(press("Tab", { ctrlKey: true })).toBe("ctrl+tab");
	expect(formatKey("ctrl+shift+p")).toBe("Ctrl+Shift+P");
	expect(formatKey("ctrl++")).toBe("Ctrl++");
	expect(formatKey("= +")).toBe("= / +");
});
