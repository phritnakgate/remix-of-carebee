# Remix of Carebee

Implement exactly the screenshot and nothing else

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/c22085cd-2af1-46f1-89f5-8acb8b92c792).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```

## ESP32 MQTT

[คู่มือใช้งาน CareBee ภาษาไทย](docs/carebee-user-guide.th.md)

1. Sign in and open **Reminder box → ESP32 setup · MQTT** on a real box.
2. Choose the preset for the broker used by the ESP32 or MQTTX Desktop. Use `broker.emqx.io` with WSS `8084` for EMQX Public, or `broker.hivemq.com` with WSS `8884` for HiveMQ Public. Both use `/mqtt` for WSS and TCP `1883` for an ESP32 or desktop client.
3. Subscribe the ESP32 to `medicine/schedule/<box-id>` and publish its reports on `medicine/sensor/<box-id>`. Use the complete topics shown in the UI if you change their prefixes.
4. Click **Connect** and leave the CareBee tab open and the computer awake. Navigating inside CareBee keeps the MQTT session running. If you click **Disconnect** or the connection drops, use **Connect** to open it again. If you leave the app while still connected, CareBee can resume the connection the next time you open it in the same browser profile.

The browser checks for reminders every five seconds and when the tab regains focus or visibility. CareBee uses the owner's profile timezone, with `Asia/Bangkok` as the fallback. It publishes active, unconfirmed doses with reminders enabled during their scheduled minute. A suspended tab or sleeping computer can miss its send window. Confirmations continue to update the same Supabase dose log.

The default JSON includes the scheduled time, compartment, food instruction, `schedule_id`, `date`, and a stable `notification_id` the ESP32 can use to ignore duplicate deliveries. A custom payload is sent verbatim. The ESP32 publishes non-retained messages using the device key of that box. These examples show a sensor report and a dose confirmation. For a confirmation, copy `schedule_id` and `date` from the default reminder or provide those values in firmware.

```json
{"device_key":"smrb_…","status":{"led":"on","compartments":[{"number":1,"open":false}]}}
```

```json
{"device_key":"smrb_…","schedule_id":"<schedule UUID>","scheduled_date":"YYYY-MM-DD"}
```

Use a disposable test box and dummy medicines with HiveMQ public. Clients on public brokers can read and publish to shared topics. Use a private broker for real device keys and medication data.

The published app handles authentication and database access. The MQTT socket and timer run in the signed-in browser session.
