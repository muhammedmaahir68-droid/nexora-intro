"""
device_manager.py
Handles ADB device discovery, health checks, and concurrent command
dispatch across N physical devices using asyncio subprocesses.

Design principle: every device operation is async and non-blocking.
Dispatch to 10 phones costs the same wall-clock time as dispatching
to 1, because they all run concurrently via asyncio.gather.
"""

import asyncio
import glob
import os
import shlex
import shutil
import time
from dataclasses import dataclass, field


@dataclass
class Device:
    name: str
    serial: str
    unlock_pin: str = ""
    unlock_method: str = "none"  # "pin" | "swipe" | "none"
    online: bool = False
    last_seen: float = field(default_factory=time.time)


class DeviceManager:
    def __init__(self, config: dict):
        self.adb_path = self._find_adb()
        self.devices: dict[str, Device] = {}
        self.groups: dict[str, list[str]] = config.get("groups", {})
        for name, d in config.get("devices", {}).items():
            self.devices[name] = Device(
                name=name,
                serial=d["serial"],
                unlock_pin=d.get("unlock_pin", ""),
                unlock_method=d.get("unlock_method", "none"),
            )

    @staticmethod
    def _find_adb() -> str:
        """Find ADB even if the current Windows terminal has a stale PATH."""
        configured = os.environ.get("ADB_PATH")
        if configured and os.path.isfile(configured):
            return configured

        on_path = shutil.which("adb")
        if on_path:
            return on_path

        if os.name == "nt":
            pattern = os.path.join(
                os.environ.get("LOCALAPPDATA", ""),
                "Microsoft", "WinGet", "Packages", "Google.PlatformTools_*", "platform-tools", "adb.exe",
            )
            matches = glob.glob(pattern)
            if matches:
                return matches[0]
        return "adb"

    # ---------- discovery ----------

    async def refresh_online_status(self):
        """Poll `adb devices` once and mark each configured device online/offline."""
        proc = await asyncio.create_subprocess_exec(
            self.adb_path, "devices",
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await proc.communicate()
        lines = stdout.decode().splitlines()[1:]  # skip header
        online_serials = {
            line.split()[0] for line in lines if line.strip().endswith("device")
        }
        for dev in self.devices.values():
            dev.online = dev.serial in online_serials
            dev.last_seen = time.time()
        return {d.name: d.online for d in self.devices.values()}

    # ---------- low-level ADB execution ----------

    async def run_adb(self, serial: str, *args: str, timeout: float = 8.0) -> tuple[int, str, str]:
        """Run a single `adb -s <serial> <args>` command asynchronously."""
        cmd = [self.adb_path, "-s", serial, *args]
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)
        except asyncio.TimeoutError:
            proc.kill()
            return -1, "", f"timeout after {timeout}s"
        return proc.returncode, stdout.decode(errors="ignore"), stderr.decode(errors="ignore")

    async def shell(self, serial: str, shell_cmd: str, timeout: float = 8.0):
        """Run `adb shell <shell_cmd>` — convenience wrapper for the common case."""
        return await self.run_adb(serial, "shell", *shlex.split(shell_cmd), timeout=timeout)

    # ---------- device resolution ----------

    def resolve_targets(self, target: str) -> list[Device]:
        """
        Turn a spoken target like "all", "living_room", or "phone_1"
        into a concrete list of Device objects.
        """
        if target in self.groups:
            return [self.devices[n] for n in self.groups[target] if n in self.devices]
        if target in self.devices:
            return [self.devices[target]]
        return []

    # ---------- concurrent fan-out ----------

    async def dispatch(self, target: str, coro_factory):
        """
        Run `coro_factory(device)` concurrently across every device
        resolved from `target`. Returns {device_name: result_or_exception}.
        """
        targets = self.resolve_targets(target)
        if not targets:
            return {"error": f"no devices matched target '{target}'"}

        async def _run(dev: Device):
            try:
                return await coro_factory(dev)
            except Exception as e:  # noqa: BLE001 — surface per-device failure, don't crash the batch
                return {"error": str(e)}

        results = await asyncio.gather(*(_run(d) for d in targets))
        return dict(zip((d.name for d in targets), results))
