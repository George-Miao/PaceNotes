use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

macro_rules! wire_enum {
    ($name:ident, $rename:literal, {$($variant:ident $(=> $wire:literal)?),+ $(,)?}) => {
        #[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize, Deserialize)]
        #[serde(rename_all = $rename)]
        pub enum $name {
            $($(#[serde(rename = $wire)])? $variant),+
        }
    };
}

wire_enum!(ItemType, "lowercase", { Place, Note, Reservation, Lodging, Transport });
wire_enum!(TravelMode, "SCREAMING_SNAKE_CASE", { Driving, Transit, Walking });
wire_enum!(TransportMode, "lowercase", { Plane, Train, Bus, Ferry, Custom });
wire_enum!(TripLanguage, "lowercase", { En, ZhCn => "zh-CN", ZhTw => "zh-TW", Ja, De, Es, Fr, It });
wire_enum!(DistanceUnit, "lowercase", { Metric, Imperial });
wire_enum!(TimeChoice, "lowercase", { Earlier, Later });
wire_enum!(ExpenseCategory, "lowercase", { Food, Transport, Lodging, Activities, Shopping, Fees, Other });

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaceReference {
    pub place_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaceMatch {
    pub place_id: String,
    pub display_name: String,
    pub formatted_address: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Reservation {
    pub provider: String,
    pub confirmation: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Lodging {
    pub start_date: String,
    pub end_date: String,
    pub leave_times: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Transport {
    pub from: Option<PlaceReference>,
    pub to: Option<PlaceReference>,
    pub mode: TransportMode,
    pub custom_mode: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemInput {
    pub id: String,
    #[serde(rename = "type")]
    pub item_type: ItemType,
    pub title: String,
    pub details: String,
    pub day_id: Option<String>,
    pub start_time: Option<String>,
    pub duration_minutes: u32,
    pub place: Option<PlaceReference>,
    pub reservation: Option<Reservation>,
    pub lodging: Option<Lodging>,
    pub transport: Option<Transport>,
    pub travel_mode: TravelMode,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemRecord {
    #[serde(flatten)]
    pub item: ItemInput,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub time_choice: Option<TimeChoice>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemPatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub start_time: Option<Option<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_minutes: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub place: Option<Option<PlaceReference>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reservation: Option<Option<Reservation>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lodging: Option<Option<Lodging>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub transport: Option<Option<Transport>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub travel_mode: Option<TravelMode>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TripPatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destination: Option<PlaceReference>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub time_zone: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub trip_language: Option<Option<TripLanguage>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub distance_unit: Option<DistanceUnit>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default_travel_mode: Option<TravelMode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub calendar_start_hour: Option<u8>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TripRecord {
    pub id: String,
    pub title: String,
    pub start_date: String,
    pub end_date: String,
    pub time_zone: String,
    pub destination: PlaceReference,
    pub trip_language: Option<TripLanguage>,
    pub distance_unit: DistanceUnit,
    pub default_travel_mode: TravelMode,
    pub calendar_start_hour: u8,
    pub currency: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TripDay {
    pub id: String,
    pub date: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Tripmate {
    pub id: String,
    pub name: String,
    pub color: String,
    pub archived: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Split {
    Payer,
    Equal {
        #[serde(rename = "friendIds")]
        friend_ids: Vec<String>,
    },
    Exact {
        shares: BTreeMap<String, i64>,
    },
    Mixed {
        #[serde(rename = "friendIds")]
        friend_ids: Vec<String>,
        shares: BTreeMap<String, i64>,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conversion {
    pub amount_minor: i64,
    pub rate: f64,
    pub requested_date: Option<String>,
    pub observed_date: String,
    pub source: String,
    pub stale: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExpenseInput {
    pub id: String,
    pub description: String,
    pub category: ExpenseCategory,
    pub amount_minor: i64,
    pub currency: String,
    pub payer_id: String,
    pub split: Split,
    pub item_id: Option<String>,
    pub date: Option<String>,
    pub follows_item_date: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ExpenseRecord {
    #[serde(flatten)]
    pub expense: ExpenseInput,
    pub conversion: Conversion,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentInput {
    pub id: String,
    pub from_id: String,
    pub to_id: String,
    pub amount_minor: i64,
    pub currency: String,
    pub note: String,
    pub paid_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PaymentRecord {
    #[serde(flatten)]
    pub payment: PaymentInput,
    pub conversion: Conversion,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Snapshot {
    #[serde(flatten)]
    pub trip: TripRecord,
    pub days: Vec<TripDay>,
    pub order: Vec<String>,
    pub items: BTreeMap<String, ItemRecord>,
    pub friends: BTreeMap<String, Tripmate>,
    pub expenses: BTreeMap<String, ExpenseRecord>,
    pub settlements: BTreeMap<String, PaymentRecord>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct RecordVersions {
    pub trip: String,
    pub order: String,
    pub items: BTreeMap<String, String>,
    pub tripmates: BTreeMap<String, String>,
    pub expenses: BTreeMap<String, String>,
    pub payments: BTreeMap<String, String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Versioned<T> {
    pub record: T,
    pub version: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ReadSelector {
    Snapshot,
    Items {
        #[serde(rename = "dayId", skip_serializing_if = "Option::is_none")]
        day_id: Option<Option<String>>,
        #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
        item_type: Option<ItemType>,
        #[serde(skip_serializing_if = "Option::is_none")]
        limit: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cursor: Option<String>,
    },
    Item {
        id: String,
    },
    Tripmates {
        #[serde(skip_serializing_if = "Option::is_none")]
        limit: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cursor: Option<String>,
    },
    Tripmate {
        id: String,
    },
    Expenses {
        #[serde(skip_serializing_if = "Option::is_none")]
        date: Option<Option<String>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        limit: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cursor: Option<String>,
    },
    Expense {
        id: String,
    },
    Payments {
        #[serde(skip_serializing_if = "Option::is_none")]
        limit: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        cursor: Option<String>,
    },
    Payment {
        id: String,
    },
    Finance,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ReadResult {
    Snapshot {
        snapshot: Snapshot,
        versions: RecordVersions,
    },
    Items {
        records: Vec<Versioned<ItemRecord>>,
        #[serde(rename = "nextCursor")]
        next_cursor: Option<String>,
    },
    Item {
        record: ItemRecord,
        version: String,
    },
    Tripmates {
        records: Vec<Versioned<Tripmate>>,
        #[serde(rename = "nextCursor")]
        next_cursor: Option<String>,
    },
    Tripmate {
        record: Tripmate,
        version: String,
    },
    Expenses {
        records: Vec<Versioned<ExpenseRecord>>,
        #[serde(rename = "nextCursor")]
        next_cursor: Option<String>,
    },
    Expense {
        record: ExpenseRecord,
        version: String,
    },
    Payments {
        records: Vec<Versioned<PaymentRecord>>,
        #[serde(rename = "nextCursor")]
        next_cursor: Option<String>,
    },
    Payment {
        record: PaymentRecord,
        version: String,
    },
    Finance {
        currency: String,
        balances: BTreeMap<String, i64>,
        suggestions: Vec<PaymentSuggestion>,
    },
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaymentSuggestion {
    pub from_id: String,
    pub to_id: String,
    pub amount_minor: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TripChange {
    pub trip: bool,
    pub order: bool,
    pub items: Vec<String>,
    pub tripmates: Vec<String>,
    pub expenses: Vec<String>,
    pub payments: Vec<String>,
}
