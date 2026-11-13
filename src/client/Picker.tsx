// The one fuzzy picker: command palette, quick open, prompts, and confirmations all use it.
// fuzzysort ranks and highlights; cmdk only handles the list keys, so its own filter is off.
import fuzzysort from "fuzzysort";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import {
	Command,
	CommandEmpty,
	CommandInput,
	CommandItem,
	CommandList,
	CommandShortcut,
} from "#components/ui/command.tsx";
import { Dialog, DialogContent, DialogTitle } from "#components/ui/dialog.tsx";
import { Kbd } from "#components/ui/kbd.tsx";
import { closePicker, type Item, type PickerSpec, wantsNewTab } from "./ui.ts";

export function Picker({ spec }: { spec: PickerSpec }) {
	const [query, setQuery] = useState(spec.value ?? "");
	const [loaded, setLoaded] = useState<Item[]>();
	const items = loaded ?? spec.items;
	useEffect(() => {
		let live = true;
		spec.load?.(query).then((found) => live && setLoaded(found));
		return () => {
			live = false;
		};
	}, [query, spec]);
	const rows = useMemo(() => {
		const found: { item: Item; label: ReactNode }[] = fuzzysort
			.go(query, items, { key: "label", limit: 100 })
			.map((result) => ({
				item: result.obj,
				label: query
					? result.highlight((match, i) => (
							<mark key={i} className="bg-transparent font-bold text-primary">
								{match}
							</mark>
						))
					: result.obj.label,
			}));
		const extra = spec.fromQuery?.(query.trim());
		return extra ? [...found, { item: extra, label: extra.label }] : found;
	}, [query, items, spec]);
	// Whether the Enter or click that selects a row asked for a new tab. See `wantsNewTab`.
	const newTab = useRef(false);
	const choose = (item: Item) => {
		closePicker();
		item.run(newTab.current);
	};

	return (
		<Dialog open onOpenChange={(open) => open || closePicker()}>
			<DialogContent
				showCloseButton={false}
				aria-describedby={undefined}
				// closePicker returns focus itself, before a chosen row may move it.
				onCloseAutoFocus={(e) => e.preventDefault()}
				className="top-[12vh] flex max-h-[70vh] translate-y-0 flex-col gap-0 overflow-hidden rounded-xl border p-0 shadow-overlay ring-0 sm:max-w-[38rem]"
			>
				<Command
					shouldFilter={false}
					vimBindings={false}
					onKeyDown={(e) => {
						if (e.key === "Enter") newTab.current = e.ctrlKey || e.metaKey;
					}}
				>
					<DialogTitle className="px-3 pt-2 pb-1.5 text-sm font-normal text-muted-foreground wrap-anywhere">
						{spec.title}
					</DialogTitle>
					<CommandInput
						value={query}
						onValueChange={setQuery}
						placeholder={spec.placeholder}
						className="text-base"
						onFocus={(e) => e.currentTarget.select()}
						onKeyDown={(e) => {
							// Home and End move the caret, not the list.
							if (e.key === "Home" || e.key === "End") e.stopPropagation();
						}}
					/>
					<CommandList className="max-h-none">
						{rows.map(({ item, label }, i) => (
							<CommandItem
								// biome-ignore lint/suspicious/noArrayIndexKey: rows are positions in a ranking.
								key={i}
								value={String(i)}
								onSelect={() => choose(item)}
								onMouseDown={(e) => {
									newTab.current = wantsNewTab(e);
									// A middle press would otherwise paste the primary selection or start autoscroll.
									if (e.button === 1) e.preventDefault();
								}}
								// cmdk selects on a primary click only.
								onAuxClick={(e) => e.button === 1 && choose(item)}
								className="gap-2 px-3 py-2 text-base data-selected:bg-primary/14 data-selected:shadow-[inset_2px_0_var(--primary)]"
							>
								<span className="min-w-0 flex-1 truncate">{label}</span>
								{item.detail && (
									<span className="text-sm text-faint">{item.detail}</span>
								)}
								{item.hint && (
									<CommandShortcut className="tracking-normal">
										<Kbd>{item.hint}</Kbd>
									</CommandShortcut>
								)}
							</CommandItem>
						))}
						{query && (
							<CommandEmpty className="px-3 py-3 text-left text-base text-muted-foreground">
								Nothing matches “{query}”.
							</CommandEmpty>
						)}
					</CommandList>
				</Command>
			</DialogContent>
		</Dialog>
	);
}
