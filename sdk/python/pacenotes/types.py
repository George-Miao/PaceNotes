"""PaceNotes v1 JSON values. Dates and times are wire-format strings."""

from __future__ import annotations

from typing import Literal, NotRequired, TypedDict

Method = Literal[
    "trip.create", "place.search", "trip.read", "trip.update", "trip.setDates",
    "trip.changeCurrency", "item.create", "item.update", "item.move",
    "item.reorder", "item.remove", "tripmate.create", "tripmate.update",
    "tripmate.remove", "expense.create", "expense.update", "expense.remove",
    "payment.create", "payment.update", "payment.remove",
]


class PlaceReference(TypedDict):
    placeId: str


class PlaceSearchParams(TypedDict):
    query: str
    language: NotRequired[str]


class PlaceSearchHit(TypedDict):
    placeId: str
    displayName: str
    formattedAddress: str | None


class PlaceSearchResult(TypedDict):
    places: list[PlaceSearchHit]


class TripCreateParams(TypedDict):
    idempotencyKey: str
    startDate: str
    endDate: str
    destination: PlaceReference
    title: NotRequired[str]
    timeZone: NotRequired[str]


class TripCreateResult(TypedDict):
    id: str
    url: str


class TripRecord(TypedDict):
    id: str
    title: str
    startDate: str
    endDate: str
    timeZone: str
    destination: PlaceReference
    tripLanguage: str | None
    distanceUnit: Literal["metric", "imperial"]
    defaultTravelMode: Literal["DRIVING", "TRANSIT", "WALKING"]
    calendarStartHour: int
    currency: str | None


class TripPatch(TypedDict, total=False):
    title: str
    destination: PlaceReference
    timeZone: str
    tripLanguage: str | None
    distanceUnit: Literal["metric", "imperial"]
    defaultTravelMode: Literal["DRIVING", "TRANSIT", "WALKING"]
    calendarStartHour: int


class TripUpdateParams(TypedDict):
    expected: str
    patch: TripPatch


class TripSetDatesParams(TypedDict):
    expected: str
    startDate: str
    endDate: str


class TripChangeCurrencyParams(TypedDict):
    expected: str
    currency: str


class TripResult(TypedDict):
    record: TripRecord
    version: str


class Reservation(TypedDict):
    provider: str
    confirmation: str


class Lodging(TypedDict):
    startDate: str
    endDate: str
    leaveTimes: dict[str, str]


Transport = TypedDict(
    "Transport",
    {
        "from": PlaceReference | None,
        "to": PlaceReference | None,
        "mode": Literal["plane", "train", "bus", "ferry", "custom"],
        "customMode": str,
    },
)


class ItemInput(TypedDict):
    id: str
    type: Literal["place", "note", "reservation", "lodging", "transport"]
    title: str
    details: str
    dayId: str | None
    startTime: str | None
    durationMinutes: int
    place: PlaceReference | None
    reservation: Reservation | None
    lodging: Lodging | None
    transport: Transport | None
    travelMode: Literal["DRIVING", "TRANSIT", "WALKING"]


class StoredItem(ItemInput):
    timeChoice: NotRequired[Literal["earlier", "later"] | None]


class ItemPatch(TypedDict, total=False):
    title: str
    details: str
    startTime: str | None
    durationMinutes: int
    place: PlaceReference | None
    reservation: Reservation | None
    lodging: Lodging | None
    transport: Transport | None
    travelMode: Literal["DRIVING", "TRANSIT", "WALKING"]


class ItemCreateParams(TypedDict):
    idempotencyKey: str
    item: ItemInput
    timeChoice: NotRequired[Literal["earlier", "later"]]


class ItemUpdateParams(TypedDict):
    id: str
    expected: str
    patch: ItemPatch
    timeChoice: NotRequired[Literal["earlier", "later"]]


class ItemMoveParams(TypedDict):
    id: str
    expected: str
    orderExpected: str
    dayId: str | None
    startTime: str | None
    beforeId: str | None
    timeChoice: NotRequired[Literal["earlier", "later"]]


class ItemReorderParams(TypedDict):
    expected: str
    order: list[str]


class IdExpectedParams(TypedDict):
    id: str
    expected: str


class ItemResult(TypedDict):
    record: StoredItem
    version: str
    orderVersion: NotRequired[str]


class ItemReorderResult(TypedDict):
    order: list[str]
    version: str


class RemovedResult(TypedDict):
    removed: Literal[True]


class ItemRemovedResult(RemovedResult):
    orderVersion: str


class Tripmate(TypedDict):
    id: str
    name: str
    color: str
    archived: bool


class TripmateCreateParams(TypedDict):
    idempotencyKey: str
    id: str
    name: str
    color: str


class TripmatePatch(TypedDict, total=False):
    name: str
    color: str
    archived: bool


class TripmateUpdateParams(TypedDict):
    id: str
    expected: str
    patch: TripmatePatch


class TripmateResult(TypedDict):
    record: Tripmate
    version: str


class SplitPayer(TypedDict):
    kind: Literal["payer"]


class SplitEqual(TypedDict):
    kind: Literal["equal"]
    friendIds: list[str]


class SplitExact(TypedDict):
    kind: Literal["exact"]
    shares: dict[str, int]


class SplitMixed(TypedDict):
    kind: Literal["mixed"]
    friendIds: list[str]
    shares: dict[str, int]


Split = SplitPayer | SplitEqual | SplitExact | SplitMixed


class ExpenseInput(TypedDict):
    id: str
    description: str
    category: Literal["food", "transport", "lodging", "activities", "shopping", "fees", "other"]
    amountMinor: int
    currency: str
    payerId: str
    split: Split
    itemId: str | None
    date: str | None
    followsItemDate: bool


class Conversion(TypedDict):
    amountMinor: int
    rate: float
    requestedDate: str | None
    observedDate: str
    source: str
    stale: bool


class Expense(ExpenseInput):
    conversion: Conversion


class ExpenseCreateParams(TypedDict):
    idempotencyKey: str
    expense: ExpenseInput


class ExpenseUpdateParams(TypedDict):
    expected: str
    expense: ExpenseInput


class ExpenseResult(TypedDict):
    record: Expense
    version: str


class PaymentInput(TypedDict):
    id: str
    fromId: str
    toId: str
    amountMinor: int
    currency: str
    note: str
    paidAt: str


class Payment(PaymentInput):
    conversion: Conversion


class PaymentCreateParams(TypedDict):
    idempotencyKey: str
    payment: PaymentInput
    acknowledgeOverpayment: NotRequired[bool]


class PaymentUpdateParams(TypedDict):
    expected: str
    payment: PaymentInput
    acknowledgeOverpayment: NotRequired[bool]


class PaymentResult(TypedDict):
    record: Payment
    version: str


class PageSelector(TypedDict, total=False):
    limit: int
    cursor: str


class SnapshotSelector(TypedDict):
    kind: Literal["snapshot"]


class ItemsSelector(PageSelector):
    kind: Literal["items"]
    dayId: NotRequired[str | None]
    type: NotRequired[Literal["place", "note", "reservation", "lodging", "transport"]]


class ItemSelector(TypedDict):
    kind: Literal["item"]
    id: str


class TripmatesSelector(PageSelector):
    kind: Literal["tripmates"]


class TripmateSelector(TypedDict):
    kind: Literal["tripmate"]
    id: str


class ExpensesSelector(PageSelector):
    kind: Literal["expenses"]
    date: NotRequired[str | None]


class ExpenseSelector(TypedDict):
    kind: Literal["expense"]
    id: str


class PaymentsSelector(PageSelector):
    kind: Literal["payments"]


class PaymentSelector(TypedDict):
    kind: Literal["payment"]
    id: str


class FinanceSelector(TypedDict):
    kind: Literal["finance"]


ReadSelector = (SnapshotSelector | ItemsSelector | ItemSelector | TripmatesSelector |
                TripmateSelector | ExpensesSelector | ExpenseSelector |
                PaymentsSelector | PaymentSelector | FinanceSelector)


class TripReadParams(TypedDict):
    select: ReadSelector


class Day(TypedDict):
    id: str
    date: str


class Snapshot(TripRecord):
    days: list[Day]
    order: list[str]
    items: dict[str, StoredItem]
    friends: dict[str, Tripmate]
    expenses: dict[str, Expense]
    settlements: dict[str, Payment]


class RecordVersions(TypedDict):
    trip: str
    order: str
    items: dict[str, str]
    tripmates: dict[str, str]
    expenses: dict[str, str]
    payments: dict[str, str]


class SnapshotRead(TypedDict):
    kind: Literal["snapshot"]
    snapshot: Snapshot
    versions: RecordVersions


class VersionedItem(TypedDict):
    record: StoredItem
    version: str


class VersionedTripmate(TypedDict):
    record: Tripmate
    version: str


class VersionedExpense(TypedDict):
    record: Expense
    version: str


class VersionedPayment(TypedDict):
    record: Payment
    version: str


class ItemsRead(TypedDict):
    kind: Literal["items"]
    records: list[VersionedItem]
    nextCursor: str | None


class ItemRead(VersionedItem):
    kind: Literal["item"]


class TripmatesRead(TypedDict):
    kind: Literal["tripmates"]
    records: list[VersionedTripmate]
    nextCursor: str | None


class TripmateRead(VersionedTripmate):
    kind: Literal["tripmate"]


class ExpensesRead(TypedDict):
    kind: Literal["expenses"]
    records: list[VersionedExpense]
    nextCursor: str | None


class ExpenseRead(VersionedExpense):
    kind: Literal["expense"]


class PaymentsRead(TypedDict):
    kind: Literal["payments"]
    records: list[VersionedPayment]
    nextCursor: str | None


class PaymentRead(VersionedPayment):
    kind: Literal["payment"]


class Suggestion(TypedDict):
    fromId: str
    toId: str
    amountMinor: int


class FinanceRead(TypedDict):
    kind: Literal["finance"]
    currency: str
    balances: dict[str, int]
    suggestions: list[Suggestion]


ReadResult = (SnapshotRead | ItemsRead | ItemRead | TripmatesRead | TripmateRead |
              ExpensesRead | ExpenseRead | PaymentsRead | PaymentRead | FinanceRead)


class TripChange(TypedDict):
    trip: bool
    order: bool
    items: list[str]
    tripmates: list[str]
    expenses: list[str]
    payments: list[str]
