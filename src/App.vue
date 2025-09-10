<script setup>
import { ref, onMounted, watch, onBeforeUnmount } from "vue";
import { BusStop } from "./services/stops_db.js";
import { BusService } from "./services/bus_data.js";
import { set, get, clear } from "tauri-plugin-cache-api";

// State management
const busStopCode = ref(""); // Code that determines everything
const busServiceObj = ref(null);
const busStopObj = new BusStop(); 

const searchQuery = ref(""); // what you send to the backend
const searchResults = ref([]); // what is returned

const countdownsObjs = ref(new Map()); //aka your setIntervals are all stored here
const busTimings = ref({}); // aka what getTimings returns
const busTimes = ref({}); // aka the raw bus times like 1min 3min 5min etc

const isLoading = ref(false);
const error = ref("");

// Constants
const COUNTDOWN_INTERVAL = 20000; // 20 seconds
const REFRESH_DELAY = 500; // .5 seconds
const MIN_SEARCH_LENGTH = 2;

// Utility functions
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const formatTime = (minutes) => {
    if (minutes <= 0) return "Arriving";
    if (minutes === 1) return "1 min";
    return `${minutes} mins`;
};

// Clear all timers utility
const clearAllTimers = () => {
    countdownsObjs.value.forEach((timerId) => {
        if (timerId) clearInterval(timerId);
    });
    countdownsObjs.value.clear();
};

// Cache management
watch(busStopCode, async (newCode, oldCode) => {
    if (newCode !== oldCode && newCode) {
        try {
            await set("busStopCode", newCode);
            console.log(`Bus Stop code changed from ${oldCode} to ${newCode}`);
        } catch (err) {
            console.error("Failed to cache bus stop code:", err);
        }
    }
});

// Search functionality
watch(searchQuery, async (searchTerm) => {
    if (searchTerm && searchTerm.includes("-")) {
        const parts = searchTerm.split("-");
        const busCode = Number(parts[parts.length - 1]);

        if (Number.isInteger(busCode) && busStopCode.value !== busCode) {
            await setBusStopCode(busCode);
        }
    }
});

// Main timing management
watch(
    busTimings,
    async (newTimings) => {
        if (!newTimings || typeof newTimings !== "object") return;

        // Clear existing timers
        clearAllTimers();
        busTimes.value = {};

        console.log("Setting up new timers for:", newTimings);

        // Start new busTimes for each bus service
        for (const [busNumber, services] of Object.entries(newTimings)) {
            if (!services || typeof services !== "object") continue;

            let serviceIndex = 0;
            for (const [serviceKey, serviceData] of Object.entries(services)) {
                const countdownKey = `${busNumber}-${serviceIndex}`;

                if (
                    serviceData?.arrival_time &&
                    serviceData.arrival_time instanceof Date &&
                    !isNaN(serviceData.arrival_time)
                ) {
                    await startCountdown(
                        countdownKey,
                        serviceData.arrival_time,
                        busNumber
                    );
                } else {
                    busTimes.value[countdownKey] = null;
                }
                serviceIndex++;
            }
        }
    },
    { deep: true }
);

// countdown function
async function startCountdown(countdownKey, arrivalTime, busNumber) {
    const now = new Date();

    const remainingSeconds = Math.floor((arrivalTime.getTime() - now.getTime()) / 1000);
    const remainingMinutes = Math.ceil(remainingSeconds / 60);

    // Set initial countdown
    busTimes.value[countdownKey] = Math.max(0, remainingMinutes);

    // Create interval for this specific countdown
    const intervalId = setInterval(async () => {
        const currentTime = new Date();
        const currentSeconds = Math.floor((arrivalTime.getTime() - currentTime.getTime()) / 1000);
        const currentMinutes = Math.ceil(currentSeconds / 60);
        
        if (busTimes.value[countdownKey] > 0) {
            busTimes.value[countdownKey] = currentMinutes;
        } else {
            // Countdown finished - clean up this specific timer
            clearInterval(intervalId);
            countdownsObjs.value.delete(countdownKey);

            // Check if all timers for this bus are finished
            const allTimersForBus = Array.from(countdownsObjs.value.keys()).filter(
                (key) => key.startsWith(`${busNumber}-`)
            );

            if (allTimersForBus.length === 0) {
                console.log(
                    `All timers finished for bus ${busNumber}, refreshing data...`
                );
                // Wait a bit then refresh
                setTimeout(async () => {
                    await refreshBusTimings();
                }, REFRESH_DELAY);
            }
        }
    }, COUNTDOWN_INTERVAL);

    // Store the interval ID
    countdownsObjs.value.set(countdownKey, intervalId);
}

// search function
async function searchBusStops() {
    if (searchQuery.value.length < MIN_SEARCH_LENGTH) {
        searchResults.value = [];
        return;
    }

    try {
        console.log("Searching for:", searchQuery.value);
        const result = await busStopObj.searchBusStops(searchQuery.value);
        searchResults.value = Array.isArray(result) ? result : [];
    } catch (err) {
        console.error("Search failed:", err);
        error.value = "Search failed. Please try again.";
        searchResults.value = [];
    }
}

// bus stop code setting
async function setBusStopCode(code) {
    if (!code) return;

    try {
        isLoading.value = true;
        error.value = "";

        busStopCode.value = code;

        if (!busServiceObj.value) {
            busServiceObj.value = new BusService(code);
            await busServiceObj.value.init();
        } else {
            busServiceObj.value.setBusStopCode(code);
        }

        await refreshBusTimings();
    } catch (err) {
        console.error("Failed to set bus stop code:", err);
        error.value = "Failed to load bus stop data.";
    } finally {
        isLoading.value = false;
    }
}

// Separate refresh function for reusability
async function refreshBusTimings() {
    if (!busServiceObj.value) return;

    try {
        isLoading.value = true;
        error.value = "";

        const newTimings = await busServiceObj.value.getBusTimings();

        if (newTimings && typeof newTimings === "object") {
            busTimings.value = newTimings;
            console.log("Bus timings refreshed:", newTimings);
        } else {
            throw new Error("Invalid bus timings data received");
        }
    } catch (err) {
        console.error("Failed to refresh bus timings:", err);
        error.value = "Failed to refresh bus timings.";
    } finally {
        isLoading.value = false;
    }
}

// Database initialization
async function initDB() {
    try {
        console.log("Initializing database...");
        const result = await busStopObj.init();
        console.log("Database initialization result:", result);

        return {
            dbMessage: result.message || "Database initialized",
            dbSuccess: result.success ?? true,
        };
    } catch (error) {
        console.error("Error initializing database:", error);
        return {
            dbMessage: `Error: ${error.message}`,
            dbSuccess: false,
        };
    }
}

// Manual refresh function
async function manualRefresh() {
    await refreshBusTimings();
}

// Lifecycle hooks
onMounted(async () => {
    try {
        const dbResult = await initDB();

        if (!dbResult.dbSuccess) {
            error.value = dbResult.dbMessage;
            return;
        }

        // Load cached bus stop code
        const cachedCode = await get("busStopCode");
        if (cachedCode) {
            console.log(`Cached bus stop code found: ${cachedCode}`);
            await setBusStopCode(cachedCode);
        }
    } catch (err) {
        console.error("Initialization failed:", err);
        error.value = "Failed to initialize application.";
    }
});

onBeforeUnmount(() => {
    // Clean up all timers when component is destroyed
    clearAllTimers();
});
</script>

<template>
    <form @submit.prevent>
        <div>
            <!-- Error display -->
            <div v-if="error" class="error-message">
                {{ error }}
                <button @click="error = ''" type="button">×</button>
            </div>

            <!-- Loading indicator -->
            <div v-if="isLoading" class="loading-message">
                Loading bus timings...
            </div>

            <!-- Search input -->
            <input
                type="text"
                list="busStops"
                @input="searchBusStops"
                v-model="searchQuery"
                placeholder="Search for a bus stop..."
                :disabled="isLoading" />

            <!-- Search results datalist -->
            <datalist id="busStops" v-if="searchResults.length > 0">
                <option
                    v-for="stop in searchResults"
                    :key="stop.bus_stop_id"
                    :value="`${stop.road_name} - ${stop.description} - ${stop.bus_stop_id}`" />
            </datalist>

            <!-- Bus timings display -->
            <div v-if="busStopCode" class="bus-timings">
                <h1>Bus Stop: {{ busStopCode }}</h1>

                <div
                    v-if="Object.keys(busTimings).length === 0 && !isLoading"
                    class="no-data">
                    No bus services available at this time.
                </div>

                <table v-else border="1" class="timings-table">
                    <thead>
                        <tr>
                            <th>Bus Number</th>
                            <th>1st Bus</th>
                            <th>2nd Bus</th>
                            <th>3rd Bus</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr
                            v-for="(services, busNumber) in busTimings"
                            :key="busNumber">
                            <th class="bus-number">{{ busNumber }}</th>
                            <td
                                v-for="(service, serviceKey, index) in services"
                                :key="`${busNumber}-${index}`"
                                :class="{
                                    arriving:
                                        busTimes[`${busNumber}-${index}`] ===
                                        0,
                                    soon:
                                        busTimes[`${busNumber}-${index}`] >
                                            0 &&
                                        busTimes[`${busNumber}-${index}`] <=
                                            5,
                                }">
                                <span
                                    v-if="
                                        service?.arrival_time &&
                                        busTimes[`${busNumber}-${index}`] !==
                                            null
                                    ">
                                    {{
                                        formatTime(
                                            busTimes[`${busNumber}-${index}`]
                                        )
                                    }}
                                </span>
                                <span v-else class="na">N/A</span>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>

            <!-- Control buttons -->
            <div class="controls">
                <button
                    @click="manualRefresh"
                    :disabled="isLoading || !busStopCode">
                    {{ isLoading ? "Refreshing..." : "Refresh Data" }}
                </button>

                <button
                    @click="
                        () => {
                            busStopCode = '';
                            busTimings = {};
                            clearAllTimers();
                        }
                    "
                    :disabled="!busStopCode">
                    Clear
                </button>
            </div>
        </div>
    </form>
</template>

<style scoped>
.error-message {
    color: #f44336;
    padding: 10px;
    margin: 10px 0;
    border-radius: 4px;
    background-color: #ffebee;
    display: flex;
    justify-content: space-between;
    align-items: center;
}

.loading-message {
    color: #2196f3;
    padding: 10px;
    margin: 10px 0;
    border-radius: 4px;
    background-color: #e3f2fd;
    text-align: center;
}

.no-data {
    color: #757575;
    padding: 20px;
    text-align: center;
    font-style: italic;
}

.bus-timings {
    margin-top: 20px;
}

.timings-table {
    width: 100%;
    border-collapse: collapse;
    margin-top: 10px;
}

.timings-table th,
.timings-table td {
    padding: 12px 8px;
    text-align: center;
    border: 1px solid #ddd;
}

.timings-table th {
    background-color: #f5f5f5;
    font-weight: bold;
}

.bus-number {
    background-color: #e8f5e9 !important;
    font-size: 1.1em;
}

.arriving {
    background-color: #ffcdd2;
    font-weight: bold;
    animation: pulse 1s infinite;
}

.soon {
    background-color: #fff3e0;
    font-weight: bold;
}

.na {
    color: #9e9e9e;
    font-style: italic;
}

.controls {
    margin-top: 20px;
    display: flex;
    gap: 10px;
    justify-content: center;
}

@keyframes pulse {
    0% {
        opacity: 1;
    }
    50% {
        opacity: 0.7;
    }
    100% {
        opacity: 1;
    }
}

/* Dark mode support */
@media (prefers-color-scheme: dark) {
    .timings-table th {
        background-color: #424242;
        color: #fff;
    }

    .bus-number {
        background-color: #2e7d32 !important;
        color: #fff;
    }

    .timings-table td {
        border-color: #555;
    }
}
</style>
