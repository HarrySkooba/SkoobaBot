import { ChannelType, MessageFlags, PermissionFlagsBits, } from 'discord.js';
import { db } from '../database/db.js';
import { getSetting } from '../database/settings.js';
export const ephemeral = MessageFlags.Ephemeral;
export function privateReply(content) {
    return { content, flags: ephemeral };
}
export async function getMember(interaction) {
    if (!interaction.guild) {
        return null;
    }
    return interaction.guild.members.fetch(interaction.user.id).catch(() => null);
}
export function memberHasRole(member, roleId) {
    return Boolean(roleId && member.roles.cache.has(roleId));
}
export function isAdmin(member) {
    const adminRoleId = getSetting(member.guild.id, 'admin_role_id');
    return member.permissions.has(PermissionFlagsBits.Administrator) || memberHasRole(member, adminRoleId);
}
export function hasAdminRole(member) {
    return memberHasRole(member, getSetting(member.guild.id, 'admin_role_id'));
}
export function isStaff(member) {
    const staffRoleId = getSetting(member.guild.id, 'staff_role_id');
    return isAdmin(member) || memberHasRole(member, staffRoleId);
}
export function hasConfiguredRole(member, key) {
    return memberHasRole(member, getSetting(member.guild.id, key));
}
export async function requireAdmin(interaction) {
    const member = await getMember(interaction);
    if (!member || !isAdmin(member)) {
        await interaction.reply(privateReply('Эта команда доступна только администраторам.'));
        return null;
    }
    return member;
}
export function quoteId(id) {
    return id ? `<@&${id}>` : '`не задано`';
}
export async function getTextChannel(guild, channelId) {
    if (!channelId) {
        return null;
    }
    const channel = await guild.channels.fetch(channelId).catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText) {
        return null;
    }
    return channel;
}
export async function getConfiguredTextChannel(guild, key) {
    return getTextChannel(guild, getSetting(guild.id, key));
}
export async function sendToConfiguredChannel(guild, key, content) {
    const channel = await getConfiguredTextChannel(guild, key);
    if (channel) {
        await channel.send(content).catch(() => undefined);
    }
}
export function audit(guildId, type, details, actorId, targetId) {
    db.prepare('INSERT INTO audit_logs (guild_id, type, actor_id, target_id, details) VALUES (?, ?, ?, ?, ?)').run(guildId, type, actorId ?? null, targetId ?? null, JSON.stringify(details));
}
export async function safeDm(member, content) {
    return member.send(content).then(() => true, () => false);
}
export async function replyOrUpdate(interaction, content) {
    if (interaction.replied || interaction.deferred) {
        await interaction.followUp(privateReply(content));
        return;
    }
    await interaction.reply(privateReply(content));
}
export function canSendMessages(channel) {
    return 'send' in channel;
}
