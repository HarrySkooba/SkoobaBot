import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, MessageFlags, } from 'discord.js';
import { db } from '../database/db.js';
import { getEventLogChannelKey, getEventPublishChannelKey, getSetting, getTierRoleId } from '../database/settings.js';
import { audit, getConfiguredTextChannel, hasAdminRole, hasConfiguredRole, privateReply, safeDm, sendToConfiguredChannel } from '../discord/helpers.js';
const CAPT_SIDE_LABELS = {
    attack: 'Атака',
    deff: 'Деф',
};
export async function handleEventCommand(interaction) {
    if (interaction.commandName === 'event-create-capt') {
        return handleEventCreateCaptCommand(interaction);
    }
    if (interaction.commandName === 'event-create-mcl') {
        return handleEventCreateMclCommand(interaction);
    }
    if (interaction.commandName === 'attendance') {
        const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
        if (!member || !hasAdminRole(member)) {
            await interaction.reply(privateReply('Смотреть посещаемость могут только участники с admin_role_id.'));
            return true;
        }
        const player = interaction.options.getUser('player', true);
        const rows = db
            .prepare(`SELECT COUNT(*) AS total,
          SUM(CASE WHEN was_present = 0 THEN 1 ELSE 0 END) AS misses
         FROM event_attendance
         WHERE user_id = ?`)
            .get(player.id);
        await interaction.reply(privateReply(`<@${player.id}>: проверок ${rows.total}, неявок ${rows.misses ?? 0}.`));
        return true;
    }
    return false;
}
async function handleEventCreateCaptCommand(interaction) {
    if (!interaction.guild) {
        await interaction.reply(privateReply('Мероприятия работают только на сервере.'));
        return true;
    }
    const input = {
        type: 'kapt',
        startTime: interaction.options.getString('start_time', true),
        voiceTime: interaction.options.getString('voice_time', true),
        side: interaction.options.getString('side', true),
        map: interaction.options.getString('map', true),
        voiceChannelId: resolveEventVoiceChannelId(interaction.guild.id, getSelectedVoiceChannelId(interaction)),
        imageUrl: interaction.options.getAttachment('photo')?.url ?? null,
    };
    return executeEventCreate(interaction, input, 'event-create-capt');
}
async function handleEventCreateMclCommand(interaction) {
    if (!interaction.guild) {
        await interaction.reply(privateReply('Мероприятия работают только на сервере.'));
        return true;
    }
    const input = {
        type: 'mcl',
        startTime: interaction.options.getString('start_time', true),
        voiceTime: interaction.options.getString('voice_time', true),
        side: '-',
        map: '-',
        voiceChannelId: resolveEventVoiceChannelId(interaction.guild.id, getSelectedVoiceChannelId(interaction)),
        imageUrl: interaction.options.getAttachment('photo')?.url ?? null,
        mclSubtype: interaction.options.getString('subtype', true),
        teleportTime: interaction.options.getString('teleport_time', true),
        playerCount: interaction.options.getString('player_count', true),
    };
    return executeEventCreate(interaction, input, 'event-create-mcl');
}
function getSelectedVoiceChannelId(interaction) {
    const voiceChannel = interaction.options.getChannel('voice');
    return voiceChannel?.type === ChannelType.GuildVoice ? voiceChannel.id : null;
}
async function executeEventCreate(interaction, input, commandLabel) {
    if (!interaction.guild) {
        return true;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !hasAdminRole(member)) {
        await interaction.editReply('Создавать мероприятия могут только участники с admin_role_id.');
        return true;
    }
    try {
        const published = await createAndPublishEvent(interaction.guild, interaction.user.id, input);
        if (!published) {
            await interaction.editReply(`Не удалось опубликовать мероприятие. Проверь канал ${input.type === 'kapt' ? 'event_capt_channel_id' : 'event_mcl_channel_id'} и права бота.`);
            return true;
        }
        await interaction.editReply(`Мероприятие #${published.eventId} создано: ${published.messageUrl}`);
    }
    catch (error) {
        console.error(`${commandLabel} failed:`, error);
        const reason = error instanceof Error ? error.message : 'неизвестная ошибка';
        await interaction.editReply(`Не удалось создать мероприятие: ${reason.slice(0, 1800)}`);
    }
    return true;
}
export async function handleEventButton(interaction) {
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
    if (action === 'signup' || action === 'leave') {
        if (isEventListClosed(event)) {
            await interaction.reply(privateReply('Запись на это МП закрыта.'));
            return true;
        }
        if (action === 'signup') {
            const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
            if (!member) {
                await interaction.reply(privateReply('Не удалось получить участника.'));
                return true;
            }
            const placement = resolvePlacement(member);
            if (!placement.allowed) {
                await interaction.reply(privateReply(placement.reason));
                return true;
            }
            await interaction.deferUpdate();
            db.prepare(`INSERT INTO event_signups (event_id, user_id, list_type, tier)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(event_id, user_id) DO UPDATE SET list_type = excluded.list_type, tier = excluded.tier`).run(eventId, interaction.user.id, placement.listType, placement.tier);
            await refreshEventMessage(interaction.guild, eventId);
            await interaction.followUp(privateReply(`Ты записан в ${placement.listType === 'main' ? `основной список, тир ${placement.tier}` : 'запасной список'}.`));
            return true;
        }
        await interaction.deferUpdate();
        db.prepare('DELETE FROM event_signups WHERE event_id = ? AND user_id = ?').run(eventId, interaction.user.id);
        await refreshEventMessage(interaction.guild, eventId);
        await interaction.followUp(privateReply('Ты удален из списка.'));
        return true;
    }
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !hasAdminRole(member)) {
        await interaction.reply(privateReply('Управлять событием могут только участники с admin_role_id.'));
        return true;
    }
    if (action === 'notify-main' || action === 'notify-reserve') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await notifyList(interaction, event, action === 'notify-main' ? 'main' : 'reserve');
        return true;
    }
    if (action === 'voice-check') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await voiceCheck(interaction, event);
        return true;
    }
    if (action === 'export') {
        await interaction.reply(privateReply(formatExport(eventId)));
        return true;
    }
    if (action === 'close-list') {
        await interaction.deferUpdate();
        const nextClosed = isEventListClosed(event) ? 0 : 1;
        db.prepare('UPDATE events SET list_closed = ?, updated_at = unixepoch() WHERE id = ?').run(nextClosed, eventId);
        await refreshEventMessage(interaction.guild, eventId);
        await sendToConfiguredChannel(interaction.guild, getEventLogChannelKey(event.type), `МП #${eventId}: запись ${nextClosed ? 'закрыта' : 'открыта'} админом <@${interaction.user.id}>.`);
        audit(interaction.guild.id, 'event.list_toggled', { eventId, listClosed: Boolean(nextClosed) }, interaction.user.id);
        return true;
    }
    if (action === 'delete') {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        await deleteEventMessage(interaction, event);
        return true;
    }
    return true;
}
export function startReminderScheduler(client) {
    setInterval(() => {
        void runReminderTick(client);
    }, 60_000);
}
async function runReminderTick(client) {
    const events = db
        .prepare("SELECT * FROM events WHERE unixepoch() - created_at < 604800")
        .all();
    const offsets = [30, 15, 5];
    const now = Date.now();
    for (const event of events) {
        const voiceAt = parseDateTime(event.voice_time);
        if (!voiceAt) {
            continue;
        }
        const sent = JSON.parse(event.reminders_sent);
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
function getEvent(eventId, guildId) {
    return db.prepare('SELECT * FROM events WHERE id = ? AND guild_id = ?').get(eventId, guildId) ?? null;
}
function resolvePlacement(member) {
    if (!hasConfiguredRole(member, 'family_role_id')) {
        return { allowed: false, reason: 'Записаться могут только участники с ролью семьи.' };
    }
    const hasUnverified = hasConfiguredRole(member, 'unverified_role_id');
    const hasVerified = hasConfiguredRole(member, 'verified_role_id');
    if (!hasUnverified && !hasVerified) {
        return { allowed: false, reason: 'Нужны роли семьи и Unverified (или Verified после проверки).' };
    }
    const tier = getMemberTier(member);
    if (tier) {
        return { allowed: true, listType: 'main', tier };
    }
    return { allowed: true, listType: 'reserve', tier: null };
}
function getMemberTier(member) {
    for (const tier of [1, 2, 3]) {
        const roleId = getTierRoleId(member.guild.id, tier);
        if (roleId && member.roles.cache.has(roleId)) {
            return tier;
        }
    }
    return null;
}
function isEventListClosed(event) {
    return Boolean(event.list_closed ?? 0);
}
function resolveEventVoiceChannelId(guildId, selectedVoiceChannelId) {
    return selectedVoiceChannelId ?? getSetting(guildId, 'default_voice_channel_id');
}
function getEventTypeLabel(event) {
    if (event.type === 'kapt') {
        return 'Капт';
    }
    return event.mcl_subtype === 'vzz' ? 'ВЗЗ' : 'МЦЛ';
}
function formatCaptSide(side) {
    return CAPT_SIDE_LABELS[side] ?? side;
}
function buildEventDescription(event) {
    const lines = [];
    if (event.type === 'kapt') {
        lines.push(`Сторона: **${formatCaptSide(event.side)}**`, `Карта: **${event.map}**`);
    }
    else {
        lines.push(`Тип: **${getEventTypeLabel(event)}**`);
        if (event.teleport_time) {
            lines.push(`Телепорт: **${event.teleport_time}**`);
        }
        if (event.player_count) {
            lines.push(`Игроков: **${event.player_count}**`);
        }
    }
    lines.push(`Начало: **${event.start_time}**`, `Зайти в войс: **${event.voice_time}**`);
    if (event.voice_channel_id) {
        lines.push(`Voice: <#${event.voice_channel_id}>`);
    }
    return lines.join('\n');
}
function buildEventAnnounceContent(event, familyRoleId) {
    const typeLabel = getEventTypeLabel(event);
    if (event.type === 'kapt') {
        return `<@&${familyRoleId}> создано новое МП **${typeLabel}** на карте **${event.map}**.`;
    }
    return `<@&${familyRoleId}> создано новое МП **${typeLabel}** (игроков: **${event.player_count ?? '?'}**).`;
}
async function createAndPublishEvent(guild, createdBy, input) {
    const result = db
        .prepare(`INSERT INTO events (
         guild_id, type, start_time, voice_time, side, map, voice_channel_id, created_by,
         mcl_subtype, teleport_time, player_count, image_url
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(guild.id, input.type, input.startTime, input.voiceTime, input.side, input.map, input.voiceChannelId, createdBy, input.mclSubtype ?? null, input.teleportTime ?? null, input.playerCount ?? null, input.imageUrl);
    const eventId = Number(result.lastInsertRowid);
    const channel = (await getConfiguredTextChannel(guild, getEventPublishChannelKey(input.type))) ?? null;
    if (!channel) {
        return null;
    }
    const message = await sendEventMessage(channel, eventId, guild, { announce: true });
    db.prepare('UPDATE events SET message_channel_id = ?, message_id = ? WHERE id = ?').run(channel.id, message.id, eventId);
    audit(guild.id, 'event.created', { eventId, ...input }, createdBy);
    void dmFamilyAboutEvent(guild, eventId).catch((error) => console.error('dmFamilyAboutEvent failed:', error));
    return { eventId, messageUrl: message.url };
}
async function sendEventMessage(channel, eventId, guild, options) {
    const payload = buildEventMessagePayload(eventId, guild, options);
    try {
        return await channel.send(payload);
    }
    catch (error) {
        const event = getEvent(eventId, guild.id);
        if (!event?.image_url) {
            throw error;
        }
        db.prepare('UPDATE events SET image_url = NULL WHERE id = ?').run(eventId);
        const fallbackPayload = buildEventMessagePayload(eventId, guild, options);
        return await channel.send(fallbackPayload);
    }
}
function buildEventMessagePayload(eventId, guild, options) {
    const event = getEvent(eventId, guild.id);
    if (!event) {
        throw new Error(`Event ${eventId} not found`);
    }
    const lists = getEventLists(eventId);
    const listClosed = isEventListClosed(event);
    const typeLabel = getEventTypeLabel(event);
    const embed = new EmbedBuilder()
        .setTitle(`${typeLabel} #${event.id}`)
        .setDescription(buildEventDescription(event))
        .addFields({ name: 'Запись на МП', value: listClosed ? '🔒 Закрыта' : '✅ Открыта' }, { name: 'Основной Тир 1', value: formatUsers(lists.main1), inline: true }, { name: 'Основной Тир 2', value: formatUsers(lists.main2), inline: true }, { name: 'Основной Тир 3', value: formatUsers(lists.main3), inline: true }, { name: 'Запасной', value: formatUsers(lists.reserve), inline: false })
        .setColor(event.type === 'kapt' ? 0xed4245 : 0x5865f2);
    if (event.image_url) {
        embed.setImage(event.image_url);
    }
    const components = [
        new ActionRowBuilder().addComponents(new ButtonBuilder()
            .setCustomId(`event:signup:${eventId}`)
            .setLabel('Записаться')
            .setStyle(ButtonStyle.Success)
            .setDisabled(listClosed), new ButtonBuilder()
            .setCustomId(`event:leave:${eventId}`)
            .setLabel('Отписаться')
            .setStyle(ButtonStyle.Secondary)
            .setDisabled(listClosed), new ButtonBuilder().setCustomId(`event:export:${eventId}`).setLabel('Экспорт').setStyle(ButtonStyle.Secondary)),
        new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`event:notify-main:${eventId}`).setLabel('Уведомить основной').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId(`event:notify-reserve:${eventId}`).setLabel('Уведомить запас').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId(`event:voice-check:${eventId}`).setLabel('Проверить войс').setStyle(ButtonStyle.Danger)),
        new ActionRowBuilder().addComponents(new ButtonBuilder()
            .setCustomId(`event:close-list:${eventId}`)
            .setLabel(listClosed ? 'Открыть запись' : 'Закрыть список')
            .setStyle(listClosed ? ButtonStyle.Success : ButtonStyle.Secondary), new ButtonBuilder().setCustomId(`event:delete:${eventId}`).setLabel('Удалить МП').setStyle(ButtonStyle.Danger)),
    ];
    const familyRoleId = options?.announce ? getSetting(guild.id, 'family_role_id') : null;
    const payload = { embeds: [embed], components };
    if (familyRoleId) {
        payload.content = buildEventAnnounceContent(event, familyRoleId);
        payload.allowedMentions = { roles: [familyRoleId] };
    }
    return payload;
}
function getEventLists(eventId) {
    const rows = db.prepare('SELECT user_id, list_type, tier FROM event_signups WHERE event_id = ? ORDER BY created_at').all(eventId);
    return {
        main1: rows.filter((row) => row.list_type === 'main' && row.tier === 1).map((row) => row.user_id),
        main2: rows.filter((row) => row.list_type === 'main' && row.tier === 2).map((row) => row.user_id),
        main3: rows.filter((row) => row.list_type === 'main' && row.tier === 3).map((row) => row.user_id),
        reserve: rows.filter((row) => row.list_type === 'reserve').map((row) => row.user_id),
    };
}
function formatUsers(userIds) {
    return userIds.length ? userIds.map((id) => `<@${id}>`).join('\n').slice(0, 1024) : 'Пусто';
}
async function refreshEventMessage(guild, eventId) {
    const event = getEvent(eventId, guild.id);
    if (!event?.message_channel_id || !event.message_id) {
        return;
    }
    const channel = await guild.channels.fetch(event.message_channel_id).catch(() => null);
    if (!channel || !('messages' in channel)) {
        return;
    }
    const message = await channel.messages.fetch(event.message_id).catch(() => null);
    await message?.edit(buildEventMessagePayload(eventId, guild)).catch(() => undefined);
}
async function dmFamilyAboutEvent(guild, eventId) {
    const familyRoleId = getSetting(guild.id, 'family_role_id');
    if (!familyRoleId) {
        return;
    }
    const event = getEvent(eventId, guild.id);
    if (!event) {
        return;
    }
    const familyRole = await guild.roles.fetch(familyRoleId).catch(() => null);
    if (!familyRole) {
        return;
    }
    let sent = 0;
    let failed = 0;
    const typeLabel = getEventTypeLabel(event);
    const details = event.type === 'kapt'
        ? `карта **${event.map}**, сторона **${formatCaptSide(event.side)}**`
        : `тип **${typeLabel}**, игроков **${event.player_count ?? '?'}**, телепорт **${event.teleport_time ?? '-'}**`;
    const dmText = `Создано новое МП **${typeLabel}** #${event.id}: ${details}, старт **${event.start_time}**, войс **${event.voice_time}**. Запишись в канале мероприятий.`;
    for (const [, member] of familyRole.members) {
        if (member.user.bot) {
            continue;
        }
        const ok = await safeDm(member, dmText);
        if (ok) {
            sent += 1;
        }
        else {
            failed += 1;
        }
    }
    await sendToConfiguredChannel(guild, getEventLogChannelKey(event.type), `DM о создании события #${eventId}: отправлено ${sent}, не доставлено ${failed}.`);
}
async function notifyList(interaction, event, listType) {
    if (!interaction.guild) {
        return;
    }
    const rows = db.prepare('SELECT user_id FROM event_signups WHERE event_id = ? AND list_type = ?').all(event.id, listType);
    let sent = 0;
    let failed = 0;
    for (const row of rows) {
        const member = await interaction.guild.members.fetch(row.user_id).catch(() => null);
        if (!member) {
            failed += 1;
            continue;
        }
        const ok = await safeDm(member, `Уведомление по мероприятию #${event.id}: ты находишься в ${listType === 'main' ? 'основном' : 'запасном'} списке.`);
        if (ok) {
            sent += 1;
        }
        else {
            failed += 1;
        }
    }
    await sendToConfiguredChannel(interaction.guild, getEventLogChannelKey(event.type), `DM списка #${event.id} (${listType}): отправлено ${sent}, не доставлено ${failed}.`);
    await interaction.editReply(`Рассылка завершена: отправлено ${sent}, не доставлено ${failed}.`);
}
async function dmEventSignups(guild, eventId, content) {
    const rows = db.prepare('SELECT user_id FROM event_signups WHERE event_id = ?').all(eventId);
    for (const row of rows) {
        const member = await guild.members.fetch(row.user_id).catch(() => null);
        if (member) {
            await safeDm(member, content);
        }
    }
}
async function voiceCheck(interaction, event) {
    if (!interaction.guild) {
        return;
    }
    const voiceId = resolveEventVoiceChannelId(interaction.guild.id, event.voice_channel_id);
    const voice = voiceId ? await interaction.guild.channels.fetch(voiceId).catch(() => null) : null;
    if (!voice || voice.type !== ChannelType.GuildVoice) {
        await interaction.editReply('Voice-канал не настроен или не найден.');
        return;
    }
    const rows = db.prepare('SELECT user_id, list_type FROM event_signups WHERE event_id = ?').all(event.id);
    const missing = [];
    for (const row of rows) {
        const present = voice.members.has(row.user_id);
        db.prepare('INSERT INTO event_attendance (event_id, user_id, list_type, was_present, checked_by) VALUES (?, ?, ?, ?, ?)').run(event.id, row.user_id, row.list_type, present ? 1 : 0, interaction.user.id);
        if (!present) {
            missing.push(row.user_id);
        }
    }
    const message = missing.length ? `Не были в войсе: ${missing.map((id) => `<@${id}>`).join(', ')}` : 'Все записанные были в войсе.';
    await sendToConfiguredChannel(interaction.guild, getEventLogChannelKey(event.type), `Проверка войса события #${event.id}: ${message}`);
    await interaction.editReply(message.slice(0, 1900));
}
async function deleteEventMessage(interaction, event) {
    if (!interaction.guild) {
        await interaction.editReply('Сервер не найден.');
        return;
    }
    if (event.message_channel_id && event.message_id) {
        const channel = await interaction.guild.channels.fetch(event.message_channel_id).catch(() => null);
        if (channel && 'messages' in channel) {
            const message = await channel.messages.fetch(event.message_id).catch(() => null);
            await message?.delete().catch(() => undefined);
        }
    }
    db.prepare('UPDATE events SET message_channel_id = NULL, message_id = NULL, updated_at = unixepoch() WHERE id = ?').run(event.id);
    const summary = formatExport(event.id);
    await sendToConfiguredChannel(interaction.guild, getEventLogChannelKey(event.type), `МП #${event.id} удалено из канала админом <@${interaction.user.id}>. Сообщение убрано, данные и списки сохранены.\n${summary}`);
    audit(interaction.guild.id, 'event.message_deleted', { eventId: event.id, summary }, interaction.user.id);
    await interaction.editReply(`МП #${event.id} удалено из канала. Списки и логи сохранены в базе.`);
}
function formatExport(eventId) {
    const lists = getEventLists(eventId);
    return [
        `Событие #${eventId}`,
        `Основной Тир 1: ${lists.main1.map((id) => `<@${id}>`).join(', ') || '-'}`,
        `Основной Тир 2: ${lists.main2.map((id) => `<@${id}>`).join(', ') || '-'}`,
        `Основной Тир 3: ${lists.main3.map((id) => `<@${id}>`).join(', ') || '-'}`,
        `Запасной: ${lists.reserve.map((id) => `<@${id}>`).join(', ') || '-'}`,
    ].join('\n');
}
function parseDateTime(value) {
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
