import { MessageFlags } from 'discord.js';
import { logger } from './logger.js';

export class InteractionHelper {
  static async safeDefer(interaction, options = { flags: MessageFlags.Ephemeral }) {
    if (!interaction || interaction.deferred || interaction.replied) return false;
    try {
      await interaction.deferReply(options);
      return true;
    } catch (error) {
      logger.warn('Could not defer Discord interaction.', { code: error?.code });
      return false;
    }
  }

  static async safeReply(interaction, options = {}) {
    if (!interaction) return null;
    try {
      const { flags, ephemeral, ...editableOptions } = options;
      if (interaction.deferred) return await interaction.editReply(editableOptions);
      if (interaction.replied) return await interaction.followUp(options);
      return await interaction.reply(options);
    } catch (error) {
      logger.warn('Could not send Discord interaction response.', { code: error?.code });
      return null;
    }
  }

  static async safeEditReply(interaction, options = {}) {
    if (!interaction) return null;
    try {
      return await interaction.editReply(options);
    } catch (error) {
      logger.warn('Could not update Discord interaction response.', { code: error?.code });
      return null;
    }
  }
}
