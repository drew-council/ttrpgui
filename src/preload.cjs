// Exposes the few Electron-only abilities to the control page.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ttrpgui", {
	openGame: () => ipcRenderer.invoke("open-game"),
	display: (open) => ipcRenderer.invoke("display", open),
});
