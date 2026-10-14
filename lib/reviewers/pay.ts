// Pure helpers for reviewer pay. No DB access here so this is safe to unit test.

import { approvedMinutes, decisionFromEvent } from "@/lib/ari/inbound";
import type { AriDelivery } from "@/lib/ari/inbound";
import type { DecisionKind } from "@/lib/review/decisions";

export type PayTier = { id: string; label: string; usd: number; fits: (hours: number) => boolean };

// Pay per reviewed project, by the hours on the project. First tier that fits wins.
//   under 4h       -> $1 per 4 projects  = $0.25 each
//   4h  to 10h     -> $1 per 2 projects  = $0.50 each
//   over 10h to 60h-> $1 per project
//   over 60h       -> $2 per project
// Change the numbers here only. Ledger rows already written keep what they paid.
export const PAY_TIERS: PayTier[] = [
  { id: "small", label: "under 4h", usd: 0.25, fits: (h) => h < 4 },
  { id: "medium", label: "4h to 10h", usd: 0.5, fits: (h) => h <= 10 },
  { id: "large", label: "10h to 60h", usd: 1, fits: (h) => h <= 60 },
  { id: "huge", label: "over 60h", usd: 2, fits: () => true },
];

export function tierForMinutes(minutes: number | null | undefined): PayTier {
  const hours = Math.max(0, Number(minutes) || 0) / 60;
  return PAY_TIERS.find((tier) => tier.fits(hours)) ?? PAY_TIERS[PAY_TIERS.length - 1];
}

export function payForMinutes(minutes: number | null | undefined): number {
  return tierForMinutes(minutes).usd;
}

export function usd(amount: number): string {
  const value = Math.round(Number(amount) * 100) / 100;
  const sign = value < 0 ? "-" : "";
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

export function roundCents(amount: number): number {
  return Math.round(Number(amount) * 100) / 100;
}

export function normaliseSlackId(value: string): string {
  return value.trim().toUpperCase();
}

export function normaliseEmail(value: string): string {
  return value.trim().toLowerCase();
}

export type ReviewerIdentity = {
  slackId: string | null;
  email: string | null;
  name: string | null;
};

type Loose = Record<string, unknown>;

function asObject(value: unknown): Loose | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Loose) : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

const SLACK_ID = /^[UW][A-Z0-9]{6,}$/i;

function fromObject(value: unknown): ReviewerIdentity | null {
  const obj = asObject(value);
  if (!obj) return null;
  const slack = str(obj.slack_id) ?? str(obj.slackId) ?? str(obj.slack);
  const email = str(obj.email);
  const name = str(obj.name) ?? str(obj.display_name) ?? str(obj.username);
  if (!slack && !email) return null;
  return {
    slackId: slack ? normaliseSlackId(slack) : null,
    email: email ? normaliseEmail(email) : null,
    name,
  };
}

function fromString(value: unknown): ReviewerIdentity | null {
  const text = str(value);
  if (!text) return null;
  if (text.includes("@")) return { slackId: null, email: normaliseEmail(text), name: null };
  if (SLACK_ID.test(text)) return { slackId: normaliseSlackId(text), email: null, name: null };
  return null;
}

// Ari's delivery format is not documented in this repo, so we look in every place a
// reviewer is plausibly named. Never reads payload.maker (that is the participant).
// If your payloads use a different key, add it here — this is the only place to change.
export function reviewerFromPayload(payload: unknown): ReviewerIdentity | null {
  const root = asObject(payload);
  if (!root) return null;
  const review = asObject(root.review) ?? {};

  const objects = [
    root.reviewer,
    review.reviewer,
    root.reviewed_by,
    review.reviewed_by,
    root.actor,
  ];
  for (const candidate of objects) {
    const found = fromObject(candidate);
    if (found) return found;
  }

  const strings = [
    root.reviewer,
    review.reviewer,
    root.reviewed_by,
    review.reviewed_by,
    root.reviewer_slack_id,
    review.reviewer_slack_id,
    root.reviewer_email,
    review.reviewer_email,
  ];
  for (const candidate of strings) {
    const found = fromString(candidate);
    if (found) return found;
  }

  return null;
}

export type ReviewCredit = {
  decision: DecisionKind;
  approvedMinutes: number;
  usd: number;
  reviewer: ReviewerIdentity | null;
};

// Turns one stored Ari delivery into what the reviewer earned for it, or null if the
// delivery is not a review decision (reverts, requeues, status pings…).
export function creditFromDelivery(payload: unknown): ReviewCredit | null {
  const delivery = asObject(payload) as AriDelivery | null;
  if (!delivery) return null;
  const decision = decisionFromEvent(delivery);
  if (!decision) return null;

  // Only approvals carry hours. Changes/rejections are still paid, at the hours Ari
  // reports if any, otherwise the smallest tier.
  const minutes = approvedMinutes(delivery);
  return {
    decision,
    approvedMinutes: minutes,
    usd: payForMinutes(minutes),
    reviewer: reviewerFromPayload(payload),
  };
}
