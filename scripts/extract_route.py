import zipfile
import csv
import io
import json
from pathlib import Path
from helpers.load_env import TARGET_STOP, TARGET_ROUTE_SHORT_NAME, ZIP_PATH, OUTPUT_PATH

def read_csv_from_zip(zf, filename):
    with zf.open(filename) as f:
        return list(csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig")))

with zipfile.ZipFile(ZIP_PATH, "r") as zf:
    routes = read_csv_from_zip(zf, "routes.txt")
    trips = read_csv_from_zip(zf, "trips.txt")
    stop_times = read_csv_from_zip(zf, "stop_times.txt")
    stops = {s["stop_id"]: s for s in read_csv_from_zip(zf, "stops.txt")}
    calendar = {c["service_id"]: c for c in read_csv_from_zip(zf, "calendar.txt")}

# 1. Find route_ids matching TARGET_ROUTE_SHORT_NAME
route_ids = {r["route_id"] for r in routes if r["route_short_name"] == TARGET_ROUTE_SHORT_NAME}

# 2. Group stop_times by trip_id
trips_stops = {}
for st in stop_times:
    trips_stops.setdefault(st["trip_id"], []).append(st)

# 3. Filter trips for the target route and stop
valid_trips = {}
reference_stop_chain = []

seen_trips = set()
for t in trips:
    tid = t["trip_id"]
    if t["route_id"] not in route_ids or tid not in trips_stops:
        continue

    seq = sorted(trips_stops[tid], key=lambda x: int(x["stop_sequence"]))
    stop_ids = [s["stop_id"] for s in seq]

    if TARGET_STOP in stop_ids:
        target_idx = stop_ids.index(TARGET_STOP)
        upstream_seq = seq[: target_idx + 1]

        if len(upstream_seq) > len(reference_stop_chain):
            reference_stop_chain = [
                {
                    "stop_id": s["stop_id"],
                    "name": stops[s["stop_id"]]["stop_name"],
                    "lat": float(stops[s["stop_id"]]["stop_lat"]),
                    "lon": float(stops[s["stop_id"]]["stop_lon"]),
                    "seq": int(s["stop_sequence"]),
                }
                for s in upstream_seq
                if s["stop_id"] in stops
            ]

        cal = calendar.get(t["service_id"], {})
        days = [
            int(cal.get(d, 0))
            for d in ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
        ]

        # Deduplicate trips with the exact same operating days + target_arrival
        dedup_key = (tuple(days), upstream_seq[-1]["arrival_time"])
        if dedup_key in seen_trips:
            continue
        seen_trips.add(dedup_key)

        valid_trips[tid] = {
            "days": days,
            "start_time": upstream_seq[0]["departure_time"],
            "target_arrival": upstream_seq[-1]["arrival_time"],
            "stops": {s["stop_id"]: s["arrival_time"] for s in upstream_seq},
        }

output = {
    "target_stop": TARGET_STOP,
    "stop_name": stops.get(TARGET_STOP, {}).get("stop_name", "Opp Brantridge Road"),
    "route_chain": reference_stop_chain,
    "trips": valid_trips,
}

out_file = Path(OUTPUT_PATH)
out_file.parent.mkdir(parents=True, exist_ok=True)
with out_file.open("w", encoding="utf-8") as f:
    json.dump(output, f, indent=2)

print(f"Route {TARGET_ROUTE_SHORT_NAME} -> {TARGET_STOP}: extracted {len(valid_trips)} trips and {len(reference_stop_chain)} stops into {out_file}.")
