//! Typed PaceNotes v1 JSON-RPC clients. Enable `reqwest` for Tokio or `cyper` for Compio.
//! Clients do not retry writes or retain a trip snapshot. After reconnect, call `trip.read`.

// Both clients expose the same named methods and a generic call::<Method> entry point.
// Each named method accepts its complete by-name JSON-RPC params object.
#[cfg(any(feature = "reqwest", feature = "cyper"))]
macro_rules! client_methods {
    () => {
        pub async fn trip_create(
            &self,
            params: TripCreateParams,
        ) -> Result<TripCreateResult, Error> {
            self.call::<TripCreate>(params).await
        }
        pub async fn place_search(
            &self,
            params: PlaceSearchParams,
        ) -> Result<PlaceSearchResult, Error> {
            self.call::<PlaceSearch>(params).await
        }
        pub async fn trip_read(&self, params: TripReadParams) -> Result<ReadResult, Error> {
            self.call::<TripRead>(params).await
        }
        pub async fn trip_update(
            &self,
            params: TripUpdateParams,
        ) -> Result<Versioned<TripRecord>, Error> {
            self.call::<TripUpdate>(params).await
        }
        pub async fn trip_set_dates(
            &self,
            params: TripSetDatesParams,
        ) -> Result<Versioned<TripRecord>, Error> {
            self.call::<TripSetDates>(params).await
        }
        pub async fn trip_change_currency(
            &self,
            params: TripChangeCurrencyParams,
        ) -> Result<Versioned<TripRecord>, Error> {
            self.call::<TripChangeCurrency>(params).await
        }
        pub async fn item_create(&self, params: ItemCreateParams) -> Result<ItemResult, Error> {
            self.call::<ItemCreate>(params).await
        }
        pub async fn item_update(&self, params: ItemUpdateParams) -> Result<ItemResult, Error> {
            self.call::<ItemUpdate>(params).await
        }
        pub async fn item_move(&self, params: ItemMoveParams) -> Result<ItemResult, Error> {
            self.call::<ItemMove>(params).await
        }
        pub async fn item_reorder(
            &self,
            params: ItemReorderParams,
        ) -> Result<ItemReorderResult, Error> {
            self.call::<ItemReorder>(params).await
        }
        pub async fn item_remove(
            &self,
            params: ItemRemoveParams,
        ) -> Result<ItemRemoveResult, Error> {
            self.call::<ItemRemove>(params).await
        }
        pub async fn tripmate_create(
            &self,
            params: TripmateCreateParams,
        ) -> Result<Versioned<Tripmate>, Error> {
            self.call::<TripmateCreate>(params).await
        }
        pub async fn tripmate_update(
            &self,
            params: TripmateUpdateParams,
        ) -> Result<Versioned<Tripmate>, Error> {
            self.call::<TripmateUpdate>(params).await
        }
        pub async fn tripmate_remove(&self, params: RemoveParams) -> Result<RemoveResult, Error> {
            self.call::<TripmateRemove>(params).await
        }
        pub async fn expense_create(
            &self,
            params: ExpenseCreateParams,
        ) -> Result<Versioned<ExpenseRecord>, Error> {
            self.call::<ExpenseCreate>(params).await
        }
        pub async fn expense_update(
            &self,
            params: ExpenseUpdateParams,
        ) -> Result<Versioned<ExpenseRecord>, Error> {
            self.call::<ExpenseUpdate>(params).await
        }
        pub async fn expense_remove(&self, params: RemoveParams) -> Result<RemoveResult, Error> {
            self.call::<ExpenseRemove>(params).await
        }
        pub async fn payment_create(
            &self,
            params: PaymentCreateParams,
        ) -> Result<Versioned<PaymentRecord>, Error> {
            self.call::<PaymentCreate>(params).await
        }
        pub async fn payment_update(
            &self,
            params: PaymentUpdateParams,
        ) -> Result<Versioned<PaymentRecord>, Error> {
            self.call::<PaymentUpdate>(params).await
        }
        pub async fn payment_remove(&self, params: RemoveParams) -> Result<RemoveResult, Error> {
            self.call::<PaymentRemove>(params).await
        }
    };
}
mod domain;
mod rpc;
mod wire;

pub use domain::*;
pub use rpc::*;
pub use wire::{Conflict, Error, RpcCode, RpcError};

#[cfg(feature = "cyper")]
pub mod cyper_client;
#[cfg(feature = "reqwest")]
pub mod reqwest_client;
#[cfg(feature = "cyper")]
pub use cyper_client::Client as CyperClient;
#[cfg(feature = "reqwest")]
pub use reqwest_client::Client as ReqwestClient;

#[cfg(any(feature = "reqwest", feature = "cyper"))]
mod sse;
