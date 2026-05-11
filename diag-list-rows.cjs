require("dotenv/config");
const { Client } = require("@notionhq/client");

const notion = new Client({
  auth: process.env.NOTION_TOKEN,
  notionVersion: "2022-06-28",
});

(async () => {
  const dbId = process.env.NOTION_DATABASE_ID;
  let cursor;
  const rows = [];

  do {
    const res = await notion.request({
      path: `databases/${dbId}/query`,
      method: "post",
      body: { page_size: 100, start_cursor: cursor },
    });
    for (const p of res.results) {
      const week = p.properties?.Week?.date?.start || null;
      const name = p.properties?.Name?.title?.[0]?.plain_text || "";
      const auto = p.properties?.["Auto-assigned"]?.checkbox ?? null;
      rows.push({ id: p.id, week, name, auto, in_trash: p.in_trash, archived: p.archived });
    }
    cursor = res.has_more ? res.next_cursor : undefined;
  } while (cursor);

  rows.sort((a, b) => (a.week || "").localeCompare(b.week || ""));
  console.log(`Total rows: ${rows.length}\n`);
  for (const r of rows) {
    const flags = [r.in_trash ? "trashed" : null, r.archived ? "archived" : null].filter(Boolean).join(",");
    console.log(
      `  ${r.week || "<no week>"}  ${r.name.padEnd(22)}  auto=${r.auto}  ${flags}  ${r.id}`
    );
  }
})();
