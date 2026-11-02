// Workchime desktop: a native window around the hosted web app
const { app, BrowserWindow, shell, session, desktopCapturer, systemPreferences } = require("electron");

const APP_URL = process.env.WORKCHIME_URL || "https://workchime.vercel.app/";
const ORIGIN = new URL(APP_URL).origin;

let win;

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(start);
}

// Windows notifications need an AppUserModelID matching the installer
app.setAppUserModelId("app.workchime.desktop");

async function start() {
  const ses = session.defaultSession;
  // Lets the web app hide its "Download desktop app" button
  ses.setUserAgent(`${ses.getUserAgent()} WorkchimeDesktop/${app.getVersion()}`);

  // Mic, camera, notifications and screen share for our own origin only
  ses.setPermissionRequestHandler((wc, permission, cb) => {
    const ok = new URL(wc.getURL()).origin === ORIGIN;
    cb(ok && ["media", "notifications", "display-capture", "clipboard-sanitized-write", "fullscreen"].includes(permission));
  });

  // getDisplayMedia: macOS shows its own picker; elsewhere share the primary screen
  ses.setDisplayMediaRequestHandler(
    async (_req, cb) => {
      const [screen] = await desktopCapturer.getSources({ types: ["screen"] });
      cb(screen ? { video: screen } : {});
    },
    { useSystemPicker: true }
  );

  if (process.platform === "darwin") {
    systemPreferences.askForMediaAccess("microphone").catch(() => {});
    systemPreferences.askForMediaAccess("camera").catch(() => {});
  }

  createWindow();
  app.on("activate", () => BrowserWindow.getAllWindows().length === 0 && createWindow());
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 480,
    minHeight: 400,
    title: "Workchime",
    backgroundColor: "#0f2d4d",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true },
  });
  win.loadURL(APP_URL);

  // Links leaving the app open in the default browser
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (new URL(url).origin === ORIGIN) return { action: "allow" };
    shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (new URL(url).origin !== ORIGIN) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });

  // Offline or server down: retry rather than leave a blank window
  win.webContents.on("did-fail-load", (_e, code, _desc, _url, isMain) => {
    if (isMain && code !== -3) setTimeout(() => win && !win.isDestroyed() && win.loadURL(APP_URL), 5000);
  });

  win.on("closed", () => (win = null));
}

app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());
