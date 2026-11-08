import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

export default async ({ project }) => {
  const metadata = JSON.parse(readFileSync(process.env.CAPTURE_META || "capture.json", "utf8"));
  const input = resolve(process.env.RAW_VIDEO || "screen-recording.webm");
  const sourceDuration = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", input], { encoding: "utf8" }).trim());
  const trimStart = Math.max(0, sourceDuration - metadata.duration - 0.15);
  const duration = Math.floor(metadata.duration * 30) / 30;
  const p = await project({ dir: process.env.EDIT_DIR || "casework-edit", size: "1920x1080", fps: 30, background: "#eaf0ee" });
  const source = await p.add(input);
  p.compose(
    <frame layout="none" width={1920} height={1080} background="#eaf0ee">
      <text x={160} y={18} width={260} height={36} fontFamily="DM Sans" fontWeight={700} fontSize={27} color="#183e39">casework.</text>
      <text x={425} y={26} width={1050} height={24} fontFamily="DM Sans" fontSize={15} color="#54746d" letterSpacing={2}>AUTOMATED DISPUTE PREPARATION</text>
      <text x={1460} y={24} width={300} height={24} fontFamily="DM Sans" fontSize={16} align="right" color="#54746d">AWS HACKATHON DEMO</text>
      <media x={160} y={118} width={1600} height={900} file={source} trimStart={trimStart} fit="contain" />
      <text x={160} y={1040} width={1600} height={24} fontFamily="DM Sans" fontSize={16} color="#54746d">Recorded prototype • Synthetic records • Deterministic demo investigator • Human review before export</text>
    </frame>, { at: 0, dur: duration, name: "Real application recording" }
  );
  const phases = metadata.marks;
  for (let i = 0; i < phases.length; i++) {
    const at = phases[i].at;
    const dur = (phases[i + 1]?.at ?? duration) - at;
    p.compose(
      <text x={160} y={64} width={1600} height={42} fontFamily="DM Sans" fontWeight={700} fontSize={30} color="#183e39"
        animate={[{property:"opacity",from:0,to:1,duration:Math.min(0.15,dur)}]}>
        {phases[i].label}
      </text>, { at, dur, name: "Step " + (i + 1) }
    );
  }
  p.compose(<rect x={160} y={1026} width={1600} height={3} fill="#397c69"
    animate={[{property:"scaleX",from:0,to:1,duration,easing:"linear"}]} />, { at:0, dur:duration, name:"Progress" });
  await p.frame(10, "renders/preview.png");
  await p.frame(duration - 1, "renders/saved.png");
  console.log(JSON.stringify(await p.render("renders/casework-hackathon-demo.mp4", { depth:8, bitrate:6000000, shards:2, concurrency:2 })));
};
