#!/usr/bin/env python3
"""
Scan devices on the same local Wi-Fi/LAN network.

Features:
- Auto-detect local subnet on Windows from `ipconfig`
- Optional manual subnet input (CIDR)
- Fast ping sweep with thread pool
- Resolves MAC addresses via ARP table
- Attempts reverse DNS hostname lookup

Usage examples:
    python wifi_scanner.py
    python wifi_scanner.py --subnet 192.168.1.0/24
    python wifi_scanner.py --timeout 300 --workers 128
"""

from __future__ import annotations

import argparse
import concurrent.futures
import ipaddress
import re
import socket
import subprocess
import sys
import time
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple


@dataclass
class Device:
    ip: str
    mac: str = "-"
    hostname: str = "-"


def run_command(cmd: List[str]) -> Tuple[int, str, str]:
    """Run a command and capture output."""
    proc = subprocess.run(cmd, capture_output=True, text=True, shell=False)
    return proc.returncode, proc.stdout, proc.stderr


def get_active_ipv4_and_mask() -> Tuple[str, str]:
    """
    Parse `ipconfig` output on Windows and return (ipv4, subnet_mask)
    for the first active adapter with both values.
    """
    code, out, _ = run_command(["ipconfig"])
    if code != 0:
        raise RuntimeError("Could not run ipconfig.")

    ipv4 = None
    mask = None

    ipv4_re = re.compile(r"IPv4 Address[ .]*:[ ]*([0-9.]+)")
    mask_re = re.compile(r"Subnet Mask[ .]*:[ ]*([0-9.]+)")

    for line in out.splitlines():
        line = line.strip()

        m_ip = ipv4_re.search(line)
        if m_ip:
            candidate = m_ip.group(1)
            if candidate and not candidate.startswith("169.254"):
                ipv4 = candidate
                continue

        m_mask = mask_re.search(line)
        if m_mask:
            mask = m_mask.group(1)

        if ipv4 and mask:
            return ipv4, mask

    raise RuntimeError(
        "Could not auto-detect IPv4/subnet mask. Please provide --subnet manually."
    )


def cidr_from_ip_and_mask(ip: str, mask: str) -> str:
    """Convert IPv4 + dotted netmask to CIDR string."""
    network = ipaddress.IPv4Network(f"{ip}/{mask}", strict=False)
    return str(network)


def ping_once(ip: str, timeout_ms: int) -> bool:
    """
    Ping one host on Windows.
    -n 1: one request
    -w timeout: timeout in ms
    """
    code, _, _ = run_command(["ping", "-n", "1", "-w", str(timeout_ms), ip])
    return code == 0


def parse_arp_table() -> Dict[str, str]:
    """Read ARP table and map IP -> MAC address."""
    code, out, _ = run_command(["arp", "-a"])
    if code != 0:
        return {}

    mapping: Dict[str, str] = {}
    for line in out.splitlines():
        line = line.strip()
        if not line:
            continue

        parts = re.split(r"\s+", line)
        if len(parts) < 2:
            continue

        ip_candidate = parts[0]
        mac_candidate = parts[1].lower()

        if re.match(r"^\d+\.\d+\.\d+\.\d+$", ip_candidate) and re.match(
            r"^[0-9a-f]{2}(-[0-9a-f]{2}){5}$", mac_candidate
        ):
            mapping[ip_candidate] = mac_candidate

    return mapping


def reverse_dns(ip: str) -> str:
    """Try reverse DNS; return '-' if no hostname."""
    try:
        host, _, _ = socket.gethostbyaddr(ip)
        return host
    except Exception:
        return "-"


def scan_subnet(subnet: str, timeout_ms: int, workers: int) -> List[Device]:
    """Ping-scan all usable hosts in subnet and enrich with MAC + hostname."""
    network = ipaddress.ip_network(subnet, strict=False)
    ips = [str(ip) for ip in network.hosts()]

    alive_ips: List[str] = []

    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        future_to_ip = {executor.submit(ping_once, ip, timeout_ms): ip for ip in ips}
        for future in concurrent.futures.as_completed(future_to_ip):
            ip = future_to_ip[future]
            try:
                if future.result():
                    alive_ips.append(ip)
            except Exception:
                # Ignore single-host scan errors.
                pass

    # Refresh ARP table once after scan for MAC resolution.
    arp_map = parse_arp_table()

    devices: List[Device] = []
    for ip in sorted(alive_ips, key=lambda x: tuple(map(int, x.split(".")))):
        devices.append(
            Device(
                ip=ip,
                mac=arp_map.get(ip, "-"),
                hostname=reverse_dns(ip),
            )
        )

    return devices


def print_devices(devices: List[Device]) -> None:
    """Pretty-print device table."""
    if not devices:
        print("No active devices found.")
        return

    ip_w = max(2, max(len(d.ip) for d in devices))
    mac_w = max(3, max(len(d.mac) for d in devices))
    host_w = max(8, max(len(d.hostname) for d in devices))

    header = f"{'IP':<{ip_w}}  {'MAC':<{mac_w}}  {'HOSTNAME':<{host_w}}"
    print(header)
    print("-" * len(header))

    for d in devices:
        print(f"{d.ip:<{ip_w}}  {d.mac:<{mac_w}}  {d.hostname:<{host_w}}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Scan devices connected to your local Wi-Fi/LAN network"
    )
    parser.add_argument(
        "--subnet",
        help="Subnet in CIDR format, e.g. 192.168.1.0/24. If omitted, auto-detect from ipconfig.",
    )
    parser.add_argument(
        "--timeout",
        type=int,
        default=250,
        help="Ping timeout per host in milliseconds (default: 250)",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=96,
        help="Number of parallel ping workers (default: 96)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    try:
        if args.subnet:
            subnet = str(ipaddress.ip_network(args.subnet, strict=False))
        else:
            ip, mask = get_active_ipv4_and_mask()
            subnet = cidr_from_ip_and_mask(ip, mask)

        print(f"Scanning subnet: {subnet}")
        start = time.time()
        devices = scan_subnet(subnet=subnet, timeout_ms=args.timeout, workers=args.workers)
        elapsed = time.time() - start

        print_devices(devices)
        print(f"\nFound {len(devices)} active device(s) in {elapsed:.2f}s")
        return 0
    except KeyboardInterrupt:
        print("\nScan canceled.")
        return 1
    except Exception as exc:
        print(f"Error: {exc}")
        return 2


if __name__ == "__main__":
    sys.exit(main())
