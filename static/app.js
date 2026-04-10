/* BACKGROUND CANVAS */
(function () {
  const canvas = document.getElementById("bgCanvas");
  const ctx = canvas.getContext("2d");
  let W;
  let H;
  let nodes = [];

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }

  function initNodes() {
    nodes = Array.from({ length: 38 }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.28,
      vy: (Math.random() - 0.5) * 0.28,
      r: Math.random() * 1.8 + 0.5,
    }));
  }

  function draw() {
    ctx.clearRect(0, 0, W, H);

    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const dx = nodes[i].x - nodes[j].x;
        const dy = nodes[i].y - nodes[j].y;
        const dist = Math.hypot(dx, dy);
        if (dist < 160) {
          ctx.beginPath();
          ctx.strokeStyle = `rgba(0, 184, 212, ${0.06 * (1 - dist / 160)})`;
          ctx.lineWidth = 0.5;
          ctx.moveTo(nodes[i].x, nodes[i].y);
          ctx.lineTo(nodes[j].x, nodes[j].y);
          ctx.stroke();
        }
      }
    }

    nodes.forEach((n) => {
      ctx.beginPath();
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0, 229, 255, 0.5)";
      ctx.fill();
    });

    nodes.forEach((n) => {
      n.x += n.vx;
      n.y += n.vy;
      if (n.x < 0 || n.x > W) n.vx *= -1;
      if (n.y < 0 || n.y > H) n.vy *= -1;
    });

    requestAnimationFrame(draw);
  }

  resize();
  initNodes();
  draw();
  window.addEventListener("resize", () => {
    resize();
    initNodes();
  });
}());

/* APP STATE */
const state = {
  devices: [],
  filtered: [],
  selectedIp: null,
  accessCache: {},
  sortKey: "ip",
  sortAsc: true,
  mode: "auto",
  scanning: false,
};

/* DOM REFS */
const $ = (id) => document.getElementById(id);
const refs = {
  scanBtn: $("scanBtn"),
  clearBtn: $("clearBtn"),
  accessBtn: $("accessBtn"),
  exportBtn: $("exportBtn"),
  subnetInput: $("subnet"),
  timeoutInput: $("timeout"),
  workersInput: $("workers"),
  filterInput: $("filterInput"),
  statusIcon: $("statusIcon"),
  statusMsg: $("statusMsg"),
  statusCode: $("statusCode"),
  sSub: $("sSub"),
  sCount: $("sCount"),
  sMode: $("sMode"),
  sDur: $("sDur"),
  tblBody: $("tblBody"),
  detailIp: $("detailIp"),
  detailMac: $("detailMac"),
  detailHost: $("detailHost"),
  detailStatus: $("detailStatus"),
  detailAccess: $("detailAccess"),
  detailNote: $("detailNote"),
  termLine1: $("termLine1"),
  termLine2: $("termLine2"),
};

/* STATUS */
const statusLabels = { idle: "IDLE", running: "SCANNING", ok: "COMPLETE", error: "ERROR" };

function setStatus(msg, type = "idle") {
  refs.statusIcon.className = `status-icon ${type}`;
  refs.statusMsg.textContent = msg;
  refs.statusCode.textContent = statusLabels[type] || "IDLE";
}

/* TERMINAL FEEDBACK */
function termLog(line1, line2) {
  refs.termLine1.textContent = line1;
  refs.termLine2.textContent = line2;
}

function getSelectedDevice() {
  return state.devices.find((d) => d.ip === state.selectedIp) || null;
}

function renderAccessResults(deviceIp) {
  const results = state.accessCache[deviceIp] || [];
  if (!results.length) {
    refs.detailAccess.innerHTML = `<li>No common service ports detected as open yet.</li>`;
    return;
  }

  refs.detailAccess.innerHTML = results
    .map((item) => `<li>${item.label} ${item.open ? "(open)" : "(closed)"}</li>`)
    .join("");
}

function updateSelectedDetails() {
  const device = getSelectedDevice();
  if (!device) {
    refs.detailIp.textContent = "-";
    refs.detailMac.textContent = "-";
    refs.detailHost.textContent = "-";
    refs.detailStatus.textContent = "No device selected";
    refs.detailNote.textContent = "Select a device to check what it is accessible for.";
    refs.detailAccess.innerHTML = `<li>Select a device and run Access Check.</li>`;
    refs.accessBtn.disabled = true;
    return;
  }

  refs.detailIp.textContent = device.ip || "-";
  refs.detailMac.textContent = device.mac || "-";
  refs.detailHost.textContent = device.hostname || "-";
  refs.detailStatus.textContent = "Online (last scan)";
  refs.detailNote.textContent = "Access check tests common local service ports only.";
  refs.accessBtn.disabled = false;
  renderAccessResults(device.ip);
}

/* IP SORT */
function ipToArr(ip) {
  return (ip || "0.0.0.0").split(".").map(Number);
}

/* SORT AND FILTER */
function applyFilterAndSort() {
  const q = refs.filterInput.value.trim().toLowerCase();

  state.filtered = state.devices.filter((d) => {
    if (!q) return true;
    return [d.ip, d.mac, d.hostname].some((v) => String(v || "").toLowerCase().includes(q));
  });

  state.filtered.sort((a, b) => {
    let r = 0;
    if (state.sortKey === "ip") {
      const la = ipToArr(a.ip);
      const lb = ipToArr(b.ip);
      for (let i = 0; i < 4; i += 1) {
        if (la[i] !== lb[i]) {
          r = la[i] - lb[i];
          break;
        }
      }
    } else {
      r = String(a[state.sortKey] || "").localeCompare(String(b[state.sortKey] || ""));
    }
    return state.sortAsc ? r : -r;
  });

  renderTable();
}

/* TABLE RENDER */
function renderTable() {
  if (!state.filtered.length) {
    refs.tblBody.innerHTML = `<tr class="empty-row"><td colspan="4">
      <div class="empty-state">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" opacity="0.3">
          <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6" opacity="0.5"/><circle cx="12" cy="12" r="2" opacity="0.7"/>
        </svg>
        <p>${state.devices.length ? "No matching devices." : "No devices found yet."}</p>
        <p class="empty-sub">${state.devices.length ? "Try adjusting your filter." : "Run a scan to discover devices on your network."}</p>
      </div>
    </td></tr>`;
    refs.accessBtn.disabled = true;
    return;
  }

  refs.tblBody.innerHTML = state.filtered
    .map((d, i) => {
      const sel = state.selectedIp === d.ip;
      return `<tr class="${sel ? "selected" : ""}" style="animation-delay:${i * 0.03}s">
        <td class="td-ip">${d.ip}</td>
        <td class="td-mac mono">${d.mac || "-"}</td>
        <td class="td-host">${d.hostname || "-"}</td>
        <td class="td-action">
          <button class="sel-btn${sel ? " selected" : ""}" data-ip="${d.ip}">
            ${sel ? "Selected" : "View"}
          </button>
        </td>
      </tr>`;
    })
    .join("");

  refs.accessBtn.disabled = !state.selectedIp;
}

/* UPDATE STATS */
function updateStats(data) {
  refs.sSub.textContent = data.subnet || "-";
  refs.sCount.textContent = String(data.count ?? 0);
  refs.sMode.textContent = data.mode || state.mode;
  refs.sDur.textContent = `${Number(data.durationSec || 0).toFixed(2)}s`;
}

/* MODE SWITCHER */
function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll(".nav-chip").forEach((chip) => {
    chip.classList.toggle("active", chip.dataset.mode === mode);
  });
  refs.sMode.textContent = mode;
  termLog(`$ netscan --${mode}`, `Mode set: ${mode}_`);
}

/* SORT HEADER HIGHLIGHT */
function updateSortHeaders() {
  document.querySelectorAll("th.sortable").forEach((th) => {
    const key = th.dataset.key;
    th.classList.remove("asc", "desc");
    if (key === state.sortKey) {
      th.classList.add(state.sortAsc ? "asc" : "desc");
      const arrow = th.querySelector(".sort-arrow");
      if (arrow) arrow.textContent = state.sortAsc ? "↑" : "↓";
    } else {
      const arrow = th.querySelector(".sort-arrow");
      if (arrow) arrow.textContent = "↕";
    }
  });
}

/* SCAN */
async function runScan() {
  if (state.scanning) return;
  state.scanning = true;
  document.body.classList.add("scanning");

  const mode = state.mode;
  setStatus(`Sweeping ${mode} network for active hosts...`, "running");
  termLog(`$ netscan --${mode} --timeout ${refs.timeoutInput.value}`, "Probing hosts...");
  refs.scanBtn.disabled = true;

  const body = {
    mode,
    subnet: refs.subnetInput.value.trim() || undefined,
    timeout: Number(refs.timeoutInput.value || 250),
    workers: Number(refs.workersInput.value || 96),
  };

  try {
    const res = await fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    let data = {};
    try {
      data = await res.json();
    } catch {
      data = {};
    }

    if (!res.ok || !data.ok) {
      throw new Error(data.error || `HTTP ${res.status}`);
    }

    state.devices = data.devices || [];
    state.selectedIp = null;
    state.accessCache = {};
    applyFilterAndSort();
    updateSelectedDetails();
    updateStats(data);

    const t = new Date((data.scannedAt || Date.now() / 1000) * 1000).toLocaleTimeString();
    setStatus(`${data.count} device(s) found via ${data.mode || mode} - completed at ${t}`, "ok");
    termLog(`$ scan complete: ${data.count} host(s)`, `duration: ${Number(data.durationSec || 0).toFixed(2)}s_`);
  } catch (err) {
    setStatus(`Error: ${err.message}`, "error");
    termLog("$ scan failed", `err: ${err.message}_`);
  } finally {
    state.scanning = false;
    document.body.classList.remove("scanning");
    refs.scanBtn.disabled = false;
  }
}

/* ACCESS CHECK */
async function checkAccess() {
  const device = getSelectedDevice();
  if (!device) {
    setStatus("No device selected.", "error");
    return;
  }

  refs.accessBtn.disabled = true;
  setStatus(`Checking common access on ${device.ip}...`, "running");
  termLog(`$ access-check --ip ${device.ip}`, "Probing common service ports...");

  try {
    const res = await fetch("/api/access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ip: device.ip }),
    });

    let data = {};
    try {
      data = await res.json();
    } catch {
      data = {};
    }

    if (!res.ok || !data.ok) throw new Error(data.error || `HTTP ${res.status}`);

    state.accessCache[device.ip] = data.access || [];
    renderAccessResults(device.ip);
    setStatus(data.message || "Access check complete.", "ok");
    termLog(`$ access-check done: ${device.ip}`, `${(data.access || []).length} checks_`);
  } catch (err) {
    setStatus(`Error: ${err.message}`, "error");
    termLog("$ access-check failed", `err: ${err.message}_`);
  } finally {
    refs.accessBtn.disabled = !state.selectedIp;
  }
}

/* EXPORT CSV */
function exportCsv() {
  if (!state.filtered.length) {
    setStatus("Nothing to export.", "error");
    return;
  }
  const lines = ["ip,mac,hostname"];
  state.filtered.forEach((d) => {
    const s = (v) => `"${String(v || "-").replaceAll('"', '""')}"`;
    lines.push([s(d.ip), s(d.mac), s(d.hostname)].join(","));
  });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" }));
  a.download = "netscan_results.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(a.href);
  termLog("$ export csv", `${state.filtered.length} records written_`);
}

/* LOAD DEFAULTS */
async function loadDefaults() {
  try {
    const res = await fetch("/api/defaults");
    const data = await res.json();
    if (data.ok) {
      refs.subnetInput.placeholder = `Auto (${data.defaultSubnet})`;
      $("subnetHint").textContent = `Detected: ${data.defaultSubnet}`;
      refs.timeoutInput.value = data.defaultTimeout;
      refs.workersInput.value = data.defaultWorkers;
      refs.sSub.textContent = data.defaultSubnet;
      termLog("$ netscan --auto", `subnet: ${data.defaultSubnet}_`);
    }
  } catch {
    termLog("$ netscan --auto", "defaults unavailable_");
  }
}

/* EVENT LISTENERS */
document.querySelectorAll(".nav-chip").forEach((chip) => {
  chip.addEventListener("click", () => setMode(chip.dataset.mode));
});

refs.scanBtn.addEventListener("click", runScan);

refs.clearBtn.addEventListener("click", () => {
  state.devices = [];
  state.filtered = [];
  state.selectedIp = null;
  state.accessCache = {};
  refs.filterInput.value = "";
  updateStats({ subnet: "-", count: 0, durationSec: 0 });
  renderTable();
  updateSelectedDetails();
  setStatus("Results cleared.", "idle");
  termLog("$ clear", "ready_");
});

refs.tblBody.addEventListener("click", (e) => {
  const btn = e.target.closest(".sel-btn[data-ip]");
  if (!btn) return;
  const ip = btn.dataset.ip;
  // Keep one active selection; clicking the same row should not clear it.
  state.selectedIp = ip;
  applyFilterAndSort();
  updateSelectedDetails();
});

refs.accessBtn.addEventListener("click", checkAccess);
refs.exportBtn.addEventListener("click", exportCsv);
refs.filterInput.addEventListener("input", applyFilterAndSort);

document.querySelectorAll("th.sortable").forEach((th) => {
  th.addEventListener("click", () => {
    const key = th.dataset.key;
    if (!key) return;
    if (state.sortKey === key) {
      state.sortAsc = !state.sortAsc;
    } else {
      state.sortKey = key;
      state.sortAsc = true;
    }
    updateSortHeaders();
    applyFilterAndSort();
  });
});

setMode("auto");
loadDefaults();
updateSelectedDetails();
