import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';

export class BusService {
    constructor() {
        this.db = null;
    }

    // Initialize database and populate if needed
    async init() {
        try {
            // Connect to SQLite database (migrations run automatically)
            this.db = await Database.load('sqlite:bus_data.db');
            console.log('Database connected successfully');

            // Check if we need to populate the database
            const result = await this.ensureDataPopulated();

            return {
                success: true,
                message: result.message
            };

        } catch (error) {
            console.error('Failed to initialize bus service:', error);
            return {
                success: false,
                message: error.toString()
            };
        }
    }

    // Check if database has data and populate if needed
    async ensureDataPopulated() {
        try {
            // Check how many bus stops we have
            const countResult = await this.db.select('SELECT COUNT(*) as count FROM bus_stops');
            const count = countResult[0]?.count || 0;

            if (count === 0) {
                console.log('No bus stops found, fetching from API...');
                const newCount = await this.fetchAndStoreBusData();
                return {
                    success: true,
                    message: `Successfully loaded ${newCount} bus stops from API`
                };
            } else {
                console.log(`Database already contains ${count} bus stops`);
                return {
                    success: true,
                    message: `Database loaded with ${count} existing bus stops`
                };
            }

        } catch (error) {
            console.error('Failed to check/populate data:', error);
            throw error;
        }
    }

    // Fetch data from LTA API (via Rust backend) and store in database (frontend)
    async fetchAndStoreBusData() {
        try {
            console.log('Fetching bus data from LTA API...');

            // Call Rust backend to fetch from LTA API
            const busStops = await invoke('fetch_bus_data_from_api');
            console.log(`Received ${busStops.length} bus stops from API`);

            // Begin transaction for batch insert
            await this.db.execute('BEGIN TRANSACTION');

            try {
                // Insert all bus stops
                for (const busStop of busStops) {
                    await this.db.execute(
                        `INSERT OR REPLACE INTO bus_stops 
                         (bus_stop_code, road_name, description, latitude, longitude)
                         VALUES (?, ?, ?, ?, ?)`,
                        [
                            busStop.BusStopCode,
                            busStop.RoadName,
                            busStop.Description,
                            busStop.Latitude,
                            busStop.Longitude
                        ]
                    );
                }

                // Commit transaction
                await this.db.execute('COMMIT');
                console.log(`Successfully stored ${busStops.length} bus stops in database`);

                return busStops.length;

            } catch (insertError) {
                // Rollback transaction on error
                await this.db.execute('ROLLBACK');
                throw insertError;
            }

        } catch (error) {
            console.error('Failed to fetch and store bus data:', error);
            throw error;
        }
    }

    // Search bus stops by query
    async searchBusStops(query) {
        if (!query || query.length < 2) {
            return [];
        }

        const searchTerm = `%${query}%`;

        //replace the ? with $# ($1, $2, $3) if smth screws up with the query
        const result = await this.db.select( 
            `SELECT bus_stop_code, road_name, description, latitude, longitude 
             FROM bus_stops 
             WHERE bus_stop_code LIKE $1 OR description LIKE $2 OR road_name LIKE $3
             ORDER BY road_name
             LIMIT 50`,
            [searchTerm, searchTerm, searchTerm]
        );

        return result;
    }

    // Get specific bus stop info
    async getBusStopInfo(busStopCode) {
        const result = await this.db.select(
            'SELECT * FROM bus_stops WHERE bus_stop_code = ?',
            [busStopCode]
        );

        return result[0] || null;
    }

    // Get all bus stop codes
    async getAllBusStopCodes() {
        const result = await this.db.select(
            'SELECT bus_stop_code FROM bus_stops ORDER BY bus_stop_code'
        );

        return result.map(row => row.bus_stop_code);
    }

    // Get nearby bus stops (requires latitude/longitude)
    async getNearbyBusStops(userLat, userLng, radiusKm = 1.0) {
        // Simple distance calculation using Haversine formula
        const result = await this.db.select(
            `SELECT *,
             (6371 * acos(
                 cos(radians(?)) * cos(radians(latitude)) * 
                 cos(radians(longitude) - radians(?)) + 
                 sin(radians(?)) * sin(radians(latitude))
             )) AS distance_km
             FROM bus_stops 
             HAVING distance_km <= ?
             ORDER BY distance_km
             LIMIT 20`,
            [userLat, userLng, userLat, radiusKm]
        );

        return result;
    }

    // Refresh data from API
    async refreshData() {
        console.log('Refreshing bus stop data...');

        // Clear existing data
        await this.db.execute('DELETE FROM bus_stops');

        // Fetch and store new data
        const count = await this.fetchAndStoreBusData();

        console.log(`Data refresh complete: ${count} bus stops updated`);
        return count;
    }
}