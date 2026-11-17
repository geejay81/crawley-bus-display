import GtfsRealtimeBindings from "gtfs-realtime-bindings";
import scheduleData from "./route2_schedule.json";

export interface Env {
  BODS_API_KEY: string;
  OPERATOR_REF?: string;
  BBOX?: string;
  LINE_NAME?: string;
  DESTINATION_NAME?: string;
  DISPLAY_STOP_NAME?: string;
}

const DEFAULT_BBOX = "-0.30,51.05,-0.10,51.20";

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    const cache = caches.default;
    const cacheKey = new Request(url.toString(), request);
    const cached = await cache.match(cacheKey);
    if (cached) return cached;

    const operatorRef = env.OPERATOR_REF || "METR";
    const bbox = env.BBOX || DEFAULT_BBOX;
    const lineName = env.LINE_NAME || "2";
    const destName = env.DESTINATION_NAME || "Terminus";
    const displayStop = env.DISPLAY_STOP_NAME || scheduleData.stop_name || "Bus Stop";

    // 1. Fetch live GPS feed from BODS GTFS-RT endpoint
    // const bodsUrl = new URL("https://dft.gov.uk");
    // bodsUrl.searchParams.set("operatorRef", operatorRef);
    // bodsUrl.searchParams.set("boundingBox", bbox);
    // bodsUrl.searchParams.set("api_key", env.BODS_API_KEY);

    // const res = await fetch(bodsUrl.toString());
    // if (!res.ok) {
    //   return new Response(JSON.stringify({ error: "BODS feed error", status: res.status }), { status: 502 });
    // }

    // const buffer = await res.arrayBuffer();
    // const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));

    // 1. Fetch live GPS feed from BODS GTFS-RT endpoint (boundingBox only)
    const bodsHost = ["data", "bus-data", "dft", "gov", "uk"].join(".");
    const bodsUrl = new URL(`https://${bodsHost}/api/v1/gtfsrtdatafeed/`);
    bodsUrl.searchParams.set("boundingBox", bbox);
    bodsUrl.searchParams.set("api_key", env.BODS_API_KEY);

    const res = await fetch(bodsUrl.toString());
    if (!res.ok) {
    return new Response(JSON.stringify({ error: "BODS feed error", status: res.status }), { status: 502 });
    }

    const contentType = res.headers.get("content-type") || "";
    const buffer = await res.arrayBuffer();

    // Guard against HTML/JSON responses masquerading as 200 OK
    if (contentType.includes("text") || contentType.includes("json") || contentType.includes("html")) {
    const preview = new TextDecoder().decode(buffer).slice(0, 200);
    return new Response(JSON.stringify({ error: "Expected protobuf, got text", preview }), { status: 502 });
    }

    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(new Uint8Array(buffer));

    // Right after decoding `feed` in worker/src/index.ts:
    if (url.searchParams.get("debug") === "1") {
    const sampleVehicles = feed.entity
        .filter((e) => e.vehicle?.position)
        .slice(0, 10)
        .map((e) => ({
        tripId: e.vehicle?.trip?.tripId,
        routeId: e.vehicle?.trip?.routeId,
        startTime: e.vehicle?.trip?.startTime,
        lat: e.vehicle?.position?.latitude,
        lon: e.vehicle?.position?.longitude,
        }));
    return new Response(JSON.stringify({ count: feed.entity.length, sampleVehicles }, null, 2), {
        headers: { "Content-Type": "application/json" },
    });
    }


    // 2. Get current UK local time (handles GMT & BST automatically)
    const ukTime = getUkTimeParts(new Date());
    const todayIdx = ukTime.dayIdx; // Mon=0 .. Sun=6
    const nowSecs = ukTime.secondsSinceMidnight;

    // Build lookup indexes for today's active trips
    const todaysTrips = Object.entries(scheduleData.trips as Record<string, any>).filter(
      ([, info]) => info.days[todayIdx] === 1
    );

    const byFullId = new Map(todaysTrips);
    const byCoreId = new Map<string, [string, any]>();
    const byStartTime = new Map<string, [string, any]>();
    const coreIdRegex = new RegExp(`^[^:]+:[^:]+:(\\d+)`);

    for (const [tid, info] of todaysTrips) {
      const match = tid.match(coreIdRegex);
      if (match) byCoreId.set(match[1], [tid, info]);
      byStartTime.set(info.start_time, [tid, info]);
    }

    const predictions: Array<{ line: string; dest: string; mins: string; live: boolean; sortSecs: number }> = [];
    const matchedTripIds = new Set<string>();

    // 3. Match live buses to scheduled trips heading towards the target stop
    for (const entity of feed.entity) {
      const veh = entity.vehicle;
      if (!veh || !veh.position) continue;

      const rawTripId = veh.trip?.tripId || "";
      const rawStartTime = veh.trip?.startTime || "";

      let matched: [string, any] | undefined;
      if (byFullId.has(rawTripId)) {
        matched = [rawTripId, byFullId.get(rawTripId)];
      } else if (byCoreId.has(rawTripId)) {
        matched = byCoreId.get(rawTripId);
      } else if (rawStartTime && byStartTime.has(rawStartTime)) {
        matched = byStartTime.get(rawStartTime);
      }

      if (!matched) continue;
      const [tripId, tripInfo] = matched;

      // Snap live GPS coordinate to nearest upstream stop
      const nearest = findNearestStop(veh.position.latitude, veh.position.longitude, scheduleData.route_chain);
      if (!nearest || nearest.distanceKm > 0.6) continue;

      // Skip if the bus has already passed the target stop
      const targetSeq = scheduleData.route_chain[scheduleData.route_chain.length - 1].seq;
      if (nearest.stop.seq >= targetSeq && nearest.distanceKm > 0.08) continue;

      const schedAtBusStopStr = tripInfo.stops[nearest.stop.stop_id];
      if (!schedAtBusStopStr) continue;

      const schedAtBusStopSecs = parseGtfsTimeToSecs(schedAtBusStopStr);
      const schedAtTargetSecs = parseGtfsTimeToSecs(tripInfo.target_arrival);
      const delaySecs = Math.max(-180, Math.min(1800, nowSecs - schedAtBusStopSecs));

      const predictedArrivalSecs = schedAtTargetSecs + delaySecs;
      const etaSecs = predictedArrivalSecs - nowSecs;
      if (etaSecs < -30) continue;

      matchedTripIds.add(tripId);
      const mins = Math.round(etaSecs / 60);
      predictions.push({
        line: lineName,
        dest: destName.substring(0, 18),
        mins: mins <= 0 ? "Due" : `${mins}m`,
        live: true,
        sortSecs: predictedArrivalSecs,
      });
    }

    // 4. Backfill with upcoming scheduled buses not yet live
    for (const [tripId, tripInfo] of todaysTrips) {
      if (matchedTripIds.has(tripId)) continue;

      const schedTargetSecs = parseGtfsTimeToSecs(tripInfo.target_arrival);
      const diffSecs = schedTargetSecs - nowSecs;

      if (diffSecs > 0 && diffSecs <= 3600) {
        predictions.push({
          line: lineName,
          dest: destName.substring(0, 18),
          mins: tripInfo.target_arrival.slice(0, 5),
          live: false,
          sortSecs: schedTargetSecs,
        });
      }
    }

    const arrivals = predictions
      .sort((a, b) => a.sortSecs - b.sortSecs)
      .slice(0, 4)
      .map(({ line, dest, mins, live }) => ({ line, dest, mins, live }));

    const response = new Response(
      JSON.stringify({
        stop: displayStop.substring(0, 22),
        updated: ukTime.hhmm,
        arrivals,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": "public, max-age=30",
        },
      }
    );

    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  },
};

function getUkTimeParts(date: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const map: Record<string, string> = {};
  for (const p of parts) map[p.type] = p.value;

  const dayMap: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };
  const h = Number(map.hour) % 24;
  const m = Number(map.minute);
  const s = Number(map.second);

  return {
    dayIdx: dayMap[map.weekday] ?? 0,
    secondsSinceMidnight: h * 3600 + m * 60 + s,
    hhmm: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
  };
}

function parseGtfsTimeToSecs(hhmmss: string): number {
  const [h, m, s] = hhmmss.split(":").map(Number);
  return h * 3600 + m * 60 + (s || 0);
}

function findNearestStop(lat: number, lon: number, chain: typeof scheduleData.route_chain) {
  let best = null;
  let minDist = Infinity;
  for (const stop of chain) {
    const d = haversineKm(lat, lon, stop.lat, stop.lon);
    if (d < minDist) {
      minDist = d;
      best = stop;
    }
  }
  return best ? { stop: best, distanceKm: minDist } : null;
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
