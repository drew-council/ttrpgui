// Exposes the few Electron-only abilities to the control page.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ttrpgui", {
	openGame: () => ipcRenderer.invoke("open-game"),
	display: (open) => ipcRenderer.invoke("display", open),
	// Calls `show` with whether the display window is open: now, and on each change.
	onDisplay: (show) => {
		ipcRenderer.on("display", (_, open) => show(open));
		void ipcRenderer.invoke("display-open").then(show);
	},
});
