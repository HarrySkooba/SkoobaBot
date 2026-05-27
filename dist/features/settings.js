import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder, PermissionsBitField, } from 'discord.js';
import { audit, isAdmin, privateReply, quoteId, requireAdmin } from '../discord/helpers.js';
import { getSetting, isSettingKey, listSettings, setRoleRule, setSetting } from '../database/settings.js';
export async function handleSettingsCommand(interaction) {
    if (interaction.commandName === 'admin-panel') {
        const member = await requireAdmin(interaction);
        if (!member || !interaction.guild) {
            return true;
        }
        const channel = await ensureAdminPanelChannel(interaction.guild, interaction.user.id);
        await postAdminPanel(channel);
        await interaction.reply(privateReply(`Админ-панель готова: ${channel}.`));
        return true;
    }
    if (interaction.commandName === 'setting') {
        const member = await requireAdmin(interaction);
        if (!member || !interaction.guild) {
            return true;
        }
        const subcommand = interaction.options.getSubcommand();
        if (subcommand === 'set') {
            const key = interaction.options.getString('key', true);
            const value = interaction.options.getString('value', true).replace(/[<#@&>]/g, '');
            if (!isSettingKey(key)) {
                await interaction.reply(privateReply('Неизвестный ключ настройки.'));
                return true;
            }
            setSetting(interaction.guild.id, key, value, interaction.user.id);
            audit(interaction.guild.id, 'setting.updated', { key, value }, interaction.user.id);
            await interaction.reply(privateReply(`Настройка \`${key}\` сохранена: \`${value}\`.`));
            return true;
        }
        const settings = listSettings(interaction.guild.id);
        const body = Object.entries(settings)
            .map(([key, value]) => `\`${key}\`: \`${value}\``)
            .join('\n') || 'Настройки пока не заданы.';
        await interaction.reply(privateReply(body.slice(0, 1900)));
        return true;
    }
    if (interaction.commandName === 'role-rule') {
        const member = await requireAdmin(interaction);
        if (!member || !interaction.guild) {
            return true;
        }
        const scenario = interaction.options.getString('scenario', true);
        const checkRole = interaction.options.getRole('check_role');
        const grantRole = interaction.options.getRole('grant_role');
        setRoleRule(interaction.guild.id, scenario, checkRole?.id ?? null, grantRole?.id ?? null, interaction.user.id);
        audit(interaction.guild.id, 'role_rule.updated', { scenario, checkRoleId: checkRole?.id ?? null, grantRoleId: grantRole?.id ?? null }, interaction.user.id);
        await interaction.reply(privateReply(`Правило \`${scenario}\` сохранено. Проверка: ${quoteId(checkRole?.id ?? null)}, выдача: ${quoteId(grantRole?.id ?? null)}.`));
        return true;
    }
    return false;
}
export async function handleSettingsButton(interaction) {
    if (!interaction.customId.startsWith('settings:')) {
        return false;
    }
    const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !isAdmin(member)) {
        await interaction.reply(privateReply('Админ-панель доступна только администраторам.'));
        return true;
    }
    if (interaction.customId === 'settings:summary') {
        const settings = listSettings(interaction.guildId ?? '');
        const body = Object.entries(settings)
            .map(([key, value]) => `\`${key}\`: \`${value}\``)
            .join('\n') || 'Настройки пока не заданы.';
        await interaction.reply(privateReply(body.slice(0, 1900)));
        return true;
    }
    if (interaction.customId === 'settings:help') {
        await interaction.reply(privateReply([
            'Используй `/setting set key:<ключ> value:<id>` для ролей, каналов и категорий.',
            'Используй `/role-rule` для правил: какая роль проверяется и какая выдается.',
            'Пример сценариев: `application_accept`, `cheat_clean`.',
        ].join('\n')));
        return true;
    }
    return true;
}
async function ensureAdminPanelChannel(guild, actorId) {
    const configuredChannelId = getSetting(guild.id, 'admin_panel_channel_id');
    const configured = configuredChannelId ? await guild.channels.fetch(configuredChannelId).catch(() => null) : null;
    if (configured?.type === ChannelType.GuildText) {
        return configured;
    }
    const everyone = guild.roles.everyone;
    const adminRoleId = getSetting(guild.id, 'admin_role_id');
    const channel = await guild.channels.create({
        name: 'skooba-bot-admin',
        type: ChannelType.GuildText,
        permissionOverwrites: [
            { id: everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
            ...(adminRoleId ? [{ id: adminRoleId, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory] }] : []),
            { id: guild.client.user.id, allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ManageMessages] },
        ],
    });
    setSetting(guild.id, 'admin_panel_channel_id', channel.id, actorId);
    audit(guild.id, 'admin_panel.created', { channelId: channel.id }, actorId);
    return channel;
}
async function postAdminPanel(channel) {
    const embed = new EmbedBuilder()
        .setTitle('Админ-панель Skooba Bot')
        .setDescription('Здесь админы настраивают роли, каналы, проверки, выдачу ролей и доступ к функциям.')
        .addFields({ name: 'Настройки', value: '`/setting set` и кнопка ниже покажут текущие значения.' }, { name: 'Правила ролей', value: '`/role-rule` задает проверяемую и выдаваемую роль для сценариев.' })
        .setColor(0x2b2d31);
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('settings:summary').setLabel('Показать настройки').setStyle(ButtonStyle.Secondary), new ButtonBuilder().setCustomId('settings:help').setLabel('Как настраивать').setStyle(ButtonStyle.Primary));
    await channel.send({ embeds: [embed], components: [row] });
}
