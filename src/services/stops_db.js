import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';

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

    // Function to emit loading bar updates
    emitLoadingBar(current, total) {
        const progress = current / total;
        const percentage = Math.round(progress * 100);
        emit('loading_progress', { percentage, current, total });
    }
    
    chunkArray(arr, size) {
        const chunkedArr = [];
        for (let i = 0; i < arr.length; i += size) {
            chunkedArr.push(arr.slice(i, i + size));
        }
        return chunkedArr;
    }


    async fetchAndStoreBusData() {
        try {
            console.log('Fetching bus data from backend...');
            const busStopsData = await invoke('fetch_bus_data_from_api');
            const busStopCount = Object.keys(busStopsData).length;
            console.log(`Received ${busStopCount} bus stops from backend`);
            await this.db.execute('BEGIN TRANSACTION');

            try {
                const days = { 'wd_flb': 'wd', 'sat_flb': 'sat', 'sun_flb': 'sun' };
                const stopsToInsert = [];
                const routesToInsert = [];
                const timesToInsert = [];

                let processedCount = 0;
                const totalStops = busStopCount;
                console.log('Starting data processing and batching...');

                for (const busStopCode in busStopsData) {
                    if (busStopsData.hasOwnProperty(busStopCode)) {
                        const stopData = busStopsData[busStopCode];
                        processedCount++;

                        // Emit the progress to the frontend instead of using process.stdout.write
                        // this.emitLoadingBar(processedCount, totalStops);

                        stopsToInsert.push([
                            parseInt(busStopCode, 10),
                            stopData.road_name,
                            stopData.desc,
                            stopData.latitude,
                            stopData.longitude,
                        ]);

                        for (const busNumber in stopData.buses) {
                            if (stopData.buses.hasOwnProperty(busNumber)) {
                                const busRouteData = stopData.buses[busNumber];
                                const routeId = `${busStopCode}-${busNumber}`;

                                routesToInsert.push([
                                    routeId,
                                    parseInt(busStopCode, 10),
                                    busNumber,
                                    busRouteData.operator,
                                    busRouteData.stop_seq,
                                ]);

                                for (const jsonKey in days) {
                                    if (busRouteData.hasOwnProperty(jsonKey)) {
                                        const times = busRouteData[jsonKey];
                                        if (times && times.fb && times.lb) {
                                            timesToInsert.push([
                                                routeId,
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

                // Create and execute a single multi-row INSERT statement for each table
                // Batch insert into bus_stops
                const stopChunks = this.chunkArray(stopsToInsert, 500);
                for (const chunk of stopChunks) {
                    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?)').join(', ');
                    const params = chunk.flat();
                    await this.db.execute(`INSERT INTO bus_stops (bus_stop_id, road_name, description, latitude, longitude) VALUES ${placeholders}`, params);
                }

                // Batch insert into bus_routes
                const routeChunks = this.chunkArray(routesToInsert, 500);
                for (const chunk of routeChunks) {
                    const placeholders = chunk.map(() => '(?, ?, ?, ?, ?)').join(', ');
                    const params = chunk.flat();
                    await this.db.execute(`INSERT INTO bus_routes (route_id, bus_stop_id, bus_number, operator, stop_seq) VALUES ${placeholders}`, params);
                }

                // Batch insert into bus_times
                const timeChunks = this.chunkArray(timesToInsert, 500);
                for (const chunk of timeChunks) {
                    const placeholders = chunk.map(() => '(?, ?, ?, ?)').join(', ');
                    const params = chunk.flat();
                    await this.db.execute(`INSERT INTO bus_times (route_id, day_of_week, first_bus, last_bus) VALUES ${placeholders}`, params);
                }

                // Commit Transaction
                await this.db.execute('COMMIT');
                console.log(`Successfully stored ${busStopCount} bus stops and related data in database`);
                return busStopCount;

            } catch (insertError) {
                console.error('\nDatabase transaction failed, rolling back:', insertError);
                await this.db.execute('ROLLBACK');
                throw insertError;
            }
        } catch (error) {
            console.error('\nFailed to fetch and store bus data:', error);
            throw error;
        }
    }

    async searchBusStops(query) {
        if (!query || query.length < 2) {
            return [];
        }
        const searchTerm = `%${query}%`;
        const result = await this.db.select(
            `SELECT bus_stop_id, road_name, description, latitude, longitude 
            FROM bus_stops 
            WHERE bus_stop_id LIKE $1 OR description LIKE $2 OR road_name LIKE $3
            ORDER BY road_name
            LIMIT 50`,
            [searchTerm, searchTerm, searchTerm]
        );
        return result;
    }

    async getBusStopInfo(busStopCode) {
        const result = await this.db.select(
            'SELECT * FROM bus_stops WHERE bus_stop_id = ?',
            [busStopCode]
        );
        return result[0] || null;
    }

    async getAllBusStopCodes() {
        const result = await this.db.select(
            'SELECT bus_stop_id FROM bus_stops ORDER BY bus_stop_id'
        );
        return result.map(row => row.bus_stop_id);
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