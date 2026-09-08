#!/usr/bin/env python3
"""Ping a domain and print the result. Usage: python3 scripts/ping.py <domain>"""

import os
import platform
import subprocess
import sys


def ping(host: str, count: int = 500, interval: float = 0.002) -> int:
    if platform.system().lower() == "windows":
        cmd = ["ping", "-n", str(count), host]
    else:
        cmd = ["ping", "-c", str(count), "-i", str(interval), host]
    try:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        for line in proc.stdout:
            print(line, end="", flush=True)
        proc.wait(timeout=count * interval + 60)
        return proc.returncode
    except FileNotFoundError:
        print("Error: 'ping' command not found on this system.", file=sys.stderr)
        return 1


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(f"Usage: sudo python3 {sys.argv[0]} <domain>")
        sys.exit(2)
    if hasattr(os, "geteuid") and os.geteuid() != 0:
        print("Error: 500 pings/second requires root. Run with: sudo python3 scripts/ping.py <domain>")
        sys.exit(1)
    sys.exit(ping(sys.argv[1]))
