import { useState } from "react";
import { EditorialAtoms } from "./EditorialAtoms";
import { LayeredAtoms } from "./LayeredAtoms";
import { PrecisionAtoms } from "./PrecisionAtoms";
import { SoftAtoms } from "./SoftAtoms";
import styles from "./AtomGallery.module.css";

type AtomTheme = "light" | "dark";

const atomSets = [
  {
    id: "precision",
    index: "01",
    name: "Precision",
    description: "Fine rules, square controls, and tight alignment.",
    Component: PrecisionAtoms,
  },
  {
    id: "soft",
    index: "02",
    name: "Soft",
    description: "Gentle surfaces, rounded controls, and comfortable spacing.",
    Component: SoftAtoms,
  },
  {
    id: "layered",
    index: "03",
    name: "Layered",
    description: "Bordered surfaces, measured elevation, and grouped controls.",
    Component: LayeredAtoms,
  },
  {
    id: "editorial",
    index: "04",
    name: "Editorial",
    description: "Typographic contrast, restrained rules, and compact rhythm.",
    Component: EditorialAtoms,
  },
] as const;

export function AtomGallery() {
  const [theme, setTheme] = useState<AtomTheme>("light");

  return (
    <div className={styles.gallery} data-theme={theme}>
      <a className={styles.skipLink} href="#atom-sets">
        Skip to atom sets
      </a>

      <header className={styles.header}>
        <div className={styles.headerPrimary}>
          <a className={styles.returnLink} href="/">
            <svg aria-hidden="true" viewBox="0 0 20 20">
              <path d="m11.5 4-6 6 6 6M6 10h8.5" />
            </svg>
            Planner
          </a>

          <div className={styles.titleBlock}>
            <span>Design atoms</span>
            <h1>Compare four systems</h1>
          </div>

          <div className={styles.themeControl} role="group" aria-label="Gallery theme">
            <span className={styles.themeLabel}>Theme</span>
            {(["light", "dark"] as const).map((option) => (
              <button
                className={`${styles.themeOption} ${
                  theme === option ? styles.themeOptionActive : ""
                }`}
                type="button"
                aria-pressed={theme === option}
                onClick={() => setTheme(option)}
                key={option}
              >
                {option === "light" ? "Light" : "Dark"}
              </button>
            ))}
          </div>
        </div>

        <div className={styles.comparisonBar}>
          <p>
            Compare the same controls and planner states across each set. Look for the shape,
            density, type, borders, and elevation that best fit PaceNotes.
          </p>
          <nav className={styles.setNav} aria-label="Atom sets">
            {atomSets.map((set) => (
              <a href={`#${set.id}`} key={set.id}>
                <span>{set.index}</span>
                {set.name}
              </a>
            ))}
          </nav>
        </div>

        <p className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">
          {theme === "light" ? "Light" : "Dark"} theme is shown in all four atom sets.
        </p>
      </header>

      <main className={styles.sets} id="atom-sets" tabIndex={-1}>
        {atomSets.map(({ id, index, name, description, Component }) => (
          <section
            className={styles.set}
            id={id}
            aria-labelledby={`gallery-${id}-title`}
            key={id}
          >
            <header className={styles.setHeader}>
              <span className={styles.setIndex}>Set {index}</span>
              <div>
                <h2 id={`gallery-${id}-title`}>{name}</h2>
                <p>{description}</p>
              </div>
            </header>
            <div className={styles.setStage}>
              <Component theme={theme} />
            </div>
          </section>
        ))}
      </main>
    </div>
  );
}
