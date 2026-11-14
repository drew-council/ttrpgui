// Thin Electron shell: starts the server in-process and opens the control window on it. `--display` opens only the
// player display. `--connect URL` starts no server and opens the window on the server at URL.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, Menu, net } from "electron";
import { parseServeArgs, startServer } from "./server/server.ts";

const lastGameFile = join(
	process.env.XDG_STATE_HOME || join(homedir(), ".local/state"),
	"ttrpgui/last-game",
);

async function pickGame() {
	const { filePaths } = await dialog.showOpenDialog({
		title: "Open or create a Game",
		properties: ["openDirectory", "createDirectory"],
	});
	return filePaths[0];
}

/** `--game DIR`, else the last opened Game, else a folder picker. */
async function chooseGame(arg: string | undefined) {
	if (arg) return resolve(arg);
	const last = await readFile(lastGameFile, "utf8").catch(() => "");
	if (last && existsSync(last)) return last;
	return pickGame();
}

// Switching Games is rare, so it relaunches on the new one. Chromium moves switches before other arguments on
// relaunch, which would split `--port N`, so every option goes back inline.
ipcMain.handle("open-game", async () => {
	const gameDir = await pickGame();
	if (!gameDir) return;
	const { values } = parseServeArgs(process.argv.slice(1));
	const args = Object.entries({ ...values, game: gameDir }).map(
		([key, value]) => (value === true ? `--${key}` : `--${key}=${value}`),
	);
	app.relaunch({ args: [app.getAppPath(), ...args] });
	app.exit();
});

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

let serverUrl = "";
let control: BrowserWindow | undefined;
let display: BrowserWindow | undefined;

/** Tells the control page whether the display window is open. */
const displayChanged = () =>
	control?.webContents.send("display", display !== undefined);
ipcMain.handle("display-open", () => display !== undefined);

const background = "#1d1822";

/** Loads `url` once its server answers. Until then the window says why it waits, and it retries. */
async function loadWhenUp(win: BrowserWindow, url: string) {
	let shown = "";
	while (!win.isDestroyed()) {
		try {
			await net.fetch(url, { signal: AbortSignal.timeout(5000) });
			return await win.loadURL(url);
		} catch (e) {
			const page = `<body style="background:${background};color:#ddd;font:1.25rem system-ui;display:grid;place-content:center;text-align:center">
<p>Cannot reach the ttrpgui server at <b>${new URL(url).origin}</b>.</p>
<p style="opacity:.6">${(e as Error).message}. Retrying…</p>`;
			if (page !== shown && !win.isDestroyed())
				await win.loadURL(
					`data:text/html;charset=utf-8,${encodeURIComponent(page)}`,
				);
			shown = page;
		}
		await new Promise((retry) => setTimeout(retry, 2000));
	}
}

// The display is a plain page that may play audio without a click. The page itself toggles fullscreen.
function openDisplay() {
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
	void loadWhenUp(display, `${serverUrl}/display`);
}
ipcMain.handle("display", (_, open: boolean) =>
	open ? openDisplay() : display?.close(),
);

/** `http://igneous:7373/control/` or `igneous:7373` → `http://igneous:7373`. */
const origin = (url: string) =>
	new URL(url.includes("://") ? url : `http://${url}`).origin;

// Top-level `await app.whenReady()` deadlocks: Electron emits ready only after the main module finishes evaluating.
void app
	.whenReady()
	.then(async () => {
		// After a relaunch the app path is no longer first, so it is skipped as a positional instead.
		const {
			values,
			gameDir: arg,
			host,
			port,
		} = parseServeArgs(process.argv.slice(1));
		if (typeof values.connect === "string") serverUrl = origin(values.connect);
		else {
			const gameDir = await chooseGame(arg);
			if (!gameDir) return app.quit();
			await mkdir(dirname(lastGameFile), { recursive: true });
			await writeFile(lastGameFile, gameDir);
			serverUrl = (await startServer({ gameDir, host, port })).url;
		}
		if (values.display) return openDisplay();
		// A remote page gets no preload: its Game and display window are on the server's machine, as in a browser.
		control = new BrowserWindow({
			width: 1280,
			height: 800,
			backgroundColor: background,
			webPreferences: values.connect
				? {}
				: { preload: fileURLToPath(new URL("preload.cjs", import.meta.url)) },
		});
		control.on("closed", () => app.quit());
		void loadWhenUp(control, `${serverUrl}/control`);
	})
	.catch((e: Error) => {
		console.error(`ttrpgui could not start: ${e.message}`);
		dialog.showErrorBox("ttrpgui could not start", e.message);
		app.exit(1);
	});
