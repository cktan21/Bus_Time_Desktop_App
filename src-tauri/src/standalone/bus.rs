// Complete bus data package: DB operations + API fetching
// #[command] is what make them visible to the frontend
use tauri::command;
use tauri::http::response;
use tauri_plugin_sql::{Migration, MigrationKind};

use reqwest::header::{HeaderMap, HeaderValue};
use reqwest::Client;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use std::collections::HashMap;

use dotenv::dotenv;

// API Response structures
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct BusStopResponse {
    pub value: Vec<BusStopData>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "PascalCase")]
pub struct BusStopData {
    pub bus_stop_code: String,
    pub road_name: String,
    pub description: String,
    pub latitude: f64,
    pub longitude: f64,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct BusRouteResponse {
    pub value: Vec<BusRouteData>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct BusRouteData {
    #[serde(rename = "ServiceNo")]
    pub service_no: String,
    #[serde(rename = "Operator")]
    pub operator: String,
    #[serde(rename = "Direction")]
    pub direction: u32,
    #[serde(rename = "StopSequence")]
    pub stop_sequence: u32,
    #[serde(rename = "BusStopCode")]
    pub bus_stop_code: String,
    #[serde(rename = "Distance")]
    pub distance: f32,
    #[serde(rename = "WD_FirstBus")]
    pub wd_first_bus: String,
    #[serde(rename = "WD_LastBus")]
    pub wd_last_bus: String,
    #[serde(rename = "SAT_FirstBus")]
    pub sat_first_bus: String,
    #[serde(rename = "SAT_LastBus")]
    pub sat_last_bus: String,
    #[serde(rename = "SUN_FirstBus")]
    pub sun_first_bus: String,
    #[serde(rename = "SUN_LastBus")]
    pub sun_last_bus: String,
}

// Response Structs
#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct TbrOuter {
    pub road_name: String,
    pub desc: String,
    pub latitude: f64,
    pub longitude: f64,
    pub buses: HashMap<String, TbrInner>,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
pub struct TbrInner {
    pub operator: String,
    pub stop_seq: u32,
    pub wd_flb: Value,
    pub sat_flb: Value,
    pub sun_flb: Value,
}

// Creates Database Table
pub fn get_migrations() -> Vec<Migration> {
    vec![
        // Migration 1: Create the bus_stops table.
        Migration {
            version: 1,
            description: "create bus_stops, bus_route, bus_times tables",
            sql: r#"
                CREATE TABLE IF NOT EXISTS bus_stops (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    road_name TEXT,
                    description TEXT,
                    latitude REAL,
                    longitude REAL
                );
                CREATE TABLE IF NOT EXISTS bus_routes (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    bus_stop_id INTEGER NOT NULL,
                    bus_number TEXT NOT NULL,
                    operator TEXT,
                    stop_seq INTEGER,
                    FOREIGN KEY (bus_stop_id) REFERENCES bus_stops(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS bus_times (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    bus_route_id INTEGER NOT NULL,
                    day_of_week TEXT,
                    first_bus TEXT,
                    last_bus TEXT,
                    FOREIGN KEY (bus_route_id) REFERENCES bus_routes(id) ON DELETE CASCADE
                );
            "#,
            kind: MigrationKind::Up,
        }
    ]
}

// Fetch bus-stop data from LTA API (database operations will be handled by frontend)
#[command]
pub async fn fetch_bus_data_from_api() -> Result<HashMap<String, TbrOuter>, String> {
    let client = Client::new();
    let mut headers = HeaderMap::new();
    let mut tbr: HashMap<String, TbrOuter> = HashMap::new();

    // Load .env file and get API key
    dotenv().map_err(|e| format!("Failed to load .env file: {}", e))?;
    let api_key = std::env::var("LTA_API_KEY").map_err(|_| {
        "LTA_API_KEY not found in .env file. Please add it to your .env file.".to_string()
    })?;

    headers.insert(
        "AccountKey",
        HeaderValue::from_str(&api_key).map_err(|e| e.to_string())?,
    );

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

        let bus_response: BusStopResponse = response
            .json()
            .await
            .map_err(|e| format!("Failed to parse JSON: {}", e))?;

        let batch_size = bus_response.value.len();

        for bus_stop in bus_response.value {
            tbr.insert(
                bus_stop.bus_stop_code,
                TbrOuter {
                    road_name: bus_stop.road_name,
                    desc: bus_stop.description,
                    latitude: bus_stop.latitude,
                    longitude: bus_stop.longitude,
                    buses: HashMap::new(),
                },
            );
        }

        // If we got less than expected, we've reached the end
        if batch_size < BATCH_SIZE {
            break;
        }

        skip += BATCH_SIZE;
    }

    skip = 0;

    loop {
        let url = format!(
            "https://datamall2.mytransport.sg/ltaodataservice/BusRoutes?$skip={}",
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

        let body_text = response.text().await
            .map_err(|e| format!("Failed to read response body: {}", e))?;
        
        let bus_route_response: BusRouteResponse = serde_json::from_str(&body_text)
            .map_err(|e| format!("Failed to parse JSON: {} | Body: {}", e, body_text))?;


        let batch_size = bus_route_response.value.len();

        for bus_route in bus_route_response.value {
            let bus_code = bus_route.bus_stop_code;
            let bus_number = bus_route.service_no;
            if let Some(tbr_outer) = tbr.get_mut(&bus_code) {
                tbr_outer.buses.insert(
                    bus_number,
                    TbrInner {
                        operator: bus_route.operator,
                        stop_seq: bus_route.stop_sequence,
                        wd_flb: json! ({
                            "fb": bus_route.wd_first_bus,
                            "lb": bus_route.wd_last_bus
                        }),
                        sat_flb: json! ({
                            "fb": bus_route.sat_first_bus,
                            "lb": bus_route.sat_last_bus
                        }),
                        sun_flb: json! ({
                            "fb": bus_route.sun_first_bus,
                            "lb": bus_route.sun_last_bus
                        }),
                    },
                );
            }
        }

        // If we got less than expected, we've reached the end
        if batch_size < BATCH_SIZE {
            break;
        }

        skip += BATCH_SIZE;
    }

    Ok(tbr)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;

    #[tokio::test]
    async fn test_fetch_bus_data() {
        let result = fetch_bus_data_from_api().await;

        // Unwrap the successful result and serialize it
        let data = result.unwrap();
        let json_string = serde_json::to_string_pretty(&data)
            .expect("Failed to serialize to JSON");

        // Write the JSON string to a file
        let mut file = File::create("data/bus_data.json")
            .expect("Failed to create file");
        file.write_all(json_string.as_bytes())
            .expect("Failed to write to file");

        println!("Successfully wrote bus data to bus_data.json");
    }
}