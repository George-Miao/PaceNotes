import csv
import io
import json
import tempfile
import unittest
import zipfile
from pathlib import Path

from enrich_rail_shapes import enrich_gtfs


class EnrichRailShapesTest(unittest.TestCase):
    def test_adds_shape_to_matched_high_speed_trip(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            gtfs = root / "rail.gtfs.zip"
            mlit = root / "N02.zip"
            write_gtfs(gtfs)
            write_mlit(mlit)

            stats = enrich_gtfs(gtfs, mlit)

            self.assertEqual(stats.candidate_trips, 1)
            self.assertEqual(stats.enriched_trips, 1)
            self.assertEqual(stats.generated_shapes, 1)
            with zipfile.ZipFile(gtfs) as archive:
                trips = read_rows(archive, "trips.txt")
                shapes = read_rows(archive, "shapes.txt")
            high_speed = next(row for row in trips if row["trip_id"] == "fast")
            local = next(row for row in trips if row["trip_id"] == "local")
            self.assertTrue(high_speed["shape_id"].startswith("pn_n02_"))
            self.assertEqual(local["shape_id"], "")
            self.assertEqual({row["shape_id"] for row in shapes}, {high_speed["shape_id"]})
            self.assertGreater(len(shapes), 2)
            self.assertLess(len(shapes), 5)
            self.assertEqual(float(shapes[0]["shape_dist_traveled"]), 0.0)
            self.assertGreater(float(shapes[-1]["shape_dist_traveled"]), 2_000.0)
            self.assertEqual(
                (float(shapes[0]["shape_pt_lat"]), float(shapes[0]["shape_pt_lon"])),
                (35.0, 135.0),
            )
            self.assertEqual(
                (float(shapes[-1]["shape_pt_lat"]), float(shapes[-1]["shape_pt_lon"])),
                (35.0, 135.03),
            )

    def test_leaves_unmatched_trip_without_shape(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            gtfs = root / "rail.gtfs.zip"
            mlit = root / "N02.zip"
            write_gtfs(gtfs, stop_offset=2.0)
            write_mlit(mlit)

            stats = enrich_gtfs(gtfs, mlit)

            self.assertEqual(stats.candidate_trips, 1)
            self.assertEqual(stats.enriched_trips, 0)
            self.assertEqual(stats.generated_shapes, 0)
            with zipfile.ZipFile(gtfs) as archive:
                trips = read_rows(archive, "trips.txt")
                self.assertNotIn("shapes.txt", archive.namelist())
            high_speed = next(row for row in trips if row["trip_id"] == "fast")
            self.assertEqual(high_speed["shape_id"], "")

    def test_rejects_ambiguous_parallel_lines(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            gtfs = root / "rail.gtfs.zip"
            mlit = root / "N02.zip"
            write_gtfs(gtfs)
            write_mlit(mlit, ambiguous=True)

            stats = enrich_gtfs(gtfs, mlit)

            self.assertEqual(stats.candidate_trips, 1)
            self.assertEqual(stats.enriched_trips, 0)
            with zipfile.ZipFile(gtfs) as archive:
                self.assertNotIn("shapes.txt", archive.namelist())

    def test_connects_adjacent_lines_at_section_endpoints(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            gtfs = root / "rail.gtfs.zip"
            mlit = root / "N02.zip"
            write_gtfs(gtfs)
            write_mlit(mlit, split_lines=True, shared_transfer=True)

            stats = enrich_gtfs(gtfs, mlit)

            self.assertEqual(stats.enriched_trips, 1)
            with zipfile.ZipFile(gtfs) as archive:
                self.assertIn("shapes.txt", archive.namelist())

    def test_rejects_nearby_lines_without_shared_station(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            gtfs = root / "rail.gtfs.zip"
            mlit = root / "N02.zip"
            write_gtfs(gtfs)
            write_mlit(mlit, split_lines=True)

            stats = enrich_gtfs(gtfs, mlit)

            self.assertEqual(stats.enriched_trips, 0)
            with zipfile.ZipFile(gtfs) as archive:
                self.assertNotIn("shapes.txt", archive.namelist())

    def test_keeps_existing_provider_shape(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            gtfs = root / "rail.gtfs.zip"
            mlit = root / "N02.zip"
            write_gtfs(gtfs, existing_shape=True)
            write_mlit(mlit)

            stats = enrich_gtfs(gtfs, mlit)

            self.assertEqual(stats.candidate_trips, 0)
            with zipfile.ZipFile(gtfs) as archive:
                trips = read_rows(archive, "trips.txt")
                shapes = read_rows(archive, "shapes.txt")
            high_speed = next(row for row in trips if row["trip_id"] == "fast")
            self.assertEqual(high_speed["shape_id"], "provider_shape")
            self.assertEqual({row["shape_id"] for row in shapes}, {"provider_shape"})


def write_gtfs(path: Path, *, stop_offset: float = 0.0, existing_shape: bool = False) -> None:
    files = {
        "agency.txt": "agency_id,agency_name,agency_url,agency_timezone\na,Test,https://example.com,Asia/Tokyo\n",
        "calendar_dates.txt": "service_id,date,exception_type\nweekday,20260101,1\n",
        "routes.txt": "route_id,route_type,route_long_name\nfast-route,101,Test Shinkansen\nlocal-route,2,Local\n",
        "stops.txt": (
            "stop_id,stop_name,stop_lat,stop_lon\n"
            f"start,Start,{35.0 + stop_offset},{135.0 + stop_offset}\n"
            f"end,End,{35.0 + stop_offset},{135.03 + stop_offset}\n"
        ),
        "stop_times.txt": (
            "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"
            "fast,10:00:00,10:00:00,start,1\n"
            "fast,10:10:00,10:10:00,end,2\n"
            "local,10:00:00,10:00:00,start,1\n"
            "local,10:10:00,10:10:00,end,2\n"
        ),
        "trips.txt": (
            "route_id,service_id,trip_id,shape_id\n"
            f"fast-route,weekday,fast,{'provider_shape' if existing_shape else ''}\n"
            "local-route,weekday,local,\n"
        ),
    }
    if existing_shape:
        files["shapes.txt"] = (
            "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n"
            "provider_shape,35.0,135.0,1\n"
            "provider_shape,35.0,135.03,2\n"
        )
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in files.items():
            archive.writestr(name, content)


def write_mlit(
    path: Path,
    *,
    ambiguous: bool = False,
    split_lines: bool = False,
    shared_transfer: bool = False,
) -> None:
    end_line = "接続新幹線" if split_lines else "テスト新幹線"
    railroad = {
        "type": "FeatureCollection",
        "features": [
            feature("テスト新幹線", [[135.0, 35.0], [135.01, 35.001], [135.02, 35.0]]),
            feature(end_line, [[135.021, 35.0], [135.03, 35.0]]),
            feature("Local", [[136.0, 36.0], [136.1, 36.1]]),
        ],
    }
    stations = {
        "type": "FeatureCollection",
        "features": [
            station("テスト新幹線", "Start", [[135.0, 35.0], [135.0001, 35.0]]),
            station(end_line, "End", [[135.0299, 35.0], [135.03, 35.0]]),
        ],
    }
    if shared_transfer:
        stations["features"].extend(
            [
                station(
                    "テスト新幹線", "Junction", [[135.0199, 35.0], [135.02, 35.0]]
                ),
                station(
                    end_line, "Junction", [[135.021, 35.0], [135.0211, 35.0]]
                ),
            ]
        )
    if ambiguous:
        railroad["features"].append(
            feature(
                "競合新幹線",
                [[135.0, 35.002], [135.015, 35.004], [135.03, 35.002]],
            )
        )
        stations["features"].extend(
            [
                station("競合新幹線", "Start", [[135.0, 35.002], [135.0001, 35.002]]),
                station("競合新幹線", "End", [[135.0299, 35.002], [135.03, 35.002]]),
            ]
        )
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("N02/UTF-8/N02_RailroadSection.geojson", json.dumps(railroad))
        archive.writestr("N02/UTF-8/N02_Station.geojson", json.dumps(stations))


def feature(line: str, coordinates: list[list[float]]) -> dict[str, object]:
    return {
        "type": "Feature",
        "properties": {"N02_003": line, "N02_004": "Test Railway"},
        "geometry": {"type": "LineString", "coordinates": coordinates},
    }


def station(line: str, name: str, coordinates: list[list[float]]) -> dict[str, object]:
    value = feature(line, coordinates)
    properties = value["properties"]
    assert isinstance(properties, dict)
    properties["N02_005"] = name
    return value


def read_rows(archive: zipfile.ZipFile, name: str) -> list[dict[str, str]]:
    with archive.open(name) as source:
        text = io.TextIOWrapper(source, encoding="utf-8-sig", newline="")
        return list(csv.DictReader(text))


if __name__ == "__main__":
    unittest.main()
