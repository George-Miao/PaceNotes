import { Icon } from "@iconify/react";
import trashIcon from "@iconify-icons/lucide/trash-2";
import { type ReactNode, useEffect, useMemo, useState } from "react";
import type * as Y from "yjs";
import { FriendName } from "~/components/tripmates/FriendName";
import { Dropdown, type DropdownOption } from "~/components/ui/Dropdown";
import { Modal } from "~/components/ui/Modal";
import modalStyles from "~/components/ui/Modal.module.css";
import { removeExpense, upsertExpense } from "~/features/collaboration/document";
import { defaultExpenseCategory } from "~/features/expense/category";
import { convertExpense } from "~/features/expense/exchange.functions";
import type { Expense, ExpenseCategory, Split } from "~/features/expense/model";
import {
  currencyDigits,
  formatMoney,
  isMoneyInput,
  revalueAtRate,
  splitRemainingShares,
} from "~/features/expense/money";
import type { GooglePlaceView } from "~/features/google/google";
import { useTripText, useUiLanguage } from "~/features/trip/language";
import type { TripSnapshot } from "~/features/trip/model";
import { CurrencyAmountInput } from "./CurrencyAmountInput";
import styles from "./ExpensesWorkspace.module.css";
import {
  categoryOptions,
  expenseFriendOptions,
  formatExpenseDate,
  identityConversion,
  inputAmount,
  MoneyDisplay,
  parsedAmount,
} from "./expense-helpers";

type ExpenseDraft = {
  description: string;
  category: ExpenseCategory;
  amount: string;
  currency: string;
  payerId: string;
  splitKind: "payer" | "shared";
  participants: string[];
  shares: Record<string, string>;
  itemId: string | null;
  date: string | null;
  followsItemDate: boolean;
};

function initialExpenseDraft(
  snapshot: TripSnapshot,
  places: ReadonlyMap<string, GooglePlaceView>,
  expense: Expense | null,
  selectedFriendId: string | null,
  initialItemId: string | null,
  initialDescription: string | undefined,
): ExpenseDraft {
  const active = Object.values(snapshot.friends).filter((friend) => !friend.archived);
  const item = initialItemId ? snapshot.items[initialItemId] : undefined;
  const currency = expense?.currency ?? snapshot.currency ?? "USD";
  const participants =
    expense?.split.kind === "equal" || expense?.split.kind === "mixed"
      ? expense.split.friendIds
      : expense?.split.kind === "exact"
        ? Object.keys(expense.split.shares)
        : active.map((friend) => friend.id);
  return {
    description:
      expense?.description ??
      (initialItemId ? (initialDescription ?? snapshot.items[initialItemId]?.title ?? "") : ""),
    category:
      expense?.category ??
      defaultExpenseCategory(item, item?.place ? places.get(item.place.placeId) : undefined),
    amount: expense ? inputAmount(expense.amountMinor, currency) : "",
    currency,
    payerId:
      expense?.payerId ??
      (selectedFriendId && active.some((friend) => friend.id === selectedFriendId)
        ? selectedFriendId
        : ""),
    splitKind: expense && expense.split.kind !== "payer" ? "shared" : "payer",
    participants,
    shares:
      expense?.split.kind === "exact" || expense?.split.kind === "mixed"
        ? Object.fromEntries(
            Object.entries(expense.split.shares).map(([id, amount]) => [
              id,
              inputAmount(amount, currency),
            ]),
          )
        : {},
    itemId: expense?.itemId ?? initialItemId,
    date: expense
      ? expense.date
      : initialItemId
        ? (snapshot.items[initialItemId]?.dayId ?? null)
        : null,
    followsItemDate: expense?.followsItemDate ?? Boolean(initialItemId),
  };
}

export type ExpenseEditorProps = {
  document: Y.Doc;
  snapshot: TripSnapshot;
  places: ReadonlyMap<string, GooglePlaceView>;
  selectedFriendId: string | null;
  expense: Expense | null;
  onClose: () => void;
  initialItemId?: string | null;
  initialDescription?: string;
  fromEntry?: boolean;
};

export function ExpenseEditor({
  document,
  snapshot,
  places,
  selectedFriendId,
  expense,
  onClose,
  initialItemId = null,
  initialDescription,
  fromEntry = false,
}: ExpenseEditorProps) {
  const addingFromEntry = fromEntry && expense === null;
  const text = useTripText();
  const language = useUiLanguage();
  const itemDateFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(language, {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }),
    [language],
  );
  const categoryChoices = categoryOptions(text);
  const [draft, setDraft] = useState(() =>
    initialExpenseDraft(
      snapshot,
      places,
      expense,
      selectedFriendId,
      initialItemId,
      initialDescription,
    ),
  );
  const [categoryEdited, setCategoryEdited] = useState(Boolean(expense));
  useEffect(() => {
    if (expense || categoryEdited || !draft.itemId) return;
    const item = snapshot.items[draft.itemId];
    const place = item?.place ? places.get(item.place.placeId) : undefined;
    if (item?.place && !place) return;
    const category = defaultExpenseCategory(item, place);
    setDraft((current) => (current.category === category ? current : { ...current, category }));
  }, [expense, categoryEdited, draft.itemId, places, snapshot.items]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const currency = snapshot.currency ?? "USD";
  const active = Object.values(snapshot.friends)
    .filter((friend) => !friend.archived)
    .sort((a, b) => a.name.localeCompare(b.name));
  const existingParticipants =
    expense?.split.kind === "equal" || expense?.split.kind === "mixed"
      ? expense.split.friendIds
      : expense?.split.kind === "exact"
        ? Object.keys(expense.split.shares)
        : [];
  const participants = [
    ...active,
    ...existingParticipants.flatMap((id) => {
      const friend = snapshot.friends[id];
      return friend?.archived ? [friend] : [];
    }),
  ];
  const historicPayer = expense ? snapshot.friends[expense.payerId] : undefined;
  const payers = [...active, ...(historicPayer?.archived ? [historicPayer] : [])];
  const linkedItem = draft.itemId ? snapshot.items[draft.itemId] : null;
  const linkedPlace = linkedItem?.place ? places.get(linkedItem.place.placeId) : undefined;
  const itemOptions: DropdownOption[] = addingFromEntry
    ? []
    : [
        { value: "", label: text("expenseNoItemAttachLater") },
        ...snapshot.order
          .map((id) => snapshot.items[id])
          .filter((item): item is NonNullable<typeof item> => item !== undefined)
          .map((item) => {
            const occupied = Object.values(snapshot.expenses).some(
              (other) => other.id !== expense?.id && other.itemId === item.id,
            );
            const title = item.title || text(item.type);
            const label = item.dayId
              ? text("expenseItemWithDate", {
                  title,
                  date: formatExpenseDate(item.dayId, itemDateFormat),
                })
              : title;
            return {
              value: item.id,
              label: occupied ? text("expenseItemAlreadyLinked", { label }) : label,
              disabled: occupied,
            };
          }),
      ];
  const amount = parsedAmount(draft.amount, draft.currency);
  let specifiedTotal = 0n;
  const blankIds: string[] = [];
  let invalidSpecifiedShare = false;
  for (const id of draft.participants) {
    const value = (draft.shares[id] ?? "").trim();
    if (!value) {
      blankIds.push(id);
      continue;
    }
    const share = parsedAmount(value, draft.currency);
    if (share === null || share <= 0) {
      invalidSpecifiedShare = true;
    } else {
      specifiedTotal += BigInt(share);
    }
  }
  const blankCount = blankIds.length;
  const splitIssue =
    draft.splitKind === "shared" && amount !== null && draft.participants.length
      ? specifiedTotal > BigInt(amount)
        ? "expenseSharesExceedAmount"
        : blankCount
          ? BigInt(amount) - specifiedTotal < BigInt(blankCount)
            ? "expenseNotEnoughForShares"
            : null
          : specifiedTotal !== BigInt(amount)
            ? "expenseSharesMustTotal"
            : null
      : null;
  const automaticShares =
    draft.splitKind === "shared" &&
    amount !== null &&
    !invalidSpecifiedShare &&
    !splitIssue &&
    blankCount
      ? splitRemainingShares(BigInt(amount) - specifiedTotal, blankIds)
      : null;
  const setCurrency = (next: string) =>
    setDraft((current) => ({ ...current, currency: next, amount: "", shares: {} }));
  const conversionDate =
    draft.followsItemDate && draft.itemId ? (linkedItem?.dayId ?? null) : draft.date;
  const previewKey =
    amount !== null && amount > 0
      ? `${amount}:${draft.currency}:${currency}:${conversionDate ?? ""}`
      : "";
  const storedRate =
    expense &&
    !expense.conversion.stale &&
    expense.currency === draft.currency &&
    expense.date === conversionDate
      ? expense.conversion.rate
      : null;
  const [ratePreview, setRatePreview] = useState<{
    key: string;
    amountMinor: number | null;
  } | null>(null);
  useEffect(() => {
    if (!previewKey || amount === null || draft.currency === currency || storedRate !== null)
      return;
    let active = true;
    const timer = window.setTimeout(() => {
      void convertExpense(amount, draft.currency, currency, conversionDate)
        .then((result) => {
          if (active) setRatePreview({ key: previewKey, amountMinor: result.amountMinor });
        })
        .catch(() => {
          if (active) setRatePreview({ key: previewKey, amountMinor: null });
        });
    }, 300);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [amount, conversionDate, currency, draft.currency, previewKey, storedRate]);
  let previewMinor = draft.currency === currency ? amount : null;
  if (amount !== null && amount > 0 && storedRate !== null) {
    try {
      previewMinor = revalueAtRate(amount, draft.currency, currency, storedRate);
    } catch {
      previewMinor = null;
    }
  } else if (ratePreview?.key === previewKey) {
    previewMinor = ratePreview.amountMinor;
  }
  let conversionPreview: ReactNode = null;
  if (amount !== null && amount > 0) {
    if (previewMinor !== null) {
      conversionPreview = <MoneyDisplay amountMinor={previewMinor} currency={currency} />;
    } else if (ratePreview?.key === previewKey) {
      conversionPreview = text("expenseRateUnavailable");
    } else {
      conversionPreview = (
        <>
          <span className="spinner" aria-hidden="true" />
          <span className="sr-only">{text("expenseConverting")}</span>
        </>
      );
    }
  }
  const toggleParticipant = (id: string) =>
    setDraft((current) => ({
      ...current,
      participants: current.participants.includes(id)
        ? current.participants.filter((value) => value !== id)
        : [...current.participants, id],
    }));
  const save = async () => {
    setError("");
    if (
      !expense &&
      (!selectedFriendId ||
        snapshot.friends[selectedFriendId]?.archived ||
        !snapshot.friends[selectedFriendId])
    ) {
      setError(text("expenseChooseIdentity"));
      return;
    }
    if (!amount || amount <= 0) {
      setError(text("expenseEnterPositiveAmount"));
      return;
    }
    if (!draft.payerId) {
      setError(text("expenseChoosePayer"));
      return;
    }
    if (draft.date && !/^\d{4}-\d{2}-\d{2}$/.test(draft.date)) {
      setError(text("expenseChooseValidDate"));
      return;
    }
    if (draft.itemId && !linkedItem) {
      setError(text(addingFromEntry ? "expenseEntryItemUnavailable" : "expenseItemUnavailable"));
      return;
    }
    if (!expense && !categoryEdited && linkedItem?.place && !linkedPlace) {
      setError(text("expenseWaitForPlaceDetails"));
      return;
    }
    if (draft.splitKind !== "payer" && draft.participants.length === 0) {
      setError(text("expenseSelectTripmateForSplit"));
      return;
    }
    const shares: Record<string, number> = {};
    if (draft.splitKind === "shared") {
      for (const id of draft.participants) {
        const value = draft.shares[id] ?? "";
        if (!value.trim()) continue;
        const share = parsedAmount(value, draft.currency);
        if (!share || share <= 0) {
          setError(text("expenseEnterPositiveShare"));
          return;
        }
        shares[id] = share;
      }
      const total = Object.values(shares).reduce((sum, value) => sum + BigInt(value), 0n);
      const unspecified = draft.participants.length - Object.keys(shares).length;
      if (total > BigInt(amount)) {
        setError(
          text("expenseSharesExceedAmount", { amount: formatMoney(amount, draft.currency) }),
        );
        return;
      }
      if (!unspecified && total !== BigInt(amount)) {
        setError(text("expenseSharesMustTotal", { amount: formatMoney(amount, draft.currency) }));
        return;
      }
      if (BigInt(amount) - total < BigInt(unspecified)) {
        setError(text("expenseNotEnoughForShares"));
        return;
      }
    }
    const specifiedCount = Object.keys(shares).length;
    const split: Split =
      draft.splitKind === "payer"
        ? { kind: "payer" }
        : specifiedCount === 0
          ? { kind: "equal", friendIds: draft.participants }
          : specifiedCount === draft.participants.length
            ? { kind: "exact", shares }
            : { kind: "mixed", friendIds: draft.participants, shares };
    const date = draft.followsItemDate && draft.itemId ? (linkedItem?.dayId ?? null) : draft.date;
    setBusy(true);
    try {
      const conversion =
        draft.currency === currency
          ? identityConversion(amount, date)
          : expense &&
              !expense.conversion.stale &&
              expense.currency === draft.currency &&
              expense.date === date
            ? amount === expense.amountMinor
              ? expense.conversion
              : {
                  ...expense.conversion,
                  amountMinor: revalueAtRate(
                    amount,
                    draft.currency,
                    currency,
                    expense.conversion.rate,
                  ),
                }
            : await convertExpense(amount, draft.currency, currency, date);
      const next: Expense = {
        id: expense?.id ?? crypto.randomUUID(),
        description: draft.description.trim(),
        category:
          expense || categoryEdited
            ? draft.category
            : defaultExpenseCategory(linkedItem ?? undefined, linkedPlace),
        amountMinor: amount,
        currency: draft.currency,
        payerId: draft.payerId,
        split,
        itemId: draft.itemId,
        date,
        followsItemDate: draft.itemId !== null && draft.followsItemDate,
        conversion,
      };
      upsertExpense(document, next);
      onClose();
    } catch {
      setError(text("expenseSaveFailed"));
    } finally {
      setBusy(false);
    }
  };
  const remove = () => {
    if (!expense || !window.confirm(text("expenseDeleteConfirm"))) return;
    try {
      removeExpense(document, expense.id);
      onClose();
    } catch {
      setError(text("expenseSaveFailed"));
    }
  };
  if (!snapshot.currency) {
    return <p role="alert">{text("expenseChooseCurrencyBeforeEditing")}</p>;
  }
  const form = (
    <form
      className={modalStyles.form}
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy) void save();
      }}
    >
      <div className={styles.formGrid}>
        <label className="field">
          <span>{text("expenseDescriptionOptional")}</span>
          <input
            maxLength={500}
            value={draft.description}
            onChange={(event) => setDraft({ ...draft, description: event.target.value })}
            placeholder={text("expenseDescriptionPlaceholder")}
          />
        </label>
        <div className="field">
          <label htmlFor="expense-category">{text("expenseCategory")}</label>
          <Dropdown
            id="expense-category"
            label={text("expenseCategory")}
            value={draft.category}
            options={categoryChoices}
            onChange={(value) => {
              setCategoryEdited(true);
              setDraft({ ...draft, category: value as ExpenseCategory });
            }}
          />
        </div>
        <div className="field">
          <label htmlFor="expense-amount">{text("expenseAmount")}</label>
          <CurrencyAmountInput
            currencyId="expense-currency"
            amountId="expense-amount"
            currency={draft.currency}
            amount={draft.amount}
            required
            onCurrencyChange={setCurrency}
            onAmountChange={(value) => setDraft((current) => ({ ...current, amount: value }))}
            placeholder={`0${currencyDigits(draft.currency) ? ".00" : ""}`}
            preview={conversionPreview}
          />
        </div>
        <div className={addingFromEntry ? `field ${styles.entryPayer}` : "field"}>
          <span>{text("expensePaidBy")}</span>
          <Dropdown
            label={text("expensePaidBy")}
            required
            value={draft.payerId}
            options={expenseFriendOptions(payers, text)}
            onChange={(value) => setDraft({ ...draft, payerId: value })}
          />
        </div>
        {!addingFromEntry ? (
          <>
            <label className="field">
              <span>{text("expenseDateOptional")}</span>
              <input
                type="date"
                disabled={Boolean(draft.itemId && draft.followsItemDate)}
                value={
                  draft.itemId && draft.followsItemDate
                    ? (linkedItem?.dayId ?? "")
                    : (draft.date ?? "")
                }
                onChange={(event) => setDraft({ ...draft, date: event.target.value || null })}
              />
            </label>
            <div className="field">
              <span>{text("expenseItineraryItemOptional")}</span>
              <Dropdown
                label={text("expenseItineraryItemOptional")}
                value={draft.itemId ?? ""}
                options={itemOptions}
                onChange={(value) => {
                  const itemId = value || null;
                  const item = itemId ? snapshot.items[itemId] : null;
                  setDraft({
                    ...draft,
                    itemId,
                    category:
                      itemId && !categoryEdited
                        ? defaultExpenseCategory(
                            item ?? undefined,
                            item?.place ? places.get(item.place.placeId) : undefined,
                          )
                        : draft.category,
                    followsItemDate: Boolean(itemId),
                    date: itemId
                      ? (item?.dayId ?? null)
                      : draft.followsItemDate
                        ? null
                        : draft.date,
                  });
                }}
              />
            </div>
            {draft.itemId ? (
              <label className={`${styles.checkbox} ${styles.followDate}`}>
                <input
                  type="checkbox"
                  checked={draft.followsItemDate}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      followsItemDate: event.target.checked,
                      date: event.target.checked ? (linkedItem?.dayId ?? null) : draft.date,
                    })
                  }
                />{" "}
                {text("expenseFollowItemDate")}
              </label>
            ) : null}
          </>
        ) : null}
      </div>
      <fieldset className={styles.splitFieldset}>
        <legend>{text("expenseHowSplit")}</legend>
        <div className={styles.radioRow}>
          <label>
            <input
              type="radio"
              name="split-kind"
              checked={draft.splitKind === "payer"}
              onChange={() => setDraft({ ...draft, splitKind: "payer" })}
            />
            {text("expensePayerOnly")}
          </label>
          <label>
            <input
              type="radio"
              name="split-kind"
              checked={draft.splitKind === "shared"}
              onChange={() => setDraft({ ...draft, splitKind: "shared" })}
            />
            {text("expenseShared")}
          </label>
        </div>
        {draft.splitKind === "shared" ? (
          <div className={styles.splitPeople}>
            {participants.map((friend) => {
              const selected = draft.participants.includes(friend.id);
              const automaticShare = selected ? automaticShares?.[friend.id] : undefined;
              const unavailable = friend.archived && !selected;
              return (
                <div
                  className={styles.splitPerson}
                  key={friend.id}
                  style={selected ? { outline: `2px solid ${friend.color}` } : undefined}
                >
                  <button
                    type="button"
                    className={styles.splitPersonToggle}
                    aria-pressed={selected}
                    disabled={unavailable}
                    onClick={() => toggleParticipant(friend.id)}
                  >
                    <FriendName friend={friend} />
                  </button>
                  <div className={styles.splitAmountField}>
                    <input
                      className={styles.splitAmount}
                      type="text"
                      inputMode="decimal"
                      value={selected ? (draft.shares[friend.id] ?? "") : ""}
                      disabled={!selected}
                      placeholder={
                        automaticShare === undefined
                          ? ""
                          : inputAmount(automaticShare, draft.currency)
                      }
                      onChange={(event) => {
                        const value = event.target.value;
                        if (!isMoneyInput(value, draft.currency)) return;
                        setDraft({
                          ...draft,
                          shares: { ...draft.shares, [friend.id]: value },
                        });
                      }}
                      aria-label={text("expensePersonShareInCurrency", {
                        name: friend.name,
                        currency: draft.currency,
                      })}
                    />
                    <span className={styles.splitCurrency} aria-hidden="true">
                      {draft.currency}
                    </span>
                  </div>
                </div>
              );
            })}
            {splitIssue && amount !== null ? (
              <p role="alert" className={styles.warning}>
                {text(splitIssue, { amount: formatMoney(amount, draft.currency) })}
              </p>
            ) : null}
          </div>
        ) : null}
      </fieldset>
      {error ? (
        <p role="alert" className="field-error">
          {error}
        </p>
      ) : null}
      <div className={modalStyles.actions}>
        {expense ? (
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
        <button type="submit" className="primary-button" disabled={busy}>
          {text(busy ? "expenseSaving" : "expenseSaveExpense")}
        </button>
      </div>
    </form>
  );
  return (
    <Modal
      title={text(expense ? "expenseEditExpense" : "expenseAddExpense")}
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      {form}
    </Modal>
  );
}
