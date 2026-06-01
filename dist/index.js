import { Client, Events, GatewayIntentBits, MessageFlags, Partials } from 'discord.js';
import './database/migrate.js';
import { env } from './env.js';
import { handleApplicationButton, handleApplicationCommand, handleApplicationModal } from './features/applications.js';
import { handleCheatButton, handleCheatCommand, handleCheatModal } from './features/cheatChecks.js';
import { handleEventButton, handleEventCommand, startReminderScheduler } from './features/events.js';
import { handleProfileButton, handleProfileCommand } from './features/playerProfiles.js';
import { handleRoleRecoveryButton, handleRoleRecoveryCommand } from './features/roleRecovery.js';
import { handleSettingsButton, handleSettingsCommand } from './features/settings.js';
import { registerGuildCommands } from './registerCommands.js';
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.DirectMessages,
    ],
    partials: [Partials.Channel],
});
client.once(Events.ClientReady, async () => {
    console.log(`Skooba bot logged in as ${client.user?.tag}`);
    await registerGuildCommands().catch((error) => {
        console.error('Failed to register guild commands:', error);
    });
    startReminderScheduler(client);
});
client.on('interactionCreate', async (interaction) => {
    try {
        if (interaction.isChatInputCommand()) {
            if (await handleSettingsCommand(interaction))
                return;
            if (await handleApplicationCommand(interaction))
                return;
            if (await handleCheatCommand(interaction))
                return;
            if (await handleProfileCommand(interaction))
                return;
            if (await handleRoleRecoveryCommand(interaction))
                return;
            if (await handleEventCommand(interaction))
                return;
            await interaction.reply({ content: 'Команда пока не обработана.', flags: MessageFlags.Ephemeral });
            return;
        }
        if (interaction.isButton()) {
            if (await handleSettingsButton(interaction))
                return;
            if (await handleApplicationButton(interaction))
                return;
            if (await handleCheatButton(interaction))
                return;
            if (await handleProfileButton(interaction))
                return;
            if (await handleRoleRecoveryButton(interaction))
                return;
            if (await handleEventButton(interaction))
                return;
            await interaction.reply({ content: 'Кнопка пока не обработана.', flags: MessageFlags.Ephemeral });
            return;
        }
        if (interaction.isModalSubmit()) {
            if (await handleApplicationModal(interaction))
                return;
            if (await handleCheatModal(interaction))
                return;
            await interaction.reply({ content: 'Форма пока не обработана.', flags: MessageFlags.Ephemeral });
        }
    }
    catch (error) {
        console.error(error);
        const message = 'Произошла ошибка при обработке действия. Проверь логи бота.';
        if (interaction.isRepliable()) {
            if (interaction.replied || interaction.deferred) {
                await interaction.followUp({ content: message, flags: MessageFlags.Ephemeral }).catch(() => undefined);
            }
            else {
                await interaction.reply({ content: message, flags: MessageFlags.Ephemeral }).catch(() => undefined);
            }
        }
    }
});
await client.login(env.discordToken);
