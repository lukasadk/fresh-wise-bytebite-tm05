import ctypes
import json
import os
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


@dataclass(frozen=True)
class HardwareSnapshot:
    gpu_name: str | None
    vram_gb: float
    ram_gb: float

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


class _MemoryStatusEx(ctypes.Structure):
    _fields_ = [
        ("dwLength", ctypes.c_ulong),
        ("dwMemoryLoad", ctypes.c_ulong),
        ("ullTotalPhys", ctypes.c_ulonglong),
        ("ullAvailPhys", ctypes.c_ulonglong),
        ("ullTotalPageFile", ctypes.c_ulonglong),
        ("ullAvailPageFile", ctypes.c_ulonglong),
        ("ullTotalVirtual", ctypes.c_ulonglong),
        ("ullAvailVirtual", ctypes.c_ulonglong),
        ("ullAvailExtendedVirtual", ctypes.c_ulonglong),
    ]


def _posix_ram_gb() -> float:
    # Lightning Studios run Linux. The previous Windows-only implementation
    # returned 0 GB there, causing an otherwise suitable T4/L4 instance to be
    # rejected by the model profile before loading. sysconf works on Linux and
    # macOS without adding another runtime dependency.
    try:
        page_count = int(os.sysconf("SC_PHYS_PAGES"))
        page_size = int(os.sysconf("SC_PAGE_SIZE"))
        if page_count > 0 and page_size > 0:
            return round((page_count * page_size) / (1024**3), 2)
    except (AttributeError, OSError, TypeError, ValueError):
        pass

    # Minimal containers can omit the sysconf names while still exposing
    # Linux's standard memory information file.
    try:
        for line in Path("/proc/meminfo").read_text(encoding="ascii").splitlines():
            if line.startswith("MemTotal:"):
                kibibytes = int(line.split()[1])
                return round(kibibytes / (1024**2), 2)
    except (OSError, IndexError, ValueError):
        pass
    return 0.0


def _ram_gb() -> float:
    if os.name != "nt":
        return _posix_ram_gb()
    try:
        status = _MemoryStatusEx()
        status.dwLength = ctypes.sizeof(status)
        ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status))
        return round(status.ullTotalPhys / (1024**3), 2)
    except (AttributeError, OSError):
        return 0.0


def _gpu() -> tuple[str | None, float]:
    command = [
        "nvidia-smi",
        "--query-gpu=name,memory.total",
        "--format=csv,noheader,nounits",
    ]
    try:
        result = subprocess.run(command, capture_output=True, text=True, timeout=5, check=True)
        first_line = result.stdout.strip().splitlines()[0]
        name, memory_mb = first_line.rsplit(",", 1)
        return name.strip(), round(float(memory_mb.strip()) / 1024, 2)
    except (FileNotFoundError, subprocess.SubprocessError, ValueError, IndexError):
        return None, 0.0


def detect_hardware() -> HardwareSnapshot:
    gpu_name, vram_gb = _gpu()
    return HardwareSnapshot(gpu_name=gpu_name, vram_gb=vram_gb, ram_gb=_ram_gb())


def load_profiles(path: Path) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    profiles = payload.get("profiles", [])
    if not isinstance(profiles, list) or not profiles:
        raise ValueError(f"No model profiles found in {path}")
    return profiles


def choose_model_profile(
    profiles_path: Path,
    hardware: HardwareSnapshot,
) -> dict[str, Any]:
    profiles = load_profiles(profiles_path)
    profile = profiles[0]
    profile = dict(profile)
    profile["hardware_suitable"] = (
        hardware.vram_gb >= float(profile.get("min_vram_gb", 0))
        and hardware.ram_gb >= float(profile.get("min_ram_gb", 0))
    )
    return profile
