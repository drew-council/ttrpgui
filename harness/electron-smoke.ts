// Boots the real Electron app on a temp Game under Xvfb and checks the control page and the display window render.
// Run as `bun run smoke`, which wraps it in xvfb-run.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron } from "playwright";
import { connected, copyFixture } from "./harness.ts";

// Refuse to run against the real desktop.
if (!process.env.XAUTHORITY?.includes("xvfb-run"))
	throw new Error("Run under xvfb-run: bun run smoke");
const gameDir = await copyFixture();
const home = await mkdtemp(join(tmpdir(), "ttrpgui-home-"));
const { WAYLAND_DISPLAY, ...env } = process.env;
const app = await _electron.launch({
	args: [
		".",
		"--game",
		gameDir,
		"--port",
		"0",
		"--ozone-platform=x11",
		"--mute-audio",
	],
	// Temp XDG dirs keep the user's state untouched.
	env: {
		...env,
		CHROME_DEVEL_SANDBOX: "",
		XDG_STATE_HOME: home,
		XDG_CONFIG_HOME: home,
	},
});
const page = await app.firstWindow();
await connected(page);
await page.getByText("Thorin Ashvale").waitFor();
// The preload works: the Electron-only Action is in the palette.
await page.keyboard.press("Control+p");
await page.keyboard.type("another game");
await page.getByRole("option", { name: "Open another Game" }).waitFor();
await page.keyboard.press("Escape");
await page.screenshot({ path: "shots/electron-control.png" });

// The display window opens from the palette and plays music without a click.
const run = async (command: string) => {
	await page.keyboard.press("Control+p");
	await page.keyboard.type(command);
	await page.keyboard.press("Enter");
};
await run("Open the player display");
const display = await app.waitForEvent("window");
await connected(display);
await display.waitForFunction(() => {
	const audio = document.querySelector("audio");
	return audio && audio.currentTime > 0.5 && !audio.paused;
});
await display.locator("[data-layer=wallpaper] video").waitFor();
await display.screenshot({ path: "shots/electron-display.png" });
const closed = display.waitForEvent("close");
await run("Close the player display");
await closed;
await app.close();
console.log(
	"Electron smoke check passed: shots/electron-control.png, shots/electron-display.png",
);
