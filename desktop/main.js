// Workchime desktop: a native window around the hosted web app.
// Closing the window keeps it running in the tray, so messages and calls still arrive (Electron has no Web Push).
const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, shell, session, desktopCapturer, systemPreferences } = require("electron");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const APP_URL = process.env.WORKCHIME_URL || "https://workchime.vercel.app/app";
const ORIGIN = new URL(APP_URL).origin;
// Sign-in links from the website: workchime://auth?state=…&token_hash=…
const PROTOCOL = "workchime";

let win;
let tray;
let quitting = false;
// One-time sign-in token from the website, until the web app takes it (preload.js takeAuth)
let pendingToken = null;

// Started by the OS at login: stay in the tray until opened
const startHidden = process.argv.includes("--hidden") || (process.platform === "darwin" && app.getLoginItemSettings().wasOpenedAsHidden);

if (!app.requestSingleInstanceLock()) app.quit();
else {
  // Windows and Linux deliver sign-in links as an argument to a second launch
  app.on("second-instance", (_e, argv) => {
    const link = argv.find((a) => a.startsWith(`${PROTOCOL}://`));
    if (link) handleLink(link);
    else showWindow();
  });
  // macOS delivers them as an event, possibly before the app is ready
  app.on("open-url", (e, url) => {
    e.preventDefault();
    handleLink(url);
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
  ipcMain.on("sign-in", (e) => fromApp(e) && beginSignIn());
  ipcMain.on("badge", (e, b) => fromApp(e) && setBadge(b));
  ipcMain.handle("take-auth", (e) => {
    if (!fromApp(e)) return null;
    const token = pendingToken;
    pendingToken = null;
    return token;
  });

  // Unpackaged (npm start) runs through electron.exe, which needs the app path to relaunch with
  if (process.defaultApp) app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
  else app.setAsDefaultProtocolClient(PROTOCOL);

  createTray();
  createWindow();
  app.on("activate", () => showWindow());

  // Launched by a sign-in link while the app wasn't running (Windows)
  const link = process.argv.find((a) => a.startsWith(`${PROTOCOL}://`));
  if (link) handleLink(link);
}

// Browser sign-in, like Slack: the website (src/app/desktop-auth) signs the user in and sends back a one-time token.
// The state is kept on disk so the link still works if the app was quit and is relaunched by it.
const stateFile = () => path.join(app.getPath("userData"), "sign-in-state.json");
const SIGN_IN_WINDOW = 30 * 60_000;

function beginSignIn() {
  const state = crypto.randomBytes(24).toString("hex");
  fs.writeFileSync(stateFile(), JSON.stringify({ state, at: Date.now() }));
  shell.openExternal(`${ORIGIN}/desktop-auth?state=${state}`);
}

function handleLink(url) {
  let link;
  try {
    link = new URL(url);
  } catch {
    return;
  }
  if (link.protocol !== `${PROTOCOL}:` || link.hostname !== "auth") return;
  let saved = null;
  try {
    saved = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
  } catch {}
  const token = link.searchParams.get("token_hash");
  // Only the sign-in this app started, so a link from someone else can't sign it into their account
  if (!saved || !token || link.searchParams.get("state") !== saved.state || Date.now() - saved.at > SIGN_IN_WINDOW) return;
  fs.rmSync(stateFile(), { force: true });
  pendingToken = token;
  // Before the window exists the web app takes the token when it loads
  if (!win) return;
  showWindow();
  win.webContents.send("auth");
}

// Unread badge from the web app (preload.js badge): kept so it can be reapplied when the window comes back from the tray
let badge = { count: 0, dot: false, icon: null };

function setBadge(b) {
  const count = Number.isInteger(b?.count) && b.count > 0 ? Math.min(b.count, 9999) : 0;
  const dot = !count && b?.dot === true;
  const icon = typeof b?.icon === "string" && b.icon.startsWith("data:image/png;base64,") && b.icon.length < 100_000 ? b.icon : null;
  badge = { count, dot, icon };
  applyBadge();
}

function applyBadge() {
  const { count, dot, icon } = badge;
  const label = count ? `${count} unread` : dot ? "New messages" : "";
  if (process.platform === "darwin") app.dock?.setBadge(count ? (count > 99 ? "99+" : String(count)) : dot ? "•" : "");
  // Linux: launchers that support it (Unity, KDE); a dot has no equivalent
  else if (process.platform === "linux") app.setBadgeCount(count);
  // Windows: an overlay on the taskbar button, which exists only while the window is shown
  else if (win && !win.isDestroyed()) win.setOverlayIcon(icon && (count || dot) ? nativeImage.createFromDataURL(icon) : null, label);
  tray?.setToolTip(label ? `Workchime (${label})` : "Workchime");
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
  win.webContents.setWindowOpenHandler(({ url, frameName }) => {
    // The call popped out of the app (Huddle.tsx openCallWindow): a small window that stays on top
    if (frameName === "tm-call" && (url === "" || url === "about:blank"))
      return {
        action: "allow",
        overrideBrowserWindowOptions: { width: 440, height: 240, minWidth: 320, minHeight: 180, alwaysOnTop: true, autoHideMenuBar: true, title: "Workchime call", backgroundColor: "#ffffff" },
      };
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
  // Hiding to the tray removes the taskbar button, and its overlay with it
  win.on("show", applyBadge);
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
