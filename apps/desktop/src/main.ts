import { app, BrowserWindow, dialog } from "electron";
import log from "electron-log";
import { autoUpdater } from "electron-updater";
import { existsSync } from "node:fs";
import path from "node:path";

const WEB_URL = process.env.SKLADPRO_WEB_URL || "http://localhost:5173";

function createWindow() {
  const bundledCandidates = [
    path.resolve(app.getAppPath(), "web-dist/index.html"),
    path.resolve(process.resourcesPath, "app.asar/web-dist/index.html"),
    path.resolve(process.resourcesPath, "app/web-dist/index.html")
  ];
  const bundledWebIndex = bundledCandidates.find((x) => existsSync(x));
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.webContents.on("did-fail-load", (_event, code, desc, url) => {
    log.error(`Renderer load failed: code=${code} desc=${desc} url=${url}`);
  });

  if (bundledWebIndex) {
    log.info(`Loading bundled web index: ${bundledWebIndex}`);
    void win.loadFile(bundledWebIndex);
    return;
  }

  log.warn(`Bundled web index not found, fallback to URL: ${WEB_URL}`);
  void win.loadURL(WEB_URL);
}

function initAutoUpdate() {
  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;

  autoUpdater.on("update-available", () => {
    log.info("Update available");
  });

  autoUpdater.on("update-downloaded", async () => {
    const { response } = await dialog.showMessageBox({
      type: "info",
      title: "Обновление готово",
      message: "Новая версия загружена. Перезапустить приложение сейчас?",
      buttons: ["Перезапустить", "Позже"],
      defaultId: 0
    });

    if (response === 0) {
      autoUpdater.quitAndInstall();
    }
  });

  autoUpdater.on("error", (err) => {
    log.error("Auto update error:", err);
  });

  void autoUpdater.checkForUpdatesAndNotify();
}

app.whenReady().then(() => {
  createWindow();
  initAutoUpdate();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
