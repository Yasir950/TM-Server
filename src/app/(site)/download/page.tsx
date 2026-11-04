import type { Metadata } from "next";
import Link from "next/link";
import { APP_NAME, DESKTOP_MAC_URL, DESKTOP_WIN_URL } from "@/lib/brand";
import { Icon } from "@/components/icons";
import { SIGN_IN, btnPrimary, btnOutline, Eyebrow, Mark, Check, CtaBand } from "@/components/site/Site";

export const metadata: Metadata = {
  title: "Download",
  description: `Get ${APP_NAME} for Windows and macOS, use it in your browser, or add it to your phone's home screen.`,
};

function WindowsLogo() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="#1c75bc" aria-hidden>
      <path d="M3 5.5 10.5 4.4v7.1H3zM11.5 4.3 21 3v8.5h-9.5zM3 12.5h7.5v7.1L3 18.5zM11.5 12.5H21V21l-9.5-1.3z" />
    </svg>
  );
}

function AppleLogo() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="#1f2430" aria-hidden>
      <path d="M16.37 12.6c-.02-2.17 1.78-3.22 1.86-3.27-1.01-1.48-2.59-1.69-3.15-1.71-1.34-.14-2.62.79-3.3.79-.68 0-1.73-.77-2.85-.75-1.47.02-2.82.85-3.58 2.17-1.53 2.65-.39 6.57 1.1 8.72.73 1.05 1.6 2.23 2.73 2.19 1.1-.04 1.51-.71 2.84-.71 1.32 0 1.7.71 2.85.69 1.18-.02 1.93-1.07 2.65-2.12.83-1.22 1.18-2.4 1.2-2.46-.03-.01-2.3-.88-2.32-3.5zM14.2 6.23c.6-.73 1.01-1.75.9-2.76-.87.04-1.92.58-2.54 1.31-.56.64-1.05 1.67-.92 2.66.97.08 1.96-.49 2.56-1.21z" />
    </svg>
  );
}

const desktop: [React.ReactNode, string, string, string, string[]][] = [
  [
    <WindowsLogo key="w" />,
    "Windows",
    "Windows 10 and 11",
    DESKTOP_WIN_URL,
    ["Opens at sign-in and stays in the tray", "Rings you for incoming calls, even when closed", "Native notifications"],
  ],
  [
    <AppleLogo key="m" />,
    "macOS",
    "Apple silicon and Intel",
    DESKTOP_MAC_URL,
    ["Lives in the menu bar when its window is closed", "Rings you for incoming calls, even when closed", "Native notifications"],
  ],
];

export default function Download() {
  return (
    <>
      <section className="bg-gradient-to-b from-tm-blue-light/70 to-white">
        <div className="mx-auto max-w-7xl px-4 pt-20 pb-10 text-center sm:px-6 sm:pt-24 lg:px-8">
          <Mark size={72} className="mx-auto shadow-lg" />
          <h1 className="mx-auto mt-8 max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">Get {APP_NAME} on every device</h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-zinc-600">
            Install the desktop app for the best experience, or use {APP_NAME} right in your browser. Your messages stay in sync everywhere.
          </p>
        </div>
      </section>

      <section className="mx-auto grid max-w-5xl gap-6 px-4 pb-20 sm:px-6 md:grid-cols-2 lg:px-8">
        {desktop.map(([logo, name, req, href, points]) => (
          <div key={name} className="flex flex-col rounded-3xl border border-zinc-200 bg-white p-8 shadow-sm">
            {logo}
            <h2 className="mt-6 text-2xl font-bold">{APP_NAME} for {name}</h2>
            <p className="mt-1 text-sm text-zinc-500">{req}</p>
            <ul className="mt-6 flex-1 space-y-3 text-[15px]">
              {points.map((p) => (
                <Check key={p}>{p}</Check>
              ))}
            </ul>
            <a href={href} className={`${btnPrimary} mt-8 w-full py-3.5 text-base`} download>
              <Icon name="download" size={18} />
              Download for {name}
            </a>
          </div>
        ))}
      </section>

      <section id="web" className="scroll-mt-16 bg-tm-surface py-20">
        <div className="mx-auto grid max-w-5xl gap-12 px-4 sm:px-6 md:grid-cols-2 lg:px-8">
          <div>
            <Eyebrow>In the browser</Eyebrow>
            <h2 className="mt-3 text-3xl font-bold tracking-tight">Nothing to install</h2>
            <p className="mt-4 leading-7 text-zinc-600">
              {APP_NAME} runs in any modern browser, including Chrome, Edge, Firefox and Safari. Turn on notifications from the sidebar and you&apos;ll hear
              about new messages even when the tab is closed.
            </p>
            <Link href={SIGN_IN} className={`${btnOutline} mt-6`}>
              Open {APP_NAME} in your browser
            </Link>
          </div>
          <div>
            <Eyebrow>On your phone</Eyebrow>
            <h2 className="mt-3 text-3xl font-bold tracking-tight">Add it to your home screen</h2>
            <ol className="mt-5 space-y-4 text-zinc-600">
              {[
                `Open ${APP_NAME} in Safari (iPhone) or Chrome (Android) and sign in.`,
                "Tap Share, then Add to Home Screen (iPhone), or open the menu and choose Install app (Android).",
                "Launch it from your home screen and tap Enable notifications, so messages and calls reach you.",
              ].map((s, i) => (
                <li key={i} className="flex gap-4">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-tm-blue text-sm font-semibold text-white">{i + 1}</span>
                  <span className="pt-0.5 leading-7">{s}</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
      </section>

      <CtaBand />
    </>
  );
}
