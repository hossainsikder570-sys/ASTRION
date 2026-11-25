import { MessageFlags, PermissionsBitField } from 'discord.js';

export async function runEphemeralCommand(interaction, operation) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const result = await operation();
    if (result !== null) await interaction.editReply({ content: result || 'Done.' });
  } catch (error) {
    await interaction.editReply({
      content: error?.message || 'The recording command could not be completed.',
      allowedMentions: { parse: [] },
    }).catch(() => {});
  }
}

export function isRecordingManager(memberOrPermissions) {
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
