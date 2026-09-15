# Routing

## Why PaceNotes uses MOTIS

PaceNotes uses Google for all route modes by default. An operator can set `MOTIS_URL` to use MOTIS first for public transport routes when both Google place results have the country code `JP`. The browser sends one bounded batch to the PaceNotes server. The server sends transient coordinates to MOTIS. PaceNotes does not store these coordinates in Yjs or PostgreSQL. Google remains the fallback when MOTIS is disabled, unavailable, returns no itinerary, or returns invalid data.

The MOTIS service is API-only. It does not include the MOTIS web interface or map tiles. Its data covers the listed feeds. It does not claim complete public transport coverage for Japan.

## Prebuilt MOTIS service

PaceNotes publishes the AMD64 container image `ghcr.io/george-miao/pacenotes-motis` for this service. It contains MOTIS 2.11.3, imported route data, and the OSR patch in `patch/osr-32-way-nodes.patch`. The patch changes `osr::restriction` from four-bit way positions to five-bit way positions. It increases `kMaxWaysPerNode` from 16 to 32 and changes the serialized type hash from `restriction v1.1` to `restriction v1.2`. This lets the Japan OSM import represent higher-degree route nodes. Data made by an unpatched OSR build is not compatible with the patched restriction type.

The image build checks these source revisions:

- MOTIS 2.11.3 at commit `b228a4519d196d9dd01b5ce80be46e642abc953e`.
- OSR at commit `a7b2ec2728544304ef1d8397b3042abc8d10f7e7`.

The build verifies the Geofabrik MD5 file, checks each GTFS ZIP, checks required GTFS files, checks the two OTTOP agency IDs, and writes SHA-256 values to `/data/input-sha256.txt`. The image contains one imported data snapshot. It does not update that snapshot at run time.

## Data sources and licenses

Before publication, the repository variable `MOTIS_DATA_RIGHTS_CONFIRMED` must be `true`. The operator must review the current source terms and must have the right to download, process, publish, and operate the data. This check is necessary because an aggregate GTFS download can contain data from more than one publisher.

### OpenStreetMap Japan

- Source: [Geofabrik Japan download](https://download.geofabrik.de/asia/japan.html)
- File used by the weekly build: `japan-latest.osm.pbf`
- Data copyright: OpenStreetMap contributors
- License: [Open Data Commons Open Database License 1.0](https://www.openstreetmap.org/copyright)

The repository links to the upstream file. It does not retain a copy of the PBF.

### Japan Rail GTFS

- Source: [Transitous Japan Rail aggregate](https://api.transitous.org/gtfs/jp_japan-rail.gtfs.zip)
- Transitous project: [transitous.org](https://transitous.org/)
- License: The aggregate does not supply one license identifier for all included publishers. The operator must review the included publisher terms and confirm redistribution rights before publication.

### Okinawa Bus GTFS

- Source: [OTTOP open data catalog](https://www.ottop.org/gtfs-opendata)
- Agency ID: `2360001000457`
- Publisher: NPO OTTOP
- License: [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/), unless the OTTOP catalog states a different term for the feed

### Okinawa Airport Shuttle GTFS

- Source: [OTTOP open data catalog](https://www.ottop.org/gtfs-opendata)
- Agency ID: `360005005779`
- Publisher: NPO OTTOP
- License: [Creative Commons Attribution 4.0 International](https://creativecommons.org/licenses/by/4.0/), unless the OTTOP catalog states a different term for the feed

### Software

- [MOTIS](https://github.com/motis-project/motis) uses the MIT License.
- [OSR](https://github.com/motis-project/osr) uses the MIT License.
- The PaceNotes patch and build files use the PaceNotes AGPL-3.0-or-later license.

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
