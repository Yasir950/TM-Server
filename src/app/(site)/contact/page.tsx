import type { Metadata } from "next";
import { APP_NAME } from "@/lib/brand";
import { Eyebrow, Check } from "@/components/site/Site";
import { Suspense } from "react";
import ContactForm, { ContactFormFromUrl } from "@/components/site/ContactForm";

export const metadata: Metadata = {
  title: "Contact us",
  description: `Talk to the ${APP_NAME} team about Enterprise plans, pricing or anything else.`,
};

export default function Contact() {
  return (
    <section className="bg-gradient-to-b from-tm-blue-light/70 to-white">
      <div className="mx-auto grid max-w-6xl gap-12 px-4 py-20 sm:px-6 sm:py-24 lg:grid-cols-[1fr_1.2fr] lg:px-8">
        <div>
          <Eyebrow>Contact us</Eyebrow>
          <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">Let&apos;s talk about your team</h1>
          <p className="mt-6 text-lg leading-8 text-zinc-600">
            Tell us what you need and we&apos;ll get back to you by email, usually within one business day.
          </p>
          <ul className="mt-10 space-y-4 text-[15px]">
            <Check>Enterprise plans with custom limits and contracts</Check>
            <Check>Help choosing between Free and Pro</Check>
            <Check>Migrating your team from another chat tool</Check>
            <Check>Nonprofit and education pricing</Check>
          </ul>
        </div>
        {/* The query string is only known in the browser; the static page shows the general form until then */}
        <Suspense fallback={<ContactForm />}>
          <ContactFormFromUrl />
        </Suspense>
      </div>
    </section>
  );
}
