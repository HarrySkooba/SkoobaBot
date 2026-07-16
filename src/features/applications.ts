import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  ChatInputCommandInteraction,
  EmbedBuilder,
  Guild,
  MessageFlags,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { db } from '../database/db.js';
import { getSetting, setSetting } from '../database/settings.js';
import { isApplicationsOpen, refreshApplicationPanel, sendApplicationPanel } from '../discord/applicationPanelV2.js';
import {
  audit,
  getConfiguredTextChannel,
  isStaff,
  privateReply,
  safeDm,
  sendToConfiguredChannel,
  uniqueRoleIds,
} from '../discord/helpers.js';
import { grantApplicationAcceptRoles, type ApplicationType } from './roleRecovery.js';

type ApplicationAnswers = Record<string, string> & { application_type?: ApplicationType };

type ApplicationRow = {
  id: number;
  guild_id: string;
  user_id: string;
  status: string;
  answers_json: string;
  reviewer_id: string | null;
  review_message_id: string | null;
  reject_reason: string | null;
};

export async function handleApplicationCommand(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (interaction.commandName === 'application-intake') {
    const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !isStaff(member)) {
      await interaction.reply(privateReply('Приём заявок могут менять только стафф.'));
      return true;
    }

    if (!interaction.guild) {
      await interaction.reply(privateReply('Команда работает только на сервере.'));
      return true;
    }

    const subcommand = interaction.options.getSubcommand();
    const open = subcommand === 'open';
    setSetting(interaction.guild.id, 'applications_open', open ? 'true' : 'false', interaction.user.id);

    const updated = await refreshApplicationPanel(interaction.client, interaction.guild.id);
    if (!updated) {
      await interaction.reply(
        privateReply(
          `Приём заявок ${open ? 'открыт' : 'закрыт'}, но панель не обновлена: сначала опубликуй \`/application-panel\` в канале заявок.`,
        ),
      );
      return true;
    }

    await interaction.reply(privateReply(`Приём заявок ${open ? 'открыт' : 'закрыт'}. Панель обновлена.`));
    return true;
  }

  if (interaction.commandName !== 'application-panel') {
    return false;
  }

  const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
  if (!member || !isStaff(member)) {
    await interaction.reply(privateReply('Публиковать панель заявок может только стафф.'));
    return true;
  }

  if (!interaction.channel || interaction.channel.type !== ChannelType.GuildText) {
    await interaction.reply(privateReply('Не найден текстовый канал для публикации панели.'));
    return true;
  }

  if (!interaction.guild) {
    await interaction.reply(privateReply('Команда работает только на сервере.'));
    return true;
  }

  try {
    await sendApplicationPanel(interaction.channel, interaction.guild.id, interaction.user.id);
  } catch (error) {
    console.error('Failed to send application panel (Components v2):', error);
    await interaction.reply(
      privateReply(
        'Не удалось опубликовать панель. Проверь URL баннера (`application_panel_banner_url`) и права бота в канале.',
      ),
    );
    return true;
  }

  await interaction.reply(
    privateReply(
      'Панель заявок опубликована (Components v2). Баннер: `/setting set key:application_panel_banner_url`. Приём: `/application-intake open|close`.',
    ),
  );
  return true;
}

export async function handleApplicationButton(interaction: ButtonInteraction): Promise<boolean> {
  if (!interaction.customId.startsWith('application:')) {
    return false;
  }

  if (!interaction.guild) {
    await interaction.reply(privateReply('Заявки работают только на сервере.'));
    return true;
  }

  if (interaction.customId === 'application:open:capt_mcl' || interaction.customId === 'application:open') {
    if (!isApplicationsOpen(interaction.guild.id)) {
      await interaction.reply(privateReply('Приём заявок сейчас закрыт.'));
      return true;
    }

    const modal = new ModalBuilder().setCustomId('application:modal:capt_mcl').setTitle('Заявка в Skooba (капт/mcl)');
    modal.addComponents(
      inputRow('identity', 'Ник в игре | Статик | Возраст', TextInputStyle.Short, {
        placeholder: 'Harry Skooba | 5595 | 21',
      }),
      inputRow('majestic_experience', 'Опыт на Majestic', TextInputStyle.Paragraph, {
        placeholder: '15 server - 1год, 09 server - 2года',
      }),
      inputRow('families', 'В каких семьях состоял и почему ушел', TextInputStyle.Paragraph, {
        placeholder: 'Название - Причина',
      }),
      inputRow('referral_source', 'Откуда узнали о семье?', TextInputStyle.Paragraph),
      inputRow('rollbacks', 'Откаты', TextInputStyle.Paragraph, {
        placeholder: 'GG - ссылка, MCL - ссылка, CAPT - ссылка',
      }),
    );
    await interaction.showModal(modal);
    return true;
  }

  if (interaction.customId === 'application:open:rp') {
    if (!isApplicationsOpen(interaction.guild.id)) {
      await interaction.reply(privateReply('Приём заявок сейчас закрыт.'));
      return true;
    }

    const modal = new ModalBuilder().setCustomId('application:modal:rp').setTitle('Заявка в Skooba (РП)');
    modal.addComponents(
      inputRow('identity', 'Ник в игре | Статик | Возраст', TextInputStyle.Short, {
        placeholder: 'Harry Skooba | 5595 | 21',
      }),
      inputRow('online_timezone', 'Средний онлайн | Часовой пояс', TextInputStyle.Short, {
        placeholder: '4-6 часов | UTC+3',
      }),
    );
    await interaction.showModal(modal);
    return true;
  }

  const [, action, id] = interaction.customId.split(':');
  const applicationId = Number(id);
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member || !isStaff(member)) {
    await interaction.reply(privateReply('Действия с заявками доступны только стаффу.'));
    return true;
  }

  const application = getApplication(interaction.guild.id, applicationId);
  if (!application) {
    await interaction.reply(privateReply('Заявка не найдена.'));
    return true;
  }

  if (application.status === 'accepted' || application.status === 'rejected') {
    await interaction.reply(privateReply('Заявка уже закрыта.'));
    return true;
  }

  if (action === 'call') {
    const modal = new ModalBuilder().setCustomId(`application-call:${applicationId}`).setTitle('Назначить обзвон');
    modal.addComponents(
      inputRow('scheduled_for', 'Дата/время обзвона', TextInputStyle.Short),
      inputRow('notes', 'Комментарий', TextInputStyle.Paragraph, { required: false }),
    );
    await interaction.showModal(modal);
    return true;
  }

  if (action === 'reject') {
    const modal = new ModalBuilder().setCustomId(`application-reject:${applicationId}`).setTitle('Отклонить заявку');
    modal.addComponents(inputRow('reason', 'Причина отказа', TextInputStyle.Paragraph));
    await interaction.showModal(modal);
    return true;
  }

  if (action === 'accept') {
    await resolveApplication(interaction, applicationId, 'accept');
    return true;
  }

  return true;
}

export async function handleApplicationModal(interaction: ModalSubmitInteraction): Promise<boolean> {
  if (interaction.customId === 'application:modal:capt_mcl' || interaction.customId === 'application:modal') {
    if (!interaction.guild) {
      await interaction.reply(privateReply('Заявки работают только на сервере.'));
      return true;
    }

    if (!isApplicationsOpen(interaction.guild.id)) {
      await interaction.reply(privateReply('Приём заявок сейчас закрыт.'));
      return true;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const answers: ApplicationAnswers = {
      application_type: 'capt_mcl',
      identity: interaction.fields.getTextInputValue('identity'),
      majestic_experience: interaction.fields.getTextInputValue('majestic_experience'),
      families: interaction.fields.getTextInputValue('families'),
      referral_source: interaction.fields.getTextInputValue('referral_source'),
      rollbacks: interaction.fields.getTextInputValue('rollbacks'),
    };
    const result = db
      .prepare('INSERT INTO applications (guild_id, user_id, answers_json) VALUES (?, ?, ?)')
      .run(interaction.guild.id, interaction.user.id, JSON.stringify(answers));
    const applicationId = Number(result.lastInsertRowid);
    await publishApplication(interaction.guild, applicationId, interaction.user.id, answers);
    audit(interaction.guild.id, 'application.created', { applicationId, answers }, interaction.user.id, interaction.user.id);
    await interaction.editReply('Заявка отправлена. Ожидай ответа стаффа.');
    return true;
  }

  if (interaction.customId === 'application:modal:rp') {
    if (!interaction.guild) {
      await interaction.reply(privateReply('Заявки работают только на сервере.'));
      return true;
    }

    if (!isApplicationsOpen(interaction.guild.id)) {
      await interaction.reply(privateReply('Приём заявок сейчас закрыт.'));
      return true;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const answers: ApplicationAnswers = {
      application_type: 'rp',
      identity: interaction.fields.getTextInputValue('identity'),
      online_timezone: interaction.fields.getTextInputValue('online_timezone'),
    };
    const result = db
      .prepare('INSERT INTO applications (guild_id, user_id, answers_json) VALUES (?, ?, ?)')
      .run(interaction.guild.id, interaction.user.id, JSON.stringify(answers));
    const applicationId = Number(result.lastInsertRowid);
    await publishApplication(interaction.guild, applicationId, interaction.user.id, answers);
    audit(interaction.guild.id, 'application.created', { applicationId, answers }, interaction.user.id, interaction.user.id);
    await interaction.editReply('Заявка в РП отправлена. Ожидай ответа стаффа.');
    return true;
  }

  if (interaction.customId.startsWith('application-call:')) {
    if (!interaction.guild) {
      await interaction.reply(privateReply('Заявки работают только на сервере.'));
      return true;
    }

    const applicationId = Number(interaction.customId.split(':')[1]);
    const application = getApplication(interaction.guild.id, applicationId);
    if (!application) {
      await interaction.reply(privateReply('Заявка не найдена.'));
      return true;
    }

    if (application.status === 'accepted' || application.status === 'rejected') {
      await interaction.reply(privateReply('Заявка уже закрыта.'));
      return true;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const scheduledFor = interaction.fields.getTextInputValue('scheduled_for');
    const notes = interaction.fields.getTextInputValue('notes');
    db.prepare('INSERT INTO call_schedules (application_id, scheduled_by, scheduled_for, notes) VALUES (?, ?, ?, ?)').run(
      applicationId,
      interaction.user.id,
      scheduledFor,
      notes,
    );
    db.prepare('UPDATE applications SET status = ?, reviewer_id = ?, updated_at = unixepoch() WHERE id = ?').run(
      'call_scheduled',
      interaction.user.id,
      applicationId,
    );
    await refreshReviewMessage(interaction.guild, applicationId);
    audit(interaction.guild.id, 'application.call_scheduled', { applicationId, scheduledFor, notes }, interaction.user.id, application.user_id);
    await sendToConfiguredChannel(
      interaction.guild,
      'application_log_channel_id',
      `Заявка #${applicationId}: обзвон назначен модератором <@${interaction.user.id}> на ${scheduledFor}.`,
    );
    await notifyApplicationUser(interaction.guild, applicationId, `Тебе назначен обзвон: ${scheduledFor}${notes ? `\nКомментарий: ${notes}` : ''}`);
    await interaction.editReply('Обзвон назначен. Сообщение заявки обновлено.');
    return true;
  }

  if (interaction.customId.startsWith('application-reject:')) {
    if (!interaction.guild) {
      await interaction.reply(privateReply('Заявки работают только на сервере.'));
      return true;
    }

    const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
    if (!member || !isStaff(member)) {
      await interaction.reply(privateReply('Отклонять заявки могут только стафф.'));
      return true;
    }

    const applicationId = Number(interaction.customId.split(':')[1]);
    const application = getApplication(interaction.guild.id, applicationId);
    if (!application) {
      await interaction.reply(privateReply('Заявка не найдена.'));
      return true;
    }

    if (application.status === 'accepted' || application.status === 'rejected') {
      await interaction.reply(privateReply('Заявка уже закрыта.'));
      return true;
    }

    const reason = interaction.fields.getTextInputValue('reason').trim();
    if (!reason) {
      await interaction.reply(privateReply('Укажи причину отказа.'));
      return true;
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    await resolveApplication(interaction, applicationId, 'reject', reason);
    await interaction.editReply('Заявка отклонена. Сообщение обновлено.');
    return true;
  }

  return false;
}

function inputRow(
  customId: string,
  label: string,
  style: TextInputStyle,
  options: { required?: boolean; placeholder?: string } = {},
) {
  const input = new TextInputBuilder()
    .setCustomId(customId)
    .setLabel(label)
    .setStyle(style)
    .setRequired(options.required ?? true);

  if (options.placeholder) {
    input.setPlaceholder(options.placeholder.slice(0, 100));
  }

  return new ActionRowBuilder<TextInputBuilder>().addComponents(input);
}

function truncateEmbedField(value: string, max = 1024): string {
  return value.length > max ? `${value.slice(0, max - 3)}...` : value;
}

function parseAnswers(answersJson: string): ApplicationAnswers {
  return JSON.parse(answersJson) as ApplicationAnswers;
}

function getApplicationType(answers: ApplicationAnswers): ApplicationType {
  return answers.application_type === 'rp' ? 'rp' : 'capt_mcl';
}

function applicationTypeLabel(type: ApplicationType): string {
  return type === 'rp' ? 'РП' : 'капт/mcl';
}

function extractApplicantNick(answers: ApplicationAnswers): string {
  const identity = answers.identity ?? '';
  const nick = identity.split('|')[0]?.trim();
  return nick || 'Игрок';
}

function getApplication(guildId: string, applicationId: number): ApplicationRow | undefined {
  return db.prepare('SELECT * FROM applications WHERE id = ? AND guild_id = ?').get(applicationId, guildId) as ApplicationRow | undefined;
}

function getLatestCallSchedule(applicationId: number): { scheduled_for: string; notes: string | null } | undefined {
  return db
    .prepare('SELECT scheduled_for, notes FROM call_schedules WHERE application_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(applicationId) as { scheduled_for: string; notes: string | null } | undefined;
}

function applicationStatusLabel(status: string, scheduledFor?: string | null): string {
  switch (status) {
    case 'pending':
      return 'Ожидает рассмотрения';
    case 'call_scheduled':
      return scheduledFor ? `Обзвон назначен: ${scheduledFor}` : 'Обзвон назначен';
    case 'accepted':
      return 'Принята';
    case 'rejected':
      return 'Отклонена';
    default:
      return status;
  }
}

function applicationStatusColor(status: string): number {
  switch (status) {
    case 'accepted':
      return 0x57f287;
    case 'rejected':
      return 0xed4245;
    case 'call_scheduled':
      return 0x5865f2;
    default:
      return 0xf1c40f;
  }
}

function buildApplicationTitle(applicationId: number, answers: ApplicationAnswers, status: string): string {
  const nick = extractApplicantNick(answers);
  const typeLabel = applicationTypeLabel(getApplicationType(answers));
  if (status === 'accepted') {
    return `Заявка #${applicationId} (${typeLabel}): принята — ${nick}`;
  }
  if (status === 'rejected') {
    return `Заявка #${applicationId} (${typeLabel}): отклонена — ${nick}`;
  }
  return `Заявка #${applicationId} (${typeLabel}) — ${nick}`;
}

function buildApplicationEmbed(
  application: ApplicationRow,
  answers: ApplicationAnswers,
  options?: { resolvedById?: string; resolvedAction?: 'accept' | 'reject' },
): EmbedBuilder {
  const schedule = getLatestCallSchedule(application.id);
  const status = options?.resolvedAction
    ? options.resolvedAction === 'accept'
      ? 'accepted'
      : 'rejected'
    : application.status;
  const statusText = applicationStatusLabel(status, schedule?.scheduled_for);
  const descriptionLines = [`Игрок: <@${application.user_id}>`];

  if (options?.resolvedById) {
    descriptionLines.push(`Решение: ${options.resolvedAction === 'accept' ? 'принята' : 'отклонена'} модератором <@${options.resolvedById}>`);
  }

  const embed = new EmbedBuilder()
    .setTitle(buildApplicationTitle(application.id, answers, status))
    .setDescription(descriptionLines.join('\n'))
    .setColor(applicationStatusColor(status))
    .addFields({ name: 'Статус', value: statusText });

  if (schedule?.notes) {
    embed.addFields({ name: 'Комментарий к обзвону', value: truncateEmbedField(schedule.notes, 256) });
  }

  if (status === 'rejected' && application.reject_reason) {
    embed.addFields({ name: 'Причина отказа', value: truncateEmbedField(application.reject_reason, 1024) });
  }

  const applicationType = getApplicationType(answers);
  if (applicationType === 'rp') {
    embed.addFields(
      { name: 'Ник | Статик | Возраст', value: truncateEmbedField(answers.identity ?? '—') },
      { name: 'Средний онлайн | Часовой пояс', value: truncateEmbedField(answers.online_timezone ?? '—') },
    );
  } else {
    embed
      .addFields(
        { name: 'Ник | Статик | Возраст', value: truncateEmbedField(answers.identity ?? '—') },
        { name: 'Опыт на Majestic', value: truncateEmbedField(answers.majestic_experience ?? '—') },
        { name: 'Семьи и причины ухода', value: truncateEmbedField(answers.families ?? '—') },
        { name: 'Откуда узнали о семье', value: truncateEmbedField(answers.referral_source ?? '—') },
        { name: 'Откаты', value: truncateEmbedField(answers.rollbacks ?? '—') },
      );
  }

  return embed;
}

function reviewButtons(applicationId: number): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`application:call:${applicationId}`).setLabel('Назначить обзвон').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`application:accept:${applicationId}`).setLabel('Принять').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`application:reject:${applicationId}`).setLabel('Отклонить').setStyle(ButtonStyle.Danger),
  );
}

function buildReviewChannelContent(guildId: string, applicationType: ApplicationType): { content: string; allowedMentions: { roles: string[] } | { parse: [] } } {
  const staffRoleId = getSetting(guildId, 'staff_role_id');
  const typeLabel = applicationTypeLabel(applicationType);
  if (!staffRoleId) {
    return { content: `Новая заявка в семью Skooba (${typeLabel}).`, allowedMentions: { parse: [] } };
  }

  return {
    content: `<@&${staffRoleId}> новая заявка в семью Skooba (${typeLabel}).`,
    allowedMentions: { roles: [staffRoleId] },
  };
}

async function notifyStaffAndAdmins(
  guild: Guild,
  applicationId: number,
  applicantId: string,
  applicantNick: string,
  applicationType: ApplicationType,
) {
  const roleIds = uniqueRoleIds([getSetting(guild.id, 'staff_role_id'), getSetting(guild.id, 'admin_role_id')]);
  if (!roleIds.length) {
    return;
  }

  const typeLabel = applicationTypeLabel(applicationType);
  const members = await guild.members.fetch();
  const notified = new Set<string>();

  for (const member of members.values()) {
    if (member.user.bot || notified.has(member.id)) {
      continue;
    }

    if (!roleIds.some((roleId) => member.roles.cache.has(roleId))) {
      continue;
    }

    notified.add(member.id);
    await safeDm(
      member,
      `Новая заявка в семью Skooba (${typeLabel}) #${applicationId} от **${applicantNick}** (<@${applicantId}>). Проверь канал рассмотрения заявок.`,
    );
  }
}

async function publishApplication(guild: Guild, applicationId: number, userId: string, answers: ApplicationAnswers) {
  const channel = await getConfiguredTextChannel(guild, 'application_review_channel_id');
  if (!channel) {
    return;
  }

  const application = getApplication(guild.id, applicationId);
  if (!application) {
    return;
  }

  const reviewContent = buildReviewChannelContent(guild.id, getApplicationType(answers));
  const message = await channel.send({
    ...reviewContent,
    embeds: [buildApplicationEmbed(application, answers)],
    components: [reviewButtons(applicationId)],
  });

  db.prepare('UPDATE applications SET review_message_id = ? WHERE id = ?').run(message.id, applicationId);
  await notifyStaffAndAdmins(guild, applicationId, userId, extractApplicantNick(answers), getApplicationType(answers));
}

async function refreshReviewMessage(guild: Guild, applicationId: number): Promise<void> {
  const application = getApplication(guild.id, applicationId);
  if (!application?.review_message_id) {
    return;
  }

  const channel = await getConfiguredTextChannel(guild, 'application_review_channel_id');
  if (!channel) {
    return;
  }

  const message = await channel.messages.fetch(application.review_message_id).catch(() => null);
  if (!message) {
    return;
  }

  const answers = parseAnswers(application.answers_json);
  const isClosed = application.status === 'accepted' || application.status === 'rejected';

  await message.edit({
    embeds: [
      buildApplicationEmbed(application, answers, {
        resolvedById: isClosed ? application.reviewer_id ?? undefined : undefined,
        resolvedAction: application.status === 'accepted' ? 'accept' : application.status === 'rejected' ? 'reject' : undefined,
      }),
    ],
    components: isClosed ? [] : [reviewButtons(applicationId)],
  });
}

async function resolveApplication(
  interaction: ButtonInteraction | ModalSubmitInteraction,
  applicationId: number,
  action: 'accept' | 'reject',
  rejectReason?: string,
) {
  if (!interaction.guild) {
    if (interaction.isButton()) {
      await interaction.reply(privateReply('Сервер не найден.'));
    }
    return;
  }

  if (interaction.isButton()) {
    await interaction.deferUpdate();
  }

  const application = getApplication(interaction.guild.id, applicationId);
  if (!application) {
    if (interaction.isButton()) {
      await interaction.followUp(privateReply('Заявка не найдена.'));
    }
    return;
  }

  const answers = parseAnswers(application.answers_json);
  const applicationType = getApplicationType(answers);

  db.prepare(
    `UPDATE applications
     SET status = ?, reviewer_id = ?, reject_reason = ?, updated_at = unixepoch()
     WHERE id = ?`,
  ).run(action === 'accept' ? 'accepted' : 'rejected', interaction.user.id, action === 'reject' ? (rejectReason ?? null) : null, applicationId);

  if (action === 'accept') {
    const member = await interaction.guild.members.fetch(application.user_id).catch(() => null);
    if (member) {
      await grantApplicationAcceptRoles(member, applicationType);
    }
  }

  const updatedApplication = getApplication(interaction.guild.id, applicationId)!;

  audit(interaction.guild.id, `application.${action}`, { applicationId, rejectReason }, interaction.user.id, application.user_id);
  await sendToConfiguredChannel(
    interaction.guild,
    'application_log_channel_id',
    `Заявка #${applicationId}: ${action === 'accept' ? 'принята' : 'отклонена'} модератором <@${interaction.user.id}>.${
      rejectReason ? ` Причина: ${rejectReason}` : ''
    }`,
  );
  await notifyApplicationUser(
    interaction.guild,
    applicationId,
    action === 'accept'
      ? `Твоя заявка в Skooba (${applicationTypeLabel(applicationType)}) принята.`
      : `Твоя заявка в Skooba (${applicationTypeLabel(applicationType)}) отклонена.${rejectReason ? `\nПричина: ${rejectReason}` : ''}`,
  );

  const reviewMessageId = application.review_message_id;
  if (reviewMessageId) {
    const channel = await getConfiguredTextChannel(interaction.guild, 'application_review_channel_id');
    const message = channel ? await channel.messages.fetch(reviewMessageId).catch(() => null) : null;
    await message
      ?.edit({
        embeds: [
          buildApplicationEmbed(updatedApplication, answers, {
            resolvedById: interaction.user.id,
            resolvedAction: action,
          }),
        ],
        components: [],
      })
      .catch(() => undefined);
  } else if (interaction.isButton() && interaction.message) {
    await interaction.message
      .edit({
        embeds: [
          buildApplicationEmbed(updatedApplication, answers, {
            resolvedById: interaction.user.id,
            resolvedAction: action,
          }),
        ],
        components: [],
      })
      .catch(() => undefined);
  }
}

async function notifyApplicationUser(guild: Guild, applicationId: number, content: string) {
  const row = db.prepare('SELECT user_id FROM applications WHERE id = ? AND guild_id = ?').get(applicationId, guild.id) as
    | { user_id: string }
    | undefined;
  if (!row) {
    return;
  }

  const member = await guild.members.fetch(row.user_id).catch(() => null);
  await member?.send(content).catch(() => undefined);
}
