import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle, } from 'discord.js';
import { db } from '../database/db.js';
import { getRoleRule, getSetting } from '../database/settings.js';
import { audit, getConfiguredTextChannel, isStaff, privateReply, sendToConfiguredChannel } from '../discord/helpers.js';
export async function handleApplicationCommand(interaction) {
    if (interaction.commandName !== 'application-panel') {
        return false;
    }
    const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !isStaff(member)) {
        await interaction.reply(privateReply('Публиковать панель заявок может только стафф.'));
        return true;
    }
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('application:open').setLabel('Подать заявку').setStyle(ButtonStyle.Primary));
    if (!interaction.channel || !('send' in interaction.channel)) {
        await interaction.reply(privateReply('Не найден текстовый канал для публикации панели.'));
        return true;
    }
    await interaction.channel.send({
        embeds: [
            new EmbedBuilder()
                .setTitle('Заявка в семью Skooba')
                .setDescription('Нажми кнопку ниже и заполни анкету. После этого стафф назначит обзвон или примет решение.')
                .setColor(0x5865f2),
        ],
        components: [row],
    });
    await interaction.reply(privateReply('Панель заявок опубликована.'));
    return true;
}
export async function handleApplicationButton(interaction) {
    if (!interaction.customId.startsWith('application:')) {
        return false;
    }
    if (interaction.customId === 'application:open') {
        const modal = new ModalBuilder().setCustomId('application:modal').setTitle('Заявка в Skooba');
        modal.addComponents(inputRow('nickname', 'Игровой ник', TextInputStyle.Short), inputRow('age', 'Возраст', TextInputStyle.Short), inputRow('experience', 'Опыт / прошлые семьи', TextInputStyle.Paragraph), inputRow('timezone', 'Часовой пояс и удобное время обзвона', TextInputStyle.Short));
        await interaction.showModal(modal);
        return true;
    }
    const [, action, id] = interaction.customId.split(':');
    const applicationId = Number(id);
    const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !isStaff(member)) {
        await interaction.reply(privateReply('Действия с заявками доступны только стаффу.'));
        return true;
    }
    if (action === 'call') {
        const modal = new ModalBuilder().setCustomId(`application-call:${applicationId}`).setTitle('Назначить обзвон');
        modal.addComponents(inputRow('scheduled_for', 'Дата/время обзвона', TextInputStyle.Short), inputRow('notes', 'Комментарий', TextInputStyle.Paragraph, false));
        await interaction.showModal(modal);
        return true;
    }
    if (action === 'accept' || action === 'reject') {
        await resolveApplication(interaction, applicationId, action);
        return true;
    }
    return true;
}
export async function handleApplicationModal(interaction) {
    if (interaction.customId === 'application:modal') {
        if (!interaction.guild) {
            await interaction.reply(privateReply('Заявки работают только на сервере.'));
            return true;
        }
        const answers = {
            nickname: interaction.fields.getTextInputValue('nickname'),
            age: interaction.fields.getTextInputValue('age'),
            experience: interaction.fields.getTextInputValue('experience'),
            timezone: interaction.fields.getTextInputValue('timezone'),
        };
        const result = db
            .prepare('INSERT INTO applications (guild_id, user_id, answers_json) VALUES (?, ?, ?)')
            .run(interaction.guild.id, interaction.user.id, JSON.stringify(answers));
        const applicationId = Number(result.lastInsertRowid);
        await publishApplication(interaction, applicationId, answers);
        audit(interaction.guild.id, 'application.created', { applicationId, answers }, interaction.user.id, interaction.user.id);
        await interaction.reply(privateReply('Заявка отправлена. Ожидай ответа стаффа.'));
        return true;
    }
    if (interaction.customId.startsWith('application-call:')) {
        const applicationId = Number(interaction.customId.split(':')[1]);
        const scheduledFor = interaction.fields.getTextInputValue('scheduled_for');
        const notes = interaction.fields.getTextInputValue('notes');
        db.prepare('INSERT INTO call_schedules (application_id, scheduled_by, scheduled_for, notes) VALUES (?, ?, ?, ?)').run(applicationId, interaction.user.id, scheduledFor, notes);
        db.prepare('UPDATE applications SET status = ?, reviewer_id = ?, updated_at = unixepoch() WHERE id = ?').run('call_scheduled', interaction.user.id, applicationId);
        await interaction.reply(privateReply('Обзвон назначен.'));
        await notifyApplicationUser(interaction, applicationId, `Тебе назначен обзвон: ${scheduledFor}${notes ? `\nКомментарий: ${notes}` : ''}`);
        return true;
    }
    return false;
}
function inputRow(customId, label, style, required = true) {
    return new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId(customId).setLabel(label).setStyle(style).setRequired(required));
}
async function publishApplication(interaction, applicationId, answers) {
    if (!interaction.guild) {
        return;
    }
    const channel = await getConfiguredTextChannel(interaction.guild, 'application_review_channel_id');
    if (!channel) {
        return;
    }
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`application:call:${applicationId}`).setLabel('Назначить обзвон').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId(`application:accept:${applicationId}`).setLabel('Принять').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`application:reject:${applicationId}`).setLabel('Отклонить').setStyle(ButtonStyle.Danger));
    const message = await channel.send({
        embeds: [
            new EmbedBuilder()
                .setTitle(`Заявка #${applicationId}`)
                .setDescription(`<@${interaction.user.id}>`)
                .addFields({ name: 'Ник', value: answers.nickname }, { name: 'Возраст', value: answers.age }, { name: 'Опыт', value: answers.experience.slice(0, 1024) }, { name: 'Время обзвона', value: answers.timezone })
                .setColor(0xf1c40f),
        ],
        components: [row],
    });
    db.prepare('UPDATE applications SET review_message_id = ? WHERE id = ?').run(message.id, applicationId);
}
async function resolveApplication(interaction, applicationId, action) {
    if (!interaction.guild) {
        await interaction.reply(privateReply('Сервер не найден.'));
        return;
    }
    const row = db.prepare('SELECT user_id FROM applications WHERE id = ? AND guild_id = ?').get(applicationId, interaction.guild.id);
    if (!row) {
        await interaction.reply(privateReply('Заявка не найдена.'));
        return;
    }
    db.prepare('UPDATE applications SET status = ?, reviewer_id = ?, updated_at = unixepoch() WHERE id = ?').run(action === 'accept' ? 'accepted' : 'rejected', interaction.user.id, applicationId);
    if (action === 'accept') {
        const member = await interaction.guild.members.fetch(row.user_id).catch(() => null);
        const grantRoleId = getRoleRule(interaction.guild.id, 'application_accept').grantRoleId ?? getSetting(interaction.guild.id, 'family_role_id');
        if (member && grantRoleId) {
            await member.roles.add(grantRoleId).catch(() => undefined);
        }
    }
    audit(interaction.guild.id, `application.${action}`, { applicationId }, interaction.user.id, row.user_id);
    await sendToConfiguredChannel(interaction.guild, 'application_log_channel_id', `Заявка #${applicationId}: ${action === 'accept' ? 'принята' : 'отклонена'} модератором <@${interaction.user.id}>.`);
    await notifyApplicationUser(interaction, applicationId, action === 'accept' ? 'Твоя заявка в Skooba принята.' : 'Твоя заявка в Skooba отклонена.');
    await interaction.update({ content: `Заявка #${applicationId}: ${action === 'accept' ? 'принята' : 'отклонена'}.`, embeds: [], components: [] });
}
async function notifyApplicationUser(interaction, applicationId, content) {
    if (!interaction.guild) {
        return;
    }
    const row = db.prepare('SELECT user_id FROM applications WHERE id = ? AND guild_id = ?').get(applicationId, interaction.guild.id);
    if (!row) {
        return;
    }
    const member = await interaction.guild.members.fetch(row.user_id).catch(() => null);
    await member?.send(content).catch(() => undefined);
}
