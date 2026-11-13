import { AWS_ICON, type AwsIcon } from "@/assets/aws";
import { BACKEND_COLOR, INK } from "@/palette";

const ICON = 44;

interface NodeProps {
  cx: number;
  cy: number;
  icon: AwsIcon;
  label: string;
  sub?: string;
  /** where the text sits relative to the icon */
  text?: "below" | "right";
  /** backend identity dot (same colour as in the charts) */
  dot?: string;
}

function Node({ cx, cy, icon, label, sub, text = "below", dot }: NodeProps) {
  const right = text === "right";
  const tx = right ? cx + ICON / 2 + 12 : cx;
  const ty = right ? cy - (sub ? 4 : 0) : cy + ICON / 2 + 16;
  return (
    <g>
      <image href={AWS_ICON[icon]} x={cx - ICON / 2} y={cy - ICON / 2} width={ICON} height={ICON} />
      {dot && <circle cx={tx} cy={ty - 4} r={3.5} fill={dot} />}
      <text x={dot ? tx + 9 : tx} y={ty} textAnchor={right ? "start" : "middle"} className="sd-label">
        {label}
      </text>
      {sub && (
        <text x={tx} y={ty + 15} textAnchor={right ? "start" : "middle"} className="sd-sub">
          {sub}
        </text>
      )}
    </g>
  );
}

/** The whole deployment on one picture, drawn with the official AWS Architecture Icons. */
export function SystemDiagram() {
  const c = BACKEND_COLOR;
  return (
    <svg
      className="sysdiagram block h-auto w-full max-h-[440px]"
      viewBox="0 0 960 420"
      role="img"
      aria-label="Architecture: browser and load generator, CloudFront, EC2 origin with instance store, EBS and EFS, S3 bucket"
    >
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M 1 1 L 9 5 L 1 9" fill="none" stroke={INK.muted} strokeWidth="1.5" />
        </marker>
        <marker id="arr-s3" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
          <path d="M 1 1 L 9 5 L 1 9" fill="none" stroke={c.s3} strokeWidth="1.5" />
        </marker>
      </defs>

      {/* connectors */}
      <g className="sd-line">
        {/* browser → cloudfront */}
        <line x1={106} y1={220} x2={302} y2={220} markerEnd="url(#arr)" />
        {/* load generator → cloudfront (dashed) */}
        <polyline points="106,80 330,80 330,194" strokeDasharray="5 4" markerEnd="url(#arr)" />
        {/* cloudfront → ec2 */}
        <polyline points="356,210 450,210 450,110 534,110" markerEnd="url(#arr)" />
        {/* cloudfront → s3 */}
        <polyline points="356,230 450,230 450,330 534,330" markerEnd="url(#arr)" />
        {/* ec2 → storage */}
        <line x1={586} y1={100} x2={774} y2={54} markerEnd="url(#arr)" />
        <line x1={586} y1={110} x2={774} y2={110} markerEnd="url(#arr)" />
        <line x1={586} y1={120} x2={774} y2={166} markerEnd="url(#arr)" />
      </g>
      {/* browser → s3 direct */}
      <polyline className="sd-line s3" points="98,238 200,238 200,392 560,392 560,356" markerEnd="url(#arr-s3)" />

      {/* nodes */}
      <Node cx={80} cy={220} icon="client" label="Browser" sub="the audience" />
      <Node cx={80} cy={80} icon="app" label="Load generator" sub="k6 · simulated viewers" />
      <Node cx={330} cy={220} icon="cloudfront" label="CloudFront" sub="one HTTPS URL" />
      <Node cx={560} cy={110} icon="ec2" label="EC2 origin" sub="nginx + benchmark API" text="right" />
      <Node cx={560} cy={330} icon="s3" label="S3 bucket" sub="web app · video · private" text="right" />
      <Node cx={800} cy={50} icon="instance" label="Instance store" sub="NVMe in the host" text="right" dot={c.nvme} />
      <Node cx={800} cy={110} icon="ebs" label="EBS gp3" sub="block volume" text="right" dot={c.ebs} />
      <Node cx={800} cy={170} icon="efs" label="EFS" sub="NFS · regional" text="right" dot={c.efs} />

      {/* route labels */}
      <text x={460} y={152} className="sd-note">
        /ebs /efs /nvme /api
      </text>
      <text x={460} y={168} className="sd-note">
        passed through, not cached
      </text>
      <text x={460} y={266} className="sd-note">
        / and /video/*
      </text>
      <text x={460} y={282} className="sd-note">
        cached at the edge
      </text>
      <text x={380} y={408} textAnchor="middle" className="sd-note">
        S3 direct: presigned URLs, no server in the path
      </text>
      <text x={120} y={70} className="sd-note">
        started over SSM by the API
      </text>
    </svg>
  );
}
