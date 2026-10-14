import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app/AppShell";
import { Panel, PanelLabel } from "@/components/ui/Panel";
import { StatCard } from "@/components/ui/StatCard";
import { getCurrentUser } from "@/lib/auth/users";
import {
  leaderboard,
  payoutsStart,
  reviewerForSlackId,
  reviewerHistory,
  reviewerSummaries,
  syncReviewerLedgerSafely,
} from "@/lib/reviewers";
import { invoicesFor } from "@/lib/reviewers/invoices";
import { usd } from "@/lib/reviewers/pay";

import { InvoiceButton, LiveRefresh } from "../reviewers/Controls";
import { HistoryList, InvoiceList, Leaderboard, TierList, WHEN, parsePeriod } from "../reviewers/parts";
import styles from "../reviewers/reviewers.module.css";

export const metadata: Metadata = { title: "my payout" };
export const dynamic = "force-dynamic";

export default async function PayoutPage({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const user = await getCurrentUser();
  const me = await reviewerForSlackId(user?.slackId);
  if (!me) notFound();

  const period = parsePeriod((await searchParams).period);
  await syncReviewerLedgerSafely("reviewer payout page");

  const [summary, history, invoices, board, start] = await Promise.all([
    reviewerSummaries().then((all) => all.find((r) => r.id === me.id)),
    reviewerHistory(me.id),
    invoicesFor(me.id),
    leaderboard(period),
    payoutsStart(),
  ]);
  if (!summary) notFound();

  const open = invoices.find((invoice) => invoice.status === "requested");
  const rank = board.findIndex((row) => row.id === me.id);

  return (
    <AppShell title="my payout" action={<LiveRefresh />}>
      <div className={styles.cards}>
        <StatCard accent label="owed to you" value={usd(summary.owed)} sub={open ? "invoice in process" : "not invoiced yet"} />
        <StatCard label="paid to you" value={usd(summary.paidOut)} sub={summary.lastPaidAt ? `last ${WHEN.format(summary.lastPaidAt)}` : "nothing yet"} />
        <StatCard label="reviews" value={summary.reviews} sub={`${summary.paidReviews} since payouts started`} />
        <StatCard label="rank" value={rank >= 0 ? `#${rank + 1}` : "–"} sub={period === "all" ? "all time" : `this ${period}`} />
      </div>
      <Panel>
        <PanelLabel>get paid</PanelLabel>
        {me.removedAt && summary.owed <= 0 ? <p className={styles.none}>You are no longer on the reviewer team. Thanks for everything!</p> : <InvoiceButton owed={summary.owed} open={Boolean(open)} />}
      </Panel>
      <Panel>
        <PanelLabel>leaderboard</PanelLabel>
        <Leaderboard rows={board} period={period} basePath="/dash/payout" showMoney={false} highlightId={me.id} />
      </Panel>
      <Panel><PanelLabel>your history</PanelLabel><HistoryList entries={history} linkProjects={false} /></Panel>
      <Panel><PanelLabel>your invoices</PanelLabel><InvoiceList invoices={invoices} /></Panel>
      <Panel>
        <PanelLabel>how pay works</PanelLabel>
        <TierList />
        <p className={styles.none}>Every review you finish in Ari lands here within seconds. Reviews before {WHEN.format(start)} UTC were already paid and show at $0.00.</p>
      </Panel>
    </AppShell>
  );
}
