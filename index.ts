import { app, BrowserWindow } from "electron";

function createWindow() {
	const window = new BrowserWindow({ width: 1000, height: 700 });
	void window.loadFile("index.html");
}

void app.whenReady().then(() => {
	createWindow();

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createWindow();
		}
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});
