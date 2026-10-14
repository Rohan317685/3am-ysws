"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";

import { Banner } from "@/components/ui/Banner";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Field";

import styles from "./reviewers.module.css";

type Problem = { field?: string; message: string } | null;

async function send(url: string, body: unknown): Promise<Problem> {
  try {
    const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (response.ok) return null;
    const data = (await response.json().catch(() => ({}))) as { field?: string; message?: string };
    return { field: data.field, message: data.message ?? "That did not save." };
  } catch { return { message: "Could not reach the server." }; }
}

export function LiveRefresh({ seconds = 20 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, seconds * 1000);
    return () => window.clearInterval(timer);
  }, [router, seconds]);
  return <span className={styles.live}><span className={styles.dot} aria-hidden="true" /> live</span>;
}

export function AddReviewer({ prefill }: { prefill?: { slackId?: string; name?: string; email?: string } }) {
  const router = useRouter();
  const ids = useId();
  const [slackId, setSlackId] = useState(prefill?.slackId ?? "");
  const [name, setName] = useState(prefill?.name ?? "");
  const [email, setEmail] = useState(prefill?.email ?? "");
  const [problem, setProblem] = useState<Problem>(null);
  const [busy, setBusy] = useState(false);
  const errorFor = (field: string) => problem?.field === field ? problem.message : undefined;
  async function save() {
    setBusy(true); setProblem(null);
    const result = await send("/api/admin/reviewers", { slackId, name, email });
    setBusy(false);
    if (result) return setProblem(result);
    setSlackId(""); setName(""); setEmail(""); router.refresh();
  }
  return <div className={styles.form}>
    {problem && !problem.field ? <Banner tone="bad">{problem.message}</Banner> : null}
    <div className={styles.row}>
      <Field id={`${ids}-slack`} label="slack id" help="How Ari names them." error={errorFor("slackId")}><Input value={slackId} placeholder="U01ABCDEF" onChange={(e) => setSlackId(e.target.value)} /></Field>
      <Field id={`${ids}-name`} label="name" error={errorFor("name")}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field id={`${ids}-email`} label="email" help="Optional. Used as a fallback match." error={errorFor("email")}><Input value={email} type="email" onChange={(e) => setEmail(e.target.value)} /></Field>
    </div>
    <Button onClick={save} loading={busy} loadingLabel="adding…">add reviewer</Button>
  </div>;
}

export function QuickAdd({ slackId, name, email }: { slackId: string; name: string; email?: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  async function add() {
    setBusy(true);
    const result = await send("/api/admin/reviewers", { slackId, name, email: email ?? "" });
    setBusy(false);
    if (result) return setProblem(result);
    router.refresh();
  }
  return <span className={styles.inline}>{problem ? <span className={styles.bad}>{problem.message}</span> : null}<Button variant="ghost" onClick={add} loading={busy} loadingLabel="adding…">+ add</Button></span>;
}

export function PayButton({ reviewerId, name, owed, label }: { reviewerId: string; name: string; owed: number; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem>(null);
  const nothing = owed <= 0;
  async function pay() {
    if (!window.confirm(`Mark ${label} as paid to ${name}? Their balance goes back to $0.00.`)) return;
    setBusy(true); setProblem(null);
    const result = await send(`/api/admin/reviewers/${reviewerId}`, { action: "payout", expected: owed });
    setBusy(false); if (result) setProblem(result); router.refresh();
  }
  return <span className={styles.inline}>
    {problem ? <span className={styles.bad}>{problem.message}</span> : null}
    <button type="button" className={[styles.tick, nothing ? styles.tickDone : null].filter(Boolean).join(" ")} onClick={pay} disabled={nothing || busy} title={nothing ? "nothing owed" : `mark ${label} paid`} aria-label={nothing ? `${name} is paid up` : `mark ${label} paid to ${name}`}>{busy ? "…" : "✓"}</button>
  </span>;
}

export function AdjustPay({ reviewerId, name }: { reviewerId: string; name: string }) {
  const router = useRouter(); const ids = useId();
  const [delta, setDelta] = useState(""); const [note, setNote] = useState("");
  const [problem, setProblem] = useState<Problem>(null); const [busy, setBusy] = useState(false);
  const errorFor = (field: string) => problem?.field === field ? problem.message : undefined;
  async function save() {
    setBusy(true); setProblem(null);
    const result = await send(`/api/admin/reviewers/${reviewerId}`, { action: "adjust", delta: Number(delta), note });
    setBusy(false); if (result) return setProblem(result);
    setDelta(""); setNote(""); router.refresh();
  }
  return <div className={styles.form}>
    {problem && !problem.field ? <Banner tone="bad">{problem.message}</Banner> : null}
    <div className={styles.row}>
      <Field id={`${ids}-delta`} label="dollars" help="Negative takes money off." error={errorFor("delta")}><Input value={delta} inputMode="decimal" placeholder="5.00" onChange={(e) => setDelta(e.target.value)} /></Field>
      <Field id={`${ids}-note`} label="why" help="Shows in their history forever." error={errorFor("note")}><Input value={note} onChange={(e) => setNote(e.target.value)} /></Field>
    </div>
    <Button onClick={save} loading={busy} loadingLabel="saving…">adjust {name}</Button>
  </div>;
}

export function InvoiceButton({ owed, open }: { owed: number; open: boolean }) {
  const router = useRouter(); const ids = useId();
  const [note, setNote] = useState(""); const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem>(null); const [done, setDone] = useState(false);
  if (open) return <Banner tone="info" title="invoice in process">We have it. You will get a Slack DM when it is paid.</Banner>;
  async function invoice() {
    if (!window.confirm(`Send an invoice for $${owed.toFixed(2)}?`)) return;
    setBusy(true); setProblem(null);
    const result = await send("/api/reviewers/invoice", { note });
    setBusy(false); if (result) return setProblem(result);
    setDone(true); router.refresh();
  }
  return <div className={styles.form}>
    {problem ? <Banner tone="bad">{problem.message}</Banner> : null}
    {done ? <Banner tone="ok">Invoice sent.</Banner> : null}
    <Field id={`${ids}-note`} label="note" help="Optional, e.g. how you want to be paid."><Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} /></Field>
    <Button onClick={invoice} loading={busy} loadingLabel="sending…" disabled={owed <= 0 || busy}>{owed > 0 ? `invoice $${owed.toFixed(2)}` : "nothing to invoice yet"}</Button>
  </div>;
}

export function InvoiceActions({ reviewerId, invoiceId, slackSent }: { reviewerId: string; invoiceId: string; slackSent: boolean }) {
  const router = useRouter(); const [busy, setBusy] = useState<"decline" | "resend" | null>(null); const [problem, setProblem] = useState<Problem>(null);
  async function act(action: "decline" | "resend") {
    let note = "";
    if (action === "decline") { const reason = window.prompt("Why decline? (they will see this on Slack)"); if (reason === null) return; note = reason; }
    setBusy(action); setProblem(null);
    const result = await send(`/api/admin/reviewers/${reviewerId}`, { action, invoiceId, note });
    setBusy(null); if (result) setProblem(result); router.refresh();
  }
  return <span className={styles.inline}>
    {problem ? <span className={styles.bad}>{problem.message}</span> : null}
    {!slackSent ? <Button variant="quiet" onClick={() => act("resend")} loading={busy === "resend"}>resend DM</Button> : null}
    <Button variant="quiet" onClick={() => act("decline")} loading={busy === "decline"}>decline</Button>
  </span>;
}

export function ToggleReviewer({ reviewerId, name, removed }: { reviewerId: string; name: string; removed: boolean }) {
  const router = useRouter(); const [busy, setBusy] = useState(false);
  async function toggle() {
    const question = removed ? `Bring ${name} back as a reviewer?` : `Remove ${name}? New Ari reviews stop paying them. History and anything owed stay.`;
    if (!window.confirm(question)) return;
    setBusy(true);
    await send(`/api/admin/reviewers/${reviewerId}`, { action: removed ? "restore" : "remove" });
    setBusy(false); router.refresh();
  }
  return <Button variant={removed ? "ghost" : "danger"} onClick={toggle} loading={busy}>{removed ? "restore reviewer" : "remove reviewer"}</Button>;
}
