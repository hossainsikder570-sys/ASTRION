import { MessageFlags } from 'discord.js';
import { buildUserErrorEmbed } from './embeds.js';
import { logger } from './logger.js';

export const ErrorTypes = Object.freeze({
  VALIDATION: 'validation',
  PERMISSION: 'permission',
  CONFIGURATION: 'configuration',
  NETWORK: 'network',
  DISCORD_API: 'discord_api',
  USER_INPUT: 'user_input',
  UNKNOWN: 'unknown',
});

export class TitanBotError extends Error {
  constructor(message, type = ErrorTypes.UNKNOWN, userMessage = null, context = {}) {
    super(message);
    this.name = 'TitanBotError';
    this.type = type;
    this.userMessage = userMessage;
    this.context = context;
  }
}

export function createError(message, type, userMessage, context = {}) {
  return new TitanBotError(message, type, userMessage, context);
}

export async function replyUserError(interaction, { type = ErrorTypes.UNKNOWN, message = '' } = {}) {
  if (!interaction || interaction.isRepliable?.() === false) return null;

  const payload = { embeds: [buildUserErrorEmbed(type, message)] };
  try {
    if (interaction.deferred && interaction.isMessageComponent?.()) {
      return await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
    }
    if (interaction.deferred) return await interaction.editReply(payload);
    if (interaction.replied) {
      return await interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
    }
    return await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  } catch (error) {
    logger.warn('Could not send a music error response.', { code: error?.code });
    return null;
  }
}

export async function handleInteractionError(interaction, error, context = {}) {
  logger.error('Music interaction failed.', {
    command: interaction?.commandName,
    customId: interaction?.customId,
    guildId: interaction?.guildId,
    name: error?.name,
    code: error?.code,
    type: error?.type,
  });

  return replyUserError(interaction, {
    type: error?.type || ErrorTypes.UNKNOWN,
    message: error?.userMessage || 'The music request could not be completed. Please try again.',
  });
}
