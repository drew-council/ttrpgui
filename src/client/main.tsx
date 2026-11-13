import { createRoot } from "react-dom/client";
import { Control } from "./Control.tsx";
import { Display } from "./Display.tsx";
import { useStatus } from "./sync.ts";
import { applyZoom } from "./ui.ts";

const display = location.pathname.startsWith("/display");
applyZoom();

function App() {
	const status = useStatus();
	const view = display ? <Display /> : <Control />;
	// data-status lets the test harness wait for the first snapshot.
	return (
		<div id="app" data-status={status}>
			{status === "connecting" ? null : view}
		</div>
	);
}

createRoot(document.getElementById("root") as HTMLElement).render(<App />);
