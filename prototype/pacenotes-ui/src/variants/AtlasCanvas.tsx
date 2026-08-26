import { useMemo, useState } from 'react';
import { sampleTrip } from '../sample';
import styles from './AtlasCanvas.module.css';

type SheetLevel = 'peek' | 'list' | 'detail';

const initialDayIndex = Math.max(
  0,
  sampleTrip.days.findIndex((day) => day.id === sampleTrip.activeDay),
);
const initialItemId = sampleTrip.days[initialDayIndex]?.itemIds[0] ?? sampleTrip.items[0]?.id ?? '';

export function AtlasCanvas() {
  const [selectedDayIndex, setSelectedDayIndex] = useState(initialDayIndex);
  const [selectedItemId, setSelectedItemId] = useState(initialItemId);
  const [sheetLevel, setSheetLevel] = useState<SheetLevel>('list');
  const selectedDay = sampleTrip.days[selectedDayIndex] ?? sampleTrip.days[0];

  const dayItems = useMemo(
    () => sampleTrip.items.filter((item) => item.dayId === selectedDay.id),
    [selectedDay.id],
  );
  const dayCandidates = useMemo(
    () => sampleTrip.candidates.filter((candidate) => candidate.dayId === selectedDay.id),
    [selectedDay.id],
  );
  const routeSegments = useMemo(
    () => sampleTrip.route.segments.filter((segment) => segment.dayId === selectedDay.id),
    [selectedDay.id],
  );
  const selectedItem = dayItems.find((item) => item.id === selectedItemId) ?? dayItems[0];

  const selectDay = (index: number) => {
    const day = sampleTrip.days[index];
    if (!day) return;
    setSelectedDayIndex(index);
    setSelectedItemId(day.itemIds[0] ?? '');
    setSheetLevel('list');
  };

  const selectItem = (itemId: string) => {
    setSelectedItemId(itemId);
    setSheetLevel('detail');
  };

  return (
    <main className={styles.atlas} aria-label="Atlas itinerary planner">
      <section className={styles.map} aria-label={`Map for ${selectedDay.title}`}>
        <svg className={styles.mapArt} viewBox="0 0 1440 900" role="img" aria-label={`Selected route for ${selectedDay.city}`}>
          <defs>
            <pattern id="atlas-grid" width="72" height="72" patternUnits="userSpaceOnUse">
              <path d="M 72 0 L 0 0 0 72" className={styles.mapGrid} />
            </pattern>
            <filter id="atlas-route-shadow" x="-20%" y="-20%" width="140%" height="140%">
              <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.16" />
            </filter>
          </defs>
          <rect width="1440" height="900" className={styles.mapBase} />
          <rect width="1440" height="900" fill="url(#atlas-grid)" />
          <path d="M-60 186 C180 158 286 265 485 208 S820 110 1035 194 1270 252 1500 164" className={styles.water} />
          <path d="M-80 690 C260 598 360 715 662 640 S1090 558 1510 676" className={styles.parkEdge} />
          <path d="M20 76 L1380 812 M110 -50 L1120 940 M-30 486 L1410 346 M260 0 L520 900 M730 -40 L820 930 M1080 -20 L1210 940" className={styles.majorRoads} />
          <path d="M0 320 C280 362 410 302 630 382 S980 482 1440 430 M170 0 C220 240 132 470 260 900 M940 0 C872 252 1000 490 910 900 M0 760 C360 710 710 820 1440 730" className={styles.minorRoads} />
          <g className={styles.blocks}>
            <path d="M520 250h120v58H520zM666 254h136v78H666zM840 230h124v64H840zM1010 270h156v82h-156z" />
            <path d="M416 446h120v98H416zM570 462h94v62h-94zM706 444h142v96H706zM892 482h122v72H892zM1050 442h162v86h-162z" />
          </g>
          <path d="M518 675 C620 625 653 547 726 520 S806 430 884 393 1000 358 1054 289 1176 238 1268 265" className={styles.routeHalo} />
          <path d="M518 675 C620 625 653 547 726 520 S806 430 884 393 1000 358 1054 289 1176 238 1268 265" className={styles.routeLine} filter="url(#atlas-route-shadow)" />
          <g className={styles.mapLabels}>
            <text x="620" y="170">NORTH QUAY</text>
            <text x="996" y="610">PINE DISTRICT</text>
            <text x="505" y="778">OLD MARKET</text>
            <text x="1070" y="184">RIVER WALK</text>
          </g>
        </svg>

        <div className={styles.mapHeader}>
          <span className={styles.eyebrow}>Selected route</span>
          <strong>{selectedDay.title}</strong>
          <span>{sampleTrip.route.summary}</span>
          <div className={styles.routeFacts}>
            <span>{sampleTrip.route.totalDistanceKm} km</span>
            <span>{sampleTrip.route.totalTravelMinutes} min</span>
            <span>{routeSegments.length} legs</span>
          </div>
          <span className={styles.routeState}>{sampleTrip.route.status.replace('-', ' ')}</span>
        </div>

        <div className={styles.mapTools} aria-label="Map controls">
          <button type="button" aria-label="Zoom in">+</button>
          <button type="button" aria-label="Zoom out">-</button>
          <button type="button" aria-label="Center route">Center</button>
        </div>

        <div className={styles.scale} aria-hidden="true"><span />200 m</div>

        {dayItems.slice(0, 6).map((item, index) => {
          const positions = [
            [36, 73], [49, 59], [58, 49], [68, 40], [77, 29], [88, 30],
          ];
          const [left, top] = positions[index] ?? [50, 50];
          return (
            <button
              type="button"
              className={`${styles.marker} ${selectedItem?.id === item.id ? styles.markerSelected : ''}`}
              style={{ left: `${left}%`, top: `${top}%` }}
              onClick={() => selectItem(item.id)}
              aria-label={`Stop ${index + 1}: ${item.title}`}
              aria-pressed={selectedItem?.id === item.id}
              key={item.id}
            >
              <span>{index + 1}</span>
            </button>
          );
        })}

        {dayCandidates.map((candidate, index) => {
          const positions = [[73, 63], [83, 52], [62, 25], [91, 71], [46, 35]];
          const [left, top] = positions[index % positions.length];
          return (
            <button
              type="button"
              className={styles.candidate}
              style={{ left: `${left}%`, top: `${top}%` }}
              aria-label={`Candidate: ${candidate.title}`}
              title={`${candidate.title} - ${candidate.reason}`}
              key={candidate.id}
            ><span /></button>
          );
        })}
      </section>

      <aside className={`${styles.rail} ${styles[`sheet_${sheetLevel}`]}`} aria-label="Trip plan">
        <div className={styles.resizeEdge} aria-hidden="true" />
        <div className={styles.sheetHandle} aria-hidden="true" />
        <div className={styles.sheetLevels} aria-label="Panel level">
          <button type="button" onClick={() => setSheetLevel('peek')} aria-pressed={sheetLevel === 'peek'}>Map</button>
          <button type="button" onClick={() => setSheetLevel('list')} aria-pressed={sheetLevel === 'list'}>List</button>
          <button type="button" onClick={() => setSheetLevel('detail')} aria-pressed={sheetLevel === 'detail'}>Detail</button>
        </div>
        <div className={styles.railHeader}>
          <div>
            <p className={styles.eyebrow}>{sampleTrip.dateRange}</p>
            <h1>{sampleTrip.title}</h1>
          </div>
          <div className={styles.editors} aria-label={`${sampleTrip.editors.length} online editors`}>
            {sampleTrip.editors.map((editor) => (
              <span
                className={styles.editor}
                data-color={editor.color}
                title={`${editor.name} - ${editor.status}: ${editor.lastAction}`}
                key={editor.id}
              >
                {editor.initials}
              </span>
            ))}
            <span className={styles.online}>{sampleTrip.editors.length} online</span>
          </div>
        </div>
        <div className={styles.editorActivity} aria-label="Editor activity">
          {sampleTrip.editors.map((editor) => (
            <span key={editor.id}>
              <i aria-hidden="true" />
              <strong>{editor.name}</strong>
              {editor.status}
            </span>
          ))}
        </div>


        <nav className={styles.days} aria-label="Trip days">
          {sampleTrip.days.map((day, index) => (
            <button
              type="button"
              onClick={() => selectDay(index)}
              className={selectedDayIndex === index ? styles.dayActive : ''}
              aria-current={selectedDayIndex === index ? 'date' : undefined}
              aria-label={`${day.weekday} ${day.shortDate} - ${day.city}`}
              key={day.id}
            >
              <span>{day.weekday}</span>
              <strong>{day.shortDate.split(' ')[0]}</strong>
            </button>
          ))}
        </nav>


        <div className={styles.agenda}>
          <div className={styles.daySummary}>
            <div>
              <span className={styles.eyebrow}>{selectedDay.weekday} - {selectedDay.shortDate} - {selectedDay.city}</span>
              <h2>{selectedDay.title}</h2>
              <p>{selectedDay.summary}</p>
            </div>
            <span>{selectedDay.weather}</span>
          </div>

          <div className={styles.agendaTitle}>
            <h3>Itinerary</h3>
            <span>{dayItems.length} stops</span>
          </div>

          <ol className={styles.itemList}>
            {dayItems.map((item, index) => {
              const isSelected = selectedItem?.id === item.id;
              return (
                <li className={isSelected ? styles.itemSelected : ''} key={item.id}>
                  <button type="button" className={styles.itemButton} onClick={() => selectItem(item.id)} aria-expanded={isSelected}>
                    <span className={styles.itemNumber}>{index + 1}</span>
                    <span className={styles.itemCopy}>
                      <span className={styles.itemTime}>{item.start ?? 'Open time'} - {item.status.replace('-', ' ')}</span>
                      <strong>{item.title}</strong>
                      <span>{item.subtitle} - {item.area}</span>
                    </span>
                    <span className={styles.itemAction} aria-hidden="true">›</span>
                  </button>
                  {isSelected && item.reservation && (
                    <section className={styles.reservation} aria-label={`${item.title} reservation`}>
                      <div className={styles.reservationTop}>
                        <span>Reservation</span>
                        <strong>{item.reservation.state}</strong>
                      </div>
                      <dl>
                        <div><dt>Time</dt><dd>{item.reservation.time}</dd></div>
                        {item.reservation.party && <div><dt>Party</dt><dd>{item.reservation.party}</dd></div>}
                        {item.reservation.code && <div><dt>Code</dt><dd>{item.reservation.code}</dd></div>}
                        <div><dt>Note</dt><dd>{item.reservation.note}</dd></div>
                      </dl>
                      <div className={styles.reservationActions}>
                        <button type="button">View note</button>
                        <button type="button">Open place</button>
                      </div>
                    </section>
                  )}
                  {isSelected && !item.reservation && (
                    <section className={styles.itemNote} aria-label={`${item.title} note`}>
                      <span>Plan note</span>
                      <p>{item.note}</p>
                      <div>{item.tags.map((tag) => <span key={tag}>{tag}</span>)}</div>
                    </section>
                  )}
                </li>
              );
            })}
          </ol>

          <section className={styles.candidateList} aria-labelledby="candidate-heading">
            <div><h3 id="candidate-heading">Saved candidates</h3><span>{dayCandidates.length}</span></div>
            {dayCandidates.map((candidate) => (
              <button type="button" key={candidate.id}>
                <span className={styles.candidateDot} />
                <span>{candidate.title}<small>{candidate.reason}</small></span>
                <span>{candidate.travelMinutes} min</span>
              </button>
            ))}
            {dayCandidates.length === 0 && <p>No saved candidates for this day.</p>}
          </section>
        </div>
      </aside>
    </main>
  );
}
