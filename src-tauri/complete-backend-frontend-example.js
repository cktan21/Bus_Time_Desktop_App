// Complete Example: Backend API + Frontend Database with Tauri SQL Plugin v2
import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/tauri';

class BusService {
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
            await this.ensureDataPopulated();

        } catch (error) {
            console.error('Failed to initialize bus service:', error);
            throw error;
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
                await this.fetchAndStoreBusData();
            } else {
                console.log(`Database already contains ${count} bus stops`);
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
                            busStop.bus_stop_code,
                            busStop.road_name,
                            busStop.description,
                            busStop.latitude,
                            busStop.longitude
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

        const result = await this.db.select(
            `SELECT bus_stop_code, road_name, description, latitude, longitude 
             FROM bus_stops 
             WHERE bus_stop_code LIKE ? OR description LIKE ? OR road_name LIKE ?
             ORDER BY bus_stop_code
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

// Vue Composition API Example
import { ref, onMounted } from 'vue';

export function useBusService() {
    const busService = ref(null);
    const isLoading = ref(false);
    const error = ref(null);
    const busStops = ref([]);
    const searchQuery = ref('');

    onMounted(async () => {
        try {
            isLoading.value = true;
            busService.value = new BusService();
            await busService.value.init();
        } catch (err) {
            error.value = err.message;
            console.error('Failed to initialize bus service:', err);
        } finally {
            isLoading.value = false;
        }
    });

    const searchBusStops = async () => {
        if (!busService.value || !searchQuery.value) {
            busStops.value = [];
            return;
        }

        try {
            busStops.value = await busService.value.searchBusStops(searchQuery.value);
        } catch (err) {
            console.error('Search failed:', err);
            busStops.value = [];
        }
    };

    const getBusStopDetails = async (busStopCode) => {
        if (!busService.value) return null;

        try {
            return await busService.value.getBusStopInfo(busStopCode);
        } catch (err) {
            console.error('Failed to get bus stop details:', err);
            return null;
        }
    };

    const refreshData = async () => {
        if (!busService.value) return;

        try {
            isLoading.value = true;
            await busService.value.refreshData();
        } catch (err) {
            error.value = err.message;
            console.error('Failed to refresh data:', err);
        } finally {
            isLoading.value = false;
        }
    };

    return {
        busService,
        isLoading,
        error,
        busStops,
        searchQuery,
        searchBusStops,
        getBusStopDetails,
        refreshData
    };
}

// Vue Options API Example
export default {
    data() {
        return {
            busService: null,
            searchQuery: '',
            searchResults: [],
            selectedBusStop: null,
            isLoading: false,
            error: null
        };
    },

    async mounted() {
        await this.initializeBusService();
    },

    methods: {
        async initializeBusService() {
            try {
                this.isLoading = true;
                this.error = null;

                this.busService = new BusService();
                await this.busService.init();

                console.log('Bus service initialized successfully');

            } catch (error) {
                this.error = error.message;
                console.error('Failed to initialize bus service:', error);
            } finally {
                this.isLoading = false;
            }
        },

        async searchBusStops() {
            if (!this.busService || this.searchQuery.length < 2) {
                this.searchResults = [];
                return;
            }

            try {
                this.searchResults = await this.busService.searchBusStops(this.searchQuery);
            } catch (error) {
                console.error('Search failed:', error);
                this.searchResults = [];
            }
        },

        async selectBusStop(busStopCode) {
            if (!this.busService) return;

            try {
                this.selectedBusStop = await this.busService.getBusStopInfo(busStopCode);
            } catch (error) {
                console.error('Failed to get bus stop details:', error);
                this.selectedBusStop = null;
            }
        },

        async refreshData() {
            if (!this.busService) return;

            try {
                this.isLoading = true;
                await this.busService.refreshData();
                // Clear search results to show fresh data
                this.searchResults = [];
                this.searchQuery = '';
            } catch (error) {
                this.error = error.message;
                console.error('Failed to refresh data:', error);
            } finally {
                this.isLoading = false;
            }
        }
    }
};

/*
ARCHITECTURE SUMMARY:

✅ Backend (Rust):
- Handles LTA API calls (fetch_bus_data_from_api command)
- Defines database migrations (automatic table creation)
- No direct database operations (tauri-plugin-sql v2 design)

✅ Frontend (Vue):
- Handles ALL database operations (SELECT, INSERT, UPDATE, DELETE)
- Uses @tauri-apps/plugin-sql directly
- Manages application state and UI logic
- Calls backend for API data, then stores it locally

✅ Key Benefits:
- Clean separation of concerns
- Type-safe database operations
- Automatic schema migrations
- Efficient batch operations
- Frontend has full control over data queries

✅ Usage:
1. Call `busService.init()` on app startup
2. It will automatically fetch data if database is empty
3. Use search/query methods for user interactions
4. Call `refreshData()` to update from API when needed
*/
