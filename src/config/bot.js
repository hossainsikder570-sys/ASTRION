const embedColors = Object.freeze({
  primary: 0x5865f2,
  secondary: 0x2f3136,
  success: 0x57f287,
  error: 0xed4245,
  warning: 0xfee75c,
  info: 0x3498db,
  gray: 0x99aab5,
  dark: 0x202225,
});

export const botConfig = Object.freeze({
  embeds: {
    colors: embedColors,
    footer: { text: 'ASTRION' },
  },
});

export function getColor(value, fallback = embedColors.primary) {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string') return fallback;
  if (value.startsWith('#')) return Number.parseInt(value.slice(1), 16);
  return embedColors[value] ?? fallback;
}

export default botConfig;
