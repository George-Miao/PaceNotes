#!/usr/bin/env python3

import argparse
import copy
import csv
import hashlib
import heapq
import io
import json
import math
import os
import shutil
import tempfile
import unicodedata
import zipfile
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable, Iterator, Optional

Point = tuple[float, float]
LineKey = tuple[str, str]
RailState = tuple[LineKey, Point]

EARTH_RADIUS_METERS = 6_371_000.0
ENDPOINT_REPAIR_METERS = 300.0
STOP_SNAP_METERS = 500.0
MAXIMUM_PATH_RATIO = 2.5
SIMPLIFY_TOLERANCE_METERS = 20.0
PARALLEL_PATH_TOLERANCE_METERS = 100.0
GALA_YUZAWA_BOUNDS = (138.79, 36.93, 138.82, 36.96)
MINIMUM_BUILD_COVERAGE = 0.95
HIGH_SPEED_ROUTE_TYPE = "101"
GENERATED_SHAPE_PREFIX = "pn_n02_"


@dataclass(frozen=True)
class EnrichmentStats:
    candidate_trips: int
    enriched_trips: int
    generated_shapes: int
    unmatched_sequences: int


@dataclass(frozen=True)
class Stop:
    id: str
    name: str
    point: Point


class RailGraph:
    def __init__(self) -> None:
        self._edges: dict[Point, list[tuple[Point, float]]] = {}
        self._endpoints: list[Point] = []
        self._nodes: list[Point] = []
        self._path_cache: dict[tuple[Point, Point], Optional[tuple[Point, ...]]] = {}

    def add_line(self, points: list[Point]) -> None:
        if len(points) < 2:
            return
        self._endpoints.extend((points[0], points[-1]))
        for start, end in zip(points, points[1:]):
            self._add_edge(start, end)

    def finish(self) -> None:
        endpoints = tuple(dict.fromkeys(self._endpoints))
        for index, start in enumerate(endpoints):
            for end in endpoints[index + 1 :]:
                if start == end:
                    continue
                distance = distance_meters(start, end)
                if distance <= ENDPOINT_REPAIR_METERS:
                    self._add_edge(start, end, distance)
        self._nodes = list(self._edges)
        if not self._nodes:
            raise ValueError("MLIT archive has no eligible railway geometry")

    def nearest_node(self, point: Point, limit: float) -> Optional[Point]:
        nearest: Optional[Point] = None
        nearest_distance = math.inf
        for node in self._nodes:
            distance = distance_meters(point, node)
            if distance < nearest_distance:
                nearest = node
                nearest_distance = distance
        return nearest if nearest_distance <= limit else None

    def path(self, start: Point, end: Point) -> Optional[tuple[Point, ...]]:
        if start == end:
            return (start,)
        key = (start, end)
        if key in self._path_cache:
            return self._path_cache[key]
        reverse_key = (end, start)
        if reverse_key in self._path_cache:
            reverse = self._path_cache[reverse_key]
            return None if reverse is None else tuple(reversed(reverse))

        distances = {start: 0.0}
        previous: dict[Point, Point] = {}
        queue = [(distance_meters(start, end), 0.0, start)]
        while queue:
            _, current_distance, current = heapq.heappop(queue)
            if current_distance != distances.get(current):
                continue
            if current == end:
                break
            for neighbor, weight in self._edges.get(current, ()):
                candidate = current_distance + weight
                if candidate >= distances.get(neighbor, math.inf):
                    continue
                distances[neighbor] = candidate
                previous[neighbor] = current
                estimate = candidate + distance_meters(neighbor, end)
                heapq.heappush(queue, (estimate, candidate, neighbor))

        if end not in distances:
            self._path_cache[key] = None
            return None
        result = [end]
        while result[-1] != start:
            result.append(previous[result[-1]])
        result.reverse()
        path = tuple(result)
        self._path_cache[key] = path
        return path

    def _add_edge(self, start: Point, end: Point, distance: Optional[float] = None) -> None:
        if start == end:
            return
        weight = distance if distance is not None else distance_meters(start, end)
        self._edges.setdefault(start, []).append((end, weight))
        self._edges.setdefault(end, []).append((start, weight))


class RailNetwork:
    def __init__(self, graphs: dict[LineKey, RailGraph]) -> None:
        self._edges: dict[RailState, list[tuple[RailState, float]]] = {}
        self._path_cache: dict[
            tuple[RailState, RailState], Optional[tuple[Point, ...]]
        ] = {}
        for key, graph in graphs.items():
            for point, neighbors in graph._edges.items():
                state = (key, point)
                self._edges[state] = [
                    ((key, neighbor), weight) for neighbor, weight in neighbors
                ]

    def connect(
        self, first_key: LineKey, first: Point, second_key: LineKey, second: Point
    ) -> None:
        if first_key == second_key:
            return
        first_state = (first_key, first)
        second_state = (second_key, second)
        distance = distance_meters(first, second)
        self._edges[first_state].append((second_state, distance))
        self._edges[second_state].append((first_state, distance))

    def path(
        self, start_key: LineKey, start: Point, end_key: LineKey, end: Point
    ) -> Optional[tuple[Point, ...]]:
        start_state = (start_key, start)
        end_state = (end_key, end)
        key = (start_state, end_state)
        if key in self._path_cache:
            return self._path_cache[key]
        reverse_key = (end_state, start_state)
        if reverse_key in self._path_cache:
            reverse = self._path_cache[reverse_key]
            return None if reverse is None else tuple(reversed(reverse))

        distances = {start_state: 0.0}
        previous: dict[RailState, RailState] = {}
        queue = [(distance_meters(start, end), 0.0, start_state)]
        while queue:
            _, current_distance, current = heapq.heappop(queue)
            if current_distance != distances.get(current):
                continue
            if current == end_state:
                break
            for neighbor, weight in self._edges.get(current, ()):
                candidate = current_distance + weight
                if candidate >= distances.get(neighbor, math.inf):
                    continue
                distances[neighbor] = candidate
                previous[neighbor] = current
                estimate = candidate + distance_meters(neighbor[1], end)
                heapq.heappush(queue, (estimate, candidate, neighbor))

        if end_state not in distances:
            self._path_cache[key] = None
            return None
        states = [end_state]
        while states[-1] != start_state:
            states.append(previous[states[-1]])
        states.reverse()
        path = tuple(state[1] for state in states)
        self._path_cache[key] = path
        return path

class StationMatcher:
    def __init__(
        self,
        graphs: dict[LineKey, RailGraph],
        stations: Iterable[tuple[str, LineKey, list[Point]]],
    ) -> None:
        self._graphs = graphs
        self._by_name: dict[str, list[tuple[LineKey, Point]]] = {}
        self._all: list[tuple[LineKey, Point]] = []
        for name, key, points in stations:
            values = [(key, point) for point in points]
            self._by_name.setdefault(normalize_name(name), []).extend(values)
            self._all.extend(values)

    def match(self, stop: Stop) -> dict[LineKey, Point]:
        named = self._by_name.get(normalize_name(stop.name), ())
        matches = self._match_candidates(stop.point, named)
        return matches or self._match_candidates(stop.point, self._all)

    def _match_candidates(
        self, stop: Point, candidates: Iterable[tuple[LineKey, Point]]
    ) -> dict[LineKey, Point]:
        nearest: dict[LineKey, tuple[Point, float]] = {}
        for key, point in candidates:
            distance = distance_meters(stop, point)
            if distance > STOP_SNAP_METERS:
                continue
            current = nearest.get(key)
            if current is None or distance < current[1]:
                nearest[key] = (point, distance)
        result: dict[LineKey, Point] = {}
        for key, (point, _) in nearest.items():
            node = self._graphs[key].nearest_node(point, STOP_SNAP_METERS)
            if node is not None:
                result[key] = node
        return result


def enrich_gtfs(gtfs_path: Path, mlit_path: Path) -> EnrichmentStats:
    graphs, network, station_matcher = load_mlit(mlit_path)
    with zipfile.ZipFile(gtfs_path) as archive:
        routes, _ = read_csv(archive, "routes.txt")
        trips, trip_fields = read_csv(archive, "trips.txt")
        high_speed_routes = {
            row["route_id"] for row in routes if row.get("route_type") == HIGH_SPEED_ROUTE_TYPE
        }
        candidates = {
            row["trip_id"]
            for row in trips
            if row.get("route_id") in high_speed_routes and not row.get("shape_id", "").strip()
        }
        if not candidates:
            return EnrichmentStats(0, 0, 0, 0)
        sequences = read_stop_sequences(archive, candidates)
        required_stops = {stop_id for sequence in sequences.values() for stop_id in sequence}
        stops = read_stops(archive, required_stops)

    sequence_trips: dict[tuple[str, ...], list[str]] = {}
    for trip_id in sorted(candidates):
        sequence = sequences.get(trip_id, ())
        if len(sequence) >= 2:
            sequence_trips.setdefault(tuple(sequence), []).append(trip_id)

    generated: dict[str, list[Point]] = {}
    assignments: dict[str, str] = {}
    unmatched = 0
    for sequence, trip_ids in sorted(sequence_trips.items()):
        path = match_sequence(sequence, stops, graphs, network, station_matcher)
        if path is None:
            unmatched += 1
            continue
        shape_id = shape_id_for(sequence)
        generated[shape_id] = path
        for trip_id in trip_ids:
            assignments[trip_id] = shape_id

    if generated:
        rewrite_gtfs(gtfs_path, trips, trip_fields, assignments, generated)
    return EnrichmentStats(
        candidate_trips=len(candidates),
        enriched_trips=len(assignments),
        generated_shapes=len(generated),
        unmatched_sequences=unmatched,
    )


def load_mlit(
    path: Path,
) -> tuple[dict[LineKey, RailGraph], RailNetwork, StationMatcher]:
    graphs: dict[LineKey, RailGraph] = {}
    station_features: list[tuple[str, LineKey, list[Point]]] = []
    with zipfile.ZipFile(path) as archive:
        railroad = read_geojson(archive, "RailroadSection.geojson")
        stations = read_geojson(archive, "Station.geojson")

    for feature in railroad.get("features", ()):
        properties = feature.get("properties") or {}
        line = str(properties.get("N02_003") or "")
        if not eligible_line(line):
            continue
        key = line_key(properties)
        for points in geometry_lines(feature.get("geometry")):
            if not eligible_geometry(line, points):
                continue
            graphs.setdefault(key, RailGraph()).add_line(points)
    if not graphs:
        raise ValueError("MLIT archive has no eligible railway geometry")
    for graph in graphs.values():
        graph.finish()

    for feature in stations.get("features", ()):
        properties = feature.get("properties") or {}
        line = str(properties.get("N02_003") or "")
        name = str(properties.get("N02_005") or "")
        key = line_key(properties)
        if not name or not eligible_line(line) or key not in graphs:
            continue
        for points in geometry_lines(feature.get("geometry")):
            if eligible_geometry(line, points):
                station_features.append((name, key, points))
    if not station_features:
        raise ValueError("MLIT archive has no eligible railway stations")
    network = RailNetwork(graphs)
    connect_shared_stations(network, graphs, station_features)
    return graphs, network, StationMatcher(graphs, station_features)


def connect_shared_stations(
    network: RailNetwork,
    graphs: dict[LineKey, RailGraph],
    stations: Iterable[tuple[str, LineKey, list[Point]]],
) -> None:
    by_name: dict[str, list[tuple[LineKey, list[Point]]]] = {}
    for name, key, points in stations:
        by_name.setdefault(normalize_name(name), []).append((key, points))
    for candidates in by_name.values():
        for index, (first_key, first_points) in enumerate(candidates):
            for second_key, second_points in candidates[index + 1 :]:
                if first_key == second_key:
                    continue
                pair = closest_points(first_points, second_points)
                if pair is None or distance_meters(*pair) > STOP_SNAP_METERS:
                    continue
                first = graphs[first_key].nearest_node(pair[0], STOP_SNAP_METERS)
                second = graphs[second_key].nearest_node(pair[1], STOP_SNAP_METERS)
                if first is not None and second is not None:
                    network.connect(first_key, first, second_key, second)


def match_sequence(
    sequence: tuple[str, ...],
    stops: dict[str, Stop],
    graphs: dict[LineKey, RailGraph],
    network: RailNetwork,
    matcher: StationMatcher,
) -> Optional[list[Point]]:
    route: list[Point] = []
    matches: dict[str, dict[LineKey, Point]] = {}
    for start_id, end_id in zip(sequence, sequence[1:]):
        start_stop = stops.get(start_id)
        end_stop = stops.get(end_id)
        if start_stop is None or end_stop is None:
            return None
        start_matches = matches.setdefault(start_id, matcher.match(start_stop))
        end_matches = matches.setdefault(end_id, matcher.match(end_stop))
        valid = [
            result
            for key in start_matches.keys() & end_matches.keys()
            if (
                result := validated_path(
                    graphs[key],
                    start_matches[key],
                    end_matches[key],
                    start_stop,
                    end_stop,
                )
            )
            is not None
        ]
        if not valid:
            valid = [
                result
                for start_key, start in start_matches.items()
                for end_key, end in end_matches.items()
                if start_key != end_key
                and (
                    result := validated_network_path(
                        network,
                        start_key,
                        start,
                        end_key,
                        end,
                        start_stop,
                        end_stop,
                    )
                )
                is not None
            ]
        pair_path = select_path(valid)
        if pair_path is None:
            return None
        simplified = simplify_path(pair_path, SIMPLIFY_TOLERANCE_METERS)
        append_path(route, simplified)
    return route if len(route) >= 2 else None


def validated_path(
    graph: RailGraph,
    start: Point,
    end: Point,
    start_stop: Stop,
    end_stop: Stop,
) -> Optional[tuple[float, tuple[Point, ...]]]:
    if start == end:
        return None
    return validate_path(graph.path(start, end), start_stop, end_stop)


def validate_path(
    path: Optional[tuple[Point, ...]], start_stop: Stop, end_stop: Stop
) -> Optional[tuple[float, tuple[Point, ...]]]:
    if path is None:
        return None
    direct = distance_meters(start_stop.point, end_stop.point)
    path_distance = polyline_distance(path)
    if direct <= 0.0 or path_distance > direct * MAXIMUM_PATH_RATIO:
        return None
    return path_distance, path



def validated_network_path(
    network: RailNetwork,
    start_key: LineKey,
    start: Point,
    end_key: LineKey,
    end: Point,
    start_stop: Stop,
    end_stop: Stop,
) -> Optional[tuple[float, tuple[Point, ...]]]:
    path = network.path(start_key, start, end_key, end)
    return validate_path(path, start_stop, end_stop)

def select_path(
    valid: list[tuple[float, tuple[Point, ...]]]
) -> Optional[tuple[Point, ...]]:
    if not valid:
        return None
    valid.sort(key=lambda value: value[0])
    path = valid[0][1]
    if any(not paths_are_close(path, alternative) for _, alternative in valid[1:]):
        return None
    return path


def read_stop_sequences(
    archive: zipfile.ZipFile, trip_ids: set[str]
) -> dict[str, tuple[str, ...]]:
    ordered: dict[str, list[tuple[int, str]]] = {trip_id: [] for trip_id in trip_ids}
    with csv_reader(archive, "stop_times.txt") as reader:
        for row in reader:
            trip_id = row.get("trip_id", "")
            if trip_id not in ordered:
                continue
            ordered[trip_id].append((int(row["stop_sequence"]), row["stop_id"]))
    return {
        trip_id: tuple(stop_id for _, stop_id in sorted(values))
        for trip_id, values in ordered.items()
    }


def read_stops(archive: zipfile.ZipFile, stop_ids: set[str]) -> dict[str, Stop]:
    result: dict[str, Stop] = {}
    with csv_reader(archive, "stops.txt") as reader:
        for row in reader:
            stop_id = row.get("stop_id", "")
            if stop_id not in stop_ids:
                continue
            result[stop_id] = Stop(
                id=stop_id,
                name=row.get("stop_name", ""),
                point=(float(row["stop_lon"]), float(row["stop_lat"])),
            )
    return result


def rewrite_gtfs(
    path: Path,
    trips: list[dict[str, str]],
    trip_fields: list[str],
    assignments: dict[str, str],
    generated: dict[str, list[Point]],
) -> None:
    with tempfile.TemporaryDirectory(dir=path.parent) as directory:
        root = Path(directory)
        trips_path = root / "trips.txt"
        shapes_path = root / "shapes.txt"
        output_path = root / path.name
        write_trips(trips_path, trips, trip_fields, assignments)
        with zipfile.ZipFile(path) as source:
            write_shapes(shapes_path, source, generated)
            with zipfile.ZipFile(
                output_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9
            ) as target:
                for info in source.infolist():
                    if info.filename in {"trips.txt", "shapes.txt"}:
                        continue
                    copied = copy.copy(info)
                    copied.compress_type = zipfile.ZIP_DEFLATED
                    with source.open(info) as input_file, target.open(copied, "w") as output_file:
                        shutil.copyfileobj(input_file, output_file)
                target.write(trips_path, "trips.txt")
                target.write(shapes_path, "shapes.txt")
        os.replace(output_path, path)


def write_trips(
    path: Path,
    trips: list[dict[str, str]],
    fields: list[str],
    assignments: dict[str, str],
) -> None:
    output_fields = fields if "shape_id" in fields else [*fields, "shape_id"]
    with path.open("w", encoding="utf-8", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=output_fields, lineterminator="\n")
        writer.writeheader()
        for row in trips:
            value = dict(row)
            trip_id = value.get("trip_id", "")
            if trip_id in assignments:
                value["shape_id"] = assignments[trip_id]
            else:
                value.setdefault("shape_id", "")
            writer.writerow(value)


def write_shapes(
    path: Path, archive: zipfile.ZipFile, generated: dict[str, list[Point]]
) -> None:
    fields = [
        "shape_id",
        "shape_pt_lat",
        "shape_pt_lon",
        "shape_pt_sequence",
        "shape_dist_traveled",
    ]
    with path.open("w", encoding="utf-8", newline="") as output:
        writer = csv.DictWriter(output, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        if "shapes.txt" in archive.namelist():
            with csv_reader(archive, "shapes.txt") as reader:
                for row in reader:
                    writer.writerow({field: row.get(field, "") for field in fields})
        for shape_id, points in sorted(generated.items()):
            distance = 0.0
            previous: Optional[Point] = None
            for sequence, point in enumerate(points, start=1):
                if previous is not None:
                    distance += distance_meters(previous, point)
                writer.writerow(
                    {
                        "shape_id": shape_id,
                        "shape_pt_lat": format_coordinate(point[1]),
                        "shape_pt_lon": format_coordinate(point[0]),
                        "shape_pt_sequence": str(sequence),
                        "shape_dist_traveled": f"{distance:.1f}",
                    }
                )
                previous = point


def simplify_path(points: Iterable[Point], tolerance: float) -> list[Point]:
    path = list(points)
    if len(path) <= 2:
        return path
    keep = {0, len(path) - 1}
    pending = [(0, len(path) - 1)]
    while pending:
        start, end = pending.pop()
        furthest_index = -1
        furthest_distance = 0.0
        for index in range(start + 1, end):
            distance = segment_distance_meters(path[index], path[start], path[end])
            if distance > furthest_distance:
                furthest_index = index
                furthest_distance = distance
        if furthest_index >= 0 and furthest_distance > tolerance:
            keep.add(furthest_index)
            pending.append((start, furthest_index))
            pending.append((furthest_index, end))
    return [point for index, point in enumerate(path) if index in keep]

def paths_are_close(first: tuple[Point, ...], second: tuple[Point, ...]) -> bool:
    return path_is_close(first, second) and path_is_close(second, first)


def path_is_close(source: tuple[Point, ...], target: tuple[Point, ...]) -> bool:
    step = max(1, len(source) // 64)
    samples = [*source[::step], source[-1]]
    return all(
        point_path_distance(point, target) <= PARALLEL_PATH_TOLERANCE_METERS
        for point in samples
    )


def point_path_distance(point: Point, path: tuple[Point, ...]) -> float:
    return min(
        segment_distance_meters(point, start, end)
        for start, end in zip(path, path[1:])
    )


def segment_distance_meters(point: Point, start: Point, end: Point) -> float:
    latitude = math.radians((start[1] + end[1] + point[1]) / 3.0)
    scale_x = EARTH_RADIUS_METERS * math.cos(latitude) * math.pi / 180.0
    scale_y = EARTH_RADIUS_METERS * math.pi / 180.0
    end_x = (end[0] - start[0]) * scale_x
    end_y = (end[1] - start[1]) * scale_y
    point_x = (point[0] - start[0]) * scale_x
    point_y = (point[1] - start[1]) * scale_y
    length_squared = end_x * end_x + end_y * end_y
    if length_squared == 0.0:
        return math.hypot(point_x, point_y)
    ratio = max(0.0, min(1.0, (point_x * end_x + point_y * end_y) / length_squared))
    return math.hypot(point_x - ratio * end_x, point_y - ratio * end_y)


def append_path(target: list[Point], points: Iterable[Point]) -> None:
    for point in points:
        if not target or target[-1] != point:
            target.append(point)


def polyline_distance(points: Iterable[Point]) -> float:
    total = 0.0
    previous: Optional[Point] = None
    for point in points:
        if previous is not None:
            total += distance_meters(previous, point)
        previous = point
    return total


def distance_meters(start: Point, end: Point) -> float:
    longitude_1, latitude_1 = map(math.radians, start)
    longitude_2, latitude_2 = map(math.radians, end)
    latitude_delta = latitude_2 - latitude_1
    longitude_delta = longitude_2 - longitude_1
    value = (
        math.sin(latitude_delta / 2.0) ** 2
        + math.cos(latitude_1)
        * math.cos(latitude_2)
        * math.sin(longitude_delta / 2.0) ** 2
    )
    return EARTH_RADIUS_METERS * 2.0 * math.atan2(math.sqrt(value), math.sqrt(1.0 - value))


def nearest_point(point: Point, candidates: Iterable[Point]) -> Optional[Point]:
    nearest: Optional[Point] = None
    nearest_distance = math.inf
    for candidate in candidates:
        distance = distance_meters(point, candidate)
        if distance < nearest_distance:
            nearest = candidate
            nearest_distance = distance
    return nearest

def closest_points(
    first: Iterable[Point], second: Iterable[Point]
) -> Optional[tuple[Point, Point]]:
    closest: Optional[tuple[Point, Point]] = None
    closest_distance = math.inf
    for first_point in first:
        for second_point in second:
            distance = distance_meters(first_point, second_point)
            if distance < closest_distance:
                closest = first_point, second_point
                closest_distance = distance
    return closest


def shape_id_for(sequence: tuple[str, ...]) -> str:
    digest = hashlib.sha256("\0".join(sequence).encode()).hexdigest()[:20]
    return f"{GENERATED_SHAPE_PREFIX}{digest}"


def normalize_name(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value)
    return "".join(normalized.split()).removesuffix("駅")

def line_key(properties: dict[str, object]) -> LineKey:
    line = unicodedata.normalize("NFKC", str(properties.get("N02_003") or "")).strip()
    operator = unicodedata.normalize(
        "NFKC", str(properties.get("N02_004") or "")
    ).strip()
    return line, operator


def eligible_line(line: str) -> bool:
    normalized = unicodedata.normalize("NFKC", line)
    return "新幹線" in normalized or normalized in {"奥羽線", "田沢湖線", "上越線"}

def eligible_geometry(line: str, points: list[Point]) -> bool:
    if unicodedata.normalize("NFKC", line) != "上越線":
        return True
    minimum_longitude, minimum_latitude, maximum_longitude, maximum_latitude = (
        GALA_YUZAWA_BOUNDS
    )
    return all(
        minimum_longitude <= longitude <= maximum_longitude
        and minimum_latitude <= latitude <= maximum_latitude
        for longitude, latitude in points
    )


def geometry_lines(geometry: object) -> Iterator[list[Point]]:
    if not isinstance(geometry, dict):
        return
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates")
    if geometry_type == "LineString" and isinstance(coordinates, list):
        yield [coordinate_point(value) for value in coordinates]
    elif geometry_type == "MultiLineString" and isinstance(coordinates, list):
        for line in coordinates:
            if isinstance(line, list):
                yield [coordinate_point(value) for value in line]


def coordinate_point(value: object) -> Point:
    if not isinstance(value, list) or len(value) < 2:
        raise ValueError("Invalid MLIT coordinate")
    return float(value[0]), float(value[1])


def read_geojson(archive: zipfile.ZipFile, suffix: str) -> dict[str, object]:
    candidates = [
        name
        for name in archive.namelist()
        if "/UTF-8/" in name and name.endswith(suffix)
    ]
    if len(candidates) != 1:
        raise ValueError(f"MLIT archive must contain one UTF-8 {suffix}")
    with archive.open(candidates[0]) as source:
        value = json.load(io.TextIOWrapper(source, encoding="utf-8-sig"))
    if not isinstance(value, dict):
        raise ValueError(f"Invalid MLIT {suffix}")
    return value


def read_csv(
    archive: zipfile.ZipFile, name: str
) -> tuple[list[dict[str, str]], list[str]]:
    with csv_reader(archive, name) as reader:
        rows = list(reader)
        fields = list(reader.fieldnames or ())
    return rows, fields


class CsvReaderContext:
    def __init__(self, archive: zipfile.ZipFile, name: str) -> None:
        self._source = archive.open(name)
        self._text = io.TextIOWrapper(self._source, encoding="utf-8-sig", newline="")
        self.reader = csv.DictReader(self._text)

    def __enter__(self) -> csv.DictReader:
        return self.reader

    def __exit__(self, exception_type: object, exception: object, traceback: object) -> None:
        self._text.close()


def csv_reader(archive: zipfile.ZipFile, name: str) -> CsvReaderContext:
    return CsvReaderContext(archive, name)


def format_coordinate(value: float) -> str:
    return f"{value:.6f}".rstrip("0").rstrip(".")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Add MLIT N02 high-speed railway shapes to a GTFS archive."
    )
    parser.add_argument("gtfs", type=Path)
    parser.add_argument("mlit", type=Path)
    return parser.parse_args()


def main() -> None:
    arguments = parse_args()
    stats = enrich_gtfs(arguments.gtfs, arguments.mlit)
    if stats.candidate_trips:
        coverage = stats.enriched_trips / stats.candidate_trips
        if coverage < MINIMUM_BUILD_COVERAGE:
            raise SystemExit(
                f"rail shape coverage {coverage:.1%} is below {MINIMUM_BUILD_COVERAGE:.0%}"
            )
    print(json.dumps(asdict(stats), sort_keys=True))


if __name__ == "__main__":
    main()
