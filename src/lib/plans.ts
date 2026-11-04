import { APP_NAME } from "./brand";

// What the public pricing page shows. The limits the app enforces live in public.plans
// (supabase/migrations/*_plans.sql); keep these numbers the same as that table.

export const PRO_PRICE = 100;

export type Tier = {
  id: "free" | "pro" | "enterprise";
  name: string;
  price: string;
  per: string;
  blurb: string;
  cta: string;
  href: string;
  highlights: string[];
};

export const tiers: Tier[] = [
  {
    id: "free",
    name: "Free",
    price: "$0",
    per: "forever",
    blurb: "For small teams trying out a better way to work together.",
    cta: "Get started",
    href: "/?signup",
    highlights: [
      "Up to 10 members",
      "90 days of message history",
      "1 GB file storage, 10 MB per file",
      "1:1 voice and video calls",
      "2 webhooks and 2 workflows",
      "Canvases, clips and reminders",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: `$${PRO_PRICE}`,
    per: "per company / month",
    blurb: "For growing teams that need unlimited history, bigger calls and admin controls.",
    cta: "Start on Pro",
    href: "/?signup",
    highlights: [
      "Up to 250 members",
      "Unlimited message history",
      "25 GB file storage, 250 MB per file",
      "Group calls with up to 10 people",
      "Unlimited webhooks and workflows",
      "AI summaries, guests, DLP, Events API, audit log and retention",
    ],
  },
  {
    id: "enterprise",
    name: "Enterprise",
    price: "Custom",
    per: "talk to us",
    blurb: "For large organizations with custom limits, security reviews and dedicated support.",
    cta: "Contact sales",
    href: "/contact?topic=enterprise",
    highlights: [
      "Unlimited members and storage",
      "Everything in Pro",
      "Custom limits and contract",
      "SCIM user provisioning",
      "Dedicated onboarding and support",
      "Security review for your team",
    ],
  },
];

type Cell = string | boolean;
export const comparison: [string, [string, Cell, Cell, Cell][]][] = [
  [
    "Messaging",
    [
      ["Members", "10", "250", "Unlimited"],
      ["Message history", "90 days", "Unlimited", "Unlimited"],
      ["Channels, DMs and threads", true, true, true],
      ["Canvases, clips and reminders", true, true, true],
      ["Guest accounts", false, true, true],
    ],
  ],
  [
    "Files",
    [
      ["Storage per company", "1 GB", "25 GB", "Custom"],
      ["Largest file", "10 MB", "250 MB", "250 MB"],
    ],
  ],
  [
    "Meet",
    [
      ["Voice, video and screen sharing", "1:1", "Up to 10 people", "Up to 10 people"],
      ["Scheduled meetings", true, true, true],
    ],
  ],
  [
    "Automation",
    [
      ["Incoming webhooks", "2", "Unlimited", "Unlimited"],
      ["Workflows", "2", "Unlimited", "Unlimited"],
      ["AI summaries", false, true, true],
      ["Events API", false, true, true],
    ],
  ],
  [
    "Admin and security",
    [
      ["Roles and private channels", true, true, true],
      ["Data loss prevention", false, true, true],
      ["Audit log", false, true, true],
      ["Custom message retention", false, true, true],
      ["SCIM provisioning", false, false, true],
      ["Dedicated support", false, false, true],
    ],
  ],
];

export const faqs: [string, string][] = [
  ["Is the Pro price per user?", `No. Pro is $${PRO_PRICE} a month for the whole company, for up to 250 members.`],
  [
    "What happens to messages older than 90 days on Free?",
    `They are hidden, not deleted, and come back as soon as you upgrade. After a year on Free they are removed to keep ${APP_NAME} fast for everyone.`,
  ],
  ["Can one person belong to several companies?", "Yes. Each company has its own plan, members, channels and limits, and you switch between them in the app."],
  ["How do I upgrade?", "An owner or admin opens Admin, then Plan, and requests Pro. We confirm and switch your company over, usually within one business day."],
  ["Do you offer discounts for nonprofits or education?", "Yes. Get in touch through the contact form and tell us about your organization."],
];
