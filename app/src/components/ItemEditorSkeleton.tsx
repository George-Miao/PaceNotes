import { useTripText } from "~/features/trip/language";
import type { TripItem } from "~/features/trip/model";
import styles from "./ItemEditorSkeleton.module.css";

export function ItemEditorSkeleton({ item }: { item: TripItem }) {
  const text = useTripText();
  const hasPlace = Boolean(item.place);
  const isTransport = item.type === "transport";
  const isLodging = item.type === "lodging";

  return (
    <aside className="item-editor" aria-label={text("loadingEditor")} aria-busy="true">
      <div className="section-heading">
        <div className={styles.heading} aria-hidden="true">
          <Skeleton className={styles.title} />
          <Skeleton className={styles.titleAction} />
          <span className={styles.spacer} />
          {hasPlace ? <Skeleton className={styles.compactPlace} /> : null}
          {item.type === "place" ? <Skeleton className={styles.headerAction} /> : null}
          <Skeleton className={styles.headerAction} />
        </div>
      </div>
      <div className="editor-grid" aria-hidden="true">
        {(item.type === "place" || item.type === "reservation" || isLodging) && !hasPlace ? (
          <FieldSkeleton wide />
        ) : null}
        {isTransport ? (
          <>
            <FieldSkeleton wide />
            <FieldSkeleton />
            <FieldSkeleton />
          </>
        ) : null}
        {isTransport ? (
          <>
            <FieldSkeleton />
            <FieldSkeleton />
          </>
        ) : !isLodging ? (
          <>
            <FieldSkeleton />
            <FieldSkeleton />
          </>
        ) : null}
        {isLodging ? (
          <div className={`${styles.stayFields} field-wide`}>
            <FieldSkeleton />
            <FieldSkeleton />
          </div>
        ) : null}
        <FieldSkeleton wide tall />
        {item.type === "reservation" ? (
          <fieldset className="field-group field-wide">
            <legend>
              <Skeleton className={styles.label} />
            </legend>
            <FieldSkeleton />
            <FieldSkeleton />
          </fieldset>
        ) : null}
      </div>
    </aside>
  );
}

function FieldSkeleton({ wide = false, tall = false }: { wide?: boolean; tall?: boolean }) {
  return (
    <div className={`field${wide ? " field-wide" : ""}`}>
      <Skeleton className={styles.label} />
      <Skeleton className={tall ? styles.textarea : styles.control} />
    </div>
  );
}

function Skeleton({ className }: { className: string | undefined }) {
  return <span className={`${styles.skeleton} ${className ?? ""}`} />;
}
