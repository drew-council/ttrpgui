// Exposes the few Electron-only abilities to the control window. Which ones depends on what it shows: the start page,
// a Game served here, or a Game on another machine, whose display window and Game belong to that machine.
// Each function passes on only its own parameters: an extra argument, such as a click event, cannot cross IPC.
const { contextBridge, ipcRenderer } = require("electron");

const mode = ipcRenderer.sendSync("mode");
const invoke = (...args) => ipcRenderer.invoke(...args);

contextBridge.exposeInMainWorld("ttrpgui", {
	back: () => invoke("back"),
	...(mode === "local" && {
		display: (open) => invoke("display", open),
		// Calls `show` with whether the display window is open: now, and on each change.
		onDisplay: (show) => {
			ipcRenderer.on("display", (_, open) => show(open));
			void invoke("display-open").then(show);
		},
	}),
	...(mode === "start" && {
		start: {
			recents: () => invoke("recents"),
			pickFolder: () => invoke("pick-folder"),
			open: (dir, how) => invoke("open", dir, how),
			join: (address, game) => invoke("join", address, game),
			forget: (key) => invoke("forget", key),
			discover: () => invoke("discover"),
		},
	}),
});
