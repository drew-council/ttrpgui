// Client mirror of the server state. Patches arrive over the socket; nothing is optimistic.
import { applyPatches, enablePatches } from "immer";
import type { Mutation } from "../server/mutations.ts";
import type { GameState, ServerMessage } from "../shared/state.ts";
import { createStore } from "./store.ts";
import { toast } from "./ui.ts";

enablePatches();

type Status = "connecting" | "connected" | "disconnected";

const store = createStore<{ status: Status; game?: GameState }>({
	status: "connecting",
});
let socket: WebSocket;
let lastId = 0;
const pending = new Map<number, (error?: string) => void>();

function connect() {
	socket = new WebSocket(`${location.origin.replace(/^http/, "ws")}/ws`);
	socket.onclose = () => {
		store.set({ status: "disconnected" });
		for (const settle of pending.values()) settle("Lost the connection");
		setTimeout(connect, 1000);
	};
	socket.onmessage = (event) => {
		const message = JSON.parse(event.data) as ServerMessage;
		const { game } = store.get();
		if (message.type === "snapshot")
			store.set({ status: "connected", game: message.state });
		else if (message.type === "patches" && game)
			store.set({ game: applyPatches(game, message.patches) });
		else if (message.type === "result")
			pending.get(message.id)?.(message.error);
		else if (message.type === "notice") toast(message.message);
	};
}
connect();

/** Sends a mutation. Resolves after its patches arrive: true if it applied, false (with a toast) if not. */
export function send(mutation: Mutation): Promise<boolean> {
	if (socket.readyState !== WebSocket.OPEN) {
		toast("Not connected to the server");
		return Promise.resolve(false);
	}
	const id = ++lastId;
	socket.send(JSON.stringify({ id, mutation }));
	return new Promise((resolve) =>
		pending.set(id, (error) => {
			pending.delete(id);
			if (error) toast(error);
			resolve(!error);
		}),
	);
}

export const useStatus = () => store.use((s) => s.status);

/** Synced state, for use outside React. Only valid after the first snapshot. */
export const getGame = () => store.get().game as GameState;

/** Selects from synced state. Only use after the first snapshot. */
export const useGame = <T>(selector: (game: GameState) => T): T =>
	store.use((s) => selector(s.game as GameState));
