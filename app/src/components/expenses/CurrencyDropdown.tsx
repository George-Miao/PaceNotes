import { Icon } from "@iconify/react";
import coinsIcon from "@iconify-icons/lucide/coins";
import { Dropdown, type DropdownOption, type DropdownProps } from "~/components/ui/Dropdown";
import { currencySymbol, supportedCurrencies } from "~/features/expense/money";

type Props = Omit<DropdownProps, "options">;
const majorCurrencies: readonly string[] = ["USD", "CNY", "JPY", "EUR", "GBP", "CAD", "AUD", "CHF"];

let options: readonly DropdownOption[] | undefined;

function currencyOptions(): readonly DropdownOption[] {
  if (options) return options;
  const major = majorCurrencies.filter((code) =>
    supportedCurrencies.some((supported) => supported === code),
  );
  const others = supportedCurrencies.filter((code) => !majorCurrencies.includes(code));
  options = [...major, ...others].map((code, index) => {
    const symbol = currencySymbol(code);
    return {
      value: code,
      label: code,
      icon: symbol === code ? <Icon icon={coinsIcon} /> : <span>{symbol}</span>,
      separatorAfter: index === major.length - 1 && others.length > 0,
    };
  });
  return options;
}

export function CurrencyDropdown(props: Props) {
  return <Dropdown {...props} options={currencyOptions()} />;
}
