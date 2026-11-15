// The start page's memory (recent Games and servers) and LAN discovery, for the Electron main process.
// No Electron APIs, so unit tests import it.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, hostname, networkInterfaces } from "node:os";
import { join } from "node:path";

export const defaultPort = 7373;

/** How a Game was last opened: the control window here, or only the player display, served to the LAN. */
export type Mode = "control" | "display";
export type RecentGame = { dir: string; mode: Mode; at: number };
export type RecentServer = {
	url: string;
	game?: string;
	host?: string;
	at: number;
};
export type Recents = { games: RecentGame[]; servers: RecentServer[] };
/** A server that answered a probe. `self` when it runs on this computer. */
export type Found = { url: string; game: string; host: string; self: boolean };

const stateDir = join(
	process.env.XDG_STATE_HOME || join(homedir(), ".local/state"),
	"ttrpgui",
);
const recentsFile = join(stateDir, "recent.json");

/** Puts `entry` first, drops an older entry with the same key, and keeps at most `max`. */
export function remember<T>(
	list: T[],
	entry: T,
	key: (item: T) => string,
	max = 8,
) {
	return [entry, ...list.filter((item) => key(item) !== key(entry))].slice(
		0,
		max,
	);
}

/** The recents file, else a list seeded from the old `last-game` file. */
export async function readRecents(): Promise<Recents> {
	try {
		const { games, servers } = JSON.parse(await readFile(recentsFile, "utf8"));
		return { games: games ?? [], servers: servers ?? [] };
	} catch {
		const last = await readFile(join(stateDir, "last-game"), "utf8").catch(
			() => "",
		);
		const games: RecentGame[] = last.trim()
			? [{ dir: last.trim(), mode: "control", at: 0 }]
			: [];
		return { games, servers: [] };
	}
}

export async function updateRecents(change: (recents: Recents) => Recents) {
	const recents = change(await readRecents());
	await mkdir(stateDir, { recursive: true });
	await writeFile(recentsFile, `${JSON.stringify(recents, null, "\t")}\n`);
}

/** `igneous`, `igneous:7373`, or `http://igneous:7373/control` → `http://igneous:7373`. */
export function serverUrl(address: string) {
	const text = address.trim();
	const url = URL.parse(text.includes("://") ? text : `http://${text}`);
	if (!url?.hostname)
		throw new Error(
			"That is not an address. Try igneous or 192.168.1.20:7373.",
		);
	if (!url.port) url.port = String(defaultPort);
	return url.origin;
}

// Container bridges, VPNs, and other virtual interfaces, by name.
const virtual =
	/^(docker|br-|veth|virbr|vnet|podman|cni|flannel|lxc|lxd|incus|vmnet|vboxnet|tun|tap|wg|tailscale|zt|utun)/;
const privateIPv4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;

/** This computer's private IPv4 LAN addresses, skipping loopback, `/32`s, and virtual interfaces. */
export function lanAddresses(interfaces = networkInterfaces()) {
	return Object.entries(interfaces).flatMap(([name, nets]) =>
		virtual.test(name)
			? []
			: (nets ?? [])
					.filter(
						(net) =>
							net.family === "IPv4" &&
							!net.internal &&
							!net.cidr?.endsWith("/32") &&
							privateIPv4.test(net.address),
					)
					.map((net) => net.address),
	);
}

/** Where another computer joins a Game served here on `port`: `igneous:7373 or 192.168.1.20:7373`. */
export const joinAt = (port: number) =>
	[hostname(), ...lanAddresses()].map((a) => `${a}:${port}`).join(" or ");

/** Every `host:port` in the /24 of each address, once. */
export function probeTargets(addresses: string[], port = defaultPort) {
	const networks = [...new Set(addresses.map((a) => a.replace(/\.\d+$/, "")))];
	return networks.flatMap((network) =>
		Array.from({ length: 254 }, (_, i) => `${network}.${i + 1}:${port}`),
	);
}

/** Asks a server who it is, in under 700 ms. */
export async function serverInfo(url: string) {
	try {
		const res = await fetch(`${url}/info`, {
			signal: AbortSignal.timeout(700),
		});
		const info = await res.json();
		if (info.app === "ttrpgui")
			return { game: String(info.game), host: String(info.host) };
	} catch {}
}

/** Probes the LAN for servers on `port`, listing each once. `TTRPGUI_DISCOVER` (comma-separated
 * `host:port`s) replaces the targets, for tests. `networks` says where it looked. */
export async function discover(port = defaultPort) {
	const override = process.env.TTRPGUI_DISCOVER?.split(",").filter(Boolean);
	const addresses = lanAddresses();
	const targets = override ?? probeTargets(addresses, port);
	const answers = await Promise.all(
		targets.map(async (target) => {
			const url = `http://${target}`;
			const info = await serverInfo(url);
			return info && { url, ...info, self: info.host === hostname() };
		}),
	);
	const servers = new Map<string, Found>();
	for (const found of answers)
		if (found) {
			const key = `${found.host}:${new URL(found.url).port}`;
			if (!servers.has(key)) servers.set(key, found);
		}
	const networks = override ?? [
		...new Set(addresses.map((a) => a.replace(/\.\d+$/, ".0/24"))),
	];
	return { servers: [...servers.values()], networks };
}
