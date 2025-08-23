// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
mod standalone;

use standalone::bus;

// Default Command 
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::new()
                .add_migrations("sqlite:bus_data.db", bus::get_migrations()) // This is what builds the database
                .build(),
        )
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            // bus::init_bus_database,
            bus::fetch_bus_data_from_api
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
