const levelOrder = ['error', 'warn', 'info', 'debug'];
const configuredLevel = process.env.LOG_LEVEL?.toLowerCase();
const minimumLevel = levelOrder.includes(configuredLevel) ? configuredLevel : 'info';

function safeValue(value, key = '') {
  if (/password|token|secret|authorization|credential/i.test(key)) {
    return '[redacted]';
  }
  if (value instanceof Error) {
    return { name: value.name, code: value.code };
  }
  if (Array.isArray(value)) {
    return value.map((entry) => safeValue(entry));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [entryKey, safeValue(entryValue, entryKey)]),
    );
  }
  return value;
}

function log(level, message, metadata) {
  if (levelOrder.indexOf(level) > levelOrder.indexOf(minimumLevel)) return;
  const details = metadata === undefined ? '' : ` ${JSON.stringify(safeValue(metadata))}`;
  const output = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${message}${details}`;
  const target = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  target(output);
}

export const logger = {
  error: (message, metadata) => log('error', message, metadata),
  warn: (message, metadata) => log('warn', message, metadata),
  info: (message, metadata) => log('info', message, metadata),
  debug: (message, metadata) => log('debug', message, metadata),
  log: ({ level = 'info', message, ...metadata }) => log(level, message, metadata),
  stream: { write: (message) => log('info', String(message).trim()) },
};

export function startupLog(message) {
  log('info', message);
}

export function shutdownLog(message) {
  log('info', message);
}

export default logger;
