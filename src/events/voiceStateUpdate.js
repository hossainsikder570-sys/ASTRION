import { Events } from 'discord.js';
import { handleMusicVoiceState } from '../services/music/musicVoiceState.js';
import { handleVoiceStateUpdate as handleRecordingVoiceState } from '../services/recording/recordingManager.js';
import { logger } from '../utils/logger.js';

export default {
  name: Events.VoiceStateUpdate,
  async execute(oldState, newState, client) {
    try {
      await handleMusicVoiceState(client, oldState, newState);
    } catch (error) {
      logger.error('Music voice-state update failed.', {
        guildId: newState.guild?.id || oldState.guild?.id,
        name: error?.name,
        code: error?.code,
      });
    }
    try {
      await handleRecordingVoiceState(client, oldState, newState);
    } catch (error) {
      logger.error('Recording voice-state update failed.', {
        guildId: newState.guild?.id || oldState.guild?.id,
        name: error?.name,
        code: error?.code,
      });
    }
  },
};
