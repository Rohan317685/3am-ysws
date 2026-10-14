import { and, desc, eq, sql } from "drizzle-orm";

import { organizerSlackIds } from "@/lib/auth/organizer";
import { getDb } from "@/lib/db";
import { reviewerInvoices, reviewerLedger, reviewers } from "@/lib/db/schema";
import type { Reviewer, ReviewerInvoice } from "@/lib/db/schema";
import { sendSlackDm } from "@/lib/slack/notifications";

import { roundCents, usd } from "./pay";

function invoiceRecipient(): string | null {
  const configured = process.env.REVIEWER_INVOICE_SLACK_USER_ID?.trim().toUpperCase();
  return configured || organizerSlackIds()[0] || null;
}

function link(path: string): string {
  const base = process.env.APP_URL?.trim().replace(/\/$/, "");
  return base ? `\n<${base}${path}|open in 3am>` : "";
}

function clean(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export type InvoiceOutcome =
  | { status: "requested"; invoice: ReviewerInvoice; slackSent: boolean }
  | { status: "nothing_owed" }
  | { status: "already_open"; invoice: ReviewerInvoice };

export async function openInvoiceFor(reviewerId: string): Promise<ReviewerInvoice | null> {
  const [row] = await getDb()
    .select()
    .from(reviewerInvoices)
    .where(
      and(eq(reviewerInvoices.reviewerId, reviewerId), eq(reviewerInvoices.status, "requested")),
    )
    .limit(1);
  return row ?? null;
}

export async function invoicesFor(reviewerId: string): Promise<ReviewerInvoice[]> {
  return getDb()
    .select()
    .from(reviewerInvoices)
    .where(eq(reviewerInvoices.reviewerId, reviewerId))
    .orderBy(desc(reviewerInvoices.requestedAt));
}

export async function openInvoices() {
  return getDb()
    .select({ invoice: reviewerInvoices, name: reviewers.name, slackId: reviewers.slackId })
    .from(reviewerInvoices)
    .innerJoin(reviewers, eq(reviewers.id, reviewerInvoices.reviewerId))
    .where(eq(reviewerInvoices.status, "requested"))
    .orderBy(reviewerInvoices.requestedAt);
}

async function sendInvoiceToAdmin(reviewer: Reviewer, invoice: ReviewerInvoice): Promise<boolean> {
  const to = invoiceRecipient();
  if (!to) {
    console.warn(
      "[reviewers] invoice DM skipped: no REVIEWER_INVOICE_SLACK_USER_ID or ORGANIZER_SLACK_IDS",
    );
    return false;
  }

  const [counts] = await getDb()
    .select({
      reviews: sql<number>`count(*) filter (where ${reviewerLedger.kind} = 'review' and ${reviewerLedger.delta} > 0 and ${reviewerLedger.createdAt} > coalesce((
        select max(l2.created_at) from reviewer_ledger l2
        where l2.reviewer_id = ${reviewer.id} and l2.kind = 'payout'
      ), 'epoch'))::int`,
    })
    .from(reviewerLedger)
    .where(eq(reviewerLedger.reviewerId, reviewer.id));

  const message =
    `🧾 *Reviewer invoice* — ${clean(reviewer.name)} (<@${reviewer.slackId}>)\n` +
    `*Amount:* ${usd(invoice.amount)} USD\n` +
    `*Paid reviews since last payout:* ${counts?.reviews ?? 0}\n` +
    (invoice.note ? `*Note:* ${clean(invoice.note)}\n` : "") +
    `Invoice \`${invoice.id.slice(0, 8)}\` · status: in process` +
    link(`/dash/reviewers/${reviewer.id}`);

  const sent = await sendSlackDm(to, message);
  if (sent) {
    await getDb()
      .update(reviewerInvoices)
      .set({ slackSentAt: new Date() })
      .where(eq(reviewerInvoices.id, invoice.id));
  }
  return sent;
}

// Reviewer clicks "invoice": snapshot what they are owed, mark it in process, DM the admin.
export async function requestInvoice(
  reviewer: Reviewer,
  note: string | null,
): Promise<InvoiceOutcome> {
  const db = getDb();

  const outcome = await db.transaction(async (tx) => {
    await tx
      .select({ id: reviewers.id })
      .from(reviewers)
      .where(eq(reviewers.id, reviewer.id))
      .for("update");

    const [open] = await tx
      .select()
      .from(reviewerInvoices)
      .where(
        and(eq(reviewerInvoices.reviewerId, reviewer.id), eq(reviewerInvoices.status, "requested")),
      )
      .limit(1);
    if (open) return { status: "already_open" as const, invoice: open };

    const [row] = await tx
      .select({ owed: sql<string>`coalesce(sum(${reviewerLedger.delta}), 0)` })
      .from(reviewerLedger)
      .where(eq(reviewerLedger.reviewerId, reviewer.id));
    const owed = roundCents(Number(row?.owed ?? 0));
    if (owed <= 0) return { status: "nothing_owed" as const };

    const [invoice] = await tx
      .insert(reviewerInvoices)
      .values({ reviewerId: reviewer.id, amount: owed, note })
      .returning();
    return { status: "created" as const, invoice };
  });

  if (outcome.status !== "created") return outcome;

  // Outside the transaction: Slack being down must not lose the invoice.
  let slackSent = false;
  try {
    slackSent = await sendInvoiceToAdmin(reviewer, outcome.invoice);
  } catch (error) {
    console.error("[reviewers] invoice DM failed", error);
  }
  return { status: "requested", invoice: outcome.invoice, slackSent };
}

export async function resendInvoice(invoiceId: string): Promise<boolean> {
  const [row] = await getDb()
    .select({ invoice: reviewerInvoices, reviewer: reviewers })
    .from(reviewerInvoices)
    .innerJoin(reviewers, eq(reviewers.id, reviewerInvoices.reviewerId))
    .where(and(eq(reviewerInvoices.id, invoiceId), eq(reviewerInvoices.status, "requested")))
    .limit(1);
  if (!row) return false;
  return sendInvoiceToAdmin(row.reviewer, row.invoice);
}

// Best-effort DM to the reviewer after a payout or a declined invoice.
export async function tellReviewer(
  reviewer: Pick<Reviewer, "slackId">,
  message: string,
): Promise<void> {
  try {
    await sendSlackDm(reviewer.slackId, message);
  } catch (error) {
    console.error("[reviewers] reviewer DM failed", error);
  }
}

export function paidMessage(amount: number): string {
  return `💸 *You've been paid ${usd(amount)}* for your 3am reviews. Your balance is back to $0.00 — thanks for reviewing!${link("/dash/payout")}`;
}

export function declinedMessage(amount: number, reason: string | null): string {
  return (
    `🧾 Your 3am invoice for ${usd(amount)} was declined.` +
    (reason ? `\n*Why:* ${clean(reason)}` : "") +
    `\nYour balance is unchanged; you can invoice again.${link("/dash/payout")}`
  );
}
