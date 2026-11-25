import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { createEmbed } from '../../utils/embeds.js';
import { getMusicEmoji } from './applicationEmojis.js';

const QUEUE_PAGE_SIZE = 10;

export const MUSIC_BUTTON_IDS = Object.freeze({
  PREVIOUS: 'music_previous',
  PAUSE: 'music_pause',
  RESUME: 'music_resume',
  SKIP: 'music_skip',
  STOP: 'music_stop',
  LOOP: 'music_loop',
  SHUFFLE: 'music_shuffle',
  QUEUE: 'music_queue',
  VOLUME: 'music_volume',
  VOL_DOWN: 'music_vol_down',
  VOL_UP: 'music_vol_up',
  QUEUE_FIRST: 'music_queue_first',
  QUEUE_PREV: 'music_queue_prev',
  QUEUE_NEXT: 'music_queue_next',
  QUEUE_LAST: 'music_queue_last',
});

export function formatDuration(ms) {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return 'Live';
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function getLoopLabel(loop) {
  if (loop === 'track') return 'Track';
  if (loop === 'queue') return 'Queue';
  return 'Off';
}

export function buildNowPlayingEmbed(track, player, guildData) {
  const requester = track?.info?.requester;
  const requesterLabel = requester?.username || requester?.tag || 'Unknown';
  const duration = track?.info?.length ? formatDuration(track.info.length) : 'Live';

  return createEmbed({
    title: 'Now Playing',
    description: track?.info?.title || 'Unknown track',
    color: 'primary',
    fields: [
      { name: 'Artist', value: track?.info?.author || 'Unknown', inline: true },
      { name: 'Requester', value: requesterLabel, inline: true },
      { name: 'Progress', value: `${formatDuration(player?.position ?? 0)} / ${duration}`, inline: true },
      { name: 'Volume', value: `${guildData?.volume ?? 75}%`, inline: true },
      { name: 'Loop', value: getLoopLabel(guildData?.loop), inline: true },
      { name: 'Autoplay', value: guildData?.autoplay ? 'On' : 'Off', inline: true },
      { name: 'Queue', value: `${player?.queue?.length || 0} track(s)`, inline: true },
    ],
    thumbnail: track?.info?.artworkUrl || track?.info?.thumbnail || null,
    footer: player?.paused ? 'Paused' : 'Playing',
  });
}

export function buildQueueEmbed(queue, currentTrack, page = 0) {
  const totalTracks = queue?.length || 0;
  const totalPages = Math.max(1, Math.ceil(totalTracks / QUEUE_PAGE_SIZE));
  const safePage = Math.min(Math.max(page, 0), totalPages - 1);
  const start = safePage * QUEUE_PAGE_SIZE;
  const tracks = queue?.slice(start, start + QUEUE_PAGE_SIZE) || [];
  const rows = [];

  if (currentTrack) {
    rows.push(`Now Playing\n${currentTrack.info?.title || 'Unknown'} — ${currentTrack.info?.author || 'Unknown'}`);
  }
  rows.push(tracks.length
    ? tracks.map((track, index) => `${start + index + 1}. ${track.info?.title || 'Unknown'} — ${track.info?.author || 'Unknown'}`).join('\n')
    : 'The queue is empty.');

  return createEmbed({
    title: 'Music Queue',
    description: rows.join('\n\n').slice(0, 4096),
    color: 'info',
    footer: `Page ${safePage + 1} of ${totalPages} • ${totalTracks} queued`,
  });
}

function createPlayerButton(client, customId, label, emojiIntent, disabled = false) {
  const button = new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(disabled);
  const emoji = getMusicEmoji(client, emojiIntent);
  if (emoji) button.setEmoji(emoji);
  return button;
}

export function buildPlayerButtonRows(client, player, guildData) {
  const paused = Boolean(player?.paused);
  const row1 = new ActionRowBuilder().addComponents(
    createPlayerButton(client, MUSIC_BUTTON_IDS.PREVIOUS, 'Previous', 'previous', !guildData?.previousTracks?.length),
    createPlayerButton(client, paused ? MUSIC_BUTTON_IDS.RESUME : MUSIC_BUTTON_IDS.PAUSE, paused ? 'Resume' : 'Pause', paused ? 'resume' : 'pause'),
    createPlayerButton(client, MUSIC_BUTTON_IDS.SKIP, 'Skip', 'skip'),
    createPlayerButton(client, MUSIC_BUTTON_IDS.STOP, 'Stop', 'stop'),
  );

  const row2 = new ActionRowBuilder().addComponents(
    createPlayerButton(client, MUSIC_BUTTON_IDS.LOOP, `Loop: ${getLoopLabel(guildData?.loop)}`, 'loop'),
    createPlayerButton(client, MUSIC_BUTTON_IDS.SHUFFLE, 'Shuffle', 'shuffle'),
    createPlayerButton(client, MUSIC_BUTTON_IDS.QUEUE, 'Queue', 'queue'),
    createPlayerButton(client, MUSIC_BUTTON_IDS.VOLUME, `Volume: ${guildData?.volume ?? 75}%`, 'volume'),
  );

  return [row1, row2];
}

export function buildQueuePaginationRow(page, totalPages) {
  const safePage = Math.min(Math.max(page, 0), Math.max(0, totalPages - 1));
  const button = (customId, label, disabled) => new ButtonBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(ButtonStyle.Secondary)
    .setDisabled(disabled);

  return new ActionRowBuilder().addComponents(
    button(MUSIC_BUTTON_IDS.QUEUE_FIRST, 'First', safePage === 0),
    button(MUSIC_BUTTON_IDS.QUEUE_PREV, 'Previous', safePage === 0),
    button('music_queue_page', `Page ${safePage + 1} of ${totalPages}`, true),
    button(MUSIC_BUTTON_IDS.QUEUE_NEXT, 'Next', safePage >= totalPages - 1),
    button(MUSIC_BUTTON_IDS.QUEUE_LAST, 'Last', safePage >= totalPages - 1),
  );
}

export function getQueuePageSize() {
  return QUEUE_PAGE_SIZE;
}
