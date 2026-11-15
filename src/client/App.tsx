import { Control } from "./Control.tsx";
import { Display } from "./Display.tsx";
import { useStatus } from "./sync.ts";

const display = location.pathname.startsWith("/display");

export function App() {
	const status = useStatus();
	const view = display ? <Display /> : <Control />;
	// data-status lets the test harness wait for the first snapshot.
	return (
		<div id="app" data-status={status}>
			{status === "connecting" ? null : view}
		</div>
	);
}
