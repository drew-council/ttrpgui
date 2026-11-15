import { expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./server.ts";

test("Game files are served whatever their names, and never from outside the Game", async () => {
	const root = await mkdtemp(join(tmpdir(), "ttrpgui-test-"));
	const gameDir = join(root, "game");
	await writeFile(join(root, "secret.txt"), "secret");
	const dir = join(gameDir, "atmospheres", "Rain, Night?");
	await mkdir(dir, { recursive: true });
	const names = [
		"A, B; C? D: E@F & G=H + $1 #2 %41 100%.opus",
		"Ünïcødé 名前.webp",
	];
	for (const name of names) await writeFile(join(dir, name), name);
	const game = await startServer({
		gameDir,
		configFile: join(root, "none.toml"),
	});
	// As `gameUrl` in `src/client/Display.tsx` builds them.
	const url = (...path: string[]) =>
		`${game.url}/game/${path.map(encodeURIComponent).join("/")}`;
	// A raw path, which `fetch` would normalize.
	const status = (path: string) =>
		new Promise((done) =>
			request({ port: new URL(game.url).port, path }, (res) =>
				done(res.statusCode),
			).end(),
		);
	try {
		for (const name of names) {
			const res = await fetch(url("atmospheres", "Rain, Night?", name));
			expect(await res.text()).toBe(name);
		}
		const range = await fetch(
			url("atmospheres", "Rain, Night?", names[0] ?? ""),
			{
				headers: { range: "bytes=0-1" },
			},
		);
		expect(range.status).toBe(206);
		expect(await range.text()).toBe("A,");
		const inside = new URL(url("atmospheres", "Rain, Night?", names[1] ?? ""));
		expect(await status(inside.pathname)).toBe(200);
		for (const path of [
			"/game/../secret.txt",
			"/game/..%2Fsecret.txt",
			"/game/%2E%2E/secret.txt",
			"/game/atmospheres/..%2F..%2F..%2Fsecret.txt",
			"/game/%E0%A4%A",
		])
			expect(await status(path)).toBe(404);
	} finally {
		await game.close();
	}
});
