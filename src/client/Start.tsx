// The start page, shown on launch in Electron: open a Game here, or join one hosted on the LAN.
// The main process serves it before any Game server exists and answers through `window.ttrpgui.start`.
import { cn } from "cn";
import { XIcon } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Badge } from "#components/ui/badge.tsx";
import { Button } from "#components/ui/button.tsx";
import { Input } from "#components/ui/input.tsx";
import { Kbd } from "#components/ui/kbd.tsx";
import { Switch } from "#components/ui/switch.tsx";
import type { Found, StartRecents } from "./bridge.ts";
import { Confirm } from "./Confirm.tsx";
import { isTextField, listClass, rowClass, useListNav } from "./list.ts";
import { clickOpens, confirm, ui, zoomOnKey } from "./ui.ts";

const start = window.ttrpgui?.start as NonNullable<
	NonNullable<Window["ttrpgui"]>["start"]
>;

type Server = Partial<Found> & { url: string; found: boolean; recent: boolean };
type Message = { side: "games" | "servers"; text: string; error?: boolean };

/** The join `Waiting` gave up on, as its query, which the start page puts back: the address and why it failed. */
const retry = "ttrpgui.retry";
const retried = new URLSearchParams(sessionStorage.getItem(retry) ?? "");
const failed = retried.get("error");
const port = (url: string) => new URL(url).port;
/** The server's address as people type it: `igneous:7373`. */
const address = (url: string) => new URL(url).host;

/** Recent servers first, so the last one joined keeps the cursor; then the rest found on the LAN. A recent server
 * found again is the same machine on the same port, under any address. */
function serverRows(
	recents: StartRecents["servers"],
	found: Found[],
): Server[] {
	const match = (r: StartRecents["servers"][number]) =>
		found.find(
			(f) =>
				f.url === r.url || (f.host === r.host && port(f.url) === port(r.url)),
		);
	const rows = recents.map((r) => {
		const f = match(r);
		return { ...f, ...r, self: f?.self, found: !!f, recent: true };
	});
	const fresh = found.filter((f) => !recents.some((r) => match(r) === f));
	return [...rows, ...fresh.map((f) => ({ ...f, found: true, recent: false }))];
}

export function Start() {
	const [recents, setRecents] = useState<StartRecents>();
	const [lan, setLan] = useState<{ servers: Found[]; networks: string[] }>();
	/** Applies to whatever opens next. It starts as the last Game was opened. */
	const [host, setHost] = useState(false);
	const [message, setMessage] = useState<Message | undefined>(
		failed ? { side: "servers", text: `${failed}.`, error: true } : undefined,
	);
	const [typed, setTyped] = useState(retried.get("server") ?? "");
	const asking = ui.use((s) => s.confirm);
	const addressRef = useRef<HTMLInputElement>(null);

	useEffect(() => {
		void start.recents().then((r) => {
			setRecents(r);
			setHost(r.games[0]?.mode === "display");
		});
	}, []);
	useEffect(() => {
		const stop = new AbortController();
		void (async () => {
			while (!stop.signal.aborted) {
				const found = await start.discover();
				if (!stop.signal.aborted) setLan(found);
				await new Promise((next) => setTimeout(next, 3000));
			}
		})();
		return () => stop.abort();
	}, []);

	const games = recents?.games ?? [];
	const servers = serverRows(recents?.servers ?? [], lan?.servers ?? []);
	const gameNav = useListNav(games.length, (i) => openRow(i));
	const serverNav = useListNav(servers.length, (i) => joinRow(i));

	// At launch the cursor sits on whatever was used last, so Enter resumes it. With nothing used yet, it moves to the
	// first Game found on the LAN, unless a key or click came first.
	const focused = useRef(false);
	const acted = useRef(false);
	useEffect(() => {
		if (!recents) return;
		if (!focused.current) {
			focused.current = true;
			sessionStorage.removeItem(retry);
			const joinedLast =
				(recents.servers[0]?.at ?? -1) > (recents.games[0]?.at ?? -1);
			const last = joinedLast ? serverNav : gameNav;
			(typed ? addressRef : last.ref).current?.focus();
		} else if (
			!acted.current &&
			servers.length &&
			!recents.games.length &&
			!recents.servers.length
		) {
			acted.current = true;
			serverNav.ref.current?.focus();
		}
	});

	async function open(dir: string, name: string) {
		setMessage({ side: "games", text: `Opening ${name}…` });
		const error = await start.open(dir, host ? "display" : "control");
		if (error) setMessage({ side: "games", text: error, error: true });
	}

	function openRow(i: number) {
		const game = games[i];
		gameNav.setIndex(i);
		if (!game?.missing) return game && open(game.dir, game.name);
		setMessage({
			side: "games",
			text: `The folder of ${game.name} is gone. Forget it with × or Delete.`,
			error: true,
		});
	}

	async function openFolder() {
		const picked = await start.pickFolder();
		if (!picked) return;
		const name = picked.dir.split("/").pop() || picked.dir;
		if (picked.game) return open(picked.dir, name);
		confirm({
			title: `${name} is not a Game yet. Make it one?`,
			detail: "Adds a notes folder to it.",
			yes: "Make it a Game",
			run: () => open(picked.dir, name),
		});
	}

	async function join(text: string, game?: string) {
		if (!text.trim()) return addressRef.current?.focus();
		setMessage({ side: "servers", text: `Joining ${game ?? text.trim()}…` });
		const error = await start.join(text, game);
		if (error) setMessage({ side: "servers", text: error, error: true });
	}
	function joinRow(i: number) {
		const server = servers[i];
		serverNav.setIndex(i);
		return server && join(server.url, server.game);
	}

	async function forget(key: string) {
		const list = games.some((g) => g.dir === key) ? gameNav : serverNav;
		await start.forget(key);
		setMessage(undefined);
		setRecents(await start.recents());
		// The row that had focus may be gone.
		list.ref.current?.focus();
	}

	// Page keys, while not typing and no confirmation is open. The zoom binds work everywhere.
	useEffect(() => {
		const keys: Record<string, () => void> = {
			h: () => setHost(!host),
			o: () => void openFolder(),
			"/": () => addressRef.current?.focus(),
		};
		const onKey = (e: KeyboardEvent) => {
			acted.current = true;
			if (zoomOnKey(e)) return e.preventDefault();
			const run = keys[e.key];
			const typing = isTextField(e.target) || ui.get().confirm;
			if (!run || typing || e.ctrlKey || e.altKey || e.metaKey) return;
			e.preventDefault();
			run();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});

	const notice = (side: Message["side"]) =>
		message?.side === side && (
			<p
				role={message.error ? "alert" : "status"}
				className={cn("text-sm text-muted-foreground", {
					"text-destructive": message.error,
				})}
			>
				{message.text}
			</p>
		);

	if (!recents) return null;
	// The top is where six recent Games would sit centered, so nothing moves as rows and notices come and go.
	return (
		<div
			className="mx-auto grid min-h-full max-w-[80rem] grid-cols-[minmax(0,1fr)] content-start gap-8 p-8 pt-[max(2rem,calc(50vh-23rem))] md:gap-12 md:px-16"
			onPointerDown={() => {
				acted.current = true;
			}}
		>
			<header className="flex items-center gap-4">
				<Icon className="size-12 text-primary" />
				<h1 className="font-serif text-5xl font-semibold italic">ttrpgui</h1>
			</header>

			<main className="grid grid-cols-[minmax(0,1fr)] gap-12 md:grid-cols-2 md:gap-20">
				<Pane
					title="Open a Game"
					detail={`From a folder on ${recents.here.host}.`}
				>
					<List
						label="Recent Games"
						nav={gameNav}
						count={games.length}
						onEmptyEnter={() => void openFolder()}
						onDelete={(i) => games[i] && forget(games[i].dir)}
					>
						{games.map((game, i) => (
							<Row
								key={game.dir}
								selected={i === gameNav.index}
								onOpen={() => openRow(i)}
								onForget={() => forget(game.dir)}
								missing={game.missing}
								title={game.name}
								detail={
									// Truncates from the start, since the end tells Games apart. The isolate (U+2066) keeps the
									// path itself left to right.
									<span dir="rtl">{`\u2066${game.path}`}</span>
								}
							>
								{game.missing ? (
									<span className="text-sm text-destructive/80">Missing</span>
								) : (
									host && <Badge className={hostMark}>Host</Badge>
								)}
							</Row>
						))}
						{!games.length && (
							<p className={empty}>
								No Games yet. Press Enter to open a folder: a Game, or an empty
								folder for a new one.
							</p>
						)}
					</List>
					<div className="flex flex-col gap-3">
						{/* Each text the switch changes shares one cell with its other form, so nothing moves. */}
						<div className="flex flex-wrap items-center gap-x-6 gap-y-3">
							<label
								htmlFor="host"
								className="flex cursor-pointer items-center gap-2.5"
							>
								<Switch
									id="host"
									aria-label="Host a display"
									className="data-[size=default]:h-[1.15rem] data-[size=default]:w-8"
									checked={host}
									onCheckedChange={setHost}
									tabIndex={-1}
									// A click on the label focuses the switch, but Enter must still open the cursor's Game.
									onClick={() => gameNav.ref.current?.focus()}
								/>
								<span>
									Host a display <Kbd>H</Kbd>
									<span className="block text-sm text-faint">
										For the computer with the players' screen
									</span>
								</span>
							</label>
							<Button
								variant="outline"
								tabIndex={-1}
								onMouseDown={keepFocus}
								onClick={() => void openFolder()}
							>
								<span className="grid *:[grid-area:1/1]">
									<span className={cn(!host && "invisible")}>Host folder…</span>
									<span className={cn(host && "invisible")}>Open folder…</span>
								</span>
								<Kbd>O</Kbd>
							</Button>
						</div>
						<p className="grid text-sm text-muted-foreground *:[grid-area:1/1]">
							<span className={cn(!host && "invisible")}>
								{`Shows only the player display here and serves the Game to the LAN. Drive it from another computer by joining ${recents.here.joinAt}.`}
							</span>
							<span className={cn(host && "invisible")}>
								Opens the notes and controls here, with the player display a
								click away.
							</span>
						</p>
						{notice("games")}
					</div>
				</Pane>

				<Pane
					title="Join a Game"
					detail="Hosted by another computer on the LAN."
				>
					<List
						label="Games on the LAN"
						nav={serverNav}
						count={servers.length}
						onEmptyEnter={() => addressRef.current?.focus()}
						onDelete={(i) => servers[i]?.recent && forget(servers[i].url)}
					>
						{servers.map((server, i) => (
							<Row
								key={server.url}
								selected={i === serverNav.index}
								onOpen={() => void joinRow(i)}
								onForget={server.recent ? () => forget(server.url) : undefined}
								lead={
									<span
										title={
											server.found ? "On the LAN now" : "Not seen on the LAN"
										}
										className={cn(
											"size-2 flex-none rounded-full",
											server.found
												? "bg-primary shadow-[0_0_0.5rem_var(--primary)]"
												: "border border-faint",
										)}
									/>
								}
								title={server.game ?? address(server.url)}
								detail={
									<>
										{server.host && (
											<span>
												{server.host}
												{server.self && ", this computer"}
											</span>
										)}
										{server.game && <span>{address(server.url)}</span>}
									</>
								}
							>
								{server.recent && !server.found && (
									<span className="text-sm text-faint">Not found</span>
								)}
							</Row>
						))}
						{!servers.length && lan && (
							<p className={empty}>
								{lan.networks.length
									? `No Game found yet. On the computer with the player display, open the Game with Host a display; its firewall must allow TCP port ${recents.here.port}. Or type its address below.`
									: "This computer is not on a LAN, so there is nothing to search. Type an address below."}
							</p>
						)}
					</List>
					<div className="flex flex-col gap-3">
						{lan?.networks.length !== 0 && (
							<p className="flex items-center gap-2 text-sm text-faint">
								<span className="size-1.5 flex-none animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
								Looking for Games on this network…
							</p>
						)}
						<form
							className="flex gap-2"
							onSubmit={(e) => {
								e.preventDefault();
								void join(typed);
							}}
						>
							<div className="relative flex-1">
								<Input
									ref={addressRef}
									value={typed}
									onChange={(e) => setTyped(e.target.value)}
									onInput={() => setMessage(undefined)}
									onKeyDown={(e) =>
										e.key === "Escape" && serverNav.ref.current?.focus()
									}
									aria-label="Address"
									placeholder="igneous or 192.168.1.20"
									className="h-9 pr-9"
								/>
								<Kbd className="absolute top-2 right-2">/</Kbd>
							</div>
							<Button
								type="submit"
								variant="outline"
								className="h-9"
								tabIndex={-1}
								onMouseDown={keepFocus}
							>
								Join
							</Button>
						</form>
						{notice("servers")}
					</div>
				</Pane>
			</main>

			<footer className="flex flex-wrap gap-x-8 gap-y-2 text-sm text-faint">
				{Object.entries({
					Tab: "Next list or field",
					"J K": "Move",
					Enter: "Open or join",
					Delete: "Forget",
				}).map(([keys, what]) => (
					<span key={what} className="flex items-center gap-2">
						{keys.split(" ").map((key) => (
							<Kbd key={key}>{key}</Kbd>
						))}
						{what}
					</span>
				))}
			</footer>
			{asking && <Confirm key={asking.title} spec={asking} />}
		</div>
	);
}

/** Buttons never take focus, so the keys keep working on the list. */
const keepFocus = (e: { preventDefault(): void }) => e.preventDefault();

/** Marks the row Enter or a click would host: the cursor row and the hovered one. */
const hostMark =
	"hidden group-hover/row:inline-flex group-focus-within/list:group-aria-selected/row:inline-flex";

/** An empty list's text, marked like a cursor row while the list has focus, since Enter acts on it. */
const empty =
	"rounded-sm px-3 py-2 text-muted-foreground group-focus-within/list:bg-primary/14 group-focus-within/list:shadow-[inset_2px_0_var(--primary)]";

function Pane(props: { title: string; detail: string; children: ReactNode }) {
	return (
		<section aria-label={props.title} className="flex flex-col gap-5">
			<div>
				<h2 className="font-serif text-3xl font-semibold">{props.title}</h2>
				<p className="text-muted-foreground">{props.detail}</p>
			</div>
			{props.children}
		</section>
	);
}

/** A `useListNav` listbox. Delete forgets the cursor row; with no rows, Enter runs `onEmptyEnter`. */
function List(props: {
	label: string;
	nav: ReturnType<typeof useListNav>;
	count: number;
	onEmptyEnter: () => void;
	onDelete: (index: number) => void;
	children: ReactNode;
}) {
	const { nav } = props;
	const onKeyDown: typeof nav.onKeyDown = (e) => {
		if (e.key === "Delete") props.onDelete(nav.index);
		else if (e.key === "Enter" && !props.count) props.onEmptyEnter();
		else return nav.onKeyDown(e);
		e.preventDefault();
	};
	return (
		<div
			ref={nav.ref}
			role="listbox"
			tabIndex={0}
			aria-label={props.label}
			className={cn(listClass, "-mx-3 flex flex-col gap-0.5 py-0.5")}
			onKeyDown={onKeyDown}
		>
			{props.children}
		</div>
	);
}

/** A list row. Its × forgets it; the × shows on hover, on the cursor row, and always when `missing`. */
function Row(props: {
	selected: boolean;
	onOpen: () => void;
	onForget?: () => void;
	missing?: boolean;
	lead?: ReactNode;
	title: string;
	detail: ReactNode;
	children: ReactNode;
}) {
	return (
		<div
			role="option"
			aria-selected={props.selected}
			tabIndex={-1}
			className={cn(rowClass, "group/row min-h-15 px-3 py-2")}
			{...clickOpens(props.onOpen)}
		>
			{props.lead}
			<div className="min-w-0 flex-1">
				<div className={cn("truncate text-lg", props.missing && "text-faint")}>
					{props.title}
				</div>
				<div className="flex gap-3 text-sm text-faint *:truncate">
					{props.detail}
				</div>
			</div>
			{props.children}
			{props.onForget && (
				<Button
					variant="ghost"
					size="icon-sm"
					aria-label={`Forget ${props.title}`}
					title="Forget"
					tabIndex={-1}
					className={cn(
						"-mr-1 text-muted-foreground hover:text-foreground",
						!props.missing &&
							"opacity-0 group-hover/row:opacity-100 group-focus-within/list:group-aria-selected/row:opacity-100",
					)}
					onMouseDown={keepFocus}
					onClick={(e) => {
						e.stopPropagation();
						props.onForget?.();
					}}
				>
					<XIcon />
				</Button>
			)}
		</div>
	);
}

/** Shown while a joined server does not answer. The main process reloads it with each new error and leaves once the
 * server answers. */
export function Waiting() {
	const query = new URLSearchParams(location.search);
	const leave = () => {
		sessionStorage.setItem(retry, location.search);
		window.ttrpgui?.back();
	};
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && leave();
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	});
	return (
		<div className="grid h-full place-content-center justify-items-center gap-4 p-8 text-center">
			<Icon className="size-10 text-faint" />
			<p className="font-serif text-2xl font-semibold">
				Waiting for {query.get("game") ?? "the Game"} at {query.get("server")}
			</p>
			<p className="flex items-center gap-2 text-muted-foreground">
				<span className="size-1.5 animate-pulse rounded-full bg-primary motion-reduce:animate-none" />
				{query.get("error")}. Retrying…
			</p>
			<Button variant="outline" className="mt-2" onClick={leave}>
				Back to the start page
				<Kbd>Esc</Kbd>
			</Button>
		</div>
	);
}

/** The app icon (`nix/ttrpgui.svg`) without its tile. */
function Icon({ className }: { className?: string }) {
	return (
		<svg
			viewBox="44 32 168 192"
			aria-hidden
			className={className}
			fill="none"
			stroke="currentColor"
			strokeWidth="10"
			strokeLinejoin="round"
			strokeLinecap="round"
		>
			<path d="M128 92 166 158H90Z" fill="currentColor" fillOpacity=".22" />
			<path d="M128 40 204 84V172L128 216 52 172V84Z" />
			<path
				d="M128 40V92M52 84 128 92 204 84M204 84 166 158 204 172M166 158 128 216 90 158M52 172 90 158 52 84"
				strokeWidth="7"
				strokeOpacity=".8"
			/>
		</svg>
	);
}
