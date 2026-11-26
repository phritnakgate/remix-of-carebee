// Arduino IDE: NodeMCU 1.0 (ESP-12E Module), Serial 115200 / Newline.
/*
 * esp8266_medbox.ino — กล่องยาแจ้งเตือน (เฟิร์มแวร์หลัก)
 * ------------------------------------------------------
 * ทำงานตาม flowchart.txt:
 *   WiFi + NTP/RTC -> โหมดประหยัดพลังงาน 30 วิ -> ถึงเวลายา?
 *     -> Buzzer + LED + Telegram/LINE -> รอการตอบสนอง
 *        |- กด Snooze  -> เลื่อน 15 นาที -> ปิดเสียงชั่วคราว
 *        |- กดรับยา    -> สแกนหน้ายืนยัน -> ผ่าน: บันทึก + หักยา -1
 *        |                              -> ไม่ผ่าน 3 ครั้ง: แจ้งผู้ดูแล กลับไปรอ
 *        '- ไม่ตอบ 15 นาที -> ลืมกิน -> บันทึก + แจ้งผู้ดูแล + ปิดเสียง (ไม่หักยา)
 *   พร้อม: แจ้งยาใกล้หมด / แบตต่ำ / สรุปรายวัน 21:00
 */
#include <ESP8266WiFi.h>
#include <ESP8266HTTPClient.h>
#include <WiFiClientSecure.h>
#include <Wire.h>
#include <RTClib.h>
#include <Adafruit_SSD1306.h>
#include <HX711.h>
#include <ArduinoJson.h>
#include <time.h>
#include <PubSubClient.h>
#include <LittleFS.h>
#include <math.h>
#include "config.h"

struct Btn {
  uint8_t pin;
  int last;
  uint32_t t;
};

void btnBegin(Btn& button);
bool btnEdge(Btn& button);
bool carebeeClockReady();
String carebeeDate(const DateTime& date);


struct CareBeeChannel {
  int16_t minuteOfDay = -1;
  uint8_t daysMask = 0;
  bool received = false;
};

namespace CareBee {
using ScheduleHandler = void (*)(uint8_t compartment);
using ClockReady = bool (*)();
void begin(ScheduleHandler handler, ClockReady clockReady);
void tick();
bool connected();
bool alreadyTaken(uint8_t compartment, const char* date);
const CareBeeChannel& channel(uint8_t compartment);
bool report(uint8_t compartment, float grams, bool taken, const char* scheduledDate);
void requestSchedule();
void ping();
}


// ---------------------------------------------------------------- อุปกรณ์
RTC_DS3231 rtc;
bool rtcOk = false;

Adafruit_SSD1306 oled(128, 64, &Wire, -1);
bool oledOk = false;

HX711 scale;
bool scaleOk = false;

enum MedState : uint8_t { ST_IDLE, ST_REMIND, ST_WAIT_RESPONSE, ST_VERIFY_FACE };
MedState state = ST_IDLE;

// ---------------------------------------------------------------- สถานะยา
// ตารางจาก CareBee โดยเก็บสำเนาใน LittleFS
//   -> แก้ตารางผ่านหน้าเว็บ /schedule ของเซิร์ฟเวอร์ได้ ไม่ต้องแฟลชใหม่
DoseSlot doseSchedule[DOSE_MAX];
uint8_t  doseCount = 0;
bool     doseDone[DOSE_MAX];
bool     doseMissed[DOSE_MAX];
int8_t   activeSlot = -1;
int8_t   snoozeSlot = -1;
uint32_t snoozeUntilSec = 0;
uint32_t remindStartedMs = 0;
uint32_t lastRemindMs = 0;
uint32_t lastFaceTryMs = 0;
uint8_t  faceTries = 0;

uint16_t pillsRemaining = PILLS_INITIAL;
uint8_t  takenToday = 0, missedToday = 0, snoozeToday = 0;
int32_t  todayKey = -1;
bool     summarySent = false;
bool     lowStockWarned = false;
bool     batteryWarned = false;

bool     wifiOk = false;
uint32_t lastOledMs = 0, lastTgPollMs = 0, lastCheckMs = 0;
long     tgLastUpdate = 0;

// ---------------------------------------------------------------- util
String carebeeActiveDate, carebeeSnoozeDate;
String carebeeSerialLine;
uint32_t carebeeLastWifi = 0;

String two(int v) { return (v < 10) ? ("0" + String(v)) : String(v); }

bool rtcTimeValid(const DateTime &d) {
  return d.year() >= RTC_MIN_YEAR && d.month() >= 1 && d.month() <= 12 &&
         d.day() >= 1 && d.day() <= 31 && d.isValid();
}

bool rtcReady() {
  return rtcOk && !rtc.lostPower() && rtcTimeValid(rtc.now());
}

bool ntpReady() {
  return time(nullptr) >= 1700000000L;
}

DateTime nowTime() {
  if (rtcReady()) return rtc.now();
  if (ntpReady()) return DateTime(static_cast<uint32_t>(time(nullptr)) + TZ_OFFSET_SEC);
  return DateTime(2000, 1, 1);
}

uint16_t minutesOfDay(const DateTime &d) { return d.hour() * 60 + d.minute(); }
int32_t  dayKeyOf(const DateTime &d) { return (int32_t)d.year() * 10000 + d.month() * 100 + d.day(); }

// BUZZER_ACTIVE_LOW = 0 : ดังเมื่อขา HIGH -> ใช้ tone() (บัซเซอร์ 2 ขา/โมดูล active-HIGH)
// BUZZER_ACTIVE_LOW = 1 : โมดูล trigger ด้วย LOW -> LOW=ดัง / HIGH=เงียบ (ขับระดับตรงๆ)
// ★ เรียกซ้ำได้ปลอดภัย: จำสถานะไว้ เปลี่ยนขาเฉพาะตอนสถานะเปลี่ยน
//   (เดิมเรียก tone() ทุก loop ทำให้ waveform รีสตาร์ทตลอด -> เสียงเพี้ยน/กระตุก เหมือน "เสียงเปลี่ยน")
void buzzer(bool on) {
  static bool last = false;
  static bool known = false;
  if (known && on == last) return;
  known = true;
  last = on;
#if BUZZER_ACTIVE_LOW
  // active-LOW: LOW = ดัง (เสียงจากออสซิลเลเตอร์ในโมดูล) · HIGH = เงียบ
  // ★ ขับระดับตรงๆ ไม่ใช้ tone()/noTone():
  //   noTone() ของ core ESP8266 = stopWaveform() + digitalWrite(pin, 0) -> ขา LOW
  //   ซึ่งกับโมดูล active-LOW คือ "สั่งให้ดัง"  -> นี่คือสาเหตุ "บังแล้ว buzzer ไม่ดับ/ดังยาว"
  pinMode(PIN_BUZZER, OUTPUT);
  digitalWrite(PIN_BUZZER, on ? LOW : HIGH);
#if BUZZER_DEBUG_LOG
  Serial.printf("[BUZZ] %s -> D8=%s\n", on ? "ON" : "OFF", on ? "LOW" : "HIGH");
#endif
#else
  if (on) {
    pinMode(PIN_BUZZER, OUTPUT);
    tone(PIN_BUZZER, BUZZER_FREQ_HZ);
  } else {
    noTone(PIN_BUZZER);
    // ★ กันขาลอยค้าง HIGH: ขับ LOW ให้ชัด (active-HIGH = เงียบ)
    pinMode(PIN_BUZZER, OUTPUT);
    digitalWrite(PIN_BUZZER, LOW);
  }
#if BUZZER_DEBUG_LOG
  Serial.printf("[BUZZ] %s -> D8=%s\n", on ? "ON" : "OFF", on ? "tone" : "LOW");
#endif
#endif
}

// ---------------------------------------------------------------- ปุ่มกด
Btn btnTaken  = { PIN_BTN_TAKEN,  HIGH, 0 };
Btn btnSnooze = { PIN_BTN_SNOOZE, HIGH, 0 };

void btnBegin(Btn &b) {
  pinMode(b.pin, INPUT_PULLUP);
  b.last = digitalRead(b.pin);
  b.t = millis();
}

bool btnEdge(Btn &b) {
  if (!CAREBEE_USE_BUTTONS) return false;
  int v = digitalRead(b.pin);
  if (v == b.last) return false;
  if (millis() - b.t < 30) return false;   // debounce
  b.t = millis();
  bool pressed = (v == LOW);
  b.last = v;
  return pressed;
}

// ---------------------------------------------------------------- IR sensor
// ใช้ยืนยันว่า "มีคนมาหน้ากล่อง" แล้วปิดเสียงเตือน (ตามตัวอย่าง IR_Sensor_example1)
bool     irPresent   = false;   // สถานะที่ผ่าน debounce แล้ว
bool     irSilenced  = false;   // ปิดเสียงเตือนเพราะตรวจพบคนแล้ว
bool     irDisabled  = false;   // เซนเซอร์ค้าง LOW ผิดปกติ -> ปิดฟังก์ชันปิดเสียง (กันเสียงเงียบตลอด)
uint32_t irLowSinceMs = 0;      // เวลาที่เริ่มอ่าน LOW ต่อเนื่อง (ใช้ตรวจจับค้าง)
uint32_t irRearmMs   = 0;       // เวลาที่คนเดินออก (ไว้หน่วงก่อนกลับมาเตือน)
uint32_t irSilencedMs = 0;      // เวลาที่เริ่มปิดเสียงด้วย IR (ใช้กับ IR_SILENCE_LATCH)
uint32_t lastIrLogMs = 0;
int      irBaseline   = -1;     // ค่า A0 ตอน "ยังไม่มีคน" (วัดเองตอนบูต — โหมด auto-baseline)
int      irLastAnalog = 0;      // ค่าดิบ A0 ล่าสุด (สำหรับ log/วินิจฉัย)
uint32_t lastIrDebugMs = 0;
uint8_t  irRecalCount  = 0;     // วัด baseline ใหม่ไปแล้วกี่ครั้ง (กันวัดซ้ำไม่จบ)

// แปลง "มีคน/ไม่มีคน" -> ระดับขา ตามขั้วของโมดูล (IR_ACTIVE_LOW)
int irLevel(bool present) {
  return present ? (IR_ACTIVE_LOW ? LOW : HIGH) : (IR_ACTIVE_LOW ? HIGH : LOW);
}

// วัด baseline: ค่า A0 ตอนยังไม่มีใครอยู่หน้ากล่อง
// ใช้ค่ามัธยฐาน (median) ของ 41 ตัวอย่าง ใน ~400 ms -> ทน noise/spike ได้ดีกว่าค่าเฉลี่ย
void irCalibrateBaseline() {
#if IR_USE_ANALOG && IR_ANALOG_AUTO_BASELINE && IR_ENABLED
  int s[41];
  for (int i = 0; i < 41; i++) { s[i] = analogRead(PIN_IR_SENSOR); delay(10); }
  for (int i = 1; i < 41; i++) {          // insertion sort (41 ตัวเล็กมาก)
    int k = s[i], j = i - 1;
    while (j >= 0 && s[j] > k) { s[j + 1] = s[j]; j--; }
    s[j + 1] = k;
  }
  irBaseline = s[20];
  Serial.printf("[IR] baseline A0 = %d (min=%d max=%d)\n", irBaseline, s[0], s[40]);
  // ★ ค่า 1024 = OUT อยู่ที่ระดับ 3.3V (ไม่มีคน) = ปกติของโมดูลนี้ (ไม่ใช่ความผิดพลาด)
  if (irBaseline < 40) {
    Serial.println(F("[IR] !! baseline ต่ำผิดปกติ (~0) — OUT อาจถูกดึงลง GND หรือยังไม่ได้ต่อสาย"));
    Serial.println(F("[IR]    ตรวจสาย OUT->A0 / GND / VCC แล้วหมุน trimpot ให้ LED ติดตอนเอามือบัง"));
  } else if (irBaseline >= 1000) {
    Serial.println(F("[IR] baseline อยู่ระดับสูงสุด (OUT ~3.3V) = ปกติ · เอามือบังแล้วค่าต้องลดลงมากกว่า delta"));
  }
#else
  irBaseline = -1;
#endif
}

// อ่านค่าดิบของขา IR (รองรับทั้ง D7 = digital และ A0 = analog)
int irReadRaw() {
#if IR_USE_ANALOG
  int a = analogRead(PIN_IR_SENSOR);
  irLastAnalog = a;
#if IR_ANALOG_AUTO_BASELINE
  if (irBaseline >= 0) {
    int diff  = (a > irBaseline) ? (a - irBaseline) : (irBaseline - a);
    int enter = IR_ANALOG_DELTA;
    int exitD = (IR_ANALOG_DELTA * IR_ANALOG_EXIT_PCT) / 100;
    // มีคนค้างอยู่แล้ว -> ต้องกลับมาใกล้ baseline จริง ๆ กว่าจะนับว่าว่าง (hysteresis)
    return irLevel(diff >= (irPresent ? exitD : enter));
  }
  return irLevel(false);              // ยังไม่วัด baseline -> ถือว่ายังไม่มีคน
#else
  // hysteresis: ค่าแกว่งรอบ threshold ไม่ให้สถานะสลับไปมา (เสียงกระตุก + log ถี่)
  int th = IR_ANALOG_THRESHOLD + (irPresent ? IR_ANALOG_HYST : -IR_ANALOG_HYST);
  return (a > th) ? HIGH : LOW;
#endif
#else
  return digitalRead(PIN_IR_SENSOR);
#endif
}

void irBegin() {
#if IR_ENABLED
#if !IR_USE_ANALOG
  pinMode(PIN_IR_SENSOR, INPUT_PULLUP);   // pull-up ภายในกันขาลอย (เฉพาะขาดิจิทัล)
#endif
  irCalibrateBaseline();
  int v = irReadRaw();
  irPresent = (v == irLevel(true));
#if IR_USE_ANALOG && IR_ANALOG_AUTO_BASELINE
  Serial.printf("[IR] เริ่มทำงาน ขา %d (analog | baseline=%d delta=%d exit=%d%% | %s)\n",
                PIN_IR_SENSOR, irBaseline, IR_ANALOG_DELTA, IR_ANALOG_EXIT_PCT,
                IR_ACTIVE_LOW ? "active LOW" : "active HIGH");
#else
  Serial.printf("[IR] เริ่มทำงาน ขา %d (%s, idle=%d, %s)\n", PIN_IR_SENSOR,
                IR_USE_ANALOG ? "analog" : "digital", v,
                IR_ACTIVE_LOW ? "active LOW" : "active HIGH");
#endif
  if (irPresent) {
    Serial.println(F("[IR] !! อ่านค่า \"มีคน\" ตั้งแต่เปิดเครื่อง - ถ้าไม่ควรมีคน ให้ตรวจสาย OUT/GND/trimpot"));
    Serial.printf("[IR] ถ้าค่าค้างเกิน %lu วิ ระบบจะปิดการใช้ IR อัตโนมัติ (กันเสียงเตือนถูกปิดตลอด)\n",
                  (unsigned long)(IR_STUCK_MS / 1000UL));
  }
#else
  Serial.println("[IR] ปิดใช้งาน (IR_ENABLED false)");
#endif
}

// คืนค่า true เมื่อยืนยันว่ามีคนอยู่หน้ากล่อง (มี debounce ในตัว)
bool irPoll() {
#if IR_ENABLED
  static int      lastRaw = -1;
  static uint32_t lastChange = 0;
  int v = irReadRaw();

#if IR_DEBUG_LOG
  // log ค่าดิบทุก 1 วิ -> ใช้จูน/ตรวจว่าบังมือแล้วค่าวิ่งจริงไหม
  if (millis() - lastIrDebugMs >= 1000) {
    lastIrDebugMs = millis();
    int diff = (irBaseline >= 0) ? (irLastAnalog > irBaseline ? irLastAnalog - irBaseline
                                                             : irBaseline - irLastAnalog) : -1;
    Serial.printf("[IR] A0=%4d b=%4d d=%4d %s\n", irLastAnalog, irBaseline, diff,
                  irPresent ? "PRESENT" : "clear");
  }
#endif

  if (v != lastRaw) { lastRaw = v; lastChange = millis(); return irPresent; }
  if (millis() - lastChange < IR_CONFIRM_MS) return irPresent;
  bool now = (v == irLevel(true));
  if (now != irPresent) {
    irPresent = now;
    Serial.printf("[IR] %s\n", now ? "ตรวจพบคน" : "ไม่พบคนแล้ว");
  }
#else
  irPresent = false;
#endif
  return irPresent;
}

void irSilenceAlarm() {
  if (irSilenced) return;
  if (irDisabled) return;          // เซนเซอร์ค้างอยู่ -> ไม่ใช้ปิดเสียง
  irSilenced = true;
  irSilencedMs = millis();
  irRearmMs = 0;
  buzzer(false);
  digitalWrite(PIN_LED, LOW);

  DateTime n = nowTime();
  String msg = "👤 ตรวจพบผู้ใช้อยู่หน้ากล่อง -> ปิดเสียงเตือนชั่วคราว";
  if (activeSlot >= 0) msg += String("\nมื้อยา: ") + doseSchedule[activeSlot].label;
  msg += "\nเวลา " + two(n.hour()) + ":" + two(n.minute());
  msg += IR_SILENCE_LATCH ? "\n(เสียงจะไม่กลับมาดังเอง — กด \"รับยา\" เพื่อบันทึกการกิน)"
                          : "\n(ถอยออกจากกล่อง 5 วิ เสียงจะกลับมาเตือน)";
  msg += "\nกดปุ่ม \"รับยา\" เมื่อกินยาแล้ว";
  tgSend(msg);
  logEvent("ir_present", msg);
  Serial.println("[IR] ปิดเสียงเตือนเพราะตรวจพบคน");
  updateDisplay();
}

void irResumeAlarm() {
  if (!irSilenced) return;
  irSilenced = false;
  irSilencedMs = 0;
  irRearmMs = 0;
  if (state == ST_WAIT_RESPONSE) {
    buzzer(true);
    lastRemindMs = millis();      // เริ่มนับเตือนซ้ำใหม่ ไม่ให้ยิง Telegram ทันที
    Serial.println("[IR] กลับมาเปิดเสียงเตือนอีกครั้ง");
    logEvent("ir_absent", "กลับมาเปิดเสียงเตือน (เซนเซอร์ไม่เห็นคนแล้ว / ครบเวลาปิดเสียง)");
  }
  updateDisplay();
}

// เรียกทุก loop: จัดการตอนมีคนมา/คนออก
void handleIr() {
#if IR_ENABLED
  bool was = irPresent;
  irPoll();

  // ---- ตรวจเซนเซอร์ค้าง (อ่าน "มีคน" ตลอดเวลา) เพื่อไม่ให้เสียงเตือนถูกปิดถาวร ----
  bool inAlarm = (state == ST_REMIND || state == ST_WAIT_RESPONSE || state == ST_VERIFY_FACE);
  if (irPresent && !inAlarm && !irDisabled) {
    if (irLowSinceMs == 0) irLowSinceMs = millis();
    else if (millis() - irLowSinceMs >= IR_STUCK_MS) {
      // ก่อนปิด IR ลองวัด baseline ใหม่ก่อน (อาจมีของวางบังหน้าเซนเซอร์ตอนบูต ทำให้ baseline เพี้ยน)
      if (IR_ANALOG_AUTO_BASELINE && irRecalCount < 2) {
        irRecalCount++;
        int old = irBaseline;
        irLowSinceMs = 0;
        irCalibrateBaseline();
        Serial.printf("[IR] วัด baseline ใหม่ (%d -> %d) ครั้งที่ %u\n", old, irBaseline, irRecalCount);
        logEvent("ir_recal", "วัด baseline ของ IR ใหม่ (ค่าเดิมทำให้อ่านเป็น \"มีคน\" ค้าง)");
        updateDisplay();
      } else {
        irDisabled = true;
        if (irSilenced) irResumeAlarm();     // คืนเสียงเตือนทันที
        String m = "⚠️ เซนเซอร์ IR อ่านค่า \"มีคน\" ค้างต่อเนื่อง — ปิดการใช้ IR ชั่วคราว "
                   "เพื่อไม่ให้เสียงเตือนถูกปิดตลอดเวลา\nตรวจสาย/trimpot หรือถอดโมดูลออก";
        tgSend(m);
        logEvent("ir_stuck", m);
        Serial.println("[IR] ค่าค้าง (LOW ต่อเนื่อง) -> ปิดฟังก์ชันปิดเสียงด้วย IR");
        updateDisplay();
      }
    }
  } else if (!irPresent) {
    irLowSinceMs = 0;
    irRecalCount = 0;
    if (irDisabled) {
      irDisabled = false;
      Serial.println("[IR] ค่ากลับมาปกติ -> เปิดฟังก์ชันปิดเสียงด้วย IR อีกครั้ง");
      logEvent("ir_ok", "เซนเซอร์ IR กลับมาทำงานปกติ");
      updateDisplay();
    }
  }

  if (irDisabled) return;

  if (irPresent && !was) {
    lastIrLogMs = millis();
    if (state == ST_REMIND || state == ST_WAIT_RESPONSE || state == ST_VERIFY_FACE) {
      irSilenceAlarm();
    } else {
      // มีคนมาดูกล่องตอนไม่ได้เตือน: แค่บันทึกไว้ ไม่ต้องทำอะไร
      logEvent("ir_present", "ตรวจพบผู้ใช้หน้ากล่อง (ไม่ได้อยู่ในช่วงเตือน)");
    }
  } else if (!irPresent && was) {
    if (IR_SILENCE_LATCH) {
      // ล็อกไว้: ถอยมือแล้วก็ไม่กลับมาเตือนเอง (ต้องกด "รับยา"/"snooze" เท่านั้น)
      if (irSilenced) logEvent("ir_absent", "ถอยมือแล้ว แต่ยังปิดเสียงค้างไว้ (latch) — รอผู้ใช้กดรับยา");
      else            logEvent("ir_absent", "ไม่พบผู้ใช้หน้ากล่องแล้ว");
    } else {
      if (irSilenced && state == ST_WAIT_RESPONSE) irRearmMs = millis();
      else logEvent("ir_absent", "ไม่พบผู้ใช้หน้ากล่องแล้ว");
    }
  }

  if (IR_SILENCE_LATCH) {
    // กันลืม: ถ้าเงียบค้างนานเกิน IR_LATCH_MAX_MS โดยไม่มีใครกดรับยา -> เตือนกลับมา (0 = ไม่จำกัด)
    if (irSilenced && (IR_LATCH_MAX_MS) > 0 && state == ST_WAIT_RESPONSE &&
        millis() - irSilencedMs >= (unsigned long)(IR_LATCH_MAX_MS)) {
      Serial.println("[IR] ปิดเสียงค้างเกินกำหนด -> กลับมาเตือนอีกครั้ง");
      logEvent("ir_latch_timeout", "ปิดเสียงด้วย IR ค้างเกินกำหนด กลับมาเตือนอีกครั้ง");
      irResumeAlarm();
    }
  } else {
    if (irRearmMs && millis() - irRearmMs >= IR_REARM_MS) irResumeAlarm();
  }

  // กันเหนียว: ถ้าอยู่นิ่ง ๆ หน้ากล่องนาน ๆ ให้ปิดเสียงซ้ำ (กรณีมีคนกด reset/ไฟกระพริบ)
  if (irPresent && irSilenced && state == ST_WAIT_RESPONSE &&
      millis() - lastIrLogMs > 60000UL) {
    lastIrLogMs = millis();
    buzzer(false);
    digitalWrite(PIN_LED, LOW);
  }
#endif
}

// ---------------------------------------------------------------- Telegram (Bot API ตรง)
bool tgEnabled() {
  return strlen(TELEGRAM_BOT_TOKEN) > 10 && strlen(TELEGRAM_CHAT_ID) > 0 && wifiOk;
}

void tgSend(const String &text) {
  if (!tgEnabled()) { Serial.println("[TG] ปิดอยู่ (ไม่ตั้ง token/chat id หรือ WiFi หลุด)"); return; }
  WiFiClientSecure client;
  client.setInsecure();       // ใช้งานจริงควรใช้ setTrustAnchors()
  client.setBufferSizes(512, 512);

  HTTPClient http;
  http.setTimeout(8000);
  String url = String("https://api.telegram.org/bot") + TELEGRAM_BOT_TOKEN + "/sendMessage";
  if (!http.begin(client, url)) { Serial.println("[TG] begin failed"); return; }
  http.addHeader("Content-Type", "application/json");

  JsonDocument doc;
  doc["chat_id"] = TELEGRAM_CHAT_ID;
  doc["text"] = text;
  String payload;
  serializeJson(doc, payload);

  int code = http.POST(payload);
  Serial.printf("[TG] sendMessage -> %d\n", code);
  http.end();
}

// ---------------------------------------------------------------- คำสั่ง Telegram (ขาเข้า)
String stateName() {
  switch (state) {
    case ST_IDLE:          return "ว่าง (รอเวลายา)";
    case ST_REMIND:        return "กำลังเตือน";
    case ST_WAIT_RESPONSE: return "กำลังเตือน (รอตอบ)";
    case ST_VERIFY_FACE:   return "รอสแกนใบหน้า";
  }
  return "?";
}

String statusText() {
  DateTime t = nowTime();
  String s = "📋 สถานะกล่องยา\n";
  s += "เวลา: " + two(t.hour()) + ":" + two(t.minute()) + "  " +
       two(t.day()) + "/" + two(t.month()) + "/" + String(t.year());
  if (!rtcTimeValid(t)) s += " (ยังไม่ซิงค์)";
  s += "\nสถานะ: " + stateName();
  s += "\nยาคงเหลือ: " + String(pillsRemaining) + " เม็ด";
  if (scaleOk && LOADCELL_CALIBRATION > 0.0f) s += " (จากน้ำหนักจริง)";
  s += "\nวันนี้: กิน " + String(takenToday) + " | ข้าม " + String(missedToday) +
       " | เลื่อน " + String(snoozeToday);
  s += "\nWiFi: " + String(wifiOk ? "ออนไลน์" : "ออฟไลน์");
  s += "\nIR: " + String(irSilenced ? (IR_SILENCE_LATCH ? "ปิดเสียงแล้ว (ค้าง รอกดรับยา)"
                                                        : "ปิดเสียงอยู่ (มีคนหน้าเครื่อง)")
                                   : (IR_ENABLED ? "พร้อม" : "ปิดใช้"));
  s += "\nโหมดเดโม: " + String(DEMO_MODE ? "เปิด" : "ปิด");
  uint16_t nowMin = minutesOfDay(t);
  for (uint8_t i = 0; i < doseCount; i++) {
    uint16_t slotMin = (uint16_t)doseSchedule[i].hour * 60 + doseSchedule[i].minute;
    const auto& channel = CareBee::channel(i + 1);
    if (channel.received && channel.minuteOfDay >= 0 && (channel.daysMask & (1 << t.dayOfTheWeek())) &&
        !doseDone[i] && !doseMissed[i] && slotMin >= nowMin) {
      s += "\nมื้อถัดไป: " + two(doseSchedule[i].hour) + ":" + two(doseSchedule[i].minute) +
           " (" + String(doseSchedule[i].label) + ")";
      break;
    }
  }
  return s;
}

String helpText() {
  return String("🤖 คำสั่งที่ใช้ได้\n") +
         "• รับยา / taken — ยืนยันว่ากินยาแล้ว\n" +
         "• snooze / เลื่อน — เลื่อนเตือน " + String(SNOOZE_MINUTES) + " นาที\n" +
         "• เวลา / time — ดูเวลากล่องยา\n" +
         "• สถานะ / status — สรุปยาคงเหลือ + สถิติวันนี้\n" +
         "• ตาราง / schedule — ดูตารางยา + ดึงตารางใหม่จากเซิร์ฟเวอร์\n" +
         "• ทดสอบ / test — เริ่มเตือนทันที (ใช้สาธิต)";
}

// ---------------------------------------------------------------- ตารางยาจาก backend
void printSchedule() {
  for (uint8_t i = 0; i < doseCount; i++) {
    const auto& channel = CareBee::channel(i + 1);
    if (!channel.received || channel.minuteOfDay < 0 || !channel.daysMask)
      Serial.printf("[SCHED] compartment=%u disabled/not received\n", i + 1);
    else Serial.printf("[SCHED] compartment=%u %02u:%02u %s daysMask=%u\n", i + 1,
                       doseSchedule[i].hour, doseSchedule[i].minute, doseSchedule[i].label, channel.daysMask);
  }
}

/** เตรียมช่องจริง 1-6; เวลาเปิดใช้จาก CareBee หรือ Flash เท่านั้น */
void applyDefaultSchedule() {
  static_assert(DOSE_MAX >= 6, "CareBee requires six dose slots");
  const char* labels[6] = {"Morning before", "Morning after", "Noon before", "Noon after", "Evening before", "Evening after"};
  doseCount = 6;
  for (uint8_t i = 0; i < doseCount; i++) {
    doseSchedule[i].hour = 0;
    doseSchedule[i].minute = 0;
    strncpy(doseSchedule[i].label, labels[i], LABEL_LEN - 1);
    doseSchedule[i].label[LABEL_LEN - 1] = '\0';
    doseDone[i] = false;
    doseMissed[i] = false;
  }
  // No hardcoded fallback alarms: channels are enabled by CareBee/cache only.
}

/** ขอตาราง MQTT; callback อัปเดต doseSchedule เดิมเมื่อบันทึกสำเร็จ */
bool fetchSchedule(bool verbose) {
  // CareBee is the schedule source. Never overwrite MQTT schedules via old HTTP.
  CareBee::requestSchedule();
  if (verbose) printSchedule();
  return CareBee::connected();
}

/** ข้อความตารางยาสำหรับ Telegram (มี ✅/❌ ของวันนี้ด้วย) */
String scheduleText() {
  String s = "🗓 ตารางยาที่ใช้อยู่ (" + String(doseCount) + " ช่อง)\n";
  const String date = carebeeDate(nowTime());
  for (uint8_t i = 0; i < doseCount; i++) {
    const auto& channel = CareBee::channel(i + 1);
    if (!channel.received || channel.minuteOfDay < 0 || !channel.daysMask) {
      s += String("#") + (i + 1) + " disabled\n";
      continue;
    }
    s += String("#") + (i + 1) + " • " + two(doseSchedule[i].hour) + ":" + two(doseSchedule[i].minute) + " — " +
         String(doseSchedule[i].label);
    if (doseDone[i] || CareBee::alreadyTaken(i + 1, date.c_str()))
      s += "  ✅ รับยาแล้ว";
    else if (doseMissed[i]) s += "  ❌ ข้ามมื้อ";
    s += "\n";
  }
  s += "แก้ตารางได้ที่หน้า CareBee";
  return s;
}

void tgPoll() {
  if (!tgEnabled()) return;
  if (millis() - lastTgPollMs < 3000) return;
  lastTgPollMs = millis();

  WiFiClientSecure client;
  client.setInsecure();
  client.setBufferSizes(512, 512);

  HTTPClient http;
  http.setTimeout(8000);
  String url = String("https://api.telegram.org/bot") + TELEGRAM_BOT_TOKEN +
               "/getUpdates?timeout=0&offset=" + String(tgLastUpdate + 1);
  if (!http.begin(client, url)) return;
  int code = http.GET();
  if (code != 200) { http.end(); return; }
  String body = http.getString();
  http.end();

  JsonDocument doc;
  if (deserializeJson(doc, body)) return;

  for (JsonObject msg : doc["result"].as<JsonArray>()) {
    long upd = msg["update_id"] | 0L;
    if (upd > tgLastUpdate) tgLastUpdate = upd;
    String chatId = String((long)(msg["message"]["chat"]["id"] | 0L));
    String text   = String((const char *)(msg["message"]["text"] | ""));
    if (chatId != String(TELEGRAM_CHAT_ID)) continue;
    text.toLowerCase();
    if (text.indexOf("รับยา") >= 0 || text.indexOf("taken") >= 0) {
      handleTakenPressed();
    } else if (text.indexOf("snooze") >= 0 || text.indexOf("เลื่อน") >= 0) {
      handleSnoozePressed();
    } else if (text.indexOf("เวลา") >= 0 || text.indexOf("time") >= 0) {
      DateTime t = nowTime();
      char buf[64];
      snprintf(buf, sizeof(buf), "🕒 เวลากล่องยา: %02d:%02d  %02d/%02d/%04d",
               t.hour(), t.minute(), t.day(), t.month(), t.year());
      String out = buf;
      if (!rtcTimeValid(t)) out += "\n⚠️ เวลายังไม่ถูก (รอ NTP/WiFi)";
      else if (!wifiOk)      out += "\n(ตอนนี้ offline ใช้เวลาจาก RTC)";
      tgSend(out);
    } else if (text.indexOf("ทดสอบ") >= 0 || text.indexOf("test") >= 0) {
      if (state == ST_IDLE) {
        startReminder(0);
        tgSend("🧪 โหมดทดสอบ: เริ่มเตือนมื้อ Morning 08:00 ทันที\n"
               "กดปุ่ม \"รับยา\" หรือพิมพ์ \"รับยา\" / \"snooze\" เพื่อทดสอบต่อ");
        logEvent("demo_remind", "เริ่มทดสอบการเตือนผ่านคำสั่ง Telegram");
      } else {
        tgSend("⚠️ ตอนนี้กำลังเตือนอยู่แล้ว — พิมพ์ \"รับยา\" หรือ \"snooze\" ก่อน");
      }
    } else if (text.indexOf("สถานะ") >= 0 || text.indexOf("status") >= 0) {
      tgSend(statusText());
    } else if (text.indexOf("ตาราง") >= 0 || text.indexOf("schedule") >= 0) {
      bool got = fetchSchedule(true);
      tgSend(String(got ? "🔄 ดึงตารางใหม่จากเซิร์ฟเวอร์แล้ว\n\n"
                        : "ℹ️ ใช้ตารางที่อยู่ในเครื่อง (ดึงจากเซิร์ฟเวอร์ไม่ได้)\n\n") + scheduleText());
    } else if (text.indexOf("ช่วย") >= 0 || text.indexOf("help") >= 0 || text.indexOf("เมนู") >= 0) {
      tgSend(helpText());
    }
  }
}

// ---------------------------------------------------------------- backend REST
void logEvent(const char *type, const String &detail) {
  DateTime n = nowTime();
  Serial.printf("[EVENT] %s | %s | pills=%u\n", type, detail.c_str(), pillsRemaining);
  if (strlen(BACKEND_URL) == 0 || !wifiOk) return;

  WiFiClient client;
  HTTPClient http;
  http.setTimeout(4000);
  if (!http.begin(client, String(BACKEND_URL))) return;
  http.addHeader("Content-Type", "application/json");

  JsonDocument doc;
  doc["device"] = WIFI_HOSTNAME;
  doc["type"]   = type;
  doc["detail"] = detail;
  doc["pills"]  = pillsRemaining;
  char ts[25];
  snprintf(ts, sizeof(ts), "%04d-%02d-%02d %02d:%02d:%02d",
           n.year(), n.month(), n.day(), n.hour(), n.minute(), n.second());
  doc["time"]  = ts;
  doc["epoch"] = n.unixtime();

  String payload;
  serializeJson(doc, payload);
  int code = http.POST(payload);
  Serial.printf("[API] POST -> %d\n", code);
  http.end();
}

// ---------------------------------------------------------------- จอ OLED
void updateDisplay() {
  if (!oledOk) return;
  DateTime n = nowTime();
  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);
  oled.setTextSize(2);
  oled.setCursor(0, 0);
  oled.printf("%02d:%02d", n.hour(), n.minute());
  oled.setTextSize(1);
  oled.setCursor(78, 6);
  oled.printf("%02d/%02d", n.day(), n.month());

  oled.setCursor(0, 20);
  oled.printf("Pills left: %u", pillsRemaining);

  oled.setCursor(0, 32);
  switch (state) {
    case ST_IDLE:          oled.println(F("Status: idle"));     break;
    case ST_REMIND:        oled.println(F("TAKE MEDICINE!"));    break;
    case ST_WAIT_RESPONSE: oled.println(F("Waiting... TAKEN?")); break;
    case ST_VERIFY_FACE:   oled.println(F("Scanning face..."));  break;
  }

  oled.setCursor(0, 44);
  if (activeSlot >= 0) {
    oled.printf("Dose: %s", doseSchedule[activeSlot].label);
  } else if (snoozeSlot >= 0) {
    DateTime s((uint32_t)snoozeUntilSec);
    oled.printf("Snooze -> %02d:%02d", s.hour(), s.minute());
  } else {
    oled.printf("OK:%u Miss:%u Snz:%u", takenToday, missedToday, snoozeToday);
  }

  oled.setCursor(0, 56);
#if IR_ENABLED
  oled.printf("IR:%s", irDisabled ? "stuck" : (irPresent ? "person" : "clear"));
  if (irSilenced) oled.print(F("  MUTED"));
#else
  oled.print(F("IR: off"));
#endif
  oled.display();
}

// ---------------------------------------------------------------- เริ่มเตือน
void startReminder(int8_t slot) {
  if (slot < 0 || slot >= doseCount || !carebeeClockReady()) return;
  const auto& channel = CareBee::channel(slot + 1);
  if (!channel.received || channel.minuteOfDay < 0 || !channel.daysMask) return;
  carebeeActiveDate = carebeeDate(nowTime());
  activeSlot = slot;
  faceTries = 0;
  lastRemindMs = 0;
  remindStartedMs = millis();
  state = ST_REMIND;
  buzzer(true);
  Serial.printf("[REMIND] compartment=%u date=%s %s\n", slot + 1,
                carebeeActiveDate.c_str(), doseSchedule[slot].label);
}

void handleRemind() {
  if (!irSilenced) {
    digitalWrite(PIN_LED, ((millis() / LED_BLINK_MS) % 2) ? HIGH : LOW);
    buzzer(true);
  }

  if (lastRemindMs == 0) {
    DateTime n = nowTime();
    String msg = String("💊 ถึงเวลากินยา: ") + doseSchedule[activeSlot].label;
    msg += "\nเวลา " + two(n.hour()) + ":" + two(n.minute());
    msg += "\nกดปุ่ม \"รับยา\" เมื่อกินแล้ว หรือ \"Snooze\" เพื่อเลื่อน 15 นาที";
    msg += "\nหรือพิมพ์ 'รับยา' / 'snooze' ในแชทนี้";
    tgSend(msg);
    logEvent("remind", msg);
    lastRemindMs = millis();
  }
  state = ST_WAIT_RESPONSE;
}

void handleResponse() {
  if (!irSilenced) {
    digitalWrite(PIN_LED, ((millis() / LED_BLINK_MS) % 2) ? HIGH : LOW);
    // เตือนซ้ำทุก 3 นาที (เฉพาะตอนยังไม่ปิดเสียงด้วย IR)
    if (millis() - lastRemindMs >= REPEAT_REMIND_MS) {
      DateTime n = nowTime();
      String msg = String("⏰ เตือนซ้ำ: ยังไม่ได้กินยา ") + doseSchedule[activeSlot].label;
      msg += " (" + two(n.hour()) + ":" + two(n.minute()) + ")";
      tgSend(msg);
      logEvent("remind_again", msg);
      lastRemindMs = millis();
    }
    buzzer(true);
  }

  if (millis() - remindStartedMs >= RESPONSE_TIMEOUT_MS) {
    markMissed();
    return;
  }

  if (btnEdge(btnTaken))  { handleTakenPressed();  return; }
  if (btnEdge(btnSnooze)) { handleSnoozePressed(); return; }
  tgPoll();
}

// ---------------------------------------------------------------- การตอบสนอง
void handleTakenPressed() {
  if (state != ST_REMIND && state != ST_WAIT_RESPONSE) {
    Serial.println("[BTN] กดรับยา แต่ยังไม่มีมื้อที่กำลังเตือน -> เพิกเฉย");
    return;
  }
  buzzer(false);
  digitalWrite(PIN_LED, LOW);
  faceTries = 0;
  lastFaceTryMs = 0;
  state = ST_VERIFY_FACE;
  logEvent("taken_button", "ผู้ใช้กดปุ่มรับยา -> เริ่มสแกนหน้า");
}

void handleSnoozePressed() {
  if (state != ST_WAIT_RESPONSE && state != ST_VERIFY_FACE) return;
  buzzer(false);
  digitalWrite(PIN_LED, LOW);
  DateTime n = nowTime();
  snoozeSlot = activeSlot;
  carebeeSnoozeDate = carebeeActiveDate;
  snoozeUntilSec = n.unixtime() + (uint32_t)SNOOZE_MINUTES * 60;
  snoozeToday++;
  String msg = String("😴 เลื่อนแจ้งเตือน ") + doseSchedule[activeSlot].label +
               " ไปอีก " + String(SNOOZE_MINUTES) + " นาที";
  tgSend(msg);
  logEvent("snooze", msg);
  activeSlot = -1;
  state = ST_IDLE;
  irSilenced = false;
  irSilencedMs = 0;
  irRearmMs = 0;
  updateDisplay();
}

// ---------------------------------------------------------------- สแกนหน้า
bool requestFaceVerify() {
  if (!FACE_VERIFY_ENABLED) return true;
  if (strlen(CAM_NODE_URL) == 0) {
    Serial.println("[FACE] ยังไม่ได้ตั้ง CAM_NODE_URL -> ถือว่าผ่าน (โหมดทดสอบ)");
    return true;
  }
  WiFiClient client;
  HTTPClient http;
  http.setTimeout(7000);
  if (!http.begin(client, String(CAM_NODE_URL))) return false;
  int code = http.GET();
  bool ok = false;
  if (code == 200) {
    String body = http.getString();
    Serial.printf("[FACE] %s\n", body.c_str());
    JsonDocument doc;
    if (!deserializeJson(doc, body)) ok = doc["match"] | false;
  } else {
    Serial.printf("[FACE] HTTP %d\n", code);
  }
  http.end();
  return ok;
}

void handleFaceVerify() {
  if (millis() - lastFaceTryMs < 1200) return;
  lastFaceTryMs = millis();

  if (requestFaceVerify()) {
    markTaken(true);
    return;
  }
  faceTries++;
  if (faceTries >= MAX_FACE_TRIES) {
    String msg = String("⚠️ ยืนยันใบหน้าไม่สำเร็จ ") + String(MAX_FACE_TRIES) +
                 " ครั้ง ผู้สูงอายุอาจต้องได้รับการช่วยเหลือ";
    tgSend(msg);
    logEvent("face_fail", msg);
    faceTries = 0;
    lastRemindMs = millis();
    if (!irSilenced) buzzer(true);
    state = ST_WAIT_RESPONSE;
  } else {
    tgSend("❌ ใบหน้าไม่ตรง กรุณาลองใหม่");
    logEvent("face_mismatch", "ใบหน้าไม่ตรง ลองใหม่ครั้งที่ " + String(faceTries));
  }
  updateDisplay();
}

// ---------------------------------------------------------------- บันทึกผล
void markTaken(bool viaFace) {
  if (activeSlot < 0 || activeSlot >= doseCount) return;
  // Hook into the original successful confirmation, BEFORE clearing activeSlot.
  String date = carebeeActiveDate.length() ? carebeeActiveDate : carebeeDate(nowTime());
  if (!CareBee::report(activeSlot + 1, NAN, true, date.c_str())) {
    Serial.println(F("[TAKE] Intake not saved locally; check LittleFS or pending acknowledgments."));
    lastRemindMs = millis();
    state = ST_WAIT_RESPONSE;
    if (!irSilenced) buzzer(true);
    return;
  }
  buzzer(false);
  digitalWrite(PIN_LED, LOW);
  DateTime n = nowTime();
  if (date == carebeeDate(n)) doseDone[activeSlot] = true;
  takenToday++;
  if (pillsRemaining > 0) pillsRemaining--;

  String msg = String("✅ ยืนยันรับยาที่กล่องแล้ว: ") +
               (activeSlot >= 0 ? String(doseSchedule[activeSlot].label) : String("-"));
  msg += " เวลา " + two(n.hour()) + ":" + two(n.minute());
  if (viaFace) msg += " (ยืนยันใบหน้าผ่าน)";
  msg += "\nยาเหลือ " + String(pillsRemaining) + " เม็ด";
  tgSend(msg);
  logEvent("taken", msg);

  activeSlot = -1;
  state = ST_IDLE;
  irSilenced = false;
  irSilencedMs = 0;
  irRearmMs = 0;
  checkLowStock();
  updateDisplay();
}

void markMissed() {
  buzzer(false);
  digitalWrite(PIN_LED, LOW);
  if (activeSlot >= 0 && carebeeActiveDate == carebeeDate(nowTime())) doseMissed[activeSlot] = true;
  missedToday++; // A missed dose must not reduce stock.

  String msg = String("❌ ลืมกินยา: ") +
               (activeSlot >= 0 ? String(doseSchedule[activeSlot].label) : String("-"));
  msg += "\nระบบปิดเสียงเตือนอัตโนมัติแล้ว ไม่หักสต็อกยา";
  tgSend(msg);
  logEvent("missed", msg);

  activeSlot = -1;
  state = ST_IDLE;
  irSilenced = false;
  irSilencedMs = 0;
  irRearmMs = 0;
  checkLowStock();
  updateDisplay();
}

// ---------------------------------------------------------------- น้ำหนักยา / แจ้งเตือนคลังยา
void updatePillsFromScale() {
  if (!scaleOk || LOADCELL_CALIBRATION == 0.0f) return;
  if (!scale.is_ready()) return;
  float grams = scale.get_units(3);
  int n = (int)lroundf((grams - EMPTY_TRAY_WEIGHT_G) / PILL_WEIGHT_G);
  if (n < 0) n = 0;
  if (n != (int)pillsRemaining) {
    Serial.printf("[SCALE] %.1f g -> %d เม็ด (เดิม %u)\n", grams, n, pillsRemaining);
    pillsRemaining = (uint16_t)n;
  }
}

void checkLowStock() {
  if (pillsRemaining > LOW_STOCK_PILLS || lowStockWarned) return;
  lowStockWarned = true;
  String msg = "📦 ยาใกล้หมด! เหลือ " + String(pillsRemaining) + " เม็ด กรุณาเติมยา";
  tgSend(msg);
  logEvent("low_stock", msg);
}

void checkBattery() {
#if ENABLE_BATTERY_CHECK
  if (batteryWarned) return;
  int raw = analogRead(BATTERY_ADC_PIN);
  float v = (raw * 3.3f / 1023.0f) * BATTERY_DIVIDER;
  if (v < BATTERY_LOW_VOLT) {
    batteryWarned = true;
    String msg = "🔋 แบตเตอรี่ต่ำ (" + String(v, 2) + " V) กรุณาชาร์จ";
    tgSend(msg);
    logEvent("low_battery", msg);
  }
#endif
}

// ---------------------------------------------------------------- สรุปรายวัน
void dailySummary() {
  String msg = "📊 สรุปรายวัน\n";
  msg += "กินยาตรงเวลา: " + String(takenToday) + " ครั้ง\n";
  msg += "ลืมกินยา: " + String(missedToday) + " ครั้ง\n";
  msg += "เลื่อนเตือน: " + String(snoozeToday) + " ครั้ง\n";
  msg += "ยาเหลือ: " + String(pillsRemaining) + " เม็ด";
  tgSend(msg);
  logEvent("daily_summary", msg);
  summarySent = true;
}

// ---------------------------------------------------------------- ตรวจตาราง / snooze
void rolloverIfNeeded(const DateTime &n) {
  int32_t k = dayKeyOf(n);
  if (k == todayKey) return;
  todayKey = k;
  for (uint8_t i = 0; i < doseCount; i++) { doseDone[i] = false; doseMissed[i] = false; }
  takenToday = 0; missedToday = 0; snoozeToday = 0;
  summarySent = false;
  lowStockWarned = false;
  batteryWarned = false;
  Serial.printf("[DAY] ขึ้นวันใหม่ %04d-%02d-%02d\n", n.year(), n.month(), n.day());
}

void checkSchedule(const DateTime &n) {
  if (!carebeeClockReady()) return;
  uint16_t nowMin = minutesOfDay(n);
  const String date = carebeeDate(n);
  for (uint8_t i = 0; i < doseCount; i++) {
    const auto& channel = CareBee::channel(i + 1);
    if (!channel.received || channel.minuteOfDay < 0 || !(channel.daysMask & (1 << n.dayOfTheWeek()))) continue;
    if (i == snoozeSlot) continue; // Do not restart this dose while Snooze is counting.
    if (doseDone[i] || doseMissed[i] || CareBee::alreadyTaken(i + 1, date.c_str())) continue;
    uint16_t slotMin = (uint16_t)doseSchedule[i].hour * 60 + doseSchedule[i].minute;
    if (nowMin >= slotMin && nowMin < slotMin + DOSE_WINDOW_MIN) {
      startReminder((int8_t)i);
      return;
    }
  }
}

void checkSnooze(const DateTime &n) {
  if (snoozeSlot < 0) return;
  if (n.unixtime() < snoozeUntilSec) return;
  int8_t s = snoozeSlot;
  snoozeSlot = -1;
  startReminder(s);
  if (activeSlot == s) carebeeActiveDate = carebeeSnoozeDate;
}

// ---------------------------------------------------------------- WiFi / เวลา
void connectWifi() {
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.hostname(WIFI_HOSTNAME);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  WiFi.setSleepMode(WIFI_MODEM_SLEEP);
  Serial.println(F("[WiFi] Connecting in background."));
}

uint32_t lastNtpSyncMs = 0;
bool clockSyncedFromNtp = false;

// DS3231 stores local Bangkok time. SNTP starts on the first successful Wi-Fi connection.
void ntpResyncTick() {
  if (!wifiOk) return;
  static bool sntpStarted = false;
  if (!sntpStarted) {
    configTime(0, 0, NTP_SERVER1, NTP_SERVER2);
    sntpStarted = true;
  }
  if (!ntpReady()) return;
  uint32_t nowMs = millis();
  bool due = !clockSyncedFromNtp || nowMs - lastNtpSyncMs >= NTP_RESYNC_MS;
  bool rtcBad = rtcOk && !rtcReady();
  if (!due && !rtcBad) return;

  time_t t = time(nullptr);
  if (rtcOk) {
    DateTime l((uint32_t)t + TZ_OFFSET_SEC);
    rtc.adjust(l);
    Serial.printf("[TIME] resync NTP -> RTC %04d-%02d-%02d %02d:%02d:%02d\n",
                  l.year(), l.month(), l.day(), l.hour(), l.minute(), l.second());
    if (rtcBad) logEvent("time_fixed", "ตั้งเวลา RTC จาก NTP สำเร็จ");
  }
  lastNtpSyncMs = nowMs;
  clockSyncedFromNtp = true;
}

// ---------------------------------------------------------------- setup
void setup() {
  Serial.begin(115200);
  delay(300);
  Serial.println();
  Serial.println(F("===== MedBox boot ====="));

  pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_LED, LOW);
  pinMode(PIN_BUZZER, OUTPUT);
  buzzer(false);          // เคารพ BUZZER_ACTIVE_LOW (LOW-trigger ต้องขับ HIGH)
  if (CAREBEE_USE_BUTTONS) {
    btnBegin(btnTaken);
    btnBegin(btnSnooze);
  }
  irBegin();

  // --- I2C + OLED ---
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  Wire.pins(PIN_I2C_SDA, PIN_I2C_SCL);   // ให้ Wire.begin() ที่ library เรียกเองใช้ขาเดียวกัน
  Wire.setClock(100000);
  // periphBegin=false สำคัญ: อย่าให้ library ไปเรียก Wire.begin() ทับขาที่ตั้งไว้
  oledOk = oled.begin(SSD1306_SWITCHCAPVCC, 0x3C, false, false);
  if (!oledOk) oledOk = oled.begin(SSD1306_SWITCHCAPVCC, 0x3D, false, false);
  if (oledOk) {
    oled.clearDisplay();
    oled.setTextColor(SSD1306_WHITE);
    oled.setCursor(0, 0);
    oled.println(F("MedBox starting..."));
    oled.display();
    Serial.println("[OLED] OK");
  } else {
    Serial.println("[OLED] ไม่พบ (0x3C/0x3D) - ทำงานต่อโดยไม่มีจอ");
  }

  // --- RTC ---
  rtcOk = rtc.begin(&Wire);
  if (rtcOk) {
    if (rtc.lostPower()) Serial.println("[RTC] lostPower -> ต้อง sync NTP");
    DateTime n = rtc.now();
    Serial.printf("[RTC] OK %04d-%02d-%02d %02d:%02d:%02d\n",
                  n.year(), n.month(), n.day(), n.hour(), n.minute(), n.second());
  } else {
    Serial.println("[RTC] ไม่พบ - ใช้เวลา NTP อย่างเดียว");
  }

  // --- Load cell ---
  scale.begin(PIN_HX711_DT, PIN_HX711_SCK);
  uint32_t t0 = millis();
  while (!scale.is_ready() && millis() - t0 < 2000) delay(20);
  scaleOk = scale.is_ready();
  if (scaleOk) {
    if (LOADCELL_CALIBRATION != 0.0f) {
      scale.set_scale(LOADCELL_CALIBRATION);
      Serial.printf("[HX711] OK (cal=%.2f)\n", LOADCELL_CALIBRATION);
    } else {
      Serial.println("[HX711] OK แต่ยังไม่คาลิเบรต -> ใช้จำนวนยาคงที่");
    }
  } else {
    Serial.println("[HX711] ไม่พร้อม - ข้ามการชั่งน้ำหนัก");
  }

  // --- เครือข่าย + เวลา ---
  connectWifi();

  // Restore enabled compartments before trying MQTT.
  applyDefaultSchedule();
  // The website stops server reminders after all six RTC acknowledgements.
  // Only acknowledge when this box has a working hardware clock for offline use.
  CareBee::begin(carebeeScheduleChanged, rtcReady);
  for (uint8_t compartment = 1; compartment <= doseCount; compartment++) carebeeScheduleChanged(compartment);
  printSchedule();
#if CAREBEE_ENABLE_SERIAL_TEST
  Serial.println(F("[SERIAL] clock | schedule | request | ping | sensor 6 | take 6 | snooze | mute"));
#endif

  // --- เริ่มต้นสถานะวันนี้ ---
  DateTime n = nowTime();
  rolloverIfNeeded(n);
  updatePillsFromScale();
  updateDisplay();

  String bootMsg = "🔌 กล่องยาเริ่มทำงานแล้ว (MedBox online)";
  bootMsg += "\nเวลา " + two(n.hour()) + ":" + two(n.minute()) + " " + String(n.day()) + "/" + String(n.month());
  if (!carebeeClockReady()) bootMsg += "\n⚠️ เวลายังไม่ถูก (รอ NTP)";
  if (WiFi.status() == WL_CONNECTED) {
    wifiOk = true;
    tgSend(bootMsg);
  }
  logEvent("boot", "อุปกรณ์เริ่มทำงาน");
  Serial.printf("[BOOT] reset reason: %s\n", ESP.getResetReason().c_str());
  Serial.printf("[READY] heap=%u B\n", ESP.getFreeHeap());
}

// ---------------------------------------------------------------- loop
void loop() {
#if CAREBEE_ENABLE_SERIAL_TEST
  carebeeSerialTick();
#endif
  if (WiFi.status() != WL_CONNECTED && millis() - carebeeLastWifi >= 15000) {
    carebeeLastWifi = millis();
    WiFi.reconnect();
  }
  static bool loopStartedOnce = false;
  if (!loopStartedOnce) { loopStartedOnce = true; Serial.println("[LOOP] loop() started"); }

  // IR sensor: ตรวจถี่ ๆ เพื่อปิดเสียงให้ทันทีเมื่อมีคนมา
  handleIr();

  // ปุ่ม: ตรวจถี่ ๆ เพื่อไม่ให้พลาดการกดสั้น
  if (btnEdge(btnTaken))  handleTakenPressed();
  if (btnEdge(btnSnooze)) handleSnoozePressed();

  // LED กระพริบตอนกำลังเตือน (ยกเว้นตอนปิดเสียงด้วย IR)
  if ((state == ST_REMIND || state == ST_WAIT_RESPONSE) && !irSilenced) {
    digitalWrite(PIN_LED, ((millis() / LED_BLINK_MS) % 2) ? HIGH : LOW);
  }

  uint32_t nowMs = millis();
  if (nowMs - lastCheckMs >= 1000) {
    lastCheckMs = nowMs;
    wifiOk = WiFi.status() == WL_CONNECTED;
    ntpResyncTick();
    DateTime n = nowTime();
    if (carebeeClockReady()) rolloverIfNeeded(n);
    updatePillsFromScale();

    switch (state) {
      case ST_IDLE:
        if (snoozeSlot >= 0) checkSnooze(n);
        if (state == ST_IDLE) checkSchedule(n);
        if (state == ST_IDLE) {
          checkBattery();
          checkLowStock();
          if (n.hour() == DAILY_SUMMARY_HOUR && n.minute() == 0 && !summarySent) dailySummary();
          if (wifiOk) tgPoll();
        }
        break;
      case ST_REMIND:        handleRemind();      break;
      case ST_WAIT_RESPONSE: handleResponse();    break;
      case ST_VERIFY_FACE:   handleFaceVerify();  break;
    }
  }

  if (nowMs - lastOledMs >= 1000) {
    lastOledMs = nowMs;
    updateDisplay();
  }

  CareBee::tick();
  delay(5);
}

// ================================================================ CareBee hooks
bool carebeeClockReady() {
  return rtcReady() || ntpReady();
}

String carebeeDate(const DateTime& date) {
  char text[11];
  snprintf(text, sizeof(text), "%04u-%02u-%02u", date.year(), date.month(), date.day());
  return String(text);
}

void carebeeScheduleChanged(uint8_t compartment) {
  if (compartment < 1 || compartment > doseCount) return;
  const auto& channel = CareBee::channel(compartment);
  size_t index = compartment - 1;
  // Stable physical index: slot 0 is compartment 1, ... slot 5 is compartment 6.
  if (channel.minuteOfDay >= 0) {
    doseSchedule[index].hour = channel.minuteOfDay / 60;
    doseSchedule[index].minute = channel.minuteOfDay % 60;
  }
  if ((!channel.received || channel.minuteOfDay < 0 || !channel.daysMask) && activeSlot == (int)index) {
    buzzer(false);
    digitalWrite(PIN_LED, LOW);
    activeSlot = -1;
    state = ST_IDLE;
    irSilenced = false;
    irSilencedMs = 0;
    irRearmMs = 0;
  }
  if ((!channel.received || channel.minuteOfDay < 0 || !channel.daysMask) && snoozeSlot == (int)index)
    snoozeSlot = -1;

}

void carebeeSerialTick() {
  static bool lineTooLong = false;
  while (Serial.available()) {
    char c = Serial.read();
    if (c != '\n' && c != '\r') {
      if (carebeeSerialLine.length() < 96) carebeeSerialLine += c;
      else lineTooLong = true;
      continue;
    }
    if (lineTooLong) {
      carebeeSerialLine = "";
      lineTooLong = false;
      continue;
    }
    carebeeSerialLine.trim();
    if (!carebeeSerialLine.length()) continue;
    String command = carebeeSerialLine;
    carebeeSerialLine = "";
    int compartment = 0;
    char extra;
    if (command == "clock") {
      DateTime n = nowTime();
      Serial.printf("[RTC] %04u-%02u-%02u %02u:%02u:%02u ready=%s\n", n.year(), n.month(), n.day(),
                    n.hour(), n.minute(), n.second(), carebeeClockReady() ? "yes" : "no");
    } else if (command == "schedule") printSchedule();
    else if (command == "request") CareBee::requestSchedule();
    else if (command == "ping") CareBee::ping();
    else if (command == "snooze") handleSnoozePressed();
    else if (command == "mute") irSilenceAlarm();
    else if (sscanf(command.c_str(), "sensor %d %c", &compartment, &extra) == 1 && compartment >= 1 && compartment <= 6)
      CareBee::report(compartment, NAN, false, nullptr);
    else if (sscanf(command.c_str(), "take %d %c", &compartment, &extra) == 1 && compartment >= 1 && compartment <= 6) {
      if (activeSlot == compartment - 1) handleTakenPressed();
      else Serial.println(F("[TAKE] Wait until that compartment is reminding. No intake sent."));
    } else Serial.println(F("Commands: clock | schedule | request | ping | sensor 6 | take 6 | snooze | mute"));
  }
}

// MQTT transport added to this original sketch (no extra project .cpp/.h files).

namespace {
WiFiClient network;
PubSubClient mqtt(network);
String sensorTopic, scheduleTopic;
CareBeeChannel channels[6];
CareBee::ScheduleHandler scheduleHandler = nullptr;
CareBee::ClockReady clockReadyHandler = nullptr;
bool storageReady = false, configValid = false;
uint32_t lastConnect = 0, lastRequest = 0, lastRetry = 0;
bool attempted = false;
const char* cachePath = "/carebee-channels.json";
const char* tempPath = "/carebee-channels.tmp";
const char* intakePath = "/carebee-intake.json";
const char* intakeTempPath = "/carebee-intake.tmp";
bool intakeReady = false;
uint8_t scheduleAcks = 0;
size_t nextRetry = 0;

// Save the queue together with the last completed date for each compartment.
struct Pending {
  uint8_t compartment = 0;
  float grams = NAN;
  char date[11] = {};
};
Pending pending[12];
constexpr size_t pendingCount = sizeof(pending) / sizeof(pending[0]);
char completedDate[6][11] = {};

bool validConfig() {
  if (strlen(CAREBEE_DEVICE_ID) != 36 || strlen(CAREBEE_DEVICE_KEY) != 53 ||
      strncmp(CAREBEE_DEVICE_KEY, "smrb_", 5) != 0) return false;
  for (size_t i = 5; i < 53; i++) {
    char c = CAREBEE_DEVICE_KEY[i];
    if (!((c >= '0' && c <= '9') || (c >= 'a' && c <= 'f'))) return false;
  }
  for (size_t i = 0; i < 36; i++) {
    char c = CAREBEE_DEVICE_ID[i];
    if (i == 8 || i == 13 || i == 18 || i == 23) {
      if (c != '-') return false;
    } else if (!isxdigit(static_cast<unsigned char>(c))) return false;
  }
  return true;
}

bool publish(JsonDocument& doc) {
  if (!mqtt.connected() || doc.overflowed()) return false;
  String text;
  serializeJson(doc, text);
  return mqtt.publish(sensorTopic.c_str(), text.c_str(), false);
}

bool sameChannel(const CareBeeChannel& a, const CareBeeChannel& b) {
  return a.minuteOfDay == b.minuteOfDay && a.daysMask == b.daysMask && a.received == b.received;
}

bool decodeChannel(JsonVariantConst input, CareBeeChannel& result) {
  if (!input["time"].isNull()) {
    if (!input["time"].is<const char*>()) return false;
    const char* t = input["time"].as<const char*>();
    if (strlen(t) != 5 || t[2] != ':' || !isdigit(static_cast<unsigned char>(t[0])) ||
        !isdigit(static_cast<unsigned char>(t[1])) || !isdigit(static_cast<unsigned char>(t[3])) ||
        !isdigit(static_cast<unsigned char>(t[4]))) return false;
    int hour = (t[0] - '0') * 10 + t[1] - '0';
    int minute = (t[3] - '0') * 10 + t[4] - '0';
    if (hour > 23 || minute > 59) return false;
    result.minuteOfDay = hour * 60 + minute;
  } else {
    // A missing time field is invalid; an explicit null disables a channel.
    if (!input["time"].is<JsonVariantConst>()) return false;
    result.minuteOfDay = -1;
  }
  result.daysMask = 0x7f;
  if (input["days"].is<JsonVariantConst>()) {
    if (!input["days"].is<JsonArrayConst>()) return false;
    result.daysMask = 0;
    for (JsonVariantConst day : input["days"].as<JsonArrayConst>()) {
      if (!day.is<int>() || day.as<int>() < 0 || day.as<int>() > 6) return false;
      result.daysMask |= 1 << day.as<int>();
    }
  }
  result.received = true;
  return true;
}

void encodeChannel(JsonObject item, const CareBeeChannel& channel) {
  if (channel.minuteOfDay < 0) item["time"] = nullptr;
  else {
    char text[6];
    snprintf(text, sizeof(text), "%02d:%02d", channel.minuteOfDay / 60, channel.minuteOfDay % 60);
    item["time"] = text;
  }
  JsonArray days = item["days"].to<JsonArray>();
  for (int day = 0; day < 7; day++) if (channel.daysMask & (1 << day)) days.add(day);
}

void loadChannels() {
  File file = LittleFS.open(cachePath, "r");
  if (!file) return;
  JsonDocument doc;
  bool ok = !deserializeJson(doc, file);
  file.close();
  if (!ok || String(doc["deviceId"] | "") != CAREBEE_DEVICE_ID) return;
  JsonArrayConst items = doc["channels"].as<JsonArrayConst>();
  if (items.size() != 6) return;
  CareBeeChannel restored[6];
  for (size_t i = 0; i < 6; i++) {
    if (items[i]["received"] == true && !decodeChannel(items[i], restored[i])) return;
  }
  for (size_t i = 0; i < 6; i++) channels[i] = restored[i];
  Serial.println(F("[CACHE] Restored CareBee channels from flash."));
}

bool saveJson(JsonDocument& doc, const char* temporary, const char* destination) {
  if (doc.overflowed()) return false;
  File file = LittleFS.open(temporary, "w");
  if (!file) return false;
  size_t written = serializeJson(doc, file);
  file.close();
  if (written != measureJson(doc)) return false;
  // Verify the saved data before replacing the last good file.
  File check = LittleFS.open(temporary, "r");
  JsonDocument verify;
  bool valid = check && !deserializeJson(verify, check);
  check.close();
  if (!valid) return false;
  String expected, actual;
  serializeJson(doc, expected);
  serializeJson(verify, actual);
  return expected == actual && LittleFS.rename(temporary, destination);
}

bool saveChannels() {
  if (!storageReady) return false;
  JsonDocument doc;
  doc["deviceId"] = CAREBEE_DEVICE_ID;
  JsonArray items = doc["channels"].to<JsonArray>();
  for (const auto& channel : channels) {
    JsonObject item = items.add<JsonObject>();
    item["received"] = channel.received;
    encodeChannel(item, channel);
  }
  return saveJson(doc, tempPath, cachePath);
}

bool validDate(const char* date) {
  if (!date || strlen(date) != 10 || date[4] != '-' || date[7] != '-') return false;
  for (size_t i = 0; i < 10; i++) {
    if (i != 4 && i != 7 && !isdigit(static_cast<unsigned char>(date[i]))) return false;
  }
  const int year = atoi(date);
  const int month = atoi(date + 5);
  const int day = atoi(date + 8);
  if (year < RTC_MIN_YEAR || year > 2099 || month < 1 || month > 12 || day < 1 || day > 31)
    return false;
  return DateTime(year, month, day).isValid();
}

bool loadIntakes() {
  if (!LittleFS.exists(intakePath)) return true;
  File file = LittleFS.open(intakePath, "r");
  if (!file) return false;
  JsonDocument doc;
  bool parsed = !deserializeJson(doc, file);
  file.close();
  if (!parsed) return false;
  if (strcmp(doc["deviceId"] | "", CAREBEE_DEVICE_ID) != 0) return true;

  JsonArrayConst completed = doc["completed"].as<JsonArrayConst>();
  JsonArrayConst queued = doc["pending"].as<JsonArrayConst>();
  if (completed.size() != 6 || queued.isNull() || queued.size() > pendingCount) return false;
  char restoredDates[6][11] = {};
  Pending restoredQueue[pendingCount];
  for (size_t i = 0; i < 6; i++) {
    const char* date = completed[i].as<const char*>();
    if (!date || (*date && !validDate(date))) return false;
    if (*date) memcpy(restoredDates[i], date, 11);
  }
  size_t index = 0;
  for (JsonObjectConst entry : queued) {
    int compartment = entry["compartment"] | 0;
    const char* date = entry["scheduledDate"] | "";
    if (compartment < 1 || compartment > 6 || !validDate(date)) return false;
    auto& item = restoredQueue[index++];
    item.compartment = compartment;
    item.grams = entry["weight"] | NAN;
    memcpy(item.date, date, 11);
  }
  if (index != queued.size()) return false;
  memcpy(completedDate, restoredDates, sizeof(completedDate));
  memcpy(pending, restoredQueue, sizeof(pending));
  Serial.printf("[QUEUE] Restored %u pending intake(s) from flash.\n", (unsigned)index);
  return true;
}

bool saveIntakes() {
  if (!intakeReady) return false;
  JsonDocument doc;
  doc["deviceId"] = CAREBEE_DEVICE_ID;
  JsonArray completed = doc["completed"].to<JsonArray>();
  for (const auto& date : completedDate) completed.add(static_cast<const char*>(date));
  JsonArray queued = doc["pending"].to<JsonArray>();
  for (const auto& item : pending) {
    if (!item.compartment) continue;
    JsonObject entry = queued.add<JsonObject>();
    entry["compartment"] = item.compartment;
    entry["scheduledDate"] = static_cast<const char*>(item.date);
    if (isfinite(item.grams)) entry["weight"] = item.grams;
    else entry["weight"] = nullptr;
  }
  return saveJson(doc, intakeTempPath, intakePath);
}

void acknowledgeSchedule(uint8_t compartment) {
  JsonDocument ack;
  encodeChannel(ack.to<JsonObject>(), channels[compartment - 1]);
  ack["type"] = "schedule_ack";
  ack["deviceId"] = CAREBEE_DEVICE_ID;
  ack["device_key"] = CAREBEE_DEVICE_KEY;
  ack["compartment"] = compartment;
  if (publish(ack)) {
    scheduleAcks &= ~(1U << (compartment - 1));
    Serial.printf("[SCHEDULE_ACK] compartment=%u, flash saved and DS3231 ready\n", compartment);
  }
}

bool publishReport(uint8_t compartment, float grams, bool taken, const char* date) {
  JsonDocument doc;
  doc["deviceId"] = CAREBEE_DEVICE_ID;
  doc["device_key"] = CAREBEE_DEVICE_KEY;
  doc["compartment"] = compartment;
  if (isfinite(grams)) doc["weight"] = grams;
  else doc["weight"] = nullptr;
  doc["isTake"] = taken;
  if (date && strlen(date) == 10) doc["scheduledDate"] = date;
  bool sent = publish(doc);
  Serial.printf("[TX] compartment=%u isTake=%s sent=%s (wait for web confirmation)\n",
                compartment, taken ? "true" : "false", sent ? "yes" : "no");
  return sent;
}

void receive(char* topic, byte* payload, unsigned int length) {
  if (scheduleTopic != topic || length > 1024) return;
  JsonDocument doc;
  if (deserializeJson(doc, payload, length)) {
    Serial.println(F("[RX] Non-JSON message on schedule topic."));
    return;
  }
  const char* type = doc["type"] | "";
  if (strcmp(type, "intake_ack") == 0) {
    int compartment = doc["compartment"] | 0;
    const char* date = doc["scheduledDate"] | "";
    if (compartment < 1 || compartment > 6 || !validDate(date)) return;
    for (auto& item : pending) {
      if (item.compartment == compartment && strcmp(item.date, date) == 0) {
        item.compartment = 0;
        if (!saveIntakes()) {
          item.compartment = compartment;
          Serial.println(F("[QUEUE] Could not save ACK locally; report will be retried."));
          return;
        }
        Serial.printf("[INTAKE_ACK] compartment=%d date=%s: CareBee saved the intake.\n", compartment, date);
        return;
      }
    }
    Serial.println(F("[RX] intake_ack has no matching pending report."));
    return;
  }
  if (type[0] != '\0' && strcmp(type, "schedule") != 0) {
    Serial.printf("[RX] Message type: %s\n", type);
    return;
  }
  if (!doc["compartment"].is<int>()) return;
  int compartment = doc["compartment"].as<int>();
  if (compartment < 1 || compartment > 6) return;
  CareBeeChannel next;
  if (!decodeChannel(doc.as<JsonVariantConst>(), next)) {
    Serial.println(F("[RX] Invalid compartment/time/days."));
    return;
  }
  CareBeeChannel previous = channels[compartment - 1];
  channels[compartment - 1] = next;
  if (!sameChannel(previous, next) && !saveChannels()) {
    channels[compartment - 1] = previous;
    Serial.println(F("[CACHE] Save failed; keeping previous schedule, no ACK."));
    return;
  }
  Serial.printf("[SCHEDULE] compartment=%d minute=%d daysMask=%u (%s)\n", compartment,
                next.minuteOfDay, next.daysMask, next.minuteOfDay < 0 ? "disabled" : "enabled");
  if (scheduleHandler) scheduleHandler(compartment);
  scheduleAcks |= 1U << (compartment - 1);
}
}

void CareBee::begin(ScheduleHandler handler, ClockReady clockReady) {
  scheduleHandler = handler;
  clockReadyHandler = clockReady;
  sensorTopic = String(CAREBEE_SENSOR_PREFIX) + "/" + CAREBEE_DEVICE_ID;
  scheduleTopic = String(CAREBEE_SCHEDULE_PREFIX) + "/" + CAREBEE_DEVICE_ID;
  configValid = validConfig();
  if (!configValid) Serial.println(F("[CONFIG] Set full UUID + smrb_ device key in config.h."));
  // Fresh LittleFS partitions are formatted by the core on first mount.
  storageReady = LittleFS.begin();
  if (storageReady) {
    loadChannels();
    intakeReady = loadIntakes();
  } else {
    Serial.println(F("[CACHE] LittleFS unavailable; schedules will not be acknowledged."));
  }
  if (!intakeReady) Serial.println(F("[QUEUE] Intake storage unavailable."));
  mqtt.setServer(CAREBEE_MQTT_HOST, CAREBEE_MQTT_PORT);
  mqtt.setCallback(receive);
  if (!mqtt.setBufferSize(1024)) Serial.println(F("[MQTT] Could not allocate 1024-byte receive buffer."));
  mqtt.setKeepAlive(30);
  mqtt.setSocketTimeout(2);
  Serial.printf("[MQTT] TCP %s:%u\n[SUB] %s\n[PUB] %s\n", CAREBEE_MQTT_HOST,
                CAREBEE_MQTT_PORT, scheduleTopic.c_str(), sensorTopic.c_str());
}

void CareBee::tick() {
  if (!configValid || WiFi.status() != WL_CONNECTED) return;
  uint32_t now = millis();
  if (!mqtt.connected()) {
    if (attempted && now - lastConnect < 5000) return;
    lastConnect = now;
    attempted = true;
    String clientId = "carebee8266-" + String(ESP.getChipId(), HEX);
    if (!mqtt.connect(clientId.c_str())) {
      Serial.printf("[MQTT] Connect failed: %d; retry in 5 seconds.\n", mqtt.state());
      return;
    }
    if (!mqtt.subscribe(scheduleTopic.c_str(), 1)) { mqtt.disconnect(); return; }
    Serial.println(F("[MQTT] Connected; subscription requested."));
    ping();
    requestSchedule();
  }
  if (!mqtt.loop()) return;
  if (scheduleAcks && clockReadyHandler && clockReadyHandler()) {
    for (uint8_t compartment = 1; compartment <= 6; compartment++) {
      if (scheduleAcks & (1U << (compartment - 1))) acknowledgeSchedule(compartment);
    }
  }
  if (now - lastRequest >= 30000) requestSchedule();
  if (now - lastRetry < 5000) return;
  lastRetry = now;
  for (size_t checked = 0; checked < pendingCount; checked++) {
    const auto& item = pending[nextRetry];
    nextRetry = (nextRetry + 1) % pendingCount;
    if (!item.compartment) continue;
    publishReport(item.compartment, item.grams, true, item.date);
    break;
  }
}

bool CareBee::connected() { return mqtt.connected(); }
const CareBeeChannel& CareBee::channel(uint8_t compartment) {
  static const CareBeeChannel invalid;
  return compartment >= 1 && compartment <= 6 ? channels[compartment - 1] : invalid;
}

bool CareBee::alreadyTaken(uint8_t compartment, const char* date) {
  if (compartment < 1 || compartment > 6 || !date) return false;
  if (strcmp(completedDate[compartment - 1], date) == 0) return true;
  for (const auto& item : pending) {
    if (item.compartment == compartment && strcmp(item.date, date) == 0) return true;
  }
  return false;
}

bool CareBee::report(uint8_t compartment, float grams, bool taken, const char* date) {
  if (compartment < 1 || compartment > 6) return false;
  if (!taken) return publishReport(compartment, grams, false, date);
  if (!intakeReady || !validDate(date)) return false;
  if (alreadyTaken(compartment, date)) return true;
  for (auto& item : pending) {
    if (item.compartment) continue;
    char* completed = completedDate[compartment - 1];
    char previousDate[11];
    memcpy(previousDate, completed, 11);
    if (strcmp(date, completed) > 0) memcpy(completed, date, 11);
    item.compartment = compartment;
    item.grams = grams;
    memcpy(item.date, date, 11);
    if (!saveIntakes()) {
      item.compartment = 0;
      memcpy(completed, previousDate, 11);
      return false;
    }
    Serial.printf("[QUEUE] Intake saved locally: compartment=%u date=%s\n", compartment, date);
    if (mqtt.connected()) publishReport(compartment, grams, true, date);
    return true;
  }
  Serial.println(F("[QUEUE] Full. Wait for intake_ack before confirming more doses."));
  return false;
}

void CareBee::requestSchedule() {
  JsonDocument doc;
  doc["type"] = "schedule_request";
  doc["deviceId"] = CAREBEE_DEVICE_ID;
  if (publish(doc)) Serial.println(F("[TX] schedule_request"));
  lastRequest = millis();
}

void CareBee::ping() {
  JsonDocument doc;
  doc["type"] = "carebee_test";
  doc["message"] = "Hello from CareBee ESP8266 board";
  if (publish(doc)) Serial.println(F("[TX] carebee_test (transport test only)"));
}
