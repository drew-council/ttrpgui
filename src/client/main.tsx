import { createRoot } from "react-dom/client";
import { Control } from "./Control.tsx";
import { Display } from "./Display.tsx";
import { useStatus } from "./sync.ts";

const display = location.pathname.startsWith("/display");
// The display scales to any screen: one rem is 1/54 of its short side.
if (display)
	document.documentElement.classList.add("text-[length:calc(100vmin/54)]");

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
