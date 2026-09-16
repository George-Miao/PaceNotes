# Routing

## Why PaceNotes uses MOTIS

PaceNotes uses Google for all route modes by default. An operator can set `MOTIS_URL` to use MOTIS first for public transport routes when both Google place results have the country code `JP`. The browser sends one bounded batch to the PaceNotes server. The server sends transient coordinates to MOTIS. PaceNotes does not store these coordinates in Yjs or PostgreSQL. Google remains the fallback when MOTIS is disabled, unavailable, returns no itinerary, or returns invalid data.

The MOTIS service is API-only. It does not include the MOTIS web interface or map tiles. Its data covers the listed feeds. It does not claim complete public transport coverage for Japan.

## Prebuilt MOTIS service

PaceNotes publishes the AMD64 container image `ghcr.io/george-miao/pacenotes-motis` for this service. It contains MOTIS 2.11.3, imported route data, and the OSR patch in `patch/osr-32-way-nodes.patch`. The patch changes `osr::restriction` from four-bit way positions to five-bit way positions. It increases `kMaxWaysPerNode` from 16 to 32 and changes the serialized type hash from `restriction v1.1` to `restriction v1.2`. This lets the Japan OSM import represent higher-degree route nodes. Data made by an unpatched OSR build is not compatible with the patched restriction type.

The image build checks these source revisions:

- MOTIS 2.11.3 at commit `b228a4519d196d9dd01b5ce80be46e642abc953e`.
- OSR at commit `a7b2ec2728544304ef1d8397b3042abc8d10f7e7`.

The build verifies the Geofabrik MD5 file, checks each GTFS ZIP, checks required GTFS files, and writes SHA-256 values to `/data/input-sha256.txt`. It also writes source URLs, archive hashes, and agency identifiers to `/data/input-sources.tsv`. The image contains one imported data snapshot. It does not update that snapshot at run time.

## Data sources

The image uses one Japan data set:

- [Geofabrik Japan](https://download.geofabrik.de/asia/japan.html) supplies the OpenStreetMap extract.
- [Transitous](https://api.transitous.org/gtfs/) supplies its indexed Japan GTFS archives.
- [Transitland Atlas](https://github.com/transitland/transitland-atlas/blob/main/feeds/tshimada291.github.com.dmfr.json) supplies the OTTOP feed list.
- [GTFS Data Repository](https://api.gtfs-data.jp/v2/feeds) supplies current repository feeds.
- [Mobility Database](https://mobilitydatabase.org/) supplies additional current Japan feeds.
- [Hokkaido Open Data Platform](https://ckan.hoda.jp/dataset/gtfs-data) supplies current Hokkaido feeds.
- [Hiroshima Bus Association](https://www.bus-kyo.or.jp/gtfs-open-data) supplies current Hiroshima feeds.
- [Tottori Prefecture Open Data Portal](https://odp-pref-tottori.tori-info.co.jp/) supplies current Tottori feeds.
- [MLIT](https://nlftp.mlit.go.jp/ksj/gml/datalist/KsjTmplt-N02-2025.html) supplies railway geometry used to enrich rail shapes.

The build validates each archive, removes exact duplicate archives, and records rejected feeds in `/data/input-failures.txt`. See [Japan public transit feed research](japan-transit-feeds.md).
Build the image with:

```sh
docker build \
  --file motis/Dockerfile \
  --tag pacenotes-motis \
  .
```


## Image tags and updates

The workflow runs once each week, on request, and when a GitHub release is published. A successful build publishes a UTC date tag in `YYYYMMDD` form and updates `latest`. A release build also publishes its `vMAJOR.MINOR.PATCH` tag. Old date tags remain available. A failed build does not change `latest`, so the last good image stays available.

## Operation

Set the server-only `MOTIS_URL` value. Set `MOTIS_TIMEOUT_MS` only when the default shared batch deadline of 5000 ms is not suitable. The maximum accepted value is 60000 ms. Do not expose these values through public browser configuration.

For the optional private Compose service, use:

```dotenv
MOTIS_URL=http://motis:8080
MOTIS_TIMEOUT_MS=5000
```

Then run:

```sh
docker compose --profile motis up --build -d
```

Compose does not publish the MOTIS port to the host. PaceNotes still starts when MOTIS is unavailable. `/health/ready` does not depend on MOTIS. `/health/providers` reports MOTIS as `disabled`, `ready`, or `degraded`.

A Google Maps route export asks Google to plan the route again. Its result can differ from the MOTIS route shown in PaceNotes.
