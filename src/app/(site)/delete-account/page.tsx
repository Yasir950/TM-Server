import type { Metadata } from "next";
import Link from "next/link";
import { APP_NAME } from "@/lib/brand";
import { Eyebrow, Check } from "@/components/site/Site";
import ContactForm from "@/components/site/ContactForm";

export const metadata: Metadata = {
  title: "Delete your account",
  description: `Request deletion of your ${APP_NAME} account and its data.`,
};

// Linked from the privacy policy and given to Google Play as the account deletion URL
export default function DeleteAccount() {
  return (
    <section className="bg-gradient-to-b from-tm-blue-light/70 to-white">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 sm:py-24 lg:grid-cols-[1fr_1.2fr] lg:px-8">
        <div>
          <Eyebrow>Account</Eyebrow>
          <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">Delete your {APP_NAME} account</h1>
          <p className="mt-6 text-lg leading-8 text-zinc-600">
            Send us the email address you sign in with and we&apos;ll permanently delete your account within 30 days. We may email you
            at that address to confirm the request came from you.
          </p>
          <h2 className="mt-10 text-sm font-semibold text-zinc-900">What gets deleted</h2>
          <ul className="mt-4 space-y-3 text-[15px]">
            <Check>Your account, sign-in details and profile</Check>
            <Check>Messages, files, clips and reactions you posted</Check>
            <Check>Your company memberships, devices and notification tokens</Check>
          </ul>
          <p className="mt-8 text-sm leading-6 text-zinc-500">
            If you own a company workspace, transfer ownership to another member first, or tell us in your message to delete the whole
            company and everything in it. Nothing is kept after deletion. See our <Link href="/privacy" className="font-medium text-tm-blue hover:underline">privacy policy</Link> for details.
          </p>
        </div>
        <ContactForm initialMessage={`Please delete my ${APP_NAME} account and all of its data.`} />
      </div>
    </section>
  );
}
