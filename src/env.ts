import 'dotenv/config';

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

function requiredAnyEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value) {
      return value;
    }
  }

  throw new Error(`Missing required environment variable: ${names.join(' or ')}`);
}

export const env = {
  discordToken: requiredAnyEnv('DISCORD_TOKEN', 'BOT_TOKEN'),
  clientId: requiredEnv('CLIENT_ID'),
  guildId: requiredEnv('GUILD_ID'),
  databasePath: process.env.DATABASE_PATH ?? './data/skooba.sqlite',
};
