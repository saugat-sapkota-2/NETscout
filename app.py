#!/usr/bin/env python3
from __future__ import annotations

import ipaddress
import re
import time
from dataclasses import asdict
from threading import Lock
from typing import Any, Dict, List

from flask import Flask, jsonify, render_template, request

from wifi_scanner import (
    cidr_from_ip_and_mask,
    get_active_ipv4_and_mask,
    run_command,
    scan_subnet,
)

app = Flask(__name__)
scan_lock = Lock()


@app.get("/")
def home() -> str:
    return render_template("index.html")


def get_default_subnet() -> str:
    ip, mask = get_active_ipv4_and_mask()
    return cidr_from_ip_and_mask(ip, mask)


def get_interface_subnets() -> Dict[str, str]:
    """Extract Wi-Fi and LAN subnets from Windows ipconfig output."""
    code, out, _ = run_command(["ipconfig"])
    if code != 0:
        raise RuntimeError("Could not run ipconfig.")

    adapter_name: str | None = None
    adapter_ip: str | None = None
    adapter_mask: str | None = None
    subnet_map: Dict[str, str] = {}

    ipv4_re = re.compile(r"IPv4 Address[ .]*:[ ]*([0-9.]+)")
    mask_re = re.compile(r"Subnet Mask[ .]*:[ ]*([0-9.]+)")
    adapter_re = re.compile(r"adapter\s+(.+):$", re.IGNORECASE)

    def commit_adapter() -> None:
        nonlocal adapter_name, adapter_ip, adapter_mask
        if not (adapter_name and adapter_ip and adapter_mask):
            return
        if adapter_ip.startswith("169.254"):
            return

        subnet = cidr_from_ip_and_mask(adapter_ip, adapter_mask)
        name_lower = adapter_name.lower()

        if any(token in name_lower for token in ["wireless", "wi-fi", "wifi"]):
            subnet_map.setdefault("wifi", subnet)
        if "ethernet" in name_lower:
            subnet_map.setdefault("lan", subnet)

    for raw in out.splitlines():
        line = raw.strip()
        if not line:
            continue

        adapter_match = adapter_re.search(line)
        if adapter_match:
            commit_adapter()
            adapter_name = adapter_match.group(1)
            adapter_ip = None
            adapter_mask = None
            continue

        if adapter_name:
            ip_match = ipv4_re.search(line)
            if ip_match:
                adapter_ip = ip_match.group(1)
                continue

            mask_match = mask_re.search(line)
            if mask_match:
                adapter_mask = mask_match.group(1)

    commit_adapter()
    return subnet_map


def resolve_subnet_for_mode(mode: str) -> str:
    if mode == "auto":
        return get_default_subnet()

    subnets = get_interface_subnets()
    if mode in subnets:
        return subnets[mode]

    if mode == "wifi":
        raise RuntimeError("No active Wi-Fi adapter with IPv4 was found.")
    if mode == "lan":
        raise RuntimeError("No active LAN/Ethernet adapter with IPv4 was found.")

    raise RuntimeError("Invalid scan mode.")


@app.get("/api/defaults")
def api_defaults() -> Any:
    try:
        interface_subnets = get_interface_subnets()
        return jsonify(
            {
                "ok": True,
                "defaultSubnet": get_default_subnet(),
                "wifiSubnet": interface_subnets.get("wifi"),
                "lanSubnet": interface_subnets.get("lan"),
                "defaultTimeout": 250,
                "defaultWorkers": 96,
            }
        )
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500


@app.post("/api/scan")
def api_scan() -> Any:
    payload: Dict[str, Any] = request.get_json(silent=True) or {}

    mode = str(payload.get("mode", "auto")).lower().strip()
    timeout = int(payload.get("timeout", 250))
    workers = int(payload.get("workers", 96))

    if mode not in {"auto", "wifi", "lan"}:
        return jsonify({"ok": False, "error": "mode must be one of: auto, wifi, lan"}), 400
    if timeout < 50 or timeout > 2000:
        return jsonify({"ok": False, "error": "timeout must be in range 50-2000 ms"}), 400
    if workers < 1 or workers > 512:
        return jsonify({"ok": False, "error": "workers must be in range 1-512"}), 400

    try:
        subnet_raw = payload.get("subnet")
        subnet = (
            str(ipaddress.ip_network(subnet_raw, strict=False))
            if subnet_raw
            else resolve_subnet_for_mode(mode)
        )
    except RuntimeError as exc:
        return jsonify({"ok": False, "error": str(exc)}), 400
    except Exception:
        return jsonify({"ok": False, "error": "Invalid subnet. Example: 192.168.1.0/24"}), 400

    if not scan_lock.acquire(blocking=False):
        return jsonify({"ok": False, "error": "A scan is already running. Please wait."}), 409

    try:
        started_at = time.time()
        devices = scan_subnet(subnet=subnet, timeout_ms=timeout, workers=workers)
        elapsed = time.time() - started_at

        device_rows: List[Dict[str, Any]] = [asdict(d) for d in devices]
        return jsonify(
            {
                "ok": True,
                "subnet": subnet,
                "mode": mode,
                "durationSec": round(elapsed, 2),
                "count": len(device_rows),
                "devices": device_rows,
                "scannedAt": int(time.time()),
            }
        )
    except Exception as exc:
        return jsonify({"ok": False, "error": str(exc)}), 500
    finally:
        scan_lock.release()


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5050, debug=False)
