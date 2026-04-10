import { Client as NotionClient, isFullPage } from "@notionhq/client";
import type { QueryDataSourceResponse } from "@notionhq/client/build/src/api-endpoints";

const notion = new NotionClient({
  auth: process.env.NOTION_TOKEN!,
  notionVersion: "2022-06-28",
});

function queryDatabase(
  databaseId: string,
  filter: Record<string, unknown>
): Promise<QueryDataSourceResponse> {
  return notion.request({
    path: `databases/${databaseId}/query`,
    method: "post",
    body: { filter },
  });
}

export interface SignUp {
  name: string;
  email?: string;
}

export async function getSignUpForWeek(weekStart: string): Promise<SignUp | null> {
  const response = await queryDatabase(process.env.NOTION_DATABASE_ID!, {
    property: "Week",
    date: { equals: weekStart },
  });

  const page = response.results[0];
  if (!page || !isFullPage(page)) return null;

  const nameProp = page.properties["Name"];
  const emailProp = page.properties["Email"];

  const name =
    nameProp?.type === "title" && nameProp.title.length > 0
      ? nameProp.title[0].plain_text.trim()
      : null;

  if (!name) return null;

  const email =
    emailProp?.type === "email" ? (emailProp.email ?? undefined) : undefined;

  return { name, email };
}

export async function writeSignUp(
  weekStart: string,
  name: string,
  email: string,
  autoAssigned: boolean
): Promise<void> {
  await notion.pages.create({
    parent: { database_id: process.env.NOTION_DATABASE_ID! },
    properties: {
      Week: { date: { start: weekStart } },
      Name: { title: [{ text: { content: name } }] },
      Email: { email },
      "Auto-assigned": { checkbox: autoAssigned },
    },
  });
}

export async function getRecentlyAssigned(weeks: number = 11): Promise<string[]> {
  const since = new Date();
  since.setDate(since.getDate() - weeks * 7);

  const response = await queryDatabase(process.env.NOTION_DATABASE_ID!, {
    property: "Week",
    date: { on_or_after: since.toISOString().split("T")[0] },
  });

  return response.results
    .filter(isFullPage)
    .map((page) => {
      const nameProp = page.properties["Name"];
      return nameProp?.type === "title" && nameProp.title.length > 0
        ? nameProp.title[0].plain_text.trim()
        : "";
    })
    .filter(Boolean);
}
