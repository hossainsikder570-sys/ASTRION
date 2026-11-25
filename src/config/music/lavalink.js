function readLavalinkSettings(env = process.env) {
  const requiredNames = ['LAVALINK_HOST', 'LAVALINK_PORT', 'LAVALINK_PASSWORD'];
  const missing = requiredNames.filter((name) => !env[name]?.trim());

  if (missing.length) {
    return {
      nodes: [],
      configurationError: `Missing required Lavalink settings: ${missing.join(', ')}.`,
    };
  }

  const port = Number(env.LAVALINK_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { nodes: [], configurationError: 'LAVALINK_PORT must be an integer from 1 to 65535.' };
  }

  const host = env.LAVALINK_HOST.trim();
  if (host.includes('://') || /[/?#\s]/.test(host)) {
    return { nodes: [], configurationError: 'LAVALINK_HOST must be a hostname or IP address without a protocol or path.' };
  }

  const secureValue = env.LAVALINK_SECURE?.trim().toLowerCase();
  if (secureValue && !['true', 'false'].includes(secureValue)) {
    return { nodes: [], configurationError: 'LAVALINK_SECURE must be true or false.' };
  }

  return {
    nodes: [{
      host,
      port,
      password: env.LAVALINK_PASSWORD,
      secure: secureValue === 'true',
      name: 'Lavalink',
    }],
    configurationError: null,
  };
}

const settings = readLavalinkSettings();

export const lavalinkConfig = Object.freeze({
  ...settings,
  defaultSearchPlatform: 'ytmsearch',
  restVersion: 'v4',
});

export { readLavalinkSettings };
export default lavalinkConfig;
