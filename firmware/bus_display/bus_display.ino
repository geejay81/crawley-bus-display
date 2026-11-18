#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <Adafruit_GFX.h>
#include <Adafruit_ST7789.h>
#include <SPI.h>
#include "secrets.h"

// IdeaSpark 1.14" ST7789 Onboard Hardware Pins
#define TFT_CS   15
#define TFT_DC    2
#define TFT_RST   4
#define TFT_BL   32

Adafruit_ST7789 tft = Adafruit_ST7789(TFT_CS, TFT_DC, TFT_RST);

// Custom RGB565 Colours
constexpr uint16_t COLOR_BG        = ST77XX_BLACK;
constexpr uint16_t COLOR_HEADER_BG = 0x18E3; // Dark slate
constexpr uint16_t COLOR_AMBER     = 0xFD20; // Classic UK bus stop amber
constexpr uint16_t COLOR_LIVE      = 0x07E0; // Bright green for live GPS
constexpr uint16_t COLOR_DIVIDER   = 0x2945; // Subtle grey line
constexpr uint16_t COLOR_DIM       = 0x8410; // Muted grey

constexpr unsigned long REFRESH_INTERVAL_MS = 35000; // Poll every 35s
unsigned long lastRefreshMs = 0;
bool initialFetchDone = false;

void setup() {
  Serial.begin(115200);

  // Turn on LCD backlight
  pinMode(TFT_BL, OUTPUT);
  digitalWrite(TFT_BL, HIGH);

  // Initialise 135x240 ST7789 in landscape (240x135)
  tft.init(135, 240);
  tft.setRotation(1);
  tft.fillScreen(COLOR_BG);

  drawCenteredMessage("Connecting Wi-Fi...", COLOR_AMBER);

  WiFi.mode(WIFI_STA);
  WiFi.begin(Config::WIFI_SSID, Config::WIFI_PASSWORD);
  while (WiFi.status() != WL_CONNECTED) {
    delay(400);
    Serial.print(".");
  }
  Serial.println("\nWi-Fi connected");
}

void loop() {
  unsigned long now = millis();
  if (!initialFetchDone || (now - lastRefreshMs >= REFRESH_INTERVAL_MS)) {
    fetchAndDisplayArrivals();
    lastRefreshMs = millis();
    initialFetchDone = true;
  }
}

void fetchAndDisplayArrivals() {
  if (WiFi.status() != WL_CONNECTED) {
    drawCenteredMessage("Reconnecting Wi-Fi...", ST77XX_RED);
    WiFi.reconnect();
    return;
  }

  WiFiClientSecure client;
  client.setInsecure(); // Avoids root cert expiration issues on ESP32

  HTTPClient http;
  http.setTimeout(8000);

  if (!http.begin(client, Config::WORKER_URL)) {
    drawCenteredMessage("HTTP Init Failed", ST77XX_RED);
    return;
  }

  int httpCode = http.GET();
  if (httpCode != HTTP_CODE_OK) {
    drawCenteredMessage("API Error: " + String(httpCode), ST77XX_RED);
    http.end();
    return;
  }

  String payload = http.getString();
  http.end();

  JsonDocument doc;
  DeserializationError err = deserializeJson(doc, payload);
  if (err) {
    drawCenteredMessage("JSON Parse Error", ST77XX_RED);
    return;
  }

  renderBoard(doc);
}

void renderBoard(JsonDocument& doc) {
  tft.fillScreen(COLOR_BG);

  const char* stopName = doc["stop"] | "Bus Stop";
  const char* updated  = doc["updated"] | "--:--";
  JsonArray arrivals   = doc["arrivals"].as<JsonArray>();

  // 1. Top Header Bar (240px wide x 24px high)
  tft.fillRect(0, 0, 240, 24, COLOR_HEADER_BG);
  tft.setTextSize(1);
  tft.setTextColor(ST77XX_WHITE, COLOR_HEADER_BG);
  tft.setCursor(6, 8);
  tft.print(stopName);

  // Right-align updated HH:MM
  tft.setTextColor(COLOR_AMBER, COLOR_HEADER_BG);
  tft.setCursor(240 - (strlen(updated) * 6) - 6, 8);
  tft.print(updated);

  // 2. Empty State
  if (arrivals.size() == 0) {
    drawCenteredMessage("No buses due soon", COLOR_DIM);
    return;
  }

  // 3. Render up to 3 rows cleanly on 135px screen height
  int rowY = 30;
  int count = 0;

  for (JsonObject bus : arrivals) {
    if (count >= 3) break;

    const char* line = bus["line"] | "?";
    const char* dest = bus["dest"] | "";
    const char* mins = bus["mins"] | "--";
    bool isLive      = bus["live"] | false;

    // Route Number (e.g. "2")
    tft.setTextSize(2);
    tft.setTextColor(COLOR_AMBER, COLOR_BG);
    tft.setCursor(6, rowY + 4);
    tft.print(line);

    // Destination (e.g. "Ifield")
    tft.setTextColor(ST77XX_WHITE, COLOR_BG);
    tft.setCursor(36, rowY + 4);
    String destStr = String(dest);
    if (destStr.length() > 11) destStr = destStr.substring(0, 11);
    tft.print(destStr);

    // Arrival Time / Countdown (Right-aligned)
    uint16_t timeColor = isLive ? COLOR_LIVE : COLOR_AMBER;
    tft.setTextColor(timeColor, COLOR_BG);
    int timeWidthPx = strlen(mins) * 12; // TextSize 2 = 12px per char
    tft.setCursor(240 - timeWidthPx - 6, rowY + 4);
    tft.print(mins);

    // Divider line between rows
    if (count < 2) {
      tft.drawFastHLine(6, rowY + 29, 228, COLOR_DIVIDER);
    }

    rowY += 35;
    count++;
  }
}

void drawCenteredMessage(const String& msg, uint16_t color) {
  tft.fillScreen(COLOR_BG);
  tft.setTextSize(1);
  tft.setTextColor(color, COLOR_BG);
  int x = max(0, (240 - (int)(msg.length() * 6)) / 2);
  tft.setCursor(x, 63);
  tft.print(msg);
}
