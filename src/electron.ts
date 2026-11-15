// Thin Electron shell. With no flags it shows the start page: open a Game here (the control window, or only the player
// display served to the LAN), or join one on the LAN. `--game DIR`, `--display`, `--lan`, and `--connect URL` skip it.
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir, hostname } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, Menu, net } from "electron";
import sirv from "sirv";
import { clientDir, parseServeArgs, startServer } from "./server/server.ts";
import {
	discover,
	joinAt,
	type Mode,
	readRecents,
	remember,
	serverInfo,
	serverUrl,
	updateRecents,
} from "./start.ts";

// `--display` is also Chromium's X11 display switch, under which GTK dialogs crash. `process.argv` keeps it.
app.commandLine.removeSwitch("display");

// The default menu's accelerators (Ctrl+W, Ctrl+R) would shadow keybinds.
Menu.setApplicationMenu(null);

// On Wayland, Chromium adopts the image description the compositor prefers. Hyprland offers HDR to a fullscreen
// window on an HDR-capable monitor and then switches the monitor to HDR, which breaks one running 8-bit.
// Without the color-management protocol every window stays plain sRGB.
app.commandLine.appendSwitch(
	"disable-features",
	[
		app.commandLine.getSwitchValue("disable-features"),
		"WaylandWpColorManagerV1",
	]
		.filter(Boolean)
		.join(","),
);

// After a relaunch the app path is no longer first, so it is skipped as a positional instead.
const args = parseServeArgs(process.argv.slice(1));
const background = "#1d1822";

/** What the control window shows, which decides what the preload exposes: the start page, a Game served here, or a
 * Game on another machine. */
let mode: "start" | "local" | "remote" = "start";
let game: Awaited<ReturnType<typeof startServer>> | undefined;
let control: BrowserWindow | undefined;
let display: BrowserWindow | undefined;
ipcMain.on("mode", (e) => {
	e.returnValue = mode;
});

/** Tells the control page whether the display window is open. */
const displayChanged = () =>
	control?.webContents.send("display", display !== undefined);
ipcMain.handle("display-open", () => display !== undefined);

/** The URL each window should end up on, so a newer load cancels an older one still waiting. */
const wanted = new WeakMap<BrowserWindow, string>();

const reasons: Record<string, string> = {
	"net::ERR_CONNECTION_REFUSED": "Nothing answers on that port",
	"net::ERR_NAME_NOT_RESOLVED": "No computer has that name",
	"net::ERR_ADDRESS_UNREACHABLE": "That address is unreachable",
};
const reason = ({ name, message }: Error) =>
	name === "TimeoutError"
		? "It does not answer"
		: (reasons[message] ??
			(message.startsWith("net::")
				? `It does not answer (${message})`
				: message));

/** Loads `url` once its server answers, resolving to whether it did. Until then the window says why it waits, and it
 * retries. With `ttrpgui`, the server must answer `/info` as one, so a join never loads a foreign page. `game` names
 * what the window waits for. */
async function loadWhenUp(
	win: BrowserWindow,
	url: string,
	ttrpgui = false,
	game?: string,
) {
	wanted.set(win, url);
	let shown = "";
	const current = () => !win.isDestroyed() && wanted.get(win) === url;
	while (current()) {
		try {
			const probe = ttrpgui ? new URL("/info", url).href : url;
			const res = await net.fetch(probe, { signal: AbortSignal.timeout(5000) });
			if (ttrpgui && (await res.json().catch(() => ({}))).app !== "ttrpgui")
				throw new Error("That is not a ttrpgui Game");
			if (!current()) break;
			await win.loadURL(url);
			return true;
		} catch (e) {
			const waiting = new URL("/waiting", await startPage());
			waiting.search = new URLSearchParams({
				server: new URL(url).host,
				error: reason(e as Error),
				...(game && { game }),
			}).toString();
			if (waiting.href !== shown && current()) await win.loadURL(waiting.href);
			shown = waiting.href;
		}
		await new Promise((retry) => setTimeout(retry, 2000));
	}
	return false;
}

let startUrl: Promise<string> | undefined;
/** The start page is the client's `/start` route, served on loopback since no Game server may exist yet. */
function startPage() {
	startUrl ??= new Promise((ready) => {
		const http = createServer(sirv(clientDir, { single: true }));
		http.listen(0, "127.0.0.1", () =>
			ready(`http://127.0.0.1:${(http.address() as AddressInfo).port}/start`),
		);
	});
	return startUrl;
}

/** The control window, titled after what it shows: `Ironvale — ttrpgui`. */
function controlWindow(name?: string) {
	control ??= new BrowserWindow({
		width: 1280,
		height: 800,
		backgroundColor: background,
		webPreferences: {
			preload: fileURLToPath(new URL("preload.cjs", import.meta.url)),
		},
	})
		.on("closed", () => app.quit())
		.on("page-title-updated", (e) => e.preventDefault());
	control.setTitle(name ? `${name} — ttrpgui` : "ttrpgui");
	return control;
}

// The display is a plain page that may play audio without a click. The page itself toggles fullscreen. A hosting
// display starts fullscreen, is titled after its Game, and shows where to join it.
function openDisplay(host?: { name: string; join: string }) {
	if (display) return display.focus();
	display = new BrowserWindow({
		width: 1280,
		height: 720,
		backgroundColor: background,
		webPreferences: { autoplayPolicy: "no-user-gesture-required" },
	});
	display.on("closed", () => {
		display = undefined;
		displayChanged();
		if (!control) app.quit();
	});
	displayChanged();
	if (host)
		display
			.on("page-title-updated", (e) => e.preventDefault())
			.setTitle(`${host.name} display — ttrpgui`);
	const win = display;
	const query = host ? `?${new URLSearchParams({ join: host.join })}` : "";
	void loadWhenUp(win, `${game?.url}/display${query}`).then(
		(up) =>
			up &&
			host &&
			// As the page's own F does, so F leaves it.
			win.webContents
				.executeJavaScript("document.documentElement.requestFullscreen()", true)
				.catch(() => {}),
	);
}
ipcMain.handle("display", (_, open: boolean) =>
	open ? openDisplay() : display?.close(),
);

/** Serves the Game in `dir` and opens it as `how` says. A display host has no control window: closing the display
 * quits. */
async function openGame(dir: string, how: Mode, host: string) {
	try {
		game = await startServer({ gameDir: dir, host, port: args.port });
	} catch (e) {
		if (
			(e as Error & { cause?: { code?: string } }).cause?.code === "EADDRINUSE"
		)
			throw new Error(
				`Port ${args.port} is in use, often by another ttrpgui on this computer. Close it and try again.`,
			);
		throw e;
	}
	await updateRecents((r) => ({
		...r,
		games: remember(r.games, { dir, mode: how, at: Date.now() }, (g) => g.dir),
	}));
	if (how === "display") {
		// The display opens first: with no window left, Electron would quit.
		const start = control;
		control = undefined;
		openDisplay({
			name: basename(dir),
			join: joinAt(Number(new URL(game.url).port)),
		});
		start?.removeAllListeners("closed");
		return start?.destroy();
	}
	mode = "local";
	void loadWhenUp(controlWindow(basename(dir)), `${game.url}/control`);
}

/** Opens the control window on the server at `address`. Once it answers as a ttrpgui server, it is remembered with the
 * names it gives. */
async function joinServer(address: string, game?: string) {
	const url = serverUrl(address);
	// Waiting only helps where nothing answers yet. A page that answers as something else never will be a Game, and a
	// name that does not resolve never will.
	const info = await net
		.fetch(`${url}/info`, { signal: AbortSignal.timeout(3000) })
		.then(
			(res) => res.json().catch(() => ({})),
			(e: Error) => {
				if (e.message === "net::ERR_NAME_NOT_RESOLVED")
					throw new Error(`No computer has the name ${new URL(url).hostname}.`);
			},
		);
	if (info && info.app !== "ttrpgui")
		throw new Error(
			`${new URL(url).host} answers, but it is not a ttrpgui Game.`,
		);
	mode = "remote";
	const win = controlWindow(new URL(url).host);
	if (!(await loadWhenUp(win, `${url}/control`, true, game))) return;
	const found = await serverInfo(url);
	if (!found) return;
	win.setTitle(`${found.game} on ${found.host} — ttrpgui`);
	await updateRecents((r) => ({
		...r,
		servers: remember(
			r.servers,
			{ ...found, url, at: Date.now() },
			(s) => s.url,
		),
	}));
}

async function showStart() {
	mode = "start";
	await loadWhenUp(controlWindow(), await startPage());
}

ipcMain.handle("back", async () => {
	display?.destroy();
	await showStart();
	await game?.close();
	game = undefined;
});

/** Runs a start page request, resolving to its error message, if any. */
const attempt = (run: () => Promise<unknown>) =>
	run().then(
		() => undefined,
		(e: Error) => e.message,
	);

/** `/home/drew/games` → `~/games`. */
const tilde = (path: string) =>
	`${path}/`.startsWith(`${homedir()}/`)
		? `~${path.slice(homedir().length)}`
		: path;

ipcMain.handle("recents", async () => {
	const { games, servers } = await readRecents();
	return {
		games: games.map((g) => ({
			...g,
			name: basename(g.dir),
			path: tilde(dirname(g.dir)),
			missing: !existsSync(g.dir),
		})),
		servers,
		here: {
			host: hostname(),
			port: args.port,
			// `--port 0` binds a port only once hosting starts.
			joinAt: args.port ? joinAt(args.port) : "the address its display shows",
		},
	};
});
ipcMain.handle("pick-folder", async () => {
	const { filePaths } = await dialog.showOpenDialog({
		title: "Open or create a Game",
		properties: ["openDirectory", "createDirectory"],
	});
	const dir = filePaths[0];
	return dir && { dir, game: existsSync(join(dir, "notes")) };
});
ipcMain.handle("open", (_, dir: string, how: Mode) =>
	attempt(async () => {
		if (!existsSync(dir)) throw new Error(`${dir} is not there anymore.`);
		await openGame(dir, how, how === "display" ? "0.0.0.0" : args.host);
	}),
);
ipcMain.handle("join", (_, address: string, game?: string) =>
	attempt(() => joinServer(address, game)),
);
ipcMain.handle("forget", (_, key: string) =>
	updateRecents((r) => ({
		games: r.games.filter((g) => g.dir !== key),
		servers: r.servers.filter((s) => s.url !== key),
	})),
);
ipcMain.handle("discover", () => discover(args.port));

// Top-level `await app.whenReady()` deadlocks: Electron emits ready only after the main module finishes evaluating.
void app
	.whenReady()
	.then(async () => {
		const { values, gameDir, host } = args;
		if (typeof values.connect === "string")
			return await joinServer(values.connect);
		// `--display` and `--lan` alone reopen the last Game.
		const last = (await readRecents()).games.find((g) => existsSync(g.dir));
		const dir = gameDir
			? resolve(gameDir)
			: values.display || values.lan
				? last?.dir
				: undefined;
		if (dir)
			return await openGame(dir, values.display ? "display" : "control", host);
		await showStart();
	})
	.catch((e: Error) => {
		console.error(`ttrpgui could not start: ${e.message}`);
		dialog.showErrorBox("ttrpgui could not start", e.message);
		app.exit(1);
	});
