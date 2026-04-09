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

```sh
npm start
```

This runs the full quarterly audit against your configured Notion database and Google Calendar. **It will create real calendar events and Notion rows**, so use caution — consider pointing to a test calendar/database first.

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

There are no automated tests yet. To verify changes:

1. Point `GOOGLE_CALENDAR_ID` and `NOTION_DATABASE_ID` at test/sandbox resources.
2. Run `npm start` and check the console output for the audit summary.
3. Confirm calendar events and Notion rows were created correctly.
4. Use `workflow_dispatch` to test the full CI pipeline on a branch before merging.
