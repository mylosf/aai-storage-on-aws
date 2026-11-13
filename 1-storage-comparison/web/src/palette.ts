// One categorical colour per backend, fixed order, used everywhere (dots, bars,
// storage nodes). Light-surface steps of the reference palette, validated as a
// set with the dataviz palette checker; the canonical values live in index.css.
import type { BackendId } from "./types";

export const BACKEND_COLOR: Record<BackendId, string> = {
  nvme: "#2a78d6",
  ebs: "#eb6834",
  efs: "#1baf7a",
  s3: "#eda100",
  cdn: "#e87ba4",
};

export const BACKEND_SHORT: Record<BackendId, string> = {
  nvme: "Instance store",
  ebs: "EBS gp3",
  efs: "EFS",
  s3: "S3 direct",
  cdn: "S3 + CloudFront",
};

export const colorOf = (id: string): string =>
  (BACKEND_COLOR as Record<string, string>)[id] ?? "#a1a1aa";

/** CSS variable reference, so Tailwind/theme and SVG agree. */
export const colorVar = (id: string): string =>
  id in BACKEND_COLOR ? `var(--backend-${id})` : "var(--muted-foreground)";

// Chart / diagram chrome (zinc)
export const INK = {
  primary: "oklch(0.145 0 0)",
  secondary: "oklch(0.371 0 0)",
  muted: "oklch(0.556 0 0)",
  grid: "oklch(0.922 0 0)",
  axis: "oklch(0.87 0 0)",
  surface: "#ffffff",
};
