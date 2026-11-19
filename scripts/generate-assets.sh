#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if ! command -v convert >/dev/null 2>&1; then
  echo "ImageMagick 'convert' is required to regenerate brand PNGs." >&2
  exit 1
fi

# The SVG files in assets/ are design references. ImageMagick draws the final
# PNGs directly so the script does not depend on an SVG delegate such as rsvg.
draw_house() {
  local target="$1"; local scale="$2"; local ox="$3"; local oy="$4"
  local roof="$5"; local wall="$6"; local door="$7"; local key="$8"
  local cmd=()
  cmd+=(-fill "$roof" -draw "polygon $((216*scale/100+ox)),$((516*scale/100+oy)) $((512*scale/100+ox)),$((270*scale/100+oy)) $((808*scale/100+ox)),$((516*scale/100+oy)) $((808*scale/100+ox)),$((570*scale/100+oy)) $((512*scale/100+ox)),$((324*scale/100+oy)) $((216*scale/100+ox)),$((570*scale/100+oy))")
  cmd+=(-fill "$wall" -draw "rectangle $((292*scale/100+ox)),$((490*scale/100+oy)) $((354*scale/100+ox)),$((760*scale/100+oy))")
  cmd+=(-fill "$wall" -draw "rectangle $((670*scale/100+ox)),$((490*scale/100+oy)) $((732*scale/100+ox)),$((760*scale/100+oy))")
  cmd+=(-fill "$wall" -draw "rectangle $((292*scale/100+ox)),$((698*scale/100+oy)) $((732*scale/100+ox)),$((760*scale/100+oy))")
  cmd+=(-fill "$door" -draw "roundrectangle $((452*scale/100+ox)),$((606*scale/100+oy)) $((572*scale/100+ox)),$((760*scale/100+oy)) $((60*scale/100)),$((60*scale/100))")
  cmd+=(-fill "$key" -draw "circle $((512*scale/100+ox)),$((676*scale/100+oy)) $((512*scale/100+ox+16*scale/100)),$((676*scale/100+oy))")
  convert "$target" "${cmd[@]}" "$target"
}

convert -size 1024x1024 gradient:'#047857-#0F766E' assets/icon.png
draw_house assets/icon.png 100 0 0 '#FFFFFF' '#FFFFFF' '#FBBF24' '#047857'

convert -size 1024x1024 xc:none assets/adaptive-icon.png
draw_house assets/adaptive-icon.png 68 164 164 '#FFFFFF' '#FFFFFF' '#FBBF24' '#047857'

convert -size 1284x2778 gradient:'#1E293B-#0F172A' assets/splash.png
draw_house assets/splash.png 68 206 810 '#34D399' '#FFFFFF' '#FBBF24' '#047857'
convert assets/splash.png \
  -font DejaVu-Sans-Bold -pointsize 112 -fill '#FFFFFF' -gravity center -annotate +0+360 'GalliRent' \
  -font DejaVu-Sans -pointsize 42 -fill '#94A3B8' -gravity center -annotate +0+470 'Houses & Shops Near Me' \
  assets/splash.png

echo "Generated assets/icon.png, assets/adaptive-icon.png and assets/splash.png"
