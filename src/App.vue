<script setup>
import { ref, onMounted, watch } from "vue";
import { BusStop } from "./services/stops_db.js";
import { BusService } from "./services/bus_data.js";
import { set, get, clear } from "tauri-plugin-cache-api";

var busServiceObj = null; // contains the new BusData class
var busTimers = {}; // contains the setTimer objects meant to tracks the setTimers
const busStop = new BusStop();
const searchQuery = ref("");
const searchResults = ref([]); // aka your search results
const busStopCode = ref(""); // contains the busstop code LOL
const busTimings = ref({}); // basically what you get from getBusTiming
const countdowns = ref({}); // meant to store the timings of the buses


// basically your sleep function
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// do cache for the busStopCode if the busStopCode changes
watch(busStopCode, async (newCode, oldCode) => {
    // newValue => default, newValue, oldValue => oldValue can optionally specify
    if (newCode != oldCode) {
        await set("busStopCode", newCode);
        console.log(`Bus Stop code has changed from ${oldCode} to ${newCode}`);
    }
});

watch(searchQuery, async (searchTerm) => {
    if (searchTerm.indexOf("-") > 0) {
        let busCode = Number(searchTerm.split("-").at(-1));
        if (Number.isInteger(busCode) && busStopCode.value != busCode) {
            busStopCode.value = busCode;
            feSetBusStopCode(busCode);
            busTimings.value = await busServiceObj.getBusTimings();
            console.log(busTimings.value);
        }
    }
});

// When bus Timings change aka when new set of busTimings are added in
watch(busTimings, async (newTimings) => {
        busTimers = {};

        console.log(newTimings);

        // Start new countdowns for each bus arrival
        for (const busNumber in newTimings) {
            let idx = 0;
            for (let service in newTimings[busNumber]) {
                const value = newTimings[busNumber][service]
                const key = `${busNumber}-${idx}`;
                if (value.arrival_time) {
                    await startCountdown(key, value.arrival_time)
                }
                else {
                    busTimers[key] = ''
                }
                idx += 1;
            }
        }
        console.log(countdowns.value);
    },
    { deep: true }
);

// Function to start a new countdown and add it to the busTimer
async function startCountdown(busServiceKey, busArrivalTime) {
    // Clear any existing timer for this key
    if (busTimers[busServiceKey]) {
        clearInterval(busTimers[busServiceKey]);
    }

    // Set the initial countdown value
    const now = new Date();
    const remainingInSeconds = Math.floor(
        (busArrivalTime.getTime() - now.getTime()) / 1000 /60
    );

    // Update the reactive countdowns object
    countdowns.value[busServiceKey] =
        remainingInSeconds > 0 ? remainingInSeconds : 0;

    // Set up the interval timer
    const intervalId = setInterval( async () => {
        if (countdowns.value[busServiceKey] > 0) {
            countdowns.value[busServiceKey]--;
        } 
        else {
            // Countdown finished, clear timer and re-fetch data
            sleep(30000)
            clearInterval(intervalId);
            delete busTimers[busServiceKey];
            await busServiceObj.getBusTimings()
        }
    }, 60000);

    // Store the interval ID for later clearing
    busTimers[busServiceKey] = intervalId;
}

async function searchBusStops() {
    if (searchQuery.value.length < 2) {
        return;
    }
    console.log("Searching for: " + searchQuery.value);
    const result = await busStop.searchBusStops(searchQuery.value);
    console.log(result);
    console.log(searchQuery.value);
    searchResults.value = result;
}

function feSetBusStopCode(code) {
    busStopCode.value = code;
    if (busServiceObj) {
        busServiceObj.setBusStopCode(code);
    } else {
        busServiceObj = new BusService(code);
        busServiceObj.init();
    }
}

async function initDB() {
    let dbHashmap = {
        dbMessage: "",
        dbSuccess: "",
    };
    try {
        console.log("Initializing database...");
        const result = await busStop.init();
        console.log("Database initialization result:", result);
        dbHashmap.dbMessage = result.message;
        dbHashmap.dbSuccess = result.success;
    } catch (error) {
        console.error("Error initializing database:", error);
        dbHashmap.dbMessage = `Error: ${error.message}`;
        dbHashmap.dbSuccess = result.success;
    }
    return dbHashmap;
}

// Use onMounted to initialize the database after the component is mounted
// prevent await from blocking content from loading
onMounted(async () => {
    let dbHashmap = await initDB();
    let code = await get("busStopCode");
    if (code) {
        busStopCode.value = code;
        console.log(
            `Bus Stop Code, ${code}, present, updating ref value busStopCode`
        );
        feSetBusStopCode(code);
        busTimings.value = await busServiceObj.getBusTimings();
    } else {
        console.log("Bus Stop Code not present");
    }
});
</script>

<template>
    <form @submit.prevent>
        <div>
            <input
                type="text"
                list="busStops"
                @keyup="searchBusStops"
                v-model="searchQuery"
                placeholder="Search for a bus stop..." />
            <br />
            <!-- hearsay that the @click function has issues but tbh probably gonna migrate it to smth more professional -->
            <!-- ok yea it does have issues LOL fml swapped to watch -->
            <datalist id="busStops" v-if="searchResults.length > 0">
                <option
                    v-for="stop in searchResults"
                    :value="`${stop.road_name} - ${stop.description} - ${stop.bus_stop_id}`"></option>
            </datalist>

            <div v-if="busStopCode">
                <h1>{{ busStopCode }}</h1>
                <table border="1">
                    <thead>
                        <tr>
                            <th>Bus Number</th>
                            <th>1st Bus</th>
                            <th>2nd Bus</th>
                            <th>3rd Next</th>
                        </tr>
                    </thead>
                    <tbody>
                        <!-- wait fml this legits makes me wanna code ts, don't have to keep MEMORISING the arrangement -->
                        <tr
                            v-for="(services, busNumber) in busTimings"
                            :key="busNumber">
                            <th>{{ busNumber }}</th>
                            <td
                                v-for="(service, key, index) in services"
                                :key="index">
                                <span v-if="service.arrival_time">
                                    {{ countdowns[`${busNumber}-${index}`] }}
                                    mins
                                </span>
                                <span v-else> N/A </span>
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
        <div>
            <button @click="busStop.refreshData">Refresh Data</button>
        </div>
    </form>
</template>

<style scoped>
.success-message {
    color: #4caf50;
    padding: 10px;
    margin: 10px 0;
    border-radius: 4px;
    background-color: #e8f5e9;
}

.error-message {
    color: #f44336;
    padding: 10px;
    margin: 10px 0;
    border-radius: 4px;
    background-color: #ffebee;
}
</style>
<style>
:root {
    font-family: Inter, Avenir, Helvetica, Arial, sans-serif;
    font-size: 16px;
    line-height: 24px;
    font-weight: 400;

    color: #0f0f0f;
    background-color: #f6f6f6;

    font-synthesis: none;
    text-rendering: optimizeLegibility;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    -webkit-text-size-adjust: 100%;
}

.container {
    margin: 0;
    padding-top: 10vh;
    display: flex;
    flex-direction: column;
    justify-content: center;
    text-align: center;
}

.logo {
    height: 6em;
    padding: 1.5em;
    will-change: filter;
    transition: 0.75s;
}

.logo.tauri:hover {
    filter: drop-shadow(0 0 2em #24c8db);
}

.row {
    display: flex;
    justify-content: center;
}

a {
    font-weight: 500;
    color: #646cff;
    text-decoration: inherit;
}

a:hover {
    color: #535bf2;
}

h1 {
    text-align: center;
}

input,
button {
    border-radius: 8px;
    border: 1px solid transparent;
    padding: 0.6em 1.2em;
    font-size: 1em;
    font-weight: 500;
    font-family: inherit;
    color: #0f0f0f;
    background-color: #ffffff;
    transition: border-color 0.25s;
    box-shadow: 0 2px 2px rgba(0, 0, 0, 0.2);
}

button {
    cursor: pointer;
}

button:hover {
    border-color: #396cd8;
}

button:active {
    border-color: #396cd8;
    background-color: #e8e8e8;
}

input,
button {
    outline: none;
}

#greet-input {
    margin-right: 5px;
}

@media (prefers-color-scheme: dark) {
    :root {
        color: #f6f6f6;
        background-color: #2f2f2f;
    }

    a:hover {
        color: #24c8db;
    }

    input,
    button {
        color: #ffffff;
        background-color: #0f0f0f98;
    }

    button:active {
        background-color: #0f0f0f69;
    }
}
</style>
