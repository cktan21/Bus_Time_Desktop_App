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

    // Fetch data from Rust backend and store in database
    async fetchAndStoreBusData() {
        try {
            console.log('Fetching bus data from backend...');

            // Call Rust backend to fetch from LTA API
            const busStopsData = await invoke('fetch_bus_data_from_api');
            const busStopCount = Object.keys(busStopsData).length;
            console.log(`Received ${busStopCount} bus stops from backend`);

            // Begin transaction for batch insert
            await this.db.execute('BEGIN TRANSACTION');

            try {
                // Prepare statements for efficient bulk insertion
                const insertStopStmt = 'INSERT INTO bus_stops (id, road_name, description, latitude, longitude) VALUES (?, ?, ?, ?, ?)';
                const insertRouteStmt = 'INSERT INTO bus_routes (bus_stop_id, bus_number, operator, stop_seq) VALUES (?, ?, ?, ?)';
                const insertTimeStmt = 'INSERT INTO bus_times (bus_route_id, day_of_week, first_bus, last_bus) VALUES (?, ?, ?, ?)';
                
                for (const busStopCode in busStopsData) {
                    if (busStopsData.hasOwnProperty(busStopCode)) {
                        const stopData = busStopsData[busStopCode];

                        // Insert into bus_stops table
                        await this.db.execute(insertStopStmt, [
                            parseInt(busStopCode, 10),
                            stopData.road_name,
                            stopData.desc,
                            stopData.latitude,
                            stopData.longitude,
                        ]);

                        // Find the ID of the newly inserted bus stop to use as foreign key
                        const busStopResult = await this.db.select('SELECT id FROM bus_stops WHERE id = ?', [busStopCode]);
                        const busStopDbId = busStopResult[0]?.id;

                        // Iterate over the buses at this stop
                        for (const busNumber in stopData.buses) {
                            if (stopData.buses.hasOwnProperty(busNumber)) {
                                const busRouteData = stopData.buses[busNumber];

                                // Insert into bus_routes table
                                await this.db.execute(insertRouteStmt, [
                                    busStopDbId,
                                    busNumber,
                                    busRouteData.operator,
                                    busRouteData.stop_seq,
                                ]);

                                // Find the ID of the newly inserted bus route
                                const busRouteResult = await this.db.select('SELECT id FROM bus_routes WHERE bus_stop_id = ? AND bus_number = ?', [busStopDbId, busNumber]);
                                const busRouteDbId = busRouteResult[0]?.id;

                                // Iterate over the days and insert into bus_times
                                const days = { 'wd_flb': 'wd', 'sat_flb': 'sat', 'sun_flb': 'sun' };
                                for (const jsonKey in days) {
                                    if (busRouteData.hasOwnProperty(jsonKey)) {
                                        const times = busRouteData[jsonKey];
                                        if (times && times.fb && times.lb) {
                                            await this.db.execute(insertTimeStmt, [
                                                busRouteDbId,
                                                days[jsonKey],
                                                times.fb,
                                                times.lb,
                                            ]);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }

                // Commit transaction
                await this.db.execute('COMMIT');
                console.log(`Successfully stored ${busStopCount} bus stops and related data in database`);

                return busStopCount;

            } catch (insertError) {
                // Rollback transaction on error
                console.error('Database transaction failed, rolling back:', insertError);
                await this.db.execute('ROLLBACK');
                throw insertError;
            }

        } catch (error) {
            console.error('Failed to fetch and store bus data:', error);
            throw error;
        }
    }

    // --- The rest of your code remains the same ---
    async searchBusStops(query) {
        if (!query || query.length < 2) {
            return [];
        }
        const searchTerm = `%${query}%`;
        const result = await this.db.select(
            `SELECT id, road_name, description, latitude, longitude 
             FROM bus_stops 
             WHERE id LIKE $1 OR description LIKE $2 OR road_name LIKE $3
             ORDER BY road_name
             LIMIT 50`,
            [searchTerm, searchTerm, searchTerm]
        );
        return result;
    }

    async getBusStopInfo(busStopCode) {
        const result = await this.db.select(
            'SELECT * FROM bus_stops WHERE id = ?',
            [busStopCode]
        );
        return result[0] || null;
    }

    async getAllBusStopCodes() {
        const result = await this.db.select(
            'SELECT id FROM bus_stops ORDER BY id'
        );
        return result.map(row => row.id);
    }

    async getNearbyBusStops(userLat, userLng, radiusKm = 1.0) {
        const result = await this.db.select(
            `SELECT *,
             (6371 * acos(
                 cos(radians(?)) * cos(radians(latitude)) * cos(radians(longitude) - radians(?)) + 
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

    async refreshData() {
        console.log('Refreshing bus stop data...');
        await this.db.execute('DELETE FROM bus_times');
        await this.db.execute('DELETE FROM bus_routes');
        await this.db.execute('DELETE FROM bus_stops');
        const count = await this.fetchAndStoreBusData();
        console.log(`Data refresh complete: ${count} bus stops updated`);
        return count;
    }
}