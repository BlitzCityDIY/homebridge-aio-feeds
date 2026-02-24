export const PLATFORM_NAME = 'AdafruitIOPlatform';
export const PLUGIN_NAME = 'homebridge-aio-feeds';

export const AIO_MQTT_HOST = 'io.adafruit.com';
export const AIO_MQTT_PORT = 8883;
export const AIO_REST_BASE = 'https://io.adafruit.com/api/v2';

export const COMPONENT_TYPE_MAP: Record<string, string> = {
  'temperature': 'TemperatureSensor',
  'humidity':    'HumiditySensor',
  'switch':      'Switch',
  'relay':       'Switch',
  'button':      'StatelessProgrammableSwitch',
  'light':       'LightSensor',
  'lux':         'LightSensor',
  'motion':      'MotionSensor',
  'contact':     'ContactSensor',
  'co2':         'CarbonDioxideSensor',
  'co':          'CarbonMonoxideSensor',
};
