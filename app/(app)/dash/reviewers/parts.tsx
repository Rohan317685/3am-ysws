import Link from "next/link";

import type { ReviewerInvoice } from "@/lib/db/schema";
import type { LeaderPeriod, LeaderRow } from "@/lib/reviewers";
import type { reviewerHistory } from "@/lib/reviewers";
import { PAY_TIERS, usd } from "@/lib/reviewers/pay";

import styles from "./reviewers.module.css";

export const WHEN = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC",
});
const DAY = new Intl.DateTimeFormat("en-GB", {
  day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
});

export function hours(minutes: number | null | undefined): string {
  return `${Math.round(((minutes ?? 0) / 60) * 10) / 10}h`;
}

export function TierList() {
  return <div className={styles.tiers}>{PAY_TIERS.map((tier) => <span key={tier.id}>{tier.label} → {usd(tier.usd)}</span>)}</div>;
}

type History = Awaited<ReturnType<typeof reviewerHistory>>;
export function HistoryList({ entries, linkProjects }: { entries: History; linkProjects: boolean }) {
  if (entries.length === 0) return <p className={styles.none}>Nothing yet.</p>;
  return <div>{entries.map((entry) => {
    const delta = Number(entry.delta);
    const tone = delta > 0 ? styles.up : delta < 0 ? styles.down : styles.zero;
    const title = entry.projectTitle ?? "a project";
    return <div key={entry.id} className={styles.entry}>
      <span className={[styles.delta, tone].join(" ")}>{delta > 0 ? `+${usd(delta)}` : usd(delta)}</span>
      <span className={styles.why}>
        {entry.kind === "review" ? <>
          {entry.decision ?? "reviewed"}{" "}
          {linkProjects && entry.projectId ? <Link href={`/dash/ships/${entry.projectId}`}>{title}</Link> : title} · {hours(entry.approvedMinutes)}
        </> : entry.kind === "payout" ? <>paid out</> : <>adjustment</>}
        {entry.note ? ` · ${entry.note}` : ""}
        {entry.kind !== "review" && entry.createdBy ? ` · by ${entry.createdBy}` : ""}
      </span>
      <span className={styles.when}>{WHEN.format(entry.createdAt)}</span>
    </div>;
  })}</div>;
}

export function InvoiceList({ invoices }: { invoices: ReviewerInvoice[] }) {
  if (invoices.length === 0) return <p className={styles.none}>No invoices yet.</p>;
  return <div>{invoices.map((invoice) => <div key={invoice.id} className={styles.entry}>
    <span className={styles.delta}>{usd(invoice.amount)}</span>
    <span className={styles.why}>
      {invoice.status === "requested" ? "in process" : invoice.status}
      {invoice.status === "paid" && invoice.paidAmount !== null && Number(invoice.paidAmount) !== Number(invoice.amount)
        ? ` · ${usd(invoice.paidAmount)} paid (balance grew after invoicing)` : ""}
      {invoice.note ? ` · ${invoice.note}` : ""}
    </span>
    <span className={styles.when}>{DAY.format(invoice.requestedAt)}{invoice.closedAt ? ` → ${DAY.format(invoice.closedAt)}` : ""}</span>
  </div>)}</div>;
}

const PERIODS: { id: LeaderPeriod; label: string }[] = [
  { id: "week", label: "this week" }, { id: "month", label: "this month" }, { id: "all", label: "all time" },
];

export function Leaderboard({ rows, period, basePath, showMoney, highlightId }: {
  rows: LeaderRow[]; period: LeaderPeriod; basePath: string; showMoney: boolean; highlightId?: string;
}) {
  return <>
    <div className={styles.sortOptions}>{PERIODS.map((option) => <Link key={option.id} href={`${basePath}?period=${option.id}`} className={option.id === period ? styles.on : undefined} scroll={false}>{option.label}</Link>)}</div>
    {rows.length === 0 ? <p className={styles.none}>No reviews in this window yet. First one takes the crown.</p> : <div className={styles.list}>
      {rows.map((row, index) => <div key={row.id} className={[styles.reviewer, row.id === highlightId ? styles.me : null].filter(Boolean).join(" ")}>
        <span className={[styles.rank, index < 3 ? styles.gold : null].filter(Boolean).join(" ")}>{index === 0 ? "👑" : `#${index + 1}`}</span>
        <span className={styles.who}><span className={styles.name}>{row.name}</span>{row.id === highlightId ? <span className={styles.sub}>you</span> : null}</span>
        <span className={styles.num}>{row.reviews} reviews</span>
        <span className={[styles.num, styles.hideSmall].join(" ")}>{hours(row.minutes)}</span>
        {showMoney ? <span className={[styles.num, styles.owed].join(" ")}>{usd(row.earned)}</span> : null}
      </div>)}
    </div>}
  </>;
}

export function parsePeriod(value: string | undefined): LeaderPeriod {
  return value === "week" || value === "all" ? value : "month";
}
