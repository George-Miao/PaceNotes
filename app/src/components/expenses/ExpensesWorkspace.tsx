import { Icon } from "@iconify/react";
import arrowDownIcon from "@iconify-icons/lucide/arrow-down";
import arrowRightIcon from "@iconify-icons/lucide/arrow-right";
import arrowUpIcon from "@iconify-icons/lucide/arrow-up";
import calendarIcon from "@iconify-icons/lucide/calendar";
import chartPieIcon from "@iconify-icons/lucide/chart-pie";
import coinsIcon from "@iconify-icons/lucide/coins";
import downloadIcon from "@iconify-icons/lucide/download";
import plusIcon from "@iconify-icons/lucide/plus";
import receiptIcon from "@iconify-icons/lucide/receipt";
import walletIcon from "@iconify-icons/lucide/wallet";
import { useEffect, useMemo, useRef, useState } from "react";
import type * as Y from "yjs";
import { FriendName } from "~/components/tripmates/FriendName";
import { Dropdown, type DropdownOption } from "~/components/ui/Dropdown";
import { Modal } from "~/components/ui/Modal";
import modalStyles from "~/components/ui/Modal.module.css";
import { setTripCurrency } from "~/features/collaboration/document";
import type { Expense, ExpenseCategory } from "~/features/expense/model";
import {
  balances,
  browserCurrency,
  categoryTotals,
  expenseShares,
  exportExpensesCsv,
  formatMoney,
  suggestSettlements,
} from "~/features/expense/money";
import type { GooglePlaceView } from "~/features/google/google";
import { useTripText, useUiLanguage } from "~/features/trip/language";
import type { TripSnapshot } from "~/features/trip/model";
import { CurrencyDropdown } from "./CurrencyDropdown";
import { ExpenseEditor } from "./ExpenseEditor";
import styles from "./ExpensesWorkspace.module.css";
import {
  categoryIcons,
  categoryLabel,
  categoryOptions,
  expenseFriendOptions,
  formatExpenseDate,
  MoneyDisplay,
} from "./expense-helpers";
import { SettlementEditor } from "./SettlementEditor";

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

type ExpenseSortBy = "amount" | "date";
type SortDirection = "asc" | "desc";

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
          <div className={modalStyles.actions}>
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
          <div className={modalStyles.actions}>
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
        className={modalStyles.form}
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
        <div className={modalStyles.actions}>
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
