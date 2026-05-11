# Support Rotation

Automated quarterly support rotation scheduler. Reads the team roster from a Google Group, checks for voluntary sign-ups in Notion, fills empty weeks with a fair random pick, and syncs everything to Google Calendar.

## How the rotation works

A GitHub Actions workflow runs on the **1st of January, April, July, and October** at 8 AM UTC. It can also be [triggered manually](../../actions/workflows/support-rotation.yml) from the Actions tab.

Each run audits every week (Monday → Sunday) in the upcoming quarter (~13 weeks):

1. **Both Notion and Calendar have an assignee** — if they match, skip. If they differ, the Notion entry wins and the calendar event is updated.
2. **Notion sign-up exists, no calendar event** — creates a calendar event for that person.
3. **Calendar event exists, no Notion entry** — back-fills the Notion row so the database stays complete.
4. **Neither exists** — randomly assigns someone from the Google Group, preferring members who haven't been assigned recently. Writes to both Notion and Calendar.

After processing, an optional Slack message is posted with the full quarter schedule.

### Volunteering for a week

Add a row to the [Notion sign-up database](https://www.notion.so/letshighlight/33d267bfb84780cc98fdcb271eee7010?v=33d267bfb847803b9338000c19ccd735) **before** the quarterly run:

- **Week** — set to the Monday of the week you want (e.g. `2026-04-13`)
- **Name** — your full name
- **Email** — your work email (optional but recommended)
- **Auto-assigned** — leave unchecked

The bot will see your sign-up and create the calendar event for you.

### Swapping weeks

Edit the Notion database directly — change the **Name** (and optionally **Email**) on the relevant row. On the next run the calendar will be updated to match. If you need the calendar updated immediately, trigger the workflow manually from the Actions tab.

## Project structure

```
src/
├── index.ts       — entry point, env validation, orchestration
├── audit.ts       — quarterly audit logic, week generation
├── calendar.ts    — Google Calendar read/write helpers
├── groups.ts      — Google Groups (Admin SDK) member fetching
├── notion.ts      — Notion database read/write helpers
├── rotation.ts    — fair random selection logic
└── slack.ts       — optional Slack webhook notification
```

## Local development

### Prerequisites

- Node.js 20+
- A `.env` file (see `.env.example`)
- A `google-service-account.json` credentials file in the project root

### Secrets

All secrets (Notion token, Google service account JSON, calendar ID, etc.) are stored in **1Password**. Copy them into your local `.env` file — never commit `.env` or `google-service-account.json`.

### Setup

```sh
npm install
cp .env.example .env
# Fill in .env with values from 1Password
```

### Running locally

#### Preview (dry-run) — no writes

```sh
npm start -- --dry-run
```

Runs the full audit logic — reads Notion and Calendar, applies the fair-rotation picker — but **makes no changes**. Nothing is written to Notion, Google Calendar, or Slack. Every line in the output is prefixed with `[DRY-RUN]` so it's clear nothing was committed.

Use this before any real run to see exactly what the schedule will look like.

#### Live run — writes everything

```sh
npm start
```

Runs the full audit and **commits all changes**: Notion rows are created/updated, Google Calendar events are created/deleted, and the Slack summary is posted (if `SLACK_WEBHOOK_URL` is set).

#### Rebalancing the quarter

Use `rebalance.cjs` to wipe all upcoming sign-up rows (Notion + Calendar) and start fresh. This is useful when the existing schedule is uneven — e.g. after several members leave the group and their weeks were re-assigned unevenly.

```sh
# 1. Preview what will be cleared (dry-run, no writes)
node rebalance.cjs

# 2. Apply — wipes all future Notion rows and matching Calendar events
node rebalance.cjs --apply

# 3. Re-fill with a fair distribution
npm start -- --dry-run   # preview the new schedule
npm start                # commit it
```

The rebalance clears **every** future row regardless of whether it was manually signed up (`Auto-assigned = false`) or auto-filled (`Auto-assigned = true`). After clearing, `npm start` uses the count-based fair picker to distribute the weeks evenly across all 8 active members: with 13 weeks and 8 members, the result is 5 members × 2 weeks + 3 members × 1 week.

### Building

```sh
npm run build          # compile TypeScript → dist/
npm run run:compiled   # run the compiled JS
```

## Environment variables

| Variable | Description |
|---|---|
| `NOTION_TOKEN` | Notion internal integration token |
| `NOTION_DATABASE_ID` | ID of the Notion sign-up database |
| `GOOGLE_CREDENTIALS` | Path to the service account JSON file (default: `./google-service-account.json`) |
| `GOOGLE_CALENDAR_ID` | Google Calendar ID for the rotation calendar |
| `GOOGLE_GROUP_EMAIL` | Email address of the Google Group containing the team roster |
| `GOOGLE_ADMIN_EMAIL` | Workspace admin email used for domain-wide delegation |
| `SLACK_WEBHOOK_URL` | *(optional)* Slack incoming webhook URL for quarterly summaries |

## CI / GitHub Actions

The workflow lives at `.github/workflows/support-rotation.yml`. GitHub Actions secrets (Settings → Secrets → Actions) must be configured with the same variables listed above, plus `GOOGLE_CREDENTIALS_JSON` containing the full JSON contents of the service account file.

## Testing

```sh
npm test
```

Runs the unit test suite (Vitest). Tests cover Notion upsert behavior and the Slack notification helper.

For end-to-end verification:

1. Run `npm start -- --dry-run` to preview the planned schedule without touching anything.
2. If the output looks correct, run `npm start` to commit.
3. Use `workflow_dispatch` to test the full CI pipeline on a branch before merging.
