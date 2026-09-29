import { useEffect } from "react";
import {
  initializeTripCurrency,
  readTripDocument,
  refreshExpenseConversion,
  refreshSettlementConversion,
} from "~/features/collaboration/document";
import { convertExpense } from "~/features/expense/exchange.functions";
import { browserCurrency, currencyForCountry } from "~/features/expense/money";
import type { GooglePlaceView } from "~/features/google/google";
import type { TripSnapshot } from "~/features/trip/model";

export function useTripCurrency(
  document: Parameters<typeof initializeTripCurrency>[0],
  snapshot: Pick<TripSnapshot, "id" | "currency" | "destination" | "expenses" | "settlements">,
  placeViews: ReadonlyMap<string, GooglePlaceView>,
) {
  useEffect(() => {
    if (!snapshot.id || snapshot.currency) return;
    const destination = placeViews.get(snapshot.destination.placeId);
    if (destination === undefined) return;
    const currency =
      (destination.countryCode && currencyForCountry(destination.countryCode)) || browserCurrency();
    if (currency) initializeTripCurrency(document, currency);
  }, [document, snapshot.id, snapshot.currency, snapshot.destination.placeId, placeViews]);
  useEffect(() => {
    const tripCurrency = snapshot.currency;
    if (!tripCurrency || !snapshot.id) return;
    const stale = Object.values(snapshot.expenses).filter((expense) => expense.conversion.stale);
    const staleSettlements = Object.values(snapshot.settlements).filter(
      (settlement) => settlement.conversion.stale,
    );
    if (stale.length === 0 && staleSettlements.length === 0) return;
    let cancelled = false;
    let retryTimer: number | undefined;
    const retry = async () => {
      let failed = false;
      for (const expense of stale) {
        if (cancelled) return;
        try {
          const conversion = await convertExpense(
            expense.amountMinor,
            expense.currency,
            tripCurrency,
            expense.date,
          );
          if (cancelled) return;
          const current = readTripDocument(document).expenses[expense.id];
          if (
            current?.conversion.stale &&
            current.amountMinor === expense.amountMinor &&
            current.currency === expense.currency &&
            current.date === expense.date
          ) {
            refreshExpenseConversion(document, { ...current, conversion });
          }
        } catch {
          failed = true;
        }
      }
      for (const settlement of staleSettlements) {
        if (cancelled) return;
        try {
          const conversion = await convertExpense(
            settlement.amountMinor,
            settlement.currency,
            tripCurrency,
            null,
          );
          if (cancelled) return;
          const current = readTripDocument(document).settlements[settlement.id];
          if (
            current?.conversion.stale &&
            current.amountMinor === settlement.amountMinor &&
            current.currency === settlement.currency &&
            current.paidAt === settlement.paidAt
          ) {
            refreshSettlementConversion(document, { ...current, conversion });
          }
        } catch {
          failed = true;
        }
      }
      if (failed && !cancelled)
        retryTimer = window.setTimeout(() => {
          void retry();
        }, 30_000);
    };
    void retry();
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [document, snapshot.id, snapshot.currency, snapshot.expenses, snapshot.settlements]);
}
