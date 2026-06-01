import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Guild,
  OverwriteResolvable,
  PermissionsBitField,
  TextChannel,
} from 'discord.js';
import { db } from '../database/db.js';
import { getSetting, getTierCategoryId, getTierRoleId } from '../database/settings.js';
import { audit, hasAdminRole, hasConfiguredRole, isAdmin, privateReply, sendToConfiguredChannel } from '../discord/helpers.js';

export async function handleProfileCommand(interaction: ChatInputCommandInteraction): Promise<boolean> {
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
          .setDescription('Нажми кнопку, чтобы создать личный канал профиля в категории Тир 3. Нужны роли семьи и Verified.')
          .setColor(0x57f287),
      ],
      components: [
        new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder().setCustomId('profile:create').setLabel('Создать профиль').setStyle(ButtonStyle.Primary),
        ),
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
    await changeProfileTier(interaction, player.id, tier, reason ?? 'Без причины');
    return true;
  }

  if (interaction.commandName === 'profile-delete') {
    const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !hasAdminRole(member)) {
      await interaction.reply(privateReply('Удалять профили могут только участники с admin_role_id.'));
      return true;
    }

    const player = interaction.options.getUser('player', true);
    const reason = interaction.options.getString('reason');
    await deletePlayerProfile(interaction, player.id, reason ?? 'Принудительное удаление админом');
    return true;
  }

  return false;
}

export async function handleProfileButton(interaction: ButtonInteraction): Promise<boolean> {
  if (!interaction.customId.startsWith('profile:')) {
    return false;
  }

  if (!interaction.guild) {
    await interaction.reply(privateReply('Профили работают только на сервере.'));
    return true;
  }

  if (interaction.customId === 'profile:create') {
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) {
      await interaction.reply(privateReply('Не удалось получить данные участника на сервере.'));
      return true;
    }
    if (!hasConfiguredRole(member, 'family_role_id')) {
      await interaction.reply(privateReply('Профиль могут создать только участники с ролью семьи.'));
      return true;
    }
    if (!hasConfiguredRole(member, 'verified_role_id')) {
      await interaction.reply(privateReply('Профиль могут создать только участники с ролью Verified.'));
      return true;
    }

    const existing = db.prepare('SELECT channel_id FROM player_profiles WHERE guild_id = ? AND user_id = ?').get(interaction.guild.id, interaction.user.id) as { channel_id: string } | undefined;
    if (existing) {
      await interaction.reply(privateReply(`У тебя уже есть профиль: <#${existing.channel_id}>.`));
      return true;
    }

    const channel = await createProfileChannel(interaction);
    await interaction.reply(privateReply(`Профиль создан: ${channel}.`));
    return true;
  }

  const [, action, userId] = interaction.customId.split(':');
  if (action === 'promote' || action === 'demote') {
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !canPromote(member)) {
      await interaction.reply(privateReply('Менять тир могут только наставники и админы.'));
      return true;
    }

    const current = db.prepare('SELECT tier FROM player_profiles WHERE guild_id = ? AND user_id = ?').get(interaction.guild.id, userId) as { tier: number } | undefined;
    if (!current) {
      await interaction.reply(privateReply('Профиль игрока не найден.'));
      return true;
    }

    if (action === 'promote') {
      if (current.tier <= 1) {
        await interaction.reply(privateReply('Игрок уже на тире 1 (максимальный).'));
        return true;
      }
      await changeProfileTier(interaction, userId, current.tier - 1, 'Повышение через кнопку профиля');
      return true;
    }

    if (current.tier >= 3) {
      await interaction.reply(privateReply('Игрок уже на тире 3 (минимальный).'));
      return true;
    }
    await changeProfileTier(interaction, userId, current.tier + 1, 'Понижение через кнопку профиля');
    return true;
  }

  return true;
}

function canPromote(member: import('discord.js').GuildMember): boolean {
  return isAdmin(member) || hasConfiguredRole(member, 'mentor_role_id');
}

function buildProfileControlButtons(ownerUserId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`profile:promote:${ownerUserId}`).setLabel('Повысить тир').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`profile:demote:${ownerUserId}`).setLabel('Понизить тир').setStyle(ButtonStyle.Secondary),
  );
}

async function syncMemberTierRoles(guild: import('discord.js').Guild, userId: string, tier: 1 | 2 | 3): Promise<void> {
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) {
    return;
  }

  for (const tierNumber of [1, 2, 3] as const) {
    const roleId = getTierRoleId(guild.id, tierNumber);
    if (!roleId) {
      continue;
    }

    if (tierNumber === tier) {
      await member.roles.add(roleId).catch(() => undefined);
    } else {
      await member.roles.remove(roleId).catch(() => undefined);
    }
  }
}

function buildProfileChannelOverwrites(guild: Guild, ownerUserId: string): OverwriteResolvable[] {
  const viewAndHistory = [
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.ReadMessageHistory,
  ] as const;
  const mentorRoleId = getSetting(guild.id, 'mentor_role_id');
  const adminRoleId = getSetting(guild.id, 'admin_role_id');
  const overwrites: OverwriteResolvable[] = [
    { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
    {
      id: ownerUserId,
      allow: [...viewAndHistory, PermissionsBitField.Flags.SendMessages],
    },
  ];

  for (const tier of [1, 2, 3] as const) {
    const tierRoleId = getTierRoleId(guild.id, tier);
    if (tierRoleId) {
      overwrites.push({ id: tierRoleId, deny: [PermissionsBitField.Flags.ViewChannel] });
    }
  }

  if (mentorRoleId) {
    overwrites.push({ id: mentorRoleId, allow: [...viewAndHistory, PermissionsBitField.Flags.SendMessages] });
  }

  if (adminRoleId) {
    overwrites.push({
      id: adminRoleId,
      allow: [
        ...viewAndHistory,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ManageChannels,
      ],
    });
  }

  return overwrites;
}

async function applyProfileChannelPermissions(channel: TextChannel, guild: Guild, ownerUserId: string): Promise<void> {
  await channel.permissionOverwrites.set(buildProfileChannelOverwrites(guild, ownerUserId));
}

async function createProfileChannel(interaction: ButtonInteraction) {
  if (!interaction.guild) {
    throw new Error('Missing guild');
  }

  const tier = 3;
  const categoryId = getTierCategoryId(interaction.guild.id, tier);
  const channel = await interaction.guild.channels.create({
    name: `profile-${interaction.user.username}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 90),
    type: ChannelType.GuildText,
    parent: categoryId ?? undefined,
    permissionOverwrites: buildProfileChannelOverwrites(interaction.guild, interaction.user.id),
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
    components: [buildProfileControlButtons(interaction.user.id)],
  });

  const result = db.prepare('INSERT INTO player_profiles (guild_id, user_id, channel_id, tier) VALUES (?, ?, ?, ?)').run(
    interaction.guild.id,
    interaction.user.id,
    channel.id,
    tier,
  );
  await syncMemberTierRoles(interaction.guild, interaction.user.id, tier);
  audit(interaction.guild.id, 'profile.created', { profileId: Number(result.lastInsertRowid), channelId: channel.id, tier }, interaction.user.id, interaction.user.id);
  return channel;
}

async function deletePlayerProfile(interaction: ChatInputCommandInteraction, userId: string, reason: string) {
  if (!interaction.guild) {
    await interaction.reply(privateReply('Профили работают только на сервере.'));
    return;
  }

  const profile = db.prepare('SELECT id, channel_id, tier FROM player_profiles WHERE guild_id = ? AND user_id = ?').get(interaction.guild.id, userId) as
    | { id: number; channel_id: string; tier: number }
    | undefined;
  if (!profile) {
    await interaction.reply(privateReply('Профиль игрока не найден в базе.'));
    return;
  }

  const channel = await interaction.guild.channels.fetch(profile.channel_id).catch(() => null);
  let channelDeleted = false;
  if (channel?.type === ChannelType.GuildText) {
    await channel.delete(`profile-delete: ${reason}`).then(() => {
      channelDeleted = true;
    }).catch(() => undefined);
  }

  const member = await interaction.guild.members.fetch(userId).catch(() => null);
  const rolesRemoved: string[] = [];
  if (member) {
    for (const tier of [1, 2, 3] as const) {
      const roleId = getTierRoleId(interaction.guild.id, tier);
      if (!roleId || !member.roles.cache.has(roleId)) {
        continue;
      }
      await member.roles.remove(roleId).catch(() => undefined);
      if (!member.roles.cache.has(roleId)) {
        rolesRemoved.push(roleId);
      }
    }
  }

  db.prepare('DELETE FROM player_profiles WHERE id = ?').run(profile.id);
  audit(
    interaction.guild.id,
    'profile.deleted',
    { profileId: profile.id, channelId: profile.channel_id, tier: profile.tier, channelDeleted, rolesRemoved, reason },
    interaction.user.id,
    userId,
  );
  await sendToConfiguredChannel(
    interaction.guild,
    'profile_log_channel_id',
    `Профиль <@${userId}> удален админом <@${interaction.user.id}>. Тир был ${profile.tier}. Канал: ${channelDeleted ? 'удален' : 'не найден или не удален'}. Причина: ${reason}`,
  );

  const details = [
    channelDeleted ? 'канал удален' : 'канал не удален (уже удален или нет прав бота)',
    rolesRemoved.length ? 'роли тира сняты' : 'роли тира не снимались',
    'запись в БД удалена',
  ].join(', ');
  await interaction.reply(privateReply(`Профиль <@${userId}> сброшен: ${details}. Игрок снова может создать профиль через панель.`));
}

async function changeProfileTier(interaction: ChatInputCommandInteraction | ButtonInteraction, userId: string, newTier: number, reason: string) {
  if (!interaction.guild) {
    return;
  }

  if (newTier < 1 || newTier > 3) {
    await interaction.reply(privateReply('Тир должен быть от 1 до 3.'));
    return;
  }

  const profile = db.prepare('SELECT id, channel_id, tier FROM player_profiles WHERE guild_id = ? AND user_id = ?').get(interaction.guild.id, userId) as
    | { id: number; channel_id: string; tier: number }
    | undefined;
  if (!profile) {
    await interaction.reply(privateReply('Профиль игрока не найден.'));
    return;
  }

  if (profile.tier === newTier) {
    await interaction.reply(privateReply(`У игрока уже тир ${newTier}.`));
    return;
  }

  const oldTier = profile.tier;
  const channel = await interaction.guild.channels.fetch(profile.channel_id).catch(() => null);
  const categoryId = getTierCategoryId(interaction.guild.id, newTier as 1 | 2 | 3);
  if (channel?.type === ChannelType.GuildText) {
    if (categoryId) {
      await channel.setParent(categoryId, { lockPermissions: false }).catch(() => undefined);
    }
    await applyProfileChannelPermissions(channel, interaction.guild, userId).catch(() => undefined);
  }

  await syncMemberTierRoles(interaction.guild, userId, newTier as 1 | 2 | 3);

  db.prepare('UPDATE player_profiles SET tier = ?, updated_at = unixepoch() WHERE id = ?').run(newTier, profile.id);
  db.prepare('INSERT INTO profile_tier_changes (profile_id, mentor_id, old_tier, new_tier, reason) VALUES (?, ?, ?, ?, ?)').run(
    profile.id,
    interaction.user.id,
    oldTier,
    newTier,
    reason,
  );
  audit(interaction.guild.id, 'profile.tier_changed', { profileId: profile.id, oldTier, newTier, reason }, interaction.user.id, userId);
  await sendToConfiguredChannel(interaction.guild, 'profile_log_channel_id', `Профиль <@${userId}>: тир ${oldTier} -> ${newTier}, наставник <@${interaction.user.id}>. Причина: ${reason}`);
  await interaction.reply(privateReply(`Тир игрока <@${userId}> изменен: ${oldTier} -> ${newTier}.`));
}
