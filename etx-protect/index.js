const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Events, MessageFlags } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const features = fs
  .readdirSync(path.join(__dirname, 'features'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => require(`./features/${f}`));

const owner = new Map();
const body = [];
for (const f of features) {
  for (const c of f.commands || []) {
    owner.set(c.name, f);
    body.push(c.toJSON());
  }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`🛡️ ETX Protect connecté : ${c.user.tag}`);
  if (process.env.GUILD_ID) await c.application.commands.set(body, process.env.GUILD_ID);
  else await c.application.commands.set(body);
  for (const f of features) f.init?.(client);
});

client.on(Events.InteractionCreate, async (i) => {
  if (!i.isChatInputCommand()) return;
  try {
    await owner.get(i.commandName)?.execute(i);
  } catch (err) {
    console.error(err);
    const msg = { content: '❌ Une erreur est survenue.', flags: MessageFlags.Ephemeral };
    if (i.deferred || i.replied) i.followUp(msg).catch(() => {});
    else i.reply(msg).catch(() => {});
  }
});

module.exports = { client, features, start: (token) => client.login(token) };

// Mode autonome (un seul bot) : node index.js
if (require.main === module) {
  require('dotenv').config();
  require('./utils/keepalive');
  client.login(process.env.TOKEN);
}
