import os
from pathlib import Path   # <-- Make sure this says pathlib, NOT zipfile!

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = SCRIPTS_DIR / ".env"

def load_env(env_path: Path = ENV_FILE):
    if env_path.exists():
        for line in env_path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

load_env()

def resolve_script_path(env_var: str, default_rel: str) -> str:
    raw = os.getenv(env_var, default_rel)
    p = Path(raw)
    return str(p if p.is_absolute() else (SCRIPTS_DIR / p).resolve())

TARGET_STOP = os.getenv("TARGET_STOP", "4400CY0246")
TARGET_ROUTE_SHORT_NAME = os.getenv("TARGET_ROUTE_SHORT_NAME", "2")
ZIP_PATH = resolve_script_path("GTFS_ZIP_PATH", "metrobus_gtfs.zip")
OUTPUT_PATH = resolve_script_path("OUTPUT_JSON_PATH", "../worker/src/route2_schedule.json")
