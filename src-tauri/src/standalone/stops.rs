// Complete bus data package: DB operations + API fetching
// #[command] is what make them visible to the frontend
use tauri::command;

use chrono::{DateTime, Duration, FixedOffset, Utc};
use dotenv::dotenv;
use reqwest::header::{HeaderMap, HeaderValue};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;

/// The main struct representing the entire API response.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct BusArrivalResponse {
    pub bus_stop_code: String,
    pub services: Vec<Service>,
}

/// Represents a single bus service with its next bus arrival times.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct Service {
    pub service_no: String,
    pub operator: String,
    pub next_bus: Option<NextBus>,
    pub next_bus2: Option<NextBus>,
    pub next_bus3: Option<NextBus>,
}

/// Represents the details for a single bus arrival.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "PascalCase")]
pub struct NextBus {
    pub origin_code: String,
    pub destination_code: String,
    pub estimated_arrival: String,
    pub monitored: u8,
    pub latitude: String,
    pub longitude: String,
    pub visit_number: String,
    pub load: String,
    pub feature: String,
    #[serde(rename = "Type")] // Handle a custom field name that is already PascalCase
    pub bus_type: String,
}

fn get_time_diff(estimated_arrival_str: String, now: DateTime<Utc>) -> Option<u32> {
    // Step 1: Parse the string into a DateTime object.
    // The `parse_from_rfc3339` function is perfect for this format.
    let estimated_arrival: DateTime<FixedOffset> =
        match DateTime::parse_from_rfc3339(&estimated_arrival_str) {
            Ok(dt) => dt,
            Err(e) => {
                eprintln!("Error parsing timestamp: {}", e);
                return None; // Exit if parsing fails
            }
        };

    let estimated_utc = estimated_arrival.with_timezone(&Utc);
    let duration_remaining: Duration = estimated_utc - now;

    if duration_remaining.num_seconds() > 0 {
        let total_seconds = duration_remaining.num_seconds();
        let minutes = total_seconds / 60;
        return Some(minutes as u32);
    } else {
        return Some(0 as u32);
    }
}


// Fetch bus-stop data from LTA API (database operations will be handled by frontend)
#[command]
pub async fn fetch_stop_data(bus_stop_code: String) -> Result<HashMap<String, Value>, String> {
    let client = Client::new();
    let mut headers = HeaderMap::new();
    let mut tbr: HashMap<String, Value> = HashMap::new();

    dotenv().map_err(|e| format!("Failed to load .env file: {}", e))?;
    let api_key = std::env::var("LTA_API_KEY")
        .map_err(|_| "LTA_API_KEY not found in .env file. Please add it to your .env file.".to_string())?;

    headers.insert("AccountKey", HeaderValue::from_str(&api_key).map_err(|e| e.to_string())?);

    let url = format!(
        "https://datamall2.mytransport.sg/ltaodataservice/v3/BusArrival?BusStopCode={}",
        bus_stop_code
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

    let now = Utc::now();

    let bus_response: BusArrivalResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse JSON: {}", e))?;

    for service in bus_response.services {
        let mut service_data = HashMap::new();
        let bus_arrivals = vec![
            service.next_bus,
            service.next_bus2,
            service.next_bus3,
        ];

        for (i, next_bus_option) in bus_arrivals.into_iter().enumerate() {
            if let Some(next_bus_data) = next_bus_option {
                if let Some(minutes) = get_time_diff(next_bus_data.estimated_arrival, now) {
                    let key = format!("next_bus{}", if i == 0 { "".to_string() } else { (i + 1).to_string() });
                    service_data.insert(
                        key,
                        json!({
                            "arrival_time": minutes,
                            "type": next_bus_data.bus_type,
                            "wheelchair_access": next_bus_data.feature == "WAB",
                            "capacity": next_bus_data.load
                        }),
                    );
                }
            }
        }
        
        tbr.insert(service.service_no, json!(service_data));
    }

    Ok(tbr)
}

// Note: Database operations (INSERT/SELECT) are handled by frontend with tauri-plugin-sql v2
// Backend only provides API data fetching

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::File;
    use std::io::Write;

    #[tokio::test]
    async fn test_fetch_stop_data() {
        let bus_stop_code = "1511".to_string();
        let result = fetch_stop_data(bus_stop_code.clone()).await;

        // Unwrap the successful result and serialize it
        let data = result.unwrap();
        let json_string = serde_json::to_string_pretty(&data).expect("Failed to serialize to JSON");

        // Write the JSON string to a file
        let mut file = File::create(format!("data/bus_stops_{}.json", bus_stop_code))
            .expect("Failed to create file");
        file.write_all(json_string.as_bytes())
            .expect("Failed to write to file");

        println!("Successfully wrote bus data to bus_data.json");
    }
}
