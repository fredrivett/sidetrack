#!/usr/bin/env bash
# Regenerates every app icon from the SVGs in this folder:
#   icon.svg     the logo; every icon from 32px up is rendered from it
#   icon-16.svg  the same mark snapped to whole pixels, for the 16px favicon
# Needs ImageMagick 7 (`magick`). Run from anywhere: scripts/icons/build.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
src=scripts/icons
bg="#0A0A0A"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

# Render at 4096px, then average down: ImageMagick's SVG renderer bleeds about
# a pixel past each edge, which only disappears when rendered this large.
# -strip drops the timestamps ImageMagick writes, so reruns give identical files.
render() {
  local width; width=$(magick identify -format %w "$1")
  magick -background none -density $((72 * 4096 / width)) "$1" -filter Box -resize "$2x$2" -strip "$3"
}

render $src/icon.svg 512 PNG32:public/icons/icon-512.png
render $src/icon.svg 192 PNG32:public/icons/icon-192.png

# iOS masks the corners itself, so it gets the icon on a full-bleed square,
# both at the path layout.tsx links and at the root path iOS tries by default.
render $src/icon.svg 180 "$tmp/apple.png"
magick "$tmp/apple.png" -background "$bg" -flatten -alpha off -strip PNG24:public/icons/apple-touch-icon.png
cp public/icons/apple-touch-icon.png public/apple-touch-icon.png

# Maskable: the icon at 75%, so the mark stays inside Android's safe zone.
render $src/icon.svg 384 "$tmp/maskable.png"
magick -size 512x512 xc:"$bg" "$tmp/maskable.png" -gravity center -composite -alpha off -strip \
  PNG24:public/icons/icon-512-maskable.png

# The cards alone, cropped to their bounds, for the in-app header (Kanban.tsx
# draws it as a CSS mask in the text colour). Only icon.svg defines the cards.
awk '
  /<rect x=/ {
    match($0, /x="[0-9.]+"/); x = substr($0, RSTART + 3, RLENGTH - 4) + 0
    match($0, /y="[0-9.]+"/); y = substr($0, RSTART + 3, RLENGTH - 4) + 0
    match($0, /width="[0-9.]+"/); w = substr($0, RSTART + 7, RLENGTH - 8) + 0
    match($0, /height="[0-9.]+"/); h = substr($0, RSTART + 8, RLENGTH - 9) + 0
    if (n == 0 || x < x0) x0 = x; if (n == 0 || y < y0) y0 = y
    if (x + w > x1) x1 = x + w; if (y + h > y1) y1 = y + h
    rects[++n] = $0
  }
  END {
    printf "<svg viewBox=\"%d %d %d %d\" xmlns=\"http://www.w3.org/2000/svg\">\n", x0, y0, x1 - x0, y1 - y0
    for (i = 1; i <= n; i++) { sub(/^ */, "  ", rects[i]); print rects[i] }
    print "</svg>"
  }
' $src/icon.svg > public/icons/mark.svg

render $src/icon-16.svg 16 "PNG32:$tmp/16.png"
render $src/icon.svg 32 "PNG32:$tmp/32.png"
render $src/icon.svg 48 "PNG32:$tmp/48.png"
magick "$tmp/16.png" "$tmp/32.png" "$tmp/48.png" src/app/favicon.ico
