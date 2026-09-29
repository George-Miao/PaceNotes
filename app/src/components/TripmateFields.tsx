import type { ComponentProps, ReactNode } from "react";
import { useRef } from "react";
import { TitleField } from "./TitleField";
import styles from "./TripmateFields.module.css";

type Props = Omit<
  ComponentProps<"input">,
  "type" | "className" | "value" | "onChange" | "children"
> & {
  name: string;
  color: string;
  nameLabel: string;
  colorLabel: string;
  onNameChange: (name: string) => void;
  onColorChange: (color: string) => void;
  children?: ReactNode;
};

export function TripmateFields({
  name,
  color,
  nameLabel,
  colorLabel,
  onNameChange,
  onColorChange,
  children,
  ...inputProps
}: Props) {
  const colorInput = useRef<HTMLInputElement>(null);
  return (
    <div className={styles.row}>
      <span className={styles.colorControl}>
        <button
          type="button"
          className={styles.colorButton}
          style={{ backgroundColor: color }}
          aria-label={colorLabel}
          title={colorLabel}
          onClick={() => {
            if (typeof colorInput.current?.showPicker === "function")
              colorInput.current.showPicker();
            else colorInput.current?.click();
          }}
        />
        <input
          ref={colorInput}
          className={styles.nativeColorInput}
          type="color"
          value={color}
          onChange={(event) => onColorChange(event.target.value)}
          tabIndex={-1}
          aria-hidden="true"
        />
      </span>
      <TitleField
        {...inputProps}
        label={nameLabel}
        value={name}
        onChange={(event) => onNameChange(event.target.value)}
      />
      {children}
    </div>
  );
}
