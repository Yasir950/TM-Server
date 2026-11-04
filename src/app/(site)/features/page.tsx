import type { Metadata } from "next";
import Link from "next/link";
import { APP_NAME } from "@/lib/brand";
import type { IconName } from "@/components/icons";
import { SIGN_UP, btnPrimary, btnOutline, Eyebrow, FeatureIcon, CtaBand } from "@/components/site/Site";

export const metadata: Metadata = {
  title: "Features",
  description: `Everything in ${APP_NAME}: channels, threads, Meet calls, canvases, clips, AI summaries, workflows, webhooks and enterprise admin controls.`,
};

type Group = { id: string; eyebrow: string; title: string; intro: string; items: [IconName, string, string][] };

const groups: Group[] = [
  {
    id: "messaging",
    eyebrow: "Messaging",
    title: "Conversations that stay organized",
    intro: "Channels keep work out in the open; threads and DMs keep the side conversations tidy.",
    items: [
      ["messages", "Public and private channels", "Create channels for teams, projects and topics. Browse, join, star, mute and set a topic for each."],
      ["dms", "Direct and group messages", "Message one person or a group of up to nine, and turn a group DM into a channel when it outgrows it."],
      ["unread", "Threads", "Reply in a side panel without derailing the channel. Follow threads and see unread replies in one view."],
      ["at", "Mentions and reactions", "@mention people with autocomplete, react with any emoji, and format messages with rich text and code."],
      ["search", "Search, pins and saved items", "Find any message, pin the important ones to the channel, and save others for later."],
      ["bell", "Notifications that respect focus", "Choose all messages or mentions only per conversation, set a status and turn on Do Not Disturb."],
    ],
  },
  {
    id: "meet",
    eyebrow: "Meet",
    title: "Calls without the meeting links",
    intro: "Every channel and DM can start a Meet: voice, video and screen sharing, right next to the conversation.",
    items: [
      ["video", "Voice and video calls", "Start a call in any conversation and see who's already in it before you join."],
      ["monitorUp", "Screen sharing", "Share a window or your whole screen to walk the team through work."],
      ["hand", "Reactions and raised hands", "React without unmuting and raise a hand to take your turn."],
      ["calendar", "Scheduled meetings", "Book a Meet for a set time. When it starts, everyone invited gets rung in and the channel is notified."],
      ["phone", "Calls that find you", "Incoming calls ring on phones and in the desktop app, even when it's closed to the tray."],
      ["headphones", "Ring someone directly", "Call a teammate from a DM and it rings like a phone, with a missed-call notice if they can't pick up."],
    ],
  },
  {
    id: "collaborate",
    eyebrow: "Collaboration",
    title: "Share more than messages",
    intro: "Files, voice and video clips, and living documents all sit with the conversation they belong to.",
    items: [
      ["list", "Canvases", "Each channel has a shared canvas for plans, specs and checklists that the whole team edits."],
      ["mic", "Voice and video clips", "Record a quick clip instead of typing a long message, with a waveform and seekable playback."],
      ["plus", "Files and images", "Drag, drop or paste files with inline image previews. Files are stored privately behind signed links."],
      ["link", "Link previews", "Links unfurl into rich previews so people know what they're clicking."],
      ["clock", "Reminders", "Ask to be reminded about a message or task, and it shows up in your own DM at the right time."],
      ["pencil", "Drafts that follow you", "Unsent messages are kept per conversation, so you can switch away and come back."],
    ],
  },
  {
    id: "automate",
    eyebrow: "Automation and integrations",
    title: "Connect the tools you already use",
    intro: "Bring updates in from other systems, send events out, and let workflows handle the repetitive parts.",
    items: [
      ["wrench", "Workflows", "Reply automatically when someone joins a channel or a message mentions a keyword, mentioning whoever triggered it."],
      ["send", "Incoming webhooks", "Post into any channel from your CI, monitoring or CRM with a single HTTP request."],
      ["code", "Rich bot messages", "Format webhook messages with headers, sections, images, context and link buttons."],
      ["codeBlock", "Events API", "Receive signed callbacks when messages are posted, channels are created or people join, and build your own integrations."],
      ["type", "Slash commands", "Type /remind, /status, /dnd, /invite, /summarize and more to get things done without leaving the keyboard."],
      ["messages", "AI summaries", "Summarize a channel or thread to catch up fast, limited to the messages you can see."],
    ],
  },
  {
    id: "admin",
    eyebrow: "Admin and security",
    title: "Enterprise controls, built in",
    intro: "Everything an organization needs to run its workspace and keep information where it belongs.",
    items: [
      ["users", "Company workspaces", "Separate companies with their own members, channels and profiles. Invite by email or link and approve join requests."],
      ["shield", "Roles", "Owners, admins and members, enforced by row-level security in the database rather than only in the app."],
      ["wrench", "SCIM 2.0 provisioning", "Create, update and deactivate users automatically from your identity provider."],
      ["eyeOff", "Data loss prevention", "Pattern rules that block or redact sensitive content before it's saved."],
      ["clock", "Message retention", "Set a retention window for each workspace. Pinned messages are kept."],
      ["list", "Audit log", "A record of administrative changes across the workspace."],
    ],
  },
];

export default function Features() {
  return (
    <>
      <section className="border-b border-zinc-200 bg-gradient-to-b from-tm-blue-light/70 to-white">
        <div className="mx-auto max-w-7xl px-4 pt-20 pb-16 text-center sm:px-6 sm:pt-24 lg:px-8">
          <Eyebrow>Features</Eyebrow>
          <h1 className="mx-auto mt-4 max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">Everything your team needs to work together</h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-zinc-600">
            From quick questions to face-to-face calls, {APP_NAME} has the tools for the way your team works.
          </p>
          <div className="mt-9 flex flex-col justify-center gap-3 sm:flex-row">
            <Link href={SIGN_UP} className={btnPrimary}>
              Get started
            </Link>
            <Link href="/download" className={btnOutline}>
              Download the app
            </Link>
          </div>
          <nav className="mx-auto mt-12 flex max-w-3xl flex-wrap justify-center gap-2">
            {groups.map((g) => (
              <a
                key={g.id}
                href={`#${g.id}`}
                className="rounded-full border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition hover:border-tm-blue hover:text-tm-blue"
              >
                {g.eyebrow}
              </a>
            ))}
          </nav>
        </div>
      </section>

      {groups.map((g, i) => (
        <section key={g.id} id={g.id} className={`scroll-mt-16 py-20 ${i % 2 ? "bg-tm-surface" : ""}`}>
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <Eyebrow>{g.eyebrow}</Eyebrow>
              <h2 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">{g.title}</h2>
              <p className="mt-4 text-lg text-zinc-600">{g.intro}</p>
            </div>
            <div className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
              {g.items.map(([icon, title, body]) => (
                <div key={title}>
                  <FeatureIcon name={icon} tone={i % 2 ? "green" : "blue"} />
                  <h3 className="mt-4 text-lg font-semibold">{title}</h3>
                  <p className="mt-2 leading-7 text-zinc-600">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      ))}

      <CtaBand />
    </>
  );
}
