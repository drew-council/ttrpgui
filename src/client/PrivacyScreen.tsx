// The privacy screen: an opaque cover over the control window, so notes left unattended are not seen by mistake.
// Any key or click lifts it. While it is up, window capture listeners swallow every key and click, so nothing reaches
// the app, Radix layers included. Focus never moves, so typing resumes where it was.
import { EyeOffIcon } from "lucide-react";
import { useEffect } from "react";
import { ui } from "./ui.ts";

const modifiers = ["Control", "Shift", "Alt", "Meta", "AltGraph", "CapsLock"];
const events = [
	"keydown",
	"keyup",
	"pointerdown",
	"pointerup",
	"mousedown",
	"mouseup",
	"click",
	"auxclick",
	"dblclick",
	"contextmenu",
];

export function PrivacyScreen() {
	const on = ui.use((s) => s.privacy);
	useEffect(() => {
		// The key that lifted the screen: its repeats and release are swallowed too.
		let held: string | undefined;
		// When a click lifted the screen: the rest of a double-click is swallowed too.
		let clicked = -Infinity;
		function guard(e: Event) {
			const covered = ui.get().privacy;
			const key = e instanceof KeyboardEvent ? e : undefined;
			const lifter = key
				? key.code === held && (e.type === "keyup" || key.repeat)
				: e.timeStamp - clicked < 500;
			if (!covered && !lifter) return;
			e.preventDefault();
			e.stopImmediatePropagation();
			if (lifter && e.type === "keyup") held = undefined;
			if (!covered) return;
			if (
				key
					? e.type === "keydown" && !key.repeat && !modifiers.includes(key.key)
					: e.type.endsWith("click")
			) {
				held = key?.code;
				if (!key) clicked = e.timeStamp;
				ui.set({ privacy: false });
			}
		}
		for (const type of events) window.addEventListener(type, guard, true);
		return () => {
			for (const type of events) window.removeEventListener(type, guard, true);
		};
	}, []);
	if (!on) return null;
	return (
		// Above toasts and every Radix layer, and clickable even while a modal layer turns off pointer events.
		<div className="pointer-events-auto fixed inset-0 z-[2147483647] grid cursor-default place-content-center justify-items-center gap-3 bg-background select-none">
			<EyeOffIcon className="size-6 text-faint" />
			<p className="font-serif text-4xl font-semibold text-muted-foreground italic">
				ttrpgui
			</p>
			<p className="text-sm text-faint">Press a key or click to return</p>
		</div>
	);
}
