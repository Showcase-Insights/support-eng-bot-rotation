require("dotenv/config");
const { Client } = require("@notionhq/client");

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
  notionVersion: "2022-06-28",
});

(async () => {
  const dbId = process.env.NOTION_DATABASE_ID;
  console.log("Env NOTION_DATABASE_ID:", dbId);

  const db = await notion.databases.retrieve({ database_id: dbId });
  const title = (db.title || []).map((t) => t.plain_text).join("") || "(untitled)";
  console.log("Database title :", title);
  console.log("Database URL   :", db.url);
  console.log("Workspace owner:", db.created_by?.id);

  // Pick one of the page IDs the audit returned and show its parent + Week
  const samplePageId = "35d267bf-b847-8103-9ba6-fd2e581af9e2";
  try {
    const page = await notion.pages.retrieve({ page_id: samplePageId });
    console.log("\nSample page", samplePageId);
    console.log("  url    :", page.url);
    console.log("  parent :", JSON.stringify(page.parent));
    const week = page.properties?.Week;
    console.log("  Week   :", week?.date?.start);
    const name = page.properties?.Name?.title?.[0]?.plain_text;
    console.log("  Name   :", name);
  } catch (e) {
    console.log("\nSample page retrieve failed:", e.code, e.message);
  }
})();
