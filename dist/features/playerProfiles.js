import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, PermissionsBitField, } from 'discord.js';
import { db } from '../database/db.js';
import { getSetting, getTierCategoryId, getTierRoleId } from '../database/settings.js';
import { audit, hasAdminRole, hasConfiguredRole, isAdmin, privateReply, sendToConfiguredChannel } from '../discord/helpers.js';
export async function handleProfileCommand(interaction) {
    if (interaction.commandName === 'profile-panel') {
        const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
        if (!member || !isAdmin(member)) {
            await interaction.reply(privateReply('Панель профилей может публиковать только админ.'));
            return true;
        }
        if (!interaction.channel || !('send' in interaction.channel)) {
            await interaction.reply(privateReply('Не найден текстовый канал для публикации панели.'));
            return true;
        }
        await interaction.channel.send({
            embeds: [
                new EmbedBuilder()
                    .setTitle('Личный профиль игрока')
                    .setDescription('Нажми кнопку, чтобы создать личный канал профиля в категории Тир 3.')
                    .setColor(0x57f287),
            ],
            components: [
                new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('profile:create').setLabel('Создать профиль').setStyle(ButtonStyle.Primary)),
            ],
        });
        await interaction.reply(privateReply('Панель профилей опубликована.'));
        return true;
    }
    if (interaction.commandName === 'profile-promote') {
        const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
        if (!member || !hasAdminRole(member)) {
            await interaction.reply(privateReply('Повышать тир через команду могут только участники с admin_role_id.'));
            return true;
        }
        const player = interaction.options.getUser('player', true);
        const tier = interaction.options.getInteger('tier', true);
        const reason = interaction.options.getString('reason');
        await promoteProfile(interaction, player.id, tier, reason ?? 'Без причины');
        return true;
    }
    return false;
}
export async function handleProfileButton(interaction) {
    if (!interaction.customId.startsWith('profile:')) {
        return false;
    }
    if (!interaction.guild) {
        await interaction.reply(privateReply('Профили работают только на сервере.'));
        return true;
    }
    if (interaction.customId === 'profile:create') {
        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (!member || !hasConfiguredRole(member, 'family_role_id')) {
            await interaction.reply(privateReply('Профиль могут создать только участники с ролью семьи.'));
            return true;
        }
        const existing = db.prepare('SELECT channel_id FROM player_profiles WHERE guild_id = ? AND user_id = ?').get(interaction.guild.id, interaction.user.id);
        if (existing) {
            await interaction.reply(privateReply(`У тебя уже есть профиль: <#${existing.channel_id}>.`));
            return true;
        }
        const channel = await createProfileChannel(interaction);
        await interaction.reply(privateReply(`Профиль создан: ${channel}.`));
        return true;
    }
    const [, action, userId] = interaction.customId.split(':');
    if (action === 'promote') {
        const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
        if (!member || !canPromote(member)) {
            await interaction.reply(privateReply('Повышать тир могут только наставники и админы.'));
            return true;
        }
        const current = db.prepare('SELECT tier FROM player_profiles WHERE guild_id = ? AND user_id = ?').get(interaction.guild.id, userId);
        const nextTier = current ? Math.max(1, current.tier - 1) : 3;
        await promoteProfile(interaction, userId, nextTier, 'Повышение через кнопку профиля');
        return true;
    }
    return true;
}
function canPromote(member) {
    return isAdmin(member) || hasConfiguredRole(member, 'mentor_role_id');
}
async function createProfileChannel(interaction) {
    if (!interaction.guild) {
        throw new Error('Missing guild');
    }
    const tier = 3;
    const categoryId = getTierCategoryId(interaction.guild.id, tier);
    const mentorRoleId = getSetting(interaction.guild.id, 'mentor_role_id');
    const adminRoleId = getSetting(interaction.guild.id, 'admin_role_id');
    const channel = await interaction.guild.channels.create({
        name: `profile-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 90),
        type: ChannelType.GuildText,
        parent: categoryId ?? undefined,
        permissionOverwrites: [
            { id: interaction.guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            { id: interaction.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] },
            ...(mentorRoleId ? [{ id: mentorRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }] : []),
            ...(adminRoleId ? [{ id: adminRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory, PermissionsBitField.Flags.ManageChannels] }] : []),
        ],
    });
    for (const name of ['отчет капт', 'отчет мцл', 'отчет рп']) {
        await channel.threads.create({ name, autoArchiveDuration: 10080 }).catch(() => undefined);
    }
    await channel.send({
        content: `<@${interaction.user.id}>`,
        embeds: [
            new EmbedBuilder()
                .setTitle('Личный профиль')
                .setDescription('Здесь игрок общается с наставниками и отправляет достижения в ветки отчетов.')
                .setColor(0x57f287),
        ],
        components: [
            new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`profile:promote:${interaction.user.id}`).setLabel('Повысить тир').setStyle(ButtonStyle.Success)),
        ],
    });
    const result = db.prepare('INSERT INTO player_profiles (guild_id, user_id, channel_id, tier) VALUES (?, ?, ?, ?)').run(interaction.guild.id, interaction.user.id, channel.id, tier);
    audit(interaction.guild.id, 'profile.created', { profileId: Number(result.lastInsertRowid), channelId: channel.id }, interaction.user.id, interaction.user.id);
    return channel;
}
async function promoteProfile(interaction, userId, newTier, reason) {
    if (!interaction.guild) {
        return;
    }
    const profile = db.prepare('SELECT id, channel_id, tier FROM player_profiles WHERE guild_id = ? AND user_id = ?').get(interaction.guild.id, userId);
    if (!profile) {
        await interaction.reply(privateReply('Профиль игрока не найден.'));
        return;
    }
    const oldTier = profile.tier;
    const channel = await interaction.guild.channels.fetch(profile.channel_id).catch(() => null);
    const categoryId = getTierCategoryId(interaction.guild.id, newTier);
    if (channel?.type === ChannelType.GuildText && categoryId) {
        await channel.setParent(categoryId).catch(() => undefined);
    }
    const member = await interaction.guild.members.fetch(userId).catch(() => null);
    if (member) {
        for (const tier of [1, 2, 3]) {
            const roleId = getTierRoleId(interaction.guild.id, tier);
            if (!roleId) {
                continue;
            }
            if (tier === newTier) {
                await member.roles.add(roleId).catch(() => undefined);
            }
            else {
                await member.roles.remove(roleId).catch(() => undefined);
            }
        }
    }
    db.prepare('UPDATE player_profiles SET tier = ?, updated_at = unixepoch() WHERE id = ?').run(newTier, profile.id);
    db.prepare('INSERT INTO profile_tier_changes (profile_id, mentor_id, old_tier, new_tier, reason) VALUES (?, ?, ?, ?, ?)').run(profile.id, interaction.user.id, oldTier, newTier, reason);
    audit(interaction.guild.id, 'profile.tier_changed', { profileId: profile.id, oldTier, newTier, reason }, interaction.user.id, userId);
    await sendToConfiguredChannel(interaction.guild, 'profile_log_channel_id', `Профиль <@${userId}>: тир ${oldTier} -> ${newTier}, наставник <@${interaction.user.id}>. Причина: ${reason}`);
    await interaction.reply(privateReply(`Тир игрока <@${userId}> изменен: ${oldTier} -> ${newTier}.`));
}
