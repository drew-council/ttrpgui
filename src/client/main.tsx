import { createRoot } from "react-dom/client";
import { applyZoom } from "./ui.ts";

applyZoom();
const root = createRoot(document.getElementById("root") as HTMLElement);
// The start page and the waiting page run without a Game server, so they load none of the synced app.
const path = location.pathname;
if (path === "/start" && window.ttrpgui?.start)
	void import("./Start.tsx").then(({ Start }) => root.render(<Start />));
else if (path === "/waiting")
	void import("./Start.tsx").then(({ Waiting }) => root.render(<Waiting />));
else void import("./App.tsx").then(({ App }) => root.render(<App />));
