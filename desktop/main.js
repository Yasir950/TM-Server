// Workchime desktop: a native window around the hosted web app.
// Closing the window keeps it running in the tray, so messages and calls still arrive (Electron has no Web Push).
const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, shell, session, desktopCapturer, systemPreferences } = require("electron");
const fs = require("fs");
const path = require("path");

const APP_URL = process.env.WORKCHIME_URL || "https://workchime.vercel.app/";
const ORIGIN = new URL(APP_URL).origin;

let win;
let tray;
let quitting = false;

// Started by the OS at login: stay in the tray until opened
const startHidden = process.argv.includes("--hidden") || (process.platform === "darwin" && app.getLoginItemSettings().wasOpenedAsHidden);

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => showWindow());
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

  // Open at login by default, once; the tray menu turns it off
  const marker = path.join(app.getPath("userData"), "login-item-set");
  if (app.isPackaged && !fs.existsSync(marker)) {
    setOpenAtLogin(true);
    fs.writeFileSync(marker, "");
  }

  // From the web app (preload.js): a notification was clicked, or a call is ringing
  const fromApp = (e) => e.senderFrame && new URL(e.senderFrame.url).origin === ORIGIN;
  ipcMain.on("show", (e) => fromApp(e) && showWindow());
  ipcMain.on("ring", (e) => {
    if (!fromApp(e)) return;
    showWindow();
    win.flashFrame(true);
  });

  createTray();
  createWindow();
  app.on("activate", () => showWindow());
}

function setOpenAtLogin(openAtLogin) {
  app.setLoginItemSettings({ openAtLogin, openAsHidden: true, args: ["--hidden"] });
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
    show: !startHidden,
    // Keep realtime and ring timers running at full speed while hidden in the tray
    webPreferences: { contextIsolation: true, sandbox: true, backgroundThrottling: false, preload: path.join(__dirname, "preload.js") },
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

  // Closing hides to the tray; Quit from the tray (or the OS) really exits
  win.on("close", (e) => {
    if (quitting) return;
    e.preventDefault();
    win.hide();
  });
  win.on("focus", () => win.flashFrame(false));
  win.on("closed", () => (win = null));
}

function showWindow() {
  if (!win) return createWindow();
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(__dirname, "tray.png")).resize({ width: process.platform === "darwin" ? 18 : 16 });
  tray = new Tray(icon);
  tray.setToolTip("Workchime");
  const menu = () =>
    Menu.buildFromTemplate([
      { label: "Open Workchime", click: showWindow },
      {
        label: "Open at login",
        type: "checkbox",
        checked: app.getLoginItemSettings().openAtLogin,
        enabled: app.isPackaged,
        click: (item) => setOpenAtLogin(item.checked),
      },
      { type: "separator" },
      { label: "Quit Workchime", click: () => app.quit() },
    ]);
  tray.on("click", showWindow);
  // Rebuilt on open so the login checkbox reflects changes made in OS settings
  tray.on("right-click", () => tray.popUpContextMenu(menu()));
  if (process.platform !== "win32") tray.setContextMenu(menu());
}

app.on("before-quit", () => (quitting = true));
app.on("window-all-closed", () => process.platform !== "darwin" && app.quit());
