import { useMemo, useRef, useState } from 'react';
import { sampleTrip } from '../sample';
import styles from './RouteDeck.module.css';

const markerPositions = [
  [24, 73],
  [38, 62],
  [50, 51],
  [63, 43],
  [74, 32],
  [87, 23],
];

const candidatePositions = [
  [71, 64],
  [82, 51],
  [57, 24],
  [91, 72],
];

export function RouteDeck() {
  const initialDay = Math.max(
    0,
    sampleTrip.days.findIndex((day) => day.id === sampleTrip.activeDay),
  );
  const [dayIndex, setDayIndex] = useState(initialDay);
  const [itemIndex, setItemIndex] = useState(0);
  const [candidateId, setCandidateId] = useState(
    sampleTrip.candidates.find((candidate) => candidate.dayId === sampleTrip.activeDay)?.id ??
      sampleTrip.candidates[0].id,
  );
  const cardRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selectedDay = sampleTrip.days[dayIndex];
  const dayItems = useMemo(
    () =>
      selectedDay.itemIds
        .map((id) => sampleTrip.items.find((item) => item.id === id))
        .filter((item) => item !== undefined),
    [selectedDay],
  );
  const candidateIdeas = useMemo(
    () => [
      ...sampleTrip.candidates.filter((candidate) => candidate.dayId === selectedDay.id),
      ...sampleTrip.candidates.filter((candidate) => candidate.dayId !== selectedDay.id),
    ],
    [selectedDay],
  );
  const selected = dayItems[itemIndex] ?? dayItems[0];

  const chooseDay = (index: number) => {
    setDayIndex(index);
    setItemIndex(0);
    setCandidateId(
      sampleTrip.candidates.find((candidate) => candidate.dayId === sampleTrip.days[index].id)?.id ??
        sampleTrip.candidates[0].id,
    );
  };

  const chooseItem = (index: number, focus = false) => {
    setItemIndex(index);
    if (focus) cardRefs.current[index]?.focus();
  };

  const moveDeckFocus = (index: number, direction: -1 | 1) => {
    if (!dayItems.length) return;
    const next = (index + direction + dayItems.length) % dayItems.length;
    chooseItem(next, true);
    cardRefs.current[next]?.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
  };

  return (
    <main className={styles.routeDeck} aria-label="Route deck planner">
      <section className={styles.map} aria-label="Route map">
        <svg className={styles.mapArt} viewBox="0 0 1440 900" role="img" aria-label="Coastal city map with the active route">
          <defs>
            <pattern id="deck-blocks" width="152" height="116" patternUnits="userSpaceOnUse">
              <path d="M12 10h116v76H12zM136 20h12v58h-12z" className={styles.mapBlock} />
            </pattern>
          </defs>
          <rect width="1440" height="900" className={styles.mapLand} />
          <rect width="1440" height="900" fill="url(#deck-blocks)" />
          <path d="M-90 146C214 74 346 244 590 160S1022 80 1530 174V-40H-90Z" className={styles.ocean} />
          <path d="M-20 186C228 116 360 278 604 194S1026 114 1468 204" className={styles.shore} />
          <path d="M80 340C350 274 520 354 718 314S1060 240 1420 318M24 604C294 520 528 652 802 568S1174 486 1480 548M210 166L416 922M592 154L698 924M996 126L916 930M1258 172L1132 914" className={styles.roads} />
          <path d="M160 750C268 706 344 660 440 614S598 548 714 506S880 442 1000 374S1160 286 1288 248" className={styles.routeShadow} />
          <path d="M160 750C268 706 344 660 440 614S598 548 714 506S880 442 1000 374S1160 286 1288 248" className={styles.routeLine} />
          <g className={styles.mapNames}>
            <text x="152" y="264">WEST HARBOR</text>
            <text x="728" y="252">MARKET HILL</text>
            <text x="1090" y="560">CEDAR PARK</text>
          </g>
        </svg>

        <header className={styles.tripHeader}>
          <p>{sampleTrip.dateRange}</p>
          <h1>{sampleTrip.title}</h1>
          <div className={styles.routeSummary} aria-label="Active route">
            <span className={styles.routeMark} aria-hidden="true" />
            <span>
              <small>Active route</small>
              <strong>{sampleTrip.route.summary}</strong>
            </span>
            <b>{sampleTrip.route.totalDistanceKm} km - {sampleTrip.route.totalTravelMinutes} min</b>
          </div>
        </header>

        <div className={styles.editorPanel} aria-label={`${sampleTrip.editors.length} online editors`}>
          <div className={styles.editorFaces}>
            {sampleTrip.editors.slice(0, 4).map((editor) => (
              <span
                className={styles.editor}
                title={`${editor.name} - ${editor.status}`}
                key={editor.id}
              >
                {editor.initials}
              </span>
            ))}
          </div>
          <span><i aria-hidden="true" />{sampleTrip.editors.length} online</span>
        </div>

        <nav className={styles.dayRail} aria-label="Trip days">
          {sampleTrip.days.map((day, index) => (
            <button
              type="button"
              className={dayIndex === index ? styles.activeDay : ''}
              aria-current={dayIndex === index ? 'date' : undefined}
              aria-label={`${day.weekday} ${day.shortDate} - ${day.city}`}
              onClick={() => chooseDay(index)}
              key={day.id}
            >
              <span>{day.weekday}</span>
              <strong>{day.shortDate.split(' ')[0]}</strong>
            </button>
          ))}
        </nav>

        {dayItems.slice(0, markerPositions.length).map((item, index) => {
          const [left, top] = markerPositions[index];
          return (
            <button
              type="button"
              className={`${styles.stopMarker} ${itemIndex === index ? styles.activeMarker : ''}`}
              style={{ left: `${left}%`, top: `${top}%` }}
              aria-label={`Stop ${index + 1}: ${item.title}`}
              aria-pressed={itemIndex === index}
              onClick={() => chooseItem(index)}
              key={item.id}
            >
              {index + 1}
            </button>
          );
        })}

        {candidateIdeas.slice(0, candidatePositions.length).map((candidate, index) => {
          const [left, top] = candidatePositions[index];
          return (
            <button
              type="button"
              className={`${styles.candidateMarker} ${candidateId === candidate.id ? styles.activeCandidate : ''}`}
              style={{ left: `${left}%`, top: `${top}%` }}
              aria-label={`Candidate: ${candidate.title} in ${candidate.area}`}
              aria-pressed={candidateId === candidate.id}
              title={`${candidate.title} - ${candidate.reason}`}
              onClick={() => setCandidateId(candidate.id)}
              key={candidate.id}
            >
              <span aria-hidden="true">+</span>
            </button>
          );
        })}

        <article className={styles.focusStack} aria-live="polite">
          <div className={styles.stackSheet} aria-hidden="true" />
          <div className={styles.focusCard}>
            <div className={styles.focusTopline}>
              <span>Stop {Math.min(itemIndex + 1, dayItems.length || 1)}</span>
              <span>{selected.start ?? 'Open time'}</span>
            </div>
            <h2>{selected.title}</h2>
            <p>{selected.note}</p>
            <div className={styles.focusFacts}>
              <span>{selected.kind} - {selected.area}</span>
              <span>{selected.status}</span>
            </div>
          </div>
        </article>

        <section className={styles.candidateStrip} aria-label="Route candidates">
          <span className={styles.candidateLabel}>Candidates</span>
          {candidateIdeas.slice(0, 3).map((candidate) => (
            <button
              type="button"
              className={candidateId === candidate.id ? styles.activeCandidate : ''}
              aria-pressed={candidateId === candidate.id}
              onClick={() => setCandidateId(candidate.id)}
              key={candidate.id}
              title={`Preview ${candidate.title} - ${candidate.reason}`}
            >
              <span aria-hidden="true">+</span>
              {candidate.title} - {candidate.travelMinutes} min
            </button>
          ))}
        </section>

        <div className={styles.mapControls} aria-label="Map controls">
          <button type="button" aria-label="Zoom in">+</button>
          <button type="button" aria-label="Zoom out">-</button>
          <button type="button" aria-label="Center route">⌖</button>
        </div>
      </section>

      <section className={styles.deckRegion} aria-label="Itinerary deck">
        <div className={styles.deckHeading}>
          <span>{selectedDay.city} - {selectedDay.title}</span>
          <small>Swipe route stops</small>
        </div>
        <div className={styles.cards} role="listbox" aria-label="Route stops">
          {dayItems.map((item, index) => (
            <button
              type="button"
              role="option"
              aria-selected={itemIndex === index}
              className={`${styles.deckCard} ${itemIndex === index ? styles.activeCard : ''}`}
              onClick={() => chooseItem(index)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight') {
                  event.preventDefault();
                  moveDeckFocus(index, 1);
                }
                if (event.key === 'ArrowLeft') {
                  event.preventDefault();
                  moveDeckFocus(index, -1);
                }
              }}
              ref={(element) => {
                cardRefs.current[index] = element;
              }}
              key={item.id}
            >
              <span className={styles.cardNumber}>{String(index + 1).padStart(2, '0')}</span>
              <span className={styles.cardBody}>
                <small>{item.start ?? 'Open time'}</small>
                <strong>{item.title}</strong>
                <span>{item.subtitle} - {item.area}</span>
              </span>
              <span className={styles.cardArrow} aria-hidden="true">→</span>
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
