import { sampleTrip, type Candidate, type TripItem } from "../sample";
import styles from "./TransitConsole.module.css";

type MapPoint = {
  id: string;
  label: string;
  coordinates: [number, number];
  candidate?: boolean;
  marker?: string;
};

const allPathPoints = sampleTrip.route.segments.flatMap((segment) => segment.path);
const allMapPoints: MapPoint[] = [
  ...sampleTrip.items.map((item) => ({
    id: item.id,
    label: item.title,
    coordinates: item.coordinates,
  })),
  ...sampleTrip.candidates.map((candidate, index) => ({
    id: candidate.id,
    label: candidate.title,
    coordinates: candidate.coordinates,
    candidate: true,
    marker: `C${String(index + 1).padStart(2, "0")}`,
  })),
];
const allCoordinates = [
  ...allPathPoints,
  ...allMapPoints.map((point) => point.coordinates),
];
const longitudes = allCoordinates.map((point) => point[1]);
const latitudes = allCoordinates.map((point) => point[0]);
const mapBounds = {
  minLongitude: Math.min(...longitudes),
  maxLongitude: Math.max(...longitudes),
  minLatitude: Math.min(...latitudes),
  maxLatitude: Math.max(...latitudes),
};

function toMapPoint([latitude, longitude]: [number, number]) {
  const longitudeRange = mapBounds.maxLongitude - mapBounds.minLongitude || 1;
  const latitudeRange = mapBounds.maxLatitude - mapBounds.minLatitude || 1;

  return {
    x: 90 + ((longitude - mapBounds.minLongitude) / longitudeRange) * 820,
    y: 70 + ((mapBounds.maxLatitude - latitude) / latitudeRange) * 540,
  };
}

function toPolyline(path: [number, number][]) {
  return path
    .map((point) => {
      const mapped = toMapPoint(point);
      return `${mapped.x.toFixed(1)},${mapped.y.toFixed(1)}`;
    })
    .join(" ");
}

function formatItemTime(item: TripItem) {
  if (item.isUntimed) return "OPEN";
  if (item.start && item.end) return `${item.start}-${item.end}`;
  return item.start ?? item.end ?? "OPEN";
}

function getItemDuration(item: TripItem) {
  if (item.transport) return `${item.transport.durationMinutes} min`;
  if (item.start && item.end) return item.status;
  return item.isUntimed ? "No set time" : item.status;
}

function getItemDetails(item: TripItem) {
  const details = [item.subtitle, item.area, item.note, item.tags.join(", ")];

  if (item.transport) {
    details.push(
      `${item.transport.mode} from ${item.transport.from} to ${item.transport.to}`,
      `${item.transport.durationMinutes} min${item.transport.line ? ` on ${item.transport.line}` : ""}${item.transport.platform ? `, platform ${item.transport.platform}` : ""}`,
    );
  }

  if (item.reservation) {
    details.push(
      `Booking ${item.reservation.state} at ${item.reservation.time}${item.reservation.party ? ` for ${item.reservation.party}` : ""}${item.reservation.code ? `, code ${item.reservation.code}` : ""}`,
      item.reservation.note,
    );
  }

  if (item.lodging) {
    details.push(
      `Check in ${item.lodging.checkIn}, check out ${item.lodging.checkOut}`,
      `${item.lodging.address}, room ${item.lodging.room}`,
    );
  }

  return details.filter(Boolean).join(" - ");
}

function CandidateRow({ candidate, index }: { candidate: Candidate; index: number }) {
  return (
    <li>
      <button
        className={styles.candidateButton}
        type="button"
        aria-label={`Review candidate ${candidate.title}`}
      >
        <span className={styles.candidateIndex}>C{String(index + 1).padStart(2, "0")}</span>
        <span>
          <strong>{candidate.title}</strong>
          <span className={styles.candidateMeta}>
            {candidate.kind} - {candidate.area} - {candidate.reason}
          </span>
        </span>
        <span className={styles.candidateMeta}>
          {candidate.travelMinutes} min - {candidate.rating} - {candidate.price}
        </span>
      </button>
    </li>
  );
}

export function TransitConsole() {
  const activeDay =
    sampleTrip.days.find((day) => day.id === sampleTrip.activeDay) ?? sampleTrip.days[0];
  const tightSegments = sampleTrip.route.segments.filter(
    (segment) => segment.state !== "ready",
  ).length;

  return (
    <div className={styles.console}>
      <a className={styles.skipLink} href="#route-console">
        Skip to route console
      </a>

      <header className={styles.commandStrip} aria-label="Trip command strip">
        <div className={styles.tripIdentity}>
          <span className={styles.tripCode} aria-hidden="true">
            PC
          </span>
          <div className={styles.tripCopy}>
            <h1 className={styles.tripTitle}>{sampleTrip.title}</h1>
            <p className={styles.tripDate}>{sampleTrip.dateRange}</p>
          </div>
        </div>

        <nav className={styles.dayNav} aria-label="Trip days">
          {sampleTrip.days.map((day, index) => (
            <button
              className={styles.dayButton}
              type="button"
              key={day.id}
              aria-current={day.id === sampleTrip.activeDay ? "date" : undefined}
              title={`${day.date} - ${day.title} - ${day.summary} - ${day.weather}`}
            >
              {String(index + 1).padStart(2, "0")} {day.weekday} {day.shortDate} {day.city}
            </button>
          ))}
        </nav>

        <div className={styles.networkState} aria-label="System status">
          <span className={styles.status}>
            <span className={styles.light} aria-hidden="true" />
            <span>{sampleTrip.editors.length} people online</span>
          </span>
          <span className={styles.status}>
            <span className={`${styles.light} ${styles.lightAmber}`} aria-hidden="true" />
            <span>Route review</span>
          </span>
        </div>
      </header>

      <main className={styles.workspace}>
        <aside className={styles.actionRail} aria-label="Map actions">
          <button
            className={`${styles.actionButton} ${styles.actionButtonActive}`}
            type="button"
            aria-pressed="true"
          >
            <span>
              <kbd className={styles.keycap}>A</kbd>
              <span className={styles.actionLabel}>Active</span>
            </span>
          </button>
          <button className={styles.actionButton} type="button">
            <span>
              <kbd className={styles.keycap}>R</kbd>
              <span className={styles.actionLabel}>Route</span>
            </span>
          </button>
          <button className={styles.actionButton} type="button">
            <span>
              <kbd className={styles.keycap}>F</kbd>
              <span className={styles.actionLabel}>Fit</span>
            </span>
          </button>
          <span className={styles.railDivider} aria-hidden="true" />
          <button className={styles.actionButton} type="button">
            <span>
              <kbd className={styles.keycap}>C</kbd>
              <span className={styles.actionLabel}>Places</span>
            </span>
          </button>
          <button className={`${styles.actionButton} ${styles.railEnd}`} type="button">
            <span>
              <kbd className={styles.keycap}>?</kbd>
              <span className={styles.actionLabel}>Keys</span>
            </span>
          </button>
        </aside>

        <section className={styles.mapStage} aria-labelledby="map-heading">
          <div className={styles.mapHud}>
            <span className={styles.modeBadge} id="map-heading">
              {activeDay.city} - {activeDay.weekday} {activeDay.shortDate}
            </span>
            <p className={styles.mapHint}>
              {activeDay.title}. {activeDay.summary}. Weather: {activeDay.weather}.
            </p>
          </div>

          <svg
            className={styles.mapArt}
            viewBox="0 0 1000 720"
            preserveAspectRatio="xMidYMid slice"
            role="img"
            aria-labelledby="map-title map-description"
          >
            <title id="map-title">Trip route map</title>
            <desc id="map-description">
              All trip stops, candidate places, and route segments. Cyan lines are ready.
              Amber lines need review.
            </desc>
            <g className={styles.mapGrid} aria-hidden="true">
              {Array.from({ length: 13 }, (_, index) => (
                <line key={`v-${index}`} x1={index * 84} y1="0" x2={index * 84} y2="720" />
              ))}
              {Array.from({ length: 10 }, (_, index) => (
                <line key={`h-${index}`} x1="0" y1={index * 80} x2="1000" y2={index * 80} />
              ))}
            </g>
            <path
              className={styles.landMass}
              d="M-30 92L120 34L246 88L352 60L490 124L610 80L748 132L860 78L1030 108L1030 630L870 668L728 620L608 676L458 628L318 686L188 616L70 664L-30 610Z"
            />
            <g aria-hidden="true">
              <path className={styles.localRoad} d="M-20 198C168 240 280 172 448 220S758 286 1020 204" />
              <path className={styles.localRoad} d="M84 -20C132 170 100 314 194 474S348 642 390 760" />
              <path className={styles.localRoad} d="M528 -20C502 176 588 252 548 428S488 582 510 760" />
              <path className={styles.localRoad} d="M788 -20C744 150 830 304 770 452S692 630 720 760" />
              <path className={styles.localRoad} d="M-20 492C158 438 320 522 456 476S740 394 1020 510" />
            </g>
            <g aria-hidden="true">
              {sampleTrip.route.segments.map((segment) => {
                const points = toPolyline(segment.path);
                const warningClass =
                  segment.state === "ready" ? "" : ` ${styles.routeWalk}`;
                return (
                  <g key={segment.id}>
                    <polyline className={styles.routeShadow} points={points} />
                    <polyline className={`${styles.routeLine}${warningClass}`} points={points} />
                  </g>
                );
              })}
            </g>
            <g>
              {allMapPoints.map((point) => {
                const mapped = toMapPoint(point.coordinates);
                return (
                  <g
                    className={styles.mapNode}
                    key={point.id}
                    transform={`translate(${mapped.x.toFixed(1)} ${mapped.y.toFixed(1)})`}
                  >
                    <circle r={point.candidate ? 4 : 6} />
                    <text x="11" y="4">
                      {point.marker ?? point.label}
                    </text>
                  </g>
                );
              })}
            </g>
            <text className={styles.mapLabel} x="34" y="690">
              ALL DAYS - LIVE ROUTE MODEL
            </text>
          </svg>

          <div className={styles.metricDock} aria-label="Route metrics">
            <div className={styles.metric}>
              <span className={styles.metricLabel}>Distance</span>
              <span className={styles.metricValue}>
                <strong>{sampleTrip.route.totalDistanceKm}</strong> km
              </span>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>Travel</span>
              <span className={styles.metricValue}>
                <strong>{sampleTrip.route.totalTravelMinutes}</strong> min
              </span>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>Segments</span>
              <span className={styles.metricValue}>
                <strong>{sampleTrip.route.segments.length}</strong> total
              </span>
            </div>
            <div className={styles.metric}>
              <span className={styles.metricLabel}>Review</span>
              <span className={styles.metricValue}>
                <strong>{tightSegments}</strong> alerts
              </span>
            </div>
          </div>
        </section>

        <aside className={styles.routeConsole} id="route-console" aria-labelledby="route-heading">
          <header className={styles.consoleHeader}>
            <div className={styles.headerLine}>
              <div>
                <span className={styles.sectionLabel}>Route state</span>
                <h2 id="route-heading">{sampleTrip.route.summary}</h2>
              </div>
              <span className={styles.routeHealth}>{sampleTrip.route.status}</span>
            </div>
            <p className={styles.itemDetail}>Updated {sampleTrip.route.updatedAt}</p>
          </header>

          <details open>
            <summary className={styles.mobileSummary}>
              All trip items - {sampleTrip.items.length}
            </summary>
            <ol className={styles.timeline} aria-label="All trip items">
              {sampleTrip.items.map((item) => (
                <li className={styles.timelineItem} key={item.id}>
                  <time className={styles.itemTime}>{formatItemTime(item)}</time>
                  <span
                    className={`${styles.itemNode} ${
                      item.status === "needs-review" ? styles.itemNodeCandidate : ""
                    }`}
                    aria-hidden="true"
                  />
                  <div className={styles.itemBody}>
                    <div className={styles.itemMeta}>
                      <span className={styles.itemKind}>
                        {item.kind} - {item.status}
                      </span>
                      <span className={styles.itemDuration}>{getItemDuration(item)}</span>
                    </div>
                    <h3 className={styles.itemTitle}>{item.title}</h3>
                    <p className={styles.itemDetail}>{getItemDetails(item)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </details>

          <details className={styles.supportPanel} open>
            <summary className={styles.mobileSummary}>
              Route segments - {sampleTrip.route.segments.length}
            </summary>
            <div className={styles.supportContent}>
              <span className={styles.sectionLabel}>Performance</span>
              <h3>Route segments</h3>
              <ul className={styles.candidateList}>
                {sampleTrip.route.segments.map((segment, index) => (
                  <li key={segment.id}>
                    <button className={styles.candidateButton} type="button">
                      <span className={styles.candidateIndex}>
                        S{String(index + 1).padStart(2, "0")}
                      </span>
                      <span>
                        <strong>
                          {segment.from} to {segment.to}
                        </strong>
                        <span className={styles.candidateMeta}>
                          {segment.mode} - {segment.state}
                        </span>
                      </span>
                      <span className={styles.candidateMeta}>{segment.durationMinutes} min</span>
                    </button>
                  </li>
                ))}
              </ul>
              <p className={styles.itemDetail}>
                Unmatched items: {sampleTrip.route.unmatchedItemIds.join(", ") || "none"}
              </p>
            </div>
          </details>

          <details className={styles.supportPanel} open>
            <summary className={styles.mobileSummary}>
              Candidate places - {sampleTrip.candidates.length}
            </summary>
            <div className={styles.supportContent}>
              <span className={styles.sectionLabel}>Candidate queue</span>
              <h3>Places near this route</h3>
              <ul className={styles.candidateList}>
                {sampleTrip.candidates.map((candidate, index) => (
                  <CandidateRow candidate={candidate} index={index} key={candidate.id} />
                ))}
              </ul>
            </div>
          </details>

          <details className={styles.supportPanel} open>
            <summary className={styles.mobileSummary}>
              Trip team - {sampleTrip.editors.length}
            </summary>
            <div className={styles.supportContent}>
              <span className={styles.sectionLabel}>Live team</span>
              <h3>Trip editors</h3>
              <ul className={styles.editorList}>
                {sampleTrip.editors.map((editor) => (
                  <li className={styles.editor} key={editor.id}>
                    <span className={styles.editorMark} aria-hidden="true">
                      {editor.initials}
                    </span>
                    <span className={styles.editorName}>
                      {editor.name} - {editor.status} - {editor.lastAction} - {editor.color}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </details>
        </aside>
      </main>
    </div>
  );
}
