import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  ChatInputCommandInteraction,
  EmbedBuilder,
  ModalBuilder,
  ModalSubmitInteraction,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { db } from '../database/db.js';
import { setSetting } from '../database/settings.js';
import { isApplicationsOpen, refreshApplicationPanel, sendApplicationPanel } from '../discord/applicationPanelV2.js';
import { audit, getConfiguredTextChannel, isStaff, privateReply, sendToConfiguredChannel } from '../discord/helpers.js';
import { grantApplicationAcceptRoles } from './roleRecovery.js';

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

  if (interaction.customId === 'application:open') {
    if (!isApplicationsOpen(interaction.guild.id)) {
      await interaction.reply(privateReply('Приём заявок сейчас закрыт.'));
      return true;
    }

    const modal = new ModalBuilder().setCustomId('application:modal').setTitle('Заявка в Skooba');
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

  const [, action, id] = interaction.customId.split(':');
  const applicationId = Number(id);
  const member = await interaction.guild?.members.fetch(interaction.user.id).catch(() => null);
  if (!member || !isStaff(member)) {
    await interaction.reply(privateReply('Действия с заявками доступны только стаффу.'));
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

  if (action === 'accept' || action === 'reject') {
    await resolveApplication(interaction, applicationId, action);
    return true;
  }

  return true;
}

export async function handleApplicationModal(interaction: ModalSubmitInteraction): Promise<boolean> {
  if (interaction.customId === 'application:modal') {
    if (!interaction.guild) {
      await interaction.reply(privateReply('Заявки работают только на сервере.'));
      return true;
    }

    if (!isApplicationsOpen(interaction.guild.id)) {
      await interaction.reply(privateReply('Приём заявок сейчас закрыт.'));
      return true;
    }

    const answers = {
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
    await publishApplication(interaction, applicationId, answers);
    audit(interaction.guild.id, 'application.created', { applicationId, answers }, interaction.user.id, interaction.user.id);
    await interaction.reply(privateReply('Заявка отправлена. Ожидай ответа стаффа.'));
    return true;
  }

  if (interaction.customId.startsWith('application-call:')) {
    const applicationId = Number(interaction.customId.split(':')[1]);
    const scheduledFor = interaction.fields.getTextInputValue('scheduled_for');
    const notes = interaction.fields.getTextInputValue('notes');
    db.prepare('INSERT INTO call_schedules (application_id, scheduled_by, scheduled_for, notes) VALUES (?, ?, ?, ?)').run(
      applicationId,
      interaction.user.id,
      scheduledFor,
      notes,
    );
    db.prepare('UPDATE applications SET status = ?, reviewer_id = ?, updated_at = unixepoch() WHERE id = ?').run('call_scheduled', interaction.user.id, applicationId);
    await interaction.reply(privateReply('Обзвон назначен.'));
    await notifyApplicationUser(interaction, applicationId, `Тебе назначен обзвон: ${scheduledFor}${notes ? `\nКомментарий: ${notes}` : ''}`);
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

async function publishApplication(interaction: ModalSubmitInteraction, applicationId: number, answers: Record<string, string>) {
  if (!interaction.guild) {
    return;
  }

  const channel = await getConfiguredTextChannel(interaction.guild, 'application_review_channel_id');
  if (!channel) {
    return;
  }

  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder().setCustomId(`application:call:${applicationId}`).setLabel('Назначить обзвон').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`application:accept:${applicationId}`).setLabel('Принять').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`application:reject:${applicationId}`).setLabel('Отклонить').setStyle(ButtonStyle.Danger),
  );
  const message = await channel.send({
    embeds: [
      new EmbedBuilder()
        .setTitle(`Заявка #${applicationId}`)
        .setDescription(`<@${interaction.user.id}>`)
        .addFields(
          { name: 'Ник | Статик | Возраст', value: truncateEmbedField(answers.identity) },
          { name: 'Опыт на Majestic', value: truncateEmbedField(answers.majestic_experience) },
          { name: 'Семьи и причины ухода', value: truncateEmbedField(answers.families) },
          { name: 'Откуда узнали о семье', value: truncateEmbedField(answers.referral_source) },
          { name: 'Откаты', value: truncateEmbedField(answers.rollbacks) },
        )
        .setColor(0xf1c40f),
    ],
    components: [row],
  });
  db.prepare('UPDATE applications SET review_message_id = ? WHERE id = ?').run(message.id, applicationId);
}

async function resolveApplication(interaction: ButtonInteraction, applicationId: number, action: 'accept' | 'reject') {
  if (!interaction.guild) {
    await interaction.reply(privateReply('Сервер не найден.'));
    return;
  }

  const row = db.prepare('SELECT user_id FROM applications WHERE id = ? AND guild_id = ?').get(applicationId, interaction.guild.id) as { user_id: string } | undefined;
  if (!row) {
    await interaction.reply(privateReply('Заявка не найдена.'));
    return;
  }

  db.prepare('UPDATE applications SET status = ?, reviewer_id = ?, updated_at = unixepoch() WHERE id = ?').run(action === 'accept' ? 'accepted' : 'rejected', interaction.user.id, applicationId);

  if (action === 'accept') {
    const member = await interaction.guild.members.fetch(row.user_id).catch(() => null);
    if (member) {
      await grantApplicationAcceptRoles(member);
    }
  }

  audit(interaction.guild.id, `application.${action}`, { applicationId }, interaction.user.id, row.user_id);
  await sendToConfiguredChannel(interaction.guild, 'application_log_channel_id', `Заявка #${applicationId}: ${action === 'accept' ? 'принята' : 'отклонена'} модератором <@${interaction.user.id}>.`);
  await notifyApplicationUser(interaction, applicationId, action === 'accept' ? 'Твоя заявка в Skooba принята.' : 'Твоя заявка в Skooba отклонена.');
  await interaction.update({ content: `Заявка #${applicationId}: ${action === 'accept' ? 'принята' : 'отклонена'}.`, embeds: [], components: [] });
}

async function notifyApplicationUser(interaction: ButtonInteraction | ModalSubmitInteraction, applicationId: number, content: string) {
  if (!interaction.guild) {
    return;
  }

  const row = db.prepare('SELECT user_id FROM applications WHERE id = ? AND guild_id = ?').get(applicationId, interaction.guild.id) as { user_id: string } | undefined;
  if (!row) {
    return;
  }

  const member = await interaction.guild.members.fetch(row.user_id).catch(() => null);
  await member?.send(content).catch(() => undefined);
}
