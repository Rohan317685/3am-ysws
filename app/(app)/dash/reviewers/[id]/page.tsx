import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AppShell } from "@/components/app/AppShell";
import { ButtonLink } from "@/components/ui/Button";
import { Panel, PanelLabel } from "@/components/ui/Panel";
import { StatCard } from "@/components/ui/StatCard";
import { requireOrganizer } from "@/lib/auth/organizer";
import { reviewerHistory, reviewerSummaries, syncReviewerLedgerSafely } from "@/lib/reviewers";
import { invoicesFor } from "@/lib/reviewers/invoices";
import { usd } from "@/lib/reviewers/pay";

import { AdjustPay, InvoiceActions, LiveRefresh, PayButton, ToggleReviewer } from "../Controls";
import { HistoryList, InvoiceList, WHEN } from "../parts";
import styles from "../reviewers.module.css";

export const metadata: Metadata = { title: "reviewer" };
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function ReviewerPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await requireOrganizer())) notFound();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  await syncReviewerLedgerSafely("reviewer detail");
  const reviewer = (await reviewerSummaries()).find((r) => r.id === id);
  if (!reviewer) notFound();
  const [history, invoices] = await Promise.all([reviewerHistory(id), invoicesFor(id)]);
  const open = invoices.find((invoice) => invoice.status === "requested");

  return <AppShell title={reviewer.name} action={<span className={styles.actions}><LiveRefresh /><ButtonLink href="/dash/reviewers" variant="ghost">all reviewers</ButtonLink></span>}>
    <div className={styles.cards}>
      <StatCard accent label="owed now" value={usd(reviewer.owed)} sub={open ? `invoiced ${usd(open.amount)}` : "no open invoice"} />
      <StatCard label="paid out" value={usd(reviewer.paidOut)} sub={reviewer.lastPaidAt ? `last ${WHEN.format(reviewer.lastPaidAt)}` : "never"} />
      <StatCard label="earned" value={usd(reviewer.earned)} sub="reviews + adjustments" />
      <StatCard label="reviews" value={reviewer.reviews} sub={`${reviewer.paidReviews} paid, rest before payouts`} />
    </div>
    <Panel>
      <PanelLabel>pay {reviewer.name}</PanelLabel>
      <div className={styles.actions}>
        <PayButton reviewerId={reviewer.id} name={reviewer.name} owed={reviewer.owed} label={usd(reviewer.owed)} />
        <span className={styles.none}>{reviewer.owed > 0 ? `Tick once you have sent ${usd(reviewer.owed)}. Resets them to $0.00.` : "Paid up."}</span>
        {open ? <InvoiceActions reviewerId={reviewer.id} invoiceId={open.id} slackSent={Boolean(open.slackSentAt)} /> : null}
      </div>
    </Panel>
    <Panel><PanelLabel>add or take off money</PanelLabel><AdjustPay reviewerId={reviewer.id} name={reviewer.name} /></Panel>
    <Panel><PanelLabel>full history</PanelLabel><HistoryList entries={history} linkProjects /></Panel>
    <Panel><PanelLabel>invoices</PanelLabel><InvoiceList invoices={invoices} /></Panel>
    <Panel>
      <PanelLabel>{reviewer.slackId}{reviewer.email ? ` · ${reviewer.email}` : ""}</PanelLabel>
      <ToggleReviewer reviewerId={reviewer.id} name={reviewer.name} removed={Boolean(reviewer.removedAt)} />
    </Panel>
  </AppShell>;
}
