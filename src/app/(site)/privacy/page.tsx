import type { Metadata } from "next";
import Link from "next/link";
import { APP_NAME } from "@/lib/brand";
import { Eyebrow } from "@/components/site/Site";

export const metadata: Metadata = {
  title: "Privacy policy",
  description: `How ${APP_NAME} collects, uses and protects your information across the web, desktop, Android and iOS apps.`,
};

const UPDATED = "November 13, 2026";

function H2({ id, children }: { id?: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mt-12 scroll-mt-24 text-2xl font-bold tracking-tight text-zinc-900">
      {children}
    </h2>
  );
}
const P = ({ children }: { children: React.ReactNode }) => <p className="mt-4 leading-7 text-zinc-600">{children}</p>;
const UL = ({ children }: { children: React.ReactNode }) => <ul className="mt-4 list-disc space-y-2 pl-6 leading-7 text-zinc-600">{children}</ul>;
const B = ({ children }: { children: React.ReactNode }) => <strong className="font-semibold text-zinc-800">{children}</strong>;
const A = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <Link href={href} className="font-medium text-tm-blue underline-offset-2 hover:underline">
    {children}
  </Link>
);

export default function Privacy() {
  return (
    <section className="bg-gradient-to-b from-tm-blue-light/60 to-white to-[22rem]">
      <article className="mx-auto max-w-3xl px-4 py-20 sm:px-6 sm:py-24">
        <Eyebrow>Legal</Eyebrow>
        <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">Privacy policy</h1>
        <p className="mt-4 text-sm text-zinc-500">Last updated: {UPDATED}</p>

        <P>
          This policy explains what information {APP_NAME} collects when you use our website, web app, desktop apps and mobile apps for
          Android and iOS (together, the &ldquo;Service&rdquo;), how we use it, who we share it with and the choices you have. {APP_NAME} is
          a workplace communication tool: companies create a workspace and their people use it for channels, direct messages, calls,
          meetings, files, canvases and tasks.
        </P>

        <H2>Information we collect</H2>
        <P>
          <B>Account information.</B> When you sign up we collect your name, email address, username and password (stored only as a
          secure hash, never in readable form). You can add a profile photo, a status, and in a company profile a job title, department
          and phone number.
        </P>
        <P>
          <B>Company information.</B> If you create a company workspace we store its name, handle and any details you add, such as a logo,
          website, industry, size and verified email domains.
        </P>
        <P>
          <B>Content you share.</B> Messages, threads, reactions, files, photos, videos, voice and video clips, canvases, projects and tasks,
          meetings and reminders that you and your teammates create in the Service.
        </P>
        <P>
          <B>Calls and screen sharing.</B> Audio, video and shared screens in calls are streamed directly between participants&apos; devices,
          and when a direct connection is not possible they pass, encrypted, through a relay server. We do not record calls. We keep a call
          log (who took part, when, and how long) and any call summary that participants choose to post.
        </P>
        <P>
          <B>Device and technical information.</B> To deliver notifications we store a push notification token for each device you sign in
          on, along with the platform (Android, iOS, web or desktop). Our hosting providers automatically process technical data such as IP
          address, browser or device type and request logs to run and secure the Service.
        </P>
        <P>
          <B>Messages to us.</B> If you use our contact form we collect your name, email, company, team size and your message.
        </P>
        <P>
          We do not use advertising, we do not sell your information, and we do not use third-party tracking or advertising SDKs.
        </P>

        <H2>Device permissions</H2>
        <P>The mobile and desktop apps ask for these permissions only when you use the related feature, and you can turn them off at any time in your device settings:</P>
        <UL>
          <li><B>Camera and microphone:</B> for calls, video clips, voice clips and taking photos to share.</li>
          <li><B>Photos and files:</B> to share the images, videos and documents you choose.</li>
          <li><B>Notifications:</B> for new messages, mentions, thread replies, task assignments and incoming calls.</li>
          <li><B>Full-screen notifications (Android):</B> to show an incoming call over the lock screen so you can answer or decline it.</li>
          <li><B>Foreground services (Android):</B> to keep your microphone working during a call and to share your screen when you choose to, while the app is in the background.</li>
          <li><B>Bluetooth:</B> to use Bluetooth headsets in calls.</li>
        </UL>

        <H2>How we use information</H2>
        <UL>
          <li>To provide the Service: sign you in, deliver messages and files, connect calls and show your workspace.</li>
          <li>To send notifications and service emails, such as invitations, password resets and task assignment emails.</li>
          <li>To keep the Service secure, prevent abuse and spam, and fix problems.</li>
          <li>To enforce plan limits and respond to support and upgrade requests.</li>
          <li>To comply with legal obligations.</li>
        </UL>

        <H2>AI summaries</H2>
        <P>
          On paid plans, members can ask for an AI summary of a channel or thread. Only when someone asks for a summary, the recent messages
          they are allowed to see in that conversation are sent to our AI provider, Anthropic, to generate it. Anthropic processes this content
          on our behalf and does not use it to train its models. Summaries are not created automatically.
        </P>

        <H2>Who can see your information</H2>
        <P>
          <B>Your workspace.</B> Members of your company can see your profile and the content you post in conversations they belong to.
          Company owners and admins can manage members, change message retention, review the audit log and use the other admin tools for
          their company.
        </P>
        <P>
          <B>Service providers.</B> We use trusted providers that process data only to run the Service for us:
        </P>
        <UL>
          <li><B>Supabase:</B> database, sign-in and file storage.</li>
          <li><B>Vercel:</B> website and server hosting.</li>
          <li><B>Google Firebase Cloud Messaging, Apple Push Notification service and Expo:</B> delivering push notifications to your devices.</li>
          <li><B>Cloudflare:</B> relaying call audio and video when a direct connection is not possible.</li>
          <li><B>Email providers (Resend or Google):</B> sending service emails.</li>
          <li><B>Anthropic:</B> AI summaries, only when requested on paid plans.</li>
        </UL>
        <P>
          <B>Legal reasons.</B> We may disclose information if required by law, or to protect the rights, property or safety of our users or
          others. If {APP_NAME} is involved in a merger or acquisition, information may be transferred as part of that transaction under this
          policy.
        </P>

        <H2>Security</H2>
        <P>
          All data is encrypted in transit using HTTPS/TLS and stored with providers that encrypt it at rest. Access inside the database is
          limited by row-level security, so people only see the companies and conversations they belong to.
        </P>

        <H2>Retention</H2>
        <P>
          We keep your information while your account is active. Company admins can set message retention so older messages are deleted
          automatically. When you delete a message it is removed from view, and when an account or company is deleted its data is permanently
          removed from our systems.
        </P>

        <H2 id="delete">Deleting your account and data</H2>
        <P>
          You can ask us to delete your account at any time on our <A href="/delete-account">account deletion page</A>. We permanently delete
          your account, profile, messages and files within 30 days. If you own a company workspace, transfer ownership to another member or
          ask us to delete the whole company. You can also remove individual messages and files yourself in the app, and leave a company from
          your profile.
        </P>

        <H2>Your rights</H2>
        <P>
          Depending on where you live, you may have the right to access, correct, export or delete your personal information, and to object to
          or restrict how we use it. You can update most of your information in the app. For anything else, <A href="/contact">contact us</A> and
          we will respond within 30 days.
        </P>

        <H2>Children</H2>
        <P>
          {APP_NAME} is a workplace tool and is not directed at children. We do not knowingly collect information from anyone under 16. If you
          believe a child has given us personal information, <A href="/contact">contact us</A> and we will delete it.
        </P>

        <H2>International transfers</H2>
        <P>
          Our providers may process information in countries other than the one where you live. Where required, they protect it with
          safeguards such as standard contractual clauses.
        </P>

        <H2>Changes to this policy</H2>
        <P>
          We may update this policy from time to time. We will change the date at the top and, for significant changes, let you know in the
          app or by email.
        </P>

        <H2>Contact us</H2>
        <P>
          Questions about this policy or your information? Reach us through our <A href="/contact">contact form</A>.
        </P>
      </article>
    </section>
  );
}
