import {
  ChannelType,
  ChatInputCommandInteraction,
  Guild,
  GuildMember,
  InteractionReplyOptions,
  MessageFlags,
  PermissionFlagsBits,
  TextBasedChannel,
  TextChannel,
} from 'discord.js';
import { db } from '../database/db.js';
import { getSetting, SettingKey } from '../database/settings.js';

export const ephemeral = MessageFlags.Ephemeral;

export function privateReply(content: string): InteractionReplyOptions {
  return { content, flags: ephemeral };
}

export async function getMember(interaction: ChatInputCommandInteraction): Promise<GuildMember | null> {
  if (!interaction.guild) {
    return null;
  }

  return interaction.guild.members.fetch(interaction.user.id).catch(() => null);
}

export function memberHasRole(member: GuildMember, roleId: string | null): boolean {
  return Boolean(roleId && member.roles.cache.has(roleId));
}

export function isAdmin(member: GuildMember): boolean {
  const adminRoleId = getSetting(member.guild.id, 'admin_role_id');
  return member.permissions.has(PermissionFlagsBits.Administrator) || memberHasRole(member, adminRoleId);
}

export function isStaff(member: GuildMember): boolean {
  const staffRoleId = getSetting(member.guild.id, 'staff_role_id');
  return isAdmin(member) || memberHasRole(member, staffRoleId);
}

export function hasConfiguredRole(member: GuildMember, key: SettingKey): boolean {
  return memberHasRole(member, getSetting(member.guild.id, key));
}

export async function requireAdmin(interaction: ChatInputCommandInteraction): Promise<GuildMember | null> {
  const member = await getMember(interaction);
  if (!member || !isAdmin(member)) {
    await interaction.reply(privateReply('Эта команда доступна только администраторам.'));
    return null;
  }

  return member;
}

export function quoteId(id: string | null): string {
  return id ? `<@&${id}>` : '`не задано`';
}

export async function getTextChannel(guild: Guild, channelId: string | null): Promise<TextChannel | null> {
  if (!channelId) {
    return null;
  }

  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || channel.type !== ChannelType.GuildText) {
    return null;
  }

  return channel;
}

export async function getConfiguredTextChannel(guild: Guild, key: SettingKey): Promise<TextChannel | null> {
  return getTextChannel(guild, getSetting(guild.id, key));
}

export async function sendToConfiguredChannel(guild: Guild, key: SettingKey, content: string): Promise<void> {
  const channel = await getConfiguredTextChannel(guild, key);
  if (channel) {
    await channel.send(content).catch(() => undefined);
  }
}

export function audit(guildId: string, type: string, details: unknown, actorId?: string, targetId?: string): void {
  db.prepare(
    'INSERT INTO audit_logs (guild_id, type, actor_id, target_id, details) VALUES (?, ?, ?, ?, ?)',
  ).run(guildId, type, actorId ?? null, targetId ?? null, JSON.stringify(details));
}

export async function safeDm(member: GuildMember, content: string): Promise<boolean> {
  return member.send(content).then(
    () => true,
    () => false,
  );
}

export async function replyOrUpdate(interaction: { replied: boolean; deferred: boolean; reply: (options: InteractionReplyOptions) => Promise<unknown>; followUp: (options: InteractionReplyOptions) => Promise<unknown> }, content: string): Promise<void> {
  if (interaction.replied || interaction.deferred) {
    await interaction.followUp(privateReply(content));
    return;
  }

  await interaction.reply(privateReply(content));
}

export function canSendMessages(channel: TextBasedChannel): boolean {
  return 'send' in channel;
}
