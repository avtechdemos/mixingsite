(function () {
    "use strict";

    var NOTES = {
        "weight-scale": "Taken right before the material enters the rotors. Temperature is from a manual probe.",
        "pump-tank": "Water pressure, water temperature, air pressure, and the filter differential.",
        "power-station": "Ambient temperature assumes a heat sensor mounted on the wall. A Duke Energy feed is not connected in this demo, so plant power is simulated from the mixer and the mill drive.",
        "takeoff-mill": "Water temperature and water flow are read per roll, which is 2 zones.",
        "mill-inverter": "Power usage of the take-off mill drive, in kW.",
        "mixer-cooling": "Four zones and eight measurements: temperature and flow on the floating weight, mixing chamber, front rotor, and rear rotor.",
        "data-processor": "This stands in for pulling the mixer tags, including recipe, time ran, batch count, mix time, temperatures, and motor speed. Stored plant history is every 10 minutes, or when an alert is triggered. This screen samples every 10 seconds so a batch can be watched live."
    };

    var STATUS_LABEL = { ok: "In range", warn: "Nearing limit", alarm: "Out of limit", idle: "Idle" };
    var STEPS = ["weigh", "charge", "mix", "alarm", "mill"];

    var selected = "data-processor";
    var detailKey = "";
    var railReady = false;
    var lastSnap = null;

    function metric(snap, componentId, metricId) {
        var list = snap.components[componentId].metrics;
        var i;
        for (i = 0; i < list.length; i++) {
            if (list[i].id === metricId) return list[i];
        }
        return null;
    }

    function text(id, value) {
        var el = document.getElementById(id);
        if (el && el.textContent !== value) el.textContent = value;
    }

    function setStatus(el, status) {
        if (!el) return;
        var name = status || "ok";
        if (el.getAttribute("data-state") === name) return;
        el.setAttribute("data-state", name);
        el.classList.remove("is-ok", "is-warn", "is-alarm", "is-idle");
        el.classList.add("is-" + name);
    }

    function sparkline(values, status) {
        var nums = (values || []).filter(function (v) { return typeof v === "number"; });
        if (nums.length < 2) return "";
        var min = Math.min.apply(null, nums);
        var max = Math.max.apply(null, nums);
        var span = (max - min) || 1;
        var w = 280;
        var h = 28;
        var d = nums.map(function (v, i) {
            var x = (i / (nums.length - 1)) * w;
            var y = h - 3 - ((v - min) / span) * (h - 6);
            return (i === 0 ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(1);
        }).join(" ");
        return '<svg class="spark is-' + status + '" viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none"><path d="' + d + '"></path></svg>';
    }

    function buildRail(snap) {
        var rail = document.getElementById("rail");
        rail.innerHTML = '<div class="rail-header">Line Status</div><div class="rail-body" id="railBody"></div>';
        var body = document.getElementById("railBody");
        snap.order.forEach(function (id) {
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "rail-item";
            btn.dataset.id = id;
            btn.innerHTML = '<i class="dot"></i><span class="label"></span>';
            body.appendChild(btn);
        });
        railReady = true;
    }

    function paintRail(snap) {
        if (!railReady) buildRail(snap);
        snap.order.forEach(function (id) {
            var btn = document.querySelector('.rail-item[data-id="' + id + '"]');
            var comp = snap.components[id];
            if (!btn) return;
            btn.classList.toggle("is-selected", id === selected);
            btn.querySelector(".label").textContent = comp.name;
            setStatus(btn.querySelector(".dot"), comp.status);
        });
    }

    function paintHeader(snap) {
        text("plantClock", snap.clock);
        text("liveLabel", snap.paused ? "Paused" : "Live demo");
        text("playPause", snap.paused ? "Play" : "Pause");
        document.body.classList.toggle("is-paused", snap.paused);
    }

    function paintAlert(snap) {
        var banner = document.getElementById("alert");
        banner.className = "alert is-" + snap.alert.level;
        banner.dataset.id = snap.alert.componentId;
        var kicker = { ok: "In range", warn: "Watch", alarm: "Alarm", info: "Batch" }[snap.alert.level] || "Line";
        text("alertKicker", kicker);
        text("alertText", snap.alert.text);
    }

    function paintSteps(snap) {
        text("batchLine", "Batch " + snap.batchNumber + " \u00b7 " + snap.recipe);
        text("phaseLine", snap.phaseLabel);
        var current = STEPS.indexOf(snap.phase);
        document.querySelectorAll(".steps li").forEach(function (li) {
            var index = STEPS.indexOf(li.getAttribute("data-step"));
            var done = snap.phase === "complete" || (current > -1 && index < current);
            var active = li.getAttribute("data-step") === snap.phase;
            li.classList.toggle("is-done", done && !active);
            li.classList.toggle("is-current", active);
        });
    }

    function paintWeight(snap) {
        var comp = snap.components["weight-scale"];
        var weight = metric(snap, "weight-scale", "weight");
        var probe = metric(snap, "weight-scale", "probe");
        var card = document.getElementById("unit-weight-scale");
        setStatus(card, comp.status);
        card.classList.toggle("is-selected", selected === "weight-scale");
        text("weight-value", weight.display);
        text("weight-probe", "Probe " + probe.display);
        text("weight-reason", comp.reason);
        var pct = Math.max(0, Math.min(100, (weight.value / 186) * 100));
        document.getElementById("weight-meter").style.width = pct + "%";
    }

    function paintProcessor(snap) {
        var comp = snap.components["data-processor"];
        var card = document.getElementById("unit-data-processor");
        setStatus(card, comp.status);
        card.classList.toggle("is-selected", selected === "data-processor");
        text("proc-recipe", metric(snap, "data-processor", "recipe").display);
        text("proc-mix", metric(snap, "data-processor", "mix-time").display);
        text("proc-ran", metric(snap, "data-processor", "time-ran").display);
        text("proc-speed", metric(snap, "data-processor", "speed").display);
        text("proc-kw", metric(snap, "data-processor", "kw").display);
        text("proc-reason", comp.reason);
    }

    function zoneState(tempMetric, flowMetric) {
        if (tempMetric.status === "alarm" || flowMetric.status === "alarm") return "alarm";
        if (tempMetric.status === "warn" || flowMetric.status === "warn") return "warn";
        return "ok";
    }

    function paintCooling(snap) {
        var comp = snap.components["mixer-cooling"];
        var card = document.getElementById("unit-mixer-cooling");
        setStatus(card, comp.status);
        card.classList.toggle("is-selected", selected === "mixer-cooling");
        card.classList.toggle("is-moving", snap.phase === "mix" || snap.phase === "alarm");
        var pairs = [
            ["fw", "fw-temp", "fw-flow"],
            ["ch", "ch-temp", "ch-flow"],
            ["fr", "fr-temp", "fr-flow"],
            ["rr", "rr-temp", "rr-flow"]
        ];
        pairs.forEach(function (pair) {
            var temp = metric(snap, "mixer-cooling", pair[1]);
            var flow = metric(snap, "mixer-cooling", pair[2]);
            var zone = document.getElementById("zone-" + pair[0]);
            zone.classList.remove("is-ok", "is-warn", "is-alarm");
            if (comp.status !== "idle") zone.classList.add("is-" + zoneState(temp, flow));
            text("zone-" + pair[0] + "-val", temp.display);
        });
        text("cool-reason", comp.reason);
    }

    function paintMill(snap) {
        var comp = snap.components["takeoff-mill"];
        var card = document.getElementById("unit-takeoff-mill");
        var frontFlow = metric(snap, "takeoff-mill", "r1-flow");
        var backFlow = metric(snap, "takeoff-mill", "r2-flow");
        var frontTemp = metric(snap, "takeoff-mill", "r1-temp");
        var backTemp = metric(snap, "takeoff-mill", "r2-temp");
        setStatus(card, comp.status);
        card.classList.toggle("is-selected", selected === "takeoff-mill");
        card.classList.toggle("is-moving", snap.phase === "mill");
        text("roll-front", frontTemp.display + " \u00b7 " + frontFlow.display);
        text("roll-back", backTemp.display + " \u00b7 " + backFlow.display);
        text("mill-reason", comp.reason);

        var inv = snap.components["mill-inverter"];
        var invCard = document.getElementById("unit-mill-inverter");
        setStatus(invCard, inv.status);
        invCard.classList.toggle("is-selected", selected === "mill-inverter");
        text("inv-kw", metric(snap, "mill-inverter", "kw").display);
        text("inv-reason", inv.reason);
    }

    function paintUtilities(snap) {
        var pump = snap.components["pump-tank"];
        var pumpCard = document.getElementById("unit-pump-tank");
        setStatus(pumpCard, pump.status);
        pumpCard.classList.toggle("is-selected", selected === "pump-tank");
        text("pump-pressure", metric(snap, "pump-tank", "w-pressure").display);
        text("pump-temp", metric(snap, "pump-tank", "w-temp").display);
        text("pump-air", metric(snap, "pump-tank", "air").display);
        text("pump-dp", metric(snap, "pump-tank", "dp").display);
        text("pump-reason", pump.reason);

        var power = snap.components["power-station"];
        var powerCard = document.getElementById("unit-power-station");
        setStatus(powerCard, power.status);
        powerCard.classList.toggle("is-selected", selected === "power-station");
        text("power-ambient", metric(snap, "power-station", "ambient").display);
        text("power-kw", metric(snap, "power-station", "kw").display);
        text("power-reason", power.reason);
    }

    function paintConnectors(snap) {
        document.getElementById("conn-charge").classList.toggle("is-active", snap.phase === "charge");
        document.getElementById("conn-dump").classList.toggle("is-active", snap.phase === "mill" || snap.phase === "alarm");
    }

    function historyRows(history) {
        return history.map(function (row) {
            var klass = row.result === "Alarm" ? "result-alarm" : "result-ok";
            return "<tr><td>" + row.batch + "</td><td>" + row.mixTime + "</td><td>" + row.peak + "</td><td class=\"" + klass + "\">" + row.result + "</td></tr>";
        }).join("");
    }

    function buildDetail(snap) {
        var comp = snap.components[selected];
        var metrics = comp.metrics.map(function (item) {
            return '<div class="metric" data-metric="' + item.id + '">' +
                '<div class="metric-top"><span>' + item.label + '</span><span class="metric-value"></span></div>' +
                '<div class="metric-limit"></div>' +
                '<div class="metric-spark"></div>' +
                "</div>";
        }).join("");
        document.getElementById("detail").innerHTML =
            '<div class="detail-card">' +
            '<div class="detail-header"></div>' +
            '<div class="detail-body">' +
            '<div class="status-pill"></div>' +
            '<p class="detail-note"></p>' +
            '<h3>Current values</h3>' +
            metrics +
            '<h3>Batch history</h3>' +
            '<table class="history"><thead><tr><th>Batch</th><th>Mix</th><th>Peak rotor</th><th>Result</th></tr></thead><tbody></tbody></table>' +
            "</div></div>";
        detailKey = selected;
    }

    function paintDetail(snap) {
        if (detailKey !== selected) buildDetail(snap);
        var comp = snap.components[selected];
        var root = document.getElementById("detail");
        root.querySelector(".detail-header").textContent = comp.name;
        var pill = root.querySelector(".status-pill");
        pill.textContent = STATUS_LABEL[comp.status] || comp.status;
        setStatus(pill, comp.status);
        root.querySelector(".detail-note").textContent = NOTES[selected] || "";
        comp.metrics.forEach(function (item) {
            var row = root.querySelector('.metric[data-metric="' + item.id + '"]');
            if (!row) return;
            var value = row.querySelector(".metric-value");
            value.textContent = item.display;
            setStatus(value, item.status === "ok" || item.status === "idle" ? "ok" : item.status);
            if (item.status === "idle") value.classList.remove("is-ok");
            row.querySelector(".metric-limit").textContent = item.limit || "";
            row.querySelector(".metric-spark").innerHTML = sparkline(item.trend, item.status);
        });
        root.querySelector(".history tbody").innerHTML = historyRows(snap.history);
    }

    function paint(snap) {
        lastSnap = snap;
        paintHeader(snap);
        paintRail(snap);
        paintAlert(snap);
        paintSteps(snap);
        paintWeight(snap);
        paintProcessor(snap);
        paintCooling(snap);
        paintMill(snap);
        paintUtilities(snap);
        paintConnectors(snap);
        paintDetail(snap);
    }

    function select(id) {
        if (!id || id === selected) return;
        selected = id;
        detailKey = "";
        if (lastSnap) paint(lastSnap);
    }

    document.getElementById("rail").addEventListener("click", function (event) {
        var item = event.target.closest(".rail-item");
        if (!item) return;
        select(item.dataset.id);
    });

    document.querySelector(".stage").addEventListener("click", function (event) {
        var item = event.target.closest("[data-id]");
        if (!item) return;
        select(item.dataset.id);
    });

    var sim = MixingSim.create();
    window.__mixingSim = sim;
    sim.on(paint);
    sim.start();
    document.getElementById("playPause").addEventListener("click", function () {
        sim.toggle();
    });
})();
