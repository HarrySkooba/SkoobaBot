import { REST, Routes } from 'discord.js';
import { commands } from './commands.js';
import { env } from './env.js';
export async function registerGuildCommands() {
    const rest = new REST({ version: '10' }).setToken(env.discordToken);
    await rest.put(Routes.applicationGuildCommands(env.clientId, env.guildId), { body: commands });
    console.log(`Registered ${commands.length} guild commands.`);
}
