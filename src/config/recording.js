export const recordingConfig = Object.freeze({
  timeZone: 'Asia/Dhaka',
  sampleRate: 48_000,
  bitrate: '128k',
  maxDurationMs: 60 * 60 * 1_000,
  consentWindowMs: 45 * 1_000,
  maxUploadBytes: 8 * 1024 * 1024,
  maxTemporaryStorageBytes: 2 * 1024 * 1024 * 1024,
  retentionDays: 90,
  dataDirectory: 'data/recordings',
  recordingChannelName: 'astrion-recordings',
  ffmpegPath: 'ffmpeg',
});
