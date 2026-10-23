# Devlogs and Ari

3am reads `journal.md` from the root of a public GitHub repository on its default branch when a project is submitted or resubmitted. The filename is case insensitive, so `JOURnal.MD` works. `journalmd` is also accepted. Keep only one matching file in the root.

Each entry starts with a level-two Markdown heading containing a date in `YYYY-MM-DD` format and a positive number of hours. Titles and separators can vary. `hours`, `hour`, `hrs`, `hr`, and `h` are accepted without regard to case. Every entry needs a description below its heading. Subheadings within entries should use `###` or lower.

```md
# Build journal

## 2026-10-22 Planning - 4.2 hours

Researched controllers and drew the first schematic.

## 2026-10-23 Finished PCB routing -- 3.2 hours

Fixed the ground islands and finished the differential pair routing.

![Finished PCB](https://example.com/pcb.png)
```

Ari requires dates, so undated headings are rejected instead of assigning a work date. Entries must cover more than zero and at most 24 hours. A project can include up to 200 entries, each with up to 50,000 characters of Markdown and a heading under 1,000 characters. The whole journal must fit within 10 MB. Invalid entries produce an error before the project is sent for review. If GitHub cannot be reached or rate limits the request, submission can be retried without losing the journal hours. This also pauses Hackatime submissions until the journal lookup succeeds.

3am converts each duration to whole seconds and sends entries in Ari's `journals` array. For example, 4.2 hours becomes 15,120 seconds. The full Markdown, including images, is included for reviewers. Ari receives a source link and a note that journal hours are self-reported. Time is sent only as journal evidence, without also adding it as program-vouched time or using the ignored `hours` field. Make sure the Ari program accepts `devlog` evidence in its settings.

Ingest and withdrawal requests use Ari's timestamped HMAC signature. Outbound requests reject redirects and have a timeout. GitHub credentials are sent only to the fixed GitHub API host, and journal downloads have a size limit.

Hackatime is optional when a valid journal is present. If both sources are used, journal only the work that Hackatime did not track. Ari settles the approved time after review, including any reductions. 3am continues to use that decision's approved minutes for rewards, rather than crediting the journal total itself.

Resubmitting reads the journal again. Projects already open in Ari are unchanged by this feature. To correct an open submission, withdraw it and submit again. Decided projects can use the existing resubmission flow.

# Run locally

Use Node 24 and Docker with Compose. From the repository root:

```sh
npm ci
cp -n .env.example .env
node <<'NODE'
const fs = require("node:fs");
const { randomBytes } = require("node:crypto");
let config = fs.readFileSync(".env", "utf8");
for (const name of ["SESSION_SECRET", "TOKEN_ENCRYPTION_KEY"]) {
  config = config.replace(new RegExp(`^${name}=[ \\t]*\\r?$`, "m"), `${name}=${randomBytes(32).toString("hex")}`);
}
fs.writeFileSync(".env", config);
fs.chmodSync(".env", 0o600);
NODE
```

This fills only the empty session and encryption keys. Keep the example's local `DATABASE_URL` and `APP_URL` settings. Do not overwrite an existing `.env` or regenerate keys for an existing local database.

```sh
docker compose up -d db
docker compose exec -T db pg_isready -U 3am -d 3am
npm run db:migrate
npm run dev
```

If PostgreSQL is still starting, wait and rerun the readiness command before migrating. Open `http://localhost:3000` on your own machine. Without Ari credentials, 3am uses its local review backend. Browser sign-in still requires a real Hack Club Auth client configured with `http://localhost:3000/api/auth/callback` as its callback and `HCA_CLIENT_ID` and `HCA_CLIENT_SECRET` in `.env`.

To send a submission to Ari, use your 3am program's own `ARI_PROGRAM_ID`, `ARI_INGEST_SECRET`, and `ARI_WEBHOOK_SECRET`. The program ID in copied Ari documentation can belong to another program. Never use it as a default. Outbound access to `api.github.com` and `webhooks.ari.hackclub.com` is required. A public callback reachable by Ari is needed to receive real review decisions. No credentials are needed for the automated tests below, which mock GitHub and Ari requests.

```sh
node --import tsx --test lib/ari/journal.test.ts lib/review/journals.test.ts
npm run typecheck
npm run build
```
