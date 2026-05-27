import { Routes } from 'discord-api-types/v10';
import { MessageFlags } from 'discord-api-types/v10';
import type { Client, Guild, TextChannel } from 'discord.js';
import { getSetting, setSetting } from '../database/settings.js';

const COMPONENT_TEXT_DISPLAY = 10;
const COMPONENT_MEDIA_GALLERY = 12;
const COMPONENT_SEPARATOR = 14;
const COMPONENT_CONTAINER = 17;
const COMPONENT_ACTION_ROW = 1;
const COMPONENT_BUTTON = 2;

const BUTTON_STYLE_PRIMARY = 1;
const BUTTON_STYLE_SECONDARY = 2;

const PANEL_ACCENT_BLACK = 0x000000;

type V2Component = Record<string, unknown>;

export function isApplicationsOpen(guildId: string): boolean {
  return getSetting(guildId, 'applications_open') !== 'false';
}

export function buildApplicationPanelBody(guildId: string): { flags: number; components: V2Component[] } {
  const open = isApplicationsOpen(guildId);
  const bannerUrl = getSetting(guildId, 'application_panel_banner_url');
  const components: V2Component[] = [];

  if (bannerUrl) {
    components.push({
      type: COMPONENT_MEDIA_GALLERY,
      items: [{ media: { url: bannerUrl } }],
    });
  }

  components.push({
    type: COMPONENT_CONTAINER,
    accent_color: PANEL_ACCENT_BLACK,
    components: [
      {
        type: COMPONENT_TEXT_DISPLAY,
        content: [
          '❗ **Мы принимаем заявки в семью Skooba** ❗',
          'Для вступления в семью требуются откаты с MCL/CAPT И GUNGAME.',
          '',
          'Решение направляется ботом в личные сообщения.',
          'Отсутствие ответа в указанный срок означает отказ в заявке.',
          'Будем рады видеть вас в наших рядах!',
          'Заявки в семью принимаются только на сервер **Orlando**.',
          '',
          'Внимательно прочитайте шаблон заявки при её подаче — там тоже есть информация.',
          'В заявке требуются полные откаты с GG и МП (MCL ВЗЗ Capt).',
          '',
          '**Дополнительные правила в заявке:**',
          '• Откаты с GG должны быть записаны не более 1 недели назад.',
          '• Откаты с МП должны быть записаны не более 60 дней назад.',
          '• Откаты не должны быть сделаны как нарезка или мувик.',
          '• Минимальная длина откатов с GG — от 5 минут.',
          '• Любое нарушение условий подачи откатов — скорее всего будет причиной отказа без исключений.',
          '',
          '**СЕРЬЁЗНО ОТНЕСИТЕСЬ К ШАБЛОНУ ПОДАЧИ.** Внимательно читайте и проверяйте все пункты заполнения. Сообщения в ЛС по типу «Не увидел» «Плохо прочитал» «Не понял» «Протупил» и т.д. будут рассматриваться как отказ.',
        ].join('\n'),
      },
      { type: COMPONENT_SEPARATOR, divider: true, spacing: 2 },
      {
        type: COMPONENT_TEXT_DISPLAY,
        content: open ? '### ✅ Приём заявок открыт' : '### 🔒 Приём заявок закрыт',
      },
      {
        type: COMPONENT_ACTION_ROW,
        components: [
          {
            type: COMPONENT_BUTTON,
            style: open ? BUTTON_STYLE_PRIMARY : BUTTON_STYLE_SECONDARY,
            label: open ? 'Подать заявку' : 'Приём заявок закрыт',
            custom_id: 'application:open',
            disabled: !open,
          },
        ],
      },
    ],
  });

  return {
    flags: MessageFlags.IsComponentsV2,
    components,
  };
}

export async function sendApplicationPanel(channel: TextChannel, guildId: string, updatedBy: string) {
  const message = await channel.client.rest.post(Routes.channelMessages(channel.id), {
    body: buildApplicationPanelBody(guildId),
  }) as { id: string };

  setSetting(guildId, 'application_panel_channel_id', channel.id, updatedBy);
  setSetting(guildId, 'application_panel_message_id', message.id, updatedBy);
  if (getSetting(guildId, 'applications_open') === null) {
    setSetting(guildId, 'applications_open', 'true', updatedBy);
  }

  return message;
}

export async function refreshApplicationPanel(client: Client, guildId: string): Promise<boolean> {
  const channelId = getSetting(guildId, 'application_panel_channel_id');
  const messageId = getSetting(guildId, 'application_panel_message_id');
  if (!channelId || !messageId) {
    return false;
  }

  await client.rest.patch(Routes.channelMessage(channelId, messageId), {
    body: buildApplicationPanelBody(guildId),
  });
  return true;
}

export async function tryRefreshApplicationPanel(guild: Guild): Promise<boolean> {
  return refreshApplicationPanel(guild.client, guild.id);
}
