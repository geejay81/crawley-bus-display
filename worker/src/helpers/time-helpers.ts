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

export { getUkTimeParts, parseGtfsTimeToSecs };