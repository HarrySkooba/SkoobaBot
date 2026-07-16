import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, } from 'discord.js';
import { getRoleRule, getSetting } from '../database/settings.js';
import { audit, grantRolesToMember, isAdmin, memberHasRole, privateReply, uniqueRoleIds } from '../discord/helpers.js';
export function getApplicationAcceptRoleIds(guildId, applicationType = 'capt_mcl') {
    const rule = getRoleRule(guildId, 'application_accept');
    const roleIds = uniqueRoleIds([
        getSetting(guildId, 'family_role_id'),
        getSetting(guildId, 'unverified_role_id'),
        rule.grantRoleId,
    ]);
    if (applicationType === 'rp') {
        return uniqueRoleIds([...roleIds, getSetting(guildId, 'rp_role_id')]);
    }
    return roleIds;
}
export async function grantApplicationAcceptRoles(member, applicationType = 'capt_mcl') {
    return grantRolesToMember(member, getApplicationAcceptRoleIds(member.guild.id, applicationType));
}
export async function handleRoleRecoveryCommand(interaction) {
    if (interaction.commandName !== 'role-panel') {
        return false;
    }
    const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !isAdmin(member)) {
        await interaction.reply(privateReply('Панель ролей может публиковать только админ.'));
        return true;
    }
    if (!interaction.channel || !('send' in interaction.channel)) {
        await interaction.reply(privateReply('Не найден текстовый канал для публикации панели.'));
        return true;
    }
    await interaction.channel.send({
        embeds: [
            new EmbedBuilder()
                .setTitle('Получение ролей семьи')
                .setDescription('Если после принятия заявки или сбоя бота у тебя нет нужной роли, нажми кнопку ниже. Выдается только отсутствующая роль.')
                .setColor(0x5865f2),
        ],
        components: [buildRoleRecoveryButtons()],
    });
    await interaction.reply(privateReply('Панель ролей опубликована.'));
    return true;
}
export async function handleRoleRecoveryButton(interaction) {
    if (!interaction.customId.startsWith('roles:')) {
        return false;
    }
    if (!interaction.guild) {
        await interaction.reply(privateReply('Роли выдаются только на сервере.'));
        return true;
    }
    const roleKey = interaction.customId.split(':')[1];
    if (roleKey !== 'family' && roleKey !== 'unverified') {
        return true;
    }
    const settingKey = roleKey === 'family' ? 'family_role_id' : 'unverified_role_id';
    const roleId = getSetting(interaction.guild.id, settingKey);
    if (!roleId) {
        await interaction.reply(privateReply(`Роль не настроена: \`${settingKey}\`. Обратись к админу.`));
        return true;
    }
    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member) {
        await interaction.reply(privateReply('Не удалось получить данные участника на сервере.'));
        return true;
    }
    if (memberHasRole(member, roleId)) {
        await interaction.reply(privateReply(`У тебя уже есть роль <@&${roleId}>.`));
        return true;
    }
    const granted = await grantRolesToMember(member, [roleId]);
    if (!granted.length) {
        await interaction.reply(privateReply('Не удалось выдать роль. Проверь, что роль бота выше этой роли.'));
        return true;
    }
    audit(interaction.guild.id, 'roles.recovered', { settingKey, roleId }, interaction.user.id, interaction.user.id);
    await interaction.reply(privateReply(`Роль выдана: <@&${roleId}>.`));
    return true;
}
function buildRoleRecoveryButtons() {
    return new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('roles:family').setLabel('Получить роль семьи').setStyle(ButtonStyle.Primary), new ButtonBuilder().setCustomId('roles:unverified').setLabel('Получить Unverified').setStyle(ButtonStyle.Secondary));
}
