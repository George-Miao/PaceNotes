import { sampleTrip } from '../sample'
import styles from './FieldJournal.module.css'

type JournalRecord = Record<string, unknown>

type JournalTrip = {
  title: unknown
  dateRange: unknown
  activeDay: unknown
  days: unknown
  items: unknown
  candidates: unknown
  editors: unknown
  route: unknown
}

const trip = sampleTrip as unknown as JournalTrip

const asRecords = (value: unknown): JournalRecord[] =>
  Array.isArray(value)
    ? value.map((entry, index) =>
        typeof entry === 'object' && entry !== null
          ? (entry as JournalRecord)
          : { label: entry, index },
      )
    : []

const text = (value: unknown, fallback = ''): string => {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.map((entry) => text(entry)).filter(Boolean).join(', ')
  if (typeof value === 'object' && value !== null) {
    return Object.entries(value)
      .map(([key, entry]) => `${key.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').toLowerCase()}: ${text(entry)}`)
      .join(', ')
  }
  return fallback
}

const field = (record: JournalRecord, names: string[], fallback = ''): string => {
  for (const name of names) {
    const value = text(record[name])
    if (value) return value
  }
  return fallback
}

const dayRecords = asRecords(trip.days)
const itemRecords = asRecords(trip.items)
const candidateRecords = asRecords(trip.candidates)
const editorRecords = asRecords(trip.editors)
const route = trip.route as JournalRecord
const routeRecords = asRecords(route.segments)

const activeDayText = text(trip.activeDay, 'day-1')
const activeDayIndex = Math.max(
  0,
  dayRecords.findIndex((day, index) =>
    [field(day, ['id']), field(day, ['day']), field(day, ['label']), String(index + 1)].includes(
      activeDayText,
    ),
  ),
)
const activeItemRecords = itemRecords.filter((item) => field(item, ['dayId']) === activeDayText)

const itemTitle = (item: JournalRecord, index: number) =>
  field(item, ['title', 'name', 'place', 'label'], `Route note ${index + 1}`)

const detail = (record: JournalRecord, excluded: string[]) =>
  Object.entries(record)
    .filter(([key, value]) => !excluded.includes(key) && text(value))
    .map(([key, value]) => `${key.replace(/([a-z])([A-Z])/g, '$1 $2').replaceAll('_', ' ').toLowerCase()}: ${text(value)}`)
    .join(' - ')

export function FieldJournal() {
  return (
    <main className={styles.journal} aria-labelledby="journal-title">
      <section className={styles.map} aria-label="Muted terrain map and trip route">
        <svg className={styles.terrain} viewBox="0 0 1440 900" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
          <defs>
            <pattern id="journal-grid" width="72" height="72" patternUnits="userSpaceOnUse">
              <path d="M72 0H0V72" className={styles.gridLine} />
            </pattern>
          </defs>
          <path className={styles.landHigh} d="M-80 60C160 18 236 142 410 126S700 8 930 78s292 34 590-44v310c-205 62-357-28-548 35s-317 89-505 5S94 418-80 346Z" />
          <path className={styles.landMid} d="M-90 500c184-134 342-62 485-2s289 63 421-43 299-92 414-3 208 93 330 31v510H-90Z" />
          <path className={styles.water} d="M-40 738c175-92 295-30 433-54 191-34 259-185 430-147 196 43 304 211 666 86v330H-40Z" />
          <g className={styles.contours}>
            <path d="M-30 221c178-97 285 47 438-22S695 62 872 162s342-25 568-87" />
            <path d="M-20 267c172-83 290 44 448-8s282-119 450-35 339-18 585-71" />
            <path d="M49 605c145-63 259 35 405-9s232-151 395-76 287 171 554 42" />
            <path d="M39 649c166-50 268 43 420 5s237-124 393-67 306 147 550 38" />
          </g>
          <rect width="1440" height="900" fill="url(#journal-grid)" />
          <path className={styles.road} d="M90 710C233 643 253 485 423 462s223 80 354-30 208-211 366-172 160 148 236 164" />
          <path className={styles.routeLine} d="M116 687C250 608 278 505 432 482s218 71 348-40 207-178 347-148 163 102 230 111" />
          {[
            [116, 687],
            [432, 482],
            [780, 442],
            [1127, 294],
            [1357, 405],
          ].map(([cx, cy], index) => (
            <g key={`${cx}-${cy}`} transform={`translate(${cx} ${cy})`}>
              <circle className={styles.routeHalo} r="19" />
              <circle className={styles.routePoint} r="8" />
              <text className={styles.routeNumber} y="-27">{String(index + 1).padStart(2, '0')}</text>
            </g>
          ))}
        </svg>

        <div className={styles.mapCaption}>
          <span>Field map</span>
          <strong>
            {routeRecords.length} route lines - {field(route, ['summary'], 'Route is ready')}
          </strong>
        </div>

        <ol className={styles.mapNotes} aria-label="Route place sequence">
          {routeRecords.map((stop, index) => (
            <li key={`route-${index}`}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>
                {field(stop, ['from'], 'Start')} to {field(stop, ['to'], 'Next stop')}
              </strong>
              <small>{detail(stop, ['id', 'from', 'to']) || 'Marked route line'}</small>
            </li>
          ))}
        </ol>
      </section>

      <article className={styles.folio} aria-label="Trip folio">
        <header className={styles.folioHeader}>
          <p className={styles.kicker}>Pace notes - working folio</p>
          <h1 id="journal-title">{text(trip.title, 'Untitled trip')}</h1>
          <p className={styles.dateRange}>
            {text(trip.dateRange, 'Date not set')} - {field(route, ['status'], 'Route ready')} -{' '}
            {field(route, ['totalDistanceKm'], '0')} km - {field(route, ['totalTravelMinutes'], '0')} min
            <br />
            Updated {field(route, ['updatedAt'], 'now')} - unmatched: {field(route, ['unmatchedItemIds'], 'none')}
          </p>
        </header>

        <div className={styles.dayStamps} aria-label="Trip days">
          {dayRecords.map((day, index) => (
            <div className={index === activeDayIndex ? styles.dayStampActive : styles.dayStamp} key={`day-${index}`}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>{field(day, ['label', 'title', 'name'], `Day ${index + 1}`)}</strong>
              <small>{detail(day, ['id', 'day', 'label', 'title', 'name']) || 'Plan ready'}</small>
            </div>
          ))}
        </div>

        <section className={styles.fieldNotes} aria-labelledby="field-notes-title">
          <div className={styles.sectionHeading}>
            <p>Day {activeDayIndex + 1} - {field(dayRecords[activeDayIndex] ?? {}, ['city'], 'Route')}</p>
            <h2 id="field-notes-title">Notes in the margin</h2>
          </div>
          <ul>
            {activeItemRecords.map((item, index) => (
              <li key={`item-${index}`}>
                <time>{field(item, ['start', 'time', 'startTime', 'date'], item.isUntimed ? 'Open' : String(index + 1).padStart(2, '0'))}</time>
                <div>
                  <strong>{itemTitle(item, index)}</strong>
                  <p>{detail(item, ['id', 'dayId', 'coordinates', 'title', 'name', 'place', 'label', 'start', 'time', 'startTime', 'date']) || 'Pinned to the route'}</p>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <footer className={styles.folioFooter}>
          <section aria-labelledby="candidates-title">
            <h2 id="candidates-title">Places to check</h2>
            <ul>
              {candidateRecords.map((candidate, index) => (
                <li key={`candidate-${index}`}>
                  <strong>{field(candidate, ['title', 'name', 'place', 'label'], `Candidate ${index + 1}`)}</strong>
                  <span>{detail(candidate, ['title', 'name', 'place', 'label']) || 'Not on route'}</span>
                </li>
              ))}
            </ul>
          </section>
          <section aria-labelledby="editors-title">
            <h2 id="editors-title">Folio editors</h2>
            <ul className={styles.editors}>
              {editorRecords.map((editor, index) => (
                <li key={`editor-${index}`}>
                  <span aria-hidden="true">{field(editor, ['initials'], field(editor, ['name', 'title'], '?').slice(0, 2).toUpperCase())}</span>
                  <div>
                    <strong>{field(editor, ['name', 'title', 'label'], `Editor ${index + 1}`)}</strong>
                    <small>{detail(editor, ['initials', 'name', 'title', 'label']) || 'Editing now'}</small>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </footer>
      </article>

      <section className={styles.ledger} aria-labelledby="ledger-title">
        <header>
          <p>Itinerary ledger</p>
          <h2 id="ledger-title">The route, line by line</h2>
        </header>
        <ol>
          {itemRecords.map((item, index) => (
            <li
              className={field(item, ['dayId']) === activeDayText ? styles.ledgerActive : undefined}
              key={`ledger-${index}`}
            >
              <span>{String(index + 1).padStart(2, '0')}</span>
              <time>{field(item, ['start', 'time', 'startTime', 'date'], 'Open')}</time>
              <strong>{itemTitle(item, index)}</strong>
              <small>{field(item, ['duration', 'travelTime', 'kind', 'type'], 'Route note')}</small>
            </li>
          ))}
        </ol>
      </section>
    </main>
  )
}
