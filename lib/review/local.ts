import type { ReviewBackend, ReviewSubmission, SubmitOutcome, WithdrawOutcome } from "./types";
import { prepareSubmission } from "./prepare";

export const localBackend: ReviewBackend = {
  name: "local",

  async submit(submission: ReviewSubmission): Promise<SubmitOutcome> {
    const prepared = await prepareSubmission(submission);
    if (prepared.status !== "ready") return prepared;
    console.info(
      `[review] local backend queued ${submission.externalId} for ${submission.maker.email}`,
    );
    return { status: "queued" };
  },

  async withdraw(externalId: string): Promise<WithdrawOutcome> {
    console.info(`[review] local backend withdrew ${externalId}`);
    return { status: "withdrawn" };
  },
};
