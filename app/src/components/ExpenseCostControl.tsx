import { Icon } from "@iconify/react";
import slidersIcon from "@iconify-icons/lucide/sliders-horizontal";
import trashIcon from "@iconify-icons/lucide/trash-2";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import type * as Y from "yjs";
import { removeExpense, upsertExpense } from "~/features/collaboration/document";
import { defaultExpenseCategory } from "~/features/expense/category";
import { convertExpense } from "~/features/expense/exchange.functions";
import type { Expense } from "~/features/expense/model";
import { currencyDigits, formatMoney, revalueAtRate, toMinor } from "~/features/expense/money";
import type { GooglePlaceView } from "~/features/google/google";
import { useTripText } from "~/features/trip/language";
import type { TripSnapshot } from "~/features/trip/model";
import { CurrencyAmountInput } from "./CurrencyAmountInput";
import styles from "./ExpenseCostControl.module.css";

// The full expense form loads only after the details popover opens.
const ExpenseEditor = lazy(async () => {
  const module = await import("./ExpensesWorkspace");
  return { default: module.ExpenseEditor };
});

function decimalAmount(amountMinor: number, currency: string): string {
  const digits = currencyDigits(currency);
  if (digits === 0) return String(amountMinor);
  const divisor = 10 ** digits;
  return `${Math.trunc(amountMinor / divisor)}.${String(amountMinor % divisor).padStart(digits, "0")}`;
}

export function ExpenseCostControl({
  document,
  snapshot,
  places,
  itemId,
  entryLabel,
  selectedFriendId,
}: {
  document: Y.Doc;
  snapshot: TripSnapshot;
  places: ReadonlyMap<string, GooglePlaceView>;
  itemId: string;
  entryLabel: string;
  selectedFriendId: string | null;
}) {
  const text = useTripText();
  const expense = Object.values(snapshot.expenses).find((entry) => entry.itemId === itemId);
  const savedAmountMinor = expense?.amountMinor;
  const savedCurrency = expense?.currency;
  const [currency, setCurrency] = useState(expense?.currency ?? snapshot.currency ?? "");
  const [amount, setAmount] = useState(
    expense ? decimalAmount(expense.amountMinor, expense.currency) : "",
  );
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  useEffect(() => {
    setCurrency(savedCurrency ?? snapshot.currency ?? "");
    setAmount(
      savedAmountMinor === undefined || savedCurrency === undefined
        ? ""
        : decimalAmount(savedAmountMinor, savedCurrency),
    );
  }, [savedAmountMinor, savedCurrency, snapshot.currency]);

  async function save(nextCurrency = currency, nextAmount = amount) {
    if (!nextAmount.trim() || !nextCurrency || !snapshot.currency || busyRef.current) return;
    if (!selectedFriendId || snapshot.friends[selectedFriendId]?.archived) {
      setError(text("costChooseIdentityBeforeAdding"));
      return;
    }
    try {
      const minor = toMinor(nextAmount, nextCurrency);
      if (minor <= 0) {
        setError(text("costPositive"));
        return;
      }
      if (expense?.amountMinor === minor && expense.currency === nextCurrency) return;
      if (expense?.split.kind === "exact" || expense?.split.kind === "mixed") {
        setError(text("costSpecifiedShares"));
        return;
      }
      if (expense?.split.kind === "equal" && minor < expense.split.friendIds.length) {
        setError(text("costNotEnoughForShares"));
        return;
      }
      const item = snapshot.items[itemId];
      if (!expense && item?.place && !places.has(item.place.placeId)) {
        setError(text("costPlaceDetails"));
        return;
      }
      busyRef.current = true;
      setBusy(true);
      setError(null);
      const conversion =
        expense && expense.currency === nextCurrency && !expense.conversion.stale
          ? {
              ...expense.conversion,
              amountMinor: revalueAtRate(
                minor,
                nextCurrency,
                snapshot.currency,
                expense.conversion.rate,
              ),
            }
          : await convertExpense(
              minor,
              nextCurrency,
              snapshot.currency,
              expense?.date ?? snapshot.items[itemId]?.dayId ?? null,
            );
      const next: Expense = expense
        ? { ...expense, amountMinor: minor, currency: nextCurrency, conversion }
        : {
            id: crypto.randomUUID(),
            description: entryLabel,
            category: defaultExpenseCategory(
              item,
              item?.place ? places.get(item.place.placeId) : undefined,
            ),
            amountMinor: minor,
            currency: nextCurrency,
            payerId: selectedFriendId,
            split: { kind: "payer" },
            itemId,
            date: snapshot.items[itemId]?.dayId ?? null,
            followsItemDate: true,
            conversion,
          };
      upsertExpense(document, next);
    } catch (cause) {
      switch (cause instanceof Error ? cause.message : "") {
        case "Enter a decimal monetary amount":
          setError(text("costDecimalAmount"));
          break;
        case "Too many digits for this currency":
          setError(text("costTooManyDigits"));
          break;
        case "Money total exceeds the safe integer range":
          setError(text("costAmountTooLarge"));
          break;
        case "Unsupported currency":
          setError(text("costUnsupportedCurrency"));
          break;
        case "Exchange rate unavailable":
          setError(text("costExchangeRateUnavailable"));
          break;
        case "Converted amount is below one minor unit":
          setError(text("costConvertedAmountTooSmall"));
          break;
        case "This item already has an expense":
          setError(text("costItemHasExpense"));
          break;
        case "Attached item no longer exists":
          setError(text("costItemUnavailable"));
          break;
        case "Choose a trip currency before adding expenses":
          setError(text("costMissingCurrency"));
          break;
        case "Choose a tripmate on this trip":
          setError(text("costChooseTripmate"));
          break;
        case "Archived tripmates cannot be added as payers or split participants":
          setError(text("costArchivedTripmate"));
          break;
        default:
          setError(text("costSaveFailed"));
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <div className={styles.wrap}>
      <div className="field">
        <span>{text("costLabel")}</span>
        <div className={styles.bar}>
          <CurrencyAmountInput
            className={styles.moneyInput}
            currencyId={`cost-currency-${itemId}`}
            amountId={`cost-amount-${itemId}`}
            currency={currency}
            amount={amount}
            currencyDisabled={!snapshot.currency || !selectedFriendId || busy}
            amountDisabled={!snapshot.currency || !selectedFriendId || busy}
            placeholder={text("costPlaceholder")}
            onCurrencyChange={(nextCurrency) => {
              setCurrency(nextCurrency);
              void save(nextCurrency);
            }}
            onAmountChange={setAmount}
            onAmountBlur={() => {
              void save();
            }}
            onAmountKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void save();
                event.currentTarget.blur();
              }
            }}
          />
          {expense ? (
            <>
              <button
                type="button"
                className={styles.action}
                aria-label={text("costDetails")}
                aria-expanded={detailsOpen}
                disabled={!selectedFriendId}
                onClick={() => setDetailsOpen((open) => !open)}
              >
                <Icon icon={slidersIcon} />
              </button>
              <button
                type="button"
                className={`${styles.action} ${styles.dangerAction}`}
                aria-label={text("costClear")}
                disabled={!selectedFriendId}
                onClick={() => {
                  if (
                    window.confirm(
                      text("costDeleteConfirm", {
                        amount: formatMoney(expense.amountMinor, expense.currency),
                      }),
                    )
                  )
                    removeExpense(document, expense.id);
                }}
              >
                <Icon icon={trashIcon} />
              </button>
            </>
          ) : (
            <button
              type="button"
              className={styles.action}
              aria-label={text("costDetails")}
              aria-expanded={detailsOpen}
              disabled={!snapshot.currency || !selectedFriendId}
              onClick={() => setDetailsOpen((open) => !open)}
            >
              <Icon icon={slidersIcon} />
            </button>
          )}
        </div>
      </div>
      {!snapshot.currency ? (
        <span className={styles.error}>{text("costMissingCurrency")}</span>
      ) : null}
      {!selectedFriendId && snapshot.currency ? (
        <span className={styles.error}>{text("costMissingIdentity")}</span>
      ) : null}
      {error ? (
        <span className={styles.error} role="alert">
          {error}
        </span>
      ) : null}
      {detailsOpen && snapshot.currency && selectedFriendId ? (
        <Suspense
          fallback={
            <span className="sr-only" role="status">
              {text("costLoadingExpenseForm")}
            </span>
          }
        >
          <ExpenseEditor
            document={document}
            snapshot={snapshot}
            places={places}
            selectedFriendId={selectedFriendId}
            expense={expense ?? null}
            initialItemId={itemId}
            fromEntry
            initialDescription={entryLabel}
            onClose={() => setDetailsOpen(false)}
          />
        </Suspense>
      ) : null}
    </div>
  );
}
