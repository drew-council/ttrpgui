// The one confirmation: a yes or no question. Y confirms; N and Escape cancel. Enter and Space press the focused
// button, which starts on the safe one, so neither alone destroys anything. Arrows and Tab move between the two buttons. Other keys reach no keybind but
// the privacy screen's (see `useKeybinds`).
import { useRef } from "react";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "#components/ui/alert-dialog.tsx";
import { Kbd } from "#components/ui/kbd.tsx";
import { type ConfirmSpec, closePopup } from "./ui.ts";

const arrows = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"];
/** Always shows where Enter goes, even after a click or a shortcut opened it. */
const focused = "focus:border-ring! focus:ring-3 focus:ring-ring/50!";
const Key = ({ children }: { children: string }) => (
	<Kbd className="bg-current/15 text-current opacity-80">{children}</Kbd>
);

export function Confirm({ spec }: { spec: ConfirmSpec }) {
	const no = useRef<HTMLButtonElement>(null);
	const yes = useRef<HTMLButtonElement>(null);
	const choose = (run?: () => void) => {
		closePopup();
		run?.();
	};
	return (
		// Cancel and Escape close it through here.
		<AlertDialog open onOpenChange={(open) => open || choose(spec.cancel)}>
			<AlertDialogContent
				{...(!spec.detail && { "aria-describedby": undefined })}
				// closePopup returns focus itself, before the chosen side may move it.
				onCloseAutoFocus={(e) => e.preventDefault()}
				onKeyDown={(e) => {
					const k = e.key.toLowerCase();
					if (["tab", "enter", "escape", " "].includes(k)) return;
					if (e.ctrlKey || e.altKey || e.metaKey) return;
					e.preventDefault();
					if (k === "y") choose(spec.run);
					else if (k === "n") choose(spec.cancel);
					else if (arrows.includes(e.key))
						(document.activeElement === no.current ? yes : no).current?.focus();
				}}
				className="top-[12vh] translate-y-0 gap-0 rounded-xl border p-0 shadow-overlay ring-0 data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-[38rem]"
			>
				<AlertDialogHeader className="gap-1 px-4 pt-3.5 pb-4">
					<AlertDialogTitle className="text-base wrap-anywhere">
						{spec.title}
					</AlertDialogTitle>
					{spec.detail && (
						<AlertDialogDescription>{spec.detail}</AlertDialogDescription>
					)}
				</AlertDialogHeader>
				<AlertDialogFooter className="m-0 px-3 py-2.5">
					<AlertDialogCancel ref={no} className={focused}>
						{spec.no ?? "Cancel"} <Key>N</Key>
					</AlertDialogCancel>
					<AlertDialogAction
						ref={yes}
						className={focused}
						variant={spec.destructive ? "destructive" : "default"}
						// Radix would close it as a cancel.
						onClick={(e) => {
							e.preventDefault();
							choose(spec.run);
						}}
					>
						{spec.yes} <Key>Y</Key>
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
