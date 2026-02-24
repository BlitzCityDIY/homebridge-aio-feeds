import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';
import mqtt from 'mqtt';
import { AdafruitIOAccessory } from './platformAccessory.js';
import { PLATFORM_NAME, PLUGIN_NAME, AIO_MQTT_HOST, AIO_MQTT_PORT, AIO_REST_BASE } from './settings.js';

export interface AIOFeedConfig {
  feedKey: string;       // e.g. "mydevice.temperature"
  displayName: string;   // e.g. "Living Room Temp"
  serviceType: string;   // e.g. "TemperatureSensor"
}

export class AdafruitIOPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly accessories: Map<string, PlatformAccessory> = new Map();

  private mqttClient?: mqtt.MqttClient;
  // Map of feed topic -> accessory, so incoming MQTT messages can be routed
  private feedAccessoryMap: Map<string, AdafruitIOAccessory> = new Map();

  private readonly aioUsername: string;
  private readonly aioKey: string;
  private readonly feeds: AIOFeedConfig[];

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.aioUsername = config.username ?? '';
    this.aioKey = config.key ?? '';
    this.feeds = (config.feeds as AIOFeedConfig[]) ?? [];

    if (!this.aioUsername || !this.aioKey) {
      this.log.error('Adafruit IO username and key are required. Please configure the plugin.');
      return;
    }

    this.log.debug('Finished initializing platform:', this.config.name);

    this.api.on('didFinishLaunching', () => {
      this.log.debug('Executed didFinishLaunching callback');
      this.discoverDevices();
      this.connectMQTT();
    });

    this.api.on('shutdown', () => {
      this.mqttClient?.end();
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.set(accessory.UUID, accessory);
  }

  /**
   * Register each configured feed as a HomeKit accessory.
   * Accessories already in the cache are restored; new ones are registered.
   * Stale cached accessories (feeds removed from config) are unregistered.
   */
  discoverDevices() {
    const discoveredUUIDs: string[] = [];

    for (const feedCfg of this.feeds) {
      const uuid = this.api.hap.uuid.generate(feedCfg.feedKey);
      discoveredUUIDs.push(uuid);

      const existing = this.accessories.get(uuid);
      if (existing) {
        this.log.info('Restoring existing accessory from cache:', existing.displayName);
        existing.context.feedCfg = feedCfg;
        this.api.updatePlatformAccessories([existing]);
        const acc = new AdafruitIOAccessory(this, existing);
        this.feedAccessoryMap.set(this.feedTopic(feedCfg.feedKey), acc);
      } else {
        this.log.info('Adding new accessory:', feedCfg.displayName);
        const accessory = new this.api.platformAccessory(feedCfg.displayName, uuid);
        accessory.context.feedCfg = feedCfg;
        const acc = new AdafruitIOAccessory(this, accessory);
        this.feedAccessoryMap.set(this.feedTopic(feedCfg.feedKey), acc);

        // Track in our map so stale-removal logic is consistent
        this.accessories.set(uuid, accessory);

        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }

    // Remove stale accessories
    for (const [uuid, accessory] of this.accessories) {
      if (!discoveredUUIDs.includes(uuid)) {
        this.log.info('Removing stale accessory from cache:', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
        this.accessories.delete(uuid);
      }
    }
  }

  /**
   * Open a persistent MQTT connection to Adafruit IO and subscribe to all
   * configured feed topics.
   */
  connectMQTT() {
    this.log.info('Connecting to Adafruit IO MQTT broker...');

    this.mqttClient = mqtt.connect({
      host: AIO_MQTT_HOST,
      port: AIO_MQTT_PORT,
      protocol: 'mqtts',
      username: this.aioUsername,
      password: this.aioKey,
    });

    this.mqttClient.on('connect', () => {
      this.log.info('Connected to Adafruit IO MQTT.');

      // Subscribe to each configured feed.
      // This runs on every (re)connect so subscriptions survive reconnects.
      for (const feedCfg of this.feeds) {
        const topic = this.feedTopic(feedCfg.feedKey);
        this.mqttClient!.subscribe(topic, { qos: 1 }, (err) => {
          if (err) {
            this.log.error(`Failed to subscribe to ${topic}:`, err.message);
          } else {
            this.log.debug('Subscribed to feed topic:', topic);
          }
        });
      }
    });

    this.mqttClient.on('message', (topic, payload) => {
      const value = payload.toString();
      this.log.debug(`MQTT message on ${topic}: ${value}`);
      const acc = this.feedAccessoryMap.get(topic);
      if (acc) {
        acc.handleFeedUpdate(value);
      }
    });

    this.mqttClient.on('error', (err) => {
      this.log.error('MQTT error:', err.message);
    });

    this.mqttClient.on('reconnect', () => {
      this.log.debug('MQTT reconnecting...');
    });

    this.mqttClient.on('offline', () => {
      this.log.warn('MQTT client went offline.');
    });
  }

  /**
   * Publish a value back to a feed (for controllable accessories like switches).
   */
  publishFeedValue(feedKey: string, value: string) {
    const topic = this.feedTopic(feedKey);
    this.mqttClient?.publish(topic, value, { qos: 1 }, (err) => {
      if (err) {
        this.log.error(`Failed to publish to ${topic}:`, err.message);
      } else {
        this.log.debug(`Published "${value}" to ${topic}`);
      }
    });
  }

  /**
   * Fetch the last known value for a feed via REST at startup.
   */
  async fetchLastValue(feedKey: string): Promise<string | null> {
    const url = `${AIO_REST_BASE}/${this.aioUsername}/feeds/${feedKey}/data/last`;
    try {
      const res = await fetch(url, {
        headers: { 'X-AIO-Key': this.aioKey },
      });
      if (!res.ok) {
        this.log.warn(`Could not fetch last value for feed "${feedKey}": HTTP ${res.status}`);
        return null;
      }
      const json = await res.json() as { value: string };
      return json.value ?? null;
    } catch (e) {
      this.log.error(`Error fetching last value for feed "${feedKey}":`, (e as Error).message);
      return null;
    }
  }

  /**
   * Fetch all feeds for the configured AIO account.
   */
  async fetchAllFeeds(): Promise<{ key: string; name: string }[]> {
    const url = `${AIO_REST_BASE}/${this.aioUsername}/feeds`;
    try {
      const res = await fetch(url, {
        headers: { 'X-AIO-Key': this.aioKey },
      });
      if (!res.ok) {
        this.log.warn(`Could not fetch feeds: HTTP ${res.status}`);
        return [];
      }
      const json = await res.json() as { key: string; name: string }[];
      return json;
    } catch (e) {
      this.log.error('Error fetching feeds:', (e as Error).message);
      return [];
    }
  }

  private feedTopic(feedKey: string): string {
    return `${this.aioUsername}/feeds/${feedKey}`;
  }
}
