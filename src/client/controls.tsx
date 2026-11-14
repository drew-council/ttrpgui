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

/** Centers a line of text's capitals on the icons beside it. The UI font sits high in its line box, so the box is
 * trimmed to the capitals and padded evenly, which keeps descenders inside a truncating box. */
export const capText = "[text-box:trim-both_cap_alphabetic] py-[0.3em]";

/** A small button with a tooltip naming what it does and its bind, and under them `detail`. Text when `label` is set,
 * else only the icon. A disabled button sits in a span, since a disabled button gets no pointer events, so its tooltip
 * still shows. */
export function ToolButton({
	icon: Icon,
	label,
	title,
	bind,
	detail,
	variant = "ghost",
	className,
	...props
}: {
	icon?: LucideIcon;
	label?: ReactNode;
	title: string;
	bind?: string;
	detail?: string;
} & Omit<ComponentProps<typeof Button>, "title" | "size">) {
	const button = (
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
			{label && (
				<span className="flex min-w-0 items-center gap-1">
					{typeof label === "string" ? (
						<span className={capText}>{label}</span>
					) : (
						label
					)}
				</span>
			)}
		</Button>
	);
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				{props.disabled ? (
					<span className="inline-flex flex-none">{button}</span>
				) : (
					button
				)}
			</TooltipTrigger>
			<Tip title={title} bind={bind} detail={detail} />
		</Tooltip>
	);
}

/** Binds as key caps. */
const Keys = ({ binds }: { binds: (string | undefined)[] }) =>
	binds.map(
		(bind) =>
			bind && (
				<Kbd key={bind}>
					<span className={capText}>{bind}</span>
				</Kbd>
			),
	);

/** A tooltip: what a control does and its binds, and under them `detail` with its own `detailBind`. */
export function Tip({
	title,
	bind,
	detail,
	detailBind,
}: {
	title: string;
	bind?: string | (string | undefined)[];
	detail?: string;
	detailBind?: string;
}) {
	return (
		<TooltipContent className="flex-col items-start">
			<span className="flex items-center gap-1.5">
				<span className={capText}>{title}</span>
				<Keys binds={[bind].flat()} />
			</span>
			{detail && (
				<span className="flex items-center gap-1.5 opacity-70">
					<span className={capText}>{detail}</span>
					<Keys binds={[detailBind]} />
				</span>
			)}
		</TooltipContent>
	);
}

/** A button that runs an Action. Disabled while it is unavailable, with the reason in its tooltip. `label`, `icon`
 * (`null` for none), and `title` replace the registry's; `detail` adds a line to the tooltip while it is available. */
export function ActionButton({
	id,
	label,
	icon,
	title,
	detail,
	...props
}: {
	id: ActionId;
	label?: ReactNode;
	icon?: LucideIcon | null;
	title?: string;
	detail?: string;
} & Omit<ComponentProps<typeof Button>, "title" | "size" | "onClick">) {
	const action = actions[id];
	const available = useAvailable(id);
	return (
		<ToolButton
			icon={icon === null ? undefined : (icon ?? action.icon)}
			label={label ?? action.label}
			title={title ?? action.title}
			bind={bindOf(id)}
			detail={available ? detail : action.unavailable?.()}
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
	tooltip,
	trigger,
	children,
}: {
	label?: string;
	/** Replaces the tooltip naming `label`, as a `Tip`. */
	tooltip?: ReactNode;
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
				{tooltip ?? <TooltipContent>{label}</TooltipContent>}
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
