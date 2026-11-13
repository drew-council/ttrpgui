// `serve --game DIR [--port N] [--lan]` runs the server alone. `validate DIR` checks a Game.
import { networkInterfaces } from "node:os";
import { loadGame } from "./server/game.ts";
import { parseServeArgs, startServer } from "./server/server.ts";

const { positionals, gameDir, host, port } = parseServeArgs(
	process.argv.slice(2),
);
const [command, dir] = positionals;

if (command === "validate" && dir) {
	const { problems } = await loadGame(dir);
	for (const { file, field, message } of problems)
		console.log([file, field, message].filter(Boolean).join(": "));
	console.log(
		problems.length
			? `${problems.length} problem(s) in ${dir}`
			: `No problems in ${dir}`,
	);
	process.exitCode = problems.length ? 1 : 0;
} else if (command === "serve" && gameDir) {
	const { url } = await startServer({ gameDir, host, port });
	console.log(
		`Serving ${gameDir}\nControl: ${url}/control\nDisplay: ${url}/display`,
	);
	if (host === "0.0.0.0")
		for (const net of Object.values(networkInterfaces()).flat())
			if (net?.family === "IPv4" && !net.internal)
				console.log(
					`Display on the LAN: ${url.replace("localhost", net.address)}/display`,
				);
} else {
	console.error(
		"usage: cli.ts serve --game DIR [--port N] [--lan]\n       cli.ts validate DIR",
	);
	process.exitCode = 2;
}
