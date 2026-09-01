/* Boston turnout.
   Reads data/elections.json, then one election's turnout.json and
   precincts.geojson. Everything on the page comes from those files. */
(function () {
  "use strict";

  var RAMP = ["--c1", "--c2", "--c3", "--c4", "--c5", "--c6"];
  var NO_DATA = "--c0";
  var STILL = matchMedia("(prefers-reduced-motion: reduce)").matches;

  var el = function (id) { return document.getElementById(id); };
  var css = function (name) {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  };

  var state = {
    election: null,
    geo: null,
    snapshot: 0,
    breaks: [],
    rows: [],
    sort: { key: "rate", dir: -1 },
    filter: "",
    picked: null,
    map: null,
    layer: null,
    tiles: null,
    frame: null,
    shapes: {},
    noteOf: {}
  };

  /* ---------- numbers ---------- */

  var commas = new Intl.NumberFormat("en-US");

  function pct(value, places) {
    if (value === null || value === undefined) return "—";
    return (value * 100).toFixed(places === undefined ? 1 : places) + "%";
  }

  /* Class breaks stay fixed for the whole election, so a shade means the same
     turnout at 9:00 in the morning as it does at 8:00 at night, and the map
     visibly fills in through the day.

     The top class is open ended, so the highest turnout in the election should
     land near the last break. Pick the round step that puts it there. */
  function niceBreaks(highest) {
    var steps = [0.5, 1, 2, 2.5, 5, 10, 15, 20, 25];
    var want = (highest * 100) / (RAMP.length - 1);
    var step = steps.reduce(function (best, candidate) {
      return Math.abs(candidate - want) < Math.abs(best - want) ? candidate : best;
    }, steps[0]);
    return RAMP.map(function (_, n) { return (n * step) / 100; });
  }

  function bandOf(rate) {
    if (rate === null || rate === undefined) return -1;
    var band = 0;
    for (var i = 0; i < state.breaks.length; i++) {
      if (rate >= state.breaks[i]) band = i;
    }
    return band;
  }

  function shadeOf(rate) {
    var band = bandOf(rate);
    return css(band < 0 ? NO_DATA : RAMP[band]);
  }

  /* ---------- rows ---------- */

  function snapshot() { return state.election.snapshots[state.snapshot]; }

  function buildRows() {
    var counts = snapshot().counts;
    var registered = state.election.registered;
    state.rows = Object.keys(counts).map(function (id) {
      var reg = registered[id];
      var count = counts[id];
      return {
        id: id,
        ward: parseInt(id.slice(0, 2), 10),
        precinct: parseInt(id.slice(2), 10),
        count: count,
        registered: reg === undefined ? null : reg,
        rate: reg ? count / reg : null
      };
    });
  }

  function wardRows() {
    var byWard = {};
    state.rows.forEach(function (row) {
      var w = byWard[row.ward] || (byWard[row.ward] = { ward: row.ward, count: 0, registered: 0 });
      w.count += row.count;
      w.registered += row.registered || 0;
    });
    return Object.keys(byWard)
      .map(function (k) {
        var w = byWard[k];
        w.rate = w.registered ? w.count / w.registered : null;
        return w;
      })
      .sort(function (a, b) { return a.ward - b.ward; });
  }

  /* ---------- hero ---------- */

  function rollTo(node, target) {
    var from = parseInt(String(node.textContent).replace(/[^0-9]/g, ""), 10);
    if (STILL || isNaN(from) || from === target) {
      node.textContent = commas.format(target);
      return;
    }
    var started = performance.now();
    var span = 420;
    (function step(now) {
      var t = Math.min(1, (now - started) / span);
      var eased = 1 - Math.pow(1 - t, 3);
      node.textContent = commas.format(Math.round(from + (target - from) * eased));
      if (t < 1) requestAnimationFrame(step);
    })(started);
  }

  function drawHero() {
    var shot = snapshot();
    var total = state.election.registeredTotal;
    rollTo(el("count"), shot.total);
    el("share").textContent = pct(total ? shot.total / total : null);
    el("registered").textContent = commas.format(total);
    var when = new Date(shot.time);
    var stamp = el("asof");
    stamp.textContent = shot.label + " on " + when.toLocaleDateString("en-US", {
      month: "long", day: "numeric", year: "numeric", timeZone: state.election.timezone
    });
    stamp.dateTime = shot.time;

    var flag = el("hero-ref");
    flag.textContent = "";
    state.election.corrections
      .filter(function (fix) { return fix.snapshot === shot.id; })
      .forEach(function (fix) {
        var number = state.noteOf[fix.precinct];
        if (!number) return;
        flag.append(document.createTextNode(" \u00b7 one corrected figure"),
          refTo(number, "the corrected figure"));
      });
  }

  /* ---------- day strip ---------- */

  function drawStrip() {
    var strip = el("strip");
    var total = state.election.registeredTotal;
    var peak = Math.max.apply(null, state.election.snapshots.map(function (s) { return s.total; }));
    strip.textContent = "";

    state.election.snapshots.forEach(function (shot, index) {
      var on = index === state.snapshot;
      var tick = document.createElement("button");
      tick.type = "button";
      tick.className = "tick";
      tick.setAttribute("role", "radio");
      tick.setAttribute("aria-checked", on ? "true" : "false");
      tick.tabIndex = on ? 0 : -1;
      tick.setAttribute("aria-label",
        shot.label + ", " + commas.format(shot.total) + " ballots, " +
        pct(total ? shot.total / total : null) + " of registered voters");

      var fill = document.createElement("span");
      fill.className = "tick-fill";
      fill.setAttribute("aria-hidden", "true");
      var bar = document.createElement("i");
      bar.style.transform = "scaleY(" + Math.max(0.04, shot.total / peak).toFixed(4) + ")";
      fill.appendChild(bar);

      var time = document.createElement("span");
      time.className = "tick-time";
      time.textContent = shot.label;

      var count = document.createElement("span");
      count.className = "tick-count";
      count.textContent = commas.format(shot.total);

      var share = document.createElement("span");
      share.className = "tick-share";
      share.textContent = pct(total ? shot.total / total : null);

      tick.append(fill, time, count, share);
      tick.addEventListener("click", function () { pick(index); });
      tick.addEventListener("keydown", function (event) {
        var step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
        if (!step) return;
        event.preventDefault();
        var next = (state.snapshot + step + state.election.snapshots.length) %
          state.election.snapshots.length;
        pick(next);
        strip.children[next].focus();
      });
      strip.appendChild(tick);
    });
  }

  function pick(index) {
    if (index === state.snapshot) return;
    state.snapshot = index;
    buildRows();
    drawHero();
    drawStrip();
    shadeMap();
    drawWards();
    drawLedger();
    drawRank();
    if (state.picked) showPicked(state.picked);
  }

  /* ---------- map ---------- */

  /* Esri's Gray Canvas is built to sit under thematic shading and needs no
     API key. Light and dark share one attribution. */
  var DARK = matchMedia("(prefers-color-scheme: dark)");
  var TILE_ATTR = "Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ";

  function tileUrl() {
    return "https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/" +
      (DARK.matches ? "World_Dark_Gray_Base" : "World_Light_Gray_Base") +
      "/MapServer/tile/{z}/{y}/{x}";
  }

  function addTiles() {
    if (state.tiles) state.map.removeLayer(state.tiles);
    state.tiles = L.tileLayer(tileUrl(), {
      maxZoom: 16, minZoom: 9, attribution: TILE_ATTR
    }).addTo(state.map);
    state.tiles.bringToBack();
  }

  function buildMap() {
    var b = state.election.bounds;
    var map = L.map("map", {
      zoomControl: true,
      scrollWheelZoom: false,
      attributionControl: true,
      /* Whole zoom levels double the scale, which would leave the city
         floating in a frame twice the size it needs. */
      zoomSnap: 0.1,
      zoomDelta: 0.5
    });
    state.map = map;
    state.frame = null;

    var frame = [[b[1], b[0]], [b[3], b[2]]];
    function fit() { map.invalidateSize(); map.fitBounds(frame, { padding: [10, 10] }); }
    fit();

    addTiles();

    /* The wheel belongs to the page until the reader commits to the map. */
    map.on("click focus", function () { map.scrollWheelZoom.enable(); });
    map.getContainer().addEventListener("mouseleave", function () {
      map.scrollWheelZoom.disable();
    });

    /* The container has no final size until fonts and layout settle, and a
       map fitted before that opens far too wide. Fit once more when it does. */
    requestAnimationFrame(fit);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fit);

    var settled = false;
    if (window.ResizeObserver) {
      new ResizeObserver(function () {
        if (settled) { map.invalidateSize(); return; }
        settled = true;
        fit();
      }).observe(map.getContainer());
    }
    addEventListener("resize", function () { map.invalidateSize(); });

    state.layer = L.geoJSON(state.geo, {
      style: function () {
        return { weight: 0.6, color: "#ffffff", opacity: 0.7, fillOpacity: 0.82 };
      },
      onEachFeature: function (feature, shape) {
        var id = feature.properties.id;
        state.shapes[id] = shape;
        shape.on("click", function () { showPicked(id); highlight(id, true); });
        shape.on("mouseover", function () { shape.setStyle({ weight: 2.2, color: "#16202B" }); });
        shape.on("mouseout", function () {
          if (state.picked !== id) shape.setStyle({ weight: 0.6, color: "#ffffff" });
        });
      }
    }).addTo(map);

    shadeMap();
    drawLegend();
  }

  function shadeMap() {
    if (!state.layer) return;
    var byId = {};
    state.rows.forEach(function (row) { byId[row.id] = row; });
    state.layer.eachLayer(function (shape) {
      var row = byId[shape.feature.properties.id];
      shape.setStyle({ fillColor: shadeOf(row ? row.rate : null) });
      shape.bindTooltip(tooltipFor(row, shape.feature.properties), { sticky: true });
    });
  }

  function tooltipFor(row, props) {
    var name = "W" + props.ward + " · P" + props.precinct;
    if (!row) return name + " — no figures";
    if (row.rate === null) return name + " — no registered voters";
    return name + " — " + commas.format(row.count) + " of " +
      commas.format(row.registered) + " (" + pct(row.rate) + ")";
  }

  function drawLegend() {
    var legend = el("legend");
    legend.textContent = "";
    var title = document.createElement("span");
    title.className = "legend-title";
    title.textContent = "Turnout";
    legend.appendChild(title);

    state.breaks.forEach(function (low, index) {
      var high = state.breaks[index + 1];
      var row = document.createElement("span");
      row.className = "legend-row";
      var chip = document.createElement("i");
      chip.style.background = css(RAMP[index]);
      var label = document.createElement("span");
      label.textContent = high === undefined
        ? pct(low, 0) + " and above"
        : pct(low, 0) + " to " + pct(high, 0);
      row.append(chip, label);
      legend.appendChild(row);
    });
  }

  function highlight(id, fly) {
    Object.keys(state.shapes).forEach(function (key) {
      state.shapes[key].setStyle({ weight: 0.6, color: "#ffffff" });
    });
    var shape = state.shapes[id];
    if (!shape) return;
    shape.setStyle({ weight: 2.6, color: "#16202B" });
    shape.bringToFront();
    if (fly) return;
    state.map.fitBounds(shape.getBounds(), { maxZoom: 15, padding: [40, 40] });
  }

  function drawRank() {
    var list = el("rank");
    list.textContent = "";
    state.rows
      .filter(function (row) { return row.rate !== null; })
      .sort(function (a, b) { return b.rate - a.rate; })
      .slice(0, 6)
      .forEach(function (row) {
        var item = document.createElement("li");
        var button = document.createElement("button");
        button.type = "button";

        var chip = document.createElement("span");
        chip.className = "swatch";
        chip.style.background = shadeOf(row.rate);
        chip.style.marginInlineEnd = "0";

        var who = document.createElement("span");
        who.className = "who";
        who.textContent = "W" + row.ward + " \u00b7 P" + row.precinct;

        var value = document.createElement("span");
        value.className = "val";
        value.textContent = pct(row.rate);

        button.append(chip, who, value);
        button.setAttribute("aria-label",
          "Ward " + row.ward + " Precinct " + row.precinct + ", " +
          pct(row.rate) + " turnout. Show on the map.");
        button.addEventListener("click", function () {
          showPicked(row.id);
          highlight(row.id);
        });
        item.appendChild(button);
        list.appendChild(item);
      });
  }

  function showPicked(id) {
    state.picked = id;
    var row = state.rows.filter(function (r) { return r.id === id; })[0];
    var box = el("picked");
    box.hidden = false;
    box.textContent = "";

    var chip = document.createElement("span");
    chip.className = "picked-chip";
    chip.style.background = shadeOf(row ? row.rate : null);

    var text = document.createElement("div");
    var head = document.createElement("h3");
    head.textContent = "Ward " + parseInt(id.slice(0, 2), 10) +
      ", Precinct " + parseInt(id.slice(2), 10);
    var line = document.createElement("p");
    line.textContent = !row ? "No figures reported."
      : row.rate === null
        ? commas.format(row.count) + " ballots. No registered voters recorded here."
        : commas.format(row.count) + " of " + commas.format(row.registered) +
          " registered voters, " + pct(row.rate) + " at " + snapshot().label;
    text.append(head, line);
    box.append(chip, text);

    document.querySelectorAll("#precincts tbody tr").forEach(function (tr) {
      var on = tr.dataset.id === id;
      tr.classList.toggle("on", on);
      if (on) tr.scrollIntoView({ block: "nearest", behavior: STILL ? "auto" : "smooth" });
    });
  }

  /* ---------- tables ---------- */

  function cell(text, className) {
    var td = document.createElement("td");
    if (className) td.className = className;
    td.textContent = text;
    return td;
  }

  function drawWards() {
    var body = el("wards").tBodies[0];
    body.textContent = "";
    var peak = 0;
    var rows = wardRows();
    rows.forEach(function (w) { if (w.rate > peak) peak = w.rate; });

    rows.forEach(function (w) {
      var tr = document.createElement("tr");
      var head = document.createElement("th");
      head.scope = "row";
      var chip = document.createElement("span");
      chip.className = "swatch";
      chip.style.background = shadeOf(w.rate);
      head.append(chip, document.createTextNode("Ward " + w.ward));
      Object.keys(state.noteOf).forEach(function (id) {
        if (parseInt(id.slice(0, 2), 10) === w.ward) {
          head.appendChild(refTo(state.noteOf[id], "ward " + w.ward));
        }
      });
      tr.append(
        head,
        cell(commas.format(w.count), "num"),
        cell(commas.format(w.registered), "num"),
        cell(pct(w.rate), "num")
      );
      var barCell = document.createElement("td");
      barCell.className = "bar-col";
      var bar = document.createElement("span");
      bar.className = "bar";
      var fill = document.createElement("i");
      fill.style.width = peak ? (w.rate / peak) * 100 + "%" : "0";
      fill.style.background = shadeOf(w.rate);
      bar.appendChild(fill);
      barCell.appendChild(bar);
      tr.appendChild(barCell);
      body.appendChild(tr);
    });
  }

  function sorted() {
    var key = state.sort.key;
    var dir = state.sort.dir;
    return state.rows.slice().sort(function (a, b) {
      var x = a[key];
      var y = b[key];
      if (x === null) return 1;
      if (y === null) return -1;
      if (x === y) return a.id < b.id ? -1 : 1;
      return (x < y ? -1 : 1) * dir;
    });
  }

  /* Accepts a ward number, a precinct code, or the shorthand the table shows:
     "8", "ward 8", "w8", "0803", "w8 p3". Anything else matches nothing, so
     the reader sees the empty state instead of the whole city. */
  function matches(row, needle) {
    if (!needle) return true;
    var text = needle.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (!text) return true;

    if (/^[0-9]+$/.test(text)) {
      if (text.length >= 3) return row.id.indexOf(text) === 0;
      return row.ward === parseInt(text, 10);
    }

    return [
      "w" + row.ward + "p" + row.precinct,
      "ward" + row.ward + "precinct" + row.precinct,
      "ward" + row.ward,
      "w" + row.ward
    ].some(function (form) { return form.indexOf(text) === 0; });
  }

  function drawLedger() {
    var table = el("precincts");
    var body = table.tBodies[0];
    body.textContent = "";

    table.querySelectorAll("thead th").forEach(function (th) {
      var button = th.querySelector("button");
      if (!button) return;
      if (button.dataset.sort === state.sort.key) {
        th.setAttribute("aria-sort", state.sort.dir === 1 ? "ascending" : "descending");
      } else {
        th.removeAttribute("aria-sort");
      }
    });

    var rows = sorted().filter(function (row) { return matches(row, state.filter); });
    el("rowcount").textContent = rows.length === state.rows.length
      ? state.rows.length + " precincts"
      : rows.length + " of " + state.rows.length + " precincts";

    if (!rows.length) {
      var tr = document.createElement("tr");
      var td = document.createElement("td");
      td.colSpan = 4;
      td.className = "empty";
      td.textContent = "No precinct matches that. Try a ward number, such as 8.";
      tr.appendChild(td);
      body.appendChild(tr);
      return;
    }

    var fragment = document.createDocumentFragment();
    rows.forEach(function (row) {
      var tr = document.createElement("tr");
      tr.dataset.id = row.id;
      if (row.id === state.picked) tr.className = "on";

      var head = document.createElement("th");
      head.scope = "row";
      head.className = "code";
      var chip = document.createElement("span");
      chip.className = "swatch";
      chip.style.background = shadeOf(row.rate);
      var strong = document.createElement("b");
      strong.textContent = "W" + row.ward;
      var rest = document.createElement("span");
      rest.textContent = " · P" + row.precinct;
      head.append(chip, strong, rest);

      tr.append(
        head,
        cell(commas.format(row.count), "num"),
        cell(row.registered === null ? "—" : commas.format(row.registered), "num"),
        cell(pct(row.rate), "num")
      );
      tr.addEventListener("click", function () {
        showPicked(row.id);
        highlight(row.id);
        el("map").scrollIntoView({ block: "center", behavior: STILL ? "auto" : "smooth" });
      });
      fragment.appendChild(tr);
    });
    body.appendChild(fragment);
  }

  /* ---------- footnotes ---------- */

  function para(html) {
    var p = document.createElement("p");
    p.innerHTML = html;
    return p;
  }

  function note(number, title, parts, className) {
    var item = document.createElement("li");
    item.id = "note-" + number;
    if (className) item.className = className;

    var marker = document.createElement("span");
    marker.className = "note-n";
    marker.textContent = number;

    var body = document.createElement("div");
    body.className = "note-body";
    var head = document.createElement("h3");
    head.textContent = title;
    body.appendChild(head);
    parts.forEach(function (part) { body.appendChild(part); });

    item.append(marker, body);
    return item;
  }

  /* A superscript number that jumps to the note explaining a figure. */
  function refTo(number, what) {
    var link = document.createElement("a");
    link.className = "ref";
    link.href = "#note-" + number;
    link.textContent = number;
    link.setAttribute("aria-label", "Note " + number + " about " + what);
    return link;
  }

  function drawNotes() {
    var list = el("notes-body");
    var e = state.election;
    list.textContent = "";
    state.noteOf = {};
    var n = 0;

    list.appendChild(note(++n, "Turnout figures", [
      para("The <strong>" + e.source.office + "</strong> sends a workbook of " +
        "ward and precinct counts at intervals through election day. This page " +
        "holds <strong>" + e.snapshots.length + "</strong> of them."),
      para('<span class="files">' + e.snapshots.map(function (shot) {
        return shot.label + " &mdash; " + shot.source;
      }).join("<br>") + "</span>")
    ]));

    list.appendChild(note(++n, "Registered voters", [
      para("The department does not send the number of registered voters. " +
        "It sends a count and a percentage for each precinct. The count " +
        "divided by the percentage gives the number of registered voters."),
      para("Every workbook gives the same answer for each precinct. That " +
        "agreement is the check that the method is correct. The city total " +
        "is <strong>" + commas.format(e.registeredTotal) + "</strong>."),
      para("One precinct covers the harbor islands. It records no registered " +
        "voters, so it has no turnout figure. The map shows it in grey.")
    ]));

    list.appendChild(note(++n, "Precinct boundaries", [
      para('<a href="' + e.boundaries.url + '">' + e.boundaries.title + "</a>, " +
        "published by " + e.boundaries.publisher + ", retrieved " +
        e.boundaries.retrieved + "."),
      para("Every precinct in the boundary file matches a precinct in the " +
        "workbooks. No precinct is left over on either side."),
      para("Licence: " + e.boundaries.license + ".")
    ]));

    e.corrections.forEach(function (fix) {
      var number = ++n;
      var ward = parseInt(fix.precinct.slice(0, 2), 10);
      var precinct = parseInt(fix.precinct.slice(2), 10);
      var shot = e.snapshots.filter(function (item) { return item.id === fix.snapshot; })[0];
      state.noteOf[fix.precinct] = number;

      var effect = document.createElement("p");
      var box = document.createElement("span");
      box.className = "effect";
      box.textContent = "Ward " + ward + ", Precinct " + precinct + " at " +
        (shot ? shot.label : fix.snapshot) + ": " + fix.effect + ".";
      effect.appendChild(box);

      list.appendChild(note(number,
        "Corrected figure, Ward " + ward,
        [para(fix.reason), effect], "corrected"));
    });

    el("foot-source").textContent =
      "Turnout from the " + e.source.office + ". Boundaries from " +
      e.boundaries.publisher + ".";
  }

  /* ---------- wiring ---------- */

  function bindControls() {
    el("precincts").querySelectorAll("thead button").forEach(function (button) {
      button.addEventListener("click", function () {
        var key = button.dataset.sort;
        if (state.sort.key === key) {
          state.sort.dir *= -1;
        } else {
          state.sort.key = key;
          state.sort.dir = key === "id" ? 1 : -1;
        }
        drawLedger();
      });
    });

    var box = el("filter");
    var timer;
    box.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        state.filter = box.value.trim();
        drawLedger();
      }, 120);
    });
  }

  /* Colours come from CSS custom properties, so a theme change has to redraw
     the shapes, the legend and the swatches. */
  function followTheme() {
    DARK.addEventListener("change", function () {
      if (!state.map) return;
      addTiles();
      shadeMap();
      drawLegend();
      drawWards();
      drawLedger();
      drawRank();
      if (state.picked) showPicked(state.picked);
    });
  }

  function render(election, geo) {
    state.election = election;
    state.geo = geo;
    state.snapshot = election.snapshots.length - 1;

    var highest = 0;
    election.snapshots.forEach(function (shot) {
      Object.keys(shot.counts).forEach(function (id) {
        var reg = election.registered[id];
        if (reg) highest = Math.max(highest, shot.counts[id] / reg);
      });
    });
    state.breaks = niceBreaks(highest);

    document.title = election.jurisdiction.split(",")[0] + " turnout — " + election.name;
    el("place").textContent = election.jurisdiction;
    el("election-name").textContent = election.name;

    buildRows();
    drawNotes();
    drawHero();
    drawStrip();
    drawWards();
    drawLedger();
    drawRank();
    buildMap();
  }

  function fail(message) {
    var hero = document.querySelector(".hero .wrap");
    hero.textContent = "";
    var p = document.createElement("p");
    p.className = "hero-line";
    p.textContent = message;
    hero.appendChild(p);
  }

  function loadElection(id) {
    var base = "data/" + id + "/";
    return Promise.all([
      fetch(base + "turnout.json").then(function (r) { return r.json(); }),
      fetch(base + "precincts.geojson").then(function (r) { return r.json(); })
    ]);
  }

  function start() {
    bindControls();
    followTheme();
    fetch("data/elections.json")
      .then(function (r) { return r.json(); })
      .then(function (index) {
        var list = index.elections;
        if (!list.length) throw new Error("no elections");

        if (list.length > 1) {
          var pickBox = el("election-pick");
          var select = el("election-select");
          pickBox.hidden = false;
          list.forEach(function (item) {
            var option = document.createElement("option");
            option.value = item.id;
            option.textContent = item.name + " — " + item.date;
            select.appendChild(option);
          });
          select.addEventListener("change", function () {
            loadElection(select.value).then(function (parts) {
              state.map.remove();
              state.map = null;
              state.shapes = {};
              state.picked = null;
              el("picked").hidden = true;
              render(parts[0], parts[1]);
            });
          });
        }

        return loadElection(list[0].id).then(function (parts) {
          render(parts[0], parts[1]);
        });
      })
      .catch(function () {
        fail("The turnout files did not load. Reload the page, or read " +
          "data/elections.json directly.");
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start);
  } else {
    start();
  }
})();
