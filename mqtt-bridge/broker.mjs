import { lookup } from "node:dns/promises";
import net from "node:net";
import tls from "node:tls";
import ipaddr from "ipaddr.js";
import mqtt from "mqtt";

export async function resolveBroker(host, privateHosts) {
  const addresses = await lookup(host, { all: true });
  const address = addresses.find(({ address }) => {
    const ip = ipaddr.process(address);
    return ip.range() === "unicast" || privateHosts.has(host);
  });
  if (!address) throw new Error("Broker address is unavailable");
  return address;
}

export function createBrokerClient(settings, { address, family }, clientId, credentials) {
  const { host, transport, ports, websocketPath } = settings;
  const port = ports[transport];
  const options = {
    ...credentials,
    clientId,
    manualConnect: true,
    connectTimeout: 8000,
    reconnectPeriod: 0,
    keepalive: 30,
  };

  if (transport === "ws" || transport === "wss") {
    return mqtt.connect({
      ...options,
      hostname: host,
      port,
      path: websocketPath,
      protocol: transport,
      wsOptions: {
        // Connect to the checked IP while keeping the original hostname for TLS and HTTP.
        lookup(_host, opts, callback) {
          if (opts.all) callback(null, [{ address, family }]);
          else callback(null, address, family);
        },
        followRedirects: false,
      },
    });
  }

  const endpoint = { host: address, port, family };
  return new mqtt.MqttClient(
    () =>
      transport === "mqtts"
        ? tls.connect({
            ...endpoint,
            ...(net.isIP(host) ? {} : { servername: host }),
            rejectUnauthorized: true,
            checkServerIdentity: (_name, certificate) => tls.checkServerIdentity(host, certificate),
          })
        : net.connect(endpoint),
    options,
  );
}
