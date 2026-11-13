import type { Config, Matrix, ProbeResult } from "./types";

const rad = (d: number) => (d * Math.PI) / 180;
export function km(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const h = Math.sin(rad(b.lat - a.lat) / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lon - a.lon) / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)));
}

/** matrix lookup: probe in `from` reading the bucket in `to` */
export function cell(m: Matrix | null, from: string, to: string): ProbeResult | undefined {
  return m?.rows.find((r) => r.from === from)?.results.find((x) => x.region === to);
}

export const cityOf = (cfg: Config | null, id: string) =>
  id === cfg?.source.id ? cfg.source.city : (cfg?.replicas.find((r) => r.id === id)?.city ?? id);

/** master clip -> bureau, mirroring the catalogue generator in the API (it does not return metadata) */
export const CLIP_BUREAU: Record<string, string> = {
  "washington-wahlnacht": "washington",
  "sao-paulo-amazonas-brand": "sao-paulo",
  "nairobi-duerre": "nairobi",
  "tokio-erdbebenuebung": "tokyo",
  "singapur-hafen": "singapore",
  "kapstadt-energiekrise": "johannesburg",
  "mexiko-stadt-wasser": "mexico-city",
  "delhi-smog": "delhi",
  "dubai-klimakonferenz": "dubai",
  "sydney-buschfeuer": "sydney",
  "buenos-aires-derby": "buenos-aires",
  "lagos-marathon": "lagos",
  "meridian-uhd-hdr": "los-angeles",
  "meridian-audio-51": "los-angeles",
};
