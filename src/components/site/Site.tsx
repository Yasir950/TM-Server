import Link from "next/link";
import { APP_NAME } from "@/lib/brand";
import { Icon, type IconName } from "@/components/icons";

// Public website chrome (app/(site)): server components only, so the marketing pages ship no app code

// Sign-in and sign-up live in the app at "/"; these params open the form instead of bouncing back here
export const SIGN_IN = "/app?signin";
export const SIGN_UP = "/app?signup";

export const NAVY = "#0f2d4d";

// `animated` has the three dots take turns swapping corners
export function Mark({ size = 32, className = "", animated }: { size?: number; className?: string; animated?: boolean }) {
  const src = animated ? "/asset/AppIconAnimated.svg" : "/asset/AppIcon.svg";
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" width={size} height={size} className={`shrink-0 rounded-[25%] ${className}`} />;
}

export function Wordmark({ light }: { light?: boolean }) {
  return (
    <Link href="/" className="inline-flex items-center gap-2.5" aria-label={`${APP_NAME} home`}>
      <Mark size={32} className="shadow-sm" animated />
      <span className={`text-xl font-semibold tracking-[-0.02em] ${light ? "text-white" : "text-zinc-900"}`}>{APP_NAME}</span>
    </Link>
  );
}

const nav: [string, string][] = [
  ["Features", "/features"],
  ["Pricing", "/pricing"],
  ["Enterprise", "/contact?topic=enterprise"],
  ["Download", "/download"],
];

export const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-tm-blue px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-tm-blue-dark active:scale-[0.98]";
export const btnGreen =
  "inline-flex items-center justify-center gap-2 rounded-xl bg-tm-green px-6 py-3.5 text-base font-semibold text-white shadow-lg shadow-black/10 transition hover:brightness-95 active:scale-[0.98]";
export const btnOutlineLight =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-white/30 px-6 py-3.5 text-base font-semibold text-white transition hover:bg-white/10 active:scale-[0.98]";
export const btnOutline =
  "inline-flex items-center justify-center gap-2 rounded-xl border border-zinc-300 bg-white px-5 py-3 text-sm font-semibold text-zinc-800 transition hover:border-zinc-400 hover:bg-zinc-50 active:scale-[0.98]";

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200/70 bg-white/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-8 px-4 sm:px-6 lg:px-8">
        <Wordmark />
        <nav className="hidden items-center gap-7 text-[15px] font-medium text-zinc-700 md:flex">
          {nav.map(([label, href]) => (
            <Link key={label} href={href} className="transition hover:text-tm-blue">
              {label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto hidden items-center gap-3 md:flex">
          <Link href={SIGN_IN} className="px-3 py-2 text-[15px] font-semibold text-zinc-800 transition hover:text-tm-blue">
            Sign in
          </Link>
          <Link href={SIGN_UP} className={btnPrimary}>
            Get started
          </Link>
        </div>
        {/* Phones: a disclosure menu, no client JS needed */}
        <details className="group relative ml-auto md:hidden">
          <summary className="flex h-10 w-10 list-none items-center justify-center rounded-lg text-zinc-700 hover:bg-zinc-100 [&::-webkit-details-marker]:hidden" aria-label="Menu">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
              <path d="M4 7h16M4 12h16M4 17h16" className="group-open:hidden" />
              <path d="M6 6l12 12M18 6 6 18" className="hidden group-open:block" />
            </svg>
          </summary>
          <div className="fixed inset-x-0 top-16 border-b border-zinc-200 bg-white px-4 pt-2 pb-5 shadow-lg">
            {nav.map(([label, href]) => (
              <Link key={label} href={href} className="block rounded-lg px-3 py-3 text-base font-medium text-zinc-800 hover:bg-zinc-50">
                {label}
              </Link>
            ))}
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Link href={SIGN_IN} className={btnOutline}>
                Sign in
              </Link>
              <Link href={SIGN_UP} className={btnPrimary}>
                Get started
              </Link>
            </div>
          </div>
        </details>
      </div>
    </header>
  );
}

const footer: [string, [string, string][]][] = [
  [
    "Product",
    [
      ["Features", "/features"],
      ["Channels & threads", "/features#messaging"],
      ["Meet", "/features#meet"],
      ["Canvas & clips", "/features#collaborate"],
    ],
  ],
  [
    "Platform",
    [
      ["Workflows", "/features#automate"],
      ["Webhooks & Events API", "/features#automate"],
      ["Admin & security", "/features#admin"],
      ["Pricing", "/pricing"],
      ["Contact sales", "/contact?topic=enterprise"],
    ],
  ],
  [
    "Get the app",
    [
      ["Windows", "/download"],
      ["macOS", "/download"],
      ["Web & mobile", "/download#web"],
      ["Sign in", SIGN_IN],
    ],
  ],
];

export function Footer() {
  return (
    <footer className="border-t border-zinc-200 bg-white">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.4fr_repeat(3,1fr)] lg:px-8">
        <div>
          <Wordmark />
          <p className="mt-4 max-w-xs text-sm leading-6 text-zinc-500">
            Channels, messages, meetings and shared canvases for teams that want to move faster together.
          </p>
        </div>
        {footer.map(([title, links]) => (
          <div key={title}>
            <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
            <ul className="mt-4 space-y-3 text-sm text-zinc-600">
              {links.map(([label, href]) => (
                <li key={label}>
                  <Link href={href} className="transition hover:text-tm-blue">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-zinc-100">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-xs text-zinc-500 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
          <span>© 2026 {APP_NAME}. All rights reserved.</span>
          <span>Made for teams that work together.</span>
        </div>
      </div>
    </footer>
  );
}

// Section heading used across the site
export function Eyebrow({ children, light }: { children: React.ReactNode; light?: boolean }) {
  return <p className={`text-sm font-semibold tracking-wide uppercase ${light ? "text-tm-green" : "text-tm-blue"}`}>{children}</p>;
}

export function FeatureIcon({ name, tone = "blue" }: { name: IconName; tone?: "blue" | "green" | "navy" }) {
  const tones = { blue: "bg-tm-blue-light text-tm-blue", green: "bg-tm-green-light text-tm-green", navy: "bg-white/10 text-white" };
  return (
    <span className={`inline-flex h-11 w-11 items-center justify-center rounded-xl ${tones[tone]}`}>
      <Icon name={name} size={22} />
    </span>
  );
}

export function Check({ children, light }: { children: React.ReactNode; light?: boolean }) {
  return (
    <li className="flex gap-3">
      <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-tm-green/15 text-tm-green">
        <Icon name="check" size={13} />
      </span>
      <span className={light ? "text-white/80" : "text-zinc-600"}>{children}</span>
    </li>
  );
}

// Closing call to action shared by every page
export function CtaBand() {
  return (
    <section className="px-4 py-20 sm:px-6 lg:px-8">
      <div className="relative mx-auto max-w-7xl overflow-hidden rounded-3xl px-6 py-16 text-center sm:px-12" style={{ background: NAVY }}>
        <div className="pointer-events-none absolute -top-24 -left-24 h-72 w-72 rounded-full bg-tm-blue/40 blur-3xl" />
        <div className="pointer-events-none absolute -right-20 -bottom-28 h-72 w-72 rounded-full bg-tm-green/30 blur-3xl" />
        <div className="relative">
          <h2 className="mx-auto max-w-2xl text-3xl font-bold tracking-tight text-white sm:text-5xl">Bring your team together on {APP_NAME}</h2>
          <p className="mx-auto mt-5 max-w-xl text-lg text-white/70">Create a company workspace in a minute, invite your teammates with a link, and start talking.</p>
          <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href={SIGN_UP} className={btnGreen}>
              Get started
            </Link>
            <Link href="/download" className={btnOutlineLight}>
              <Icon name="download" size={18} />
              Download the app
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
