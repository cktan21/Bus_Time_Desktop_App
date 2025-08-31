import Database from '@tauri-apps/plugin-sql';
import { invoke } from '@tauri-apps/api/core';

function getDayString(num) {
    if (num == 0) {
        return "sun"
    }
    else if (num == 6) {
        return "sat"
    }
    else {
        return "wd"
    }
}

export class BusService {
    constructor(busStopCode) {
        this.busStopCode = busStopCode;
        this.daDay = null;
        this.busList = [];
        this.busInfo = null;
        this.db = null
    }

    // BusService init
    async init() {
        try {
            // Check if we need to populate the database
            this.db = await Database.load('sqlite:bus_data.db');

            // Get all the Bus Numbers from the db
            // Problem is that after certain times, the api just doesn't return anything aka no more 
            let busList = await this.db.select(
                'SELECT bus_number FROM bus_routes WHERE bus_stop_id = ? ORDER BY bus_number',
                [this.busStopCode]
            );
            this.busList = new Set(busList.map(row => row.bus_stop_id));

            const result = await this.retrieveLiveData();
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

    // Retrieve Live Data
    async retrieveLiveData() {
        console.log(this.busStopCode)
        const busData = await invoke('fetch_stop_data', { bus_stop_code: String(this.busStopCode) });
        console.log(busData)
        this.busInfo = busData
    }

    getBusStopCode() {
        return this.busStopCode
    }

    getBuses() {
        return this.busList
    }

    // Meant to be called when the BusTimings becomes zero
    async getBusTimings() {
        await this.retrieveLiveData()
        let now = new Date()

        if (this.daDay == null) {
            this.setDaDay(now)
        }
        
        buses_now_present = new Set(Object.keys(this.busInfo));
        buses_intersect = this.busList.difference(buses_now_present);
        if (buses_intersect) {
            for (let bus of buses_intersect) {
                let routeID = this.busStopCode + "-" + bus
                let fb_last_bus = await this.db.select(
                    'SELECT first_bus, last_bus FROM bus_times WHERE route_id = ? AND day_of_week = ?',
                    [routeID, this.daDay]
                );
                let fb = fb_last_bus[0].first_bus
                let lb = fb_last_bus[0].last_bus

                let fb_hours = parseInt(fb.substring(0, 2), 10)
                let fb_minutes = parseInt(fb.substring(2, 4), 10)
                let nextDate = new Date(
                    now.getFullYear(),
                    now.getMonth(),
                    now.getDate() + 1,
                    fb_hours,
                    fb_minutes
                )

                let min_diff = (nextDate - now) / (1000 * 60);
                this.busInfo[bus] = {
                    "arrival_time": min_diff,
                    "capacity": "",
                    "type": "",
                    "wheelchair_access": ""
                }
            }
        }
        else {
            console.warn(`No bus timings found for route: ${routeID}`);
        }
        return this.busInfo
    }

    setDaDay(effectiveDate) {
        let hours = effectiveDate.getHours();
        // check if the date is more then 7, if so set the date to +1 (aka tomorrow)
        // probably won't have an edge case where is shows the wrong first hour timing cause if there isn't any intersection, it will just return direct
        // and once buses start running the endpoints will start return values LOL
        if (hours>7){
            effectiveDate.setDate(effectiveDate.getDate() + 1);
        }
        // let time = effectiveDate.getTime()
        // getDay returns 0 is Sunday, 6 is Saturday 1-5 Weekdays
        this.daDay = getDayString(effectiveDate.getDay()) 
    }

    setBusStopCode(busStopCode) {
        let initial_code = this.busStopCode
        this.busStopCode = busStopCode
        console.log(`Bus stop code has changed from ${initial_code} to ${busStopCode}`)
        let resp = this.init();
        if (resp.success) {
            console.log(`Successfully refreshed the values of ${this.busStopCode}`)
        }
        else {
            console.log(`Process Exited with Error: ${resp.message}`)
        }
    }

    chunkArray(arr, size) {
        const chunkedArr = [];
        for (let i = 0; i < arr.length; i += size) {
            chunkedArr.push(arr.slice(i, i + size));
        }
        return chunkedArr;
    }
}