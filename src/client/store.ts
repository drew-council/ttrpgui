// A minimal external store for React: `set` merges, `use` selects.
import { useSyncExternalStore } from "react";

export function createStore<T extends object>(initial: T) {
	let state = initial;
	const listeners = new Set<() => void>();
	const subscribe = (listener: () => void) => {
		listeners.add(listener);
		return () => listeners.delete(listener);
	};
	return {
		get: () => state,
		set(patch: Partial<T>) {
			state = { ...state, ...patch };
			for (const listener of listeners) listener();
		},
		subscribe,
		/** Selectors MUST return stable values (slices, not new objects). */
		use: <U>(selector: (state: T) => U) =>
			useSyncExternalStore(subscribe, () => selector(state)),
	};
}
