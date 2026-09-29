import type { ComponentProps } from "react";
import styles from "./TitleField.module.css";

type Props = Omit<ComponentProps<"input">, "className" | "type"> & {
  label: string;
  className?: string;
};

export function TitleField({ label, className, ...inputProps }: Props) {
  return (
    <label className={[styles.titleField, className].filter(Boolean).join(" ")}>
      <span className="sr-only">{label}</span>
      <input {...inputProps} />
    </label>
  );
}
