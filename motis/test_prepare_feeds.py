import prepare_feeds as MODULE
import tempfile
import unittest
from pathlib import Path



class PrepareFeedsTest(unittest.TestCase):
    def test_selects_only_japan_gtfs_archives(self) -> None:
        index = """
        <a href="jp_city.gtfs.zip">city</a>
        <a href="jp_japan-rail.gtfs.zip">rail</a>
        <a href="de_city.gtfs.zip">other country</a>
        <a href="jp_notes.txt">not GTFS</a>
        """

        feeds = MODULE.transitous_feeds(index)

        self.assertEqual(
            [feed.filename for feed in feeds],
            ["jp_city.gtfs.zip", "jp_japan-rail.source.gtfs.zip"],
        )

    def test_accepts_non_utf8_index_labels(self) -> None:
        index = b'<a href="jp_city.gtfs.zip">city \xe3..</a>'

        feeds = MODULE.transitous_feeds_from_index(index)

        self.assertEqual([feed.filename for feed in feeds], ["jp_city.gtfs.zip"])

    def test_shortens_long_transitous_filenames(self) -> None:
        filename = f"jp_{'%E3' * 100}.gtfs.zip"
        index = f'<a href="{filename}">long name</a>'

        feeds = MODULE.transitous_feeds(index)

        self.assertEqual(len(feeds), 1)
        self.assertLessEqual(len(feeds[0].filename.encode()), 240)
        self.assertRegex(feeds[0].filename, r"^jp_transitous-[0-9a-f]{16}\.gtfs\.zip$")
        self.assertTrue(feeds[0].url.endswith(filename))

    def test_selects_ottop_feeds_from_target_host(self) -> None:
        document = {
            "feeds": [
                {
                    "id": "f-123~jp",
                    "spec": "gtfs",
                    "urls": {
                        "static_current": "https://api3.ottop.org/download/gtfs/key/123"
                    },
                },
                {
                    "id": "f-unlabeled~jp",
                    "spec": "gtfs",
                    "urls": {
                        "static_current": "https://api3.ottop.org/download/gtfs/key/unlabeled"
                    },
                },
                {
                    "id": "f-other~jp",
                    "spec": "gtfs",
                    "urls": {"static_current": "https://example.com/feed.zip"},
                },
            ]
        }

        feeds = MODULE.ottop_feeds(document)

        self.assertEqual([feed.feed_id for feed in feeds], ["123", "unlabeled"])
        self.assertEqual(feeds[0].filename, "jp_ottop-123.gtfs.zip")

    def test_selects_current_repository_feeds(self) -> None:
        def feed(feed_id: str, end_date: str, discontinued: bool = False):
            return {
                "organization_id": "city",
                "feed_id": feed_id,
                "latest_feed_end_date": end_date,
                "feed_is_discontinued": discontinued,
            }

        document = {
            "body": [
                feed("current", "2027-03-31"),
                feed("expired", "2026-09-14"),
                feed("closed", "2027-03-31", discontinued=True),
                feed("second-current", "2027-03-31"),
            ]
        }

        feeds = MODULE.repository_feeds(document, MODULE.date(2026, 9, 15))

        self.assertEqual(
            [feed.feed_id for feed in feeds],
            ["city/current", "city/second-current"],
        )
        self.assertEqual(
            feeds[0].url,
            "https://api.gtfs-data.jp/v2/organizations/city/feeds/current/files/feed.zip",
        )

    def test_selects_additional_mobility_database_feeds(self) -> None:
        document = (
            "id,data_type,location.country_code,status,urls.authentication_type,"
            "urls.direct_download,urls.latest\n"
            "mdb-active,gtfs,JP,active,0,https://example.com/active.zip,\n"
            "mdb-default,gtfs,JP,,,https://example.com/default.zip,\n"
            "mdb-inactive,gtfs,JP,inactive,0,https://example.com/inactive.zip,\n"
            "mdb-realtime,gtfs-rt,JP,active,0,https://example.com/realtime.zip,\n"
            "mdb-other-country,gtfs,US,active,0,https://example.com/us.zip,\n"
            "mdb-authenticated,gtfs,JP,active,1,https://example.com/auth.zip,\n"
            "mdb-repository,gtfs,JP,active,0,"
            "https://api.gtfs-data.jp/v2/organizations/city/feeds/bus/files/feed.zip,\n"
        )

        feeds = MODULE.mobility_database_feeds(document)

        self.assertEqual(
            [feed.feed_id for feed in feeds],
            ["mdb-active", "mdb-default"],
        )
        self.assertEqual(
            [feed.filename for feed in feeds],
            [
                "jp_mobility-mdb-active.gtfs.zip",
                "jp_mobility-mdb-default.gtfs.zip",
            ],
        )

    def test_selects_verified_hokkaido_archives(self) -> None:
        document = {
            "result": {
                "resources": [
                    {
                        "state": "active",
                        "url": "https://example.com/download/atsuma_bus.zip",
                    },
                    {
                        "state": "inactive",
                        "url": "https://example.com/download/bankei_bus.zip",
                    },
                    {
                        "state": "active",
                        "url": "https://example.com/download/old_feed.zip",
                    },
                ]
            }
        }

        feeds = MODULE.hoda_feeds(document)

        self.assertEqual([feed.feed_id for feed in feeds], ["atsuma_bus"])
        self.assertEqual(feeds[0].filename, "jp_hoda-atsuma_bus.gtfs.zip")

    def test_includes_verified_regional_feeds(self) -> None:
        self.assertEqual(len(MODULE.hiroshima_feeds()), 14)
        self.assertEqual(len(MODULE.tottori_open_data_feeds()), 4)

    def test_generates_all_dataset_entries(self) -> None:
        feeds = [
            MODULE.DownloadedFeed(
                feed=MODULE.Feed(
                    catalog="Transitous",
                    feed_id="jp_japan-rail",
                    url="https://example.com/rail.zip",
                    filename="jp_japan-rail.source.gtfs.zip",
                ),
                sha256="rail",
                agencies="rail",
            ),
            MODULE.DownloadedFeed(
                feed=MODULE.Feed(
                    catalog="Transitous",
                    feed_id="jp_city",
                    url="https://example.com/city.zip",
                    filename="jp_city.gtfs.zip",
                ),
                sha256="city",
                agencies="city",
            ),
        ]
        with tempfile.TemporaryDirectory() as directory:
            config = Path(directory) / "config.yml"
            config.write_text(
                "timetable:\n  datasets:\n    old:\n      path: old.zip\nosm: japan.osm.pbf\n"
            )

            MODULE.write_config(config, feeds)

            self.assertEqual(
                config.read_text(),
                "timetable:\n"
                "  datasets:\n"
                "    feed0001:\n"
                "      path: jp_japan-rail.gtfs.zip\n"
                "    feed0002:\n"
                "      path: jp_city.gtfs.zip\n"
                "osm: japan.osm.pbf\n",
            )


if __name__ == "__main__":
    unittest.main()
