#!/usr/bin/env bash
# Download a Creative Commons film and package it once as:
#   out/master.m3u8 + out/{360p,720p,1080p}/   multi-bitrate HLS, 4 s TS segments
#   out/source.mp4                              progressive MP4 for the seek / range-read test
# The same `out/` tree is then copied to every storage backend (make content).
#
#   CLIP_SECONDS=120 ./prepare.sh   # only the first 2 minutes (quick test set)
#   SRC_URL=...                     # any .mp4/.mov (or .zip containing one)
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
SRC_URL=${SRC_URL:-https://download.blender.org/peach/bigbuckbunny_movies/big_buck_bunny_1080p_h264.mov.zip}
CLIP_SECONDS=${CLIP_SECONDS:-0}   # 0 = whole film (~10 min)
SEGMENT_SECONDS=4                 # keep in sync with loadtest/viewers.js
FPS=24                            # Big Buck Bunny is 24 fps -> GOP of 96 frames = one 4 s segment
SRC_DIR="$HERE/src"
OUT="$HERE/out"

command -v ffmpeg >/dev/null || { echo "ffmpeg not found. macOS: brew install ffmpeg"; exit 1; }
mkdir -p "$SRC_DIR" "$OUT"

# --- 1. source --------------------------------------------------------------
ARCHIVE="$SRC_DIR/$(basename "$SRC_URL")"
if [ ! -s "$ARCHIVE" ]; then
  echo "==> downloading $SRC_URL"
  curl -fL --progress-bar -o "$ARCHIVE.part" "$SRC_URL" && mv "$ARCHIVE.part" "$ARCHIVE"
fi
case "$ARCHIVE" in
  *.zip)
    unzip -o -q "$ARCHIVE" -d "$SRC_DIR"
    SRC=$(find "$SRC_DIR" -maxdepth 1 -type f \( -name '*.mov' -o -name '*.mp4' -o -name '*.m4v' \) | head -1)
    ;;
  *) SRC="$ARCHIVE" ;;
esac
[ -n "${SRC:-}" ] && [ -s "$SRC" ] || { echo "no video file found in $SRC_DIR"; exit 1; }
echo "==> source: $SRC"

CLIP=()
[ "$CLIP_SECONDS" -gt 0 ] && CLIP=(-t "$CLIP_SECONDS")

# --- 2. encoder: Apple hardware encoder when available, libx264 otherwise ----
if ffmpeg -hide_banner -encoders 2>/dev/null | grep -q h264_videotoolbox; then
  VENC=(-c:v h264_videotoolbox -allow_sw 1)
else
  VENC=(-c:v libx264 -preset veryfast -profile:v high)
fi
GOP=$((SEGMENT_SECONDS * FPS))

# --- 3. HLS ladder ------------------------------------------------------------
rm -rf "$OUT"/{360p,720p,1080p} "$OUT"/master.m3u8
echo "==> packaging HLS (${SEGMENT_SECONDS}s segments, 3 renditions) -> $OUT"
ffmpeg -y -hide_banner -loglevel warning -stats ${CLIP[@]+"${CLIP[@]}"} -i "$SRC" \
  -filter_complex "[0:v]split=3[v1][v2][v3];[v1]scale=-2:360[v1o];[v2]scale=-2:720[v2o];[v3]scale=-2:1080[v3o]" \
  -map "[v1o]" -map 0:a:0 -map "[v2o]" -map 0:a:0 -map "[v3o]" -map 0:a:0 \
  "${VENC[@]}" -r "$FPS" -g "$GOP" -keyint_min "$GOP" -sc_threshold 0 \
  -b:v:0 800k  -maxrate:v:0 900k  -bufsize:v:0 1600k \
  -b:v:1 2800k -maxrate:v:1 3000k -bufsize:v:1 5600k \
  -b:v:2 5000k -maxrate:v:2 5350k -bufsize:v:2 10000k \
  -c:a aac -b:a 128k -ac 2 \
  -f hls -hls_time "$SEGMENT_SECONDS" -hls_playlist_type vod -hls_segment_type mpegts \
  -hls_flags independent_segments \
  -hls_segment_filename "$OUT/%v/seg_%05d.ts" \
  -master_pl_name master.m3u8 \
  -var_stream_map "v:0,a:0,name:360p v:1,a:1,name:720p v:2,a:2,name:1080p" \
  "$OUT/%v/index.m3u8"

# --- 4. progressive MP4 for the random-read (seek) benchmark -----------------
echo "==> remuxing source.mp4"
ffmpeg -y -hide_banner -loglevel warning ${CLIP[@]+"${CLIP[@]}"} -i "$SRC" -c copy -movflags +faststart "$OUT/source.mp4"

echo
echo "==> done: $(find "$OUT" -type f | wc -l | tr -d ' ') files, $(du -sh "$OUT" | cut -f1)"
echo "    small file: 360p/seg_00000.ts  ($(du -h "$OUT/360p/seg_00000.ts" | cut -f1))"
echo "    big file:   source.mp4         ($(du -h "$OUT/source.mp4" | cut -f1))"
