/*
 * Wipe ALL upcoming sign-up rows in the Notion DB (regardless of the
 * `Auto-assigned` flag) and their matching Google Calendar events. After
 * running this, `npm start` will re-fill the cleared weeks using the
 * count-based fair picker in `src/rotation.ts`, producing a fully fair
 * distribution across the rotation window.
 *
 * Usage:
 *   node rebalance.cjs            # dry-run: prints what would be cleared
 *   node rebalance.cjs --apply    # actually clears Notion + Calendar
 */
require("dotenv/config");
const { Client } = require("@notionhq/client");
const { google } = require("googleapis");
const { JWT } = require("google-auth-library");
const fs = require("fs");

const APPLY = process.argv.includes("--apply");

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
  notionVersion: "2022-06-28",
});

function buildCalendarAuth() {
  const key = JSON.parse(fs.readFileSync(process.env.GOOGLE_CREDENTIALS, "utf8"));
  return new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: ["https://www.googleapis.com/auth/calendar"],
    subject: process.env.GOOGLE_ADMIN_EMAIL,
  });
}

// Next-Monday-strictly-in-the-future, matching getQuarterWeeks() in audit.ts.
function nextMondayISO() {
  const d = new Date();
  const dow = d.getDay();
  const days = dow === 1 ? 7 : (8 - dow) % 7;
  d.setDate(d.getDate() + days);
  d.setHours(0, 0, 0, 0);
  return d.toISOString().split("T")[0];
}

(async () => {
  const dbId = process.env.NOTION_DATABASE_ID;
  const cutoff = nextMondayISO();
  console.log(`Mode      : ${APPLY ? "APPLY" : "DRY-RUN (use --apply to commit)"}`);
  console.log(`Cutoff    : Week >= ${cutoff}`);
  console.log("");

  // 1. Notion: query every future row (Week >= cutoff), regardless of
  // Auto-assigned. Rebalance is intentionally a clean-slate operation so
  // the fair picker can redistribute the whole window.
  const res = await notion.request({
    path: `databases/${dbId}/query`,
    method: "post",
    body: {
      filter: { property: "Week", date: { on_or_after: cutoff } },
      page_size: 100,
    },
  });

  const targets = res.results.map((p) => ({
    id: p.id,
    week: p.properties?.Week?.date?.start,
    name: p.properties?.Name?.title?.[0]?.plain_text || "",
  }));

  console.log(`Found ${targets.length} future row(s) to clear:`);
  for (const t of targets) console.log(`  ${t.week}  ${t.name.padEnd(22)}  ${t.id}`);
  console.log("");

  if (!APPLY) {
    console.log("(dry-run \u2014 nothing changed). Re-run with `--apply` to clear.");
    return;
  }

  // 2. Clear each Notion row (keep the Week date, blank Name/Email, uncheck Auto-assigned)
  for (const t of targets) {
    await notion.pages.update({
      page_id: t.id,
      properties: {
        Name: { title: [] },
        Email: { email: null },
        "Auto-assigned": { checkbox: false },
      },
    });
    console.log(`  cleared notion row ${t.week} (${t.name})`);
  }

  // 3. Delete matching "Support:" calendar events for those weeks
  const auth = buildCalendarAuth();
  const calendar = google.calendar({ version: "v3", auth });
  const calendarId = process.env.GOOGLE_CALENDAR_ID;

  for (const t of targets) {
    const monday = new Date(`${t.week}T00:00:00Z`);
    const sunday = new Date(monday);
    sunday.setUTCDate(monday.getUTCDate() + 6);
    const sundayISO = sunday.toISOString().split("T")[0];

    const list = await calendar.events.list({
      calendarId,
      timeMin: `${t.week}T00:00:00Z`,
      timeMax: `${sundayISO}T23:59:59Z`,
      q: "Support:",
      singleEvents: true,
    });
    for (const ev of list.data.items || []) {
      if (ev.id) {
        await calendar.events.delete({ calendarId, eventId: ev.id });
        console.log(`  deleted calendar event ${t.week} (${ev.summary})`);
      }
    }
  }

  console.log("\nDone. Run `npm start` to re-fill the cleared weeks with the fair picker.");
})();
