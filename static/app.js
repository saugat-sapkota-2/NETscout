const state = {
  devices: [],
  filtered: [],
  selectedIp: null,
  detailLogs: [],
  sortKey: "ip",
  sortAsc: true,
};

const refs = {
  form: document.getElementById("scan-form"),
  scanWifiBtn: document.getElementById("scan-wifi-btn"),
  scanLanBtn: document.getElementById("scan-lan-btn"),
  scanAutoBtn: document.getElementById("scan-auto-btn"),
  clearBtn: document.getElementById("clear-btn"),
  exportBtn: document.getElementById("export-btn"),
  subnetInput: document.getElementById("subnet"),
  timeoutInput: document.getElementById("timeout"),
  workersInput: document.getElementById("workers"),
  filterInput: document.getElementById("filter-input"),
  status: document.getElementById("status"),
  subnetStat: document.getElementById("subnet-stat"),
  countStat: document.getElementById("count-stat"),
  modeStat: document.getElementById("mode-stat"),
  durationStat: document.getElementById("duration-stat"),
  tbody: document.getElementById("results-body"),
  detailIp: document.getElementById("detail-ip"),
  detailMac: document.getElementById("detail-mac"),
  detailHostname: document.getElementById("detail-hostname"),
  detailType: document.getElementById("detail-type"),
  detailStatus: document.getElementById("detail-status"),
  detailNote: document.getElementById("detail-note"),
  detailLog: document.getElementById("detail-log"),
  tableHeaders: Array.from(document.querySelectorAll("th[data-key]")),
};

function nowTime() {
  return new Date().toLocaleTimeString();
}

function appendDetailLog(message) {
  state.detailLogs.unshift(`[${nowTime()}] ${message}`);
  state.detailLogs = state.detailLogs.slice(0, 8);
  refs.detailLog.innerHTML = state.detailLogs.map((item) => `<li>${item}</li>`).join("");
}

function detectDeviceType(device) {
  const name = String(device.hostname || "").toLowerCase();
  const mobileHints = ["android", "iphone", "redmi", "samsung", "oppo", "vivo", "mobile", "phone"];
  const laptopHints = ["laptop", "notebook", "desktop", "pc", "windows", "macbook", "lenovo", "hp", "dell"];

  if (mobileHints.some((hint) => name.includes(hint))) return "Mobile";
  if (laptopHints.some((hint) => name.includes(hint))) return "Laptop/PC";
  return "Unknown";
}

function updateDetailPanel() {
  const selected = state.devices.find((d) => d.ip === state.selectedIp);
  if (!selected) {
    refs.detailIp.textContent = "-";
    refs.detailMac.textContent = "-";
    refs.detailHostname.textContent = "-";
    refs.detailType.textContent = "Unknown";
    refs.detailStatus.textContent = "Not selected";
    refs.detailNote.textContent = "App-level traffic is not available in basic LAN scan.";
    return;
  }

  const type = detectDeviceType(selected);
  refs.detailIp.textContent = selected.ip || "-";
  refs.detailMac.textContent = selected.mac || "-";
  refs.detailHostname.textContent = selected.hostname || "-";
  refs.detailType.textContent = type;
  refs.detailStatus.textContent = "Online (last scan)";
  refs.detailNote.textContent =
    type === "Mobile"
      ? "Selected IP looks like a mobile device based on hostname."
      : "Only scan-level details are available in this app.";
}

function setStatus(message, mode = "idle") {
  refs.status.className = `status ${mode}`;
  refs.status.textContent = message;
}

function ipToTuple(ip) {
  return ip.split(".").map((part) => Number(part));
}

function compareDevices(a, b, key, asc) {
  let result = 0;

  if (key === "ip") {
    const left = ipToTuple(a.ip);
    const right = ipToTuple(b.ip);
    for (let i = 0; i < 4; i += 1) {
      if (left[i] !== right[i]) {
        result = left[i] - right[i];
        break;
      }
    }
  } else {
    result = String(a[key] || "").localeCompare(String(b[key] || ""));
  }

  return asc ? result : -result;
}

function renderRows(rows) {
  if (!rows.length) {
    refs.tbody.innerHTML = '<tr><td colspan="4" class="empty">No matching devices.</td></tr>';
    return;
  }

  refs.tbody.innerHTML = rows
    .map(
      (d) => `
      <tr class="${state.selectedIp === d.ip ? "selected-row" : ""}">
        <td class="col-ip">${d.ip}</td>
        <td class="col-mac">${d.mac || "-"}</td>
        <td class="col-host">${d.hostname || "-"}</td>
        <td>
          <button
            type="button"
            class="ghost row-select-btn"
            data-action="select"
            data-ip="${d.ip}"
            data-mac="${d.mac || "-"}"
            data-hostname="${d.hostname || "-"}"
          >${state.selectedIp === d.ip ? "Selected" : "View"}</button>
        </td>
      </tr>
    `
    )
    .join("");
}

function setActiveMode(mode) {
  document.body.setAttribute("data-mode", mode);
  const modeButtons = [refs.scanWifiBtn, refs.scanLanBtn, refs.scanAutoBtn];
  for (const button of modeButtons) {
    const buttonMode = button.dataset.mode;
    button.classList.toggle("active", buttonMode === mode);
  }
}

function applyFilterAndSort() {
  const q = refs.filterInput.value.trim().toLowerCase();

  state.filtered = state.devices.filter((d) => {
    if (!q) return true;
    return [d.ip, d.mac, d.hostname].some((v) => String(v || "").toLowerCase().includes(q));
  });

  state.filtered.sort((a, b) => compareDevices(a, b, state.sortKey, state.sortAsc));
  renderRows(state.filtered);
}

function updateStats(data) {
  refs.subnetStat.textContent = data.subnet || "-";
  refs.countStat.textContent = String(data.count ?? 0);
  refs.modeStat.textContent = data.mode || "auto";
  refs.durationStat.textContent = `${Number(data.durationSec || 0).toFixed(2)}s`;
}

async function loadDefaults() {
  try {
    const response = await fetch("/api/defaults");
    const data = await response.json();

    if (data.ok) {
      const wifiLabel = data.wifiSubnet ? `wifi: ${data.wifiSubnet}` : "wifi: not active";
      const lanLabel = data.lanSubnet ? `lan: ${data.lanSubnet}` : "lan: not active";
      refs.subnetInput.placeholder = `Auto detect (${data.defaultSubnet}) | ${wifiLabel} | ${lanLabel}`;
      refs.subnetStat.textContent = data.defaultSubnet;
      refs.timeoutInput.value = data.defaultTimeout;
      refs.workersInput.value = data.defaultWorkers;
    }
  } catch {
    setStatus("Could not load defaults. You can still run manual scan.", "error");
  }
}

async function runScan(mode = "auto") {
  setActiveMode(mode);
  setStatus(`Scanning ${mode} network, please wait...`, "running");
  refs.scanWifiBtn.disabled = true;
  refs.scanLanBtn.disabled = true;
  refs.scanAutoBtn.disabled = true;

  const body = {
    mode,
    subnet: refs.subnetInput.value.trim() || undefined,
    timeout: Number(refs.timeoutInput.value || 250),
    workers: Number(refs.workersInput.value || 96),
  };

  try {
    const response = await fetch("/api/scan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    let data = {};
    try {
      data = await response.json();
    } catch {
      // Keep fallback object for non-JSON error responses.
    }
    if (!response.ok || !data.ok) {
      throw new Error(data.error || `Scan failed (HTTP ${response.status})`);
    }

    state.devices = data.devices || [];
    state.selectedIp = null;
    state.detailLogs = [];
    applyFilterAndSort();
    updateStats(data);
    updateDetailPanel();
    appendDetailLog(`Scan completed in ${data.durationSec}s with ${data.count} device(s).`);

    const stamp = new Date((data.scannedAt || Date.now() / 1000) * 1000).toLocaleTimeString();
    setStatus(
      `Scan complete at ${stamp}. ${data.count} device(s) found via ${data.mode || mode}.`,
      "ok"
    );
  } catch (err) {
    setStatus(`Error: ${err.message}`, "error");
  } finally {
    refs.scanWifiBtn.disabled = false;
    refs.scanLanBtn.disabled = false;
    refs.scanAutoBtn.disabled = false;
  }
}

function exportCsv() {
  if (!state.filtered.length) {
    setStatus("No data to export.", "error");
    return;
  }

  const lines = ["ip,mac,hostname"];
  for (const d of state.filtered) {
    const safe = (value) => `"${String(value || "-").replaceAll('"', '""')}"`;
    lines.push([safe(d.ip), safe(d.mac), safe(d.hostname)].join(","));
  }

  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "lan_scan_results.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

refs.form.addEventListener("submit", (event) => {
  event.preventDefault();
  runScan("auto");
});

refs.scanWifiBtn.addEventListener("click", () => runScan("wifi"));
refs.scanLanBtn.addEventListener("click", () => runScan("lan"));
refs.scanAutoBtn.addEventListener("click", () => runScan("auto"));

refs.clearBtn.addEventListener("click", () => {
  state.devices = [];
  state.filtered = [];
  state.selectedIp = null;
  state.detailLogs = [];
  refs.filterInput.value = "";
  refs.subnetStat.textContent = "-";
  refs.countStat.textContent = "0";
  refs.modeStat.textContent = "auto";
  refs.durationStat.textContent = "0.00s";
  renderRows([]);
  updateDetailPanel();
  appendDetailLog("Cleared scan data.");
  setStatus("Cleared", "idle");
});

refs.tbody.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-action='select']");
  if (!button) return;

  const ip = button.dataset.ip;
  if (!ip) return;

  state.selectedIp = state.selectedIp === ip ? null : ip;
  applyFilterAndSort();
  updateDetailPanel();

  if (state.selectedIp) {
    const device = state.devices.find((d) => d.ip === state.selectedIp);
    const type = device ? detectDeviceType(device) : "Unknown";
    appendDetailLog(`Selected ${state.selectedIp} (${type}).`);
    if (type === "Mobile") {
      appendDetailLog("Mobile device detected from hostname pattern.");
    }
    appendDetailLog("Instagram/app-level request logs are not visible from basic ping/ARP scan.");
  } else {
    appendDetailLog("Selection cleared.");
  }
});

refs.exportBtn.addEventListener("click", exportCsv);

refs.filterInput.addEventListener("input", applyFilterAndSort);

refs.tableHeaders.forEach((th) => {
  th.addEventListener("click", () => {
    const key = th.dataset.key;
    if (!key) return;

    if (state.sortKey === key) {
      state.sortAsc = !state.sortAsc;
    } else {
      state.sortKey = key;
      state.sortAsc = true;
    }

    applyFilterAndSort();
  });
});

setActiveMode("auto");
updateDetailPanel();
loadDefaults();
