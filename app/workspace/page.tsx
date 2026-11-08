import { requireChatGPTUser, chatGPTSignOutPath } from "../chatgpt-auth";
import WorkspaceApp from "@/components/workspace/workspace-app";

export const dynamic = "force-dynamic";

export default async function WorkspacePage() {
  const user = await requireChatGPTUser("/workspace");
  return <WorkspaceApp user={{ id: user.userId, name: user.displayName, email: user.email }} signOutPath={chatGPTSignOutPath("/")} />;
}
