// The headless server: owns the Game, serves the client and Game files over HTTP, syncs state over WebSocket.
// MUST stay Node-compatible: it runs inside Electron's main process and standalone.
import { mkdir } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { watch } from "chokidar";
import { enablePatches, type Patch, produceWithPatches } from "immer";
import sirv from "sirv";
import { WebSocketServer } from "ws";
import type {
	ClientMessage,
	GameState,
	ServerMessage,
} from "../shared/state.ts";
import { loadConfig, loadGame, reconcile, searchNotes } from "./game.ts";
import { type History, runMutation } from "./mutations.ts";

enablePatches();

const clientDir = fileURLToPath(new URL("../../dist/client", import.meta.url));

const defaultConfigFile = join(
	process.env.XDG_CONFIG_HOME || join(homedir(), ".config"),
	"ttrpgui/config.toml",
);

/** Parses `[--game DIR] [--port N] [--lan]`. Shared by the CLI and Electron. */
export function parseServeArgs(args: string[]) {
	const { values, positionals } = parseArgs({
		args,
		strict: false,
		allowPositionals: true,
		options: {
			game: { type: "string" },
			port: { type: "string" },
			lan: { type: "boolean" },
		},
	});
	return {
		positionals,
		gameDir: typeof values.game === "string" ? values.game : undefined,
		port: Number(values.port ?? 7373),
		host: values.lan ? "0.0.0.0" : "127.0.0.1",
	};
}

export async function startServer({
	gameDir,
	configFile = defaultConfigFile,
	host = "127.0.0.1",
	port = 0,
}: {
	gameDir: string;
	configFile?: string;
	host?: string;
	port?: number;
}) {
	gameDir = resolve(gameDir);
	await mkdir(join(gameDir, "notes"), { recursive: true });

	/** Everything in state comes from disk: the Game plus the user config. */
	async function load(): Promise<GameState> {
		const game = await loadGame(gameDir);
		const { config, problems } = await loadConfig(configFile);
		return { ...game, config, problems: [...problems, ...game.problems] };
	}
	let state = await load();
	const history: History = new Map();

	const serveClient = sirv(clientDir, { dev: true, single: true });
	const serveGame = sirv(gameDir, { dev: true });
	const http = createServer(async (req, res) => {
		if (req.url?.startsWith("/search?")) {
			const query = new URLSearchParams(req.url.slice(8)).get("q") ?? "";
			const hits = await searchNotes(gameDir, Object.keys(state.notes), query);
			res.setHeader("content-type", "application/json");
			return res.end(JSON.stringify(hits));
		}
		if (!req.url?.startsWith("/game/")) return serveClient(req, res);
		req.url = req.url.slice("/game".length);
		serveGame(req, res);
	});
	const wss = new WebSocketServer({ server: http, path: "/ws" });
	const send = (socket: { send(data: string): void }, message: ServerMessage) =>
		socket.send(JSON.stringify(message));

	function notify(message: string) {
		for (const client of wss.clients) send(client, { type: "notice", message });
	}

	function publish(next: GameState, patches: Patch[]) {
		if (!patches.length) return;
		state = next;
		for (const client of wss.clients)
			send(client, { type: "patches", patches });
	}

	// Mutations and reloads run one at a time, so a reload never sees a half-done mutation.
	let queue = Promise.resolve();
	const enqueue = (task: () => Promise<void>) => {
		queue = queue.then(task).catch((e) => console.error(e));
	};

	async function reload() {
		const fresh = await load();
		const [next, patches] = produceWithPatches(state, (draft) =>
			reconcile(draft, state, fresh),
		);
		publish(next, patches);
	}

	wss.on("connection", (socket) => {
		send(socket, { type: "snapshot", state });
		socket.on("message", (data) =>
			enqueue(async () => {
				const { id, mutation } = JSON.parse(String(data)) as ClientMessage;
				let error: string | undefined;
				try {
					await runMutation({ dir: gameDir, state, history, notify }, mutation);
				} catch (e) {
					error = (e as Error).message;
				}
				// Reload even after a failure: the mutation may have changed some files.
				await reload();
				send(socket, { type: "result", id, error });
			}),
		);
	});

	let timer: NodeJS.Timeout | undefined;
	const watcher = watch([gameDir, configFile], {
		ignoreInitial: true,
		// Dotfiles inside the Game. The config may itself live under a dot directory.
		ignored: (path) => {
			const parts = relative(gameDir, path).split(sep);
			return parts[0] !== ".." && parts.some((part) => part.startsWith("."));
		},
	}).on("all", () => {
		clearTimeout(timer);
		timer = setTimeout(() => enqueue(reload), 50);
	});
	await new Promise<void>((ready) => watcher.once("ready", ready));
	// `ws` re-emits the HTTP server's errors, such as a port in use.
	await new Promise<void>((listening, fail) => {
		wss.once("error", fail);
		http.listen(port, host, listening);
	}).catch(async (e) => {
		await watcher.close();
		throw e;
	});

	const url = `http://${host === "0.0.0.0" ? "localhost" : host}:${(http.address() as AddressInfo).port}`;
	async function close() {
		clearTimeout(timer);
		await watcher.close();
		for (const client of wss.clients) client.terminate();
		await new Promise((closed) => http.close(closed));
	}
	return { url, close };
}
