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

## ESP32 MQTT bridge

Open a real box in **Reminder box → ESP32 setup · MQTT**. Enter the broker hostname, port settings and transport. The bridge subscribes to `<sensor-prefix>/<box-id>` and publishes to `<reminder-prefix>/<box-id>`. The box ID appears when registering the box and in both topic previews. The separate device key authenticates sensor reports. Rotating the key keeps the same topics.

The bridge uses the box owner's profile timezone, with `Asia/Bangkok` as a fallback. It publishes during the scheduled minute for active, unconfirmed doses whose reminders are enabled. For example, a 16:00 before-meal dose publishes on `medicine/schedule/<box-id>` with `time`, `food_instruction`, `compartment`, `schedule_id`, and `date` in the default JSON. Choose which medicines belong to each box if the owner uses multiple boxes. A custom JSON or plain-text payload is sent verbatim for each matching dose.

The ESP32 publishes non-retained messages. These examples show a sensor report and a confirmation. Copy `schedule_id` and `date` from the default reminder into the confirmation. With a custom reminder payload, the firmware needs another way to know those values.

```json
{"device_key":"smrb_…","status":{"led":"on","wifi_rssi":-62,"compartments":[{"number":1,"open":false,"has_pills":true}]}}
```

```json
{"device_key":"smrb_…","schedule_id":"<schedule UUID>","scheduled_date":"YYYY-MM-DD"}
```

The bridge publishes with QoS 1 and records broker acknowledgements in SQLite. Firmware can use the default JSON's `notification_id` to ignore duplicate deliveries. If the bridge or broker is unavailable for the entire scheduled minute, that reminder expires. The app still derives dose status from the schedule and confirmations.

### Run locally from WebStorm

Use Node.js 22.18+ and run `bun install --frozen-lockfile`. In the ignored `.env.local` file, set these variables using a locally generated random token and the server-side Supabase credential from the project owner. Keep the service-role key and token out of `VITE_*` variables.

| Variable | Local value |
| --- | --- |
| `MQTT_APP_URL` | `http://127.0.0.1:5173` |
| `MQTT_BRIDGE_URL` | `http://127.0.0.1:8789` |
| `MQTT_BRIDGE_TOKEN` | The shared token for the app and bridge |
| `SUPABASE_SERVICE_ROLE_KEY` | The connected project's server-side key |
| `MQTT_PRIVATE_BROKERS` | Optional comma-separated exact hostnames or IPv4 addresses for trusted LAN/test brokers |

Use two terminals.

```sh
node --env-file=.env --env-file-if-exists=.env.local node_modules/vite/bin/vite.js dev --host 127.0.0.1 --port 5173 --strictPort
```

```sh
npm run mqtt:bridge
```

### Connect the published Lovable app

1. Run `npm run mqtt:bridge` on an always-on Node.js host. Use one bridge process with a persistent volume at `MQTT_BRIDGE_DB`, such as `/data/carebee.sqlite`. Expose it to Lovable over HTTPS via a reverse proxy. The bridge binds to `127.0.0.1:8789` by default. Set `MQTT_BRIDGE_BIND` and `PORT` to match the host if needed.
2. Set the bridge's `MQTT_APP_URL` to the published Lovable app origin and set `MQTT_BRIDGE_TOKEN` in the bridge host's secret store. Set the same token and the HTTPS `MQTT_BRIDGE_URL` in Lovable Cloud secrets. The app uses its existing Supabase integration for schedule reads and telemetry writes. The bridge polls the app every five seconds and needs no separately configured cron job.
3. Configure topic permissions on the broker. The bridge needs subscribe access to the sensor topics and publish access to the reminder topics. Each ESP32 needs the reverse permissions for its own two topics. Use TLS for device keys and medication data. For brokers requiring bridge credentials, set the host secret `MQTT_BROKER_CREDENTIALS` to a JSON object keyed by the exact selected endpoint, e.g. `{"mqtts://broker.example.com:8883":{"username":"<user>","password":"<password>"}}`. Keep production brokers on public addresses or explicitly configure the bridge to reach a trusted private broker.
