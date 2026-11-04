import type { Metadata } from "next";
import { APP_NAME } from "@/lib/brand";
import { Header, Footer } from "@/components/site/Site";
import AppOnly from "@/components/site/AppOnly";

// The public website (/, /features, /download, …). The app itself is at /app.
export const metadata: Metadata = {
  title: { default: `${APP_NAME}: where your team talks, meets and gets work done`, template: `%s | ${APP_NAME}` },
  description: `${APP_NAME} brings channels, direct messages, video meetings, canvases and workflows together in one place for your whole company.`,
  openGraph: { siteName: APP_NAME, type: "website" },
};

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-col bg-white text-zinc-900">
      <AppOnly />
      <Header />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
