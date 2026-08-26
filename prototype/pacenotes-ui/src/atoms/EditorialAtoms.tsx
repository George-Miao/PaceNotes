import styles from "./EditorialAtoms.module.css";

type EditorialAtomsProps = {
  theme: "light" | "dark";
};

function SectionHeading({ index, children }: { index: string; children: string }) {
  return (
    <div className={styles.sectionHeading}>
      <span>{index}</span>
      <h3>{children}</h3>
    </div>
  );
}

function Row({
  code,
  title,
  meta,
  detail,
  status,
}: {
  code: string;
  title: string;
  meta: string;
  detail: string;
  status?: string;
}) {
  return (
    <article className={styles.itineraryRow}>
      <span className={styles.rowCode} aria-hidden="true">
        {code}
      </span>
      <div className={styles.rowCopy}>
        <span className={styles.rowMeta}>{meta}</span>
        <strong>{title}</strong>
        <span className={styles.rowDetail}>{detail}</span>
      </div>
      {status && <span className={styles.rowStatus}>{status}</span>}
      <button className={styles.rowAction} type="button" aria-label={`More options for ${title}`}>
        <span aria-hidden="true">•••</span>
      </button>
    </article>
  );
}

export function EditorialAtoms({ theme }: EditorialAtomsProps) {
  return (
    <section
      className={styles.editorial}
      data-theme={theme}
      aria-labelledby="editorial-atoms-title"
    >
      <header className={styles.masthead}>
        <div>
          <p className={styles.kicker}>Set D - Editorial utility</p>
          <h2 id="editorial-atoms-title">PaceNotes interface atoms</h2>
        </div>
        <span className={styles.themeLabel}>{theme} theme</span>
      </header>

      <section className={styles.atomSection} aria-label="Type scale">
        <SectionHeading index="01">Type scale</SectionHeading>
        <div className={styles.typeSpecimen} id="editorial-type-title">
          <p className={styles.displayType}>Japan spring route</p>
          <p className={styles.headingType}>Tokyo to Hakone</p>
          <p className={styles.sectionType}>Thursday, 14 May</p>
          <p className={styles.bodyType}>Mountain rail, open-air art, and an onsen stay.</p>
          <p className={styles.metaType}>Updated just now by Maya</p>
        </div>
      </section>

      <section className={styles.atomSection} aria-label="Buttons">
        <SectionHeading index="02">Buttons</SectionHeading>
        <div className={styles.controlGroup} id="editorial-buttons-title">
          <button className={styles.primaryButton} type="button">Save route</button>
          <button className={styles.secondaryButton} type="button">Add stop</button>
          <button className={styles.ghostButton} type="button">Cancel</button>
          <button className={styles.destructiveButton} type="button">Delete</button>
          <button className={styles.iconButton} type="button" aria-label="More actions">
            <span aria-hidden="true">•••</span>
          </button>
          <button className={styles.secondaryButton} type="button" disabled>Disabled</button>
          <button className={styles.loadingButton} type="button" disabled aria-busy="true">
            <span className={styles.spinner} aria-hidden="true" />
            Saving
          </button>
        </div>
      </section>

      <section className={styles.atomSection} aria-label="Fields">
        <SectionHeading index="03">Fields</SectionHeading>
        <div className={styles.fieldGrid} id="editorial-fields-title">
          <label className={styles.field}>
            <span>Search</span>
            <span className={styles.inputWrap}>
              <span className={styles.searchMark} aria-hidden="true" />
              <input type="search" placeholder="Search places" />
            </span>
          </label>
          <label className={styles.field}>
            <span>Trip name</span>
            <input type="text" defaultValue="Japan spring route" />
          </label>
          <label className={styles.field}>
            <span>Travel mode</span>
            <select defaultValue="train">
              <option value="train">Train</option>
              <option value="walk">Walking</option>
              <option value="car">Car</option>
            </select>
          </label>
          <label className={`${styles.field} ${styles.wideField}`}>
            <span>Trip note</span>
            <textarea defaultValue="Use the Marunouchi north exit." rows={3} />
          </label>
          <label className={`${styles.field} ${styles.validationField}`}>
            <span>Reservation code</span>
            <input type="text" defaultValue="SS-514" aria-invalid="true" aria-describedby="editorial-address-error" />
            <small id="editorial-address-error">Enter the 7-character code.</small>
          </label>
          <fieldset className={styles.choiceField}>
            <legend>Route details</legend>
            <label>
              <input type="checkbox" defaultChecked />
              <span>Show candidates</span>
            </label>
            <div className={styles.radioLine} role="radiogroup" aria-label="Travel mode">
              <label>
                <input type="radio" name="editorial-travel-mode" defaultChecked />
                <span>Walking</span>
              </label>
              <label>
                <input type="radio" name="editorial-travel-mode" />
                <span>Transit</span>
              </label>
            </div>
            <label className={styles.switchLine}>
              <input type="checkbox" role="switch" defaultChecked />
              <span className={styles.switchTrack} aria-hidden="true"><i /></span>
              <span>Avoid tolls</span>
            </label>
          </fieldset>
        </div>
      </section>

      <section className={styles.atomSection} aria-label="Navigation">
        <SectionHeading index="04">Navigation</SectionHeading>
        <div id="editorial-navigation-title">
          <nav className={styles.dateTabs} aria-label="Trip dates">
            <button type="button">
              <span>Wed</span><strong>13</strong>
            </button>
            <button className={styles.activeDate} type="button" aria-current="date">
              <span>Thu</span><strong>14</strong>
            </button>
            <button type="button">
              <span>Fri</span><strong>15</strong>
            </button>
            <button type="button">
              <span>Sat</span><strong>16</strong>
            </button>
          </nav>
          <div className={styles.segmented} aria-label="Planner view">
            <button type="button" aria-pressed="true">Map</button>
            <button type="button" aria-pressed="false">List</button>
            <button type="button" aria-pressed="false">Split</button>
          </div>
        </div>
      </section>

      <section className={styles.atomSection} aria-label="Signals">
        <SectionHeading index="05">Signals</SectionHeading>
        <div className={styles.indicators} id="editorial-indicators-title">
          <span className={styles.badge}>Reservation</span>
          <span className={styles.statusLine}><i aria-hidden="true" />Confirmed</span>
          <span className={styles.badgeMuted}>Needs review</span>
          <span className={styles.presence}>
            <span className={styles.avatar} aria-hidden="true">MK</span>
            <span><strong>Maya</strong> online</span>
          </span>
        </div>
      </section>

      <section className={styles.atomSection} aria-label="Planner rows">
        <SectionHeading index="06">Planner rows</SectionHeading>
        <div className={styles.rowList} id="editorial-rows-title">
          <Row code="P" meta="09:30 - Place" title="Nezu Shrine" detail="Shrine - Nezu 1-28-9" status="Saved" />
          <Row code="R" meta="12:30 - Reservation" title="Shibuya Sky" detail="Entry for 2 - Code PACE24" status="Confirmed" />
          <Row code="L" meta="15:00 - Lodging" title="Sawanoya Ryokan" detail="Check-in - Yanaka 2-3-11" status="Room 6" />
          <Row code="N" meta="Open time - Note" title="Use the north exit" detail="Shared note - Edited 4 min ago" />
          <Row code="T" meta="17:20 - Transport" title="Metro to Tawaramachi" detail="Ginza line - 12 min - Platform 2" status="On time" />
        </div>
      </section>

      <section className={styles.atomSection} aria-label="Map markers">
        <SectionHeading index="07">Map markers</SectionHeading>
        <div className={styles.markerStage} id="editorial-markers-title" aria-label="Map marker examples">
          <span className={styles.routeRule} aria-hidden="true" />
          <button className={styles.mapMarker} type="button" aria-label="Stop 1, Nezu Shrine">1</button>
          <button className={`${styles.mapMarker} ${styles.selectedMarker}`} type="button" aria-label="Stop 2, Shibuya Sky, selected" aria-pressed="true">2</button>
          <button className={styles.mapMarker} type="button" aria-label="Stop 3, Sawanoya Ryokan">3</button>
          <button className={styles.candidateMarker} type="button" aria-label="Candidate place, Kappabashi">
            <span aria-hidden="true">+</span>
          </button>
          <span className={styles.markerKey}>Numbered stop</span>
          <span className={styles.candidateKey}>Candidate</span>
        </div>
      </section>

      <section className={styles.atomSection} aria-label="Surfaces">
        <SectionHeading index="08">Surfaces</SectionHeading>
        <div className={styles.surfaceGrid} id="editorial-surfaces-title">
          <article className={styles.card}>
            <span className={styles.surfaceLabel}>Card</span>
            <h4>Japan spring route</h4>
            <p>Five stops from Tokyo to Hakone with 42 minutes of travel.</p>
            <button type="button">View itinerary</button>
          </article>

          <aside className={styles.popup} aria-label="Place popup">
            <span className={styles.surfaceLabel}>Popup</span>
            <strong>Nezu Shrine</strong>
            <span>4.7 - Shrine - 8 min walk</span>
            <button type="button">Add to day</button>
          </aside>

          <div className={styles.dialog} role="dialog" aria-labelledby="editorial-dialog-title">
            <div className={styles.dialogHeader}>
              <span className={styles.surfaceLabel}>Dialog</span>
              <button type="button" aria-label="Close dialog">×</button>
            </div>
            <h4 id="editorial-dialog-title">Remove this stop?</h4>
            <p>The reservation details will also leave the day.</p>
            <div className={styles.dialogActions}>
              <button className={styles.ghostButton} type="button">Cancel</button>
              <button className={styles.destructiveButton} type="button">Remove</button>
            </div>
          </div>

          <section className={styles.bottomSheet} aria-labelledby="editorial-sheet-title">
            <span className={styles.sheetHandle} aria-hidden="true" />
            <div>
              <span className={styles.surfaceLabel}>Bottom sheet</span>
              <h4 id="editorial-sheet-title">Route options</h4>
              <p>Fastest - 42 min - 7.8 km</p>
            </div>
            <button className={styles.secondaryButton} type="button">Review</button>
          </section>
          <div className={styles.messageStack} id="editorial-messages-title">
            <div className={styles.toast} role="status">
              <span><strong>Stop added</strong> Nezu Shrine is now stop 1.</span>
              <button type="button">Undo</button>
            </div>
            <div className={styles.routeWarning} role="alert">
              <span className={styles.warningMark} aria-hidden="true">!</span>
              <span><strong>Route needs review</strong> Stop 4 adds a 26 min walk.</span>
              <button type="button">Review route</button>
            </div>
            <div className={styles.syncStatus} role="status" aria-live="polite">
              <span className={styles.syncMark} aria-hidden="true" />
              <span><strong>All changes synced</strong> Updated just now</span>
            </div>
          </div>
        </div>
      </section>

    </section>
  );
}
