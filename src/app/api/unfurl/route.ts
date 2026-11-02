import type { NextRequest } from "next/server";
import { APP_NAME } from "@/lib/brand";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// Blocks requests to loopback, private and link-local addresses (SSRF guard)
function isPrivate(ip: string): boolean {
  if (isIP(ip) === 6) return ip === "::1" || /^f[cd]/i.test(ip) || /^fe80/i.test(ip) || ip.startsWith("::ffff:") && isPrivate(ip.slice(7));
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

const meta = (html: string, key: string) =>
  html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${key}["'][^>]+content=["']([^"']*)["']`, "i"))?.[1] ??
  html.match(new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${key}["']`, "i"))?.[1];

const decode = (s?: string) =>
  s?.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("url") ?? "";
  let url: URL;
  try {
    url = new URL(raw);
    if (!["http:", "https:"].includes(url.protocol)) throw 0;
    const { address } = await lookup(url.hostname);
    if (isPrivate(address)) throw 0;
  } catch {
    return Response.json(null, { status: 400 });
  }

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000), redirect: "follow", headers: { "user-agent": `${APP_NAME}Bot/1.0` } });
    if (!res.ok || !res.headers.get("content-type")?.includes("text/html")) return Response.json(null);
    const html = (await res.text()).slice(0, 300_000);
    const title = decode(meta(html, "og:title") ?? html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]);
    if (!title) return Response.json(null);
    const image = meta(html, "og:image");
    return Response.json(
      {
        title,
        description: decode(meta(html, "og:description") ?? meta(html, "description"))?.slice(0, 300),
        image: image ? new URL(decode(image)!, url).toString() : null,
        site: decode(meta(html, "og:site_name")) ?? url.hostname,
      },
      { headers: { "cache-control": "public, max-age=86400" } },
    );
  } catch {
    return Response.json(null);
  }
}
