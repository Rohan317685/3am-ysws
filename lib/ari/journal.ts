export type JournalEntry = {
  at: string;
  seconds: number;
  text: string;
  markdown: string;
};

export class JournalError extends Error {}

export function parseJournal(source: string): JournalEntry[] {
  const sections: { heading: string; lines: string[] }[] = [];
  let current: (typeof sections)[number] | undefined;
  let fence: { marker: string; length: number } | undefined;

  for (const line of source
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) {
        fence = { marker: marker[1][0], length: marker[1].length };
      } else if (
        marker[1][0] === fence.marker &&
        marker[1].length >= fence.length &&
        line.slice(marker[0].length).trim() === ""
      ) {
        fence = undefined;
      }
      current?.lines.push(line);
      continue;
    }

    const heading = !fence && line.match(/^ {0,3}##[ \t]+/);
    if (heading) {
      if (line.length > 1000) {
        throw new JournalError("Keep each journal heading under 1,000 characters.");
      }
      if (sections.length === 200) {
        throw new JournalError("Ari accepts at most 200 journal entries per project.");
      }
      const title = line
        .slice(heading[0].length)
        .trim()
        .replace(/[ \t]+#+$/, "")
        .trimEnd();
      current = { heading: title, lines: [] };
      sections.push(current);
    } else {
      current?.lines.push(line);
    }
  }

  const entries: JournalEntry[] = [];
  for (const { heading, lines } of sections) {
    const durations = [...heading.matchAll(/(?<![\w.])(-?\d[\d.,]*)\s*(?:hours?|hrs?|h)\b/gi)];
    if (durations.length === 0) {
      throw new JournalError(
        `Add hours to the journal heading "${heading}". For example: ## 2026-10-23 Finished routing - 3.2 hours.`,
      );
    }
    if (durations.length !== 1 || !/^\d+(?:\.\d+)?$/.test(durations[0][1])) {
      throw new JournalError(
        `Use one positive number of hours in the journal heading "${heading}".`,
      );
    }

    const hours = Number(durations[0][1]);
    const seconds = Math.round(hours * 3600);
    if (!Number.isSafeInteger(seconds) || seconds < 1 || hours > 24) {
      throw new JournalError(
        `The journal entry "${heading}" must cover more than zero and at most 24 hours.`,
      );
    }

    const date = heading.match(/\b\d{4}-\d{2}-\d{2}\b/)?.[0];
    if (
      !date ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date
    ) {
      throw new JournalError(`Add a valid YYYY-MM-DD date to the journal heading "${heading}".`);
    }

    const body = lines.join("\n").trim();
    if (!body)
      throw new JournalError(`Describe what you did below the journal heading "${heading}".`);
    const markdown = `## ${heading}\n\n${body}`;
    if (markdown.length > 50000) {
      throw new JournalError(
        `The journal entry "${heading}" is too long. Keep it under 50,000 characters.`,
      );
    }
    entries.push({ at: date, seconds, text: `${heading}\n\n${body}`.slice(0, 10000), markdown });
  }

  if (entries.length === 0)
    throw new JournalError("Add journal entries with ## headings and hours to journal.md.");
  if (entries.length > 200)
    throw new JournalError("Ari accepts at most 200 journal entries per project.");
  return entries;
}
