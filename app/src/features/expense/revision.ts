import type { TripSnapshot } from "../trip/model";

/** Compare the whole financial state before an asynchronous currency rebase. */
export function financialFingerprint(snapshot: TripSnapshot): string {
  return JSON.stringify({
    currency: snapshot.currency,
    expenses: Object.entries(snapshot.expenses).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
    settlements: Object.entries(snapshot.settlements).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  });
}
