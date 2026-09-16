# Japan public transit feeds

Research date: 2026-09-16

## Feed set

PaceNotes uses one Japan MOTIS data set. The image builder always uses this set.

The set combines seven GTFS sources:

- The [Transitous GTFS output index](https://api.transitous.org/gtfs/) listed 542 `jp_*.gtfs.zip` files during this review.
- The [Transitland Japan feed record](https://github.com/transitland/transitland-atlas/blob/main/feeds/tshimada291.github.com.dmfr.json) listed 51 current OTTOP URLs.
- The [GTFS Data Repository API](https://api.gtfs-data.jp/v2/feeds) listed 603 feeds. The importer selected 551 current, non-discontinued entries.
- [Mobility Database](https://mobilitydatabase.org/) supplied 44 additional Japan candidates outside the GTFS Data Repository.
- [Hokkaido Open Data Platform](https://ckan.hoda.jp/dataset/gtfs-data) supplied 50 current Hokkaido feeds not present in the first four sources.
- [Hiroshima Bus Association](https://www.bus-kyo.or.jp/gtfs-open-data) supplied 14 current Hiroshima feeds not present in the first four sources.
- [Tottori Prefecture Open Data Portal](https://odp-pref-tottori.tori-info.co.jp/) supplied four current or next-month feeds not present in the other sources.

The build validates required GTFS files, removes exact duplicate archives, and records each accepted URL, archive hash, and agency identifier in `/data/input-sources.tsv`. It records rejected downloads in `/data/input-failures.txt`.

## Build result

The 2026-09-16 image imported 1,241 unique archives. This is 101 more than the prior build:

- 541 from Transitous
- 50 from the Transitland OTTOP list
- 549 from the GTFS Data Repository
- 33 from Mobility Database
- 50 from Hokkaido Open Data Platform
- 14 from Hiroshima Bus Association
- 4 from Tottori Prefecture Open Data Portal

The catalog counts are feed files, not unique operators. The importer rejected two archives:

- `shinonsentown/yumetsubame` has no service calendar.
- `tsukubacity/TSUKUBUS` has no `stop_times.txt` or `trips.txt`.

## Route checks

Checks for 2026-09-16 departures returned:

- Five plans from Tokyo Station to Shinjuku Station. The first plan took 14 minutes.
- Six plans from Osaka Station to Kyoto Station. The first plan took 34 minutes.
- Five plans from Sapporo Station to New Chitose Airport Station. The first plan took 37 minutes.
- Five plans from Hiroshima Station to Hiroshima Airport. The first plan took 81 minutes and used rail and bus legs.
- Five plans from Tottori Station to Tottori Airport. The first plan took 25 minutes and used a bus leg.

The image found no plan from Kanazawa Station to Ono Karakuri Memorial Museum. It also found no plan from the museum to ANA Crowne Plaza Kanazawa.

## Ishikawa coverage

| Service | Source | Current finding |
| --- | --- | --- |
| Kahoku city bus and welfare loop bus | [Kahoku open data page](https://www.city.kahoku.lg.jp/001/116/117/d000198.html) | Direct GTFS files cover 2026-04-01 through 2027-03-31. |
| Nonoichi Notty and Nonkey | [Nonoichi open data page](https://www.city.nonoichi.lg.jp/soshiki/10/155.html) | The fixed `notty_current.zip` source was updated on 2026-04-01. |
| Hakusan Meguru | [GTFS Data Repository Ishikawa API](https://api.gtfs-data.jp/v2/feeds?pref=17) | The listed service period ends on 2027-03-15. |
| Komatsu Kibagata, north, and south routes | [GTFS Data Repository Ishikawa API](https://api.gtfs-data.jp/v2/feeds?pref=17) | Kibagata ends on 2026-09-30. The north and south feeds end on 2027-03-31. |
| Uchinada service | [GTFS Data Repository Ishikawa API](https://api.gtfs-data.jp/v2/feeds?pref=17) | The listed service period ends on 2026-12-31. |
| Kanazawa Flat Bus | [Kanazawa city data catalog](https://catalog-data.city.kanazawa.ishikawa.jp/api/3/action/package_show?id=172014-flatbus) | The city catalog provides a GTFS archive. |
| Tsubata service | [Kanazawa area catalog search](https://catalog-data.city.kanazawa.ishikawa.jp/api/3/action/package_search?q=GTFS&rows=100) | The archive uses non-standard CSV names for required GTFS files. It is not MOTIS-ready. |

No public GTFS source was found for Hokutetsu, IR Ishikawa Railway, or Noto Railway. The route from Kanazawa Station to Ono Karakuri Memorial Museum needs Hokutetsu bus data that is not in these catalogs.

Google Maps for consumers shows Hokutetsu bus routes 34 and 61 for the Kanazawa Station to Ono corridor. The Google Maps JavaScript Routes API and Directions service returned no route for the same places and departure times. A wider MOTIS stop search found a different route through Uchinada with about 30 minutes of walking. PaceNotes keeps the 1,000 meter search radius so it reports this corridor as unavailable instead of showing that detour.

The expanded catalogs added 101 unique archives. They contained no Hokutetsu bus feed, so they did not change the Kanazawa corridor result.
