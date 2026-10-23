import { JournalError, parseJournal, type JournalEntry } from "./journal";
import { githubHeaders, githubSlug } from "./repo";

const MAX_BYTES = 10 * 1024 * 1024;

type RepositoryFile = { name: string; type: string; sha: string; size: number };
export type JournalEvidence = { journals: JournalEntry[]; journalUrl?: string };

async function github(path: string, raw = false): Promise<Response> {
  return fetch(`https://api.github.com${path}`, {
    headers: {
      ...githubHeaders(),
      Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json",
    },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(10000),
  });
}

async function readJournal(response: Response): Promise<string> {
  if (Number(response.headers.get("content-length")) > MAX_BYTES) {
    throw new JournalError("Keep journal.md under 10 MB.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("GitHub returned no journal content");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) throw new JournalError("Keep journal.md under 10 MB.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function repoJournals(url: string): Promise<JournalEvidence> {
  const slug = githubSlug(url);
  if (!slug) return { journals: [] };
  const response = await github(`/repos/${slug}/contents`);
  if (!response.ok) throw new Error(`GitHub journal lookup returned ${response.status}`);

  const files: RepositoryFile[] = await response.json();
  if (!Array.isArray(files)) throw new Error("GitHub returned an unreadable repository listing");
  const matches = files.filter((file) => file.type === "file" && /^journal\.?md$/i.test(file.name));
  if (matches.length > 1)
    throw new JournalError("Keep only one journal.md file in the repository root.");
  if (!matches.length) {
    if (files.length >= 1000) throw new Error("GitHub may have truncated the repository listing");
    return { journals: [] };
  }

  const file = matches[0];
  if (file.size > MAX_BYTES) throw new JournalError("Keep journal.md under 10 MB.");
  if (!/^[a-f0-9]{40}$/i.test(file.sha)) throw new Error("GitHub returned an invalid journal blob");
  const content = await github(`/repos/${slug}/git/blobs/${file.sha}`, true);
  if (!content.ok) throw new Error(`GitHub journal download returned ${content.status}`);
  return {
    journals: parseJournal(await readJournal(content)),
    journalUrl: `https://github.com/${slug}/blob/HEAD/${encodeURIComponent(file.name)}`,
  };
}
