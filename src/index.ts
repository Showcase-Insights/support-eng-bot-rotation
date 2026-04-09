import "dotenv/config";
import { getGroupMembers } from "./groups";
import { auditQuarter, printAuditSummary } from "./audit";
import { notifySlackQuarterly } from "./slack";

function validateEnv(): void {
  const required = [
    "NOTION_TOKEN",
    "NOTION_DATABASE_ID",
    "GOOGLE_CREDENTIALS",
    "GOOGLE_CALENDAR_ID",
    "GOOGLE_GROUP_EMAIL",
    "GOOGLE_ADMIN_EMAIL",
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    throw new Error(`Missing environment variables: ${missing.join(", ")}`);
  }
}

async function main(): Promise<void> {
  validateEnv();
  console.log("\nSupport rotation — quarterly audit\n");

  // 1. Fetch all active members from the Google Group
  console.log(`Fetching members from: ${process.env.GOOGLE_GROUP_EMAIL}`);
  const members = await getGroupMembers(process.env.GOOGLE_GROUP_EMAIL!);
  console.log(`  Found ${members.length} active members`);

  // 2. Audit every week in the next 3 months
  const results = await auditQuarter(members);

  // 3. Print the full summary to console / CI logs
  printAuditSummary(results);

  // 4. Send a Slack summary (optional)
  await notifySlackQuarterly(results);

  console.log("Quarterly audit complete.\n");
}

main().catch((err) => {
  console.error("\nError:", err.message ?? err);
  process.exit(1);
});
