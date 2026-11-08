import Link from "next/link";
import { notFound } from "next/navigation";
import { sampleDataEnabled } from "@/lib/server/sample-data";
import WorkspaceApp from "@/components/workspace/workspace-app";
import LoginView from "@/components/workspace/login-view";
import NotFoundView from "@/components/workspace/not-found-view";
import { screenManifest } from "@/lib/design/screens";
import { getScreenPreview } from "@/lib/design/fixtures";
import "@/components/workspace/workspace.css";

export const metadata = {title:"Causality · Desktop screen library", robots:{index:false,follow:false}};
export default async function ScreenLibrary({searchParams}: {searchParams:Promise<{screen?:string}>}) {
  if (!sampleDataEnabled()) notFound();
  const {screen}=await searchParams;
  if(screen==="login") return <div data-design-screen="login"><LoginView signInPath="/design/screens"/><div className="cw-design-note">SYNTHETIC DESIGN PREVIEW · login</div></div>;
  if(screen==="page-not-found") return <><NotFoundView/><div className="cw-design-note">DESIGN PREVIEW · page-not-found</div></>;
  if(screen && screenManifest.some(s=>s.id===screen) && screen!=="landing") {
    const preview=getScreenPreview(screen);
    return <WorkspaceApp key={screen} user={preview.state.user} signOutPath="/design/screens" preview={preview}/>;
  }
  const groups=[...new Set(screenManifest.map(s=>s.group))];
  return <main className="cw-preview-gallery"><Link className="cw-brand" href="/"><span className="cw-mark">C</span>Causality</Link><h1 style={{marginTop:48}}>The complete desktop flow.</h1><p>A read-only screen library for design review. These screens use synthetic fixtures and the same components as the product. No workspace data is loaded or changed here.</p><p>{screenManifest.length} screens and meaningful states · desktop</p>{groups.map(group=><section key={group}><h2>{group}</h2><div className="cw-preview-grid">{screenManifest.filter(s=>s.group===group).map(s=><a key={s.id} href={s.path}><small>{s.id}</small><strong>{s.title}</strong><span>Open screen →</span></a>)}</div></section>)}</main>;
}
