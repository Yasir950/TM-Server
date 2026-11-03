"use client";

import { renderBody } from "@/lib/format";
import type { Block } from "@/lib/supabase";

type Text = { type: "plain_text" | "mrkdwn"; text: string };
const none = new Set<string>();
const safeUrl = (u?: string) => (u && /^https?:\/\//i.test(u) ? u : undefined);

// Plain text is escaped by the same renderer, without mention/channel linking
const T = ({ t, className = "" }: { t?: Text; className?: string }) =>
  t ? <span className={className} dangerouslySetInnerHTML={{ __html: renderBody(t.text ?? "", new Map(), none) }} /> : null;

// Renders the Block Kit subset in Block; unknown block types are skipped
export default function BlockKit({ blocks }: { blocks: Block[] }) {
  return (
    <div className="mt-1 max-w-xl space-y-2 border-l-4 border-tm-line pl-3 text-[15px]">
      {blocks.map((b, i) => {
        switch (b.type) {
          case "header":
            return <T key={i} t={b.text} className="block text-lg font-bold" />;
          case "divider":
            return <hr key={i} className="border-tm-line" />;
          case "section":
            return (
              <div key={i} className="flex gap-3">
                <div className="min-w-0 flex-1">
                  <T t={b.text} className="tm-rich block" />
                  {b.fields && (
                    <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-1">
                      {b.fields.map((f, j) => (
                        <T key={j} t={f} className="tm-rich block" />
                      ))}
                    </div>
                  )}
                </div>
                {safeUrl(b.accessory?.image_url) && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={safeUrl(b.accessory?.image_url)} alt={b.accessory?.alt_text ?? ""} className="h-20 w-20 shrink-0 rounded-lg object-cover" />
                )}
              </div>
            );
          case "context":
            return (
              <div key={i} className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-500">
                {b.elements.map((e, j) =>
                  e.type === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    safeUrl(e.image_url) && <img key={j} src={safeUrl(e.image_url)} alt={e.alt_text ?? ""} className="h-4 w-4 rounded" />
                  ) : (
                    <T key={j} t={e} />
                  ),
                )}
              </div>
            );
          case "image":
            return safeUrl(b.image_url) ? (
              <figure key={i}>
                <T t={b.title} className="block text-sm text-zinc-500" />
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={safeUrl(b.image_url)} alt={b.alt_text ?? ""} className="mt-1 max-h-72 rounded-lg" />
              </figure>
            ) : null;
          case "actions":
            return (
              <div key={i} className="flex flex-wrap gap-2">
                {b.elements.map((e, j) => (
                  <a
                    key={j}
                    href={safeUrl(e.url)}
                    target="_blank"
                    rel="noreferrer"
                    className={`rounded-lg border px-3 py-1 text-sm font-medium transition ${
                      e.style === "primary"
                        ? "border-tm-green bg-tm-green text-white hover:opacity-90"
                        : e.style === "danger"
                          ? "border-red-300 text-red-600 hover:bg-red-50"
                          : "border-tm-line hover:bg-tm-surface"
                    }`}
                  >
                    {e.text?.text}
                  </a>
                ))}
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}
