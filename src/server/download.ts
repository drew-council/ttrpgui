// Downloads an Atmosphere's links with yt-dlp into its directory. Runs outside the mutation queue: the files
// appear through the normal reload. Partial downloads stay in dot directories, which the Game ignores.
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Atmosphere } from "../shared/state.ts";

const running = new Set<string>();

/** Whether a download into `dir` is running. */
export const downloading = (dir: string) => running.has(dir);

/** Fetches what is missing: the wallpaper unless one exists, and tracks not yet in `music/`. */
export async function download(
	dir: string,
	{ settings, wallpaper }: Atmosphere,
	extraArgs: string[] = [],
) {
	running.add(dir);
	try {
		if (settings.wallpaper && !wallpaper)
			await ytDlp(dir, [
				"--no-playlist",
				// Video only, since it plays muted. VP9 in WebM plays in any Chromium. SDR only: HDR video can push the
				// compositor into HDR mode. `=?` keeps sites that do not report a dynamic range.
				...[
					"-f",
					"bv*[height<=1080][ext=webm][dynamic_range=?SDR]/bv*[height<=1080][dynamic_range=?SDR]",
				],
				...["--download-sections", `*${settings.wallpaper_section ?? "0-120"}`],
				...["-o", "wallpaper.%(ext)s"],
				...extraArgs,
				settings.wallpaper,
			]);
		if (settings.music)
			await ytDlp(join(dir, "music"), [
				"--yes-playlist",
				...["-f", "bestaudio[acodec=opus]/bestaudio"],
				...["-x", "--audio-format", "opus"],
				"--write-thumbnail",
				"--no-write-playlist-metafiles",
				...["-o", "%(artist,channel)s - %(title)s [%(id)s].%(ext)s"],
				...extraArgs,
				settings.music,
			]);
	} finally {
		running.delete(dir);
	}
}

/** Runs yt-dlp into `dir`, rejecting with its last error line. */
async function ytDlp(dir: string, args: string[]) {
	const temp = join(dir, ".download");
	const child = spawn(
		"yt-dlp",
		["--no-progress", "-P", dir, "-P", `temp:${temp}`, ...args],
		{ stdio: ["ignore", "ignore", "pipe"] },
	);
	let errors = "";
	child.stderr.on("data", (data) => {
		errors = (errors + data).slice(-4000);
	});
	const code = await new Promise<number | null>((resolve, reject) => {
		child.on("error", (e: NodeJS.ErrnoException) =>
			reject(e.code === "ENOENT" ? new Error("yt-dlp is not on PATH") : e),
		);
		child.on("close", resolve);
	});
	await rm(temp, { recursive: true, force: true });
	if (code !== 0) {
		const lines = errors.trim().split("\n");
		const last = lines.findLast((l) => l.startsWith("ERROR:")) ?? lines.at(-1);
		throw new Error(
			last?.replace(/^ERROR: /, "") || `yt-dlp exited with ${code}`,
		);
	}
}
