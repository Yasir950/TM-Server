import { Icon, type IconName } from "@/components/icons";
import { Mark, NAVY } from "./Site";

// Illustrations of the product for the public site, drawn in markup so they stay crisp and need no screenshots.
// The people and conversations are made-up sample content.

const people = {
  priya: { name: "Priya Shah", color: "#1c75bc" },
  marcus: { name: "Marcus Lee", color: "#39b54a" },
  dana: { name: "Dana Ortiz", color: "#155a91" },
  sam: { name: "Sam Okafor", color: "#2d8a3a" },
  bot: { name: "Deploy bot", color: "#4a90c9" },
};
type Person = keyof typeof people;

function Avatar({ who, size = 36 }: { who: Person; size?: number }) {
  const p = people[who];
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-[30%] font-semibold text-white"
      style={{ width: size, height: size, background: p.color, fontSize: size * 0.42 }}
    >
      {p.name.charAt(0)}
    </span>
  );
}

function Message({ who, time, children, extra }: { who: Person; time: string; children: React.ReactNode; extra?: React.ReactNode }) {
  return (
    <div className="flex gap-3 px-5 py-2.5">
      <Avatar who={who} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="text-[14px] font-semibold text-zinc-900">{people[who].name}</span>
          <span className="text-[11px] text-zinc-400">{time}</span>
        </div>
        <div className="text-[14px] leading-6 text-zinc-700">{children}</div>
        {extra}
      </div>
    </div>
  );
}

function Reaction({ emoji, count, mine }: { emoji: string; count: number; mine?: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${mine ? "border-tm-blue/40 bg-tm-blue-light text-tm-blue" : "border-zinc-200 bg-white text-zinc-600"}`}
    >
      {emoji} {count}
    </span>
  );
}

const mention = "rounded bg-tm-blue-light px-1 font-medium text-tm-blue";

// The main app window: rail, sidebar, channel with messages and a composer
export function AppWindow() {
  const channels: [string, boolean?, number?][] = [["general"], ["launch-q4", true], ["design", false, 3], ["engineering"], ["random"]];
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 shadow-black/30 ring-black/10">
      {/* Title bar */}
      <div className="flex h-10 items-center gap-2 px-4" style={{ background: NAVY }}>
        <span className="h-3 w-3 rounded-full bg-[#ff5f57]" />
        <span className="h-3 w-3 rounded-full bg-[#febc2e]" />
        <span className="h-3 w-3 rounded-full bg-[#28c840]" />
        <div className="mx-auto hidden w-full max-w-md items-center gap-2 rounded-md bg-white/10 px-3 py-1 text-xs text-white/60 sm:flex">
          <Icon name="search" size={13} />
          Search Acme Studio
        </div>
      </div>
      <div className="flex h-[440px] text-left sm:h-[480px]">
        {/* Rail */}
        <div className="hidden w-16 shrink-0 flex-col items-center gap-4 pt-4 sm:flex" style={{ background: NAVY }}>
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-sm font-bold text-tm-blue">AS</span>
          {(["home", "dms", "bell", "bookmark"] as const).map((n, i) => (
            <span key={n} className={`flex h-10 w-10 items-center justify-center rounded-xl ${i === 0 ? "bg-white/15 text-white" : "text-white/55"}`}>
              <Icon name={n} size={20} />
            </span>
          ))}
        </div>
        {/* Sidebar */}
        <div className="hidden w-56 shrink-0 flex-col border-r border-tm-line bg-tm-surface md:flex">
          <div className="flex h-14 items-center justify-between px-4">
            <span className="font-semibold text-zinc-900">Acme Studio</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-zinc-600 shadow-sm">
              <Icon name="pencil" size={15} />
            </span>
          </div>
          <div className="px-2 text-[14px]">
            <p className="px-2 pt-2 pb-1 text-xs font-medium text-zinc-500">Channels</p>
            {channels.map(([name, active, unread]) => (
              <div
                key={name}
                className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${active ? "bg-tm-blue text-white" : unread ? "font-semibold text-zinc-900" : "text-zinc-600"}`}
              >
                <span className="opacity-70">#</span>
                <span className="flex-1">{name}</span>
                {unread && <span className="rounded-full bg-tm-green px-1.5 text-[11px] font-semibold text-white">{unread}</span>}
              </div>
            ))}
            <p className="px-2 pt-4 pb-1 text-xs font-medium text-zinc-500">Direct messages</p>
            {(["marcus", "dana", "sam"] as const).map((p, i) => (
              <div key={p} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-zinc-600">
                <span className="relative">
                  <Avatar who={p} size={20} />
                  <span className={`absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full border border-white ${i < 2 ? "bg-tm-green" : "bg-zinc-300"}`} />
                </span>
                {people[p].name}
              </div>
            ))}
          </div>
        </div>
        {/* Channel */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-14 shrink-0 items-center gap-3 border-b border-tm-line px-5">
            <span className="font-semibold text-zinc-900"># launch-q4</span>
            <span className="hidden truncate text-sm text-zinc-500 lg:inline">Ship the new onboarding by Nov 20</span>
            <div className="ml-auto flex items-center gap-2">
              <span className="flex -space-x-1.5">
                {(["priya", "marcus", "dana"] as const).map((p) => (
                  <span key={p} className="rounded-[30%] ring-2 ring-white">
                    <Avatar who={p} size={22} />
                  </span>
                ))}
              </span>
              <span className="hidden items-center gap-1.5 rounded-lg bg-tm-green px-2.5 py-1 text-xs font-semibold text-white sm:inline-flex">
                <Icon name="headphones" size={14} />
                Meet
              </span>
            </div>
          </div>
          <div className="flex-1 overflow-hidden py-2">
            <Message who="priya" time="9:41 AM">
              Morning all! Beta signups crossed <b>1,200</b> overnight 🎉 Summary of feedback is in the canvas.
              <div className="mt-1.5 flex gap-1.5">
                <Reaction emoji="🎉" count={6} mine />
                <Reaction emoji="🚀" count={3} />
              </div>
            </Message>
            <Message
              who="marcus"
              time="9:44 AM"
              extra={
                <div className="mt-1.5 flex items-center gap-2 text-xs">
                  <span className="flex -space-x-1">
                    <Avatar who="dana" size={18} />
                    <Avatar who="sam" size={18} />
                  </span>
                  <span className="font-semibold text-tm-blue">4 replies</span>
                  <span className="text-zinc-400">Last reply 2 min ago</span>
                </div>
              }
            >
              <span className={mention}>@Dana Ortiz</span> can we lock the final copy for the welcome screens today?
            </Message>
            <div className="mx-5 my-1.5 rounded-xl border border-tm-line bg-tm-surface p-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-zinc-700">
                <Avatar who="bot" size={18} />
                Deploy bot <span className="rounded bg-zinc-200 px-1 text-[10px] text-zinc-600">APP</span>
              </div>
              <p className="mt-1.5 text-[13px] text-zinc-700">
                ✅ <b>onboarding-v2</b> deployed to staging
              </p>
              <div className="mt-2 flex gap-2">
                <span className="rounded-md bg-tm-blue px-2.5 py-1 text-xs font-semibold text-white">Promote to production</span>
                <span className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-semibold text-zinc-700">View logs</span>
              </div>
            </div>
          </div>
          <div className="shrink-0 p-4 pt-0">
            <div className="rounded-xl border border-zinc-300 bg-white">
              <div className="flex gap-1 border-b border-zinc-100 px-2 py-1.5 text-zinc-400">
                {(["bold", "italic", "strike", "link", "list", "code"] as const).map((n) => (
                  <span key={n} className="flex h-6 w-6 items-center justify-center">
                    <Icon name={n} size={14} />
                  </span>
                ))}
              </div>
              <div className="flex items-center gap-2 px-3 py-2.5">
                <span className="flex-1 text-sm text-zinc-400">Message #launch-q4</span>
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-tm-green text-white">
                  <Icon name="send" size={15} />
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// A Meet in progress: video tiles and the call controls
export function CallMockup() {
  const tiles: [Person, string, boolean?][] = [
    ["priya", "Sharing screen", true],
    ["marcus", ""],
    ["dana", ""],
    ["sam", "✋"],
  ];
  return (
    <div className="overflow-hidden rounded-2xl p-3 shadow-xl ring-1 ring-black/10" style={{ background: "#0b1f36" }}>
      <div className="grid grid-cols-2 gap-3">
        {tiles.map(([who, note, speaking]) => (
          <div
            key={who}
            className={`relative flex aspect-video items-center justify-center rounded-xl bg-gradient-to-br from-white/10 to-white/[0.03] ${speaking ? "ring-2 ring-tm-green" : ""}`}
          >
            <Avatar who={who} size={52} />
            <span className="absolute bottom-2 left-2 rounded-md bg-black/40 px-2 py-0.5 text-[11px] font-medium text-white">{people[who].name.split(" ")[0]}</span>
            {note && <span className="absolute top-2 right-2 rounded-md bg-black/40 px-2 py-0.5 text-[11px] text-white">{note}</span>}
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center justify-center gap-2">
        {(["mic", "video", "monitorUp", "smile", "hand"] as const).map((n) => (
          <span key={n} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white">
            <Icon name={n} size={18} />
          </span>
        ))}
        <span className="flex h-10 w-14 items-center justify-center rounded-full bg-red-500 text-white">
          <Icon name="phoneOff" size={18} />
        </span>
      </div>
    </div>
  );
}

// An AI catch-up summary of a busy channel
export function SummaryMockup() {
  return (
    <div className="rounded-2xl bg-white p-6 shadow-xl ring-1 ring-black/5">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-tm-blue to-tm-green text-white">✦</span>
        <div>
          <p className="text-sm font-semibold text-zinc-900">Summary of #launch-q4</p>
          <p className="text-xs text-zinc-500">142 messages since yesterday</p>
        </div>
      </div>
      <ul className="mt-5 space-y-3 text-sm leading-6 text-zinc-700">
        <li className="flex gap-2">
          <span className="text-tm-blue">•</span>
          <span>
            Beta signups passed <b>1,200</b>; top request is a dark mode for the welcome screens.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="text-tm-blue">•</span>
          <span>
            <b>Decision:</b> final copy is locked today, owned by Dana.
          </span>
        </li>
        <li className="flex gap-2">
          <span className="text-tm-blue">•</span>
          <span>
            <b>onboarding-v2</b> is on staging and waiting for sign-off before production.
          </span>
        </li>
      </ul>
      <div className="mt-5 flex gap-2 text-xs">
        <span className="rounded-full bg-tm-blue-light px-3 py-1 font-medium text-tm-blue">Open thread</span>
        <span className="rounded-full bg-zinc-100 px-3 py-1 font-medium text-zinc-600">Jump to unread</span>
      </div>
    </div>
  );
}

// A workflow: trigger, steps, and the message it posts
export function WorkflowMockup() {
  const steps: [string, string, IconName][] = [
    ["When someone joins", "#new-hires", "users"],
    ["Reply", "Welcome @Sam! Start with the onboarding canvas 👋", "messages"],
    ["When a message says", "“vpn”", "at"],
    ["Reply", "Here's the VPN setup guide, @Sam", "send"],
  ];
  return (
    <div className="space-y-3">
      {steps.map(([k, v, icon], i) => (
        <div key={i} className="flex items-center gap-4 rounded-2xl bg-white p-4 shadow-md ring-1 ring-black/5" style={{ marginLeft: i % 2 ? 32 : 0 }}>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-tm-blue-light text-tm-blue">
            <Icon name={icon} size={20} />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-wide text-zinc-400 uppercase">{k}</p>
            <p className="text-sm font-medium text-zinc-800">{v}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// Small device lineup for the "everywhere" section
export function Devices() {
  return (
    <div className="relative mx-auto flex max-w-md items-end justify-center gap-4">
      <div className="w-full overflow-hidden rounded-xl bg-white shadow-xl ring-1 ring-black/10">
        <div className="flex h-6 items-center gap-1.5 px-3" style={{ background: NAVY }}>
          <span className="h-2 w-2 rounded-full bg-white/40" />
          <span className="h-2 w-2 rounded-full bg-white/40" />
          <span className="h-2 w-2 rounded-full bg-white/40" />
        </div>
        <div className="flex h-44">
          <div className="w-10" style={{ background: NAVY }} />
          <div className="w-24 space-y-2 bg-tm-surface p-3">
            {[70, 55, 80, 60, 45].map((w, i) => (
              <div key={i} className={`h-2 rounded ${i === 1 ? "bg-tm-blue" : "bg-zinc-300"}`} style={{ width: `${w}%` }} />
            ))}
          </div>
          <div className="flex-1 space-y-3 p-3">
            {[90, 70, 85].map((w, i) => (
              <div key={i} className="flex gap-2">
                <span className="h-5 w-5 shrink-0 rounded-md" style={{ background: i % 2 ? "#39b54a" : "#1c75bc" }} />
                <div className="flex-1 space-y-1.5">
                  <div className="h-1.5 w-1/3 rounded bg-zinc-400" />
                  <div className="h-1.5 rounded bg-zinc-200" style={{ width: `${w}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="absolute -right-2 -bottom-6 w-28 overflow-hidden rounded-[22px] border-4 border-zinc-900 bg-white shadow-2xl sm:-right-6">
        <div className="flex h-7 items-center justify-center" style={{ background: NAVY }}>
          <Mark size={14} />
        </div>
        <div className="space-y-2 p-2">
          <div className="rounded-lg bg-tm-blue-light p-1.5">
            <div className="h-1.5 w-2/3 rounded bg-tm-blue/60" />
            <div className="mt-1 h-1.5 w-full rounded bg-tm-blue/25" />
          </div>
          {[80, 60, 75, 50].map((w, i) => (
            <div key={i} className="h-1.5 rounded bg-zinc-200" style={{ width: `${w}%` }} />
          ))}
          <div className="h-5 rounded-md border border-zinc-200" />
        </div>
      </div>
    </div>
  );
}
