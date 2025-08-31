<script setup>
import { ref, onMounted, watch } from "vue";
import { BusStop } from "./services/stops_db.js";
import { BusService } from "./services/bus_data.js";
import { set, get, clear } from "tauri-plugin-cache-api";

var busServiceObj = null;
const busStop = new BusStop();
const searchQuery = ref("");
const searchResults = ref([]);
const busStopCode = ref("");
const busTimings = ref({});

// do cache for the busStopCode if the busStopCode changes
watch(busStopCode, async (newCode, oldCode) => {
    // newValue => default, newValue, oldValue => oldValue can optionally specify
    if (newCode !== oldCode) {
        await set("busStopCode", newCode);
        console.log(`Bus Stop code has changed from ${oldCode} to ${newCode}`);
    }
});

watch(searchQuery, (searchTerm) => {
    if(searchTerm.indexOf('-')>0){
        let busCode = Number(searchTerm.split("-").at(-1));
        console.log(`This is the split code:${busCode}`)
        if (Number.isInteger(busCode)){
            busStopCode.value = busCode
            feSetBusStopCode(busCode)
            busTimings.value = busServiceObj.getBusTimings()
        } 
    };
});


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
    }
    busTimings.value = busServiceObj.getBusTimings();
}

async function initBusData() {
    let initHashMap = {
        message: "",
        success: "",
    };
    try {
        console.log("Initializing BusData...");
        const result = await busStop.init();
        console.log("BusData initialization result:", result);
        initHashMap.message = result.message;
        initHashMap.success = result.success;
    } catch (error) {
        console.error("Error initializing BusData:", error);
        initHashMap.message = `Error: ${error.message}`;
        initHashMap.success = result.success;
    }
    return initHashMap;
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
    let busDataHashMap = await initBusData();
    let code = await get("busStopCode");
    if (code) {
        busStopCode.value = code;
        console.log(
            `Bus Stop Code, ${code}, present, updating ref value busStopCode`
        );
    } else {
        console.log("Bus Stop Code not present");
    }
});
</script>

<template>
    <!-- <main class="container">
        <div>
            <h1>Aft Lentor Stn Exit 4</h1>
            <table>
                <tr>
                    <th>163</th>
                    <td>3</td>
                    <td>13</td>
                </tr>
                <tr>
                    <th>265</th>
                    <td>5</td>
                    <td>13</td>
                </tr>
                <tr>
                    <th>269</th>
                    <td>10</td>
                    <td>55</td>
                </tr>
                <tr>
                    <th>855</th>
                    <td>16</td>
                    <td>45</td>
                </tr>
            </table>
        </div>
        <div>
            <h1>Bef Lentor Stn Exit 5</h1>
            <table>
                <tr>
                    <th>163</th>
                    <td>3</td>
                    <td>13</td>
                </tr>
                <tr>
                    <th>265</th>
                    <td>5</td>
                    <td>13</td>
                </tr>
                <tr>
                    <th>855</th>
                    <td>16</td>
                    <td>45</td>
                </tr>
            </table>
        </div>
    </main> -->
    <!-- <h1>Bus Stop Data</h1>
        <div v-if="isLoading">
            <p>{{ progressMessage }}</p>
            <div class="progress-bar-container">
                <div 
                    class="progress-bar" 
                    :style="{ width: progressPercentage + '%' }"
                ></div>
            </div>
        </div>
        <div v-else class="success-message">
            {{ dbMessage }}
        </div> -->

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
            <!-- ok yea it does have issues LOL fml -->
            <datalist id="busStops" v-if="searchResults.length > 0">
                <option
                    v-for="stop in searchResults"
                    :value="`${stop.road_name} - ${stop.description} - ${stop.bus_stop_id}`"
                    ></option>
            </datalist>

            <div v-if="busServiceObj">
                <h1>{{ busStopCode }}</h1>
                <table>
                    <!-- wait fml this legits makes me wanna code ts, don't have to keep MEMORISING the arrangement -->
                    <tr v-for="(value, key) in busTimings" :key="key">
                        <th>{{ key }}</th>
                        <td
                            v-for="(item, bus_num_what) in value"
                            :key="bus_num_what">
                            {{ item.arrival_time }}
                        </td>
                    </tr>
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
