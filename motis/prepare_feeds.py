#!/usr/bin/env python3

from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import re
import shutil
import sys
import tempfile
import time
import urllib.parse
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import date
from html.parser import HTMLParser
from pathlib import Path

TRANSITOUS_INDEX_URL = "https://api.transitous.org/gtfs/"
ATLAS_URL = (
    "https://raw.githubusercontent.com/transitland/transitland-atlas/main/"
    "feeds/tshimada291.github.com.dmfr.json"
)
GTFS_REPOSITORY_URL = "https://api.gtfs-data.jp/v2/feeds"
MOBILITY_DATABASE_URL = "https://files.mobilitydatabase.org/feeds_v2.csv"
HODA_URL = "https://ckan.hoda.jp/api/3/action/package_show?id=gtfs-data"
HODA_ARCHIVES = frozenset(
    {
        "abiracho_com.zip",
        "atsuma_bus.zip",
        "bankei_bus.zip",
        "betsukaicho_com.zip",
        "dohoku_bus.zip",
        "engan_bus.zip",
        "engarucho_com.zip",
        "furano_bus.zip",
        "fukagawashi_com.zip",
        "haborocho_com.zip",
        "hokkaido-express_bus.zip",
        "hokkaido_chuo.zip",
        "hokkaido_kamikawacho_com.zip",
        "hokumon_bus.zip",
        "hoshinoresorts_tomamu.zip",
        "iwanaicho_com.zip",
        "joutetsu.zip",
        "kimobetsucho_com.zip",
        "kuriyamacho_com.zip",
        "kushiro_bus.zip",
        "kutchancho_com.zip",
        "makubetsucho_com.zip",
        "meishi_bus.zip",
        "memurocho_com.zip",
        "mikasashi_com.zip",
        "minamifuranocho_com.zip",
        "naiecho_com.zip",
        "nakashibetsucho_com.zip",
        "niseko_bus.zip",
        "obiun-kanko.zip",
        "okoppecho_com.zip",
        "otofukecho_com.zip",
        "rankoshicho_com.zip",
        "saromacho_com.zip",
        "shibetsu_kido.zip",
        "shihorocho_com.zip",
        "shimokawacho_com.zip",
        "shimukappumura_com.zip",
        "shinshinotsu_kotsu.zip",
        "shiraoicho_com.zip",
        "shiranukacho_com.zip",
        "sorachi_chuo_bus.zip",
        "sorachi_kotsu.zip",
        "soya_bus.zip",
        "syari_bus.zip",
        "taikicho_com.zip",
        "tobetsucho_com.zip",
        "toyouracho_com.zip",
        "tsukigatacho_com.zip",
        "yutetsu_bus.zip",
    }
)
REQUIRED_GTFS_FILES = frozenset(
    {"agency.txt", "routes.txt", "stops.txt", "stop_times.txt", "trips.txt"}
)
USER_AGENT = "PaceNotes MOTIS feed builder"


@dataclass(frozen=True)
class Feed:
    catalog: str
    feed_id: str
    url: str
    filename: str


@dataclass(frozen=True)
class DownloadedFeed:
    feed: Feed
    sha256: str
    agencies: str


class FeedLinkParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag != "a":
            return
        href = next((value for name, value in attrs if name == "href"), None)
        if href and href.startswith("jp_") and href.endswith(".gtfs.zip"):
            self.links.append(href)


def request(url: str) -> urllib.request.Request:
    return urllib.request.Request(url, headers={"User-Agent": USER_AGENT})


def request_bytes(url: str) -> bytes:
    with urllib.request.urlopen(request(url), timeout=120) as response:
        return response.read()


def download(url: str, output: io.BufferedWriter) -> None:
    with urllib.request.urlopen(request(url), timeout=120) as response:
        shutil.copyfileobj(response, output, length=1024 * 1024)


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        while chunk := source.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def transitous_feeds_from_index(index: bytes) -> list[Feed]:
    return transitous_feeds(index.decode("utf-8", errors="replace"))


def safe_archive_filename(filename: str, prefix: str) -> str:
    if re.fullmatch(r"[A-Za-z0-9._%-]+", filename) and len(filename.encode()) <= 240:
        return filename
    digest = hashlib.sha256(filename.encode()).hexdigest()[:16]
    return f"{prefix}-{digest}.gtfs.zip"


def transitous_filename(filename: str) -> str:
    if filename == "jp_japan-rail.gtfs.zip":
        return "jp_japan-rail.source.gtfs.zip"
    return safe_archive_filename(filename, "jp_transitous")


def transitous_feeds(index: str) -> list[Feed]:
    parser = FeedLinkParser()
    parser.feed(index)
    feeds = []
    for filename in sorted(set(parser.links)):
        output = transitous_filename(filename)
        feeds.append(
            Feed(
                catalog="Transitous",
                feed_id=filename.removesuffix(".gtfs.zip"),
                url=urllib.parse.urljoin(TRANSITOUS_INDEX_URL, filename),
                filename=output,
            )
        )
    return feeds


def ottop_feeds(document: dict[str, object]) -> list[Feed]:
    result = []
    for entry in document.get("feeds", []):
        if not isinstance(entry, dict) or entry.get("spec") != "gtfs":
            continue
        urls = entry.get("urls")
        if not isinstance(urls, dict):
            continue
        url = urls.get("static_current")
        if not isinstance(url, str):
            continue
        if urllib.parse.urlparse(url).hostname != "api3.ottop.org":
            continue
        feed_id = str(entry.get("id", "")).removeprefix("f-").removesuffix("~jp")
        if not feed_id:
            continue
        filename = safe_archive_filename(
            f"jp_ottop-{feed_id.replace('~', '-')}.gtfs.zip", "jp_ottop"
        )
        result.append(
            Feed(
                catalog="Transitland Atlas",
                feed_id=feed_id,
                url=url,
                filename=filename,
            )
        )
    return sorted(result, key=lambda feed: feed.feed_id)


def repository_feeds(
    document: dict[str, object], today: date = date.today()
) -> list[Feed]:
    result = []
    for entry in document.get("body", []):
        if not isinstance(entry, dict) or entry.get("feed_is_discontinued") is True:
            continue
        organization_id = entry.get("organization_id")
        feed_id = entry.get("feed_id")
        end_date = entry.get("latest_feed_end_date")
        if (
            not isinstance(organization_id, str)
            or not isinstance(feed_id, str)
            or (isinstance(end_date, str) and end_date and end_date < today.isoformat())
        ):
            continue
        source_id = f"{organization_id}/{feed_id}"
        safe_id = re.sub(r"[^A-Za-z0-9._-]", "_", f"{organization_id}-{feed_id}")
        url = (
            "https://api.gtfs-data.jp/v2/organizations/"
            f"{urllib.parse.quote(organization_id, safe='')}/feeds/"
            f"{urllib.parse.quote(feed_id, safe='')}/files/feed.zip"
        )
        result.append(
            Feed(
                catalog="GTFS Data Repository",
                feed_id=source_id,
                url=url,
                filename=safe_archive_filename(
                    f"jp_repository-{safe_id}.gtfs.zip", "jp_repository"
                ),
            )
        )
    return sorted(result, key=lambda feed: feed.feed_id)


def mobility_database_feeds(document: str) -> list[Feed]:
    result = []
    for entry in csv.DictReader(io.StringIO(document)):
        if (
            entry.get("data_type") != "gtfs"
            or entry.get("location.country_code") != "JP"
            or entry.get("status", "") not in {"", "active"}
            or entry.get("urls.authentication_type", "") not in {"", "0"}
        ):
            continue
        url = entry.get("urls.direct_download") or entry.get("urls.latest")
        feed_id = entry.get("id")
        if not url or not feed_id:
            continue
        if urllib.parse.urlparse(url).hostname == "api.gtfs-data.jp":
            continue
        filename = safe_archive_filename(
            f"jp_mobility-{feed_id}.gtfs.zip", "jp_mobility"
        )
        result.append(
            Feed(
                catalog="Mobility Database",
                feed_id=feed_id,
                url=url,
                filename=filename,
            )
        )
    return sorted(result, key=lambda feed: feed.feed_id)


def hoda_feeds(document: dict[str, object]) -> list[Feed]:
    result = document.get("result")
    if not isinstance(result, dict):
        return []
    feeds = []
    for resource in result.get("resources", []):
        if not isinstance(resource, dict) or resource.get("state") != "active":
            continue
        url = resource.get("url")
        if not isinstance(url, str):
            continue
        archive = urllib.parse.unquote(urllib.parse.urlparse(url).path.rsplit("/", 1)[-1])
        if archive not in HODA_ARCHIVES:
            continue
        feed_id = archive.removesuffix(".zip")
        feeds.append(
            Feed(
                catalog="Hokkaido Open Data",
                feed_id=feed_id,
                url=url,
                filename=f"jp_hoda-{feed_id}.gtfs.zip",
            )
        )
    return sorted(feeds, key=lambda feed: feed.feed_id)


def hiroshima_feeds() -> list[Feed]:
    feeds = (
        ("geiyo", "https://ajt-mobusta-gtfs.mcapps.jp/static/11/current_data.zip"),
        ("hiroshima-bus", "https://ajt-mobusta-gtfs.mcapps.jp/static/9/current_data.zip"),
        ("hiroshima-kotsu", "https://ajt-mobusta-gtfs.mcapps.jp/static/10/current_data.zip"),
        ("bihoku-kotsu", "https://ajt-mobusta-gtfs.mcapps.jp/static/12/current_data.zip"),
        ("jr-bus-chugoku", "https://ajt-mobusta-gtfs.mcapps.jp/static/15/current_data.zip"),
        ("bon-bus", "https://ajt-mobusta-gtfs.mcapps.jp/static/13/current_data.zip"),
        ("fourble", "https://ajt-mobusta-gtfs.mcapps.jp/static/14/current_data.zip"),
        ("sasaki-kanko", "https://ajt-mobusta-gtfs.mcapps.jp/static/17/current_data.zip"),
        ("kure-city", "https://ajt-mobusta-gtfs.mcapps.jp/static/18/current_data.zip"),
        ("asahi-kotsu", "https://ajt-mobusta-gtfs.mcapps.jp/static/54/current_data.zip"),
        ("onomichi", "https://ajt-mobusta-gtfs.mcapps.jp/static/53/current_data.zip"),
        ("chugoku-bus", "https://bus-vision.jp/gtfs_v2/chugokubus/gtfsFeed"),
        ("ikasa-bus", "https://bus-vision.jp/gtfs_v2/ikasabus/gtfsFeed"),
        ("tomotetsu", "https://bus-vision.jp/gtfs_v2/tomotetsubus/gtfsFeed"),
    )
    return [
        Feed(
            catalog="Hiroshima Bus Association",
            feed_id=feed_id,
            url=url,
            filename=f"jp_hiroshima-{feed_id}.gtfs.zip",
        )
        for feed_id, url in feeds
    ]


def tottori_open_data_feeds() -> list[Feed]:
    archives = (
        ("nihon-kotsu", "1"),
        ("hinomaru", "2"),
        ("kofu-town", "14"),
        ("iwami-town", "4"),
    )
    return [
        Feed(
            catalog="Tottori Open Data",
            feed_id=feed_id,
            url=f"https://odp-pref-tottori.tori-info.co.jp/bus_data/{archive}.zip",
            filename=f"jp_tottori-{archive}.gtfs.zip",
        )
        for feed_id, archive in archives
    ]


def validate_gtfs(path: Path) -> str:
    with zipfile.ZipFile(path) as archive:
        bad_file = archive.testzip()
        if bad_file:
            raise ValueError(f"corrupt member {bad_file}")
        names = set(archive.namelist())
        missing = REQUIRED_GTFS_FILES - names
        if missing:
            raise ValueError(f"missing {', '.join(sorted(missing))}")
        if "calendar.txt" not in names and "calendar_dates.txt" not in names:
            raise ValueError("missing service calendar")
        agency_text = archive.read("agency.txt").decode("utf-8-sig")

    agencies = []
    for row in csv.DictReader(io.StringIO(agency_text)):
        agency_id = row.get("agency_id", "").strip()
        agency_name = row.get("agency_name", "").strip()
        label = agency_id or agency_name
        if label:
            agencies.append(label.replace("\t", " ").replace("\n", " "))
    return "; ".join(agencies)


def download_feed(feed: Feed, output_dir: Path) -> DownloadedFeed:
    destination = output_dir / feed.filename
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            with tempfile.NamedTemporaryFile(dir=output_dir, delete=False) as temporary:
                temporary_path = Path(temporary.name)
                download(feed.url, temporary)
            agencies = validate_gtfs(temporary_path)
            sha256 = file_sha256(temporary_path)
            os.replace(temporary_path, destination)
            return DownloadedFeed(feed=feed, sha256=sha256, agencies=agencies)
        except Exception as error:
            last_error = error
            if "temporary_path" in locals():
                temporary_path.unlink(missing_ok=True)
            if attempt < 2:
                time.sleep(2**attempt)
    raise RuntimeError(f"{feed.feed_id}: {last_error}")


def write_config(config_path: Path, feeds: list[DownloadedFeed]) -> None:
    config = config_path.read_text()
    start = config.index("  datasets:\n")
    end = config.index("osm:", start)
    datasets = ["  datasets:\n"]
    for index, downloaded in enumerate(feeds, start=1):
        filename = downloaded.feed.filename
        if filename == "jp_japan-rail.source.gtfs.zip":
            filename = "jp_japan-rail.gtfs.zip"
        datasets.extend(
            [
                f"    feed{index:04d}:\n",
                f"      path: {filename}\n",
            ]
        )
    config_path.write_text(config[:start] + "".join(datasets) + config[end:])


def write_manifest(path: Path, feeds: list[DownloadedFeed]) -> None:
    with path.open("w", newline="") as output:
        writer = csv.writer(output, delimiter="\t", lineterminator="\n")
        writer.writerow(["catalog", "feed_id", "url", "file", "sha256", "agencies"])
        for downloaded in feeds:
            feed = downloaded.feed
            writer.writerow(
                [
                    feed.catalog,
                    feed.feed_id,
                    feed.url,
                    feed.filename,
                    downloaded.sha256,
                    downloaded.agencies,
                ]
            )


def deduplicate_feeds(
    feeds: list[DownloadedFeed], output_dir: Path
) -> list[DownloadedFeed]:
    priorities = {
        "GTFS Data Repository": 1,
        "Transitland Atlas": 2,
        "Mobility Database": 3,
        "Hokkaido Open Data": 4,
        "Hiroshima Bus Association": 5,
        "Tottori Open Data": 6,
        "Transitous": 7,
    }
    ordered = sorted(
        feeds,
        key=lambda item: (
            0 if item.feed.filename == "jp_japan-rail.source.gtfs.zip" else 1,
            priorities[item.feed.catalog],
            item.feed.feed_id,
        ),
    )
    unique = []
    hashes: set[str] = set()
    for downloaded in ordered:
        if downloaded.sha256 in hashes:
            (output_dir / downloaded.feed.filename).unlink()
            continue
        hashes.add(downloaded.sha256)
        unique.append(downloaded)
    return sorted(unique, key=lambda item: (item.feed.catalog, item.feed.feed_id))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Fetch Japan GTFS coverage for the MOTIS image."
    )
    parser.add_argument("--config", type=Path, default=Path("config.yml"))
    parser.add_argument("--output", type=Path, default=Path("."))
    return parser.parse_args()


def main() -> None:
    arguments = parse_args()
    output_dir = arguments.output.resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    transitous = transitous_feeds_from_index(request_bytes(TRANSITOUS_INDEX_URL))
    atlas_document = json.loads(request_bytes(ATLAS_URL))
    repository_document = json.loads(request_bytes(GTFS_REPOSITORY_URL))
    mobility_document = request_bytes(MOBILITY_DATABASE_URL).decode("utf-8-sig")
    hoda_document = json.loads(request_bytes(HODA_URL))
    ottop = ottop_feeds(atlas_document)
    repository = repository_feeds(repository_document)
    mobility = mobility_database_feeds(mobility_document)
    hoda = hoda_feeds(hoda_document)
    hiroshima = hiroshima_feeds()
    tottori = tottori_open_data_feeds()
    feeds = transitous + ottop + repository + mobility + hoda + hiroshima + tottori
    if not transitous:
        raise RuntimeError("Transitous returned no Japan GTFS feeds")
    if not repository:
        raise RuntimeError("GTFS Data Repository returned no current feeds")
    if not any(feed.filename == "jp_japan-rail.source.gtfs.zip" for feed in feeds):
        raise RuntimeError("Transitous did not list the Japan rail feed")
    print(
        f"Discovered {len(transitous)} Transitous, {len(ottop)} OTTOP, "
        f"{len(repository)} GTFS Data Repository, "
        f"{len(mobility)} Mobility Database, {len(hoda)} Hokkaido Open Data, "
        f"{len(hiroshima)} Hiroshima Bus Association, and "
        f"{len(tottori)} Tottori Open Data feeds",
        flush=True,
    )

    downloaded: list[DownloadedFeed] = []
    failures: list[str] = []
    with ThreadPoolExecutor(max_workers=12) as executor:
        jobs = {
            executor.submit(download_feed, feed, output_dir): feed for feed in feeds
        }
        for job in as_completed(jobs):
            feed = jobs[job]
            try:
                result = job.result()
                downloaded.append(result)
                print(f"Downloaded {feed.feed_id}", flush=True)
            except Exception as error:
                failures.append(str(error))
                print(f"Skipped {error}", file=sys.stderr, flush=True)

    downloaded = deduplicate_feeds(downloaded, output_dir)
    if not any(
        item.feed.filename == "jp_japan-rail.source.gtfs.zip" for item in downloaded
    ):
        raise RuntimeError("Japan rail feed failed validation")

    write_config(arguments.config, downloaded)
    write_manifest(output_dir / "input-sources.tsv", downloaded)
    (output_dir / "input-failures.txt").write_text(
        "\n".join(failures) + ("\n" if failures else "")
    )
    print(f"Prepared {len(downloaded)} feeds; skipped {len(failures)}", flush=True)


if __name__ == "__main__":
    main()
