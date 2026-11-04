import type { Metadata } from "next";
import Link from "next/link";
import { APP_NAME } from "@/lib/brand";
import { tiers, comparison, faqs } from "@/lib/plans";
import { Icon } from "@/components/icons";
import { Eyebrow, Check, CtaBand, NAVY, btnPrimary, btnOutline } from "@/components/site/Site";

export const metadata: Metadata = {
  title: "Pricing",
  description: `${APP_NAME} is free for small teams. Pro is $100 a month per company for unlimited history, group calls, AI summaries and admin controls.`,
};

function Cell({ v }: { v: string | boolean }) {
  if (v === true)
    return (
      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-tm-green/15 text-tm-green" aria-label="Included">
        <Icon name="check" size={14} />
      </span>
    );
  if (v === false) return <span className="text-zinc-300" aria-label="Not included">—</span>;
  return <span className="text-sm text-zinc-700">{v}</span>;
}

export default function Pricing() {
  return (
    <>
      <section className="bg-gradient-to-b from-tm-blue-light/70 to-white">
        <div className="mx-auto max-w-7xl px-4 pt-20 pb-12 text-center sm:px-6 sm:pt-24 lg:px-8">
          <Eyebrow>Pricing</Eyebrow>
          <h1 className="mx-auto mt-4 max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">Simple pricing for every company</h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg leading-8 text-zinc-600">
            Start free. Upgrade when your team needs more. One flat price per company, not per person.
          </p>
        </div>
      </section>

      <section className="mx-auto grid max-w-7xl gap-6 px-4 pb-20 sm:px-6 lg:grid-cols-3 lg:px-8">
        {tiers.map((t) => {
          const featured = t.id === "pro";
          return (
            <div
              key={t.id}
              className={`relative flex flex-col rounded-3xl p-8 ${featured ? "text-white shadow-2xl ring-1 ring-black/10 lg:-my-4 lg:py-12" : "border border-zinc-200 bg-white"}`}
              style={featured ? { background: NAVY } : undefined}
            >
              {featured && (
                <span className="absolute -top-3 left-8 rounded-full bg-tm-green px-3 py-1 text-xs font-semibold text-white shadow">Recommended</span>
              )}
              <h2 className="text-xl font-semibold">{t.name}</h2>
              <p className={`mt-2 min-h-12 text-sm leading-6 ${featured ? "text-white/70" : "text-zinc-600"}`}>{t.blurb}</p>
              <p className="mt-6 flex items-baseline gap-2">
                <span className="text-5xl font-bold tracking-tight">{t.price}</span>
                <span className={`text-sm ${featured ? "text-white/60" : "text-zinc-500"}`}>{t.per}</span>
              </p>
              <Link
                href={t.href}
                className={`mt-8 ${featured ? "inline-flex items-center justify-center rounded-xl bg-tm-green px-5 py-3 text-sm font-semibold text-white transition hover:brightness-95" : t.id === "enterprise" ? btnOutline : btnPrimary}`}
              >
                {t.cta}
              </Link>
              <ul className="mt-8 space-y-3 text-[15px]">
                {t.highlights.map((h) => (
                  <Check key={h} light={featured}>
                    {h}
                  </Check>
                ))}
              </ul>
            </div>
          );
        })}
      </section>

      <section className="bg-tm-surface py-20">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">Compare plans</h2>
          <div className="mt-12 overflow-x-auto rounded-2xl border border-zinc-200 bg-white">
            <table className="w-full min-w-[560px] text-left">
              <thead>
                <tr className="border-b border-zinc-200">
                  <th className="p-4 text-sm font-medium text-zinc-500">Feature</th>
                  {tiers.map((t) => (
                    <th key={t.id} className="p-4 text-center text-sm font-semibold">
                      {t.name}
                    </th>
                  ))}
                </tr>
              </thead>
              {comparison.map(([group, rows]) => (
                <tbody key={group}>
                  <tr>
                    <th colSpan={4} className="bg-tm-surface/70 px-4 py-2 text-xs font-semibold tracking-wide text-zinc-500 uppercase">
                      {group}
                    </th>
                  </tr>
                  {rows.map(([label, ...cells]) => (
                    <tr key={label} className="border-t border-zinc-100">
                      <td className="p-4 text-sm text-zinc-800">{label}</td>
                      {cells.map((c, i) => (
                        <td key={i} className="p-4 text-center">
                          <Cell v={c} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              ))}
            </table>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-3xl px-4 py-20 sm:px-6 lg:px-8">
        <h2 className="text-center text-3xl font-bold tracking-tight sm:text-4xl">Questions, answered</h2>
        <div className="mt-10 divide-y divide-zinc-200 border-y border-zinc-200">
          {faqs.map(([q, a]) => (
            <details key={q} className="group py-5">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left font-semibold [&::-webkit-details-marker]:hidden">
                {q}
                <Icon name="chevronDown" size={18} className="text-zinc-400 transition group-open:rotate-180" />
              </summary>
              <p className="mt-3 leading-7 text-zinc-600">{a}</p>
            </details>
          ))}
        </div>
        <p className="mt-10 text-center text-zinc-600">
          Something else?{" "}
          <Link href="/contact" className="font-semibold text-tm-blue hover:underline">
            Get in touch
          </Link>
        </p>
      </section>

      <CtaBand />
    </>
  );
}
