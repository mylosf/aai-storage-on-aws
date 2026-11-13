// "S3 direct" backend: the browser must fetch segments straight from the S3
// regional endpoint, but the bucket is private. Instead of rewriting the
// player, we rewrite the playlists: every segment URI becomes a presigned URL,
// every nested playlist points back at this endpoint. hls.js follows absolute
// URLs happily, so the player code is identical for all backends.

import { GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const SAFE_PATH = /^[a-zA-Z0-9_\-./]+\.m3u8$/;

export async function presignedPlaylist({ s3, bucket, prefix, relPath, selfBase, expiresIn = 3600 }) {
  if (!SAFE_PATH.test(relPath) || relPath.includes("..")) {
    throw Object.assign(new Error("bad playlist path"), { status: 400 });
  }

  const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: `${prefix}${relPath}` }));
  const text = await res.Body.transformToString();
  const dir = relPath.includes("/") ? relPath.slice(0, relPath.lastIndexOf("/") + 1) : "";

  const sign = (rel) =>
    getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: `${prefix}${dir}${rel}` }), { expiresIn });

  const lines = await Promise.all(
    text.split("\n").map(async (line) => {
      const t = line.trim();
      if (!t) return line;

      if (t.startsWith("#")) {
        // fMP4 playlists carry the init segment in a tag; sign that too.
        const map = t.match(/^#EXT-X-MAP:URI="([^"]+)"(.*)$/);
        if (map && !/^https?:/.test(map[1])) return `#EXT-X-MAP:URI="${await sign(map[1])}"${map[2]}`;
        return line;
      }

      if (/^https?:\/\//.test(t)) return line;
      if (t.endsWith(".m3u8")) return `${selfBase}/${dir}${t}`;
      return sign(t);
    }),
  );

  return lines.join("\n");
}
