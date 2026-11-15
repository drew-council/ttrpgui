// Boots the real Electron app under Xvfb: the start page, opening a Game from it, the display window, and joining a
// display host from a second instance's start page. Run as `bun run smoke`, which wraps it in xvfb-run.
// `TTRPGUI_BIN=result/bin/ttrpgui` checks the Nix package instead.
import { mkdtemp } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { _electron, type ElectronApplication, type Page } from "playwright";
import { connected, copyFixture } from "./harness.ts";

// Refuse to run against the real desktop.
if (!process.env.XAUTHORITY?.includes("xvfb-run"))
	throw new Error("Run under xvfb-run: bun run smoke");
// No Wayland, and no session bus: the folder picker would reach the real desktop through its portal.
const { WAYLAND_DISPLAY, DBUS_SESSION_BUS_ADDRESS, ...env } = process.env;
const bin = process.env.TTRPGUI_BIN;
/** Launches the app with its own temp XDG dirs, so the user's state stays untouched. */
const launch = async (args: string[], extra: Record<string, string> = {}) => {
	const home = await mkdtemp(join(tmpdir(), "ttrpgui-home-"));
	return _electron.launch({
		executablePath: bin,
		args: [
			...(bin ? [] : ["."]),
			...args,
			"--ozone-platform=x11",
			"--mute-audio",
		],
		env: {
			...env,
			CHROME_DEVEL_SANDBOX: "",
			XDG_STATE_HOME: home,
			XDG_CONFIG_HOME: home,
			// Probe nothing on the real LAN.
			TTRPGUI_DISCOVER: "",
			...extra,
		},
	});
};
/** Makes the folder picker answer `dir` without opening. */
const stubFolder = (app: ElectronApplication, dir: string) =>
	app.evaluate(({ dialog }, dir) => {
		dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [dir] });
	}, dir);
const run = async (page: Page, command: string) => {
	await page.keyboard.press("Control+p");
	await page.keyboard.type(command);
	await page.keyboard.press("Enter");
};
const freePort = () =>
	new Promise<number>((found) => {
		const server = createServer().listen(0, "127.0.0.1", () => {
			const { port } = server.address() as { port: number };
			server.close(() => found(port));
		});
	});

// With no flags but the port, the start page shows; Open folder opens the Game here.
const gameDir = await copyFixture();
const app = await launch(["--port", "0"]);
// Atmosphere sync finds its downloaders.
await app.evaluate(() => {
	const { execFileSync } = process.getBuiltinModule("node:child_process");
	execFileSync("yt-dlp", ["--version"]);
	execFileSync("ffmpeg", ["-version"]);
});
const page = await app.firstWindow();
await page.getByRole("heading", { name: "Open a Game" }).waitFor();
await stubFolder(app, gameDir);
await page.keyboard.press("o");
await connected(page);
await page.getByText("Thorin Ashvale").waitFor();
// The preload works: the Electron-only Action is in the palette.
await page.keyboard.press("Control+p");
await page.keyboard.type("start page");
await page.getByRole("option", { name: "Back to the start page" }).waitFor();
await page.keyboard.press("Escape");
await page.screenshot({ path: "shots/electron-control.png" });

// The display window opens from the palette and plays music without a click.
await run(page, "Open the player display");
const display = await app.waitForEvent("window");
await connected(display);
await display.waitForFunction(() => {
	const audio = document.querySelector("audio");
	return audio && audio.currentTime > 0.5 && !audio.paused;
});
await display.locator("[data-layer=wallpaper] video").waitFor();
await display.screenshot({ path: "shots/electron-display.png" });
const closed = display.waitForEvent("close");
await run(page, "Close the player display");
await closed;
await app.close();

// A display host started with flags, found and joined from a second instance's start page.
const port = await freePort();
const hostDir = await copyFixture();
const host = await launch([
	"--game",
	hostDir,
	"--lan",
	"--display",
	"--port",
	String(port),
]);
await connected(await host.firstWindow());
const remote = await launch([], { TTRPGUI_DISCOVER: `127.0.0.1:${port}` });
const remotePage = await remote.firstWindow();
await remotePage
	.getByRole("option", { name: new RegExp(basename(hostDir)) })
	.click();
await connected(remotePage);
await remotePage.getByText("Thorin Ashvale").waitFor();
// The remote control has the way back but not the display window, which belongs to the host.
if (
	!(await remotePage.evaluate(
		() => window.ttrpgui?.back && !window.ttrpgui.display,
	))
)
	throw new Error("The remote control page has the wrong preload");
await run(remotePage, "Back to the start page");
await remotePage.getByRole("heading", { name: "Join a Game" }).waitFor();
await remotePage
	.getByRole("option", { name: new RegExp(basename(hostDir)) })
	.waitFor();
await remote.close();
await host.close();
console.log(
	"Electron smoke check passed: shots/electron-control.png, shots/electron-display.png",
);
