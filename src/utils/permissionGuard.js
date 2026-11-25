export function botHasPermission(channel, permissions) {
  if (!channel?.guild) return false;
  const botMember = channel.guild.members.me;
  return Boolean(botMember && channel.permissionsFor(botMember)?.has(permissions));
}
