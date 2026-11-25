import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const settingsPath = path.resolve(process.env.LAVALINK_CONFIG_PATH || 'data/lavalink.json');

function readLavalinkSettings(env = process.env) {
  const requiredNames = ['LAVALINK_HOST', 'LAVALINK_PORT', 'LAVALINK_PASSWORD'];
  const missing = requiredNames.filter((name) => !String(env[name] || '').trim());

  if (missing.length) {
    return { nodes: [], configurationError: `Missing required Lavalink settings: ${missing.join(', ')}.` };
  }

  const port = Number(env.LAVALINK_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { nodes: [], configurationError: 'LAVALINK_PORT must be an integer from 1 to 65535.' };
  }

  const host = String(env.LAVALINK_HOST).trim();
  if (host.includes('://') || /[/?#\s]/.test(host)) {
    return { nodes: [], configurationError: 'LAVALINK_HOST must be a hostname or IP address without a protocol or path.' };
  }

  const secureValue = String(env.LAVALINK_SECURE ?? '').trim().toLowerCase();
  if (secureValue && !['true', 'false'].includes(secureValue)) {
    return { nodes: [], configurationError: 'LAVALINK_SECURE must be true or false.' };
  }

  return {
    nodes: [{ host, port, password: String(env.LAVALINK_PASSWORD), secure: secureValue === 'true', name: 'Lavalink' }],
    configurationError: null,
  };
}

function getInitialSettings() {
  try {
    const saved = JSON.parse(readFileSync(settingsPath, 'utf8'));
    return readLavalinkSettings({
      LAVALINK_HOST: saved.host,
      LAVALINK_PORT: saved.port,
      LAVALINK_PASSWORD: saved.password,
      LAVALINK_SECURE: saved.secure ? 'true' : 'false',
    });
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error('[ASTRION] Saved Lavalink settings are invalid; using environment settings.');
    }
    return readLavalinkSettings();
  }
}

export const lavalinkConfig = {
  ...getInitialSettings(),
  defaultSearchPlatform: 'ytmsearch',
  restVersion: 'v4',
};

export function updateLavalinkSettings(settings) {
  const validated = readLavalinkSettings({
    LAVALINK_HOST: settings.host,
    LAVALINK_PORT: settings.port,
    LAVALINK_PASSWORD: settings.password,
    LAVALINK_SECURE: String(settings.secure),
  });
  if (validated.configurationError) throw new Error(validated.configurationError);

  const [node] = validated.nodes;
  mkdirSync(path.dirname(settingsPath), { recursive: true, mode: 0o700 });
  writeFileSync(settingsPath, JSON.stringify({
    host: node.host,
    port: node.port,
    password: node.password,
    secure: node.secure,
  }), { mode: 0o600 });
  chmodSync(settingsPath, 0o600);
  lavalinkConfig.nodes = validated.nodes;
  lavalinkConfig.configurationError = null;
}

export { readLavalinkSettings };
export default lavalinkConfig;
