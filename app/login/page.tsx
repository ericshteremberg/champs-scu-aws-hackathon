import { redirect } from "next/navigation";
import { chatGPTSignInPath, getChatGPTUser } from "../chatgpt-auth";
import LoginView from "@/components/workspace/login-view";

export const dynamic = "force-dynamic";

export default async function LoginPage({searchParams}: {searchParams:Promise<{returnTo?:string}>}) {
  const query=await searchParams;
  const destination=query.returnTo?.startsWith("/workspace") && !query.returnTo.startsWith("//") ? query.returnTo : "/workspace";
  const user = await getChatGPTUser();
  if (user) redirect(destination);
  return <LoginView signInPath={chatGPTSignInPath(destination)}/>;
}
