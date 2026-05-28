import { SlashCommandBuilder, ChannelType, PermissionFlagsBits } from 'discord.js';
export const commands = [
    new SlashCommandBuilder()
        .setName('admin-panel')
        .setDescription('Создать или обновить приватную админ-панель бота.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
    new SlashCommandBuilder()
        .setName('setting')
        .setDescription('Посмотреть или изменить настройку бота.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addSubcommand((subcommand) => subcommand
        .setName('set')
        .setDescription('Изменить настройку.')
        .addStringOption((option) => option
        .setName('key')
        .setDescription('Ключ настройки.')
        .setRequired(true))
        .addStringOption((option) => option.setName('value').setDescription('ID роли, канала или категории.').setRequired(true)))
        .addSubcommand((subcommand) => subcommand.setName('list').setDescription('Показать текущие настройки.'))
        .addSubcommand((subcommand) => subcommand
        .setName('delete')
        .setDescription('Удалить настройку по ключу, в том числе устаревшую.')
        .addStringOption((option) => option.setName('key').setDescription('Ключ настройки, например kapt_tier_1_role_id.').setRequired(true))),
    new SlashCommandBuilder()
        .setName('role-rule')
        .setDescription('Настроить правило проверки и выдачи ролей.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((option) => option
        .setName('scenario')
        .setDescription('Сценарий, например application_accept или cheat_clean.')
        .setRequired(true))
        .addRoleOption((option) => option.setName('check_role').setDescription('Роль, которая требуется для сценария.'))
        .addRoleOption((option) => option.setName('grant_role').setDescription('Роль, которая выдается после успеха.')),
    new SlashCommandBuilder()
        .setName('application-panel')
        .setDescription('Опубликовать панель заявок (Components v2).')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
        .setName('application-intake')
        .setDescription('Открыть или закрыть приём заявок на панели.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand((subcommand) => subcommand.setName('open').setDescription('Открыть приём заявок.'))
        .addSubcommand((subcommand) => subcommand.setName('close').setDescription('Закрыть приём заявок.')),
    new SlashCommandBuilder()
        .setName('role-panel')
        .setDescription('Опубликовать панель самовыдачи ролей семьи и Unverified.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
        .setName('cheat-panel')
        .setDescription('Опубликовать сообщение с кнопкой заявки на проверку читов.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
        .setName('cheat-remove')
        .setDescription('Убрать игрока из активной очереди проверки на читы.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption((option) => option.setName('player').setDescription('Игрок, которого нужно убрать из очереди.').setRequired(true))
        .addStringOption((option) => option.setName('reason').setDescription('Причина удаления из очереди.')),
    new SlashCommandBuilder()
        .setName('profile-panel')
        .setDescription('Опубликовать сообщение с кнопкой создания личного профиля.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild),
    new SlashCommandBuilder()
        .setName('profile-promote')
        .setDescription('Повысить или изменить тир профиля игрока.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption((option) => option.setName('player').setDescription('Игрок.').setRequired(true))
        .addIntegerOption((option) => option
        .setName('tier')
        .setDescription('Новый тир.')
        .setRequired(true)
        .addChoices({ name: 'Тир 1', value: 1 }, { name: 'Тир 2', value: 2 }, { name: 'Тир 3', value: 3 }))
        .addStringOption((option) => option.setName('reason').setDescription('Причина повышения.')),
    new SlashCommandBuilder()
        .setName('profile-delete')
        .setDescription('Принудительно удалить профиль игрока (канал, роли тира, запись в БД).')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption((option) => option.setName('player').setDescription('Игрок.').setRequired(true))
        .addStringOption((option) => option.setName('reason').setDescription('Причина удаления.')),
    new SlashCommandBuilder()
        .setName('event-create-capt')
        .setDescription('Создать мероприятие Капт.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((option) => option.setName('start_time').setDescription('Время начала, например 21:00 26.05.2026.').setRequired(true))
        .addStringOption((option) => option.setName('voice_time').setDescription('Время захода в войс, например 20:45 26.05.2026.').setRequired(true))
        .addStringOption((option) => option
        .setName('side')
        .setDescription('Сторона: атака или деф.')
        .setRequired(true)
        .addChoices({ name: 'Attack', value: 'attack' }, { name: 'Deff', value: 'deff' }))
        .addStringOption((option) => option.setName('map').setDescription('Карта.').setRequired(true))
        .addAttachmentOption((option) => option.setName('photo').setDescription('Фото для сообщения (необязательно).'))
        .addChannelOption((option) => option
        .setName('voice')
        .setDescription('Voice для проверки. Если не указан — default_voice_channel_id.')
        .addChannelTypes(ChannelType.GuildVoice)),
    new SlashCommandBuilder()
        .setName('event-create-mcl')
        .setDescription('Создать мероприятие МЦЛ или ВЗЗ.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addStringOption((option) => option
        .setName('subtype')
        .setDescription('Тип: МЦЛ или ВЗЗ.')
        .setRequired(true)
        .addChoices({ name: 'МЦЛ', value: 'mcl' }, { name: 'ВЗЗ', value: 'vzz' }))
        .addStringOption((option) => option.setName('start_time').setDescription('Время начала.').setRequired(true))
        .addStringOption((option) => option.setName('teleport_time').setDescription('Время телепортации.').setRequired(true))
        .addStringOption((option) => option.setName('voice_time').setDescription('Время захода в войс.').setRequired(true))
        .addStringOption((option) => option.setName('player_count').setDescription('Количество игроков, например 15.').setRequired(true))
        .addAttachmentOption((option) => option.setName('photo').setDescription('Фото для сообщения (необязательно).'))
        .addChannelOption((option) => option
        .setName('voice')
        .setDescription('Voice для проверки. Если не указан — default_voice_channel_id.')
        .addChannelTypes(ChannelType.GuildVoice)),
    new SlashCommandBuilder()
        .setName('attendance')
        .setDescription('Показать историю неявок игрока.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
        .addUserOption((option) => option.setName('player').setDescription('Игрок.').setRequired(true)),
].map((command) => command.toJSON());
