import { Icon } from "@iconify/react";
import archiveIcon from "@iconify-icons/lucide/archive";
import archiveRestoreIcon from "@iconify-icons/lucide/archive-restore";
import arrowDownIcon from "@iconify-icons/lucide/arrow-down";
import arrowRightIcon from "@iconify-icons/lucide/arrow-right";
import arrowUpIcon from "@iconify-icons/lucide/arrow-up";
import bedIcon from "@iconify-icons/lucide/bed";
import calendarIcon from "@iconify-icons/lucide/calendar";
import chartPieIcon from "@iconify-icons/lucide/chart-pie";
import circleEllipsisIcon from "@iconify-icons/lucide/circle-ellipsis";
import coffeeIcon from "@iconify-icons/lucide/coffee";
import coinsIcon from "@iconify-icons/lucide/coins";
import downloadIcon from "@iconify-icons/lucide/download";
import plusIcon from "@iconify-icons/lucide/plus";
import receiptIcon from "@iconify-icons/lucide/receipt";
import shoppingBagIcon from "@iconify-icons/lucide/shopping-bag";
import ticketIcon from "@iconify-icons/lucide/ticket";
import trainFrontIcon from "@iconify-icons/lucide/train-front";
import trashIcon from "@iconify-icons/lucide/trash-2";
import userIcon from "@iconify-icons/lucide/user";
import walletIcon from "@iconify-icons/lucide/wallet";
import xIcon from "@iconify-icons/lucide/x";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";
import type * as Y from "yjs";
import {
  createTripmate,
  removeExpense,
  removeSettlement,
  setTripCurrency,
  upsertExpense,
  upsertFriends,
  upsertSettlement,
} from "~/features/collaboration/document";
import { defaultExpenseCategory } from "~/features/expense/category";
import { convertExpense, settlementTimestamp } from "~/features/expense/exchange.functions";
import type {
  Conversion,
  Expense,
  ExpenseCategory,
  Friend,
  Settlement,
  Split,
} from "~/features/expense/model";
import {
  balances,
  browserCurrency,
  categoryTotals,
  currencyDigits,
  currencySymbol,
  expenseShares,
  exportExpensesCsv,
  formatMoney,
  isMoneyInput,
  revalueAtRate,
  suggestSettlements,
  toMinor,
} from "~/features/expense/money";
import type { GooglePlaceView } from "~/features/google/google";
import { useTripText, useUiLanguage } from "~/features/trip/language";
import type { TripSnapshot } from "~/features/trip/model";
import { CurrencyAmountInput } from "./CurrencyAmountInput";
import { CurrencyDropdown } from "./CurrencyDropdown";
import { Dropdown, type DropdownOption } from "./Dropdown";
import styles from "./ExpensesWorkspace.module.css";
import { FriendName, friendDropdownOption } from "./FriendName";
import { TripmateFields } from "./TripmateFields";

type Props = {
  document: Y.Doc;
  snapshot: TripSnapshot;
  places: ReadonlyMap<string, GooglePlaceView>;
  selectedFriendId: string | null;
  onOpenItem: (id: string) => void;
  focusExpenseId: string | null;
  onFocusExpense: (id: string | null) => void;
};

type DialogState =
  | { kind: "categories" | "currency" | "settleUp" }
  | { kind: "expense"; id: string | null }
  | { kind: "settlement"; id: string | null; fromId?: string; toId?: string; amountMinor?: number };

const categories = [
  "food",
  "transport",
  "lodging",
  "activities",
  "shopping",
  "fees",
  "other",
] as const satisfies readonly ExpenseCategory[];
const categoryIcons = {
  food: coffeeIcon,
  transport: trainFrontIcon,
  lodging: bedIcon,
  activities: ticketIcon,
  shopping: shoppingBagIcon,
  fees: receiptIcon,
  other: circleEllipsisIcon,
} as const satisfies Record<ExpenseCategory, typeof receiptIcon>;
const friendColors = ["#087e9f", "#9560a6", "#b06235", "#437e5d", "#a94e75", "#566fb1"] as const;

const categoryKeys = {
  food: "expenseCategoryFood",
  transport: "expenseCategoryTransport",
  lodging: "expenseCategoryLodging",
  activities: "expenseCategoryActivities",
  shopping: "expenseCategoryShopping",
  fees: "expenseCategoryFees",
  other: "expenseCategoryOther",
} as const satisfies Record<ExpenseCategory, string>;

type ExpenseSortBy = "amount" | "date";
type SortDirection = "asc" | "desc";

type ExpenseCategoryText = (key: (typeof categoryKeys)[ExpenseCategory]) => string;

function categoryLabel(category: ExpenseCategory, text: ExpenseCategoryText): string {
  return text(categoryKeys[category]);
}

function categoryOptions(text: ExpenseCategoryText): readonly DropdownOption[] {
  return categories.map((category) => ({
    value: category,
    label: categoryLabel(category, text),
    icon: <Icon icon={categoryIcons[category]} aria-hidden="true" />,
  }));
}

function expenseFriendOptions(
  friends: readonly Friend[],
  text: (
    key: "expenseArchived" | "expenseArchivedName",
    values?: Record<string, string | number>,
  ) => string,
): DropdownOption[] {
  const options: DropdownOption[] = [];
  for (const friend of friends) {
    if (!friend.archived) options.push(friendDropdownOption(friend));
  }
  let firstArchived = true;
  for (const friend of friends) {
    if (!friend.archived) continue;
    const option = friendDropdownOption(friend);
    option.label = friend.name;
    option.ariaLabel = text("expenseArchivedName", { name: friend.name });
    option.muted = true;
    if (firstArchived) {
      option.groupLabel = text("expenseArchived");
      firstArchived = false;
    }
    options.push(option);
  }
  return options;
}

function formatExpenseDate(date: string, formatter: Intl.DateTimeFormat): string {
  return formatter.format(new Date(`${date}T00:00:00Z`));
}

function compareExpenseDate(a: Expense, b: Expense, newest: boolean): number {
  if (a.date === null) return b.date === null ? a.id.localeCompare(b.id) : 1;
  if (b.date === null) return -1;
  return (
    (newest ? b.date.localeCompare(a.date) : a.date.localeCompare(b.date)) ||
    a.id.localeCompare(b.id)
  );
}

function personName(snapshot: TripSnapshot, id: string, unknownName: string): string {
  return snapshot.friends[id]?.name ?? unknownName;
}

function FriendById({ snapshot, id }: { snapshot: TripSnapshot; id: string }) {
  const text = useTripText();
  const friend = snapshot.friends[id];
  return friend ? <FriendName friend={friend} /> : text("expenseUnknownTripmate");
}

function inputAmount(minor: number, currency: string): string {
  const digits = currencyDigits(currency);
  const scale = 10n ** BigInt(digits);
  const value = BigInt(minor);
  const whole = value / scale;
  return digits === 0 ? String(whole) : `${whole}.${String(value % scale).padStart(digits, "0")}`;
}

function parsedAmount(value: string, currency: string): number | null {
  const digits = currencyDigits(currency);
  const input = value.trim();
  if (!(digits === 0 ? /^\d+$/ : new RegExp(`^\\d+(?:\\.\\d{1,${digits}})?$`)).test(input))
    return null;
  try {
    const amount = toMinor(input, currency);
    return Number.isSafeInteger(amount) ? amount : null;
  } catch {
    return null;
  }
}

function identityConversion(amountMinor: number, date: string | null): Conversion {
  return {
    amountMinor,
    rate: 1,
    requestedDate: date,
    observedDate: date ?? new Date().toISOString().slice(0, 10),
    source: "identity",
    stale: false,
  };
}

function Modal({
  title,
  onClose,
  children,
  wide = false,
  stacked = false,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  stacked?: boolean;
}) {
  const text = useTripText();
  const headingId = useId();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (!element.open) element.showModal();
    return () => {
      if (element.open) element.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className={`${styles.modal} ${wide ? styles.wideModal : ""} ${stacked ? styles.stackedModal : ""}`}
      aria-labelledby={headingId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        ) {
          onClose();
        }
      }}
    >
      <div className={styles.modalHeader}>
        <h2 id={headingId}>{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label={text("expenseCloseDialog")}
          onClick={onClose}
        >
          <Icon icon={xIcon} aria-hidden="true" />
        </button>
      </div>
      {children}
    </dialog>
  );
}

function MoneyDisplay({ amountMinor, currency }: { amountMinor: number; currency: string }) {
  const full = formatMoney(amountMinor, currency);
  const unsigned = amountMinor < 0 ? formatMoney(-amountMinor, currency) : full;
  return (
    <>
      <span aria-hidden="true">
        {amountMinor < 0 ? "-" : ""}
        {currencySymbol(currency)} {unsigned.replace(currency, "").trim()}
      </span>
      <span className="sr-only">{full}</span>
    </>
  );
}

export function ExpensesWorkspace({
  document,
  snapshot,
  places,
  selectedFriendId,
  onOpenItem,
  focusExpenseId,
  onFocusExpense,
}: Props) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<ExpenseCategory | "all">("all");
  const [friendFilter, setFriendFilter] = useState("all");
  const [sortBy, setSortBy] = useState<ExpenseSortBy>("amount");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [mineOnly, setMineOnly] = useState(false);
  const [pageError, setPageError] = useState("");
  const text = useTripText();
  const language = useUiLanguage();
  const expenseDateFormat = useMemo(
    () => new Intl.DateTimeFormat(language, { month: "short", day: "numeric", timeZone: "UTC" }),
    [language],
  );
  const paymentDateFormat = useMemo(
    () =>
      new Intl.DateTimeFormat(language, {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }),
    [language],
  );
  const unknownName = text("expenseUnknownTripmate");
  const categoryChoices = categoryOptions(text);
  const categoryFilterOptions: readonly DropdownOption[] = [
    { value: "all", label: text("expenseAllCategories"), separatorAfter: true },
    ...categoryChoices,
  ];
  const sortOptions: readonly DropdownOption[] = [
    {
      value: "amount",
      label: text("sortAmount"),
      icon: <Icon icon={coinsIcon} aria-hidden="true" />,
    },
    {
      value: "date",
      label: text("sortDate"),
      icon: <Icon icon={calendarIcon} aria-hidden="true" />,
    },
  ];
  const directionLabel = text(
    sortBy === "amount"
      ? sortDirection === "asc"
        ? "sortLowToHigh"
        : "sortHighToLow"
      : sortDirection === "asc"
        ? "sortEarlyToLate"
        : "sortLateToEarly",
  );
  const currency = snapshot.currency;
  const friends = Object.values(snapshot.friends).sort((a, b) => a.name.localeCompare(b.name));
  const friendOptions = expenseFriendOptions(friends, text);
  const selectedFriend = selectedFriendId ? snapshot.friends[selectedFriendId] : undefined;
  const activeFriend = selectedFriend && !selectedFriend.archived ? selectedFriend : undefined;
  const balanceFriends = activeFriend
    ? [activeFriend, ...friends.filter((friend) => friend.id !== activeFriend.id)]
    : friends;
  const net = currency ? balances(snapshot) : {};
  const suggestions = currency ? suggestSettlements(snapshot) : [];
  const stale =
    Object.values(snapshot.expenses).some((expense) => expense.conversion.stale) ||
    Object.values(snapshot.settlements).some((settlement) => settlement.conversion.stale);
  const query = search.trim().toLocaleLowerCase();
  const expenses = Object.values(snapshot.expenses)
    .filter((expense) => {
      if (categoryFilter !== "all" && expense.category !== categoryFilter) return false;
      if (friendFilter !== "all") {
        const shares = expenseShares(snapshot, expense);
        if (expense.payerId !== friendFilter && !(friendFilter in shares)) return false;
      }
      if (mineOnly && selectedFriendId) {
        const shares = expenseShares(snapshot, expense);
        if (expense.payerId !== selectedFriendId && !(selectedFriendId in shares)) return false;
      }
      return (
        !query ||
        expense.description.toLocaleLowerCase().includes(query) ||
        personName(snapshot, expense.payerId, unknownName).toLocaleLowerCase().includes(query) ||
        (expense.itemId &&
          snapshot.items[expense.itemId]?.title.toLocaleLowerCase().includes(query))
      );
    })
    .sort((a, b) => {
      if (sortBy === "amount") {
        const aAmount = a.conversion.amountMinor;
        const bAmount = b.conversion.amountMinor;
        if (aAmount !== bAmount) {
          const ascending = aAmount < bAmount ? -1 : 1;
          return sortDirection === "asc" ? ascending : -ascending;
        }
      }
      return compareExpenseDate(a, b, sortBy === "amount" || sortDirection === "desc");
    });
  const settlements = Object.values(snapshot.settlements).sort(
    (a, b) => b.paidAt.localeCompare(a.paidAt) || a.id.localeCompare(b.id),
  );

  useEffect(() => {
    if (focusExpenseId) setDialog({ kind: "expense", id: focusExpenseId });
  }, [focusExpenseId]);
  useEffect(() => {
    if (!exportOpen) return;
    exportRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !exportRef.current?.contains(event.target)) {
        setExportOpen(false);
      }
    };
    const closeOnFocusOutside = (event: FocusEvent) => {
      if (event.target instanceof Node && !exportRef.current?.contains(event.target)) {
        setExportOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setExportOpen(false);
      exportRef.current?.querySelector("button")?.focus();
    };
    window.document.addEventListener("pointerdown", closeOutside);
    window.document.addEventListener("focusin", closeOnFocusOutside);
    window.document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.document.removeEventListener("pointerdown", closeOutside);
      window.document.removeEventListener("focusin", closeOnFocusOutside);
      window.document.removeEventListener("keydown", closeOnEscape);
    };
  }, [exportOpen]);

  const closeDialog = () => {
    if (dialog?.kind === "expense") onFocusExpense(null);
    setDialog(null);
  };
  const openExpense = (id: string | null) => {
    onFocusExpense(id);
    setDialog({ kind: "expense", id });
  };
  const exportCsv = () => {
    setExportOpen(false);
    exportRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    try {
      const blob = new Blob([exportExpensesCsv(snapshot)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = "trip-expenses.csv";
      window.document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      setPageError("");
    } catch {
      setPageError(text("expenseSaveFailed"));
    }
  };

  return (
    <section className={styles.workspace} aria-labelledby="expenses-title">
      <header className={styles.header}>
        <h1 id="expenses-title">{text("expenses")}</h1>
        <div className={styles.headerActions}>
          <button
            type="button"
            className="icon-button"
            aria-label={text("expenseCategories")}
            title={text("expenseCategories")}
            onClick={() => setDialog({ kind: "categories" })}
            disabled={!currency}
          >
            <Icon icon={chartPieIcon} aria-hidden="true" />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={text("expenseSettleUp")}
            title={text("expenseSettleUp")}
            disabled={!currency}
            onClick={() => setDialog({ kind: "settleUp" })}
          >
            <Icon icon={walletIcon} aria-hidden="true" />
          </button>
          <div ref={exportRef} className={styles.exportControl}>
            <button
              type="button"
              className="icon-button"
              aria-label={text("expenseExport")}
              title={text("expenseExport")}
              aria-expanded={exportOpen}
              aria-haspopup="menu"
              aria-controls={exportOpen ? "expense-export-formats" : undefined}
              onClick={() => setExportOpen((open) => !open)}
              disabled={!currency}
            >
              <Icon icon={downloadIcon} aria-hidden="true" />
            </button>
            {exportOpen ? (
              <div
                id="expense-export-formats"
                className={styles.exportPopup}
                role="menu"
                aria-label={text("expenseExportFormat")}
              >
                <button type="button" role="menuitem" onClick={exportCsv}>
                  CSV
                </button>
              </div>
            ) : null}
          </div>
          <button
            type="button"
            className={`primary-button ${styles.addExpense}`}
            aria-label={text("expenseAddExpense")}
            title={text("expenseAddExpense")}
            disabled={!currency || !selectedFriend || selectedFriend.archived}
            onClick={() => openExpense(null)}
          >
            <Icon icon={plusIcon} aria-hidden="true" />
            <span className={styles.addExpenseLabel}>{text("expenseAddExpense")}</span>
          </button>
        </div>
      </header>

      {pageError ? (
        <p role="alert" className="field-error">
          {pageError}
        </p>
      ) : null}
      {!currency ? (
        <div className={styles.notice}>
          <div>
            <strong>{text("expenseChooseTripCurrency")}</strong>
            <p>{text("expenseCurrencyNotice")}</p>
          </div>
          <button
            type="button"
            className="primary-button"
            onClick={() => setDialog({ kind: "currency" })}
          >
            {text("expenseChooseCurrency")}
          </button>
        </div>
      ) : null}

      <section className={styles.summary} aria-label={text("expenseBalances")}>
        <h2>{text("expenseBalances")}</h2>
        {currency ? (
          <div className={styles.balanceGrid}>
            {balanceFriends.length ? (
              balanceFriends.map((friend) => (
                <div key={friend.id} className={styles.balanceCard}>
                  <div className={styles.balanceCardHeader}>
                    <FriendName friend={friend} />
                    {friend.id === activeFriend?.id ? (
                      <span className={styles.selfBadge}>{text("expenseYou")}</span>
                    ) : null}
                  </div>
                  <strong className={(net[friend.id] ?? 0) < 0 ? styles.negative : styles.positive}>
                    <MoneyDisplay amountMinor={net[friend.id] ?? 0} currency={currency} />
                  </strong>
                </div>
              ))
            ) : (
              <p className={styles.empty}>{text("expenseAddTripmatesForCosts")}</p>
            )}
          </div>
        ) : (
          <p className={styles.empty}>{text("expenseChooseCurrencyForBalances")}</p>
        )}
      </section>

      <section className={styles.ledger} aria-label={text("expenses")}>
        <div className={styles.filters}>
          <label className={`field ${styles.searchField}`}>
            <span>{text("expenseSearch")}</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={text("expenseSearchPlaceholder")}
            />
          </label>
          <div className="field">
            <span>{text("expenseCategory")}</span>
            <Dropdown
              label={text("expenseCategory")}
              value={categoryFilter}
              options={categoryFilterOptions}
              onChange={(value) => setCategoryFilter(value as ExpenseCategory | "all")}
            />
          </div>
          <div className="field">
            <span>{text("expenseParticipant")}</span>
            <Dropdown
              label={text("expenseParticipant")}
              value={friendFilter}
              options={[{ value: "all", label: text("expenseEveryone") }, ...friendOptions]}
              onChange={setFriendFilter}
            />
          </div>
          <div className="field">
            <span>{text("sort")}</span>
            <div className={styles.sortControls}>
              <Dropdown
                label={text("sortExpenses")}
                value={sortBy}
                options={sortOptions}
                onChange={(value) => setSortBy(value as ExpenseSortBy)}
              />
              <button
                type="button"
                className="icon-button"
                aria-label={directionLabel}
                title={directionLabel}
                onClick={() =>
                  setSortDirection((direction) => (direction === "asc" ? "desc" : "asc"))
                }
              >
                <Icon
                  icon={sortDirection === "asc" ? arrowUpIcon : arrowDownIcon}
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>
          {selectedFriend ? (
            <label className={styles.checkbox}>
              <input
                type="checkbox"
                checked={mineOnly}
                onChange={(event) => setMineOnly(event.target.checked)}
              />{" "}
              {text("expenseInvolvingMe")}
            </label>
          ) : null}
        </div>
        {expenses.length ? (
          <ul className={styles.expenseList}>
            {expenses.map((expense) => {
              const title = expense.description || categoryLabel(expense.category, text);
              const participantIds =
                expense.split.kind === "payer"
                  ? []
                  : expense.split.kind === "exact"
                    ? Object.keys(expense.split.shares)
                    : expense.split.friendIds;
              const people = [
                expense.payerId,
                ...participantIds.filter((id) => id !== expense.payerId),
              ];
              return (
                <li key={expense.id} className={styles.expenseEntry}>
                  <button
                    type="button"
                    className={styles.expenseOpen}
                    onClick={() => openExpense(expense.id)}
                    aria-label={text(
                      participantIds.length ? "expenseEditSharedWith" : "expenseEditPaidBy",
                      {
                        title,
                        amount: formatMoney(expense.amountMinor, expense.currency),
                        payer: personName(snapshot, expense.payerId, unknownName),
                        names: participantIds
                          .map((id) => personName(snapshot, id, unknownName))
                          .join(", "),
                      },
                    )}
                  >
                    <span className={styles.expenseIcon} aria-hidden="true">
                      <Icon icon={categoryIcons[expense.category]} />
                    </span>
                    <span className={styles.expenseInfo}>
                      <strong className={styles.expenseTitle}>{title}</strong>
                      <span className={styles.expenseMeta}>
                        {expense.date ? (
                          <>
                            <time dateTime={expense.date}>
                              {formatExpenseDate(expense.date, expenseDateFormat)}
                            </time>
                            {" · "}
                          </>
                        ) : null}
                        {categoryLabel(expense.category, text)}
                      </span>
                    </span>
                    <span className={styles.expenseValue}>
                      <span className={styles.amountPair}>
                        <strong>
                          <MoneyDisplay
                            amountMinor={expense.amountMinor}
                            currency={expense.currency}
                          />
                        </strong>
                        {currency && expense.currency !== currency ? (
                          <small>
                            (
                            <MoneyDisplay
                              amountMinor={expense.conversion.amountMinor}
                              currency={currency}
                            />
                            )
                          </small>
                        ) : null}
                      </span>
                      <span className={styles.expensePeople} aria-hidden="true">
                        {people.slice(0, 3).map((id) => {
                          const friend = snapshot.friends[id];
                          return (
                            <span
                              key={id}
                              className={styles.expenseAvatar}
                              title={friend?.name ?? unknownName}
                              style={{ borderColor: friend?.color ?? "var(--border)" }}
                            >
                              {friend?.name.charAt(0).toLocaleUpperCase() ?? "?"}
                            </span>
                          );
                        })}
                        {people.length > 3 ? (
                          <span className={styles.expenseOverflow}>+{people.length - 3}</span>
                        ) : null}
                      </span>
                    </span>
                  </button>
                  {expense.itemId && snapshot.items[expense.itemId] ? (
                    <button
                      type="button"
                      className={`${styles.expenseItemLink} text-button`}
                      onClick={() => {
                        const itemId = expense.itemId;
                        if (itemId) onOpenItem(itemId);
                      }}
                    >
                      {text("expenseLinkedTo", {
                        title:
                          snapshot.items[expense.itemId]?.title || text("expenseItineraryItem"),
                      })}
                    </button>
                  ) : null}
                  {expense.conversion.stale ? (
                    <small className={`${styles.expenseNote} ${styles.warning}`}>
                      {text("expenseRateNeedsRefresh")}
                    </small>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <div className={styles.expenseEmpty}>
            <Icon icon={receiptIcon} aria-hidden="true" />
            <p>
              {text(
                Object.keys(snapshot.expenses).length
                  ? "expenseNoMatchingExpenses"
                  : "expenseNoExpensesYet",
              )}
            </p>
          </div>
        )}
      </section>

      {dialog?.kind === "settleUp" && currency ? (
        <Modal title={text("expenseSettleUp")} onClose={closeDialog} wide>
          <div className={styles.dialogSection}>
            <h3>{text("expenseSuggestedPayments")}</h3>
            {suggestions.length ? (
              suggestions.map((payment) => (
                <div key={`${payment.fromId}-${payment.toId}`} className={styles.debt}>
                  <span>
                    <FriendById snapshot={snapshot} id={payment.fromId} />{" "}
                    <Icon icon={arrowRightIcon} aria-hidden="true" />{" "}
                    <FriendById snapshot={snapshot} id={payment.toId} />
                  </span>
                  <strong>
                    <MoneyDisplay amountMinor={payment.amountMinor} currency={currency} />
                  </strong>
                  <button
                    type="button"
                    className="text-button"
                    disabled={stale}
                    onClick={() => setDialog({ kind: "settlement", id: null, ...payment })}
                  >
                    {text("expenseRecordPayment")}
                  </button>
                </div>
              ))
            ) : (
              <p className={styles.empty}>{text("expenseNoPaymentsSuggested")}</p>
            )}
            <button
              type="button"
              className="secondary-button"
              disabled={stale || friends.length < 2}
              onClick={() => setDialog({ kind: "settlement", id: null })}
            >
              <Icon icon={plusIcon} aria-hidden="true" /> {text("expenseRecordCustomPayment")}
            </button>
            {stale ? (
              <p role="alert" className={styles.warning}>
                {text("expenseRatesRefreshing")}
              </p>
            ) : null}
          </div>
          <div className={styles.dialogSection}>
            <h3>{text("expensePaymentHistory")}</h3>
            <div className={styles.entries}>
              {settlements.length ? (
                settlements.map((settlement) => (
                  <button
                    key={settlement.id}
                    type="button"
                    className={styles.historyRow}
                    onClick={() => setDialog({ kind: "settlement", id: settlement.id })}
                  >
                    <span>
                      <strong>
                        {text("expensePaid", {
                          from: personName(snapshot, settlement.fromId, unknownName),
                          to: personName(snapshot, settlement.toId, unknownName),
                        })}
                      </strong>
                      <small>
                        <time dateTime={settlement.paidAt}>
                          {formatExpenseDate(settlement.paidAt.slice(0, 10), paymentDateFormat)}
                        </time>
                        {settlement.note ? ` · ${settlement.note}` : ""}
                      </small>
                    </span>
                    <span className={styles.amountPair}>
                      <strong>
                        <MoneyDisplay
                          amountMinor={settlement.amountMinor}
                          currency={settlement.currency}
                        />
                      </strong>
                      {settlement.currency !== currency ? (
                        <small>
                          (
                          <MoneyDisplay
                            amountMinor={settlement.conversion.amountMinor}
                            currency={currency}
                          />
                          )
                        </small>
                      ) : null}
                    </span>
                  </button>
                ))
              ) : (
                <p className={styles.empty}>{text("expenseNoPaymentsRecorded")}</p>
              )}
            </div>
          </div>
        </Modal>
      ) : null}
      {dialog?.kind === "currency" ? (
        <CurrencyDialog document={document} onClose={closeDialog} />
      ) : null}
      {dialog?.kind === "categories" && currency ? (
        <Modal title={text("expenseSpendingByCategory")} onClose={closeDialog}>
          <div className={styles.categoryTotals}>
            {Object.entries(categoryTotals(snapshot)).map(([category, total]) => {
              const expenseCategory = category as ExpenseCategory;
              return (
                <div key={category}>
                  <span className={styles.categoryName}>
                    <Icon icon={categoryIcons[expenseCategory]} aria-hidden="true" />
                    {categoryLabel(expenseCategory, text)}
                  </span>
                  <strong>
                    <MoneyDisplay amountMinor={total} currency={currency} />
                  </strong>
                </div>
              );
            })}
          </div>
          <div className={styles.actions}>
            <button type="button" className="secondary-button" onClick={closeDialog}>
              {text("expenseClose")}
            </button>
          </div>
        </Modal>
      ) : null}
      {dialog?.kind === "expense" && currency && (!dialog.id || snapshot.expenses[dialog.id]) ? (
        <ExpenseEditor
          key={dialog.id ?? "new"}
          document={document}
          snapshot={snapshot}
          places={places}
          selectedFriendId={selectedFriendId}
          expense={dialog.id ? (snapshot.expenses[dialog.id] ?? null) : null}
          onClose={closeDialog}
        />
      ) : null}
      {dialog?.kind === "expense" && dialog.id && !snapshot.expenses[dialog.id] ? (
        <Modal title={text("expenseUnavailable")} onClose={closeDialog}>
          <p className={styles.helper}>{text("expenseRemovedByCollaborator")}</p>
          <div className={styles.actions}>
            <button type="button" className="secondary-button" onClick={closeDialog}>
              {text("expenseClose")}
            </button>
          </div>
        </Modal>
      ) : null}
      {dialog?.kind === "settlement" && currency ? (
        <SettlementEditor
          key={dialog.id ?? `${dialog.fromId ?? "custom"}-${dialog.toId ?? ""}`}
          document={document}
          snapshot={snapshot}
          settlement={dialog.id ? (snapshot.settlements[dialog.id] ?? null) : null}
          fromId={dialog.fromId}
          toId={dialog.toId}
          amountMinor={dialog.amountMinor}
          onClose={closeDialog}
        />
      ) : null}
    </section>
  );
}

function CurrencyDialog({ document, onClose }: { document: Y.Doc; onClose: () => void }) {
  const [currency, setCurrency] = useState(() => browserCurrency() ?? "USD");
  const [error, setError] = useState("");
  const text = useTripText();
  return (
    <Modal title={text("expenseChooseTripCurrency")} onClose={onClose}>
      <p className={styles.helper}>{text("expenseCurrencyDialogHelper")}</p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          try {
            setTripCurrency(document, currency);
            onClose();
          } catch {
            setError(text("expenseSaveFailed"));
          }
        }}
        className={styles.form}
      >
        <div className="field">
          <span>{text("tripCurrency")}</span>
          <CurrencyDropdown label={text("tripCurrency")} value={currency} onChange={setCurrency} />
        </div>
        {error ? (
          <p role="alert" className="field-error">
            {error}
          </p>
        ) : null}
        <div className={styles.actions}>
          <button type="button" className="ghost-button" onClick={onClose}>
            {text("cancel")}
          </button>
          <button type="submit" className="primary-button">
            {text("expenseUseCurrency", { currency })}
          </button>
        </div>
      </form>
    </Modal>
  );
}

type FriendDraft = Pick<Friend, "name" | "color" | "archived">;

export function TripmatesDialog({
  document,
  snapshot,
  selectedFriendId,
  onSelectFriend,
  onClose,
}: {
  document: Y.Doc;
  snapshot: TripSnapshot;
  selectedFriendId: string | null;
  onSelectFriend: (id: string | null) => void;
  onClose: () => void;
}) {
  const text = useTripText();
  const [drafts, setDrafts] = useState<Record<string, FriendDraft>>({});
  const [selectedDraft, setSelectedDraft] = useState(selectedFriendId);
  const [addOpen, setAddOpen] = useState(false);
  const [error, setError] = useState("");
  const friends = Object.values(snapshot.friends).sort((a, b) => a.name.localeCompare(b.name));
  const activeFriends: Friend[] = [];
  const archivedFriends: Friend[] = [];
  for (const friend of friends) {
    if (drafts[friend.id]?.archived ?? friend.archived) archivedFriends.push(friend);
    else activeFriends.push(friend);
  }
  const changedFriends: Friend[] = [];
  for (const friend of friends) {
    const draft = drafts[friend.id];
    if (!draft) continue;
    const name = draft.name.trim();
    if (
      name !== friend.name ||
      draft.color !== friend.color ||
      draft.archived !== friend.archived
    ) {
      changedFriends.push({ ...friend, ...draft, name });
    }
  }
  const canSave =
    (changedFriends.length > 0 || selectedDraft !== selectedFriendId) &&
    changedFriends.every((friend) => friend.name.length > 0);
  const save = () => {
    if (!canSave) return;
    try {
      upsertFriends(document, changedFriends);
      if (selectedDraft !== selectedFriendId) onSelectFriend(selectedDraft);
      onClose();
    } catch {
      setError(text("expenseSaveFailed"));
    }
  };
  const renderFriend = (friend: Friend) => (
    <FriendRow
      key={friend.id}
      friend={friend}
      draft={drafts[friend.id] ?? friend}
      onChange={(draft) => setDrafts((current) => ({ ...current, [friend.id]: draft }))}
      onArchive={() => {
        const draft = drafts[friend.id] ?? friend;
        setDrafts((current) => ({
          ...current,
          [friend.id]: { ...draft, archived: !draft.archived },
        }));
        if (selectedDraft === friend.id && !draft.archived) setSelectedDraft(null);
      }}
    />
  );
  return (
    <>
      <Modal title={text("tripmates")} onClose={onClose}>
        <div className={styles.friendIdentity}>
          <div className="field">
            <span>{text("tripmateIdentity")}</span>
            <Dropdown
              label={text("tripmateIdentity")}
              value={selectedDraft ?? ""}
              options={[
                {
                  value: "",
                  label: text("tripmateGuest"),
                  icon: <Icon icon={userIcon} aria-hidden="true" />,
                },
                ...activeFriends.map(friendDropdownOption),
              ]}
              onChange={(id) => setSelectedDraft(id || null)}
            />
          </div>
        </div>
        <div className={styles.friendList}>
          {activeFriends.map(renderFriend)}
          {archivedFriends.length > 0 ? (
            <details className={styles.archivedFriends}>
              <summary className={styles.archivedSummary}>{text("expenseArchivedUsers")}</summary>
              <div className={styles.archivedRows}>{archivedFriends.map(renderFriend)}</div>
            </details>
          ) : null}
        </div>
        {error ? (
          <p role="alert" className="field-error">
            {error}
          </p>
        ) : null}
        <div className={styles.actions}>
          <button type="button" className="secondary-button" onClick={() => setAddOpen(true)}>
            <Icon icon={plusIcon} aria-hidden="true" /> {text("expenseAddTripmate")}
          </button>
          <button type="button" className="primary-button" disabled={!canSave} onClick={save}>
            {text("expenseSave")}
          </button>
        </div>
      </Modal>
      {addOpen ? (
        <AddTripmateDialog
          document={document}
          nextColor={friendColors[friends.length % friendColors.length] ?? friendColors[0]}
          reservedNames={friends.map((friend) =>
            (drafts[friend.id]?.name ?? friend.name).trim().toLowerCase(),
          )}
          onClose={() => setAddOpen(false)}
        />
      ) : null}
    </>
  );
}

function AddTripmateDialog({
  document,
  nextColor,
  reservedNames,
  onClose,
}: {
  document: Y.Doc;
  nextColor: string;
  reservedNames: readonly string[];
  onClose: () => void;
}) {
  const text = useTripText();
  const [name, setName] = useState("");
  const [color, setColor] = useState(nextColor);
  const [error, setError] = useState("");
  return (
    <Modal title={text("expenseNewTripmate")} onClose={onClose} stacked>
      <form
        className={styles.form}
        onSubmit={(event) => {
          event.preventDefault();
          const trimmed = name.trim();
          if (!trimmed) return;
          if (reservedNames.includes(trimmed.toLowerCase())) {
            setError(text("tripmateJoinNameExists"));
            return;
          }
          try {
            createTripmate(document, {
              id: crypto.randomUUID(),
              name: trimmed,
              color,
              archived: false,
            });
            onClose();
          } catch {
            setError(text("expenseSaveFailed"));
          }
        }}
      >
        <TripmateFields
          name={name}
          color={color}
          nameLabel={text("expenseName")}
          colorLabel={text("expenseColor")}
          placeholder={text("tripmateJoinName")}
          required
          maxLength={100}
          onNameChange={(value) => {
            setName(value);
            setError("");
          }}
          onColorChange={setColor}
        />
        {error ? (
          <p role="alert" className="field-error">
            {error}
          </p>
        ) : null}
        <div className={styles.actions}>
          <button type="button" className="secondary-button" onClick={onClose}>
            {text("cancel")}
          </button>
          <button type="submit" className="primary-button" disabled={!name.trim()}>
            {text("expenseSave")}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function FriendRow({
  friend,
  draft,
  onChange,
  onArchive,
}: {
  friend: Friend;
  draft: FriendDraft;
  onChange: (draft: FriendDraft) => void;
  onArchive: () => void;
}) {
  const text = useTripText();
  const initialName = useRef(draft.name);
  const cancelled = useRef(false);

  const finishNameEdit = () => {
    const name = cancelled.current ? initialName.current : draft.name.trim() || initialName.current;
    cancelled.current = false;
    onChange({ ...draft, name });
  };

  return (
    <div className={styles.friendRow}>
      <TripmateFields
        name={draft.name}
        color={draft.color}
        nameLabel={text("expenseNameForTripmate", { name: friend.name })}
        colorLabel={text("expenseColorForTripmate", { name: friend.name })}
        aria-invalid={!draft.name.trim()}
        maxLength={100}
        onNameChange={(name) => onChange({ ...draft, name })}
        onColorChange={(color) => onChange({ ...draft, color })}
        onFocus={() => {
          initialName.current = draft.name;
          cancelled.current = false;
        }}
        onBlur={finishNameEdit}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter" || event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            cancelled.current = event.key === "Escape";
            event.currentTarget.blur();
          }
        }}
      >
        <button
          type="button"
          className={`${styles.friendArchiveButton} ghost-button icon-button`}
          aria-label={`${text(draft.archived ? "expenseRestore" : "expenseArchive")} ${draft.name}`}
          title={`${text(draft.archived ? "expenseRestore" : "expenseArchive")} ${draft.name}`}
          onClick={onArchive}
        >
          <Icon icon={draft.archived ? archiveRestoreIcon : archiveIcon} aria-hidden="true" />
        </button>
      </TripmateFields>
      {!draft.name.trim() ? <p className="field-error">{text("expenseEnterName")}</p> : null}
    </div>
  );
}

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
  const specifiedTotal = draft.participants.reduce(
    (sum, id) => sum + BigInt(parsedAmount(draft.shares[id] ?? "", draft.currency) ?? 0),
    0n,
  );
  const blankCount = draft.participants.filter((id) => !(draft.shares[id] ?? "").trim()).length;
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
      className={styles.form}
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
            />{" "}
            {text("expensePayerOnly")}
          </label>
          <label>
            <input
              type="radio"
              name="split-kind"
              checked={draft.splitKind === "shared"}
              onChange={() => setDraft({ ...draft, splitKind: "shared" })}
            />{" "}
            {text("expenseShared")}
          </label>
        </div>
        {draft.splitKind === "payer" ? (
          <p className={styles.helper}>{text("expensePayerCoversAll")}</p>
        ) : (
          <div className={styles.splitPeople}>
            <p className={styles.fieldHint} id="expense-shares-hint">
              {text("expenseBlankSharesHint")}
            </p>
            {participants.map((friend) => {
              const selected = draft.participants.includes(friend.id);
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
                  <input
                    className={styles.splitAmount}
                    type="text"
                    inputMode="decimal"
                    value={selected ? (draft.shares[friend.id] ?? "") : ""}
                    disabled={!selected}
                    placeholder={draft.currency}
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
                    aria-describedby="expense-shares-hint"
                  />
                </div>
              );
            })}
            {amount !== null && draft.participants.length ? (
              <p className={styles.fieldHint}>
                {text("expenseSpecifiedOf", {
                  total:
                    specifiedTotal <= BigInt(Number.MAX_SAFE_INTEGER)
                      ? formatMoney(Number(specifiedTotal), draft.currency)
                      : text("expenseTooLarge"),
                  amount: formatMoney(amount, draft.currency),
                })}
              </p>
            ) : null}
            {splitIssue && amount !== null ? (
              <p role="alert" className={styles.warning}>
                {text(splitIssue, { amount: formatMoney(amount, draft.currency) })}
              </p>
            ) : null}
          </div>
        )}
      </fieldset>
      {error ? (
        <p role="alert" className="field-error">
          {error}
        </p>
      ) : null}
      <div className={styles.actions}>
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

function SettlementEditor({
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
        className={styles.form}
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
        <div className={styles.actions}>
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
