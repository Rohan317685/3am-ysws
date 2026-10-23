import assert from "node:assert/strict";
import test from "node:test";

import { JournalError, parseJournal } from "./journal";

test("decimal hours become whole seconds and Markdown evidence stays intact", () => {
  const source =
    "# Build journal\n\n## 2026-10-23 Finished PCB routing -- 3.2 hours\n\nFixed the ground islands.\n\n![PCB](https://example.com/pcb.png)";
  const [entry] = parseJournal(source);
  assert.equal(entry.at, "2026-10-23");
  assert.equal(entry.seconds, 11520);
  assert.match(entry.text, /Fixed the ground islands/);
  assert.match(entry.markdown, /!\[PCB\]\(https:\/\/example.com\/pcb.png\)/);
});

test("multiple entries keep their own dates and durations", () => {
  const entries = parseJournal(
    "\uFEFF## 2026-10-22 Planning - 4.2 HOURS\r\nMade a plan.\r\n## 2026-10-23 Routing - 0.125 hrs\r\nFixed routing.",
  );
  assert.deepEqual(
    entries.map(({ at, seconds }) => ({ at, seconds })),
    [
      { at: "2026-10-22", seconds: 15120 },
      { at: "2026-10-23", seconds: 450 },
    ],
  );
});

test("headings inside code fences do not create journal entries", () => {
  for (const fence of ["```", "~~~~"]) {
    const [entry] = parseJournal(
      `## 2026-10-23 Routing - 2h\nFixed it.\n${fence}md\n## An example heading\n${fence}\n### Details\nMore work.`,
    );
    assert.equal(entry.seconds, 7200);
    assert.match(entry.markdown, /## An example heading/);
    assert.match(entry.markdown, /More work/);
  }
});

for (const [name, source, message] of [
  ["missing date", "## Finished PCB routing -- 3.2 hours\nFixed it.", /YYYY-MM-DD/],
  ["impossible date", "## 2026-02-30 Routing - 3h\nFixed it.", /valid YYYY-MM-DD/],
  ["missing hours", "## 2026-10-23 Routing\nFixed it.", /Add hours/],
  ["negative hours", "## 2026-10-23 Routing -3.2 hours\nFixed it.", /positive number/],
  ["zero hours", "## 2026-10-23 Routing - 0h\nFixed it.", /more than zero/],
  ["over 24 hours", "## 2026-10-23 Routing - 24.1 hours\nFixed it.", /at most 24/],
  ["fraction above 24 hours", "## 2026-10-23 Routing - 24.0001 hours\nFixed it.", /at most 24/],
  ["ambiguous hours", "## 2026-10-23 Routing - 1,200 hours\nFixed it.", /positive number/],
  ["two durations", "## 2026-10-23 Routing - 1h plus 2h\nFixed it.", /one positive/],
  ["empty entry", "## 2026-10-23 Routing - 2h\n  ", /Describe what you did/],
  ["missing headings", "I worked for 4.2 hours.", /## headings/],
] as const) {
  test(`rejects ${name}`, () => assert.throws(() => parseJournal(source), message));
}

test("rejects oversized entries and more than 200 entries without dropping evidence", () => {
  assert.throws(
    () => parseJournal(`## 2026-10-23 Routing - 2h\n${"x".repeat(50000)}`),
    JournalError,
  );
  const source = "## 2026-10-23 Routing - 2h\nFixed it.\n";
  assert.equal(parseJournal(source.repeat(200)).length, 200);
  assert.throws(() => parseJournal(source.repeat(201)), /at most 200/);
});

test("long Markdown gets a short text fallback without losing the full entry", () => {
  const [entry] = parseJournal(`## 2026-10-23 Routing - 2h\n${"x".repeat(11000)}`);
  assert.equal(entry.text.length, 10000);
  assert.ok(entry.markdown.length > 11000);
});

test("oversized headings are rejected before duration parsing", () => {
  for (const padding of [" ", "#", "9"]) {
    assert.throws(
      () => parseJournal(`## 2026-10-23 ${padding.repeat(20000)}1h\nWork`),
      /heading under 1,000 characters/,
    );
  }
});

test("closing heading markers and ordinary spacing do not change recorded hours", () => {
  const [entry] = parseJournal("  ## 2026-10-23   Finished routing -- 3.2 hours ###\nWork");
  assert.equal(entry.seconds, 11520);
  assert.equal(entry.at, "2026-10-23");
});
