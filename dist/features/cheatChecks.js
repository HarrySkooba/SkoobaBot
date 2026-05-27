import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, } from 'discord.js';
import { db } from '../database/db.js';
import { getRoleRule, getSetting } from '../database/settings.js';
import { audit, getConfiguredTextChannel, hasAdminRole, hasConfiguredRole, isAdmin, privateReply, sendToConfiguredChannel, safeDm } from '../discord/helpers.js';
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
                .setDescription('Если ты состоишь в семье и еще не получил Verified, подай заявку на проверку.')
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
        const result = db.prepare('INSERT INTO cheat_checks (guild_id, user_id) VALUES (?, ?)').run(interaction.guild.id, interaction.user.id);
        const checkId = Number(result.lastInsertRowid);
        await publishCheatCheck(interaction, checkId);
        audit(interaction.guild.id, 'cheat_check.created', { checkId }, interaction.user.id, interaction.user.id);
        await interaction.reply(privateReply('Заявка на проверку отправлена в лист ожидания.'));
        return true;
    }
    if (!canHandleCheat(member)) {
        await interaction.reply(privateReply('Эти кнопки доступны только CheatHunter и админам.'));
        return true;
    }
    const [, action, id] = interaction.customId.split(':');
    const checkId = Number(id);
    if (action === 'call') {
        await callPlayer(interaction, checkId);
        return true;
    }
    if (action === 'clean' || action === 'noshow' || action === 'reject') {
        await resolveCheck(interaction, checkId, action);
        return true;
    }
    return true;
}
function canHandleCheat(member) {
    return isAdmin(member) || hasConfiguredRole(member, 'cheat_hunter_role_id');
}
async function publishCheatCheck(interaction, checkId) {
    if (!interaction.guild) {
        return;
    }
    const channel = await getConfiguredTextChannel(interaction.guild, 'cheat_queue_channel_id');
    if (!channel) {
        return;
    }
    const cheatHunterRoleId = getSetting(interaction.guild.id, 'cheat_hunter_role_id');
    const row = cheatButtons(checkId);
    const message = await channel.send({
        content: cheatHunterRoleId ? `<@&${cheatHunterRoleId}> новая заявка на проверку.` : 'Новая заявка на проверку.',
        allowedMentions: cheatHunterRoleId ? { roles: [cheatHunterRoleId] } : { parse: [] },
        embeds: [
            new EmbedBuilder()
                .setTitle(`Проверка на читы #${checkId}`)
                .setDescription(`Игрок: <@${interaction.user.id}>\nСтатус: ожидание`)
                .setColor(0xe67e22),
        ],
        components: [row],
    });
    db.prepare('UPDATE cheat_checks SET queue_message_id = ? WHERE id = ?').run(message.id, checkId);
    await notifyCheatHunters(interaction, checkId);
}
function cheatButtons(checkId) {
    return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`cheat:call:${checkId}`).setLabel('Вызвать').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId(`cheat:clean:${checkId}`).setLabel('Игрок чист').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`cheat:noshow:${checkId}`).setLabel('Не явился').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId(`cheat:reject:${checkId}`).setLabel('Отклонить').setStyle(ButtonStyle.Danger));
}
async function callPlayer(interaction, checkId) {
    if (!interaction.guild) {
        return;
    }
    const row = db.prepare('SELECT user_id FROM cheat_checks WHERE id = ? AND guild_id = ?').get(checkId, interaction.guild.id);
    if (!row) {
        await interaction.reply(privateReply('Заявка не найдена.'));
        return;
    }
    db.prepare('UPDATE cheat_checks SET status = ?, hunter_id = ?, called_at = unixepoch(), updated_at = unixepoch() WHERE id = ?').run('called', interaction.user.id, checkId);
    const player = await interaction.guild.members.fetch(row.user_id).catch(() => null);
    if (player) {
        await safeDm(player, `CheatHunter <@${interaction.user.id}> вызывает тебя на проверку. Зайди в указанный Discord voice/чат и следуй инструкциям.`);
    }
    audit(interaction.guild.id, 'cheat_check.called', { checkId }, interaction.user.id, row.user_id);
    await interaction.reply(privateReply(`Игрок <@${row.user_id}> вызван на проверку.`));
}
async function resolveCheck(interaction, checkId, action) {
    if (!interaction.guild) {
        return;
    }
    const row = db.prepare('SELECT user_id FROM cheat_checks WHERE id = ? AND guild_id = ?').get(checkId, interaction.guild.id);
    if (!row) {
        await interaction.reply(privateReply('Заявка не найдена.'));
        return;
    }
    const status = action === 'clean' ? 'clean' : action;
    db.prepare('UPDATE cheat_checks SET status = ?, hunter_id = ?, resolved_at = unixepoch(), result = ?, updated_at = unixepoch() WHERE id = ?').run(status, interaction.user.id, status, checkId);
    if (action === 'clean') {
        const player = await interaction.guild.members.fetch(row.user_id).catch(() => null);
        const grantRoleId = getRoleRule(interaction.guild.id, 'cheat_clean').grantRoleId ?? getSetting(interaction.guild.id, 'verified_role_id');
        const removeRoleId = getRoleRule(interaction.guild.id, 'cheat_clean').checkRoleId ?? getSetting(interaction.guild.id, 'unverified_role_id');
        if (player) {
            if (removeRoleId) {
                await player.roles.remove(removeRoleId).catch(() => undefined);
            }
            if (grantRoleId) {
                await player.roles.add(grantRoleId).catch(() => undefined);
            }
            await safeDm(player, 'Проверка завершена: ты чист. Роль Verified выдана.');
        }
    }
    audit(interaction.guild.id, `cheat_check.${status}`, { checkId }, interaction.user.id, row.user_id);
    await sendToConfiguredChannel(interaction.guild, 'cheat_log_channel_id', `Проверка #${checkId}: результат \`${status}\`, игрок <@${row.user_id}>, CheatHunter <@${interaction.user.id}>.`);
    await interaction.update({ content: `Проверка #${checkId} завершена: ${status}.`, embeds: [], components: [] });
}
async function removePlayerFromQueue(interaction) {
    if (!interaction.guild) {
        await interaction.reply(privateReply('Проверки работают только на сервере.'));
        return;
    }
    const player = interaction.options.getUser('player', true);
    const reason = interaction.options.getString('reason') ?? 'Удалено командой стаффа';
    const row = db
        .prepare("SELECT id, queue_message_id FROM cheat_checks WHERE guild_id = ? AND user_id = ? AND status IN ('waiting', 'called') ORDER BY created_at DESC LIMIT 1")
        .get(interaction.guild.id, player.id);
    if (!row) {
        await interaction.reply(privateReply(`<@${player.id}> не найден в активной очереди проверки.`));
        return;
    }
    db.prepare('UPDATE cheat_checks SET status = ?, hunter_id = ?, resolved_at = unixepoch(), result = ?, updated_at = unixepoch() WHERE id = ?').run('removed', interaction.user.id, reason, row.id);
    const queueChannel = await getConfiguredTextChannel(interaction.guild, 'cheat_queue_channel_id');
    if (queueChannel && row.queue_message_id) {
        const message = await queueChannel.messages.fetch(row.queue_message_id).catch(() => null);
        await message
            ?.edit({
            content: `Проверка #${row.id} удалена из очереди командой <@${interaction.user.id}>. Причина: ${reason}`,
            embeds: [],
            components: [],
        })
            .catch(() => undefined);
    }
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
        await sendToConfiguredChannel(interaction.guild, 'cheat_log_channel_id', `Проверка #${checkId}: роль CheatHunter не настроена, DM-уведомления не отправлены.`);
        return;
    }
    const members = await interaction.guild.members.fetch();
    let sent = 0;
    let failed = 0;
    for (const member of members.values()) {
        if (member.user.bot || !member.roles.cache.has(cheatHunterRoleId)) {
            continue;
        }
        const ok = await safeDm(member, `Поступила новая заявка на проверку читов #${checkId} от <@${interaction.user.id}>. Проверь канал очереди и нажми "Вызвать", когда будешь готов.`);
        if (ok) {
            sent += 1;
        }
        else {
            failed += 1;
        }
    }
    await sendToConfiguredChannel(interaction.guild, 'cheat_log_channel_id', `DM CheatHunter по заявке #${checkId}: отправлено ${sent}, не доставлено ${failed}.`);
}
