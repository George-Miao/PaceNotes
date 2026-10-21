use serde::{Deserialize, Serialize, de::DeserializeOwned};

use crate::domain::*;

pub trait Method {
    type Params: Serialize;
    type Result: DeserializeOwned;
    const NAME: &'static str;
}

macro_rules! method {
    ($marker:ident, $name:literal, $params:ident, $result:ty) => {
        pub struct $marker;
        impl Method for $marker {
            type Params = $params;
            type Result = $result;
            const NAME: &'static str = $name;
        }
    };
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TripCreateParams {
    pub idempotency_key: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub start_date: String,
    pub end_date: String,
    pub destination: PlaceReference,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_zone: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TripCreateResult {
    pub id: String,
    pub url: String,
}
method!(
    TripCreate,
    "trip.create",
    TripCreateParams,
    TripCreateResult
);

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PlaceSearchParams {
    pub query: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<TripLanguage>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PlaceSearchResult {
    pub places: Vec<PlaceMatch>,
}
method!(
    PlaceSearch,
    "place.search",
    PlaceSearchParams,
    PlaceSearchResult
);

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TripReadParams {
    pub select: ReadSelector,
}
method!(TripRead, "trip.read", TripReadParams, ReadResult);

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TripUpdateParams {
    pub expected: String,
    pub patch: TripPatch,
}
method!(
    TripUpdate,
    "trip.update",
    TripUpdateParams,
    Versioned<TripRecord>
);

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TripSetDatesParams {
    pub expected: String,
    pub start_date: String,
    pub end_date: String,
}
method!(
    TripSetDates,
    "trip.setDates",
    TripSetDatesParams,
    Versioned<TripRecord>
);

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TripChangeCurrencyParams {
    pub expected: String,
    pub currency: String,
}
method!(
    TripChangeCurrency,
    "trip.changeCurrency",
    TripChangeCurrencyParams,
    Versioned<TripRecord>
);

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemCreateParams {
    pub idempotency_key: String,
    pub item: ItemInput,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_choice: Option<TimeChoice>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemResult {
    pub record: ItemRecord,
    pub version: String,
    #[serde(default)]
    pub order_version: Option<String>,
}
method!(ItemCreate, "item.create", ItemCreateParams, ItemResult);

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemUpdateParams {
    pub id: String,
    pub expected: String,
    pub patch: ItemPatch,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_choice: Option<TimeChoice>,
}
method!(ItemUpdate, "item.update", ItemUpdateParams, ItemResult);

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemMoveParams {
    pub id: String,
    pub expected: String,
    pub order_expected: String,
    pub day_id: Option<String>,
    pub start_time: Option<String>,
    pub before_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_choice: Option<TimeChoice>,
}
method!(ItemMove, "item.move", ItemMoveParams, ItemResult);

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ItemReorderParams {
    pub expected: String,
    pub order: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ItemReorderResult {
    pub order: Vec<String>,
    pub version: String,
}
method!(
    ItemReorder,
    "item.reorder",
    ItemReorderParams,
    ItemReorderResult
);

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ItemRemoveParams {
    pub id: String,
    pub expected: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemRemoveResult {
    pub removed: bool,
    pub order_version: String,
}
method!(
    ItemRemove,
    "item.remove",
    ItemRemoveParams,
    ItemRemoveResult
);

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TripmateCreateParams {
    pub idempotency_key: String,
    pub id: String,
    pub name: String,
    pub color: String,
}
method!(
    TripmateCreate,
    "tripmate.create",
    TripmateCreateParams,
    Versioned<Tripmate>
);

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct TripmatePatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub archived: Option<bool>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TripmateUpdateParams {
    pub id: String,
    pub expected: String,
    pub patch: TripmatePatch,
}
method!(
    TripmateUpdate,
    "tripmate.update",
    TripmateUpdateParams,
    Versioned<Tripmate>
);

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RemoveParams {
    pub id: String,
    pub expected: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RemoveResult {
    pub removed: bool,
}
method!(
    TripmateRemove,
    "tripmate.remove",
    RemoveParams,
    RemoveResult
);

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpenseCreateParams {
    pub idempotency_key: String,
    pub expense: ExpenseInput,
}
method!(
    ExpenseCreate,
    "expense.create",
    ExpenseCreateParams,
    Versioned<ExpenseRecord>
);

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ExpenseUpdateParams {
    pub expected: String,
    pub expense: ExpenseInput,
}
method!(
    ExpenseUpdate,
    "expense.update",
    ExpenseUpdateParams,
    Versioned<ExpenseRecord>
);
method!(ExpenseRemove, "expense.remove", RemoveParams, RemoveResult);

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentCreateParams {
    pub idempotency_key: String,
    pub payment: PaymentInput,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub acknowledge_overpayment: Option<bool>,
}
method!(
    PaymentCreate,
    "payment.create",
    PaymentCreateParams,
    Versioned<PaymentRecord>
);

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentUpdateParams {
    pub expected: String,
    pub payment: PaymentInput,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub acknowledge_overpayment: Option<bool>,
}
method!(
    PaymentUpdate,
    "payment.update",
    PaymentUpdateParams,
    Versioned<PaymentRecord>
);
method!(PaymentRemove, "payment.remove", RemoveParams, RemoveResult);
