import os
from zipfile import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
ENV_FILE = SCRIPTS_DIR / ".env"

def load_env(env_path: Path = ENV_FILE):
    """Load key=value pairs from a local .env file into os.environ."""
    path = Path(env_path)
    if not path.exists():
        # Also check parent directory if run from inside scripts/
        path = Path("..") / env_path
    if path.exists():
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

load_env()

TARGET_STOP = os.getenv("TARGET_STOP", "4400CY0246")
TARGET_ROUTE_SHORT_NAME = os.getenv("TARGET_ROUTE_SHORT_NAME", "2")
ZIP_PATH = os.getenv("GTFS_ZIP_PATH", "metrobus_gtfs.zip")
OUTPUT_PATH = os.getenv("OUTPUT_JSON_PATH", "route2_schedule.json")
