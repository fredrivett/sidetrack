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

render $src/icon-16.svg 16 "PNG32:$tmp/16.png"
render $src/icon.svg 32 "PNG32:$tmp/32.png"
render $src/icon.svg 48 "PNG32:$tmp/48.png"
magick "$tmp/16.png" "$tmp/32.png" "$tmp/48.png" src/app/favicon.ico
