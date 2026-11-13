// GUI controls for Actions. `ActionButton` and `ActionItem` take an Action id and get the rest from the registry: what
// runs, whether it is available, its title, icon, short label, and current bind. Neither takes focus on a press, so the
// Action sees what it would from the keyboard (the focused tracker, form field, or editor) and a picker it opens
// returns focus there.
import { cn } from "cn";
import { EllipsisIcon, type LucideIcon } from "lucide-react";
import {
	type ComponentProps,
	type MouseEvent,
	type ReactNode,
	useSyncExternalStore,
} from "react";
import { Button } from "#components/ui/button.tsx";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuShortcut,
	DropdownMenuTrigger,
} from "#components/ui/dropdown-menu.tsx";
import { Kbd } from "#components/ui/kbd.tsx";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "#components/ui/tooltip.tsx";
import { type ActionId, binds, formatKey } from "../shared/keys.ts";
import { actions, canRun } from "./actions.ts";
import { getGame, subscribeGame } from "./sync.ts";
import { ui } from "./ui.ts";

function subscribe(onChange: () => void) {
	const later = () => setTimeout(onChange);
	const off = [subscribeGame(onChange), ui.subscribe(onChange)];
	document.addEventListener("focusin", onChange);
	// Focus may land nowhere, so look once it has left.
	document.addEventListener("focusout", later);
	return () => {
		for (const unsubscribe of off) unsubscribe();
		document.removeEventListener("focusin", onChange);
		document.removeEventListener("focusout", later);
	};
}

/** Whether a control may run `id` now. Rerenders when that changes. */
export const useAvailable = (id: ActionId) =>
	useSyncExternalStore(subscribe, () => canRun(id, true));

/** The current bind of `id`, formatted, if it has one. */
export const bindOf = (id: ActionId) => {
	const key = binds(getGame().config.keys)[id];
	return key ? formatKey(key) : undefined;
};

const keepFocus = (e: MouseEvent) => e.preventDefault();

/** A small button with a tooltip naming what it does and its bind. Text when `label` is set, else only the icon. */
export function ToolButton({
	icon: Icon,
	label,
	title,
	bind,
	variant = "ghost",
	className,
	...props
}: {
	icon?: LucideIcon;
	label?: ReactNode;
	title: string;
	bind?: string;
} & Omit<ComponentProps<typeof Button>, "title" | "size">) {
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Button
					variant={variant}
					size={label ? "sm" : "icon-sm"}
					aria-label={label ? undefined : title}
					className={cn(
						"text-muted-foreground",
						label && "has-[svg]:pl-1.5",
						className,
					)}
					onMouseDown={keepFocus}
					{...props}
				>
					{Icon && <Icon />}
					{label && <span className="flex min-w-0 gap-1">{label}</span>}
				</Button>
			</TooltipTrigger>
			<TooltipContent>
				{title} {bind && <Kbd>{bind}</Kbd>}
			</TooltipContent>
		</Tooltip>
	);
}

/** A button that runs an Action. Disabled while it is unavailable. `label` and `icon` replace the registry's. */
export function ActionButton({
	id,
	label,
	icon,
	...props
}: {
	id: ActionId;
	label?: string;
	icon?: LucideIcon;
} & Omit<ComponentProps<typeof Button>, "title" | "size" | "onClick">) {
	const action = actions[id];
	const available = useAvailable(id);
	return (
		<ToolButton
			icon={icon ?? action.icon}
			label={label ?? action.label}
			title={action.title}
			bind={bindOf(id)}
			disabled={!available}
			{...props}
			onClick={() => canRun(id, true) && action.run()}
		/>
	);
}

/** What had focus when the open menu opened, and what was chosen in it. */
let before: Element | null = null;
let chosen: (() => void) | undefined;

/** Runs `run` once the open menu has closed and returned focus. Menu items that open or focus something use it. */
export const afterMenu = (run: () => void) => {
	chosen = run;
};

/** A menu, by default "More" behind an ellipsis. When it closes, focus goes back where it was before it opened. */
export function ActionMenu({
	label = "More",
	trigger,
	children,
}: {
	label?: string;
	/** Replaces the ellipsis button. MUST forward its props and ref, as a shadcn `Button` does. */
	trigger?: ReactNode;
	children: ReactNode;
}) {
	return (
		<DropdownMenu
			onOpenChange={(open) => {
				if (open) before = document.activeElement;
			}}
		>
			<Tooltip>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						{trigger ?? (
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={label}
								className="text-muted-foreground"
							>
								<EllipsisIcon />
							</Button>
						)}
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent>{label}</TooltipContent>
			</Tooltip>
			<DropdownMenuContent
				align={trigger ? "start" : "end"}
				className="w-auto min-w-52"
				onCloseAutoFocus={(e) => {
					e.preventDefault();
					if (before instanceof HTMLElement) before.focus();
					const run = chosen;
					chosen = undefined;
					run?.();
				}}
			>
				{children}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

/** A menu item that runs an Action, with its bind. Disabled while it is unavailable. */
export function ActionItem({
	id,
	destructive,
}: {
	id: ActionId;
	destructive?: boolean;
}) {
	const action = actions[id];
	const available = useAvailable(id);
	const Icon = action.icon;
	const bind = bindOf(id);
	return (
		<DropdownMenuItem
			disabled={!available}
			variant={destructive ? "destructive" : "default"}
			onSelect={() => afterMenu(action.run)}
		>
			{Icon && <Icon />}
			{action.title}
			{bind && (
				<DropdownMenuShortcut className="pl-4 tracking-normal">
					{bind}
				</DropdownMenuShortcut>
			)}
		</DropdownMenuItem>
	);
}
