import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test, { type TestContext } from "node:test";

import { approvedMinutes } from "@/lib/ari/inbound";
import { verifyDelivery } from "@/lib/ari/delivery";
import { signDelivery } from "@/lib/ari/signature";
import { buildIngestPayload, validateSubmission, type IngestPayload } from "@/lib/ari/payload";
import { repoJournals } from "@/lib/ari/repo-journal";
import { githubSlug } from "@/lib/ari/repo";
import { ariBackend } from "./ari";
import { prepareSubmission } from "./prepare";
import type { ReviewSubmission } from "./types";

const sha = "a".repeat(40);
const source =
  "## 2026-10-23 Finished PCB routing -- 4.2 hours\n\nFixed ground islands.\n\n![PCB](https://example.com/pcb.png)";
const submission: ReviewSubmission = {
  externalId: "project-1",
  title: "PCB",
  description: "A tiny security key.",
  repoUrl: "https://github.com/maker/pcb",
  demoUrl: "https://example.com/demo",
  thumbnailUrl: "https://example.com/pcb.png",
  track: "hardware",
  hackatimeProjects: [],
  maker: { email: "maker@example.com", name: "Maker", slackId: "U123" },
};

function file(name = "JOURnal.MD") {
  return { name, sha, type: "file", size: source.length };
}

function configureAri(t: TestContext) {
  for (const [name, value] of Object.entries({
    ARI_BASE_URL: "https://ari.example.test",
    ARI_PROGRAM_ID: "test-program",
    ARI_INGEST_SECRET: "test-only-signing-secret",
  })) {
    const previous = process.env[name];
    process.env[name] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[name];
      else process.env[name] = previous;
    });
  }
}

for (const name of ["journal.md", "JOURnal.MD", "JOURNALmd"]) {
  test(`loads ${name} and reads the selected Git blob`, async (t) => {
    const calls: string[] = [];
    t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
      calls.push(url);
      assert.equal(options.cache, "no-store");
      if (url.endsWith("/contents")) return Response.json([file(name)]);
      assert.equal(url, `https://api.github.com/repos/maker/pcb/git/blobs/${sha}`);
      assert.equal(
        (options.headers as Record<string, string>).Accept,
        "application/vnd.github.raw+json",
      );
      return new Response(source);
    });
    const evidence = await repoJournals(submission.repoUrl);
    assert.equal(evidence.journals[0].seconds, 15120);
    assert.equal(evidence.journalUrl, `https://github.com/maker/pcb/blob/HEAD/${name}`);
    assert.equal(calls.length, 2);
  });
}

test("no journal keeps Hackatime submissions working but rejects missing time evidence", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json([{ name: "README.md", type: "file" }]),
  );
  assert.equal(
    (await prepareSubmission({ ...submission, hackatimeProjects: ["pcb"] })).status,
    "ready",
  );
  const result = await prepareSubmission(submission);
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") assert.equal(result.field, "hackatime_projects");
});

test("blank Hackatime names cannot stand in for evidence", () => {
  assert.equal(
    validateSubmission({ ...submission, hackatimeProjects: [" "] })?.field,
    "hackatime_projects",
  );
});

test("journal-only submission sends dated seconds and Markdown to Ari for review", async (t) => {
  configureAri(t);
  let payload: IngestPayload | undefined;
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    if (url.endsWith("/contents")) return Response.json([file()]);
    if (url.includes("/git/blobs/")) return new Response(source);
    assert.equal(url, "https://ari.example.test/api/ingest/test-program");
    const body = options.body as string;
    const timestamp = (options.headers as Record<string, string>)["X-Ari-Timestamp"];
    assert.match(timestamp, /^\d+$/);
    assert.ok(Math.abs(Number(timestamp) - Date.now() / 1000) < 5);
    assert.equal(
      (options.headers as Record<string, string>)["X-Ari-Signature"],
      createHmac("sha256", "test-only-signing-secret").update(`${timestamp}.${body}`).digest("hex"),
    );
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    payload = JSON.parse(body);
    return Response.json({ status: "queued" }, { status: 202 });
  });
  assert.deepEqual(await ariBackend.submit(submission), { status: "queued" });
  assert.ok(payload);
  assert.deepEqual(payload.hackatime_projects, []);
  assert.equal(payload.journals?.[0].at, "2026-10-23");
  assert.equal(payload.journals?.[0].seconds, 15120);
  assert.match(payload.journals?.[0].markdown ?? "", /!\[PCB\]/);
  assert.ok(payload.evidence.includes("devlog"));
  assert.match(payload.meta?.["Time evidence"] ?? "", /self-reported/);
  assert.equal(
    payload.meta?.["Devlog source"],
    "https://github.com/maker/pcb/blob/HEAD/JOURnal.MD",
  );
  assert.equal("program_seconds" in payload.maker, false);
  assert.equal("hours" in payload, false);
  assert.equal(
    approvedMinutes({ event: "review.approved", review: { approved_minutes: 180 } }),
    180,
  );
});

test("resubmission reloads the journal and keeps the update note", async (t) => {
  configureAri(t);
  let markdown = source;
  const payloads: IngestPayload[] = [];
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    if (url.endsWith("/contents")) return Response.json([file()]);
    if (url.includes("/git/blobs/")) return new Response(markdown);
    payloads.push(JSON.parse(options.body as string));
    return Response.json({ status: "queued" }, { status: 202 });
  });
  await ariBackend.submit(submission);
  markdown = source.replace("4.2 hours", "3.2 hours");
  const result = await ariBackend.submit({
    ...submission,
    isUpdate: true,
    updateMessage: "Corrected the routing time.",
  });
  assert.equal(result.status, "queued");
  assert.deepEqual(
    payloads.map((payload) => payload.journals?.[0].seconds),
    [15120, 11520],
  );
  assert.equal(payloads[1].is_update, true);
  assert.equal(payloads[1].update_message, "Corrected the routing time.");
});

test("Hackatime and journal sources are sent once each", () => {
  const journals = [{ at: "2026-10-23", seconds: 3600, text: "Routing", markdown: "Routing" }];
  const ready = { ...submission, hackatimeProjects: [" pcb "], journals };
  assert.equal(validateSubmission(ready), null);
  const payload = buildIngestPayload(ready);
  assert.deepEqual(payload.hackatime_projects, ["pcb"]);
  assert.deepEqual(payload.journals, journals);
  assert.equal("program_seconds" in payload.maker, false);
});

for (const status of [403, 404, 429, 500]) {
  test(`GitHub ${status} prevents silently dropping journal hours`, async (t) => {
    t.mock.method(console, "error", () => {});
    t.mock.method(globalThis, "fetch", async () => new Response("", { status }));
    assert.equal(
      (await prepareSubmission({ ...submission, hackatimeProjects: ["pcb"] })).status,
      "unavailable",
    );
  });
}

test("invalid journals block ingest and report a field error", async (t) => {
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    calls.push(url);
    if (url.endsWith("/contents")) return Response.json([file()]);
    return new Response("## Finished PCB routing -- 3.2 hours\nFixed it.");
  });
  const result = await ariBackend.submit(submission);
  assert.equal(result.status, "rejected");
  if (result.status === "rejected") {
    assert.equal(result.field, "journals");
    assert.match(result.message, /YYYY-MM-DD/);
  }
  assert.equal(calls.length, 2);
});

test("duplicate case variants and oversized journals fail explicitly", async (t) => {
  let files = [file(), file("journal.md")];
  t.mock.method(globalThis, "fetch", async () => Response.json(files));
  await assert.rejects(repoJournals(submission.repoUrl), /only one/);
  files = [{ ...file(), size: 11 * 1024 * 1024 }];
  await assert.rejects(repoJournals(submission.repoUrl), /under 10 MB/);
});

test("streaming downloads enforce the size limit even without Content-Length", async (t) => {
  t.mock.method(globalThis, "fetch", async (url: string) =>
    url.endsWith("/contents")
      ? Response.json([file()])
      : new Response("x".repeat(11 * 1024 * 1024)),
  );
  await assert.rejects(repoJournals(submission.repoUrl), /under 10 MB/);
});

test("repository parsing prevents untrusted hosts and encoded path traversal", () => {
  assert.equal(githubSlug("https://github.com/maker/pcb.git"), "maker/pcb");
  for (const url of [
    "https://evil.github.com/maker/pcb",
    "https://github.com.evil.test/maker/pcb",
    "https://github.com/maker/%2e%2e%2fother",
  ]) {
    assert.equal(githubSlug(url), null);
  }
});

test("existing Hackatime ships retain their payload without journal fields", async (t) => {
  configureAri(t);
  let payload: IngestPayload | undefined;
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    if (url.endsWith("/contents")) return Response.json([file("README.md")]);
    payload = JSON.parse(options.body as string);
    return Response.json({ status: "queued" }, { status: 202 });
  });
  assert.deepEqual(
    await ariBackend.submit({ ...submission, track: "software", hackatimeProjects: ["pcb"] }),
    { status: "queued" },
  );
  assert.deepEqual(payload, {
    external_id: submission.externalId,
    title: submission.title,
    description: submission.description,
    maker: { email: "maker@example.com", name: "Maker", slack_id: "U123" },
    repo_url: submission.repoUrl,
    demo_url: submission.demoUrl,
    thumbnail_url: submission.thumbnailUrl,
    hackatime_projects: ["pcb"],
    evidence: ["commits", "elapsed", "devlog"],
    track: "software",
  });
});

test("prepared evidence is sent without fetching the repository again", async (t) => {
  configureAri(t);
  const calls: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string) => {
    calls.push(url);
    if (url.endsWith("/contents")) return Response.json([file()]);
    if (url.includes("/git/blobs/")) return new Response(source);
    return Response.json({ status: "queued" }, { status: 202 });
  });
  const prepared = await prepareSubmission(submission);
  assert.equal(prepared.status, "ready");
  if (prepared.status !== "ready") return;
  await ariBackend.submit(prepared.submission);
  assert.equal(calls.length, 3);
});

test("GitHub credentials stay on the API host and redirects are rejected", async (t) => {
  const previous = process.env.GITHUB_TOKEN;
  process.env.GITHUB_TOKEN = "test-only-github-token";
  t.after(() => {
    if (previous === undefined) delete process.env.GITHUB_TOKEN;
    else process.env.GITHUB_TOKEN = previous;
  });
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.equal(new URL(url).hostname, "api.github.com");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(
      (options.headers as Record<string, string>).Authorization,
      "Bearer test-only-github-token",
    );
    return Response.json([]);
  });
  await repoJournals(submission.repoUrl);
});

for (const [status, response, outcome] of [
  [409, {}, "already_queued"],
  [200, { status: "duplicate" }, "already_queued"],
  [422, { field: "journals", error: "invalid" }, "rejected"],
  [503, {}, "unavailable"],
] as const) {
  test(`Ari ${status} ${outcome} keeps its existing outcome`, async (t) => {
    configureAri(t);
    t.mock.method(console, "error", () => {});
    t.mock.method(globalThis, "fetch", async () => Response.json(response, { status }));
    const result = await ariBackend.submit({
      ...submission,
      hackatimeProjects: ["pcb"],
      journals: [],
    });
    assert.equal(result.status, outcome);
  });
}

test("withdrawal uses the documented timestamp signature without a journal lookup", async (t) => {
  configureAri(t);
  t.mock.method(globalThis, "fetch", async (url: string, options: RequestInit) => {
    assert.equal(url, "https://ari.example.test/api/ingest/test-program/withdraw");
    const headers = options.headers as Record<string, string>;
    const body = options.body as string;
    assert.deepEqual(JSON.parse(body), { external_id: "project-1" });
    assert.equal(
      headers["X-Ari-Signature"],
      createHmac("sha256", "test-only-signing-secret")
        .update(`${headers["X-Ari-Timestamp"]}.${body}`)
        .digest("hex"),
    );
    return Response.json({ status: "withdrawn" });
  });
  assert.deepEqual(await ariBackend.withdraw("project-1"), { status: "withdrawn" });
});

test("forged or stale reviewer deliveries cannot pass signature verification", () => {
  const secret = "test-only-webhook-secret";
  const now = 1800000000;
  const timestamp = String(now);
  const body = JSON.stringify({ review: { approved_minutes: 120 } });
  const headers = {
    timestamp,
    deliveryId: "delivery-1",
    signature: signDelivery(timestamp, "delivery-1", body, secret),
  };
  assert.equal(verifyDelivery(body, headers, secret, now).ok, true);
  assert.deepEqual(verifyDelivery(body.replace("120", "999"), headers, secret, now), {
    ok: false,
    reason: "bad_signature",
  });
  assert.deepEqual(verifyDelivery(body, headers, secret, now + 301), {
    ok: false,
    reason: "stale",
  });
});
