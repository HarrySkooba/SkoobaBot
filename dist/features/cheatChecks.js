import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle, } from 'discord.js';
import { db } from '../database/db.js';
import { getRoleRule, getSetting } from '../database/settings.js';
import { audit, getConfiguredTextChannel, hasAdminRole, hasConfiguredRole, isAdmin, privateReply, sendToConfiguredChannel, safeDm, uniqueRoleIds } from '../discord/helpers.js';
const ACTIVE_CHEAT_STATUSES = ['waiting', 'called'];
export async function handleCheatCommand(interaction) {
    if (interaction.commandName !== 'cheat-panel' && interaction.commandName !== 'cheat-remove') {
        return false;
    }
    const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
    if (!member || (interaction.commandName === 'cheat-panel' ? !isAdmin(member) : !hasAdminRole(member))) {
        await interaction.reply(privateReply(interaction.commandName === 'cheat-panel' ? 'Панель проверок может публиковать только админ.' : 'Убирать игроков из очереди могут только участники с admin_role_id.'));
        return true;
    }
    if (interaction.commandName === 'cheat-remove') {
        await removePlayerFromQueue(interaction);
        return true;
    }
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('cheat:request').setLabel('Подать заявку на проверку').setStyle(ButtonStyle.Primary));
    if (!interaction.channel || !('send' in interaction.channel)) {
        await interaction.reply(privateReply('Не найден текстовый канал для публикации панели.'));
        return true;
    }
    await interaction.channel.send({
        embeds: [
            new EmbedBuilder()
                .setTitle('Проверка на читы')
                .setDescription('Нужны роли семьи и Unverified. Если их нет — возьми на панели `/role-panel`. После проверки выдается Verified.')
                .setColor(0xe67e22),
        ],
        components: [row],
    });
    await interaction.reply(privateReply('Панель проверок опубликована.'));
    return true;
}
export async function handleCheatButton(interaction) {
    if (!interaction.customId.startsWith('cheat:')) {
        return false;
    }
    if (!interaction.guild) {
        await interaction.reply(privateReply('Проверки работают только на сервере.'));
        return true;
    }
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) {
        await interaction.reply(privateReply('Не удалось получить участника.'));
        return true;
    }
    if (interaction.customId === 'cheat:request') {
        if (!hasConfiguredRole(member, 'family_role_id')) {
            await interaction.reply(privateReply('Заявку на проверку могут подавать только участники с ролью семьи.'));
            return true;
        }
        if (!hasConfiguredRole(member, 'unverified_role_id')) {
            await interaction.reply(privateReply('Заявку на проверку могут подавать только участники с ролью Unverified.'));
            return true;
        }
        if (hasConfiguredRole(member, 'verified_role_id')) {
            await interaction.reply(privateReply('У тебя уже есть роль Verified.'));
            return true;
        }
        const existing = db
            .prepare("SELECT id FROM cheat_checks WHERE guild_id = ? AND user_id = ? AND status IN ('waiting', 'called')")
            .get(interaction.guild.id, interaction.user.id);
        if (existing) {
            await interaction.reply(privateReply(`Ты уже находишься в очереди проверки #${existing.id}.`));
            return true;
        }
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });
        const result = db.prepare('INSERT INTO cheat_checks (guild_id, user_id) VALUES (?, ?)').run(interaction.guild.id, interaction.user.id);
        const checkId = Number(result.lastInsertRowid);
        await publishCheatCheck(interaction, checkId);
        audit(interaction.guild.id, 'cheat_check.created', { checkId }, interaction.user.id, interaction.user.id);
        await interaction.editReply('Заявка на проверку отправлена в лист ожидания.');
        return true;
    }
    if (!canHandleCheat(member)) {
        await interaction.reply(privateReply('Эти кнопки доступны только CheatHunter и админам.'));
        return true;
    }
    const [, action, id] = interaction.customId.split(':');
    const checkId = Number(id);
    const check = getCheatCheck(checkId, interaction.guild.id);
    if (!check) {
        await interaction.reply(privateReply('Заявка не найдена.'));
        return true;
    }
    if (!ACTIVE_CHEAT_STATUSES.includes(check.status)) {
        await interaction.reply(privateReply('Эта заявка уже завершена.'));
        return true;
    }
    if (action === 'call') {
        await callPlayer(interaction, check);
        return true;
    }
    if (action === 'reject') {
        const modal = new ModalBuilder().setCustomId(`cheat-reject:${checkId}`).setTitle('Отклонить проверку');
        modal.addComponents(cheatModalRow('reason', 'Причина отказа', TextInputStyle.Paragraph));
        await interaction.showModal(modal);
        return true;
    }
    if (action === 'clean' || action === 'noshow') {
        await resolveCheck(interaction, check, action);
        return true;
    }
    return true;
}
export async function handleCheatModal(interaction) {
    if (!interaction.customId.startsWith('cheat-reject:')) {
        return false;
    }
    if (!interaction.guild) {
        await interaction.reply(privateReply('Проверки работают только на сервере.'));
        return true;
    }
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !canHandleCheat(member)) {
        await interaction.reply(privateReply('Отклонять проверки могут только CheatHunter и админы.'));
        return true;
    }
    const checkId = Number(interaction.customId.split(':')[1]);
    const check = getCheatCheck(checkId, interaction.guild.id);
    if (!check) {
        await interaction.reply(privateReply('Заявка не найдена.'));
        return true;
    }
    if (!ACTIVE_CHEAT_STATUSES.includes(check.status)) {
        await interaction.reply(privateReply('Эта заявка уже завершена.'));
        return true;
    }
    const reason = interaction.fields.getTextInputValue('reason').trim();
    if (!reason) {
        await interaction.reply(privateReply('Укажи причину отказа.'));
        return true;
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await resolveCheck(interaction, check, 'reject', reason);
    await interaction.editReply(`Проверка #${checkId} отклонена.`);
    return true;
}
function canHandleCheat(member) {
    return isAdmin(member) || hasConfiguredRole(member, 'cheat_hunter_role_id');
}
function getCheatCheck(checkId, guildId) {
    return (db.prepare('SELECT id, guild_id, user_id, status, hunter_id, queue_message_id, result FROM cheat_checks WHERE id = ? AND guild_id = ?').get(checkId, guildId) ?? null);
}
function cheatModalRow(customId, label, style) {
    return new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(customId).setLabel(label).setStyle(style).setRequired(true).setMaxLength(1000));
}
function cheatCheckQueueStatusLabel(status) {
    switch (status) {
        case 'waiting':
            return 'Ожидание';
        case 'called':
            return 'Вызвана на проверку';
        case 'clean':
            return 'Игрок чист';
        case 'reject':
            return 'Отклонено';
        case 'noshow':
            return 'Не явился';
        case 'removed':
            return 'Удалено из очереди';
        default:
            return status;
    }
}
function cheatCheckEmbedColor(status) {
    switch (status) {
        case 'waiting':
            return 0xe67e22;
        case 'called':
            return 0x3498db;
        case 'clean':
            return 0x57f287;
        case 'reject':
            return 0xed4245;
        case 'noshow':
            return 0x95a5a6;
        default:
            return 0x5865f2;
    }
}
function buildCheatCheckEmbed(check, options) {
    const lines = [`Игрок: <@${check.user_id}>`, `Статус: **${cheatCheckQueueStatusLabel(check.status)}**`];
    if (check.hunter_id && (check.status === 'called' || check.status === 'clean' || check.status === 'reject' || check.status === 'noshow')) {
        lines.push(`CheatHunter: <@${check.hunter_id}>`);
    }
    if (options?.rejectReason) {
        lines.push(`Причина отказа: ${options.rejectReason}`);
    }
    return new EmbedBuilder()
        .setTitle(`Проверка на читы #${check.id}`)
        .setDescription(lines.join('\n'))
        .setColor(cheatCheckEmbedColor(check.status));
}
function buildCheatCheckQueueContent(guildId, checkId, status) {
    if (status === 'waiting') {
        const cheatHunterRoleId = getSetting(guildId, 'cheat_hunter_role_id');
        return cheatHunterRoleId ? `<@&${cheatHunterRoleId}> новая заявка на проверку #${checkId}.` : `Новая заявка на проверку #${checkId}.`;
    }
    if (status === 'called') {
        return `Проверка #${checkId}: игрок вызван на проверку.`;
    }
    return `Проверка #${checkId}: ${cheatCheckQueueStatusLabel(status).toLowerCase()}.`;
}
function cheatButtons(checkId, status) {
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`cheat:call:${checkId}`).setLabel('Вызвать').setStyle(ButtonStyle.Primary).setDisabled(status !== 'waiting'), new ButtonBuilder().setCustomId(`cheat:clean:${checkId}`).setLabel('Игрок чист').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`cheat:noshow:${checkId}`).setLabel('Не явился').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId(`cheat:reject:${checkId}`).setLabel('Отклонить').setStyle(ButtonStyle.Danger));
    return row;
}
async function publishCheatCheck(interaction, checkId) {
    if (!interaction.guild) {
        return;
    }
    const channel = await getConfiguredTextChannel(interaction.guild, 'cheat_queue_channel_id');
    if (!channel) {
        return;
    }
    const check = getCheatCheck(checkId, interaction.guild.id);
    if (!check) {
        return;
    }
    const cheatHunterRoleId = getSetting(interaction.guild.id, 'cheat_hunter_role_id');
    const message = await channel.send({
        content: buildCheatCheckQueueContent(interaction.guild.id, checkId, 'waiting'),
        allowedMentions: cheatHunterRoleId ? { roles: [cheatHunterRoleId] } : { parse: [] },
        embeds: [buildCheatCheckEmbed({ ...check, status: 'waiting' })],
        components: [cheatButtons(checkId, 'waiting')],
    });
    db.prepare('UPDATE cheat_checks SET queue_message_id = ? WHERE id = ?').run(message.id, checkId);
    await notifyCheatHunters(interaction, checkId);
}
async function updateCheatQueueMessage(guild, check, options) {
    if (!check.queue_message_id) {
        return;
    }
    const channel = await getConfiguredTextChannel(guild, 'cheat_queue_channel_id');
    if (!channel) {
        return;
    }
    const message = await channel.messages.fetch(check.queue_message_id).catch(() => null);
    if (!message) {
        return;
    }
    const isActive = ACTIVE_CHEAT_STATUSES.includes(check.status);
    await message
        .edit({
        content: buildCheatCheckQueueContent(guild.id, check.id, check.status),
        embeds: [buildCheatCheckEmbed(check, options)],
        components: isActive ? [cheatButtons(check.id, check.status)] : [],
    })
        .catch(() => undefined);
}
async function callPlayer(interaction, check) {
    if (!interaction.guild) {
        return;
    }
    if (check.status !== 'waiting') {
        await interaction.reply(privateReply('Вызвать можно только заявку в статусе «Ожидание».'));
        return;
    }
    db.prepare('UPDATE cheat_checks SET status = ?, hunter_id = ?, called_at = unixepoch(), updated_at = unixepoch() WHERE id = ?').run('called', interaction.user.id, check.id);
    const updatedCheck = { ...check, status: 'called', hunter_id: interaction.user.id };
    const player = await interaction.guild.members.fetch(check.user_id).catch(() => null);
    if (player) {
        await safeDm(player, `CheatHunter <@${interaction.user.id}> вызывает тебя на проверку. Зайди в указанный Discord voice/чат и следуй инструкциям.`);
    }
    audit(interaction.guild.id, 'cheat_check.called', { checkId: check.id }, interaction.user.id, check.user_id);
    await interaction.update({
        content: buildCheatCheckQueueContent(interaction.guild.id, check.id, 'called'),
        embeds: [buildCheatCheckEmbed(updatedCheck)],
        components: [cheatButtons(check.id, 'called')],
    });
}
async function resolveCheck(interaction, check, action, rejectReason) {
    if (!interaction.guild) {
        return;
    }
    const status = action === 'clean' ? 'clean' : action;
    const result = action === 'reject' ? rejectReason ?? 'отклонено' : status;
    const statusLabel = cheatCheckQueueStatusLabel(status);
    db.prepare('UPDATE cheat_checks SET status = ?, hunter_id = ?, resolved_at = unixepoch(), result = ?, updated_at = unixepoch() WHERE id = ?').run(status, interaction.user.id, result, check.id);
    const resolvedCheck = { ...check, status, hunter_id: interaction.user.id, result };
    if (action === 'clean') {
        const player = await interaction.guild.members.fetch(check.user_id).catch(() => null);
        const cheatCleanRule = getRoleRule(interaction.guild.id, 'cheat_clean');
        const grantRoleId = cheatCleanRule.grantRoleId ?? getSetting(interaction.guild.id, 'verified_role_id');
        const removeRoleIds = uniqueRoleIds([cheatCleanRule.checkRoleId, getSetting(interaction.guild.id, 'unverified_role_id')]);
        if (player) {
            const failedRemoveRoleIds = [];
            for (const removeRoleId of removeRoleIds) {
                if (!player.roles.cache.has(removeRoleId)) {
                    continue;
                }
                const removed = await player.roles.remove(removeRoleId).then(() => true, (error) => {
                    console.error(`Failed to remove role ${removeRoleId} from ${player.id}:`, error);
                    return false;
                });
                if (removed) {
                    continue;
                }
                else {
                    failedRemoveRoleIds.push(removeRoleId);
                }
            }
            if (grantRoleId) {
                await player.roles.add(grantRoleId).catch(() => undefined);
            }
            if (failedRemoveRoleIds.length > 0) {
                await sendToConfiguredChannel(interaction.guild, 'cheat_log_channel_id', `Проверка #${check.id}: не удалось снять роли ${failedRemoveRoleIds.map((roleId) => `<@&${roleId}>`).join(', ')} с <@${player.id}>. Проверь, что роль бота выше этих ролей.`);
            }
            await safeDm(player, 'Проверка завершена: ты чист. Роль Verified выдана.');
        }
    }
    if (action === 'reject') {
        const player = await interaction.guild.members.fetch(check.user_id).catch(() => null);
        if (player && rejectReason) {
            await safeDm(player, `Заявка на проверку отклонена. Причина: ${rejectReason}`);
        }
    }
    audit(interaction.guild.id, `cheat_check.${status}`, { checkId: check.id, rejectReason }, interaction.user.id, check.user_id);
    await sendToConfiguredChannel(interaction.guild, 'cheat_log_channel_id', `Проверка #${check.id}: ${statusLabel}${rejectReason ? ` (${rejectReason})` : ''}, игрок <@${check.user_id}>, CheatHunter <@${interaction.user.id}>.`);
    if (interaction.isButton()) {
        await interaction.update({
            content: buildCheatCheckQueueContent(interaction.guild.id, check.id, status),
            embeds: [buildCheatCheckEmbed(resolvedCheck, action === 'reject' ? { rejectReason } : undefined)],
            components: [],
        });
    }
    else {
        await updateCheatQueueMessage(interaction.guild, resolvedCheck, action === 'reject' ? { rejectReason } : undefined);
    }
}
async function removePlayerFromQueue(interaction) {
    if (!interaction.guild) {
        await interaction.reply(privateReply('Проверки работают только на сервере.'));
        return;
    }
    const player = interaction.options.getUser('player', true);
    const reason = interaction.options.getString('reason') ?? 'Удалено командой стаффа';
    const row = db
        .prepare("SELECT id, queue_message_id, user_id, status, hunter_id, result FROM cheat_checks WHERE guild_id = ? AND user_id = ? AND status IN ('waiting', 'called') ORDER BY created_at DESC LIMIT 1")
        .get(interaction.guild.id, player.id);
    if (!row) {
        await interaction.reply(privateReply(`<@${player.id}> не найден в активной очереди проверки.`));
        return;
    }
    db.prepare('UPDATE cheat_checks SET status = ?, hunter_id = ?, resolved_at = unixepoch(), result = ?, updated_at = unixepoch() WHERE id = ?').run('removed', interaction.user.id, reason, row.id);
    const resolvedCheck = { ...row, status: 'removed', hunter_id: interaction.user.id, result: reason };
    await updateCheatQueueMessage(interaction.guild, resolvedCheck);
    audit(interaction.guild.id, 'cheat_check.removed', { checkId: row.id, reason }, interaction.user.id, player.id);
    await sendToConfiguredChannel(interaction.guild, 'cheat_log_channel_id', `Проверка #${row.id}: игрок <@${player.id}> удален из очереди пользователем <@${interaction.user.id}>. Причина: ${reason}`);
    await interaction.reply(privateReply(`<@${player.id}> удален из очереди проверки #${row.id}.`));
}
async function notifyCheatHunters(interaction, checkId) {
    if (!interaction.guild) {
        return;
    }
    const cheatHunterRoleId = getSetting(interaction.guild.id, 'cheat_hunter_role_id');
    if (!cheatHunterRoleId) {
        return;
    }
    const role = await interaction.guild.roles.fetch(cheatHunterRoleId).catch(() => null);
    if (!role) {
        return;
    }
    for (const [, member] of role.members) {
        if (member.user.bot) {
            continue;
        }
        await safeDm(member, `Поступила новая заявка на проверку читов #${checkId} от <@${interaction.user.id}>. Проверь канал очереди и нажми "Вызвать", когда будешь готов.`);
    }
}
