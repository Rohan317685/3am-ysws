import { NextResponse } from "next/server";

import { getCurrentUser } from "@/lib/auth/users";
import { reviewerForSlackId, syncReviewerLedgerSafely } from "@/lib/reviewers";
import { requestInvoice } from "@/lib/reviewers/invoices";
import { usd } from "@/lib/reviewers/pay";

export const dynamic = "force-dynamic";

// A reviewer invoices for everything they are owed right now.
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const reviewer = await reviewerForSlackId(user.slackId);
  if (!reviewer) return NextResponse.json({ error: "not found" }, { status: 404 });

  let note: string | null = null;
  try {
    const body = (await request.json()) as { note?: string };
    note = body.note?.trim().slice(0, 500) || null;
  } catch {
    note = null;
  }

  // Make sure any review that just landed is included before snapshotting the amount.
  await syncReviewerLedgerSafely("invoice");

  const outcome = await requestInvoice(reviewer, note);
  if (outcome.status === "nothing_owed") {
    return NextResponse.json(
      { error: "invalid", message: "You are owed $0.00 right now." },
      { status: 409 },
    );
  }
  if (outcome.status === "already_open") {
    return NextResponse.json(
      {
        error: "invalid",
        message: `You already have an invoice in process for ${usd(outcome.invoice.amount)}.`,
      },
      { status: 409 },
    );
  }

  return NextResponse.json({
    ok: true,
    amount: outcome.invoice.amount,
    slackSent: outcome.slackSent,
  });
}
