import bedDoubleIcon from "@iconify-icons/lucide/bed-double";
import calendarCheckIcon from "@iconify-icons/lucide/calendar-check-2";
import carFrontIcon from "@iconify-icons/lucide/car-front";
import chevronDownIcon from "@iconify-icons/lucide/chevron-down";
import footprintsIcon from "@iconify-icons/lucide/footprints";
import mapPinIcon from "@iconify-icons/lucide/map-pin";
import stickyNoteIcon from "@iconify-icons/lucide/sticky-note";
import trainFrontIcon from "@iconify-icons/lucide/train-front";
import trash2Icon from "@iconify-icons/lucide/trash-2";
import { Icon } from "@iconify/react";
import styles from "./PrecisionAtoms.module.css";

type PrecisionAtomsProps = {
  theme: "light" | "dark";
};

const icons = {
  search: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="7" cy="7" r="4.25" />
      <path d="m10.25 10.25 3 3" />
    </svg>
  ),
  plus: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 3v10M3 8h10" />
    </svg>
  ),
  more: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="3.5" cy="8" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="8" r="0.75" fill="currentColor" stroke="none" />
    </svg>
  ),
  close: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m4 4 8 8m0-8-8 8" />
    </svg>
  ),
  chevron: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m5 6 3 3 3-3" />
    </svg>
  ),
  pin: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M12 6.5c0 3-4 6.5-4 6.5S4 9.5 4 6.5a4 4 0 1 1 8 0Z" />
      <circle cx="8" cy="6.5" r="1.25" />
    </svg>
  ),
};

export function PrecisionAtoms({ theme }: PrecisionAtomsProps) {
  return (
    <section className={styles.system} data-theme={theme} aria-labelledby="precision-title">
      <header className={styles.header}>
        <div>
          <span className={styles.setCode}>Set A</span>
          <h2 id="precision-title">Compact Precision</h2>
        </div>
        <p>Exact controls for fast itinerary edits</p>
      </header>

      <div className={styles.gallery}>
        <section className={`${styles.panel} ${styles.typePanel}`} aria-labelledby="precision-type">
          <div className={styles.panelHeading}>
            <h3 id="precision-type">Type scale</h3>
            <span>System sans</span>
          </div>
          <div className={styles.typeSpecimen}>
            <div className={styles.displayType}><span>32 / 36</span>Japan spring route</div>
            <div className={styles.titleType}><span>20 / 24</span>Tokyo to Hakone</div>
            <div className={styles.headingType}><span>15 / 20</span>Thursday, 14 May</div>
            <div className={styles.bodyType}><span>13 / 18</span>Mountain rail, open-air art, and an onsen stay.</div>
            <div className={styles.metaType}><span>11 / 16</span>UPDATED 14:32 - MAYA ONLINE</div>
          </div>
          <div className={styles.numericStrip}>
            <span><b>08:30</b> start</span>
            <span><b>12.4 km</b> route</span>
            <span><b>42 min</b> travel</span>
          </div>
        </section>

        <section className={`${styles.panel} ${styles.buttonsPanel}`} aria-labelledby="precision-buttons">
          <div className={styles.panelHeading}>
            <h3 id="precision-buttons">Buttons</h3>
            <span>Actions and states</span>
          </div>
          <div className={styles.buttonGrid}>
            <button className={styles.primaryButton} type="button">Save route</button>
            <button className={styles.secondaryButton} type="button">Add stop</button>
            <button className={styles.ghostButton} type="button">Cancel</button>
            <button className={styles.deleteIconButton} type="button" aria-label="Delete" title="Delete"><Icon icon={trash2Icon} aria-hidden="true" /></button>
            <button className={styles.iconButton} type="button" aria-label="More actions">{icons.more}</button>
            <button className={styles.secondaryButton} type="button" disabled>Disabled</button>
            <button className={styles.loadingButton} type="button" aria-busy="true" disabled>
              <span className={styles.spinner} aria-hidden="true" />Saving
            </button>
          </div>
        </section>

        <section className={`${styles.panel} ${styles.formPanel}`} aria-labelledby="precision-inputs">
          <div className={styles.panelHeading}>
            <h3 id="precision-inputs">Inputs</h3>
            <span>Planner fields</span>
          </div>
          <div className={styles.fieldGrid}>
            <label className={styles.field}>
              <span>Search</span>
              <span className={styles.inputShell}>{icons.search}<input type="search" defaultValue="North Beach" /></span>
            </label>
            <label className={styles.field}>
              <span>Place name</span>
              <input type="text" defaultValue="Ferry Building" />
            </label>
            <label className={styles.field}>
              <span>Category</span>
              <span className={styles.selectShell}>
                <select defaultValue="food">
                  <option value="place">Place</option>
                  <option value="food">Food and drink</option>
                  <option value="stay">Lodging</option>
                </select>
                {icons.chevron}
              </span>
            </label>
            <label className={`${styles.field} ${styles.notesField}`}>
              <span>Note</span>
              <textarea defaultValue="Ask for a table near the window." />
            </label>
            <label className={`${styles.field} ${styles.invalidField}`}>
              <span>Confirmation code</span>
              <input type="text" defaultValue="AX-4" aria-invalid="true" aria-describedby="precision-error" />
              <small id="precision-error">Use the 6-character booking code.</small>
            </label>
          </div>
          <fieldset className={styles.choiceGroup}>
            <legend>Options</legend>
            <label><input type="checkbox" defaultChecked /><span>Show saved places</span></label>
            <label><input type="radio" name="precision-travel" defaultChecked /><span>Walking</span></label>
            <label><input type="radio" name="precision-travel" /><span>Transit</span></label>
            <label className={styles.switchLabel}><input type="checkbox" role="switch" defaultChecked /><span className={styles.switch} /><span>Live route</span></label>
          </fieldset>
        </section>

        <section className={`${styles.panel} ${styles.navigationPanel}`} aria-labelledby="precision-navigation">
          <div className={styles.panelHeading}>
            <h3 id="precision-navigation">Navigation</h3>
            <span>Dates and views</span>
          </div>
          <nav className={styles.dateTabs} aria-label="Trip dates">
            <button type="button"><span>Wed</span><b>13</b></button>
            <button className={styles.activeTab} type="button" aria-current="date"><span>Thu</span><b>14</b></button>
            <button type="button"><span>Fri</span><b>15</b></button>
            <button type="button"><span>Sat</span><b>16</b></button>
          </nav>
          <div className={styles.segmented} aria-label="Planner view">
            <button type="button" aria-pressed="true">Map</button>
            <button type="button" aria-pressed="false">List</button>
            <button type="button" aria-pressed="false">Split</button>
          </div>
        </section>

        <section className={`${styles.panel} ${styles.indicatorsPanel}`} aria-labelledby="precision-indicators">
          <div className={styles.panelHeading}>
            <h3 id="precision-indicators">Indicators</h3>
            <span>Badges and people</span>
          </div>
          <div className={styles.signalRow}>
            <span className={styles.signalBadge}>Reservation</span>
            <span className={styles.signalStatus}><i aria-hidden="true" />Confirmed</span>
            <span className={styles.signalWarning}><i aria-hidden="true" />Needs review</span>
            <span className={styles.signalPresence}>
              <span className={styles.signalAvatar} aria-hidden="true">MY</span>
              <i className={styles.presenceDot} aria-hidden="true" />
              Maya online
            </span>
          </div>
        </section>

        <section className={`${styles.panel} ${styles.rowsPanel}`} aria-labelledby="precision-rows">
          <div className={styles.panelHeading}>
            <h3 id="precision-rows">Itinerary rows</h3>
            <span>Compact schedule</span>
          </div>
          <div className={styles.itineraryRows}>
            <article className={styles.itineraryRow}>
              <time>09:00</time>
              <span className={styles.rowIcon}><Icon icon={mapPinIcon} aria-hidden="true" /></span>
              <div><strong>Nezu Shrine</strong><small>Bunkyo - 45 min</small></div>
            </article>
            <div className={styles.itineraryLeg}>
              <i className={styles.legRail} aria-hidden="true" />
              <span className={styles.legSummary}><Icon icon={footprintsIcon} aria-hidden="true" />22 min - 1.7 km</span>
              <button type="button">Directions <Icon icon={chevronDownIcon} aria-hidden="true" /></button>
            </div>
            <article className={styles.itineraryRow}>
              <time>12:30</time>
              <span className={styles.rowIcon}><Icon icon={calendarCheckIcon} aria-hidden="true" /></span>
              <div><strong>Shibuya Sky</strong></div>
              <span className={styles.signalStatus}><i aria-hidden="true" />Confirmed</span>
            </article>
            <div className={styles.itineraryLeg}>
              <i className={styles.legRail} aria-hidden="true" />
              <span className={styles.legSummary}><Icon icon={trainFrontIcon} aria-hidden="true" />28 min - 4 stops</span>
              <button type="button">Directions <Icon icon={chevronDownIcon} aria-hidden="true" /></button>
            </div>
            <article className={styles.itineraryRow}>
              <time>15:00</time>
              <span className={styles.rowIcon}><Icon icon={bedDoubleIcon} aria-hidden="true" /></span>
              <div><strong>Sawanoya Ryokan</strong><small>Check-in from 15:00 - Room 8</small></div>
            </article>
            <div className={styles.itineraryLeg}>
              <i className={styles.legRail} aria-hidden="true" />
              <span className={styles.legSummary}><Icon icon={footprintsIcon} aria-hidden="true" />9 min - 700 m</span>
              <button type="button">Directions <Icon icon={chevronDownIcon} aria-hidden="true" /></button>
            </div>
            <article className={styles.itineraryRow}>
              <time>OPEN</time>
              <span className={styles.rowIcon}><Icon icon={stickyNoteIcon} aria-hidden="true" /></span>
              <div><strong>Use the north exit</strong></div>
            </article>
            <div className={styles.itineraryLeg}>
              <i className={styles.legRail} aria-hidden="true" />
              <span className={styles.legSummary}><Icon icon={carFrontIcon} aria-hidden="true" />18 min - 8.2 km</span>
              <button type="button">Directions <Icon icon={chevronDownIcon} aria-hidden="true" /></button>
            </div>
            <article className={styles.itineraryRow}>
              <time>18:12</time>
              <span className={styles.rowIcon}><Icon icon={trainFrontIcon} aria-hidden="true" /></span>
              <div><strong>Metro to Tawaramachi</strong><small>Ginza line - 18 min - Platform 2</small></div>
            </article>
          </div>
        </section>

        <section className={`${styles.panel} ${styles.markersPanel}`} aria-labelledby="precision-markers">
          <div className={styles.panelHeading}>
            <h3 id="precision-markers">Map markers</h3>
            <span>Stops and candidates</span>
          </div>
          <div className={styles.markerField} aria-label="Map marker samples">
            <span className={styles.mapRoadA} /><span className={styles.mapRoadB} />
            <button className={styles.marker} type="button" aria-label="Stop 1"><span>1</span></button>
            <button className={`${styles.marker} ${styles.markerActive}`} type="button" aria-label="Selected stop 2"><span>2</span></button>
            <button className={styles.marker} type="button" aria-label="Stop 3"><span>3</span></button>
            <button className={styles.candidateMarker} type="button" aria-label="Candidate place">{icons.plus}</button>
            <button className={`${styles.candidateMarker} ${styles.candidateMarkerActive}`} type="button" aria-label="Selected candidate place">{icons.plus}</button>
            <span className={styles.mapLabel}>TOKYO - UENO</span>
          </div>
        </section>

        <section className={`${styles.panel} ${styles.surfacesPanel}`} aria-labelledby="precision-surfaces">
          <div className={styles.panelHeading}>
            <h3 id="precision-surfaces">Surfaces and feedback</h3>
            <span>Layered states</span>
          </div>
          <div className={styles.surfaceGrid}>
            <article className={styles.card}>
              <div className={styles.surfaceTopline}><span>Card - selected stop</span><span>02</span></div>
              <h4>Nezu Shrine</h4>
              <p>1-28-9 Nezu, Bunkyo</p>
              <div><button type="button" className={styles.ghostButton}>Details</button><button type="button" className={styles.secondaryButton}>Edit</button></div>
            </article>

            <article className={styles.popup} aria-label="Place popup">
              <button className={styles.closeButton} type="button" aria-label="Close popup">{icons.close}</button>
              <span className={styles.popupEyebrow}>Popup - Stop 03 - 14:30</span>
              <strong>Open-air Museum</strong>
              <p>Hakone - 4.8 stars</p>
              <button type="button" className={styles.primaryButton}>Add stop</button>
            </article>

            <div className={styles.dialogBackdrop}>
              <div className={styles.dialog} role="dialog" aria-labelledby="precision-dialog-title">
                <span className={styles.dialogIcon}>!</span>
                <div><h4 id="precision-dialog-title">Dialog - Delete this stop?</h4><p>Travel times will be recalculated.</p></div>
                <div className={styles.dialogActions}><button type="button" className={styles.ghostButton}>Cancel</button><button type="button" className={styles.destructiveButton}>Delete</button></div>
              </div>
            </div>

            <article className={styles.bottomSheet} aria-label="Bottom sheet">
              <span className={styles.sheetHandle} />
              <div className={styles.surfaceTopline}><strong>Bottom sheet - Thu 14</strong><span>5 stops</span></div>
              <div className={styles.sheetRow}><time>09:00</time><span>Nezu Shrine</span><b>45 min</b></div>
              <div className={styles.sheetRow}><time>12:30</time><span>Shibuya Sky</span><b>90 min</b></div>
            </article>

            <div className={styles.toast} role="status">
              <span className={styles.toastCheck}>✓</span>
              <div><strong>Stop added</strong><span>Nezu Shrine is on Thursday</span></div>
              <button type="button" aria-label="Dismiss notification">{icons.close}</button>
            </div>

            <div className={styles.routeWarning} role="alert">
              <span>!</span>
              <div><strong>Route needs review</strong><p>Only 8 minutes between stops 3 and 4.</p></div>
              <button type="button">Review</button>
            </div>

            <div className={styles.syncStatus} role="status">
              <span className={styles.syncDot} />
              <div><strong>All changes synced</strong><span>Route is up to date</span></div>
              <time>14:32</time>
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}
