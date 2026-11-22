// ESP32 + DS3231 PoC. Libraries: PubSubClient, ArduinoJson 7, RTClib.
// Reuse the customer's calibrated HX711 code by calling reportReading().
#include <WiFi.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <RTClib.h>
#include <time.h>
#include <math.h>

const char* WIFI_SSID = "YOUR_WIFI";
const char* WIFI_PASSWORD = "YOUR_PASSWORD";
const char* DEVICE_ID = "YOUR_BOX_UUID";
const char* DEVICE_KEY = "YOUR_DEVICE_KEY";
const char* MQTT_HOST = "broker.emqx.io";
const int MQTT_PORT = 1883;
const int SDA_PIN = 21, SCL_PIN = 22;
// Fill the actual wiring. -1 leaves a pin unused. Buttons connect to GND.
const int BUZZER_PIN = -1; // Active buzzer
const int BUTTON_PINS[6] = {-1, -1, -1, -1, -1, -1};

WiFiClient network;
PubSubClient client(network);
Preferences prefs;
RTC_DS3231 rtc;
String inputTopic, outputTopic, pending;
int times[6] = {-1, -1, -1, -1, -1, -1};
uint8_t days[6] = {};
bool active[6] = {}, previousButton[6] = {};
String fired[6], taken[6];
bool rtcPresent = false, clockValid = false, networkTimeSet = false;
unsigned long lastConnect = 0, lastWifi = 0, lastRetry = 0, lastRequest = 0;

String today() {
  DateTime now = rtc.now();
  char text[11];
  snprintf(text, sizeof(text), "%04u-%02u-%02u", now.year(), now.month(), now.day());
  return String(text);
}

void saveChannels() {
  JsonDocument doc;
  JsonArray channels = doc.to<JsonArray>();
  for (int i = 0; i < 6; i++) {
    JsonObject item = channels.add<JsonObject>();
    item["minute"] = times[i];
    item["days"] = days[i];
  }
  String text;
  serializeJson(doc, text);
  if (prefs.getString("channels", "") != text) prefs.putString("channels", text);
}

void requestSchedule() {
  JsonDocument doc;
  doc["type"] = "schedule_request";
  doc["deviceId"] = DEVICE_ID;
  String text;
  serializeJson(doc, text);
  client.publish(inputTopic.c_str(), text.c_str(), false);
  lastRequest = millis();
}

// The existing calibrated HX711 routine can call this with isTake=false.
// For an explicit take decision, call with isTake=true.
// Use NAN when weight cannot be measured. A confirmation button always works.
bool reportReading(int compartment, float weight, bool isTake) {
  if (compartment < 1 || compartment > 6 || !clockValid) return false;
  int index = compartment - 1;
  String date = today();
  JsonDocument doc;
  doc["deviceId"] = DEVICE_ID;
  doc["device_key"] = DEVICE_KEY;
  doc["compartment"] = compartment;
  if (isfinite(weight)) doc["weight"] = weight;
  else doc["weight"] = nullptr;
  doc["isTake"] = isTake;
  doc["scheduledDate"] = date;
  String text;
  serializeJson(doc, text);
  if (!isTake) return client.connected() && client.publish(inputTopic.c_str(), text.c_str(), false);
  if (!active[index] || taken[index] == date) return false;
  JsonDocument queue;
  if (deserializeJson(queue, pending) || queue.size() >= 32) return false;
  queue.as<JsonArray>().add(doc.as<JsonObject>());
  text = "";
  serializeJson(queue, text);
  if (!prefs.putString("pending", text)) return false;
  pending = text;
  taken[index] = date;
  prefs.putString(("taken" + String(index)).c_str(), taken[index]);
  active[index] = false;
  lastRetry = 0;
  return true;
}

void callback(char* topic, byte* payload, unsigned int length) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, length)) return;
  if (doc["type"] == "intake_ack") {
    JsonDocument queue;
    if (deserializeJson(queue, pending) || !queue.size()) return;
    if (queue[0]["compartment"].as<int>() != doc["compartment"].as<int>() ||
        queue[0]["scheduledDate"].as<String>() != doc["scheduledDate"].as<String>()) return;
    queue.as<JsonArray>().remove(0);
    String text;
    serializeJson(queue, text);
    if (prefs.putString("pending", text)) pending = text;
    return;
  }
  if (!doc["compartment"].is<int>() || !doc.containsKey("time")) return;
  int index = doc["compartment"].as<int>() - 1;
  if (index < 0 || index >= 6) return;
  int newTime = -1;
  if (!doc["time"].isNull()) {
    String text = doc["time"].as<String>();
    if (text.length() != 5 || text[2] != ':' ||
        !isDigit(text[0]) || !isDigit(text[1]) || !isDigit(text[3]) || !isDigit(text[4])) return;
    int hour = text.substring(0, 2).toInt(), minute = text.substring(3).toInt();
    if (hour > 23 || minute > 59) return;
    newTime = hour * 60 + minute;
  }
  uint8_t newDays = 127; // A two-field message means every day.
  if (doc.containsKey("days")) {
    if (!doc["days"].is<JsonArray>()) return;
    newDays = 0;
    for (JsonVariant value : doc["days"].as<JsonArray>()) {
      if (!value.is<int>()) return;
      int day = value.as<int>();
      if (day < 0 || day > 6) return;
      newDays |= 1 << day;
    }
  }
  times[index] = newTime;
  days[index] = newDays;
  if (newTime < 0 || !newDays) active[index] = false;
  saveChannels();
  // Acknowledge only after persistent storage contains the expected values.
  JsonDocument stored;
  if (deserializeJson(stored, prefs.getString("channels", "")) ||
      stored[index]["minute"].as<int>() != newTime || stored[index]["days"].as<int>() != newDays) return;
  if (!clockValid) {
    Serial.println("Schedule saved; waiting for valid RTC time before acknowledging");
    return;
  }
  JsonDocument ack;
  ack["type"] = "schedule_ack";
  ack["deviceId"] = DEVICE_ID;
  ack["device_key"] = DEVICE_KEY;
  ack["compartment"] = index + 1;
  ack["time"] = doc["time"];
  JsonArray savedDays = ack["days"].to<JsonArray>();
  for (int day = 0; day < 7; day++) if (newDays & (1 << day)) savedDays.add(day);
  String text;
  serializeJson(ack, text);
  client.publish(inputTopic.c_str(), text.c_str(), false);
  Serial.printf("Saved channel %d, minute %d\n", index + 1, newTime);
}

void maintainNetwork() {
  if (WiFi.status() != WL_CONNECTED) {
    if (millis() - lastWifi > 10000) { lastWifi = millis(); WiFi.begin(WIFI_SSID, WIFI_PASSWORD); }
    return;
  }
  if (!networkTimeSet && rtcPresent) {
    struct tm now;
    if (getLocalTime(&now, 0) && now.tm_year >= 120) {
      // This example uses Thailand time. Set GMT offset to match the CareBee account.
      rtc.adjust(DateTime(now.tm_year + 1900, now.tm_mon + 1, now.tm_mday, now.tm_hour, now.tm_min, now.tm_sec));
      networkTimeSet = true;
      clockValid = true;
    }
  }
  if (!client.connected() && millis() - lastConnect > 5000) {
    lastConnect = millis();
    String id = "carebee-" + WiFi.macAddress();
    if (client.connect(id.c_str())) {
      client.subscribe(outputTopic.c_str(), 1);
      requestSchedule();
    }
  }
  client.loop();
  if (client.connected() && millis() - lastRequest > 30000) requestSchedule();
  if (client.connected() && pending != "[]" && millis() - lastRetry > 5000) {
    lastRetry = millis();
    JsonDocument queue;
    if (!deserializeJson(queue, pending) && queue.size()) {
      String text;
      serializeJson(queue[0], text);
      client.publish(inputTopic.c_str(), text.c_str(), false);
    }
  }
}

void setup() {
  Serial.begin(115200);
  Serial.setTimeout(20);
  Wire.begin(SDA_PIN, SCL_PIN);
  prefs.begin("carebee", false);
  pending = prefs.getString("pending", "[]");
  JsonDocument saved;
  if (!deserializeJson(saved, prefs.getString("channels", "[]")) && saved.size() == 6) {
    for (int i = 0; i < 6; i++) {
      times[i] = saved[i]["minute"] | -1;
      days[i] = saved[i]["days"] | 0;
    }
  }
  rtcPresent = rtc.begin();
  clockValid = rtcPresent && !rtc.lostPower();
  for (int i = 0; i < 6; i++) {
    fired[i] = prefs.getString(("fired" + String(i)).c_str(), "");
    taken[i] = prefs.getString(("taken" + String(i)).c_str(), "");
    if (BUTTON_PINS[i] >= 0) pinMode(BUTTON_PINS[i], INPUT_PULLUP);
    if (clockValid && times[i] >= 0 && days[i] && fired[i] == today() && taken[i] != today()) active[i] = true;
  }
  if (BUZZER_PIN >= 0) { pinMode(BUZZER_PIN, OUTPUT); digitalWrite(BUZZER_PIN, LOW); }
  inputTopic = "medicine/sensor/" + String(DEVICE_ID);
  outputTopic = "medicine/schedule/" + String(DEVICE_ID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  configTime(7 * 3600, 0, "pool.ntp.org", "time.google.com");
  client.setServer(MQTT_HOST, MQTT_PORT);
  client.setCallback(callback);
  client.setBufferSize(4608);
  Serial.println("For manual PoC confirmation while alerting: take 1 ... take 6");
}

void loop() {
  maintainNetwork();
  if (!clockValid) return;
  DateTime now = rtc.now();
  String date = today();
  for (int i = 0; i < 6; i++) {
    if (times[i] == now.hour() * 60 + now.minute() && (days[i] & (1 << now.dayOfTheWeek())) && fired[i] != date) {
      fired[i] = date;
      prefs.putString(("fired" + String(i)).c_str(), date);
      active[i] = taken[i] != date;
      Serial.printf("Reminder for channel %d\n", i + 1);
    }
    if (BUTTON_PINS[i] >= 0) {
      bool pressed = digitalRead(BUTTON_PINS[i]) == LOW;
      if (pressed && !previousButton[i]) reportReading(i + 1, NAN, true);
      previousButton[i] = pressed;
    }
  }
  if (Serial.available()) {
    String command = Serial.readStringUntil('\n');
    command.trim();
    if (command.startsWith("take ")) reportReading(command.substring(5).toInt(), NAN, true);
  }
  bool ringing = false;
  for (bool waiting : active) ringing |= waiting;
  if (BUZZER_PIN >= 0) digitalWrite(BUZZER_PIN, ringing && (millis() / 350 % 2) ? HIGH : LOW);
  // Call reportReading(channel, calibratedWeight, false) from the HX711 code.
  // After stable weight change confirms a take, call reportReading(channel, calibratedWeight, true).
}
