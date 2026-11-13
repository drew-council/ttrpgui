import { cp, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { startServer } from "./src/server/server.ts";

const port = 7373;

export default defineConfig({
	root: "src/client",
	// One bundle served from localhost, so its size does not matter.
	build: {
		outDir: "../../dist/client",
		emptyOutDir: true,
		chunkSizeWarningLimit: 2000,
	},
	server: {
		proxy: {
			"/ws": { target: `ws://127.0.0.1:${port}`, ws: true },
			"/game": `http://127.0.0.1:${port}`,
		},
	},
	plugins: [
		react(),
		tailwindcss(),
		{
			// `bun run dev` also runs the game server. GAME picks the Game; default is a temp copy of the sample.
			name: "game-server",
			apply: "serve",
			async configureServer(vite) {
				if (!process.env.GAME) {
					process.env.GAME = await mkdtemp(join(tmpdir(), "ttrpgui-dev-"));
					await cp("fixtures/sample-game", process.env.GAME, {
						recursive: true,
					});
				}
				const server = await startServer({ gameDir: process.env.GAME, port });
				console.log(`Game: ${process.env.GAME}`);
				vite.httpServer?.once("close", server.close);
			},
		},
	],
});
