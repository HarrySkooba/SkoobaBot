import { Routes } from 'discord-api-types/v10';
import { MessageFlags } from 'discord-api-types/v10';
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
export function isApplicationsOpen(guildId) {
    return getSetting(guildId, 'applications_open') !== 'false';
}
export function buildApplicationPanelBody(guildId) {
    const open = isApplicationsOpen(guildId);
    const bannerUrl = getSetting(guildId, 'application_panel_banner_url');
    const containerChildren = [];
    if (bannerUrl) {
        containerChildren.push({
            type: COMPONENT_MEDIA_GALLERY,
            items: [{ media: { url: bannerUrl } }],
        });
    }
    containerChildren.push({
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
    }, { type: COMPONENT_SEPARATOR, divider: true, spacing: 2 }, {
        type: COMPONENT_TEXT_DISPLAY,
        content: open ? '### ✅ Приём заявок открыт' : '### 🔒 Приём заявок закрыт',
    }, {
        type: COMPONENT_ACTION_ROW,
        components: [
            {
                type: COMPONENT_BUTTON,
                style: open ? BUTTON_STYLE_PRIMARY : BUTTON_STYLE_SECONDARY,
                label: open ? 'Подать заявку в капт/mcl' : 'капт/mcl — закрыто',
                custom_id: 'application:open:capt_mcl',
                disabled: !open,
            },
            {
                type: COMPONENT_BUTTON,
                style: open ? BUTTON_STYLE_PRIMARY : BUTTON_STYLE_SECONDARY,
                label: open ? 'Подать заявку в РП' : 'РП — закрыто',
                custom_id: 'application:open:rp',
                disabled: !open,
            },
        ],
    });
    return {
        flags: MessageFlags.IsComponentsV2,
        components: [
            {
                type: COMPONENT_CONTAINER,
                accent_color: PANEL_ACCENT_BLACK,
                components: containerChildren,
            },
        ],
    };
}
export async function sendApplicationPanel(channel, guildId, updatedBy) {
    const message = await channel.client.rest.post(Routes.channelMessages(channel.id), {
        body: buildApplicationPanelBody(guildId),
    });
    setSetting(guildId, 'application_panel_channel_id', channel.id, updatedBy);
    setSetting(guildId, 'application_panel_message_id', message.id, updatedBy);
    if (getSetting(guildId, 'applications_open') === null) {
        setSetting(guildId, 'applications_open', 'true', updatedBy);
    }
    return message;
}
export async function refreshApplicationPanel(client, guildId) {
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
export async function tryRefreshApplicationPanel(guild) {
    return refreshApplicationPanel(guild.client, guild.id);
}
