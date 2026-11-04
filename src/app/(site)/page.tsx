import Link from "next/link";
import { APP_NAME } from "@/lib/brand";
import { Icon, type IconName } from "@/components/icons";
import { AppWindow, ProjectWindow, CallMockup, SummaryMockup, WorkflowMockup, Devices } from "@/components/site/Mockups";
import { SIGN_UP, NAVY, btnGreen, btnOutlineLight, btnPrimary, Eyebrow, FeatureIcon, Check, CtaBand } from "@/components/site/Site";

const pillars: [IconName, string, string][] = [
  ["kanban", "Projects and tasks", "Plan work on boards and lists, assign owners and due dates, and see what's blocked at a glance."],
  ["messages", "Channels for every team", "Give each team, project and topic its own space, so the right people see the right conversations."],
  ["video", "Meet in one click", "Jump from a message into a voice or video call with screen sharing, or schedule one that rings everyone on time."],
  ["list", "Docs that live with the chat", "Each channel has a canvas for plans, notes and checklists that the whole team edits together."],
];

const admin: [IconName, string, string][] = [
  ["users", "Company workspaces", "Invite by email or shareable link, review join requests, and keep each company's people and channels separate."],
  ["shield", "Roles and permissions", "Owners, admins and members, with private channels and per-company access built into the database."],
  ["wrench", "SCIM provisioning", "Create and deactivate accounts automatically from your identity provider."],
  ["clock", "Retention policies", "Set how long messages are kept. Pinned messages stay put."],
  ["eyeOff", "Data loss prevention", "Rules that catch sensitive content before it's posted."],
  ["list", "Audit log", "See who changed what across the workspace, and when."],
];

function Row({
  id,
  eyebrow,
  title,
  body,
  points,
  visual,
  flip,
}: {
  id?: string;
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  visual: React.ReactNode;
  flip?: boolean;
}) {
  return (
    <div id={id} className="grid scroll-mt-24 items-center gap-12 lg:grid-cols-2 lg:gap-20">
      <div className={flip ? "lg:order-2" : ""}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h3 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{title}</h3>
        <p className="mt-4 text-lg leading-8 text-zinc-600">{body}</p>
        <ul className="mt-6 space-y-3 text-[15px]">
          {points.map((p) => (
            <Check key={p}>{p}</Check>
          ))}
        </ul>
      </div>
      <div className={`relative ${flip ? "lg:order-1" : ""}`}>
        <div className="absolute inset-4 -z-10 rounded-[2rem] bg-gradient-to-br from-tm-blue-light to-tm-green-light blur-2xl" />
        {visual}
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden" style={{ background: NAVY }}>
        <div className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-tm-blue/35 blur-3xl" />
        <div className="pointer-events-none absolute top-60 -right-40 h-80 w-80 rounded-full bg-tm-green/25 blur-3xl" />
        <div className="relative mx-auto max-w-7xl px-4 pt-20 pb-16 text-center sm:px-6 sm:pt-28 lg:px-8">
          <p className="mx-auto inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-sm text-white/80">
            <span className="h-2 w-2 rounded-full bg-tm-green" />
            Projects, messaging and meetings in one place
          </p>
          <h1 className="mx-auto mt-7 max-w-4xl text-4xl font-bold tracking-tight text-white sm:text-6xl lg:text-7xl">
            The place your team <span className="bg-gradient-to-r from-[#6fb6ef] to-tm-green bg-clip-text text-transparent">actually works</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-white/70 sm:text-xl">
            {APP_NAME} brings your projects, tasks, conversations and calls together, so work moves forward and nobody has to dig through
            email or spreadsheets to see where things stand.
          </p>
          <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href={SIGN_UP} className={btnGreen}>
              Get started
            </Link>
            <Link href="/download" className={btnOutlineLight}>
              <Icon name="download" size={18} />
              Download the app
            </Link>
          </div>
          <div className="mx-auto mt-16 max-w-6xl">
            <AppWindow />
          </div>
        </div>
      </section>

      {/* Pillars */}
      <section className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <Eyebrow>Why {APP_NAME}</Eyebrow>
          <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-5xl">Less noise, more getting things done</h2>
          <p className="mt-5 text-lg text-zinc-600">Organized conversations replace scattered email threads, meeting links and status updates.</p>
        </div>
        <div className="mt-16 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {pillars.map(([icon, title, body]) => (
            <div key={title} className="rounded-2xl border border-zinc-200 p-8 transition hover:-translate-y-0.5 hover:shadow-lg">
              <FeatureIcon name={icon} />
              <h3 className="mt-6 text-xl font-semibold">{title}</h3>
              <p className="mt-3 leading-7 text-zinc-600">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Projects */}
      <section id="projects" className="relative scroll-mt-24 overflow-hidden py-24" style={{ background: NAVY }}>
        <div className="pointer-events-none absolute -top-40 right-0 h-96 w-[700px] rounded-full bg-tm-blue/30 blur-3xl" />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="grid gap-10 lg:grid-cols-2 lg:gap-20">
            <div>
              <Eyebrow light>Projects</Eyebrow>
              <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-5xl">Plan the work right next to the conversation</h2>
              <p className="mt-5 text-lg leading-8 text-white/70">
                Give every project a board. Break the work into tasks, bugs and stories, drag them from To do to Done, and keep the
                discussion on the task where everyone can find it.
              </p>
            </div>
            <ul className="space-y-4 self-end text-[15px] text-white/80">
              {[
                "Board and list views with To do, In progress, In review and Done",
                "Priorities, labels, assignees and due dates that flag overdue work",
                "Comments, change history and a My tasks view across every project",
              ].map((p) => (
                <li key={p} className="flex gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-tm-green text-white">
                    <Icon name="check" size={13} />
                  </span>
                  {p}
                </li>
              ))}
            </ul>
          </div>
          <div className="mx-auto mt-14 max-w-6xl">
            <ProjectWindow />
          </div>
        </div>
      </section>

      {/* Feature rows */}
      <section className="bg-tm-surface py-24">
        <div className="mx-auto max-w-7xl space-y-28 px-4 sm:px-6 lg:px-8">
          <Row
            eyebrow="Meet"
            title="Talk it out without leaving the conversation"
            body="Start a voice or video call from any channel or DM. Share your screen, react, raise a hand, and pick up the chat right where you left it."
            points={[
              "Voice, video and screen sharing in any channel or DM",
              "Scheduled meetings ring every invitee when it's time",
              "Incoming calls reach phones and closed desktop apps",
            ]}
            visual={<CallMockup />}
          />
          <Row
            flip
            eyebrow="AI summaries"
            title="Catch up on a busy channel in seconds"
            body="Back from a day off? Ask for a summary of any channel or thread and get the decisions, open questions and action items, drawn only from the messages you're allowed to see."
            points={["Summaries for whole channels or a single thread", "Respects private channels and permissions", "Jump straight to what's unread"]}
            visual={<SummaryMockup />}
          />
          <Row
            eyebrow="Automation"
            title="Put the routine work on autopilot"
            body="Build workflows that welcome new people and answer common questions automatically. Connect your other tools with webhooks, and let them post rich, formatted updates."
            points={[
              "No-code workflows triggered by keywords and new members",
              "Incoming webhooks and a signed outgoing Events API",
              "Rich bot messages, slash commands and reminders",
            ]}
            visual={<WorkflowMockup />}
          />
        </div>
      </section>

      {/* Admin */}
      <section id="admin" className="relative overflow-hidden py-24" style={{ background: NAVY }}>
        <div className="pointer-events-none absolute -bottom-40 -left-40 h-96 w-96 rounded-full bg-tm-blue/30 blur-3xl" />
        <div className="relative mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <Eyebrow light>For the whole company</Eyebrow>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-5xl">Controls your IT team will appreciate</h2>
            <p className="mt-5 text-lg text-white/70">
              Run one company or many from a single deployment, with the admin tools you need to keep information where it belongs.
            </p>
          </div>
          <div className="mt-14 grid gap-px overflow-hidden rounded-2xl bg-white/10 sm:grid-cols-2 lg:grid-cols-3">
            {admin.map(([icon, title, body]) => (
              <div key={title} className="p-8" style={{ background: NAVY }}>
                <FeatureIcon name={icon} tone="navy" />
                <h3 className="mt-5 text-lg font-semibold text-white">{title}</h3>
                <p className="mt-2 leading-7 text-white/65">{body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Everywhere */}
      <section className="mx-auto max-w-7xl px-4 py-24 sm:px-6 lg:px-8">
        <div className="grid items-center gap-16 lg:grid-cols-2">
          <div>
            <Eyebrow>Everywhere you work</Eyebrow>
            <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-5xl">At your desk, in the browser, on your phone</h2>
            <p className="mt-5 text-lg leading-8 text-zinc-600">
              Use {APP_NAME} in any modern browser, install the desktop app for Windows or macOS, or add it to your phone&apos;s home screen.
              Notifications follow you, even when the app is closed.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/download" className={btnPrimary}>
                <Icon name="download" size={16} />
                Get the desktop app
              </Link>
              <Link href={SIGN_UP} className="inline-flex items-center gap-1 px-2 py-3 text-sm font-semibold text-tm-blue hover:underline">
                Or open it in your browser →
              </Link>
            </div>
          </div>
          <div className="pb-8">
            <Devices />
          </div>
        </div>
      </section>

      <CtaBand />
    </>
  );
}
