// The Electron preload's bridge (`src/preload.cjs`). Absent in a browser. Each part is there only where it applies.
import type { Found, Mode, Recents } from "../start.ts";

export type { Found, Mode };
export type StartRecents = {
	games: (Recents["games"][number] & {
		name: string;
		/** The parent folder, `~` for home. */
		path: string;
		missing: boolean;
	})[];
	servers: Recents["servers"];
	/** This computer, for telling another one where to join. */
	here: { host: string; port: number; joinAt: string };
};

declare global {
	interface Window {
		ttrpgui?: {
			/** Back to the start page. */
			back(): void;
			/** Only for a Game served here. */
			display?(open: boolean): void;
			onDisplay?(show: (open: boolean) => void): void;
			/** Only on the start page. `open` and `join` resolve to an error message, or navigate away. */
			start?: {
				recents(): Promise<StartRecents>;
				pickFolder(): Promise<{ dir: string; game: boolean } | undefined>;
				open(dir: string, how: Mode): Promise<string | undefined>;
				join(address: string, game?: string): Promise<string | undefined>;
				forget(key: string): Promise<void>;
				discover(): Promise<{ servers: Found[]; networks: string[] }>;
			};
		};
	}
}
