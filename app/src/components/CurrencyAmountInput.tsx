import type { KeyboardEventHandler, ReactNode } from "react";
import { isMoneyInput } from "~/features/expense/money";
import { useTripText } from "~/features/trip/language";
import styles from "./CurrencyAmountInput.module.css";
import { CurrencyDropdown } from "./CurrencyDropdown";

type Props = {
  currency: string;
  amount: string;
  currencyId: string;
  amountId: string;
  onCurrencyChange: (currency: string) => void;
  onAmountChange: (amount: string) => void;
  onAmountBlur?: () => void;
  onAmountKeyDown?: KeyboardEventHandler<HTMLInputElement>;
  currencyDisabled?: boolean;
  amountDisabled?: boolean;
  required?: boolean;
  placeholder?: string;
  describedBy?: string;
  preview?: ReactNode;
  className?: string | undefined;
};

export function CurrencyAmountInput({
  currency,
  amount,
  currencyId,
  amountId,
  onCurrencyChange,
  onAmountChange,
  onAmountBlur,
  onAmountKeyDown,
  currencyDisabled = false,
  amountDisabled = false,
  required = false,
  placeholder = "0",
  describedBy,
  className,
  preview,
}: Props) {
  const text = useTripText();
  return (
    <div className={`${styles.control} ${className ?? ""}`}>
      <CurrencyDropdown
        id={currencyId}
        className={styles.currency ?? ""}
        label={text("currency")}
        value={currency}
        onChange={onCurrencyChange}
        disabled={currencyDisabled}
        compact
        placeholder={text("currency")}
      />
      <input
        id={amountId}
        aria-label={text("amount")}
        type="text"
        inputMode="decimal"
        value={amount}
        disabled={amountDisabled}
        required={required}
        placeholder={placeholder}
        aria-describedby={describedBy}
        onChange={(event) => {
          const value = event.target.value;
          if (isMoneyInput(value, currency)) onAmountChange(value);
        }}
        onBlur={onAmountBlur}
        onKeyDown={onAmountKeyDown}
      />
      {preview ? (
        <span className={styles.preview} role="status">
          {preview}
        </span>
      ) : null}
    </div>
  );
}
