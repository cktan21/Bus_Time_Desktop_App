<script setup>
import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import { BusService } from "./services/stops_db.js";

const searchQuery = ref("");
const dbMessage = ref("");
const dbSuccess = ref(false);
const busService = new BusService();

async function initDB() {
  try {
    console.log("Initializing database...");
    const result = await busService.init();
    console.log("Database initialization result:", result);
    dbMessage.value = result.message;
    dbSuccess.value = result.success;
  } catch (error) {
    console.error("Error initializing database:", error);
    dbMessage.value = `Error: ${error.message}`;
    dbSuccess.value = false;
  }
}
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
  <form @submit.prevent>
    <div>
      <button @click.prevent="initDB">Load DB</button>
      <p
        v-if="dbMessage"
        :class="{ 'success-message': dbSuccess, 'error-message': !dbSuccess }"
      >
        {{ dbMessage }}
      </p>
    </div>

    <!-- <div>
      <input
        type="text"
        v-model="searchQuery"
        placeholder="Search for a bus stop"
      />
      <button @click="searchBusStops">Search</button>
    </div> -->
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
