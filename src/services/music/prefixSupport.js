import { MessageFlags } from 'discord.js';
import { InteractionHelper } from '../../utils/interactionHelper.js';

export async function deferMusicCommand(interaction) {
  return InteractionHelper.safeDefer(interaction, { flags: MessageFlags.Ephemeral });
}
