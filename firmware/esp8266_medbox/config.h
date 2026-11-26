#pragma once
#include <stdint.h>

// Use the actual values from the original config.h where available.
#define WIFI_SSID "YOUR_WIFI_NAME"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"
#define WIFI_HOSTNAME "medbox"
#define CAREBEE_DEVICE_ID "YOUR_DEVICE_ID"
#define CAREBEE_DEVICE_KEY "YOUR_DEVICE_KEY"
#define CAREBEE_MQTT_HOST "broker.emqx.io"  // Public, plaintext demo broker.
#define CAREBEE_MQTT_PORT 1883
#define CAREBEE_SENSOR_PREFIX "medicine/sensor"
#define CAREBEE_SCHEDULE_PREFIX "medicine/schedule"

// Confirm the wiring and buzzer polarity before uploading.
// GPIO numbers for NodeMCU 1.0.
#define PIN_BUZZER 15      // D8, inferred from the original sketch's log
#define PIN_LED 2          // D4, sample
#define PIN_I2C_SDA 4      // D2, sample
#define PIN_I2C_SCL 5      // D1, sample
#define PIN_HX711_DT 12    // D6, sample
#define PIN_HX711_SCK 13   // D7, sample
#define PIN_BTN_TAKEN 14   // D5, sample, switch to GND
#define PIN_BTN_SNOOZE 0   // D3, sample, switch to GND, do not hold at boot
#define PIN_IR_SENSOR A0
#define BUZZER_ACTIVE_LOW 0
#define BUZZER_DEBUG_LOG 0
#define BUZZER_FREQ_HZ 2200

#define CAREBEE_USE_BUTTONS 0  // Enable after checking physical pins.
#define CAREBEE_ENABLE_SERIAL_TEST 1  // Disable Serial commands for handoff.
#define IR_ENABLED 0
#define IR_USE_ANALOG 1
#define IR_ACTIVE_LOW 1
#define IR_ANALOG_AUTO_BASELINE 1
#define IR_ANALOG_DELTA 120
#define IR_ANALOG_EXIT_PCT 65
#define IR_ANALOG_THRESHOLD 450
#define IR_ANALOG_HYST 30
#define IR_CONFIRM_MS 100UL
#define IR_STUCK_MS 60000UL
#define IR_SILENCE_LATCH 0
#define IR_LATCH_MAX_MS 120000UL
#define IR_REARM_MS 5000UL
#define IR_DEBUG_LOG 0

#define RTC_MIN_YEAR 2024
#define TZ_OFFSET_SEC (7UL * 3600)
#define NTP_SERVER1 "pool.ntp.org"
#define NTP_SERVER2 "time.google.com"
#define NTP_RESYNC_MS 3600000UL

#define DOSE_MAX 6
#define LABEL_LEN 24
struct DoseSlot {
  uint8_t hour;
  uint8_t minute;
  char label[LABEL_LEN];
};

#define DOSE_WINDOW_MIN 15
#define REPEAT_REMIND_MS 180000UL
#define RESPONSE_TIMEOUT_MS 900000UL
#define SNOOZE_MINUTES 15
#define LED_BLINK_MS 350UL
#define DAILY_SUMMARY_HOUR 21

#define FACE_VERIFY_ENABLED 0
#define MAX_FACE_TRIES 3
#define CAM_NODE_URL ""
#define TELEGRAM_BOT_TOKEN ""
#define TELEGRAM_CHAT_ID ""
#define BACKEND_URL ""
#define DEMO_MODE 0
#define LOADCELL_CALIBRATION 0.0f
#define PILLS_INITIAL 0
#define PILL_WEIGHT_G 1.0f
#define EMPTY_TRAY_WEIGHT_G 0.0f
#define LOW_STOCK_PILLS 3

#define ENABLE_BATTERY_CHECK 0
#define BATTERY_ADC_PIN A0
#define BATTERY_DIVIDER 2.0f
#define BATTERY_LOW_VOLT 3.5f
