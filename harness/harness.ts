// Agent test harness: serve a temp copy of a fixture Game and drive the views in headless Chromium.
// Run inside the dev shell (it sets PLAYWRIGHT_BROWSERS_PATH) after `bun run build`.
import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright";
import { startServer } from "../src/server/server.ts";

/** Copies `fixtures/<name>` to a temp directory. */
export async function copyFixture(name = "sample-game") {
	const dir = await mkdtemp(join(tmpdir(), "ttrpgui-"));
	await cp(new URL(`../fixtures/${name}`, import.meta.url), dir, {
		recursive: true,
	});
	return dir;
}

/** Serves a temp copy of a fixture on a free port, with a temp user config file that does not exist yet. */
export async function bootGame(fixture = "sample-game") {
	const gameDir = await copyFixture(fixture);
	const configFile = join(
		await mkdtemp(join(tmpdir(), "ttrpgui-config-")),
		"config.toml",
	);
	return {
		gameDir,
		configFile,
		...(await startServer({ gameDir, configFile })),
	};
}

/** Waits until a page has its first state snapshot. */
export const connected = (page: Page) =>
	page.locator('[data-status="connected"]').waitFor();

/** Opens /control at 1280x800 and /display at 1920x1080, both connected. */
export async function openViews(url: string) {
	// Never play sound out loud. Media still plays, so its time advances.
	const browser = await chromium.launch({ args: ["--mute-audio"] });
	const open = async (path: string, width: number, height: number) => {
		const page = await browser.newPage({ viewport: { width, height } });
		await page.goto(url + path);
		await connected(page);
		return page;
	};
	return {
		browser,
		control: await open("/control", 1280, 800),
		display: await open("/display", 1920, 1080),
	};
}
