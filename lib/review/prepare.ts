import { JournalError } from "@/lib/ari/journal";
import { validateSubmission } from "@/lib/ari/payload";
import { repoJournals } from "@/lib/ari/repo-journal";

import type { ReviewSubmission, SubmitOutcome } from "./types";

type PreparedSubmission =
  | { status: "ready"; submission: ReviewSubmission }
  | Extract<SubmitOutcome, { status: "rejected" | "unavailable" }>;

export async function prepareSubmission(submission: ReviewSubmission): Promise<PreparedSubmission> {
  const invalid = validateSubmission(submission, { requireEvidence: false });
  if (invalid) return { status: "rejected", ...invalid };

  let prepared = submission;
  if (submission.journals === undefined) {
    try {
      prepared = { ...submission, ...(await repoJournals(submission.repoUrl)) };
    } catch (error) {
      if (error instanceof JournalError) {
        return { status: "rejected", field: "journals", message: error.message };
      }
      console.error("[repo] journal lookup failed", error);
      return {
        status: "unavailable",
        message: "We could not check your repository for journal.md. Try again in a moment.",
      };
    }
  }

  const problem = validateSubmission(prepared);
  return problem ? { status: "rejected", ...problem } : { status: "ready", submission: prepared };
}
