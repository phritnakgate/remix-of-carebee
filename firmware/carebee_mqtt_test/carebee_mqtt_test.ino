#include <WiFi.h>
#include <PubSubClient.h>

WiFiClient espClient;
PubSubClient client(espClient);

// ใส่ WiFi และรหัสอุปกรณ์เต็มจากหน้าเว็บ ไม่ใช่ UUID หรือรหัสที่ตัดด้วย ...
const char* ssid = "YOUR_WIFI_NAME";
const char* password = "YOUR_WIFI_PASSWORD";
const char* mqtt_broker = "broker.emqx.io";
const int mqtt_port = 1883;
const char* deviceId = "41db3b65-7be6-481d-8eb9-be9e28dd7621";
const char* deviceKey = "PASTE_FULL_DEVICE_KEY_HERE";

String sensorTopic;
String scheduleTopic;
bool firstReportSent = false;
unsigned long lastMqttAttempt = 0;

void setup_wifi() {
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(ssid, password);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print('.');
  }
  Serial.print("\nWiFi connected: ");
  Serial.println(WiFi.localIP());
}

void callback(char* topic, byte* payload, unsigned int length) {
  Serial.print("Received topic: ");
  Serial.println(topic);
  Serial.print("Message: ");
  for (unsigned int i = 0; i < length; i++) Serial.print((char)payload[i]);
  Serial.println("\n-----------------------");
  // intake_ack คือเว็บบันทึกการกินยาแล้ว
  // โค้ดทดสอบนี้เพียงพิมพ์ตารางที่รับมา ยังไม่ได้ตั้ง RTC หรือส่ง schedule_ack
}

void publishTaken() {
  if (!client.connected()) {
    Serial.println("Not connected. Press t after MQTT connects.");
    return;
  }
  if (strlen(deviceKey) != 53 || strncmp(deviceKey, "smrb_", 5) != 0) {
    Serial.println("Paste the FULL smrb_ device key from the website first.");
    return;
  }
  String payload = String("{\"device_key\":\"") + deviceKey +
    "\",\"deviceId\":\"" + deviceId +
    "\",\"compartment\":6,\"weight\":null,\"isTake\":true}";
  bool sent = client.publish(sensorTopic.c_str(), payload.c_str(), false);
  Serial.print("Publish topic: ");
  Serial.println(sensorTopic);
  // ไม่พิมพ์รหัสอุปกรณ์ลง Serial log
  Serial.println(sent ? "Sent to MQTT transport; wait for intake_ack from website."
                      : "Publish failed. Press t to retry.");
  firstReportSent = sent;
}

void reconnect() {
  lastMqttAttempt = millis();
  String clientId = "carebee-test-" + WiFi.macAddress();
  Serial.println("Connecting to MQTT...");
  if (!client.connect(clientId.c_str())) {
    Serial.print("MQTT failed, state = ");
    Serial.println(client.state());
    return;
  }
  Serial.println("MQTT connected");
  if (!client.subscribe(scheduleTopic.c_str(), 1)) {
    Serial.println("Subscribe failed; reconnecting...");
    client.disconnect();
    return;
  }
  Serial.print("Subscribed: ");
  Serial.println(scheduleTopic);
  if (!firstReportSent) publishTaken();
}

void setup() {
  Serial.begin(115200);
  sensorTopic = String("medicine/sensor/") + deviceId;
  scheduleTopic = String("medicine/schedule/") + deviceId;
  setup_wifi();
  client.setServer(mqtt_broker, mqtt_port);
  client.setCallback(callback);
  client.setBufferSize(1024);
  reconnect();
  Serial.println("Press t in Serial Monitor to publish compartment 6 again.");
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    if (!client.connected() && millis() - lastMqttAttempt >= 5000) reconnect();
    client.loop();
  }
  if (Serial.available() && Serial.read() == 't') publishTaken();
  delay(10);
}
