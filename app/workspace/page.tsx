import { requireChatGPTUser, chatGPTSignOutPath } from "../chatgpt-auth";
import WorkspaceApp from "@/components/workspace/workspace-app";

export const dynamic = "force-dynamic";

export default async function WorkspacePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    if (typeof value === "string") query.set(key, value);
    else if (Array.isArray(value)) for (const item of value) query.append(key, item);
  }
  const returnTo = query.size ? `/workspace?${query}` : "/workspace";
  const user = await requireChatGPTUser(returnTo);
  return <WorkspaceApp user={{ id: user.userId, name: user.displayName, email: user.email }} signOutPath={chatGPTSignOutPath("/")} />;
}
