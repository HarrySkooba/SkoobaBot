import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  EmbedBuilder,
  Guild,
  GuildMember,
  TextChannel,
} from 'discord.js';
import { db } from '../database/db.js';
import { getSetting } from '../database/settings.js';
import { audit, getConfiguredTextChannel, hasConfiguredRole, isStaff, privateReply, safeDm, sendToConfiguredChannel } from '../discord/helpers.js';

type EventRow = {
  id: number;
  guild_id: string;
  type: 'kapt' | 'mcl';
  start_time: string;
  voice_time: string;
  side: string;
  map: string;
  voice_channel_id: string | null;
  message_channel_id: string | null;
  message_id: string | null;
  created_by: string;
  reminders_sent: string;
};

export async function handleEventCommand(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (interaction.commandName === 'event-create') {
    const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !isStaff(member)) {
      await interaction.reply(privateReply('Создавать мероприятия может только стафф.'));
      return true;
    }

    if (!interaction.guild) {
      await interaction.reply(privateReply('Мероприятия работают только на сервере.'));
      return true;
    }

    const type = interaction.options.getString('type', true) as 'kapt' | 'mcl';
    const startTime = interaction.options.getString('start_time', true);
    const voiceTime = interaction.options.getString('voice_time', true);
    const side = interaction.options.getString('side', true);
    const map = interaction.options.getString('map', true);
    const voiceChannel = interaction.options.getChannel('voice');
    const result = db
      .prepare(
        `INSERT INTO events (guild_id, type, start_time, voice_time, side, map, voice_channel_id, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(interaction.guild.id, type, startTime, voiceTime, side, map, voiceChannel?.id ?? getSetting(interaction.guild.id, 'default_voice_channel_id'), interaction.user.id);
    const eventId = Number(result.lastInsertRowid);
    const channel = (await getConfiguredTextChannel(interaction.guild, 'event_channel_id')) ?? (interaction.channel as TextChannel | null);
    if (!channel) {
      await interaction.reply(privateReply('Не найден канал для публикации мероприятия.'));
      return true;
    }

    const message = await channel.send(await renderEventMessage(eventId, interaction.guild));
    db.prepare('UPDATE events SET message_channel_id = ?, message_id = ? WHERE id = ?').run(channel.id, message.id, eventId);
    await dmFamilyAboutEvent(interaction.guild, eventId);
    audit(interaction.guild.id, 'event.created', { eventId, type, startTime, voiceTime, side, map }, interaction.user.id);
    await interaction.reply(privateReply(`Мероприятие #${eventId} создано: ${message.url}`));
    return true;
  }

  if (interaction.commandName === 'attendance') {
    const player = interaction.options.getUser('player', true);
    const rows = db
      .prepare(
        `SELECT COUNT(*) AS total,
          SUM(CASE WHEN was_present = 0 THEN 1 ELSE 0 END) AS misses
         FROM event_attendance
         WHERE user_id = ?`,
      )
      .get(player.id) as { total: number; misses: number | null };
    await interaction.reply(privateReply(`<@${player.id}>: проверок ${rows.total}, неявок ${rows.misses ?? 0}.`));
    return true;
  }

  return false;
}

export async function handleEventButton(interaction: ButtonInteraction): Promise<boolean> {
  if (!interaction.customId.startsWith('event:')) {
    return false;
  }

  if (!interaction.guild) {
    await interaction.reply(privateReply('Мероприятия работают только на сервере.'));
    return true;
  }

  const [, action, id] = interaction.customId.split(':');
  const eventId = Number(id);
  const event = getEvent(eventId, interaction.guild.id);
  if (!event) {
    await interaction.reply(privateReply('Мероприятие не найдено.'));
    return true;
  }

  if (action === 'signup') {
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) {
      await interaction.reply(privateReply('Не удалось получить участника.'));
      return true;
    }

    const placement = resolvePlacement(member, event.type);
    db.prepare(
      `INSERT INTO event_signups (event_id, user_id, list_type, tier)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(event_id, user_id) DO UPDATE SET list_type = excluded.list_type, tier = excluded.tier`,
    ).run(eventId, interaction.user.id, placement.listType, placement.tier);
    await refreshEventMessage(interaction.guild, eventId);
    await interaction.reply(privateReply(`Ты записан в ${placement.listType === 'main' ? `основной список, тир ${placement.tier}` : 'запасной список'}.`));
    return true;
  }

  if (action === 'leave') {
    db.prepare('DELETE FROM event_signups WHERE event_id = ? AND user_id = ?').run(eventId, interaction.user.id);
    await refreshEventMessage(interaction.guild, eventId);
    await interaction.reply(privateReply('Ты удален из списка.'));
    return true;
  }

  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member || !isStaff(member)) {
    await interaction.reply(privateReply('Управлять событием может только стафф.'));
    return true;
  }

  if (action === 'notify-main' || action === 'notify-reserve') {
    await notifyList(interaction, eventId, action === 'notify-main' ? 'main' : 'reserve');
    return true;
  }

  if (action === 'voice-check') {
    await voiceCheck(interaction, event);
    return true;
  }

  if (action === 'export') {
    await interaction.reply(privateReply(formatExport(eventId)));
    return true;
  }

  return true;
}

export function startReminderScheduler(client: Client): void {
  setInterval(() => {
    void runReminderTick(client);
  }, 60_000);
}

async function runReminderTick(client: Client): Promise<void> {
  const events = db
    .prepare("SELECT * FROM events WHERE unixepoch() - created_at < 604800")
    .all() as EventRow[];
  const offsets = [30, 15, 5];
  const now = Date.now();

  for (const event of events) {
    const voiceAt = parseDateTime(event.voice_time);
    if (!voiceAt) {
      continue;
    }

    const sent = JSON.parse(event.reminders_sent) as number[];
    for (const offset of offsets) {
      const shouldSend = voiceAt.getTime() - now <= offset * 60_000 && voiceAt.getTime() - now > (offset - 1) * 60_000;
      if (!shouldSend || sent.includes(offset)) {
        continue;
      }

      const guild = await client.guilds.fetch(event.guild_id).catch(() => null);
      if (!guild) {
        continue;
      }

      await dmEventSignups(guild, event.id, `Напоминание: через ${offset} минут нужно быть в войсе для ${event.type.toUpperCase()} на карте ${event.map}.`);
      sent.push(offset);
      db.prepare('UPDATE events SET reminders_sent = ? WHERE id = ?').run(JSON.stringify(sent), event.id);
    }
  }
}

function getEvent(eventId: number, guildId: string): EventRow | null {
  return (db.prepare('SELECT * FROM events WHERE id = ? AND guild_id = ?').get(eventId, guildId) as EventRow | undefined) ?? null;
}

function resolvePlacement(member: GuildMember, eventType: 'kapt' | 'mcl'): { listType: 'main' | 'reserve'; tier: number | null } {
  const hasVerified = hasConfiguredRole(member, 'verified_role_id');
  const prefix = eventType === 'kapt' ? 'kapt' : 'mcl';

  for (const tier of [1, 2, 3]) {
    const roleId = getSetting(member.guild.id, `${prefix}_tier_${tier}_role_id` as 'kapt_tier_1_role_id');
    if (hasVerified && roleId && member.roles.cache.has(roleId)) {
      return { listType: 'main', tier };
    }
  }

  return { listType: 'reserve', tier: null };
}

async function renderEventMessage(eventId: number, guild: Guild) {
  const event = getEvent(eventId, guild.id);
  if (!event) {
    throw new Error(`Event ${eventId} not found`);
  }

  const lists = getEventLists(eventId);
  const embed = new EmbedBuilder()
    .setTitle(`${event.type === 'kapt' ? 'Капт' : 'МЦЛ'} #${event.id}`)
    .setDescription(`Сторона: **${event.side}**\nКарта: **${event.map}**\nНачало: **${event.start_time}**\nЗайти в войс: **${event.voice_time}**`)
    .addFields(
      { name: 'Основной Тир 1', value: formatUsers(lists.main1), inline: true },
      { name: 'Основной Тир 2', value: formatUsers(lists.main2), inline: true },
      { name: 'Основной Тир 3', value: formatUsers(lists.main3), inline: true },
      { name: 'Запасной', value: formatUsers(lists.reserve), inline: false },
    )
    .setColor(event.type === 'kapt' ? 0xed4245 : 0x5865f2);

  const components = [
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`event:signup:${eventId}`).setLabel('Записаться').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`event:leave:${eventId}`).setLabel('Отписаться').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`event:export:${eventId}`).setLabel('Экспорт').setStyle(ButtonStyle.Secondary),
    ),
    new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder().setCustomId(`event:notify-main:${eventId}`).setLabel('Уведомить основной').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`event:notify-reserve:${eventId}`).setLabel('Уведомить запас').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`event:voice-check:${eventId}`).setLabel('Проверить войс').setStyle(ButtonStyle.Danger),
    ),
  ];

  return { embeds: [embed], components };
}

function getEventLists(eventId: number) {
  const rows = db.prepare('SELECT user_id, list_type, tier FROM event_signups WHERE event_id = ? ORDER BY created_at').all(eventId) as Array<{
    user_id: string;
    list_type: string;
    tier: number | null;
  }>;
  return {
    main1: rows.filter((row) => row.list_type === 'main' && row.tier === 1).map((row) => row.user_id),
    main2: rows.filter((row) => row.list_type === 'main' && row.tier === 2).map((row) => row.user_id),
    main3: rows.filter((row) => row.list_type === 'main' && row.tier === 3).map((row) => row.user_id),
    reserve: rows.filter((row) => row.list_type === 'reserve').map((row) => row.user_id),
  };
}

function formatUsers(userIds: string[]): string {
  return userIds.length ? userIds.map((id) => `<@${id}>`).join('\n').slice(0, 1024) : 'Пусто';
}

async function refreshEventMessage(guild: Guild, eventId: number) {
  const event = getEvent(eventId, guild.id);
  if (!event?.message_channel_id || !event.message_id) {
    return;
  }

  const channel = await guild.channels.fetch(event.message_channel_id).catch(() => null);
  if (!channel || !('messages' in channel)) {
    return;
  }

  const message = await channel.messages.fetch(event.message_id).catch(() => null);
  await message?.edit(await renderEventMessage(eventId, guild)).catch(() => undefined);
}

async function dmFamilyAboutEvent(guild: Guild, eventId: number) {
  const familyRoleId = getSetting(guild.id, 'family_role_id');
  if (!familyRoleId) {
    return;
  }

  const event = getEvent(eventId, guild.id);
  if (!event) {
    return;
  }

  const members = await guild.members.fetch();
  let sent = 0;
  let failed = 0;
  for (const member of members.values()) {
    if (!member.roles.cache.has(familyRoleId) || member.user.bot) {
      continue;
    }

    const ok = await safeDm(member, `Создано мероприятие ${event.type.toUpperCase()}: ${event.map}, ${event.side}, старт ${event.start_time}, войс ${event.voice_time}.`);
    if (ok) {
      sent += 1;
    } else {
      failed += 1;
    }
  }
  await sendToConfiguredChannel(guild, 'event_log_channel_id', `DM о создании события #${eventId}: отправлено ${sent}, не доставлено ${failed}.`);
}

async function notifyList(interaction: ButtonInteraction, eventId: number, listType: 'main' | 'reserve') {
  if (!interaction.guild) {
    return;
  }

  const rows = db.prepare('SELECT user_id FROM event_signups WHERE event_id = ? AND list_type = ?').all(eventId, listType) as Array<{ user_id: string }>;
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    const member = await interaction.guild.members.fetch(row.user_id).catch(() => null);
    if (!member) {
      failed += 1;
      continue;
    }

    const ok = await safeDm(member, `Уведомление по мероприятию #${eventId}: ты находишься в ${listType === 'main' ? 'основном' : 'запасном'} списке.`);
    if (ok) {
      sent += 1;
    } else {
      failed += 1;
    }
  }

  await sendToConfiguredChannel(interaction.guild, 'event_log_channel_id', `DM списка #${eventId} (${listType}): отправлено ${sent}, не доставлено ${failed}.`);
  await interaction.reply(privateReply(`Рассылка завершена: отправлено ${sent}, не доставлено ${failed}.`));
}

async function dmEventSignups(guild: Guild, eventId: number, content: string) {
  const rows = db.prepare('SELECT user_id FROM event_signups WHERE event_id = ?').all(eventId) as Array<{ user_id: string }>;
  for (const row of rows) {
    const member = await guild.members.fetch(row.user_id).catch(() => null);
    if (member) {
      await safeDm(member, content);
    }
  }
}

async function voiceCheck(interaction: ButtonInteraction, event: EventRow) {
  if (!interaction.guild) {
    return;
  }

  const voiceId = event.voice_channel_id ?? getSetting(interaction.guild.id, 'default_voice_channel_id');
  const voice = voiceId ? await interaction.guild.channels.fetch(voiceId).catch(() => null) : null;
  if (!voice || voice.type !== ChannelType.GuildVoice) {
    await interaction.reply(privateReply('Voice-канал не настроен или не найден.'));
    return;
  }

  const rows = db.prepare('SELECT user_id, list_type FROM event_signups WHERE event_id = ?').all(event.id) as Array<{ user_id: string; list_type: string }>;
  const missing: string[] = [];
  for (const row of rows) {
    const present = voice.members.has(row.user_id);
    db.prepare('INSERT INTO event_attendance (event_id, user_id, list_type, was_present, checked_by) VALUES (?, ?, ?, ?, ?)').run(
      event.id,
      row.user_id,
      row.list_type,
      present ? 1 : 0,
      interaction.user.id,
    );
    if (!present) {
      missing.push(row.user_id);
    }
  }

  const message = missing.length ? `Не были в войсе: ${missing.map((id) => `<@${id}>`).join(', ')}` : 'Все записанные были в войсе.';
  await sendToConfiguredChannel(interaction.guild, 'event_log_channel_id', `Проверка войса события #${event.id}: ${message}`);
  await interaction.reply(privateReply(message.slice(0, 1900)));
}

function formatExport(eventId: number): string {
  const lists = getEventLists(eventId);
  return [
    `Событие #${eventId}`,
    `Основной Тир 1: ${lists.main1.map((id) => `<@${id}>`).join(', ') || '-'}`,
    `Основной Тир 2: ${lists.main2.map((id) => `<@${id}>`).join(', ') || '-'}`,
    `Основной Тир 3: ${lists.main3.map((id) => `<@${id}>`).join(', ') || '-'}`,
    `Запасной: ${lists.reserve.map((id) => `<@${id}>`).join(', ') || '-'}`,
  ].join('\n');
}

function parseDateTime(value: string): Date | null {
  const direct = new Date(value);
  if (!Number.isNaN(direct.getTime())) {
    return direct;
  }

  const match = value.match(/(\d{1,2}):(\d{2})\s+(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (!match) {
    return null;
  }

  const [, hours, minutes, day, month, year] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes));
}
