use proxius_db::Db;

use crate::hub::Hub;

/// State bersama aplikasi.
#[derive(Clone)]
pub struct AppState {
    pub pool: Db,
    pub hub: Hub,
}
