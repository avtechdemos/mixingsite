(function (root) {
    "use strict";

    var RECIPE = "EPDM Gasket - Final";
    var REAR_LIMIT = 230;
    var BATCH_TICKS = 40;
    var PLANT_STEP = 10;

    var ORDER = [
        "pump-tank",
        "power-station",
        "takeoff-mill",
        "mill-inverter",
        "mixer-cooling",
        "data-processor",
        "weight-scale"
    ];

    function pad(n) {
        return (n < 10 ? "0" : "") + n;
    }

    function ramp(tick, t0, t1, v0, v1) {
        if (tick <= t0) return v0;
        if (tick >= t1) return v1;
        return v0 + (v1 - v0) * ((tick - t0) / (t1 - t0));
    }

    function phaseOf(tick) {
        if (tick <= 4) return "weigh";
        if (tick <= 8) return "charge";
        if (tick <= 22) return "mix";
        if (tick <= 30) return "alarm";
        if (tick <= 36) return "mill";
        return "complete";
    }

    function formatClock(totalSeconds) {
        var t = (10 * 3600 + totalSeconds) % 86400;
        var h24 = Math.floor(t / 3600);
        var m = Math.floor(t / 60) % 60;
        var s = t % 60;
        var ampm = h24 >= 12 ? "PM" : "AM";
        var h = h24 % 12;
        if (h === 0) h = 12;
        return h + ":" + pad(m) + ":" + pad(s) + " " + ampm;
    }

    function formatDuration(seconds) {
        var s = Math.max(0, Math.round(seconds));
        return Math.floor(s / 60) + ":" + pad(s % 60);
    }

    function round1(n) {
        return Math.round(n * 10) / 10;
    }

    function mixSeconds(tick) {
        if (tick < 9) return 0;
        return (Math.min(tick, 30) - 9 + 1) * PLANT_STEP;
    }

    function rearTemp(tick) {
        var base;
        if (tick < 9) base = 96;
        else if (tick <= 22) base = ramp(tick, 9, 22, 118, 224);
        else if (tick <= 30) base = ramp(tick, 23, 30, 236, 251);
        else if (tick <= 36) base = ramp(tick, 31, 36, 210, 170);
        else base = ramp(tick, 37, 39, 164, 152);
        return Math.round(base);
    }

    function zoneTemp(tick, idle, peak) {
        var base;
        if (tick < 9) base = idle;
        else if (tick <= 30) base = ramp(tick, 9, 30, idle + 8, peak);
        else if (tick <= 36) base = ramp(tick, 31, 36, peak - 18, idle + 12);
        else base = ramp(tick, 37, 39, idle + 8, idle);
        return Math.round(base);
    }

    function flowOf(tick, base) {
        return round1(base + Math.sin(tick * 0.8) * 0.25);
    }

    function filterDp(tick) {
        var base;
        if (tick <= 22) base = ramp(tick, 0, 22, 4.2, 9.2);
        else if (tick <= 30) base = ramp(tick, 23, 30, 13.1, 16.4);
        else if (tick <= 36) base = ramp(tick, 31, 36, 7.2, 5.4);
        else base = 5.1;
        return round1(base);
    }

    function frontFlow(tick) {
        if (phaseOf(tick) !== "mill") return null;
        if (tick <= 34) return round1(ramp(tick, 31, 34, 6.2, 4.8));
        return round1(ramp(tick, 35, 36, 8.6, 11.4));
    }

    function backFlow(tick) {
        if (phaseOf(tick) !== "mill") return null;
        return round1(12.2 + Math.sin(tick) * 0.2);
    }

    function weightOf(tick) {
        if (tick <= 0) return 48.6;
        if (tick === 1) return 97.4;
        if (tick === 2) return 142.8;
        if (tick === 3) return 171.5;
        if (tick === 4) return 185.6;
        return 186.1;
    }

    function motorRpm(tick) {
        var phase = phaseOf(tick);
        if (phase === "mix") return Math.round(ramp(tick, 9, 16, 8, 30));
        if (phase === "alarm") return 30;
        return 0;
    }

    function motorKw(tick) {
        var phase = phaseOf(tick);
        if (phase === "mix") return Math.round(ramp(tick, 9, 22, 40, 210));
        if (phase === "alarm") return Math.round(ramp(tick, 23, 30, 220, 255));
        return 0;
    }

    function inverterKw(tick) {
        if (phaseOf(tick) !== "mill") return 0;
        return Math.round(ramp(tick, 31, 33, 22, 48));
    }

    function limitStatus(value, spec) {
        if (value == null) return "idle";
        if (spec.max != null && value > spec.max) return "alarm";
        if (spec.min != null && value < spec.min) return "alarm";
        if (spec.warnMax != null && value > spec.warnMax) return "warn";
        if (spec.warnMin != null && value < spec.warnMin) return "warn";
        return "ok";
    }

    function metric(id, label, value, unit, spec, decimals) {
        var status = spec ? limitStatus(value, spec) : "ok";
        var display;
        if (value == null) display = "\u2014";
        else if (unit === "") display = String(value);
        else if (decimals === 0) display = Math.round(value) + " " + unit;
        else if (typeof value === "number") display = value.toFixed(decimals == null ? 0 : decimals) + " " + unit;
        else display = value + (unit ? " " + unit : "");
        return {
            id: id,
            label: label,
            value: value,
            unit: unit,
            status: status,
            limit: spec && spec.text ? spec.text : "",
            display: display
        };
    }

    function rank(status) {
        if (status === "alarm") return 3;
        if (status === "warn") return 2;
        if (status === "ok") return 1;
        return 0;
    }

    function rollup(metrics, forced) {
        var status = forced || "ok";
        var reason = "";
        var i;
        if (!forced) {
            for (i = 0; i < metrics.length; i++) {
                if (rank(metrics[i].status) > rank(status)) status = metrics[i].status;
            }
        }
        for (i = 0; i < metrics.length; i++) {
            if (metrics[i].status === "alarm" || metrics[i].status === "warn") {
                reason = metrics[i].label + " " + metrics[i].display;
                if (metrics[i].status === status) break;
            }
        }
        return { status: status, reason: reason };
    }

    function component(id, name, metrics, forced) {
        var rolled = rollup(metrics, forced);
        return {
            id: id,
            name: name,
            status: rolled.status,
            reason: rolled.reason,
            metrics: metrics
        };
    }

    function alertText(id, status) {
        if (id === "mixer-cooling" && status === "alarm") return "Rear rotor temperature is above the example limit.";
        if (id === "mixer-cooling" && status === "warn") return "Rear rotor temperature is nearing the example limit.";
        if (id === "pump-tank" && status === "alarm") return "Filter differential is above the example limit.";
        if (id === "pump-tank" && status === "warn") return "Filter differential is nearing the example limit.";
        if (id === "takeoff-mill") return "Front roll water flow is below the example limit.";
        return "A watched value needs attention.";
    }

    function chooseAlert(components, phase, batchNumber) {
        if (phase === "complete") {
            return {
                level: "info",
                componentId: "mixer-cooling",
                text: "Batch " + batchNumber + " finished with an alarm on rear rotor temperature."
            };
        }
        var best = null;
        var i;
        var prefer = { "mixer-cooling": 0, "takeoff-mill": 1, "pump-tank": 2 };
        for (i = 0; i < ORDER.length; i++) {
            var comp = components[ORDER[i]];
            if (comp.status !== "alarm" && comp.status !== "warn") continue;
            var better = !best || rank(comp.status) > rank(best.status);
            var same = best && rank(comp.status) === rank(best.status);
            var preferred = same && (prefer[comp.id] != null ? prefer[comp.id] : 9) < (prefer[best.id] != null ? prefer[best.id] : 9);
            if (better || preferred) best = comp;
        }
        if (!best) {
            return {
                level: "ok",
                componentId: "data-processor",
                text: "All watched values are inside the example limits."
            };
        }
        return {
            level: best.status,
            componentId: best.id,
            text: alertText(best.id, best.status)
        };
    }

    function evaluate(tick, batchNumber) {
        var phase = phaseOf(tick);
        var mixerHot = phase === "mix" || phase === "alarm" || phase === "mill";
        var mixerForced = mixerHot ? null : "idle";
        var processorForced = (phase === "mix" || phase === "alarm") ? null : "idle";
        var millForced = phase === "mill" ? null : "idle";

        var rear = rearTemp(tick);
        var front = zoneTemp(tick, 100, 205);
        var chamber = zoneTemp(tick, 102, 188);
        var floating = zoneTemp(tick, 94, 156);
        var rearSpec = mixerHot ? { max: REAR_LIMIT, warnMax: 220, text: "Example max 230 F" } : null;
        var frontSpec = mixerHot ? { max: 230, warnMax: 220, text: "Example max 230 F" } : null;
        var chamberSpec = mixerHot ? { max: 220, warnMax: 205, text: "Example max 220 F" } : null;
        var floatSpec = mixerHot ? { max: 200, warnMax: 185, text: "Example max 200 F" } : null;
        var flowSpec = mixerHot ? { min: 6, warnMin: 8, text: "Example min 8 gpm" } : null;

        var cooling = component("mixer-cooling", "Mixer Cooling", [
            metric("fw-temp", "Floating Weight Temp", floating, "F", floatSpec, 0),
            metric("fw-flow", "Floating Weight Flow", flowOf(tick, 10.5), "gpm", flowSpec, 1),
            metric("ch-temp", "Mixing Chamber Temp", chamber, "F", chamberSpec, 0),
            metric("ch-flow", "Mixing Chamber Flow", flowOf(tick, 12.4), "gpm", flowSpec, 1),
            metric("fr-temp", "Front Rotor Temp", front, "F", frontSpec, 0),
            metric("fr-flow", "Front Rotor Flow", flowOf(tick, 11.6), "gpm", flowSpec, 1),
            metric("rr-temp", "Rear Rotor Temp", rear, "F", rearSpec, 0),
            metric("rr-flow", "Rear Rotor Flow", flowOf(tick, 11.2), "gpm", flowSpec, 1)
        ], mixerForced);

        var rpm = motorRpm(tick);
        var kw = motorKw(tick);
        var processor = component("data-processor", "Mixer - Main Data Processor", [
            metric("recipe", "Recipe", RECIPE, "", null, 0),
            metric("time-ran", "Time Ran", formatDuration(tick * PLANT_STEP), "", null, 0),
            metric("batch", "Batch Count", String(batchNumber), "", null, 0),
            metric("mix-time", "Mix Time", formatDuration(mixSeconds(tick)), "", null, 0),
            metric("temp", "Rear Rotor Temp", rear, "F", (phase === "mix" || phase === "alarm") ? rearSpec : null, 0),
            metric("speed", "Motor Speed", rpm, "rpm", null, 0),
            metric("kw", "Motor Power", kw, "kW", null, 0)
        ], processorForced);
        processor.metrics[0].display = RECIPE;
        processor.metrics[1].display = formatDuration(tick * PLANT_STEP);
        processor.metrics[2].display = String(batchNumber);
        processor.metrics[3].display = formatDuration(mixSeconds(tick));

        var fFlow = frontFlow(tick);
        var bFlow = backFlow(tick);
        var millFlowSpec = phase === "mill" ? { min: 4, warnMin: 8, text: "Example min 8 gpm" } : null;
        var millTempSpec = phase === "mill" ? { max: 95, text: "Example max 95 F" } : null;
        var mill = component("takeoff-mill", "Take Off Mill / Dump Mill", [
            metric("r1-temp", "Front Roll Water Temp", phase === "mill" ? Math.round(72 + Math.sin(tick) * 0.4) : 70, "F", millTempSpec, 0),
            metric("r1-flow", "Front Roll Water Flow", fFlow, "gpm", millFlowSpec, 1),
            metric("r2-temp", "Back Roll Water Temp", phase === "mill" ? Math.round(71 + Math.cos(tick) * 0.4) : 70, "F", millTempSpec, 0),
            metric("r2-flow", "Back Roll Water Flow", bFlow, "gpm", millFlowSpec, 1)
        ], millForced);

        var inv = inverterKw(tick);
        var inverter = component("mill-inverter", "Take Off Mill Inverter Panel", [
            metric("kw", "Power Usage", inv, "kW", null, 0)
        ], millForced);

        var dp = filterDp(tick);
        var pump = component("pump-tank", "Pump Tank", [
            metric("w-pressure", "Water Pressure", round1(55 + Math.sin(tick * 0.5) * 1.2), "psi", { min: 40, max: 70, text: "Example 40\u201370 psi" }, 1),
            metric("w-temp", "Water Temperature", Math.round(64 + Math.sin(tick * 0.3)), "F", { min: 50, max: 80, text: "Example 50\u201380 F" }, 0),
            metric("air", "Air Pressure", round1(92 + Math.cos(tick * 0.4) * 0.8), "psi", { min: 80, max: 110, text: "Example 80\u2013110 psi" }, 1),
            metric("dp", "Filter Differential", dp, "psi", { max: 12, warnMax: 10, text: "Example max 12 psi" }, 1)
        ], null);

        var plantKw = 35 + kw + inv;
        var power = component("power-station", "Main Power Station", [
            metric("ambient", "Ambient Temperature", Math.round(74 + Math.sin(tick * 0.2)), "F", { max: 90, text: "Example max 90 F" }, 0),
            metric("kw", "Power Usage", plantKw, "kW", null, 0)
        ], null);

        var wt = weightOf(tick);
        var weightSpec = tick >= 4 ? { min: 180, max: 192, text: "Example target 186.0 lb" } : null;
        var scale = component("weight-scale", "Weight Scale", [
            metric("weight", "Weight", wt, "lb", weightSpec, 1),
            metric("target", "Target", 186, "lb", null, 1),
            metric("probe", "Probe Temperature", Math.round(82 + Math.sin(tick * 0.6) * 0.4), "F", { max: 100, text: "Example max 100 F" }, 0),
            metric("batch", "Batch Count", String(batchNumber), "", null, 0)
        ], null);
        scale.metrics[3].display = String(batchNumber);
        scale.metrics[1].display = "186.0 lb";

        var components = {
            "pump-tank": pump,
            "power-station": power,
            "takeoff-mill": mill,
            "mill-inverter": inverter,
            "mixer-cooling": cooling,
            "data-processor": processor,
            "weight-scale": scale
        };

        return {
            tick: tick,
            phase: phase,
            batchNumber: batchNumber,
            recipe: RECIPE,
            rearTemp: rear,
            mixTime: formatDuration(mixSeconds(tick)),
            timeRan: formatDuration(tick * PLANT_STEP),
            weight: wt,
            components: components,
            alert: chooseAlert(components, phase, batchNumber)
        };
    }

    function seedHistory() {
        return [
            { batch: 1041, recipe: RECIPE, mixTime: "3:40", peak: "221 F", result: "In range" },
            { batch: 1040, recipe: RECIPE, mixTime: "3:40", peak: "218 F", result: "In range" },
            { batch: 1039, recipe: RECIPE, mixTime: "3:50", peak: "244 F", result: "Alarm" }
        ];
    }

    function create() {
        var tick = 0;
        var batchNumber = 1042;
        var history = seedHistory();
        var plantOffset = 0;
        var paused = false;
        var saved = false;
        var peakRear = 0;
        var trends = {};
        var timer = null;
        var listeners = [];

        function pushTrend(id, value) {
            if (typeof value !== "number") return;
            if (!trends[id]) trends[id] = [];
            trends[id].push(value);
            if (trends[id].length > 20) trends[id].shift();
        }

        function recordTrends(snap) {
            ORDER.forEach(function (id) {
                snap.components[id].metrics.forEach(function (item) {
                    pushTrend(id + "." + item.id, item.value);
                });
            });
        }

        function attachTrends(snap) {
            ORDER.forEach(function (id) {
                snap.components[id].metrics.forEach(function (item) {
                    var key = id + "." + item.id;
                    item.trend = (trends[key] || []).slice();
                });
            });
        }

        function commit(snap) {
            history.unshift({
                batch: batchNumber,
                recipe: RECIPE,
                mixTime: snap.mixTime,
                peak: peakRear + " F",
                result: peakRear > REAR_LIMIT ? "Alarm" : "In range"
            });
            if (history.length > 8) history.pop();
            saved = true;
        }

        function apply() {
            var snap = evaluate(tick, batchNumber);
            if (snap.rearTemp > peakRear) peakRear = snap.rearTemp;
            if (tick === 37 && !saved) commit(snap);
            recordTrends(snap);
            attachTrends(snap);
            snap.paused = paused;
            snap.clock = formatClock(plantOffset);
            snap.history = history.slice();
            snap.order = ORDER.slice();
            snap.phaseLabel = {
                weigh: "Weighing",
                charge: "Charging",
                mix: "Mixing",
                alarm: "Alarm",
                mill: "On the mill",
                complete: "Batch complete"
            }[snap.phase];
            return snap;
        }

        function emit(snap) {
            listeners.forEach(function (fn) { fn(snap); });
        }

        function step() {
            tick += 1;
            plantOffset += PLANT_STEP;
            if (tick > 39) {
                tick = 0;
                batchNumber += 1;
                peakRear = 0;
                saved = false;
            }
            return apply();
        }

        function resetTo(target) {
            tick = 0;
            batchNumber = 1042;
            history = seedHistory();
            plantOffset = 0;
            saved = false;
            peakRear = 0;
            trends = {};
            var snap = apply();
            var guard = 0;
            while (tick < target && guard < BATCH_TICKS) {
                snap = step();
                guard += 1;
            }
            return snap;
        }

        return {
            on: function (fn) { listeners.push(fn); },
            start: function () {
                var snap = apply();
                emit(snap);
                if (timer) return;
                timer = setInterval(function () {
                    if (paused) return;
                    emit(step());
                }, 1000);
            },
            toggle: function () {
                paused = !paused;
                emit(apply());
                return paused;
            },
            debugSetTick: function (target) {
                paused = true;
                emit(resetTo(target));
            }
        };
    }

    root.MixingSim = { create: create, BATCH_TICKS: BATCH_TICKS };
})(window);
