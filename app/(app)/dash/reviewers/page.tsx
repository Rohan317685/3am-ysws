import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app/AppShell";
import { Banner } from "@/components/ui/Banner";
import { Panel, PanelLabel } from "@/components/ui/Panel";
import { StatCard } from "@/components/ui/StatCard";
import { requireOrganizer } from "@/lib/auth/organizer";
import { leaderboard, namesForSlackIds, payoutsStart, reviewerSummaries, syncReviewerLedgerSafely } from "@/lib/reviewers";
import { openInvoices } from "@/lib/reviewers/invoices";
import { usd } from "@/lib/reviewers/pay";

import { AddReviewer, InvoiceActions, LiveRefresh, PayButton, QuickAdd } from "./Controls";
import { Leaderboard, TierList, WHEN, parsePeriod } from "./parts";
import styles from "./reviewers.module.css";

export const metadata: Metadata = { title: "reviewers" };
export const dynamic = "force-dynamic";

export default async function ReviewersPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  if (!(await requireOrganizer())) notFound();
  const period = parsePeriod((await searchParams).period);
  const sync = await syncReviewerLedgerSafely("admin page");
  const [all, board, invoices, start] = await Promise.all([reviewerSummaries(), leaderboard(period), openInvoices(), payoutsStart()]);
  const active = all.filter((r) => !r.removedAt);
  const removed = all.filter((r) => r.removedAt);
  const owedNow = all.reduce((sum, r) => sum + r.owed, 0);
  const paidOut = all.reduce((sum, r) => sum + r.paidOut, 0);
  const paidReviews = all.reduce((sum, r) => sum + r.paidReviews, 0);
  const invoiced = new Map(invoices.map((row) => [row.invoice.reviewerId, row.invoice]));
  const unmatched = sync?.unmatched ?? [];
  const names = await namesForSlackIds(unmatched.map((u) => u.slackId).filter((id): id is string => Boolean(id)));

  const row = (r: (typeof all)[number]) => {
    const invoice = invoiced.get(r.id);
    return <div key={r.id} className={[styles.reviewer, r.removedAt ? styles.removed : null].filter(Boolean).join(" ")}>
      <Link href={`/dash/reviewers/${r.id}`} className={styles.who}>
        <span className={styles.name}>{r.name}</span>
        <span className={styles.sub}>{r.slackId}{r.lastPaidAt ? ` · last paid ${WHEN.format(r.lastPaidAt)}` : ""}{r.removedAt ? " · removed" : ""}</span>
      </Link>
      {invoice ? <span className={styles.tag}>invoiced {usd(invoice.amount)}</span> : null}
      <span className={[styles.num, styles.hideSmall].join(" ")}>{r.reviews} reviews</span>
      <span className={[styles.num, styles.owed].join(" ")}>{usd(r.owed)}</span>
      <PayButton reviewerId={r.id} name={r.name} owed={r.owed} label={usd(r.owed)} />
    </div>;
  };

  return <AppShell title="reviewers" action={<LiveRefresh />}>
    <div className={styles.cards}>
      <StatCard accent label="owed right now" value={usd(owedNow)} sub="in circulation, not paid yet" />
      <StatCard label="paid out" value={usd(paidOut)} sub="through this page" />
      <StatCard label="paid reviews" value={paidReviews} sub={`since ${WHEN.format(start)} UTC`} />
      <StatCard label="reviewers" value={active.length} sub={invoices.length ? `${invoices.length} invoice(s) in process` : "no open invoices"} />
    </div>
    {sync === null ? <Banner tone="bad" title="could not sync with Ari history">Check the server logs for “[reviewers] sync failed”. Balances shown may be behind.</Banner> : null}
    {invoices.length > 0 ? <Panel>
      <PanelLabel>invoices in process</PanelLabel>
      <div className={styles.list}>{invoices.map(({ invoice, name }) => <div key={invoice.id} className={styles.reviewer}>
        <Link href={`/dash/reviewers/${invoice.reviewerId}`} className={styles.who}>
          <span className={styles.name}>{name}</span>
          <span className={styles.sub}>{WHEN.format(invoice.requestedAt)}{invoice.slackSentAt ? " · sent to Slack" : " · Slack DM not sent"}{invoice.note ? ` · ${invoice.note}` : ""}</span>
        </Link>
        <span className={[styles.num, styles.owed].join(" ")}>{usd(invoice.amount)}</span>
        <InvoiceActions reviewerId={invoice.reviewerId} invoiceId={invoice.id} slackSent={Boolean(invoice.slackSentAt)} />
      </div>)}</div>
      <p className={styles.none}>Tick ✓ on the reviewer below once you have paid them. That closes the invoice.</p>
    </Panel> : null}
    <Panel>
      <PanelLabel>{active.length === 1 ? "1 reviewer" : `${active.length} reviewers`}</PanelLabel>
      {active.length === 0 ? <p className={styles.none}>No reviewers yet. Add one below.</p> : <div className={styles.list}>{active.map(row)}</div>}
    </Panel>
    <Panel><PanelLabel>leaderboard</PanelLabel><Leaderboard rows={board} period={period} basePath="/dash/reviewers" showMoney /></Panel>
    <Panel><PanelLabel>add a reviewer</PanelLabel><AddReviewer /></Panel>
    {unmatched.length > 0 ? <Panel>
      <PanelLabel>reviewing in Ari but not added here</PanelLabel>
      <div className={styles.list}>{unmatched.map((u) => {
        const name = u.name ?? (u.slackId ? names.get(u.slackId) : undefined) ?? u.slackId ?? u.email ?? "unknown";
        return <div key={u.key} className={styles.reviewer}>
          <span className={styles.who}><span className={styles.name}>{name}</span><span className={styles.sub}>{[u.slackId, u.email].filter(Boolean).join(" · ")}</span></span>
          <span className={styles.num}>{u.reviews} reviews</span>
          {u.slackId ? <QuickAdd slackId={u.slackId} name={name} email={u.email} /> : null}
        </div>;
      })}</div>
    </Panel> : null}
    {sync && sync.unattributed > 0 ? <Banner tone="warn" title={`${sync.unattributed} Ari decision(s) name no reviewer`}>Those deliveries carry no reviewer we can read, so nobody is credited for them. See reviewerFromPayload in lib/reviewers/pay.ts.</Banner> : null}
    <Panel><PanelLabel>pay per reviewed project</PanelLabel><TierList /><p className={styles.none}>Reviews before {WHEN.format(start)} UTC were already paid. They show in history at $0.00.</p></Panel>
    {removed.length > 0 ? <Panel><PanelLabel>removed</PanelLabel><div className={styles.list}>{removed.map(row)}</div></Panel> : null}
  </AppShell>;
}
