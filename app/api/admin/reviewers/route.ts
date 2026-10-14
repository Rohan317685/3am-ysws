import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

import { isOrganizer } from "@/lib/auth/organizer";
import { getCurrentUser } from "@/lib/auth/users";
import { getDb } from "@/lib/db";
import { reviewers } from "@/lib/db/schema";
import { syncReviewerLedgerSafely } from "@/lib/reviewers";
import { normaliseEmail, normaliseSlackId } from "@/lib/reviewers/pay";

export const dynamic = "force-dynamic";

type Body = { slackId?: string; name?: string; email?: string };

function invalid(field: string, message: string) {
  return NextResponse.json({ error: "invalid", field, message }, { status: 422 });
}

export async function POST(request: Request) {
  const organizer = await getCurrentUser();
  if (!isOrganizer(organizer)) return NextResponse.json({ error: "not found" }, { status: 404 });

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "unreadable" }, { status: 400 });
  }

  const slackId = normaliseSlackId(body.slackId ?? "");
  if (!/^[UW][A-Z0-9]{6,}$/.test(slackId)) {
    return invalid(
      "slackId",
      "That does not look like a Slack ID (starts with U, e.g. U01ABCDEF).",
    );
  }

  const name = body.name?.trim() ?? "";
  if (name.length < 2) return invalid("name", "Give them a name people will recognise.");

  const rawEmail = body.email?.trim() ?? "";
  if (rawEmail && !rawEmail.includes("@")) return invalid("email", "That is not an email.");
  const email = rawEmail ? normaliseEmail(rawEmail) : null;

  const db = getDb();
  const [existing] = await db
    .select()
    .from(reviewers)
    .where(eq(reviewers.slackId, slackId))
    .limit(1);

  if (existing && !existing.removedAt) {
    return invalid("slackId", `${existing.name} is already a reviewer.`);
  }

  if (existing) {
    // Re-adding a removed reviewer restores them; their old history is kept.
    await db
      .update(reviewers)
      .set({ removedAt: null, name, email: email ?? existing.email })
      .where(eq(reviewers.id, existing.id));
  } else {
    await db
      .insert(reviewers)
      .values({ slackId, name, email, addedBy: organizer?.slackId ?? null });
  }

  await syncReviewerLedgerSafely("reviewer added");
  return NextResponse.json({ ok: true });
}
