// The product's own name and mark (public/asset/AppIcon.svg, also the tab icon via app/icon.svg)
export const APP_NAME = "Workchime";

// Desktop app installer, offered from the logo menu in the top bar
export const DESKTOP_APP_URL = process.env.NEXT_PUBLIC_DESKTOP_APP_URL || "/download/Workchime-Setup.exe";

// Live voice/video/screen-share sessions, named like Google Meet / Teams "Meet now"
export const CALL = "Meet";
export const call = CALL.toLowerCase();
