export function fmtMs(v: number | null | undefined, digits?: number): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v >= 10_000) return `${(v / 1000).toFixed(1)} s`;
  const d = digits ?? (v < 10 ? 2 : v < 100 ? 1 : 0);
  return `${v.toFixed(d)} ms`;
}

export function fmtNum(v: number | null | undefined, digits = 0): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function fmtMiBps(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v >= 1024) return `${(v / 1024).toFixed(2)} GiB/s`;
  return `${v.toFixed(v < 10 ? 1 : 0)} MiB/s`;
}

export function fmtMbps(bitsPerSec: number | null | undefined): string {
  if (bitsPerSec == null || !Number.isFinite(bitsPerSec)) return "—";
  const m = bitsPerSec / 1e6;
  if (m >= 1000) return `${(m / 1000).toFixed(2)} Gbit/s`;
  return `${m.toFixed(m < 10 ? 1 : 0)} Mbit/s`;
}

export function fmtBytes(b: number | null | undefined): string {
  if (b == null || !Number.isFinite(b)) return "—";
  if (b >= 1 << 30) return `${(b / (1 << 30)).toFixed(2)} GiB`;
  if (b >= 1 << 20) return `${(b / (1 << 20)).toFixed(1)} MiB`;
  if (b >= 1 << 10) return `${(b / 1024).toFixed(0)} KiB`;
  return `${b} B`;
}

export function fmtPct(rate: number | null | undefined, digits = 1): string {
  if (rate == null || !Number.isFinite(rate)) return "—";
  return `${(rate * 100).toFixed(digits)} %`;
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
}
