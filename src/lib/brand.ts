// The product's own name and mark (public/asset/AppIcon.svg, also the tab icon via app/icon.svg)
export const APP_NAME = "Workchime";

// Desktop app installers (built by .github/workflows/desktop.yml), offered from the logo menu in the top bar
export const DESKTOP_WIN_URL = process.env.NEXT_PUBLIC_DESKTOP_WIN_URL || "/download/Workchime-Setup.exe";
export const DESKTOP_MAC_URL = process.env.NEXT_PUBLIC_DESKTOP_MAC_URL || "/download/Workchime.dmg";

// Desktop builds before this one have no auto-updater, so the web app asks them to install the new version once.
// The links are off-site on purpose: old builds open those in the browser, but same-site links inside the app window.
export const DESKTOP_AUTO_UPDATE_SINCE = [1, 5, 0];
export const DESKTOP_RELEASE = "https://github.com/Yasir950/TM-Server/releases/download/desktop-latest";

// Dark app chrome shared by the rail and the top bar
export const RAIL = "#0f2d4d";

// Live voice/video/screen-share sessions, named like Google Meet / Teams "Meet now"
export const CALL = "Meet";
export const call = CALL.toLowerCase();
