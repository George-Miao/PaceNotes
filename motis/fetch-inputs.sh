#!/usr/bin/env bash
set -euo pipefail

readonly OSM_URL="https://download.geofabrik.de/asia/japan-latest.osm.pbf"
readonly OSM_MD5_URL="${OSM_URL}.md5"
readonly RAIL_URL="https://api.transitous.org/gtfs/jp_japan-rail.gtfs.zip"
readonly BUS_URL="https://api3.ottop.org/download/gtfs/ooXuXei4op7y/2360001000457"
readonly SHUTTLE_URL="https://api3.ottop.org/download/gtfs/ooXuXei4op7y/360005005779"
readonly MLIT_RAIL_URL="https://nlftp.mlit.go.jp/ksj/gml/data/N02/N02-25/N02-25_GML.zip"

download() {
  local url="$1"
  local output="$2"
  wget --https-only --output-document="$output" "$url"
  test -s "$output"
}


download "$OSM_URL" japan.osm.pbf
download "$OSM_MD5_URL" japan-latest.osm.pbf.md5
readonly osm_md5="$(cut -d ' ' -f 1 japan-latest.osm.pbf.md5)"
printf '%s  %s\n' "$osm_md5" japan.osm.pbf | md5sum --check --strict -

download "$RAIL_URL" jp_japan-rail.source.gtfs.zip
download "$BUS_URL" okinawa-bus.gtfs.zip
download "$SHUTTLE_URL" okinawa-airport-shuttle.gtfs.zip
download "$MLIT_RAIL_URL" N02-25_GML.zip

for archive in ./*.gtfs.zip; do
  unzip -tq "$archive"
  file_list="${archive}.files"
  unzip -Z1 "$archive" > "$file_list"
  for name in agency.txt routes.txt stops.txt stop_times.txt trips.txt; do
    grep -Fxq "$name" "$file_list"
  done
  if ! grep -Fxq calendar.txt "$file_list" && ! grep -Fxq calendar_dates.txt "$file_list"; then
    echo "$archive has no GTFS service calendar" >&2
    exit 1
  fi
  rm "$file_list"
done
unzip -tq N02-25_GML.zip
unzip -Z1 N02-25_GML.zip > N02-25_GML.zip.files
grep -q '/UTF-8/N02-25_RailroadSection.geojson$' N02-25_GML.zip.files
grep -q '/UTF-8/N02-25_Station.geojson$' N02-25_GML.zip.files
rm N02-25_GML.zip.files


unzip -p okinawa-bus.gtfs.zip agency.txt > okinawa-bus-agency.txt
unzip -p okinawa-airport-shuttle.gtfs.zip agency.txt > okinawa-shuttle-agency.txt
grep -q '^2360001000457,' okinawa-bus-agency.txt
grep -q '^360005005779,' okinawa-shuttle-agency.txt
rm okinawa-bus-agency.txt okinawa-shuttle-agency.txt

sha256sum japan.osm.pbf N02-25_GML.zip ./*.gtfs.zip > input-sha256.txt
