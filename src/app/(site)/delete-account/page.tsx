import type { Metadata } from "next";
import Link from "next/link";
import { APP_NAME } from "@/lib/brand";
import { Eyebrow, Check } from "@/components/site/Site";
import ContactForm from "@/components/site/ContactForm";

export const metadata: Metadata = {
  title: "Delete your account",
  description: `How to request deletion of your ${APP_NAME} account and its data, what is deleted and what is kept.`,
};

const steps = [
  "Fill in the form on this page with your name and the email address you sign in to Workchime with.",
  "Keep the prefilled message, or add anything else, such as asking us to delete your whole company workspace.",
  "Press Send message. We may email that address to confirm the request came from you.",
  "We delete your account and its data within 30 days and email you when it's done.",
];

// Linked from the privacy policy and given to Google Play as the account deletion URL
export default function DeleteAccount() {
  return (
    <section className="bg-gradient-to-b from-tm-blue-light/70 to-white">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 sm:py-24 lg:grid-cols-[1fr_1.2fr] lg:px-8">
        <div>
          <Eyebrow>{APP_NAME} account</Eyebrow>
          <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">Delete your {APP_NAME} account</h1>
          <p className="mt-6 text-lg leading-8 text-zinc-600">
            You can ask us to delete your {APP_NAME} account and its data at any time, whether you use {APP_NAME} on Android, iOS,
            desktop or the web.
          </p>

          <h2 className="mt-10 text-lg font-semibold text-zinc-900">How to request deletion</h2>
          <ol className="mt-4 space-y-3 text-[15px] text-zinc-600">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-tm-blue text-xs font-semibold text-white">{i + 1}</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>

          <h2 className="mt-10 text-lg font-semibold text-zinc-900">What we delete</h2>
          <ul className="mt-4 space-y-3 text-[15px]">
            <Check>Your account, sign-in email and password</Check>
            <Check>Your profile: name, username, photo, status, job title and phone number</Check>
            <Check>Messages, replies, reactions, files, photos, voice and video clips you posted</Check>
            <Check>Your company memberships, saved items, reminders and drafts</Check>
            <Check>Your devices and push notification tokens</Check>
          </ul>

          <h2 className="mt-10 text-lg font-semibold text-zinc-900">What we keep, and for how long</h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-[15px] leading-6 text-zinc-600">
            <li>A record of your deletion request (your name, email and message), kept for up to 12 months to show the request was handled.</li>
            <li>Copies in our hosting providers&apos; encrypted backups, which are overwritten automatically within 30 days.</li>
            <li>
              Content in a company workspace that other people own, such as tasks or canvases you edited together, stays with that company
              but is no longer linked to your profile.
            </li>
          </ul>

          <p className="mt-8 text-sm leading-6 text-zinc-500">
            If you own a company workspace, transfer ownership to another member in the app first, or ask us in your message to delete the
            whole company and everything in it. See our{" "}
            <Link href="/privacy" className="font-medium text-tm-blue hover:underline">privacy policy</Link> for more.
          </p>
        </div>
        <div className="lg:sticky lg:top-24 lg:self-start">
          <ContactForm initialMessage={`Please delete my ${APP_NAME} account and all of its data.`} />
        </div>
      </div>
    </section>
  );
}
