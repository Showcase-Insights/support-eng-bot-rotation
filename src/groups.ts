import { google } from "googleapis";
import { JWT } from "google-auth-library";
import * as fs from "fs";

export interface GroupMember {
  name: string;
  email: string;
}

function buildAdminAuth(): JWT {
  const key = JSON.parse(fs.readFileSync(process.env.GOOGLE_CREDENTIALS!, "utf8"));

  return new JWT({
    email: key.client_email,
    key: key.private_key,
    scopes: [
      "https://www.googleapis.com/auth/admin.directory.group.member.readonly",
    ],
    // Domain-wide delegation: impersonate a Workspace admin
    subject: process.env.GOOGLE_ADMIN_EMAIL!,
  });
}

export async function getGroupMembers(groupEmail: string): Promise<GroupMember[]> {
  const auth = buildAdminAuth();
  const admin = google.admin({ version: "directory_v1", auth });

  const members: GroupMember[] = [];
  let pageToken: string | undefined;

  do {
    const res = await admin.members.list({
      groupKey: groupEmail,
      maxResults: 200,
      pageToken,
    });

    for (const member of res.data.members ?? []) {
      if (member.email && member.status === "ACTIVE") {
        // Use the part before @ as display name if no name is available
        const name = member.email.split("@")[0].replace(/\./g, " ");
        members.push({ email: member.email, name });
      }
    }

    pageToken = res.data.nextPageToken ?? undefined;
  } while (pageToken);

  return members;
}
