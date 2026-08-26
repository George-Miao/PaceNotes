import type { ReactNode } from "react";
import styles from "./SoftAtoms.module.css";

type SoftAtomsProps = {
  theme: "light" | "dark";
};

type SectionProps = {
  title: string;
  children: ReactNode;
};

type RowProps = {
  icon: string;
  eyebrow: string;
  title: string;
  detail: string;
  meta: string;
  status?: string;
};

function Section({ title, children }: SectionProps) {
  return (
    <section className={styles.section} aria-labelledby={`soft-${title.toLowerCase().replaceAll(" ", "-")}`}>
      <h3 id={`soft-${title.toLowerCase().replaceAll(" ", "-")}`}>{title}</h3>
      {children}
    </section>
  );
}

function PlannerRow({ icon, eyebrow, title, detail, meta, status }: RowProps) {
  return (
    <article className={styles.plannerRow}>
      <span className={styles.rowIcon} aria-hidden="true">{icon}</span>
      <span className={styles.rowCopy}>
        <span className={styles.rowEyebrow}>{eyebrow}</span>
        <strong>{title}</strong>
        <span>{detail}</span>
      </span>
      <span className={styles.rowMeta}>
        <strong>{meta}</strong>
        {status ? <span className={styles.rowStatus}>{status}</span> : null}
      </span>
    </article>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5.25" />
      <path d="m12.5 12.5 4 4" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="4" cy="10" r="1" />
      <circle cx="10" cy="10" r="1" />
      <circle cx="16" cy="10" r="1" />
    </svg>
  );
}

export function SoftAtoms({ theme }: SoftAtomsProps) {
  return (
    <article className={styles.softAtoms} data-theme={theme} aria-labelledby="soft-atoms-title">
      <header className={styles.setHeader}>
        <div>
          <span className={styles.setIndex}>Set B</span>
          <h2 id="soft-atoms-title">Soft Utility</h2>
        </div>
        <p>Approachable controls for dense, everyday planning.</p>
      </header>

      <div className={styles.gallery}>
        <Section title="Type scale">
          <div className={styles.typeScale}>
            <div><span>Display</span><h1>Japan spring route</h1></div>
            <div><span>Heading</span><h2>Tokyo to Hakone</h2></div>
            <div><span>Section</span><h4>Thursday, 14 May</h4></div>
            <div><span>Body</span><p>Mountain rail, open-air art, and an onsen stay.</p></div>
            <div><span>Caption</span><small>Updated just now by Maya</small></div>
          </div>
        </Section>

        <Section title="Buttons">
          <div className={styles.buttonGrid}>
            <button className={styles.primaryButton} type="button">Save route</button>
            <button className={styles.secondaryButton} type="button">Add stop</button>
            <button className={styles.ghostButton} type="button">Cancel</button>
            <button className={styles.destructiveButton} type="button">Delete</button>
            <button className={styles.iconButton} type="button" aria-label="More actions"><MoreIcon /></button>
            <button className={styles.secondaryButton} type="button" disabled>Disabled</button>
            <button className={styles.primaryButton} type="button" aria-busy="true">
              <span className={styles.spinner} aria-hidden="true" />
              Saving
            </button>
          </div>
        </Section>

        <Section title="Fields">
          <div className={styles.fieldStack}>
            <label className={styles.searchField}>
              <span className={styles.srOnly}>Search places</span>
              <SearchIcon />
              <input type="search" placeholder="Search places" />
              <kbd>⌘ K</kbd>
            </label>
            <label className={styles.field}>
              <span>Trip name</span>
              <input type="text" defaultValue="Japan spring route" />
            </label>
            <label className={styles.field}>
              <span>Travel mode</span>
              <select defaultValue="train">
                <option value="walk">Walk</option>
                <option value="train">Train</option>
                <option value="taxi">Taxi</option>
              </select>
            </label>
            <label className={styles.field}>
              <span>Trip note</span>
              <textarea rows={2} defaultValue="Use the Marunouchi north exit." />
            </label>
            <label className={`${styles.field} ${styles.invalidField}`}>
              <span>Reservation code</span>
              <input type="text" defaultValue="SS-514" aria-invalid="true" aria-describedby="soft-code-error" />
              <small id="soft-code-error">Enter the 7-character code.</small>
            </label>
          </div>
          <div className={styles.choiceGrid}>
            <label className={styles.choice}><input type="checkbox" defaultChecked /><span>Show candidates</span></label>
            <label className={styles.choice}><input type="radio" name="soft-mode" defaultChecked /><span>Walking</span></label>
            <label className={styles.switchChoice}><input type="checkbox" role="switch" defaultChecked /><span className={styles.switchTrack} aria-hidden="true" /><span>Avoid tolls</span></label>
          </div>
        </Section>

        <Section title="Navigation">
          <nav className={styles.dateTabs} aria-label="Trip dates">
            <button type="button"><span>Wed</span><strong>13</strong></button>
            <button className={styles.activeDate} type="button" aria-current="date"><span>Thu</span><strong>14</strong></button>
            <button type="button"><span>Fri</span><strong>15</strong></button>
            <button type="button"><span>Sat</span><strong>16</strong></button>
          </nav>
          <div className={styles.segmented} aria-label="Planner view">
            <button type="button" aria-pressed="true">Map</button>
            <button type="button" aria-pressed="false">List</button>
            <button type="button" aria-pressed="false">Split</button>
          </div>
        </Section>

        <Section title="Signals">
          <div className={styles.signalRow}>
            <span className={styles.badge}>Reservation</span>
            <span className={styles.status}><i aria-hidden="true" />Confirmed</span>
            <span className={styles.warningStatus}><i aria-hidden="true" />Needs review</span>
            <span className={styles.presence}><span aria-hidden="true">MK</span><i aria-hidden="true" />Maya online</span>
          </div>
        </Section>

        <Section title="Planner rows">
          <div className={styles.rowStack}>
            <PlannerRow icon="⌖" eyebrow="Place" title="Nezu Shrine" detail="Azalea path and torii gates" meta="Open time" status="Flexible" />
            <PlannerRow icon="R" eyebrow="Reservation" title="Shibuya Sky" detail="Sunset entry - party of 2" meta="18:20" status="Confirmed" />
            <PlannerRow icon="H" eyebrow="Lodging" title="Sawanoya Ryokan" detail="Japanese room - check-in 15:00" meta="2 nights" status="Booked" />
            <PlannerRow icon="N" eyebrow="Note" title="Use the north exit" detail="Marunouchi side has the shorter transfer." meta="10:18" />
            <PlannerRow icon="T" eyebrow="Transport" title="Metro to Tawaramachi" detail="Asakusa Line and Ginza Line" meta="26 min" status="1 change" />
          </div>
        </Section>

        <Section title="Map markers">
          <div className={styles.markerStage} aria-label="Map marker examples">
            <span className={styles.routeLine} aria-hidden="true" />
            <button className={styles.numberMarker} type="button" aria-label="Stop 1: Nezu Shrine">1</button>
            <button className={`${styles.numberMarker} ${styles.selectedMarker}`} type="button" aria-label="Selected stop 2: Shibuya Sky">2</button>
            <button className={styles.candidateMarker} type="button" aria-label="Candidate place: Hakone Yuryo">+</button>
          </div>
        </Section>

        <Section title="Surfaces">
          <div className={styles.surfaceGrid}>
            <article className={styles.card}>
              <span className={styles.surfaceLabel}>Card</span>
              <strong>Tokyo to Hakone</strong>
              <p>5 stops - 3 hr 20 min travel</p>
              <button type="button">Open day</button>
            </article>

            <aside className={styles.popup} aria-label="Place popup">
              <span className={styles.surfaceLabel}>Popup</span>
              <strong>Nezu Shrine</strong>
              <p>Open until 17:00 - 45 min</p>
              <button type="button">Add to day</button>
            </aside>

            <section className={styles.dialog} role="dialog" aria-modal="false" aria-labelledby="soft-dialog-title">
              <span className={styles.surfaceLabel}>Dialog</span>
              <strong id="soft-dialog-title">Remove this stop?</strong>
              <p>Nezu Shrine will return to saved places.</p>
              <div><button className={styles.ghostButton} type="button">Cancel</button><button className={styles.destructiveButton} type="button">Remove</button></div>
            </section>

            <section className={styles.bottomSheet} aria-label="Bottom sheet example">
              <span className={styles.sheetHandle} aria-hidden="true" />
              <span className={styles.surfaceLabel}>Bottom sheet</span>
              <strong>Thursday, 14 May</strong>
              <p>5 stops - Tokyo to Hakone</p>
              <button type="button">View itinerary</button>
            </section>
          </div>

          <div className={styles.feedbackStack}>
            <div className={styles.toast} role="status">
              <span aria-hidden="true">✓</span>
              <div><strong>Stop added</strong><p>Nezu Shrine was added to Thursday.</p></div>
              <button type="button">Undo</button>
            </div>
            <div className={styles.routeWarning} role="alert">
              <span aria-hidden="true">!</span>
              <div><strong>Route needs review</strong><p>Allow 10 more minutes before the Romancecar.</p></div>
              <button type="button">Review</button>
            </div>
            <div className={styles.syncStatus} role="status">
              <span className={styles.syncDot} aria-hidden="true" />
              <span><strong>All changes synced</strong><small>Updated just now</small></span>
            </div>
          </div>
        </Section>
      </div>
    </article>
  );
}
