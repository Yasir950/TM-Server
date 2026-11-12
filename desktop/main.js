// Workchime desktop: a native window around the hosted web app.
// Closing the window keeps it running in the tray, so messages and calls still arrive (Electron has no Web Push).
const { app, BrowserWindow, Menu, Tray, clipboard, ipcMain, nativeImage, shell, session, desktopCapturer, systemPreferences, screen, powerMonitor } = require("electron");
const { autoUpdater } = require("electron-updater");
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
// ...or relaunched by an update installed while it was in the tray (installUpdateWhenIdle)
const startHidden = process.argv.includes("--hidden") || (process.platform === "darwin" && app.getLoginItemSettings().wasOpenedAsHidden) || takeHiddenMarker();

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

  // getDisplayMedia: macOS 15+ shows its own picker; elsewhere our picker (picker.html) lists screens and windows
  ses.setDisplayMediaRequestHandler(
    async (_req, cb) => {
      try {
        const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 400, height: 225 }, fetchWindowIcons: true });
        const chosen = await pickSource(sources.filter((s) => s.name), BrowserWindow.getFocusedWindow() ?? win);
        cb(chosen ? { video: chosen } : {});
      } catch {
        cb({});
      }
    },
    { useSystemPicker: true }
  );
  ipcMain.handle("picker-sources", (e) => (picking && e.sender === picking.wc ? picking.list : []));
  ipcMain.on("picker-choice", (e, id) => picking && e.sender === picking.wc && picking.finish(id));

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
  ipcMain.on("ring", (e, info) => {
    if (!fromApp(e) || !win) return;
    // A web app from before the incoming-call window: bring the app up so its dialog is seen
    if (!info || typeof info !== "object") {
      showWindow();
      return win.flashFrame(true);
    }
    win.flashFrame(true);
    // The app is in front, showing its own incoming-call dialog
    if (win.isVisible() && win.isFocused()) return;
    showRing(info);
  });
  ipcMain.on("ring-end", (e) => fromApp(e) && closeRing());
  ipcMain.handle("ring-info", (e) => (ringWin && e.sender === ringWin.webContents ? ringInfo : null));
  ipcMain.on("ring-action", (e, action) => {
    if (!ringWin || e.sender !== ringWin.webContents || !["answer", "decline"].includes(action)) return;
    closeRing();
    if (action === "answer") showWindow();
    win?.webContents.send("ring-action", action);
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

  // Every window (main, call, picker): a right-click menu like a browser's, and outside links in the default browser
  app.on("web-contents-created", (_e, wc) => {
    wc.on("context-menu", (_ev, p) => contextMenu(wc, p));
    if (wc.getType() !== "window") return;
    wc.on("did-create-window", (child) => {
      child.webContents.setWindowOpenHandler(openHandler);
      child.webContents.on("will-navigate", (ev, url) => {
        if (new URL(url).origin === ORIGIN) return;
        ev.preventDefault();
        if (/^(https?|mailto|tel):/.test(url)) shell.openExternal(url);
      });
    });
  });

  createTray();
  createWindow();
  app.on("activate", () => showWindow());
  startUpdates();

  // Launched by a sign-in link while the app wasn't running (Windows)
  const link = process.argv.find((a) => a.startsWith(`${PROTOCOL}://`));
  if (link) handleLink(link);
}

// Incoming call, like Slack: a small window of its own in the middle of the screen, on top of everything,
// shown even while the app is hidden in the tray. The web app closes it when the ring ends (ring-end).
let ringWin = null;
let ringInfo = null;
let ringTimer = null;

function showRing(info) {
  closeRing();
  const text = (v, max) => (typeof v === "string" ? v.slice(0, max) : "");
  ringInfo = {
    caller: text(info.caller, 120) || "Someone",
    where: text(info.where, 160),
    avatar: typeof info.avatar === "string" && /^https:\/\//.test(info.avatar) ? info.avatar : null,
    meeting: info.meeting === true,
  };
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const width = 340;
  const height = 360;
  const w = new BrowserWindow({
    width,
    height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    title: "Incoming call",
    backgroundColor: "#ffffff",
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, "ring-preload.js") },
  });
  w.setAlwaysOnTop(true, "screen-saver");
  w.once("ready-to-show", () => w.show());
  w.on("closed", () => ringWin === w && (ringWin = null));
  w.loadFile(path.join(__dirname, "ring.html"));
  ringWin = w;
  // In case the web app never says the ring ended (it rings for 30 seconds)
  ringTimer = setTimeout(closeRing, 45_000);
}

function closeRing() {
  clearTimeout(ringTimer);
  if (ringWin && !ringWin.isDestroyed()) ringWin.close();
  ringWin = null;
}

// The open screen-share picker: its window, what it lists, and how it answers
let picking = null;

// A small window over the one that asked, like Chrome's "Choose what to share"; resolves with the source or null
function pickSource(sources, parent) {
  picking?.finish(null);
  return new Promise((resolve) => {
    const picker = new BrowserWindow({
      parent: parent && !parent.isDestroyed() ? parent : undefined,
      modal: process.platform !== "darwin" && !!parent,
      width: 780,
      height: 600,
      minWidth: 520,
      minHeight: 420,
      title: "Choose what to share",
      autoHideMenuBar: true,
      minimizable: false,
      maximizable: false,
      backgroundColor: "#ffffff",
      show: false,
      webPreferences: { contextIsolation: true, sandbox: true, preload: path.join(__dirname, "picker-preload.js") },
    });
    const list = sources.map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.id.startsWith("screen:") ? "screen" : "window",
      thumb: s.thumbnail.isEmpty() ? null : s.thumbnail.toDataURL(),
      icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
    }));
    // Kept up front: by the "closed" event the window is destroyed and reading picker.webContents throws
    const wc = picker.webContents;
    const finish = (id) => {
      if (picking?.wc !== wc) return;
      picking = null;
      resolve(sources.find((s) => s.id === id) ?? null);
      if (!picker.isDestroyed()) picker.close();
    };
    picking = { wc, list, finish };
    picker.on("closed", () => finish(null));
    picker.once("ready-to-show", () => picker.show());
    picker.loadFile(path.join(__dirname, "picker.html"));
  });
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

// Updates: new versions come from GitHub Releases (package.json build.publish, `npm run release:win`).
// They download in the background and install by themselves, with no prompt: when the app is quit, or sooner
// once nobody is using it (no call, ring or share picker open, and the window hidden or the computer idle).
// The web app is loaded from the server, so it is also reloaded once a day while idle to pick up new deploys.
const UPDATE_CHECK_EVERY = 4 * 3600_000;
const IDLE_CHECK_EVERY = 5 * 60_000;
const IDLE_SECONDS = 10 * 60;
const RELOAD_EVERY = 24 * 3600_000;
let updateReady = false;
let loadedAt = Date.now();

// Function declarations, since startHidden needs them before the code above has run
function hiddenMarker() {
  return path.join(app.getPath("userData"), "relaunch-hidden");
}

function takeHiddenMarker() {
  try {
    fs.rmSync(hiddenMarker());
    return true;
  } catch {
    return false;
  }
}

function startUpdates() {
  setInterval(whenIdle, IDLE_CHECK_EVERY);
  if (!app.isPackaged) return;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("error", () => {});
  autoUpdater.on("update-downloaded", () => {
    updateReady = true;
    whenIdle();
  });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  check();
  setInterval(check, UPDATE_CHECK_EVERY);
}

// In a call (its own window, or in the app with sound playing), ringing, or choosing a screen to share
function busy() {
  if (ringWin || picking) return true;
  if (BrowserWindow.getAllWindows().some((w) => w !== win && !w.isDestroyed())) return true;
  return !!win && !win.isDestroyed() && win.webContents.isCurrentlyAudible();
}

function whenIdle() {
  if (busy()) return;
  const hidden = !win || win.isDestroyed() || !win.isVisible() || win.isMinimized();
  if (!hidden && powerMonitor.getSystemIdleTime() < IDLE_SECONDS) return;
  if (updateReady) return installUpdate(hidden);
  if (win && !win.isDestroyed() && Date.now() - loadedAt > RELOAD_EVERY) {
    loadedAt = Date.now();
    win.loadURL(APP_URL);
  }
}

function installUpdate(hidden) {
  if (hidden) {
    try {
      fs.writeFileSync(hiddenMarker(), "");
    } catch {}
  }
  quitting = true;
  // Silent install, then start the new version
  autoUpdater.quitAndInstall(true, true);
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
    // Ringtones play even when the app started hidden at login and was never clicked
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
      autoplayPolicy: "no-user-gesture-required",
      preload: path.join(__dirname, "preload.js"),
    },
  });
  win.loadURL(APP_URL);
  win.webContents.on("did-finish-load", () => (loadedAt = Date.now()));

  win.webContents.setWindowOpenHandler(openHandler);
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

// Links leaving the app open in the default browser
function openHandler({ url, frameName }) {
  let origin = null;
  try {
    origin = new URL(url).origin;
  } catch {}
  // The call in its own window (Huddle.tsx openCallWindow), like a Slack huddle window
  if (frameName === "tm-call" && origin === ORIGIN)
    return {
      action: "allow",
      overrideBrowserWindowOptions: { width: 520, height: 420, minWidth: 360, minHeight: 300, autoHideMenuBar: true, title: "Workchime call", backgroundColor: "#ffffff" },
    };
  if (origin === ORIGIN) return { action: "allow" };
  if (/^(https?|mailto|tel):/.test(url)) shell.openExternal(url);
  return { action: "deny" };
}

// Right-click: spelling suggestions, cut/copy/paste, links and images
function contextMenu(wc, p) {
  const items = [];
  for (const s of p.dictionarySuggestions ?? []) items.push({ label: s, click: () => wc.replaceMisspelling(s) });
  if (p.misspelledWord) {
    if (!items.length) items.push({ label: "No suggestions", enabled: false });
    items.push({ label: "Add to dictionary", click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) }, { type: "separator" });
  }
  if (p.linkURL && /^(https?|mailto):/.test(p.linkURL)) {
    items.push({ label: "Open link in browser", click: () => shell.openExternal(p.linkURL) }, { label: "Copy link", click: () => clipboard.writeText(p.linkURL) }, { type: "separator" });
  }
  if (p.mediaType === "image" && p.srcURL) {
    items.push({ label: "Copy image", click: () => wc.copyImageAt(p.x, p.y) }, { label: "Save image as…", click: () => wc.downloadURL(p.srcURL) }, { type: "separator" });
  }
  const f = p.editFlags;
  if (p.isEditable) items.push({ role: "undo", enabled: f.canUndo }, { role: "redo", enabled: f.canRedo }, { type: "separator" }, { role: "cut", enabled: f.canCut });
  if (p.isEditable || p.selectionText) items.push({ role: "copy", enabled: f.canCopy });
  if (p.isEditable) items.push({ role: "paste", enabled: f.canPaste }, { role: "selectAll" });
  while (items.length && items[items.length - 1].type === "separator") items.pop();
  if (items.length) Menu.buildFromTemplate(items).popup({ window: BrowserWindow.fromWebContents(wc) ?? undefined });
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
