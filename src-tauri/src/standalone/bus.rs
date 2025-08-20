// Complete bus data package: DB operations + API fetching
// #[command] is what make them visible to the frontend
use dotenv::dotenv;
use reqwest::header::{HeaderMap, HeaderValue};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use tauri::command;
use tauri_plugin_sql::{Migration, MigrationKind};

// API Response structures
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct BusResponse {
    pub value: Vec<BusData>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "PascalCase")]
pub struct BusData {
    pub bus_stop_code: String,
    pub road_name: String,
    pub description: String,
    pub latitude: f64,
    pub longitude: f64,
}

// Creates Database Table
pub fn get_migrations() -> Vec<Migration> {
    vec![Migration {
        version: 1,
        description: "create bus stops table",
        sql: r#"
            CREATE TABLE IF NOT EXISTS bus_stops (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                bus_stop_code TEXT NOT NULL UNIQUE,
                road_name TEXT NOT NULL,
                description TEXT NOT NULL,
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            CREATE INDEX IF NOT EXISTS idx_bus_stop_code ON bus_stops(bus_stop_code);
        "#,
        kind: MigrationKind::Up,
    }]
}

// Fetch bus-stop data from LTA API (database operations will be handled by frontend)
#[command]
pub async fn fetch_bus_data_from_api() -> Result<Vec<BusData>, String> {
    let client = Client::new();
    let mut headers = HeaderMap::new();

    // Load .env file and get API key
    dotenv().map_err(|e| format!("Failed to load .env file: {}", e))?;
    let api_key = std::env::var("LTA_API_KEY").map_err(|_| {
        "LTA_API_KEY not found in .env file. Please add it to your .env file.".to_string()
    })?;

    headers.insert(
        "AccountKey",
        HeaderValue::from_str(&api_key).map_err(|e| e.to_string())?,
    );

    let mut all_bus_stops = Vec::new();
    let mut skip = 0;
    const BATCH_SIZE: usize = 500;

    // LTA API uses pagination
    loop {
        let url = format!(
            "https://datamall2.mytransport.sg/ltaodataservice/BusStops?$skip={}",
            skip
        );

        let response = client
            .get(&url)
            .headers(headers.clone())
            .send()
            .await
            .map_err(|e| format!("API request failed: {}", e))?;

        if !response.status().is_success() {
            return Err(format!("API returned error: {}", response.status()));
        }

        let bus_response: BusResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse JSON: {}", e))?;

        let batch_size = bus_response.value.len();
        all_bus_stops.extend(bus_response.value);

        // If we got less than expected, we've reached the end
        if batch_size < BATCH_SIZE {
            break;
        }

        skip += BATCH_SIZE;
    }

    Ok(all_bus_stops)
}

// Note: Database operations (INSERT/SELECT) are handled by frontend with tauri-plugin-sql v2
// Backend only provides API data fetching
