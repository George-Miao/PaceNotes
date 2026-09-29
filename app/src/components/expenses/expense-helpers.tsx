import { Icon } from "@iconify/react";
import bedIcon from "@iconify-icons/lucide/bed";
import circleEllipsisIcon from "@iconify-icons/lucide/circle-ellipsis";
import coffeeIcon from "@iconify-icons/lucide/coffee";
import receiptIcon from "@iconify-icons/lucide/receipt";
import shoppingBagIcon from "@iconify-icons/lucide/shopping-bag";
import ticketIcon from "@iconify-icons/lucide/ticket";
import trainFrontIcon from "@iconify-icons/lucide/train-front";
import { friendDropdownOption } from "~/components/tripmates/FriendName";
import type { DropdownOption } from "~/components/ui/Dropdown";
import type { Conversion, ExpenseCategory, Friend } from "~/features/expense/model";
import { currencyDigits, currencySymbol, formatMoney, toMinor } from "~/features/expense/money";

const categories = [
  "food",
  "transport",
  "lodging",
  "activities",
  "shopping",
  "fees",
  "other",
] as const satisfies readonly ExpenseCategory[];
export const categoryIcons = {
  food: coffeeIcon,
  transport: trainFrontIcon,
  lodging: bedIcon,
  activities: ticketIcon,
  shopping: shoppingBagIcon,
  fees: receiptIcon,
  other: circleEllipsisIcon,
} as const satisfies Record<ExpenseCategory, typeof receiptIcon>;
const categoryKeys = {
  food: "expenseCategoryFood",
  transport: "expenseCategoryTransport",
  lodging: "expenseCategoryLodging",
  activities: "expenseCategoryActivities",
  shopping: "expenseCategoryShopping",
  fees: "expenseCategoryFees",
  other: "expenseCategoryOther",
} as const satisfies Record<ExpenseCategory, string>;

type ExpenseCategoryText = (key: (typeof categoryKeys)[ExpenseCategory]) => string;

export function categoryLabel(category: ExpenseCategory, text: ExpenseCategoryText): string {
  return text(categoryKeys[category]);
}

export function categoryOptions(text: ExpenseCategoryText): readonly DropdownOption[] {
  return categories.map((category) => ({
    value: category,
    label: categoryLabel(category, text),
    icon: <Icon icon={categoryIcons[category]} aria-hidden="true" />,
  }));
}

export function expenseFriendOptions(
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

export function formatExpenseDate(date: string, formatter: Intl.DateTimeFormat): string {
  return formatter.format(new Date(`${date}T00:00:00Z`));
}

export function inputAmount(minor: number, currency: string): string {
  const digits = currencyDigits(currency);
  const scale = 10n ** BigInt(digits);
  const value = BigInt(minor);
  const whole = value / scale;
  return digits === 0 ? String(whole) : `${whole}.${String(value % scale).padStart(digits, "0")}`;
}

export function parsedAmount(value: string, currency: string): number | null {
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

export function identityConversion(amountMinor: number, date: string | null): Conversion {
  return {
    amountMinor,
    rate: 1,
    requestedDate: date,
    observedDate: date ?? new Date().toISOString().slice(0, 10),
    source: "identity",
    stale: false,
  };
}

export function MoneyDisplay({ amountMinor, currency }: { amountMinor: number; currency: string }) {
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
