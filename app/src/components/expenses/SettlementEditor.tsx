import { Icon } from "@iconify/react";
import trashIcon from "@iconify-icons/lucide/trash-2";
import { useState } from "react";
import type * as Y from "yjs";
import { Dropdown } from "~/components/ui/Dropdown";
import { Modal } from "~/components/ui/Modal";
import modalStyles from "~/components/ui/Modal.module.css";
import { removeSettlement, upsertSettlement } from "~/features/collaboration/document";
import { convertExpense, settlementTimestamp } from "~/features/expense/exchange.functions";
import type { Settlement } from "~/features/expense/model";
import { balances, formatMoney, isMoneyInput } from "~/features/expense/money";
import { useTripText } from "~/features/trip/language";
import type { TripSnapshot } from "~/features/trip/model";
import { CurrencyDropdown } from "./CurrencyDropdown";
import styles from "./ExpensesWorkspace.module.css";
import {
  expenseFriendOptions,
  identityConversion,
  inputAmount,
  parsedAmount,
} from "./expense-helpers";

export function SettlementEditor({
  document,
  snapshot,
  settlement,
  fromId,
  toId,
  amountMinor,
  onClose,
}: {
  document: Y.Doc;
  snapshot: TripSnapshot;
  settlement: Settlement | null;
  fromId: string | undefined;
  toId: string | undefined;
  amountMinor: number | undefined;
  onClose: () => void;
}) {
  const text = useTripText();
  const currency = snapshot.currency ?? "USD";
  const friends = Object.values(snapshot.friends).sort((a, b) => a.name.localeCompare(b.name));
  const friendOptions = expenseFriendOptions(friends, text);
  const [from, setFrom] = useState(settlement?.fromId ?? fromId ?? friends[0]?.id ?? "");
  const [to, setTo] = useState(
    settlement?.toId ?? toId ?? friends.find((friend) => friend.id !== from)?.id ?? "",
  );
  const [money, setMoney] = useState(settlement?.currency ?? currency);
  const [amount, setAmount] = useState(
    settlement
      ? inputAmount(settlement.amountMinor, settlement.currency)
      : amountMinor
        ? inputAmount(amountMinor, currency)
        : "",
  );
  const [note, setNote] = useState(settlement?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [overpayPrompt, setOverpayPrompt] = useState(false);
  const [overpayAcknowledged, setOverpayAcknowledged] = useState(false);
  const net = balances(snapshot);
  const before = { ...net };
  if (settlement) {
    const original = settlement.conversion.amountMinor;
    before[settlement.fromId] = (before[settlement.fromId] ?? 0) - original;
    before[settlement.toId] = (before[settlement.toId] ?? 0) + original;
  }
  const outstanding = Math.max(0, Math.min(-(before[from] ?? 0), before[to] ?? 0));
  const entered = parsedAmount(amount, money);
  const knownConverted =
    money === currency
      ? entered
      : settlement?.conversion &&
          settlement.currency === money &&
          settlement.amountMinor === entered
        ? settlement.conversion.amountMinor
        : null;
  const overpay =
    knownConverted !== null && knownConverted !== undefined && knownConverted > outstanding;
  const stale =
    Object.values(snapshot.expenses).some((expense) => expense.conversion.stale) ||
    Object.values(snapshot.settlements).some((value) => value.conversion.stale);
  const save = async () => {
    setError("");
    if (!from || !to || from === to) {
      setError(text("expenseChooseDifferentTripmates"));
      return;
    }
    if (!entered || entered <= 0) {
      setError(text("expenseEnterPositivePayment"));
      return;
    }
    if (stale && !settlement) {
      setError(text("expenseExchangeRatesRefreshing"));
      return;
    }
    setBusy(true);
    try {
      const conversion =
        settlement &&
        !settlement.conversion.stale &&
        settlement.amountMinor === entered &&
        settlement.currency === money
          ? settlement.conversion
          : money === currency
            ? identityConversion(entered, null)
            : await convertExpense(entered, money, currency, null);
      if (conversion.stale) {
        setError(text("expenseExchangeRateStale"));
        return;
      }
      const converted = conversion.amountMinor;
      if (converted > outstanding && !overpayAcknowledged) {
        setError(
          text("expenseOverpaymentError", {
            amount: formatMoney(outstanding, currency),
          }),
        );
        setOverpayPrompt(true);
        return;
      }
      const paidAt = settlement?.paidAt ?? (await settlementTimestamp());
      upsertSettlement(document, {
        id: settlement?.id ?? crypto.randomUUID(),
        fromId: from,
        toId: to,
        amountMinor: entered,
        currency: money,
        conversion,
        note: note.trim(),
        paidAt,
      });
      onClose();
    } catch {
      setError(text("expenseSaveFailed"));
    } finally {
      setBusy(false);
    }
  };
  const remove = () => {
    if (!settlement || !window.confirm(text("expenseDeletePaymentConfirm"))) return;
    try {
      removeSettlement(document, settlement.id);
      onClose();
    } catch {
      setError(text("expenseSaveFailed"));
    }
  };
  if (!snapshot.currency) {
    return <p role="alert">{text("expenseChooseCurrencyBeforePayment")}</p>;
  }
  return (
    <Modal
      title={text(settlement ? "expenseEditSettlement" : "expenseRecordSettlement")}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className={modalStyles.form}
        onSubmit={(event) => {
          event.preventDefault();
          if (!busy) void save();
        }}
      >
        <p className={styles.helper}>{text("expensePaymentHelper")}</p>
        <div className={styles.formGrid}>
          <div className="field">
            <span>{text("from")}</span>
            <Dropdown
              label={text("from")}
              required
              value={from}
              options={friendOptions}
              onChange={(value) => {
                setFrom(value);
                setOverpayPrompt(false);
                setOverpayAcknowledged(false);
              }}
            />
          </div>
          <div className="field">
            <span>{text("to")}</span>
            <Dropdown
              label={text("to")}
              required
              value={to}
              options={friendOptions}
              onChange={(value) => {
                setTo(value);
                setOverpayPrompt(false);
                setOverpayAcknowledged(false);
              }}
            />
          </div>
          <label className="field">
            <span>{text("expenseAmountPaid")}</span>
            <input
              required
              inputMode="decimal"
              value={amount}
              onChange={(event) => {
                const value = event.target.value;
                if (!isMoneyInput(value, money)) return;
                setAmount(value);
                setOverpayPrompt(false);
                setOverpayAcknowledged(false);
              }}
            />
          </label>
          <div className="field">
            <span>{text("expenseCurrencyPaid")}</span>
            <CurrencyDropdown
              label={text("expenseCurrencyPaid")}
              value={money}
              onChange={(value) => {
                setMoney(value);
                setAmount("");
                setOverpayPrompt(false);
                setOverpayAcknowledged(false);
              }}
            />
          </div>
        </div>
        <p className={styles.fieldHint}>
          {text("expenseRemainingDebt", { amount: formatMoney(outstanding, currency), currency })}
        </p>
        {overpay ? <p className={styles.warning}>{text("expenseOverpaymentWarning")}</p> : null}
        {overpay || overpayPrompt ? (
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={overpayAcknowledged}
              onChange={(event) => setOverpayAcknowledged(event.target.checked)}
            />{" "}
            {text("expenseAcknowledgeOverpayment")}
          </label>
        ) : null}
        <label className="field">
          <span>{text("expenseNoteOptional")}</span>
          <input
            maxLength={500}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={text("expenseNotePlaceholder")}
          />
        </label>
        {error ? (
          <p role="alert" className="field-error">
            {error}
          </p>
        ) : null}
        <div className={modalStyles.actions}>
          {settlement ? (
            <button
              type="button"
              className="ghost-button danger-ghost"
              onClick={remove}
              disabled={busy}
            >
              <Icon icon={trashIcon} aria-hidden="true" /> {text("delete")}
            </button>
          ) : null}
          <span className={styles.actionSpacer} />
          <button type="button" className="ghost-button" onClick={onClose} disabled={busy}>
            {text("cancel")}
          </button>
          <button type="submit" className="primary-button" disabled={busy || !entered}>
            {text(busy ? "expenseSaving" : "expenseRecordPayment")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
