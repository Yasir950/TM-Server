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

// The app's left rail, as in components/chat/Chat.tsx: workspace, Home, DMs, Activity, Tasks, Saved, Reminders
function Rail() {
  const items: [IconName, number?][] = [["home"], ["dms", 2], ["bell", 3], ["checkSquare"], ["bookmark"], ["clock"]];
  return (
    <div className="hidden w-16 shrink-0 flex-col items-center gap-3 pt-4 sm:flex" style={{ background: NAVY }}>
      <span className="mb-1 flex h-10 w-10 items-center justify-center rounded-[30%] bg-white text-sm font-bold text-tm-blue ring-2 ring-white/20">AS</span>
      {items.map(([n, count], i) => (
        <span key={n} className={`relative flex h-10 w-10 items-center justify-center rounded-xl ${i === 0 ? "bg-white/20 text-white" : "text-white/70"}`}>
          <Icon name={n} size={20} />
          {count && (
            <span
              className="absolute -top-1 -right-1.5 min-w-[18px] rounded-full bg-tm-green px-1 text-center text-[10px] leading-[18px] font-bold text-white"
              style={{ boxShadow: `0 0 0 2px ${NAVY}` }}
            >
              {count}
            </span>
          )}
        </span>
      ))}
    </div>
  );
}

// Task bits, matching the real board in components/chat/Projects.tsx
type TaskType = "task" | "bug" | "story" | "epic";
type Priority = "highest" | "high" | "medium" | "low";
const typeStyle: Record<TaskType, [IconName, string]> = {
  task: ["check", "bg-tm-blue"],
  bug: ["bug", "bg-red-500"],
  story: ["bookmark", "bg-tm-green"],
  epic: ["zap", "bg-purple-500"],
};
const priorityStyle: Record<Priority, [IconName, string]> = {
  highest: ["chevronsUp", "text-red-600"],
  high: ["chevronUp", "text-orange-500"],
  medium: ["equal", "text-amber-500"],
  low: ["chevronDown", "text-tm-blue"],
};

function TypeIcon({ type, size = 16 }: { type: TaskType; size?: number }) {
  const [icon, bg] = typeStyle[type];
  return (
    <span className={`inline-flex shrink-0 items-center justify-center rounded text-white ${bg}`} style={{ width: size, height: size }}>
      <Icon name={icon} size={size * 0.7} />
    </span>
  );
}

function PriorityIcon({ priority, size = 16 }: { priority: Priority; size?: number }) {
  const [icon, color] = priorityStyle[priority];
  return (
    <span className={color}>
      <Icon name={icon} size={size} />
    </span>
  );
}

type SampleTask = { n: number; title: string; type: TaskType; priority: Priority; who?: Person; due?: string; late?: boolean; labels?: string[] };

function TaskCard({ task, done }: { task: SampleTask; done?: boolean }) {
  return (
    <div className="rounded-xl bg-white p-3 shadow-sm ring-1 ring-black/5">
      <div className={`text-[13px] leading-5 ${done ? "text-zinc-500" : "text-zinc-900"}`}>{task.title}</div>
      {task.labels && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {task.labels.map((l) => (
            <span key={l} className="rounded bg-tm-blue-light px-1.5 py-px text-[11px] font-medium text-tm-blue-dark">
              {l}
            </span>
          ))}
        </div>
      )}
      <div className="mt-2.5 flex items-center gap-1.5">
        <TypeIcon type={task.type} />
        <span className={`text-xs font-medium text-zinc-500 ${done ? "line-through" : ""}`}>ONB-{task.n}</span>
        {task.due && (
          <span className={`flex items-center gap-0.5 rounded px-1 text-[11px] ${task.late ? "bg-red-50 font-semibold text-red-600" : "text-zinc-500"}`}>
            <Icon name="calendar" size={11} />
            {task.due}
          </span>
        )}
        <span className="ml-auto flex items-center gap-1.5">
          <PriorityIcon priority={task.priority} />
          {task.who ? (
            <Avatar who={task.who} size={22} />
          ) : (
            <span className="flex h-[22px] w-[22px] items-center justify-center rounded-[30%] border border-dashed border-zinc-300 text-zinc-300">
              <Icon name="users" size={11} />
            </span>
          )}
        </span>
      </div>
    </div>
  );
}

const board: [string, SampleTask[]][] = [
  [
    "To do",
    [
      { n: 18, title: "Dark mode for the welcome screens", type: "story", priority: "medium", who: "priya", due: "Nov 18", labels: ["design"] },
      { n: 21, title: "Localize onboarding copy (ES, FR)", type: "task", priority: "low", labels: ["i18n"] },
      { n: 22, title: "Add a skip button to the product tour", type: "task", priority: "low", who: "sam" },
    ],
  ],
  [
    "In progress",
    [
      { n: 12, title: "Lock final copy for the welcome screens", type: "task", priority: "high", who: "dana", due: "Nov 6", labels: ["copy"] },
      { n: 15, title: "Invite-your-teammates step", type: "story", priority: "medium", who: "marcus", due: "Nov 12", labels: ["frontend"] },
    ],
  ],
  [
    "In review",
    [
      { n: 19, title: "Signup fails when the email contains a +", type: "bug", priority: "highest", who: "sam", due: "Nov 3", late: true },
      { n: 14, title: "Progress checklist widget", type: "story", priority: "medium", who: "priya", labels: ["frontend"] },
    ],
  ],
  [
    "Done",
    [
      { n: 9, title: "Beta signup form", type: "story", priority: "high", who: "marcus" },
      { n: 11, title: "Analytics events for each onboarding step", type: "task", priority: "medium", who: "dana" },
    ],
  ],
];

function KeyBadge({ k, size = 24, color = "bg-tm-blue" }: { k: string; size?: number; color?: string }) {
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-md font-bold text-white ${color}`} style={{ width: size, height: size, fontSize: size * 0.34 }}>
      {k}
    </span>
  );
}

// A project's board in the app window: rail, sidebar with projects, and the board's columns
export function ProjectWindow() {
  const projects: [string, string, string, boolean?][] = [
    ["ONB", "Onboarding v2", "bg-tm-blue", true],
    ["WEB", "Website refresh", "bg-tm-green"],
    ["MOB", "Mobile app", "bg-purple-500"],
  ];
  const channels: [string, number?][] = [["general"], ["launch-q4"], ["design", 3]];
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 shadow-black/30 ring-black/10">
      {/* Title bar */}
      <div className="flex h-10 items-center gap-2 px-4" style={{ background: NAVY }}>
        <Mark size={22} />
        <div className="mx-auto hidden w-full max-w-md items-center gap-2 rounded-md bg-white/10 px-3 py-1 text-xs text-white/60 sm:flex">
          <Icon name="search" size={13} />
          Search Acme Studio
        </div>
      </div>
      <div className="flex h-[440px] text-left sm:h-[500px]">
        <Rail />
        {/* Sidebar */}
        <div className="hidden w-56 shrink-0 flex-col border-r border-tm-line bg-tm-surface md:flex">
          <div className="flex h-14 items-center justify-between px-4">
            <span className="font-semibold text-zinc-900">Acme Studio</span>
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-zinc-600 shadow-sm">
              <Icon name="pencil" size={15} />
            </span>
          </div>
          <div className="px-2 text-[14px]">
            <p className="px-2 pt-2 pb-1 text-xs font-medium text-zinc-500">Projects</p>
            <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-zinc-600">
              <span className="flex h-5 w-5 items-center justify-center text-zinc-400">
                <Icon name="checkSquare" size={16} />
              </span>
              <span className="flex-1">My tasks</span>
              <span className="rounded-full bg-tm-green px-1.5 text-[11px] font-semibold text-white">4</span>
            </div>
            {projects.map(([k, name, color, active]) => (
              <div key={k} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${active ? "bg-tm-blue text-white" : "text-zinc-600"}`}>
                <KeyBadge k={k} size={20} color={active ? "bg-white/20" : color} />
                <span className="flex-1 truncate">{name}</span>
              </div>
            ))}
            <p className="px-2 pt-4 pb-1 text-xs font-medium text-zinc-500">Channels</p>
            {channels.map(([name, unread]) => (
              <div key={name} className={`flex items-center gap-2 rounded-lg px-2 py-1.5 ${unread ? "font-semibold text-zinc-900" : "text-zinc-600"}`}>
                <span className="opacity-70">#</span>
                <span className="flex-1">{name}</span>
                {unread && <span className="rounded-full bg-tm-green px-1.5 text-[11px] font-semibold text-white">{unread}</span>}
              </div>
            ))}
            <p className="px-2 pt-4 pb-1 text-xs font-medium text-zinc-500">Direct messages</p>
            {(["marcus", "dana"] as const).map((p) => (
              <div key={p} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-zinc-600">
                <span className="relative">
                  <Avatar who={p} size={20} />
                  <span className="absolute -right-0.5 -bottom-0.5 h-2 w-2 rounded-full border border-white bg-tm-green" />
                </span>
                {people[p].name}
              </div>
            ))}
          </div>
        </div>
        {/* Project board */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-tm-line px-5">
            <span className="hidden text-sm text-zinc-500 sm:inline">Projects</span>
            <span className="hidden text-zinc-300 sm:inline">/</span>
            <KeyBadge k="ONB" />
            <span className="truncate text-lg font-semibold text-zinc-900">Onboarding v2</span>
            <div className="ml-auto flex shrink-0 items-center gap-1.5">
              <span className="hidden rounded-xl bg-tm-surface p-1 text-sm font-medium sm:flex">
                <span className="flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1 text-tm-blue shadow-sm">
                  <Icon name="kanban" size={15} />
                  <span className="hidden lg:inline">Board</span>
                </span>
                <span className="flex items-center gap-1.5 px-2.5 py-1 text-zinc-500">
                  <Icon name="list" size={15} />
                  <span className="hidden lg:inline">List</span>
                </span>
              </span>
              <span className="p-2 text-zinc-500">
                <Icon name="settings" size={18} />
              </span>
              <span className="flex items-center gap-1.5 rounded-lg bg-tm-blue px-3 py-1.5 text-sm font-semibold text-white">
                <Icon name="plus" size={16} />
                <span className="hidden sm:inline">Create</span>
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 border-b border-tm-line px-5 py-2">
            <div className="flex w-44 items-center gap-2 rounded-xl border border-tm-line bg-tm-surface px-3 py-1.5 text-sm text-zinc-400">
              <Icon name="search" size={15} />
              Search this board
            </div>
            <span className="flex -space-x-1">
              {(["priya", "marcus", "dana", "sam"] as const).map((p, i) => (
                <span key={p} className={`rounded-[30%] ring-2 ${i === 2 ? "z-10 ring-tm-blue" : "ring-white"}`}>
                  <Avatar who={p} size={26} />
                </span>
              ))}
            </span>
            <span className="hidden rounded-lg px-2.5 py-1 text-sm text-zinc-600 lg:inline">Only my tasks</span>
            <span className="hidden items-center gap-1 px-1.5 py-1 text-sm text-zinc-600 lg:flex">
              All types <Icon name="chevronDown" size={14} />
            </span>
          </div>
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-hidden p-3 sm:grid-cols-2 lg:grid-cols-4">
            {board.map(([label, tasks], i) => (
              <div key={label} className={`flex-col rounded-2xl bg-tm-surface ${i === 0 ? "flex" : i === 1 ? "hidden sm:flex" : "hidden lg:flex"}`}>
                <div className="flex items-center gap-2 px-3 pt-3 pb-2">
                  <span className="text-xs font-semibold tracking-wide text-zinc-500 uppercase">{label}</span>
                  <span className="rounded-full bg-white px-1.5 text-xs font-semibold text-zinc-500">{tasks.length}</span>
                  {label === "Done" && (
                    <span className="text-tm-green">
                      <Icon name="check" size={14} />
                    </span>
                  )}
                </div>
                <div className="space-y-2 px-2 pb-2">
                  {tasks.map((t) => (
                    <TaskCard key={t.n} task={t} done={label === "Done"} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// The main app window: rail, sidebar, channel with messages and a composer
export function AppWindow() {
  const channels: [string, boolean?, number?][] = [["general"], ["launch-q4", true], ["design", false, 3], ["engineering"], ["random"]];
  return (
    <div className="overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 shadow-black/30 ring-black/10">
      {/* Title bar */}
      <div className="flex h-10 items-center gap-2 px-4" style={{ background: NAVY }}>
        <Mark size={22} />
        <div className="mx-auto hidden w-full max-w-md items-center gap-2 rounded-md bg-white/10 px-3 py-1 text-xs text-white/60 sm:flex">
          <Icon name="search" size={13} />
          Search Acme Studio
        </div>
      </div>
      <div className="flex h-[440px] text-left sm:h-[480px]">
        <Rail />
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
          <Mark size={14} />
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
