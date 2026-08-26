import type { ReactNode } from "react";
import styles from "./LayeredAtoms.module.css";

type Theme = "light" | "dark";

type AtomGroupProps = {
  id: string;
  title: string;
  children: ReactNode;
  wide?: boolean;
};

function AtomGroup({ id, title, children, wide = false }: AtomGroupProps) {
  return (
    <section
      className={`${styles.group} ${wide ? styles.groupWide : ""}`}
      aria-labelledby={`layered-${id}`}
    >
      <div className={styles.groupHeading}>
        <span aria-hidden="true" />
        <h3 id={`layered-${id}`}>{title}</h3>
      </div>
      <div className={styles.groupBody}>{children}</div>
    </section>
  );
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="5" />
      <path d="m12.2 12.2 4 4" />
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

function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="m5 5 10 10M15 5 5 15" />
    </svg>
  );
}

export function LayeredAtoms({ theme }: { theme: Theme }) {
  return (
    <article
      className={styles.atoms}
      data-theme={theme}
      aria-labelledby="layered-atoms-title"
    >
      <header className={styles.header}>
        <div>
          <p className={styles.kicker}>Set C</p>
          <h2 id="layered-atoms-title">Layered Map UI</h2>
        </div>
        <p>
          Square planning surfaces with inset controls and clear overlay depth.
        </p>
        <span className={styles.themeReadout}>{theme} theme</span>
      </header>

      <div className={styles.gallery}>
        <AtomGroup id="type" title="Type scale">
          <div className={styles.typeScale}>
            <div>
              <span>Display</span>
              <p className={styles.typeDisplay}>Japan spring route</p>
            </div>
            <div>
              <span>Heading</span>
              <p className={styles.typeHeading}>Tokyo to Hakone</p>
            </div>
            <div>
              <span>Title</span>
              <p className={styles.typeTitle}>Open-air Museum</p>
            </div>
            <div>
              <span>Body</span>
              <p className={styles.typeBody}>Mountain rail, open-air art, and an onsen stay.</p>
            </div>
            <div>
              <span>Label</span>
              <p className={styles.typeLabel}>THU - 14 MAY</p>
            </div>
          </div>
        </AtomGroup>

        <AtomGroup id="buttons" title="Buttons">
          <div className={styles.buttonGrid}>
            <button className={styles.primaryButton} type="button">Save route</button>
            <button className={styles.secondaryButton} type="button">Add stop</button>
            <button className={styles.ghostButton} type="button">Cancel</button>
            <button className={styles.destructiveButton} type="button">Delete</button>
            <button className={styles.iconButton} type="button" aria-label="More actions">
              <MoreIcon />
            </button>
            <button className={styles.secondaryButton} type="button" disabled>Disabled</button>
            <button className={styles.primaryButton} type="button" aria-busy="true">
              <span className={styles.spinner} aria-hidden="true" />
              Saving
            </button>
          </div>
        </AtomGroup>

        <AtomGroup id="fields" title="Fields and choices" wide>
          <div className={styles.fieldGrid}>
            <label className={styles.field}>
              <span>Search places</span>
              <span className={styles.inputShell}>
                <SearchIcon />
                <input type="search" placeholder="Search places" />
              </span>
            </label>
            <label className={styles.field}>
              <span>Trip name</span>
              <input type="text" defaultValue="Japan spring route" />
            </label>
            <label className={styles.field}>
              <span>Travel mode</span>
              <select defaultValue="transit">
                <option value="walk">Walking</option>
                <option value="transit">Transit</option>
                <option value="drive">Driving</option>
              </select>
            </label>
            <label className={`${styles.field} ${styles.textareaField}`}>
              <span>Trip note</span>
              <textarea defaultValue="Use the east entrance before 16:30." rows={2} />
            </label>
            <label className={`${styles.field} ${styles.invalidField}`}>
              <span>Reservation code</span>
              <input type="text" defaultValue="SS-" aria-invalid="true" aria-describedby="layered-code-error" />
              <small id="layered-code-error">Enter the full reservation code.</small>
            </label>
            <fieldset className={styles.choiceSet}>
              <legend>Choices</legend>
              <label><input type="checkbox" defaultChecked /> Show candidates</label>
              <label><input type="radio" name="layered-route" defaultChecked /> Walking</label>
              <label className={styles.switchLabel}>
                <input className={styles.switchInput} type="checkbox" role="switch" defaultChecked />
                <span className={styles.switchTrack} aria-hidden="true"><span /></span>
                Avoid tolls
              </label>
            </fieldset>
          </div>
        </AtomGroup>

        <AtomGroup id="navigation" title="Date tabs and segments">
          <div className={styles.controlStack}>
            <nav className={styles.dateTabs} aria-label="Trip dates">
              <button type="button">
                <span>Wed</span><strong>13</strong>
              </button>
              <button className={styles.selectedTab} type="button" aria-current="date">
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
              <button type="button">Map</button>
              <button className={styles.segmentSelected} type="button" aria-pressed="true">List</button>
              <button type="button" aria-pressed="false">Split</button>
            </div>
          </div>
        </AtomGroup>

        <AtomGroup id="signals" title="Badges, status, presence">
          <div className={styles.signalStack}>
            <div className={styles.badges} aria-label="Trip labels">
              <span className={styles.badge}>Reservation</span>
              <span className={styles.badgeAccent}>Confirmed</span>
              <span className={styles.badgeWarning}>Needs review</span>
            </div>
            <div className={styles.statusLine}>
              <span className={styles.statusDot} aria-hidden="true" />
              <span><strong>Reservation confirmed</strong><small>Updated just now</small></span>
            </div>
            <div className={styles.presence} aria-label="Maya online">
              <div>
                <span title="Maya Park">MP</span>
                <span title="Avery Chen">AC</span>
                <span title="Ravi Shah">RS</span>
              </div>
              <p><strong>Maya online</strong><span>Editing this route</span></p>
            </div>
          </div>
        </AtomGroup>

        <AtomGroup id="rows" title="Compact planner rows" wide>
          <div className={styles.rowList}>
            <article className={styles.plannerRow}>
              <span className={styles.rowIcon} aria-hidden="true">P</span>
              <div><strong>Nezu Shrine</strong><span>Azalea path and torii gates - Nezu</span></div>
              <div className={styles.rowMeta}><time>Open</time><span className={styles.badge}>Place</span></div>
            </article>
            <article className={styles.plannerRow}>
              <span className={styles.rowIcon} aria-hidden="true">R</span>
              <div><strong>Shibuya Sky</strong><span>Sunset entry - code SS-5148</span></div>
              <div className={styles.rowMeta}><time>18:20</time><span className={styles.badgeAccent}>Confirmed</span></div>
            </article>
            <article className={styles.plannerRow}>
              <span className={styles.rowIcon} aria-hidden="true">L</span>
              <div><strong>Sawanoya Ryokan</strong><span>Check-in 15:00 - Japanese room 6 tatami</span></div>
              <div className={styles.rowMeta}><time>11:15</time><span className={styles.badge}>Lodging</span></div>
            </article>
            <article className={styles.plannerRow}>
              <span className={styles.rowIcon} aria-hidden="true">N</span>
              <div><strong>Use the north exit</strong><span>Tokyo Station arrival note</span></div>
              <div className={styles.rowMeta}><time>Open</time><span className={styles.badge}>Note</span></div>
            </article>
            <article className={styles.plannerRow}>
              <span className={styles.rowIcon} aria-hidden="true">T</span>
              <div><strong>Metro to Tawaramachi</strong><span>Asakusa Line - platform 2</span></div>
              <div className={styles.rowMeta}><time>09:14</time><span className={styles.badge}>64 min</span></div>
            </article>
          </div>
        </AtomGroup>

        <AtomGroup id="map" title="Markers and route">
          <div className={styles.miniMap} aria-label="Map marker examples">
            <svg viewBox="0 0 360 132" role="img" aria-label="Compact route from stops 1 to 3">
              <path className={styles.mapRoad} d="M-10 98C70 74 92 104 154 70S238 40 370 58" />
              <path className={styles.routeHalo} d="M34 96C104 94 122 73 178 67S244 43 322 42" />
              <path className={styles.routeLine} d="M34 96C104 94 122 73 178 67S244 43 322 42" />
            </svg>
            <button className={styles.mapMarker} style={{ left: "9%", top: "65%" }} type="button" aria-label="Stop 1: Tokyo Station">1</button>
            <button className={`${styles.mapMarker} ${styles.mapMarkerSelected}`} style={{ left: "46%", top: "42%" }} type="button" aria-label="Stop 2: Open-air Museum" aria-pressed="true">2</button>
            <button className={styles.mapMarker} style={{ left: "84%", top: "23%" }} type="button" aria-label="Stop 3: Yama no Chaya">3</button>
            <button className={styles.candidateMarker} style={{ left: "70%", top: "66%" }} type="button" aria-label="Candidate: Hakone Bakery">+</button>
            <span className={styles.routeKey}>12 km - 3 stops</span>
          </div>
        </AtomGroup>

        <AtomGroup id="surfaces" title="Cards and overlays" wide>
          <div className={styles.surfaceGallery}>
            <article className={styles.card}>
              <span className={styles.surfaceLabel}>Card</span>
              <h4>Tokyo to Hakone</h4>
              <p>Mountain rail, open-air art, and an onsen stay.</p>
              <div><span>12 km</span><span>74 min</span><span>5 stops</span></div>
            </article>

            <article className={styles.popup} aria-label="Place popup">
              <div className={styles.surfaceTopline}>
                <span className={styles.surfaceLabel}>Popup</span>
                <button type="button" aria-label="Close popup"><CloseIcon /></button>
              </div>
              <strong>Open-air Museum</strong>
              <p>10:30 - Chokoku-no-Mori</p>
              <button className={styles.secondaryButton} type="button">Open place</button>
            </article>

            <div className={styles.dialog} role="dialog" aria-labelledby="layered-dialog-title">
              <div className={styles.surfaceTopline}>
                <span className={styles.surfaceLabel}>Dialog</span>
                <button type="button" aria-label="Close dialog"><CloseIcon /></button>
              </div>
              <h4 id="layered-dialog-title">Delete place?</h4>
              <p>Open-air Museum will leave this day, but stay in saved places.</p>
              <div className={styles.dialogActions}>
                <button className={styles.ghostButton} type="button">Cancel</button>
                <button className={styles.destructiveButton} type="button">Delete</button>
              </div>
            </div>

            <article className={styles.bottomSheet} aria-label="Bottom sheet example">
              <div className={styles.sheetHandle} aria-hidden="true" />
              <span className={styles.surfaceLabel}>Bottom sheet</span>
              <div className={styles.sheetTitle}>
                <div><strong>Open-air Museum</strong><span>Chokoku-no-Mori - 10:30</span></div>
                <span className={styles.badgeAccent}>Selected</span>
              </div>
              <div className={styles.sheetInset}>
                <span>Route position</span><strong>Stop 2 of 5</strong>
              </div>
            </article>

            <aside className={styles.toast} role="status">
              <span className={styles.toastIcon} aria-hidden="true">✓</span>
              <div><strong>Stop added</strong><span>Open-air Museum is on Thursday.</span></div>
              <button type="button" aria-label="Dismiss notification"><CloseIcon /></button>
            </aside>

            <aside className={styles.routeWarning} role="alert">
              <span className={styles.warningMark} aria-hidden="true">!</span>
              <div><strong>Route needs review</strong><span>Shibuya Sky leaves 8 minutes for transfer.</span></div>
              <button className={styles.ghostButton} type="button">Review</button>
            </aside>

            <div className={styles.syncStatus} role="status">
              <span className={styles.syncPulse} aria-hidden="true" />
              <div><strong>All changes synced</strong><span>Saved just now</span></div>
            </div>
          </div>
        </AtomGroup>
      </div>
    </article>
  );
}
