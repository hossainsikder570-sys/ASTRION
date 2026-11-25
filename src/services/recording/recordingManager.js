import { randomUUID } from 'node:crypto';
import { chmod, copyFile, mkdir, open, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import prism from 'prism-media';
import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionsBitField,
} from 'discord.js';
import {
  entersState,
  EndBehaviorType,
  joinVoiceChannel,
  VoiceConnectionStatus,
} from '@discordjs/voice';
import { recordingConfig } from '../../config/recording.js';
import { logger } from '../../utils/logger.js';

const sessions = new Map();
const recordsById = new Map();
const pcmBytesPerMs = recordingConfig.sampleRate * 2 * 2 / 1_000;
const zeroBuffer = Buffer.alloc(64 * 1024);
const requiredVoicePermissions = [PermissionsBitField.Flags.Connect];
let recordsLoaded = false;
let writeQueue = Promise.resolve();
let runtimeClient = null;
let retentionTimer = null;

function storageRoot() {
  return path.resolve(process.cwd(), recordingConfig.dataDirectory);
}

function bdt(value) {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  return `${new Intl.DateTimeFormat('en-GB', {
    timeZone: recordingConfig.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)} BDT`;
}

function displayDuration(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainder = seconds % 60;
  return hours ? `${hours}h ${minutes}m ${remainder}s` : `${minutes}m ${remainder}s`;
}

function hasRecordingManagerPermission(memberOrPermissions) {
  const value = memberOrPermissions?.permissions ?? memberOrPermissions;
  if (!value) return false;
  let permissions;
  try {
    permissions = typeof value.has === 'function' ? value : new PermissionsBitField(value);
  } catch {
    return false;
  }
  return permissions.has(PermissionsBitField.Flags.Administrator) ||
    permissions.has(PermissionsBitField.Flags.ManageGuild) ||
    permissions.has(PermissionsBitField.Flags.ManageChannels);
}

export function isRecordingManager(member) {
  return hasRecordingManagerPermission(member);
}

export function isRecordingActive(guildId) {
  const session = sessions.get(guildId);
  return Boolean(session && !['finalizing', 'saved', 'cancelled', 'failed'].includes(session.status));
}

async function ensureSecureDirectory(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  try {
    await chmod(directory, 0o700);
  } catch (error) {
    logger.warn('Could not restrict recording directory permissions.', { code: error?.code });
  }
}

async function deleteDiscordDeliveries(record, client = runtimeClient) {
  const privateIds = record.privateMessageIds || (record.privateMessageId ? [record.privateMessageId] : []);
  const deliveries = [
    ...privateIds.map((messageId) => [record.privateChannelId, messageId]),
    [record.dmChannelId, record.dmMessageId],
  ].filter(([channelId, messageId]) => channelId && messageId);
  if (!deliveries.length) return true;
  if (!client) return false;

  let allDeleted = true;
  for (const [channelId, messageId] of deliveries) {
    let channel;
    try {
      channel = await client.channels.fetch(channelId);
    } catch (error) {
      if (Number(error?.code) !== 10003) allDeleted = false;
      continue;
    }
    if (!channel?.messages) {
      allDeleted = false;
      continue;
    }
    let message;
    try {
      message = await channel.messages.fetch(messageId);
    } catch (error) {
      if (Number(error?.code) !== 10008) allDeleted = false;
      continue;
    }
    try {
      await message.delete();
    } catch {
      allDeleted = false;
    }
  }
  return allDeleted;
}

async function loadRecords() {
  if (recordsLoaded) return;
  const root = storageRoot();
  await ensureSecureDirectory(root);
  const indexPath = path.join(root, 'index.json');
  try {
    const data = JSON.parse(await readFile(indexPath, 'utf8'));
    for (const record of Array.isArray(data) ? data : []) {
      if (record?.id && record?.guildId && record?.status === 'completed') {
        recordsById.set(record.id, record);
      }
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      logger.error('Could not read the recording index.', { code: error?.code });
    }
  }
  recordsLoaded = true;
  await pruneExpiredRecords();
}

async function persistRecords() {
  writeQueue = writeQueue.then(async () => {
    const root = storageRoot();
    await ensureSecureDirectory(root);
    const indexPath = path.join(root, 'index.json');
    const temporaryPath = `${indexPath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, JSON.stringify([...recordsById.values()], null, 2), {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporaryPath, indexPath);
    try {
      await chmod(indexPath, 0o600);
    } catch {
      // The file remains private by its creation mode on supported filesystems.
    }
  });
  return writeQueue;
}

function accessibleAnnouncementChannel(guild, members, client) {
  const candidates = [
    guild.systemChannel,
    ...guild.channels.cache.filter((channel) => channel.type === ChannelType.GuildText).values(),
  ].filter(Boolean);
  return candidates.find((channel) => {
    const botPermissions = channel.permissionsFor(client.user);
    if (!botPermissions?.has(PermissionsBitField.Flags.SendMessages) ||
        !botPermissions.has(PermissionsBitField.Flags.EmbedLinks)) return false;
    return members.every((member) => {
      const permissions = channel.permissionsFor(member);
      return permissions?.has(PermissionsBitField.Flags.ViewChannel);
    });
  }) || null;
}

async function getPrivateRecordingChannel(guild, client) {
  const marker = 'Managed by ASTRION private voice recording delivery.';
  let channel = guild.channels.cache.find((candidate) =>
    candidate.type === ChannelType.GuildText && candidate.topic === marker,
  );

  const overwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionsBitField.Flags.ViewChannel],
    },
    {
      id: client.user.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.AttachFiles,
        PermissionsBitField.Flags.EmbedLinks,
      ],
    },
    ...guild.roles.cache
      .filter((role) => role.id !== guild.roles.everyone.id && (
        role.permissions.has(PermissionsBitField.Flags.Administrator) ||
        role.permissions.has(PermissionsBitField.Flags.ManageGuild) ||
        role.permissions.has(PermissionsBitField.Flags.ManageChannels)
      ))
      .map((role) => ({
        id: role.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
          PermissionsBitField.Flags.AttachFiles,
          PermissionsBitField.Flags.EmbedLinks,
        ],
      })),
  ];

  if (!channel) {
    channel = await guild.channels.create({
      name: recordingConfig.recordingChannelName,
      type: ChannelType.GuildText,
      topic: marker,
      permissionOverwrites: overwrites,
      reason: 'Create a private destination for consented voice recordings.',
    });
  } else {
    await channel.permissionOverwrites.set(overwrites, 'Enforce private recording channel access.');
  }

  const botPermissions = channel.permissionsFor(client.user);
  if (!botPermissions || ![
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.AttachFiles,
    PermissionsBitField.Flags.EmbedLinks,
  ].every((permission) => botPermissions.has(permission))) {
    throw new Error('The bot cannot access the private recording channel.');
  }
  return channel;
}

function createPublicIndicatorEmbed(session, title, description) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(title)
    .setDescription(description)
    .addFields(
      { name: 'Recording ID', value: session.id, inline: true },
      { name: 'Voice channel', value: session.voiceChannelName.slice(0, 100), inline: true },
      { name: 'Status', value: session.status, inline: true },
    )
    .setFooter({ text: 'ASTRION voice recording • Consent required' });
}

async function updateIndicator(session, title, description) {
  try {
    await session.indicator?.edit({
      embeds: [createPublicIndicatorEmbed(session, title, description)],
      allowedMentions: { parse: [] },
    });
  } catch (error) {
    logger.warn('Could not update the public recording indicator.', {
      recordingId: session.id,
      code: error?.code,
    });
  }
}

function consentPrompt(session, participant) {
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`rec_consent:${session.id}:${participant.userId}:yes`)
      .setLabel('Consent to recording')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`rec_consent:${session.id}:${participant.userId}:no`)
      .setLabel('Decline or withdraw')
      .setStyle(ButtonStyle.Secondary),
  );
  return {
    content: `ASTRION recording consent request for **${session.title}** in **${session.voiceChannelName}**. Your audio is excluded unless you select Consent to recording. You may withdraw at any time. Recording ID: ${session.id}`,
    components: [row],
    allowedMentions: { parse: [] },
  };
}

async function promptParticipant(session, member) {
  const existing = session.participants.get(member.id);
  const participant = existing || {
    userId: member.id,
    username: member.user.username,
    displayName: member.displayName,
    consentStatus: 'pending',
    joinedAt: Date.now(),
    leftAt: null,
    joinLeaveEvents: [],
  };
  participant.username = member.user.username;
  participant.displayName = member.displayName;
  participant.joinedAt = Date.now();
  participant.leftAt = null;
  participant.consentStatus = 'pending';
  participant.joinLeaveEvents.push({ type: 'join', at: Date.now() });
  session.participants.set(member.id, participant);

  session.consentEvents.push({
    userId: member.id,
    username: member.user.username,
    status: 'prompted',
    at: Date.now(),
  });
  try {
    await member.send(consentPrompt(session, participant));
  } catch (error) {
    participant.consentStatus = 'unreachable';
    session.consentEvents.push({
      userId: member.id,
      username: member.user.username,
      status: 'unreachable',
      at: Date.now(),
    });
    logger.info('Recording consent prompt could not be delivered.', {
      recordingId: session.id,
      userId: member.id,
      code: error?.code,
    });
  }
}

function activeElapsedMs(session) {
  if (!session.startedAt) return 0;
  const end = session.pausedAt || Date.now();
  return Math.max(0, end - session.startedAt - session.totalPausedMs);
}

async function writeZeros(handle, start, count) {
  let position = start;
  let remaining = count;
  while (remaining > 0) {
    const size = Math.min(remaining, zeroBuffer.length);
    await handle.write(zeroBuffer, 0, size, position);
    position += size;
    remaining -= size;
  }
}

function startSpeakerCapture(session, userId) {
  if (session.status !== 'recording' || session.activeStreams.has(userId)) return;
  const participant = session.participants.get(userId);
  if (!participant || participant.consentStatus !== 'accepted' || participant.leftAt) return;

  let track = session.tracks.get(userId);
  if (!track) {
    const pcmPath = path.join(session.temporaryDirectory, `${userId}.pcm`);
    track = {
      userId,
      pcmPath,
      fileHandle: null,
      bytesWritten: 0,
      audioBytes: 0,
      writeQueue: Promise.resolve(),
    };
    session.tracks.set(userId, track);
  }

  const connection = session.connection;
  const opusStream = connection.receiver.subscribe(userId, {
    end: { behavior: EndBehaviorType.AfterSilence, duration: 1_000 },
  });
  const decoder = new prism.opus.Decoder({
    rate: recordingConfig.sampleRate,
    channels: 2,
    frameSize: 960,
  });
  const segment = {
    startOffsetMs: activeElapsedMs(session),
    startAt: Date.now(),
    bytes: 0,
  };
  const streamToken = { opusStream, decoder, segment };
  session.activeStreams.set(userId, streamToken);

  opusStream.pipe(decoder);
  decoder.on('data', (chunk) => {
    if (session.status !== 'recording' || participant.consentStatus !== 'accepted') return;
    const buffer = Buffer.from(chunk);
    const targetOffset = Math.round(segment.startOffsetMs * pcmBytesPerMs) + segment.bytes;
    segment.bytes += buffer.length;
    track.audioBytes += buffer.length;
    track.writeQueue = track.writeQueue.then(async () => {
      if (!track.fileHandle) {
        await ensureSecureDirectory(session.temporaryDirectory);
        track.fileHandle = await open(track.pcmPath, 'a+', 0o600);
        const fileStats = await track.fileHandle.stat();
        track.bytesWritten = fileStats.size;
      }
      const silenceBytes = Math.max(0, targetOffset - track.bytesWritten);
      const bytesToWrite = silenceBytes + buffer.length;
      if (session.temporaryBytes + bytesToWrite > recordingConfig.maxTemporaryStorageBytes) {
        throw new Error('Recording reached its configured temporary storage limit.');
      }
      session.temporaryBytes += bytesToWrite;
      if (silenceBytes > 0) {
        await writeZeros(track.fileHandle, track.bytesWritten, silenceBytes);
        track.bytesWritten += silenceBytes;
      }
      await track.fileHandle.write(buffer, 0, buffer.length, track.bytesWritten);
      track.bytesWritten += buffer.length;
    }).catch((error) => {
      session.captureError = error;
      logger.error('Could not write a consented speaker audio frame.', {
        recordingId: session.id,
        userId,
        code: error?.code,
      });
      if (error?.message?.includes('storage limit')) {
        void finishRecording(session, 'storage-limit').catch(() => {});
      }
    });
  });

  const endSegment = () => {
    if (segment.closed || session.activeStreams.get(userId) !== streamToken) return;
    session.activeStreams.delete(userId);
    segment.closed = true;
  };

  decoder.once('end', endSegment);
  decoder.once('close', endSegment);
  decoder.once('error', (error) => {
    endSegment();
    logger.warn('Speaker audio decoder closed unexpectedly.', {
      recordingId: session.id,
      userId,
      code: error?.code,
    });
  });
  opusStream.once('error', (error) => {
    logger.warn('Speaker audio stream closed unexpectedly.', {
      recordingId: session.id,
      userId,
      code: error?.code,
    });
  });
}

function stopSpeakerCapture(session, userId) {
  const active = session.activeStreams.get(userId);
  if (!active) return;
  if (active.segment.bytes > 0 && !active.segment.closed) {
    active.segment.closed = true;
  }
  session.activeStreams.delete(userId);
  active.opusStream.unpipe(active.decoder);
  active.opusStream.destroy();
  active.decoder.end();
}

function setupReceiver(session) {
  session.speakingStartHandler = (userId) => startSpeakerCapture(session, userId);
  session.connection.receiver.speaking.on('start', session.speakingStartHandler);
  session.connection.on(VoiceConnectionStatus.Disconnected, () => {
    if (['finalizing', 'saved', 'cancelled'].includes(session.status)) return;
    void entersState(session.connection, VoiceConnectionStatus.Ready, 5_000)
      .catch(() => finishRecording(session, 'disconnected'))
      .catch((error) => {
        logger.error('Could not recover recording after bot disconnection.', {
          recordingId: session.id,
          code: error?.code,
        });
      });
  });
}

async function startCapture(session) {
  for (const participant of session.participants.values()) {
    if (participant.consentStatus !== 'pending') continue;
    participant.consentStatus = 'no-response';
    session.consentEvents.push({
      userId: participant.userId,
      username: participant.username,
      status: 'no-response',
      at: Date.now(),
    });
  }
  const accepted = [...session.participants.values()].filter((participant) =>
    participant.consentStatus === 'accepted' && !participant.leftAt,
  );
  if (!accepted.length) {
    await cancelRecording(session, 'No participant consented. The recording was discarded.');
    return false;
  }

  session.status = 'recording';
  session.startedAt = Date.now();
  session.totalPausedMs = 0;
  session.pauseEvents = [];
  setupReceiver(session);
  session.maxDurationTimer = setTimeout(() => {
    void finishRecording(session, 'maximum-duration');
  }, recordingConfig.maxDurationMs);
  session.maxDurationTimer.unref?.();

  await updateIndicator(session, 'Recording in progress', 'Only participants who explicitly consented are captured. Non-consenting participants are excluded.');
  await notifyParticipants(session, `Recording ${session.id} has started. Your audio is included only while you have consented.`);
  return true;
}

async function notifyParticipants(session, message) {
  const users = [...session.participants.values()];
  await Promise.allSettled(users.map(async (participant) => {
    const user = await session.client.users.fetch(participant.userId);
    await user.send(`${message} All times in reports use Bangladesh Time (BDT). Recording ID: ${session.id}`);
  }));
}

async function startConsentWindow(session) {
  session.consentTimer = setTimeout(() => {
    void startCapture(session).catch((error) => {
      logger.error('Could not start the consented recording.', { recordingId: session.id, code: error?.code });
      void cancelRecording(session, 'Recording could not start safely. No audio was saved.');
    });
  }, recordingConfig.consentWindowMs);
  session.consentTimer.unref?.();
}

function findSessionById(recordingId) {
  for (const session of sessions.values()) {
    if (session.id === recordingId) return session;
  }
  return null;
}

export async function handleRecordingConsent(interaction) {
  const [, recordingId, userId, choice] = interaction.customId.split(':');
  const session = findSessionById(recordingId);
  if (!session || interaction.user.id !== userId || !['yes', 'no'].includes(choice)) {
    await interaction.reply({ content: 'This consent request is no longer active.', ephemeral: true });
    return true;
  }
  const participant = session.participants.get(userId);
  if (!participant || participant.leftAt) {
    await interaction.reply({ content: 'You must be in the recorded voice channel to change consent.', ephemeral: true });
    return true;
  }

  const now = Date.now();
  if (choice === 'yes') {
    participant.consentStatus = 'accepted';
    session.consentEvents.push({ userId, username: participant.username, status: 'accepted', at: now });
    if (session.status === 'recording') startSpeakerCapture(session, userId);
    await interaction.reply({ content: 'Your consent was recorded. You can withdraw it using the same request.', ephemeral: true });
  } else {
    const hadConsent = participant.consentStatus === 'accepted';
    participant.consentStatus = hadConsent ? 'withdrawn' : 'declined';
    session.consentEvents.push({
      userId,
      username: participant.username,
      status: hadConsent ? 'withdrawn' : 'declined',
      at: now,
    });
    stopSpeakerCapture(session, userId);
    await interaction.reply({
      content: hadConsent ? 'Your consent was withdrawn. Your audio will no longer be captured.' : 'Your decline was recorded. Your audio will not be captured.',
      ephemeral: true,
    });
  }
  return true;
}

export async function startRecording(client, interaction, title) {
  await loadRecords();
  if (!interaction.guild || !interaction.member) throw new Error('Recording is only available in a server.');
  if (!hasRecordingManagerPermission(interaction.memberPermissions)) {
    throw new Error('You need Manage Server or Manage Channels permission to start a recording.');
  }
  if (sessions.has(interaction.guildId)) throw new Error('A recording session is already active in this server.');
  if (client.riffy?.players?.get(interaction.guildId)) {
    throw new Error('Stop or disconnect the Lavalink music player before recording. Recording never takes over an active music session.');
  }

  const voiceChannel = interaction.member.voice?.channel;
  if (!voiceChannel) throw new Error('Join a voice channel before starting a recording.');
  if (!requiredVoicePermissions.every((permission) => voiceChannel.permissionsFor(client.user)?.has(permission))) {
    throw new Error('The bot needs Connect permission in that voice channel.');
  }

  const participants = [...voiceChannel.members.values()].filter((member) => !member.user.bot);
  const announcementChannel = accessibleAnnouncementChannel(interaction.guild, participants, client);
  if (!announcementChannel) {
    throw new Error('The bot needs a text channel visible to everyone in the voice channel so it can post the recording notice.');
  }
  if (!interaction.guild.members.me?.permissions.has(PermissionsBitField.Flags.ManageChannels)) {
    throw new Error('The bot needs Manage Channels permission to create and secure the private recording destination.');
  }

  const privateChannel = await getPrivateRecordingChannel(interaction.guild, client);
  const recordingId = `AST-${randomUUID().toUpperCase()}`;
  const temporaryDirectory = path.join(storageRoot(), 'working', randomUUID());
  await ensureSecureDirectory(temporaryDirectory);
  const session = {
    id: recordingId,
    guildId: interaction.guildId,
    guildName: interaction.guild.name,
    voiceChannelId: voiceChannel.id,
    voiceChannelName: voiceChannel.name,
    recorderId: interaction.user.id,
    recorderName: interaction.user.username,
    recorderAvatarURL: interaction.user.displayAvatarURL(),
    botAvatarURL: client.user.displayAvatarURL(),
    guildIconURL: interaction.guild.iconURL(),
    title: String(title || `Voice recording ${recordingId}`).slice(0, 200),
    status: 'awaiting-consent',
    createdAt: Date.now(),
    participants: new Map(),
    consentEvents: [],
    pauseEvents: [],
    tracks: new Map(),
    activeStreams: new Map(),
    totalPausedMs: 0,
    temporaryBytes: 0,
    pausedAt: null,
    startedAt: null,
    temporaryDirectory,
    privateChannelId: privateChannel.id,
    announcementChannelId: announcementChannel.id,
    client,
  };
  sessions.set(session.guildId, session);

  try {
    session.indicator = await announcementChannel.send({
      embeds: [createPublicIndicatorEmbed(session, 'Recording consent required', 'ASTRION is requesting private consent from every current voice participant. No audio is being captured yet.')],
      allowedMentions: { parse: [] },
    });
    session.connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: interaction.guildId,
      adapterCreator: interaction.guild.voiceAdapterCreator,
      selfDeaf: false,
      selfMute: true,
    });
    await entersState(session.connection, VoiceConnectionStatus.Ready, 20_000);
    for (const member of participants) await promptParticipant(session, member);
    await notifyParticipants(session, 'ASTRION is requesting consent to record this voice channel. No audio is captured until you accept.');
    await startConsentWindow(session);
    return { recordingId, consentWindowSeconds: Math.round(recordingConfig.consentWindowMs / 1_000) };
  } catch (error) {
    sessions.delete(session.guildId);
    session.connection?.destroy();
    await removeDirectory(temporaryDirectory);
    try {
      await session.indicator?.edit({ content: 'Recording did not start. No audio was saved.', embeds: [], components: [] });
    } catch {
      // The original command still receives the failure privately.
    }
    throw error;
  }
}

async function removeDirectory(directory) {
  try {
    await rm(directory, { recursive: true, force: true });
  } catch (error) {
    logger.warn('Could not remove temporary recording files.', { code: error?.code });
  }
}

export async function pauseRecording(guildId, userId, memberPermissions) {
  const session = sessions.get(guildId);
  if (!session || session.status !== 'recording') throw new Error('There is no active recording to pause.');
  if (session.recorderId !== userId && !hasRecordingManagerPermission(memberPermissions || session.client.guilds.cache.get(guildId)?.members.cache.get(userId))) {
    throw new Error('Only the recorder or a server recording manager can pause this session.');
  }
  session.status = 'paused';
  session.pausedAt = Date.now();
  session.pauseEvents.push({ type: 'paused', at: session.pausedAt });
  for (const userId of session.activeStreams.keys()) stopSpeakerCapture(session, userId);
  await updateIndicator(session, 'Recording paused', 'Audio capture is paused.');
  await notifyParticipants(session, 'Recording paused. No voice audio is being captured while paused.');
  return session.id;
}

export async function resumeRecording(guildId, userId, memberPermissions) {
  const session = sessions.get(guildId);
  if (!session || session.status !== 'paused') throw new Error('There is no paused recording to resume.');
  if (session.recorderId !== userId && !hasRecordingManagerPermission(memberPermissions || session.client.guilds.cache.get(guildId)?.members.cache.get(userId))) {
    throw new Error('Only the recorder or a server recording manager can resume this session.');
  }
  const now = Date.now();
  session.totalPausedMs += now - session.pausedAt;
  session.pauseEvents.push({ type: 'resumed', at: now });
  session.pausedAt = null;
  session.status = 'recording';
  await updateIndicator(session, 'Recording in progress', 'Audio capture has resumed for consenting participants only.');
  await notifyParticipants(session, 'Recording resumed. Only participants who have consented are captured.');
  return session.id;
}

export async function discardRecording(guildId, userId, memberPermissions) {
  const session = sessions.get(guildId);
  if (!session) throw new Error('There is no active recording to cancel.');
  const member = session.client.guilds.cache.get(guildId)?.members.cache.get(userId);
  if (session.recorderId !== userId && !hasRecordingManagerPermission(memberPermissions || member)) {
    throw new Error('Only the recorder or a server recording manager can cancel this session.');
  }
  await cancelRecording(session);
  return session.id;
}

export async function cancelRecording(guildOrSession, reason = 'Recording cancelled and discarded.') {
  const session = typeof guildOrSession === 'string' ? sessions.get(guildOrSession) : guildOrSession;
  if (!session) throw new Error('There is no active recording to cancel.');
  session.status = 'cancelled';
  clearTimeout(session.consentTimer);
  clearTimeout(session.maxDurationTimer);
  session.connection?.receiver?.speaking?.removeListener('start', session.speakingStartHandler);
  for (const userId of [...session.activeStreams.keys()]) stopSpeakerCapture(session, userId);
  await Promise.all([...session.tracks.values()].map((track) => track.writeQueue));
  for (const track of session.tracks.values()) await track.fileHandle?.close().catch(() => {});
  session.connection?.destroy();
  await removeDirectory(session.temporaryDirectory);
  sessions.delete(session.guildId);
  await updateIndicator(session, 'Recording cancelled', 'No recording audio or MP3 was retained.');
  await notifyParticipants(session, reason);
}

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const process = spawn(recordingConfig.ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let errorOutput = '';
    process.stderr.on('data', (chunk) => {
      if (errorOutput.length < 3_000) errorOutput += chunk.toString();
    });
    process.once('error', reject);
    process.once('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg exited with ${code}: ${errorOutput.slice(-800)}`));
    });
  });
}

async function padTrack(session, track, durationMs) {
  await track.writeQueue;
  if (track.fileHandle) {
    const targetBytes = Math.round(durationMs * pcmBytesPerMs);
    if (targetBytes > track.bytesWritten) {
      const paddingBytes = targetBytes - track.bytesWritten;
      if (session.temporaryBytes + paddingBytes > recordingConfig.maxTemporaryStorageBytes) {
        throw new Error('Recording reached its configured temporary storage limit.');
      }
      session.temporaryBytes += paddingBytes;
      await writeZeros(track.fileHandle, track.bytesWritten, paddingBytes);
      track.bytesWritten = targetBytes;
    }
    await track.fileHandle.close();
    track.fileHandle = null;
  }
}

async function convertTracks(session, recordDirectory, durationMs) {
  const exportedTracks = [];
  for (const track of session.tracks.values()) {
    await padTrack(session, track, durationMs);
    if (track.audioBytes === 0) continue;
    const outputPath = path.join(recordDirectory, `speaker-${track.userId}.mp3`);
    await runFfmpeg([
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 's16le', '-ar', String(recordingConfig.sampleRate), '-ac', '2', '-i', track.pcmPath,
      '-codec:a', 'libmp3lame', '-b:a', recordingConfig.bitrate,
      '-ar', String(recordingConfig.sampleRate), '-write_xing', '0', outputPath,
    ]);
    await chmod(outputPath, 0o600);
    const participant = session.participants.get(track.userId);
    exportedTracks.push({
      userId: track.userId,
      username: participant?.username || 'Unknown participant',
      fileName: path.basename(outputPath),
      size: (await stat(outputPath)).size,
      speechDurationMs: track.audioBytes / (recordingConfig.sampleRate * 4) * 1_000,
    });
  }

  if (!exportedTracks.length) throw new Error('No consented participant audio was captured; no MP3 can be saved.');
  const combinedPath = path.join(recordDirectory, 'combined.mp3');
  const inputArgs = exportedTracks.flatMap((track) => ['-i', path.join(recordDirectory, track.fileName)]);
  const mixFilter = exportedTracks.length === 1
    ? '[0:a]alimiter=limit=0.95[mixed]'
    : `${exportedTracks.map((_, index) => `[${index}:a]`).join('')}amix=inputs=${exportedTracks.length}:duration=longest:normalize=0,alimiter=limit=0.95[mixed]`;
  await runFfmpeg([
    '-hide_banner', '-loglevel', 'error', '-y',
    ...inputArgs,
    '-filter_complex', mixFilter,
    '-map', '[mixed]', '-codec:a', 'libmp3lame', '-b:a', recordingConfig.bitrate,
    '-ar', String(recordingConfig.sampleRate), '-write_xing', '0', combinedPath,
  ]);
  await chmod(combinedPath, 0o600);
  return { exportedTracks, combinedPath };
}

function createReportEmbed(record) {
  const participants = record.participants
    .map((participant) => `<@${participant.userId}>`)
    .slice(0, 20)
    .join('\n') || 'No participants';
  const speakers = record.tracks
    .map((track) => `<@${track.userId}>`)
    .slice(0, 20)
    .join('\n') || 'No identified speakers';
  const consentHistory = record.consentEvents
    .slice(-12)
    .map((event) => `${event.username}: ${event.status} at ${bdt(event.at)}`)
    .join('\n') || 'No consent events';
  const pauseHistory = record.pauseEvents
    .map((event) => `${event.type} at ${bdt(event.at)}`)
    .slice(0, 12)
    .join('\n') || 'No pause or resume events';
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(record.title.slice(0, 256))
    .setDescription(`Recording ID: **${record.id}**\nServer: **${record.guildName}**\nVoice channel: **${record.voiceChannelName}**\nRecorder: **${record.recorderName}**`)
    .addFields(
      { name: 'Started (BDT)', value: bdt(record.startedAt), inline: true },
      { name: 'Ended (BDT)', value: bdt(record.endedAt), inline: true },
      { name: 'Duration', value: displayDuration(record.durationMs), inline: true },
      { name: 'Audio metadata', value: `MP3 • ${record.bitrate} • ${record.sampleRate} Hz\nCombined file: ${record.fileSize} bytes\nParticipants: ${record.participants.length}\nIdentified speakers: ${record.speakerCount}`, inline: false },
      { name: 'Individual tracks', value: record.tracks.map((track) => `${track.username}: ${track.size} bytes`).join('\n').slice(0, 1_024) || 'No individual tracks', inline: false },
      { name: 'Who was present', value: participants.slice(0, 1_024), inline: false },
      { name: 'Who spoke', value: speakers.slice(0, 1_024), inline: false },
      { name: 'Delivery and backup', value: `Backup: ${record.backupStatus}\nStorage: private local files`, inline: false },
    )
    .setThumbnail(record.guildIconURL || null)
    .setAuthor({
      name: record.recorderName.slice(0, 256),
      ...(record.recorderAvatarURL ? { iconURL: record.recorderAvatarURL } : {}),
    })
    .setFooter({
      text: 'ASTRION',
      ...(record.botAvatarURL ? { iconURL: record.botAvatarURL } : {}),
    });
}

function recordFilePath(record, fileName) {
  if (!/^[A-Za-z0-9._-]+$/.test(fileName) || fileName.includes('..')) throw new Error('Invalid recording file reference.');
  return path.join(storageRoot(), record.guildId, record.id, fileName);
}

async function deliverRecording(record, client) {
  const embed = createReportEmbed(record);
  const combinedPath = recordFilePath(record, record.combinedFile);
  const combinedStat = await stat(combinedPath);
  const combinedFits = combinedStat.size <= recordingConfig.maxUploadBytes;
  let dmChannelId = null;
  let dmMessageId = null;
  let dmStatus = 'failed';

  try {
    const dmChannel = await (await client.users.fetch(record.recorderId)).createDM();
    dmChannelId = dmChannel.id;
    const dmMessage = await dmChannel.send({
      content: combinedFits
        ? `Your recording **${record.id}** is ready. Duration: ${displayDuration(record.durationMs)}. File size: ${combinedStat.size} bytes.`
        : `Your recording **${record.id}** is ready, but its ${combinedStat.size}-byte MP3 exceeds the configured Discord upload limit. It remains in private local storage; no public link was created.`,
      embeds: [embed],
      files: combinedFits ? [new AttachmentBuilder(combinedPath, { name: `${record.id}.mp3` })] : [],
      allowedMentions: { parse: [] },
    });
    dmMessageId = dmMessage.id;
    dmStatus = combinedFits ? 'delivered' : 'too-large-for-discord';
  } catch (error) {
    logger.warn('Could not deliver recording details to the recorder DM.', { recordingId: record.id, code: error?.code });
  }

  const privateChannel = await client.channels.fetch(record.privateChannelId).catch(() => null);
  const files = [];
  if (combinedFits) files.push(new AttachmentBuilder(combinedPath, { name: `${record.id}.mp3` }));
  for (const track of record.tracks) {
    if (track.size <= recordingConfig.maxUploadBytes) {
      files.push(new AttachmentBuilder(recordFilePath(record, track.fileName), { name: track.fileName }));
    }
  }
  const privateMessageIds = [];
  let privateChannelStatus = privateChannel ? 'failed' : 'channel-unavailable';
  if (privateChannel) {
    try {
      const batches = files.length ? Array.from({ length: Math.ceil(files.length / 10) }, (_, index) => files.slice(index * 10, (index + 1) * 10)) : [[]];
      for (const [index, batch] of batches.entries()) {
        const channelMessage = await privateChannel.send({
          content: `Private recording delivery for ${record.id}. Files over the configured Discord upload limit remain in local storage only.`,
          embeds: index === 0 ? [embed] : [],
          files: batch,
          allowedMentions: { parse: [] },
        });
        privateMessageIds.push(channelMessage.id);
      }
      const anyFileTooLarge = !combinedFits || record.tracks.some((track) => track.size > recordingConfig.maxUploadBytes);
      privateChannelStatus = anyFileTooLarge ? 'partial-oversize-local' : 'delivered';
    } catch (error) {
      privateChannelStatus = 'failed';
      logger.warn('Could not deliver recording to the private server channel.', { recordingId: record.id, code: error?.code });
    }
  }
  return {
    dmChannelId,
    dmMessageId,
    privateMessageId: privateMessageIds[0] || null,
    privateMessageIds,
    dmStatus,
    privateChannelStatus,
    deliveryStatus: `DM: ${dmStatus}; admin channel: ${privateChannelStatus}`,
  };
}

async function persistCompletedRecording(session, reason) {
  const endedAt = Date.now();
  const durationMs = activeElapsedMs(session);
  const recordDirectory = path.join(storageRoot(), session.guildId, session.id);
  const backupDirectory = path.join(storageRoot(), 'backups', session.guildId, session.id);
  await ensureSecureDirectory(recordDirectory);
  await ensureSecureDirectory(backupDirectory);

  const { exportedTracks, combinedPath } = await convertTracks(session, recordDirectory, durationMs);
  const combinedSize = (await stat(combinedPath)).size;
  if (!combinedSize || combinedSize > 2 * 1024 * 1024 * 1024) {
    throw new Error('The combined MP3 failed file-size validation.');
  }
  const trackPaths = exportedTracks.map((track) => track.fileName);
  const allFiles = ['combined.mp3', ...trackPaths];
  let backupStatus = 'failed';
  try {
    for (const fileName of allFiles) {
      const source = path.join(recordDirectory, fileName);
      const destination = path.join(backupDirectory, fileName);
      await copyFile(source, destination);
      await chmod(destination, 0o600);
    }
    backupStatus = 'local-copy-complete';
  } catch (error) {
    logger.error('Local recording backup failed; the original files were retained.', {
      recordingId: session.id,
      code: error?.code,
    });
  }

  const participants = [...session.participants.values()].map((participant) => ({
    userId: participant.userId,
    username: participant.username,
    displayName: participant.displayName,
    consentStatus: participant.consentStatus,
    joinedAt: participant.joinedAt,
    leftAt: participant.leftAt,
    joinLeaveEvents: participant.joinLeaveEvents,
  }));
  const record = {
    id: session.id,
    guildId: session.guildId,
    guildName: session.guildName,
    voiceChannelId: session.voiceChannelId,
    voiceChannelName: session.voiceChannelName,
    recorderId: session.recorderId,
    recorderName: session.recorderName,
    title: session.title,
    startedAt: session.startedAt,
    endedAt,
    durationMs,
    status: 'completed',
    stopReason: reason,
    sampleRate: recordingConfig.sampleRate,
    bitrate: recordingConfig.bitrate,
    fileSize: combinedSize,
    combinedFile: 'combined.mp3',
    tracks: exportedTracks,
    speakerCount: exportedTracks.length,
    participants,
    consentEvents: session.consentEvents,
    pauseEvents: session.pauseEvents,
    privateChannelId: session.privateChannelId,
    backupStatus,
    deliveryStatus: 'pending',
    privateChannelStatus: 'pending',
    dmStatus: 'pending',
    privateMessageId: null,
    privateMessageIds: [],
    dmChannelId: null,
    dmMessageId: null,
  };
  recordsById.set(record.id, record);
  await persistRecords();
  try {
    Object.assign(record, await deliverRecording(record, session.client));
  } catch (error) {
    record.deliveryStatus = 'failed';
    logger.error('Recording delivery failed; local files remain available.', { recordingId: record.id, code: error?.code });
  }
  await persistRecords();
  await updateIndicator(session, 'Recording ended', `Recording completed: ${session.id}. Private delivery status: ${record.deliveryStatus}.`);
  await notifyParticipants(session, `Recording ${session.id} has ended. No further voice audio will be captured.`);
  return record;
}

export async function finishRecording(sessionOrGuildId, reason = 'saved') {
  const session = typeof sessionOrGuildId === 'string' ? sessions.get(sessionOrGuildId) : sessionOrGuildId;
  if (!session || ['finalizing', 'saved', 'cancelled', 'failed'].includes(session.status)) {
    throw new Error('There is no active recording to save.');
  }
  if (session.status === 'awaiting-consent') {
    throw new Error('The consent window is still open. Recording cannot be saved before it starts.');
  }
  session.status = 'finalizing';
  clearTimeout(session.consentTimer);
  clearTimeout(session.maxDurationTimer);
  session.connection?.receiver?.speaking?.removeListener('start', session.speakingStartHandler);
  for (const userId of [...session.activeStreams.keys()]) stopSpeakerCapture(session, userId);
  await Promise.all([...session.tracks.values()].map((track) => track.writeQueue));
  session.connection?.destroy();
  try {
    if (session.captureError) throw session.captureError;
    const record = await persistCompletedRecording(session, reason);
    session.status = 'saved';
    sessions.delete(session.guildId);
    await removeDirectory(session.temporaryDirectory);
    return record;
  } catch (error) {
    session.status = 'failed';
    sessions.delete(session.guildId);
    for (const track of session.tracks.values()) await track.fileHandle?.close().catch(() => {});
    await updateIndicator(session, 'Recording could not be finalized', 'Temporary audio was retained locally for diagnosis; it was not delivered.');
    throw error;
  }
}

export async function saveRecording(guildId, userId, memberPermissions) {
  const session = sessions.get(guildId);
  if (!session) throw new Error('There is no active recording to save.');
  if (session.recorderId !== userId && !hasRecordingManagerPermission(memberPermissions || session.client.guilds.cache.get(guildId)?.members.cache.get(userId))) {
    throw new Error('Only the recorder or a server recording manager can save this session.');
  }
  return finishRecording(session, 'saved-by-command');
}

export async function handleVoiceStateUpdate(client, oldState, newState) {
  const session = sessions.get(newState.guild.id || oldState.guild.id);
  if (!session || session.status === 'finalizing') return;
  const member = newState.member || oldState.member;
  if (!member || member.user.bot) return;

  if (oldState.channelId === session.voiceChannelId && newState.channelId !== session.voiceChannelId) {
    const participant = session.participants.get(member.id);
    if (participant && !participant.leftAt) {
      participant.leftAt = Date.now();
      participant.joinLeaveEvents.push({ type: 'leave', at: participant.leftAt });
      if (participant.consentStatus === 'accepted') {
        participant.consentStatus = 'pending';
        session.consentEvents.push({ userId: member.id, username: participant.username, status: 'left-channel', at: participant.leftAt });
      }
      stopSpeakerCapture(session, member.id);
    }
    const remaining = session.client.guilds.cache.get(session.guildId)?.channels.cache
      .get(session.voiceChannelId)?.members;
    if (!remaining || remaining.filter((voiceMember) => !voiceMember.user.bot).size === 0) {
      if (session.status === 'awaiting-consent') await cancelRecording(session, 'The voice channel became empty. The recording was discarded.');
      else await finishRecording(session, 'voice-channel-empty');
    }
    return;
  }

  if (newState.channelId === session.voiceChannelId && oldState.channelId !== session.voiceChannelId) {
    await promptParticipant(session, member);
    await notifyParticipants(session, `${member.displayName} joined the recorded voice channel and must consent before any audio is captured.`);
  }
}

export async function handleRecordingControl(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith('rec_delete:')) return false;
  const [, action, recordingId, userId] = interaction.customId.split(':');
  if (interaction.user.id !== userId) {
    await interaction.reply({ content: 'This confirmation belongs to another user.', ephemeral: true });
    return true;
  }
  const record = recordsById.get(recordingId);
  if (!record) {
    await interaction.update({ content: 'This recording no longer exists.', embeds: [], components: [] });
    return true;
  }
  if (action === 'keep') {
    await interaction.update({ content: 'Recording deletion cancelled.', embeds: [], components: [] });
    return true;
  }
  if (action !== 'delete') {
    await interaction.reply({ content: 'This deletion control is invalid.', ephemeral: true });
    return true;
  }
  if (!hasRecordingManagerPermission(interaction.memberPermissions)) {
    await interaction.reply({ content: 'Only server recording managers can delete a recording.', ephemeral: true });
    return true;
  }

  if (!await deleteDiscordDeliveries(record, interaction.client)) {
    await interaction.update({ content: 'A Discord-delivered copy could not be removed. Local files and history were retained so an administrator can retry.', embeds: [], components: [] });
    return true;
  }
  const filesToDelete = [record.combinedFile, ...record.tracks.map((track) => track.fileName)];
  for (const fileName of filesToDelete) {
    for (const directory of [
      path.join(storageRoot(), record.guildId, record.id),
      path.join(storageRoot(), 'backups', record.guildId, record.id),
    ]) {
      const filePath = path.join(directory, fileName);
      await unlink(filePath).catch(() => {});
    }
  }
  await removeDirectory(path.join(storageRoot(), record.guildId, record.id));
  await removeDirectory(path.join(storageRoot(), 'backups', record.guildId, record.id));
  recordsById.delete(recordingId);
  await persistRecords();
  await interaction.update({ content: `Recording ${recordingId} and its local copies were deleted. Discord-delivered copies were removed when accessible.`, embeds: [], components: [] });
  return true;
}

export async function requestRecordingDeletion(interaction, recordingId) {
  await loadRecords();
  const record = recordsById.get(recordingId);
  if (!record || record.guildId !== interaction.guildId) throw new Error('That recording ID does not exist in this server.');
  if (!hasRecordingManagerPermission(interaction.memberPermissions)) throw new Error('Only server recording managers can delete recordings.');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`rec_delete:delete:${recordingId}:${interaction.user.id}`).setLabel('Delete recording').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`rec_delete:keep:${recordingId}:${interaction.user.id}`).setLabel('Keep recording').setStyle(ButtonStyle.Secondary),
  );
  return interaction.editReply({
    content: `Confirm permanent deletion of **${record.title}** (${record.id}), including its local backup copies and Discord deliveries when accessible?`,
    components: [row],
    allowedMentions: { parse: [] },
  });
}

export async function searchRecordings(guildId, userId, filters = {}, isManager = false) {
  await loadRecords();
  const dateStart = filters.date ? Date.parse(`${filters.date}T00:00:00+06:00`) : null;
  const dateEnd = filters.date ? dateStart + 24 * 60 * 60 * 1_000 : null;
  return [...recordsById.values()]
    .filter((record) => record.guildId === guildId)
    .filter((record) => isManager || record.recorderId === userId)
    .filter((record) => !filters.id || record.id.toLowerCase().includes(filters.id.toLowerCase()))
    .filter((record) => !filters.channel || record.voiceChannelName.toLowerCase().includes(filters.channel.toLowerCase()))
    .filter((record) => !filters.date || (record.startedAt >= dateStart && record.startedAt < dateEnd))
    .sort((left, right) => right.startedAt - left.startedAt)
    .slice(0, 10);
}

export function getRecordingReport(record) {
  return createReportEmbed(record);
}

async function pruneExpiredRecords() {
  const cutoff = Date.now() - recordingConfig.retentionDays * 24 * 60 * 60 * 1_000;
  let removedExpired = false;
  for (const [recordId, record] of recordsById) {
    if (record.endedAt >= cutoff) continue;
    if (!await deleteDiscordDeliveries(record)) {
      logger.warn('Retention cleanup retained a recording because a Discord delivery could not be deleted.', { recordingId: recordId });
      continue;
    }
    await removeDirectory(path.join(storageRoot(), record.guildId, record.id));
    await removeDirectory(path.join(storageRoot(), 'backups', record.guildId, record.id));
    recordsById.delete(recordId);
    removedExpired = true;
  }
  if (removedExpired) await persistRecords();
}

export async function shutdownRecordings(client) {
  for (const session of [...sessions.values()]) {
    try {
      if (session.status === 'awaiting-consent') {
        await cancelRecording(session, 'ASTRION is shutting down before consent was complete. The recording was discarded.');
      } else {
        await finishRecording(session, 'bot-shutdown');
      }
    } catch (error) {
      logger.error('Could not safely finalize a recording during shutdown.', {
        recordingId: session.id,
        code: error?.code,
      });
    }
  }
  client.recordingSessions = sessions;
}

export async function initializeRecordings(client) {
  runtimeClient = client;
  await loadRecords();
  if (!retentionTimer) {
    retentionTimer = setInterval(() => {
      void pruneExpiredRecords().catch((error) => {
        logger.error('Recording retention cleanup failed.', { code: error?.code });
      });
    }, 24 * 60 * 60 * 1_000);
    retentionTimer.unref?.();
  }
  const workingDirectory = path.join(storageRoot(), 'working');
  try {
    const oldWork = await readdir(workingDirectory, { withFileTypes: true });
    await Promise.all(oldWork.filter((entry) => entry.isDirectory()).map((entry) =>
      removeDirectory(path.join(workingDirectory, entry.name)),
    ));
  } catch (error) {
    if (error?.code !== 'ENOENT') logger.warn('Could not clean interrupted recording work files.', { code: error?.code });
  }
  client.recordingSessions = sessions;
}
