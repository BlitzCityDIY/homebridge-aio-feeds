import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import type { AdafruitIOPlatform, AIOFeedConfig } from './platform.js';

/**
 * A "strategy" that knows how to set up HomeKit characteristics and
 * apply incoming feed values for a particular service type.
 */
interface ServiceTypeHandler {
  getServiceClass: (platform: AdafruitIOPlatform) => typeof Service.Switch;
  setup: (ctx: AccessoryContext) => void;
  apply: (ctx: AccessoryContext, raw: string) => void;
}

/**
 * Shared context passed to each handler so it can read/write cached
 * values and push updates without reaching back into the accessory.
 */
interface AccessoryContext {
  platform: AdafruitIOPlatform;
  service: Service;
  cached: Record<string, CharacteristicValue>;
  feedKey: string;
}

// ---------------------------------------------------------------------------
// Handler registry – keeps setup and apply logic together per service type
// ---------------------------------------------------------------------------

const handlers: Record<string, ServiceTypeHandler> = {
  TemperatureSensor: {
    getServiceClass: (p) => p.Service.TemperatureSensor,
    setup(ctx) {
      ctx.cached.value = 0;
      ctx.service
        .getCharacteristic(ctx.platform.Characteristic.CurrentTemperature)
        .onGet(() => ctx.cached.value);
    },
    apply(ctx, raw) {
      const temp = parseFloat(raw);
      if (!isNaN(temp)) {
        ctx.cached.value = temp;
        ctx.service.updateCharacteristic(ctx.platform.Characteristic.CurrentTemperature, temp);
      }
    },
  },

  HumiditySensor: {
    getServiceClass: (p) => p.Service.HumiditySensor,
    setup(ctx) {
      ctx.cached.value = 0;
      ctx.service
        .getCharacteristic(ctx.platform.Characteristic.CurrentRelativeHumidity)
        .onGet(() => ctx.cached.value);
    },
    apply(ctx, raw) {
      const hum = parseFloat(raw);
      if (!isNaN(hum)) {
        ctx.cached.value = hum;
        ctx.service.updateCharacteristic(ctx.platform.Characteristic.CurrentRelativeHumidity, hum);
      }
    },
  },

  LightSensor: {
    getServiceClass: (p) => p.Service.LightSensor,
    setup(ctx) {
      ctx.cached.value = 0.0001; // HomeKit minimum lux
      ctx.service
        .getCharacteristic(ctx.platform.Characteristic.CurrentAmbientLightLevel)
        .onGet(() => ctx.cached.value);
    },
    apply(ctx, raw) {
      const parsed = parseFloat(raw);
      if (isNaN(parsed)) {
        return;
      }              // guard before clamping
      const lux = Math.max(0.0001, parsed);
      ctx.cached.value = lux;
      ctx.service.updateCharacteristic(ctx.platform.Characteristic.CurrentAmbientLightLevel, lux);
    },
  },

  MotionSensor: {
    getServiceClass: (p) => p.Service.MotionSensor,
    setup(ctx) {
      ctx.cached.value = false;
      ctx.service
        .getCharacteristic(ctx.platform.Characteristic.MotionDetected)
        .onGet(() => ctx.cached.value);
    },
    apply(ctx, raw) {
      const detected = raw === '1' || raw.toLowerCase() === 'true' || raw.toLowerCase() === 'on';
      ctx.cached.value = detected;
      ctx.service.updateCharacteristic(ctx.platform.Characteristic.MotionDetected, detected);
    },
  },

  ContactSensor: {
    getServiceClass: (p) => p.Service.ContactSensor,
    setup(ctx) {
      ctx.cached.value = ctx.platform.Characteristic.ContactSensorState.CONTACT_DETECTED;
      ctx.service
        .getCharacteristic(ctx.platform.Characteristic.ContactSensorState)
        .onGet(() => ctx.cached.value);
    },
    apply(ctx, raw) {
      const C = ctx.platform.Characteristic;
      const contact = (raw === '1' || raw.toLowerCase() === 'true' || raw.toLowerCase() === 'on')
        ? C.ContactSensorState.CONTACT_DETECTED
        : C.ContactSensorState.CONTACT_NOT_DETECTED;
      ctx.cached.value = contact;
      ctx.service.updateCharacteristic(C.ContactSensorState, contact);
    },
  },

  CarbonDioxideSensor: {
    getServiceClass: (p) => p.Service.CarbonDioxideSensor,
    setup(ctx) {
      const C = ctx.platform.Characteristic;
      ctx.cached.detected = C.CarbonDioxideDetected.CO2_LEVELS_NORMAL;
      ctx.cached.level = 0;
      ctx.service.getCharacteristic(C.CarbonDioxideDetected)
        .onGet(() => ctx.cached.detected);
      ctx.service.getCharacteristic(C.CarbonDioxideLevel)
        .onGet(() => ctx.cached.level);
    },
    apply(ctx, raw) {
      const C = ctx.platform.Characteristic;
      const ppm = parseFloat(raw);
      if (isNaN(ppm)) {
        return;
      }
      const detected = ppm > 1000
        ? C.CarbonDioxideDetected.CO2_LEVELS_ABNORMAL
        : C.CarbonDioxideDetected.CO2_LEVELS_NORMAL;
      ctx.cached.detected = detected;
      ctx.cached.level = ppm;
      ctx.service.updateCharacteristic(C.CarbonDioxideDetected, detected);
      ctx.service.updateCharacteristic(C.CarbonDioxideLevel, ppm);
    },
  },

  CarbonMonoxideSensor: {
    getServiceClass: (p) => p.Service.CarbonMonoxideSensor,
    setup(ctx) {
      const C = ctx.platform.Characteristic;
      ctx.cached.detected = C.CarbonMonoxideDetected.CO_LEVELS_NORMAL;
      ctx.cached.level = 0;
      ctx.service.getCharacteristic(C.CarbonMonoxideDetected)
        .onGet(() => ctx.cached.detected);
      ctx.service.getCharacteristic(C.CarbonMonoxideLevel)
        .onGet(() => ctx.cached.level);
    },
    apply(ctx, raw) {
      const C = ctx.platform.Characteristic;
      const ppm = parseFloat(raw);
      if (isNaN(ppm)) {
        return;
      }
      const detected = ppm > 35
        ? C.CarbonMonoxideDetected.CO_LEVELS_ABNORMAL
        : C.CarbonMonoxideDetected.CO_LEVELS_NORMAL;
      ctx.cached.detected = detected;
      ctx.cached.level = ppm;
      ctx.service.updateCharacteristic(C.CarbonMonoxideDetected, detected);
      ctx.service.updateCharacteristic(C.CarbonMonoxideLevel, ppm);
    },
  },

  StatelessProgrammableSwitch: {
    getServiceClass: (p) => p.Service.StatelessProgrammableSwitch,
    setup() {
      // Read-only: no onGet/onSet, events are pushed via updateCharacteristic
    },
    apply(ctx) {
      const C = ctx.platform.Characteristic;
      ctx.service.updateCharacteristic(
        C.ProgrammableSwitchEvent,
        C.ProgrammableSwitchEvent.SINGLE_PRESS,
      );
    },
  },

  Switch: {
    getServiceClass: (p) => p.Service.Switch,
    setup(ctx) {
      ctx.cached.value = false;
      ctx.service
        .getCharacteristic(ctx.platform.Characteristic.On)
        .onGet(() => ctx.cached.value)
        .onSet((value: CharacteristicValue) => {
          ctx.cached.value = value;
          const payload = (value as boolean) ? '1' : '0';
          ctx.platform.publishFeedValue(ctx.feedKey, payload);
        });
    },
    apply(ctx, raw) {
      const on = raw === '1' || raw.toLowerCase() === 'true' || raw.toLowerCase() === 'on';
      ctx.cached.value = on;
      ctx.service.updateCharacteristic(ctx.platform.Characteristic.On, on);
    },
  },
};

// ---------------------------------------------------------------------------
// Accessory class
// ---------------------------------------------------------------------------

/**
 * Represents a single Adafruit IO feed mapped to a HomeKit accessory service.
 * On construction it fetches the last known value via REST to seed initial state,
 * then stays up-to-date via MQTT messages routed from the platform.
 */
export class AdafruitIOAccessory {
  private service: Service;
  private feedCfg: AIOFeedConfig;
  private handler: ServiceTypeHandler;
  private ctx: AccessoryContext;

  constructor(
    private readonly platform: AdafruitIOPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    this.feedCfg = accessory.context.feedCfg as AIOFeedConfig;

    // Set accessory information service
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Adafruit')
      .setCharacteristic(this.platform.Characteristic.Model, this.feedCfg.serviceType)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.feedCfg.feedKey);

    // Resolve handler (fall back to Switch for unknown types)
    this.handler = handlers[this.feedCfg.serviceType] ?? handlers.Switch;

    this.service = this.getOrAddService();
    this.service.setCharacteristic(this.platform.Characteristic.Name, this.feedCfg.displayName);

    // Build shared context for the handler
    this.ctx = {
      platform: this.platform,
      service: this.service,
      cached: {},
      feedKey: this.feedCfg.feedKey,
    };

    this.handler.setup(this.ctx);

    // Seed initial state from REST
    this.platform.fetchLastValue(this.feedCfg.feedKey).then((val) => {
      if (val !== null) {
        this.platform.log.debug(`Seeded "${this.feedCfg.feedKey}" with last value: ${val}`);
        this.handler.apply(this.ctx, val);
      }
    });
  }

  /**
   * Called by the platform whenever an MQTT message arrives for this feed.
   */
  handleFeedUpdate(rawValue: string) {
    this.platform.log.debug(`Feed update for "${this.feedCfg.feedKey}": ${rawValue}`);
    this.handler.apply(this.ctx, rawValue);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private getOrAddService(): Service {
    const ServiceClass = this.handler.getServiceClass(this.platform);
    return this.accessory.getService(ServiceClass) || this.accessory.addService(ServiceClass);
  }
}
