// Thin Electron shell: starts the server in-process and opens the control window on it.
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, dialog, ipcMain, Menu } from "electron";
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

// Switching Games is rare, so it remembers the choice and relaunches without `--game`.
ipcMain.handle("open-game", async () => {
	const gameDir = await pickGame();
	if (!gameDir) return;
	await writeFile(lastGameFile, gameDir);
	const args = process.argv.slice(1);
	const at = args.indexOf("--game");
	if (at >= 0) args.splice(at, 2);
	app.relaunch({ args });
	app.exit();
});

// The default menu's accelerators (Ctrl+W, Ctrl+R) would shadow keybinds.
Menu.setApplicationMenu(null);

let serverUrl = "";
let display: BrowserWindow | undefined;

// The display is a plain page that may play audio without a click. The page itself toggles fullscreen.
ipcMain.handle("display", (_, open: boolean) => {
	if (!open) return display?.close();
	if (display) return display.focus();
	display = new BrowserWindow({
		width: 1280,
		height: 720,
		backgroundColor: "#1d1822",
		webPreferences: { autoplayPolicy: "no-user-gesture-required" },
	});
	display.on("closed", () => {
		display = undefined;
	});
	void display.loadURL(`${serverUrl}/display`);
});

// Top-level `await app.whenReady()` deadlocks: Electron emits ready only after the main module finishes evaluating.
void app
	.whenReady()
	.then(async () => {
		const { gameDir: arg, host, port } = parseServeArgs(process.argv.slice(2));
		const gameDir = await chooseGame(arg);
		if (!gameDir) return app.quit();
		await mkdir(dirname(lastGameFile), { recursive: true });
		await writeFile(lastGameFile, gameDir);
		const { url } = await startServer({ gameDir, host, port });
		serverUrl = url;
		const control = new BrowserWindow({
			width: 1280,
			height: 800,
			webPreferences: {
				preload: fileURLToPath(new URL("preload.cjs", import.meta.url)),
			},
		});
		control.on("closed", () => app.quit());
		void control.loadURL(`${url}/control`);
	})
	.catch((e: Error) => {
		// For example, the port is in use, often by another ttrpgui.
		dialog.showErrorBox("ttrpgui could not start", e.message);
		app.quit();
	});
