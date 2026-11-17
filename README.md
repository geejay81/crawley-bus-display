# Live UK Bus Stop Arrival Display (BODS + Cloudflare Workers + ESP32)

A low-cost, serverless live bus arrival board built using the UK Department for Transport **Bus Open Data Service (BODS)**, **Cloudflare Workers**, and an **ESP32** microcontroller with a built-in LCD display.

Because BODS provides live GPS vehicle positions (GTFS-RT) rather than direct stop countdowns, this project pre-processes static GTFS timetables into a lightweight route lookup and calculates real-time stop ETAs on the edge.

---

## Architecture Overview

1. **Static Timetable Extractor (`scripts/`):** A local Python script parses an operator's static GTFS `.zip` archive, filters down to a single route and target bus stop (ATCO code), and outputs a compact JSON lookup file (`route2_schedule.json`).
2. **Serverless Arrival API (`worker/`):** A TypeScript Cloudflare Worker fetches live binary GTFS-RT GPS feeds from BODS, snaps active buses to upstream stops along the route, calculates schedule delay, and serves a tiny JSON payload cached at the Cloudflare edge.
3. **Hardware Display (`firmware/`):** An ESP32 polls the Cloudflare Worker over HTTPS every 30–45 seconds and renders upcoming live and scheduled arrivals onto its built-in LCD screen.

---

## Project Structure

```text
crawley-bus-display/
├── .gitignore
├── README.md
├── scripts/
│   ├── .env                    # [Uncommitted] Local stop & route settings
│   ├── metrobus_gtfs.zip       # [Uncommitted] Raw GTFS timetable archive
│   ├── extract_route.py        # Pre-processes GTFS data into compact JSON
│   └── helpers/
│       └── load_env.py         # Loads local .env configuration
├── worker/
│   ├── .dev.vars               # [Uncommitted] Local BODS API key & route variables
│   ├── wrangler.toml           # Cloudflare Worker configuration
│   ├── package.json
│   └── src/
│       ├── index.ts            # Main GTFS-RT arrival calculation logic
│       ├── route2_schedule.json# [Uncommitted] Generated schedule for your target stop
│       ├── helpers/
│       │   ├── geo-helpers.ts  # Haversine distance & GPS stop-snapping
│       │   └── time-helpers.ts # UK GMT/BST timezone & GTFS time parsers
│       └── types/
│           └── environment.ts  # Cloudflare Worker Env bindings
└── firmware/                   # ESP32 Arduino / PlatformIO display code
```

---

## Prerequisites

* **Python 3.10+** (uses standard library only—no external `pip` packages required)
* **Node.js 18+** & **npm**
* **Free BODS Account & API Key:** Register at [data.bus-data.dft.gov.uk](https://dft.gov.uk)
* **Free Cloudflare Account:** For hosting the serverless API on Cloudflare Workers
* **Static GTFS Timetable:** Downloaded from your local bus operator's open data portal or the BODS timetable download page

---

## Local Setup & Running Instructions

### Step 1: Extract Your Stop's Static Timetable (`scripts/`)

1. Download the static **GTFS** `.zip` timetable for your bus operator and place it inside `scripts/` (e.g., `scripts/metrobus_gtfs.zip`).
2. Find the **ATCO code** for your target bus stop (for example, via [bustimes.org](https://bustimes.org)).
3. Create an uncommitted `scripts/.env` file:
   ```env
   TARGET_STOP=4400XXXXXXXX
   TARGET_ROUTE_SHORT_NAME=2
   GTFS_ZIP_PATH=metrobus_gtfs.zip
   OUTPUT_JSON_PATH=../worker/src/route2_schedule.json
   ```
4. Run the extractor script from the project root or inside `scripts/`:
   ```bash
   python3 scripts/extract_route.py
   ```
   This generates `worker/src/route2_schedule.json` containing only the upstream stop coordinates and active trips serving your target stop.

---

### Step 2: Configure & Run the Cloudflare Worker (`worker/`)

1. Navigate to the `worker/` directory and install dependencies:
   ```bash
   cd worker
   npm install
   ```
2. Create an uncommitted `worker/.dev.vars` file containing your BODS API key and display preferences:
   ```env
   BODS_API_KEY=your_bods_api_key_here
   OPERATOR_REF=METR
   BBOX=-0.30,51.05,-0.10,51.20
   BODS_ROUTE_ID=4148
   LINE_NAME=2
   DESTINATION_NAME=Terminus
   DISPLAY_STOP_NAME=My Bus Stop
   ```
   *(Tip: You can find your route's numeric `BODS_ROUTE_ID` by starting the local server and visiting `http://localhost:8787/?debug=1` while buses are active).*

3. Start the local development server:
   ```bash
   npx wrangler dev
   ```
4. Open `http://localhost:8787` in your browser to verify the JSON response:
   ```json
   {
     "stop": "My Bus Stop",
     "updated": "14:32",
     "arrivals": [
       { "line": "2", "dest": "Terminus", "mins": "4m", "live": true },
       { "line": "2", "dest": "Terminus", "mins": "14:52", "live": false }
     ]
   }
   ```

---

### Step 3: Deploy to Cloudflare Workers

1. Upload your BODS API key and configuration variables as encrypted Cloudflare secrets so they remain out of version control:
   ```bash
   npx wrangler secret put BODS_API_KEY
   npx wrangler secret put BBOX
   npx wrangler secret put BODS_ROUTE_ID
   npx wrangler secret put LINE_NAME
   npx wrangler secret put DESTINATION_NAME
   npx wrangler secret put DISPLAY_STOP_NAME
   ```
2. Deploy the Worker:
   ```bash
   npx wrangler deploy
   ```

---

## Privacy & Uncommitted Files

To keep personal location details and API credentials out of public version control, ensure the following files are listed in `.gitignore`:

* `scripts/.env` — Your local target stop ATCO code
* `scripts/*.zip` — Raw operator GTFS archives
* `worker/.dev.vars` — Local BODS API key and bounding box coordinates
* `worker/src/route2_schedule.json` — Generated stop coordinates and timetable specific to your stop
* `firmware/**/secrets.h` — Local Wi-Fi SSID, password, and Worker endpoint URL

---

## Licence

Bus timetable and real-time location data is used under the [UK Open Government Licence v3.0](https://nationalarchives.gov.uk).
