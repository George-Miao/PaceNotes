import { useMemo, useState } from "react";
import { sampleTrip, type TripItem } from "../sample";
import styles from "./NormalizedAtlas.module.css";

export type AtlasAccent = "blue" | "teal" | "green" | "coral";
type ColorMode = "light" | "dark";
type SheetLevel = "map" | "list" | "detail";

type NormalizedAtlasProps = {
  accent: AtlasAccent;
};

const markerPositions = [
  [34, 74],
  [47, 61],
  [57, 50],
  [68, 41],
  [78, 30],
  [88, 31],
] as const;

const candidatePositions = [
  [73, 65],
  [83, 53],
  [63, 25],
  [91, 71],
] as const;

const initialDayIndex = Math.max(
  0,
  sampleTrip.days.findIndex((day) => day.id === sampleTrip.activeDay),
);

function itemTime(item: TripItem) {
  if (item.isUntimed) return "Open time";
  if (item.start && item.end) return `${item.start}-${item.end}`;
  return item.start ?? item.end ?? "Open time";
}

export function NormalizedAtlas({ accent }: NormalizedAtlasProps) {
  const [mode, setMode] = useState<ColorMode>("light");
  const [dayIndex, setDayIndex] = useState(initialDayIndex);
  const [selectedItemId, setSelectedItemId] = useState(
    sampleTrip.days[initialDayIndex]?.itemIds[0] ?? sampleTrip.items[0]?.id ?? "",
  );
  const [sheetLevel, setSheetLevel] = useState<SheetLevel>("list");
  const selectedDay = sampleTrip.days[dayIndex] ?? sampleTrip.days[0];

  const dayItems = useMemo(
    () =>
      selectedDay.itemIds
        .map((id) => sampleTrip.items.find((item) => item.id === id))
        .filter((item): item is TripItem => item !== undefined),
    [selectedDay],
  );
  const candidates = useMemo(
    () => sampleTrip.candidates.filter((candidate) => candidate.dayId === selectedDay.id),
    [selectedDay.id],
  );
  const routeSegments = useMemo(
    () => sampleTrip.route.segments.filter((segment) => segment.dayId === selectedDay.id),
    [selectedDay.id],
  );
  const selectedItem =
    dayItems.find((item) => item.id === selectedItemId) ?? dayItems[0];

  function chooseDay(index: number) {
    const day = sampleTrip.days[index];
    if (!day) return;
    setDayIndex(index);
    setSelectedItemId(day.itemIds[0] ?? "");
    setSheetLevel("list");
  }

  function chooseItem(itemId: string) {
    setSelectedItemId(itemId);
    setSheetLevel("detail");
  }

  return (
    <main
      className={styles.planner}
      data-accent={accent}
      data-theme={mode}
      aria-label="Atlas itinerary planner"
    >
      <section className={styles.map} aria-label={`Map for ${selectedDay.title}`}>
        <svg
          className={styles.mapArt}
          viewBox="0 0 1440 900"
          preserveAspectRatio="xMidYMid slice"
          role="img"
          aria-labelledby="atlas-map-title atlas-map-description"
        >
          <title id="atlas-map-title">Route map for {selectedDay.city}</title>
          <desc id="atlas-map-description">
            A neutral street map with the selected route, numbered itinerary stops, and saved
            candidate places.
          </desc>
          <defs>
            <pattern id="normalized-atlas-grid" width="72" height="72" patternUnits="userSpaceOnUse">
              <path d="M72 0H0V72" className={styles.mapGrid} />
            </pattern>
          </defs>
          <rect width="1440" height="900" className={styles.mapBase} />
          <rect width="1440" height="900" fill="url(#normalized-atlas-grid)" />
          <path
            d="M-60 186C180 158 286 265 485 208S820 110 1035 194s235 58 465-30"
            className={styles.water}
          />
          <path
            d="M-80 690C260 598 360 715 662 640s428-82 848 36"
            className={styles.park}
          />
          <path
            d="M20 76l1360 736M110-50l1010 990M-30 486l1440-140M260 0l260 900M730-40l90 970M1080-20l130 960"
            className={styles.majorRoads}
          />
          <path
            d="M0 320c280 42 410-18 630 62s350 100 810 48M170 0c50 240-38 470 90 900M940 0c-68 252 60 490-30 900M0 760c360-50 710 60 1440-30"
            className={styles.minorRoads}
          />
          <g className={styles.blocks}>
            <path d="M520 250h120v58H520zM666 254h136v78H666zM840 230h124v64H840zM1010 270h156v82h-156z" />
            <path d="M416 446h120v98H416zM570 462h94v62h-94zM706 444h142v96H706zM892 482h122v72H892zM1050 442h162v86h-162z" />
          </g>
          <path
            d="M518 675c102-50 135-128 208-155s80-90 158-127 116-35 170-104 122-51 214-24"
            className={styles.routeHalo}
          />
          <path
            d="M518 675c102-50 135-128 208-155s80-90 158-127 116-35 170-104 122-51 214-24"
            className={styles.routeLine}
          />
          <g className={styles.mapLabels} aria-hidden="true">
            <text x="620" y="170">NORTH QUAY</text>
            <text x="996" y="610">PINE DISTRICT</text>
            <text x="505" y="778">OLD MARKET</text>
            <text x="1070" y="184">RIVER WALK</text>
          </g>
        </svg>

        <div className={styles.routeCard}>
          <span className={styles.eyebrow}>Selected route</span>
          <strong>{selectedDay.title}</strong>
          <p>{sampleTrip.route.summary}</p>
          <div className={styles.routeFacts}>
            <span>{sampleTrip.route.totalDistanceKm} km</span>
            <span>{sampleTrip.route.totalTravelMinutes} min</span>
            <span>{routeSegments.length} legs</span>
          </div>
          <span className={styles.routeStatus}>
            {sampleTrip.route.status.replaceAll("-", " ")}
          </span>
        </div>

        <div className={styles.mapControls} aria-label="Map controls">
          <button type="button" aria-label="Zoom in">+</button>
          <button type="button" aria-label="Zoom out">-</button>
          <button type="button" aria-label="Center route">Center</button>
        </div>

        {dayItems.slice(0, markerPositions.length).map((item, index) => {
          const [left, top] = markerPositions[index];
          const isSelected = selectedItem?.id === item.id;
          return (
            <button
              className={`${styles.marker} ${isSelected ? styles.markerSelected : ""}`}
              style={{ left: `${left}%`, top: `${top}%` }}
              type="button"
              aria-label={`Stop ${index + 1}: ${item.title}`}
              aria-pressed={isSelected}
              onClick={() => chooseItem(item.id)}
              key={item.id}
            >
              {index + 1}
            </button>
          );
        })}

        {candidates.slice(0, candidatePositions.length).map((candidate, index) => {
          const [left, top] = candidatePositions[index];
          return (
            <button
              className={styles.candidateMarker}
              style={{ left: `${left}%`, top: `${top}%` }}
              type="button"
              aria-label={`Candidate: ${candidate.title}`}
              title={`${candidate.title} - ${candidate.reason}`}
              key={candidate.id}
            >
              <span aria-hidden="true">+</span>
            </button>
          );
        })}
      </section>

      <aside
        className={`${styles.rail} ${styles[`sheet_${sheetLevel}`]}`}
        aria-label="Trip plan"
      >
        <div className={styles.sheetHandle} aria-hidden="true" />
        <div className={styles.sheetLevels} aria-label="Panel level">
          {(["map", "list", "detail"] as const).map((level) => (
            <button
              type="button"
              aria-pressed={sheetLevel === level}
              onClick={() => setSheetLevel(level)}
              key={level}
            >
              {level[0].toUpperCase() + level.slice(1)}
            </button>
          ))}
        </div>

        <header className={styles.railHeader}>
          <div className={styles.tripHeading}>
            <p className={styles.eyebrow}>{sampleTrip.dateRange}</p>
            <h1>{sampleTrip.title}</h1>
          </div>
          <div className={styles.headerActions}>
            <div className={styles.themeToggle} aria-label="Color mode">
              <button
                type="button"
                aria-pressed={mode === "light"}
                onClick={() => setMode("light")}
              >
                Light
              </button>
              <button
                type="button"
                aria-pressed={mode === "dark"}
                onClick={() => setMode("dark")}
              >
                Dark
              </button>
            </div>
            <div className={styles.editors} aria-label={`${sampleTrip.editors.length} online editors`}>
              {sampleTrip.editors.map((editor) => (
                <span
                  className={styles.editor}
                  title={`${editor.name} - ${editor.status}: ${editor.lastAction}`}
                  key={editor.id}
                >
                  {editor.initials}
                </span>
              ))}
              <span className={styles.online}>{sampleTrip.editors.length} online</span>
            </div>
          </div>
        </header>

        <div className={styles.editorActivity} aria-label="Editor activity">
          {sampleTrip.editors.map((editor) => (
            <span key={editor.id}>
              <i aria-hidden="true" />
              <strong>{editor.name}</strong> {editor.status}
            </span>
          ))}
        </div>

        <nav className={styles.dayStrip} aria-label="Trip days">
          {sampleTrip.days.map((day, index) => (
            <button
              className={dayIndex === index ? styles.daySelected : ""}
              type="button"
              aria-current={dayIndex === index ? "date" : undefined}
              aria-label={`${day.weekday} ${day.shortDate} - ${day.city}`}
              onClick={() => chooseDay(index)}
              key={day.id}
            >
              <span>{day.weekday}</span>
              <strong>{day.shortDate.split(" ")[0]}</strong>
            </button>
          ))}
        </nav>

        <div className={styles.scrollArea}>
          <section className={styles.daySummary} aria-labelledby="active-day-heading">
            <div>
              <span className={styles.eyebrow}>
                {selectedDay.weekday} - {selectedDay.shortDate} - {selectedDay.city}
              </span>
              <h2 id="active-day-heading">{selectedDay.title}</h2>
              <p>{selectedDay.summary}</p>
            </div>
            <span>{selectedDay.weather}</span>
          </section>

          <div className={styles.sectionTitle}>
            <h3>Itinerary</h3>
            <span>{dayItems.length} stops</span>
          </div>

          <ol className={styles.itemList}>
            {dayItems.map((item, index) => {
              const isSelected = selectedItem?.id === item.id;
              return (
                <li className={isSelected ? styles.itemSelected : ""} key={item.id}>
                  <button
                    className={styles.itemButton}
                    type="button"
                    aria-expanded={isSelected}
                    onClick={() => chooseItem(item.id)}
                  >
                    <span className={styles.itemNumber}>{index + 1}</span>
                    <span className={styles.itemCopy}>
                      <span className={styles.itemTime}>
                        {itemTime(item)} - {item.status.replaceAll("-", " ")}
                      </span>
                      <strong>{item.title}</strong>
                      <span>{item.subtitle} - {item.area}</span>
                    </span>
                    <span className={styles.itemArrow} aria-hidden="true">›</span>
                  </button>

                  {isSelected ? (
                    <section className={styles.itemDetail} aria-label={`${item.title} details`}>
                      <p>{item.note}</p>
                      <dl>
                        <div><dt>Type</dt><dd>{item.kind}</dd></div>
                        <div><dt>Status</dt><dd>{item.status.replaceAll("-", " ")}</dd></div>
                        {item.transport ? (
                          <>
                            <div><dt>Route</dt><dd>{item.transport.from} to {item.transport.to}</dd></div>
                            <div><dt>Travel</dt><dd>{item.transport.durationMinutes} min{item.transport.line ? ` - ${item.transport.line}` : ""}</dd></div>
                          </>
                        ) : null}
                        {item.reservation ? (
                          <>
                            <div><dt>Booking</dt><dd>{item.reservation.state} - {item.reservation.time}</dd></div>
                            {item.reservation.code ? <div><dt>Code</dt><dd>{item.reservation.code}</dd></div> : null}
                          </>
                        ) : null}
                        {item.lodging ? (
                          <div><dt>Stay</dt><dd>Check in {item.lodging.checkIn} - room {item.lodging.room}</dd></div>
                        ) : null}
                      </dl>
                      <div className={styles.tags}>
                        {item.tags.map((tag) => <span key={tag}>{tag}</span>)}
                      </div>
                      <button className={styles.primaryAction} type="button">Open place</button>
                    </section>
                  ) : null}
                </li>
              );
            })}
          </ol>

          <section className={styles.candidates} aria-labelledby="candidate-heading">
            <div className={styles.sectionTitle}>
              <h3 id="candidate-heading">Saved candidates</h3>
              <span>{candidates.length}</span>
            </div>
            {candidates.map((candidate) => (
              <button type="button" key={candidate.id}>
                <span className={styles.candidateDot} aria-hidden="true" />
                <span>
                  <strong>{candidate.title}</strong>
                  <small>{candidate.reason}</small>
                </span>
                <span>{candidate.travelMinutes} min</span>
              </button>
            ))}
            {candidates.length === 0 ? (
              <p>No candidates saved for this day. Check another day or add a place from the map.</p>
            ) : null}
          </section>
        </div>
      </aside>
    </main>
  );
}
