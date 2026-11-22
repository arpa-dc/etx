const fs = require('fs');
const path = require('path');
const { Client, GatewayIntentBits, Partials, Events, MessageFlags } = require('discord.js');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction, Partials.User],
});

// Chargement automatique de tous les modules du dossier /features
const features = fs
  .readdirSync(path.join(__dirname, 'features'))
  .filter((f) => f.endsWith('.js'))
  .map((f) => require(`./features/${f}`));

const commandOwner = new Map(); // nom de commande -> module
const featureByName = new Map(); // préfixe customId -> module
const body = [];
for (const f of features) {
  featureByName.set(f.name, f);
  for (const c of f.commands || []) {
    commandOwner.set(c.name, f);
    body.push(c.toJSON());
  }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`✅ ETX Bot connecté : ${c.user.tag}`);
  if (process.env.GUILD_ID) await c.application.commands.set(body, process.env.GUILD_ID);
  else await c.application.commands.set(body);
  for (const f of features) f.init?.(client);
});

client.on(Events.InteractionCreate, async (i) => {
  try {
    if (i.isChatInputCommand()) {
      await commandOwner.get(i.commandName)?.execute(i);
    } else if (i.isButton() || i.isModalSubmit() || i.isAnySelectMenu()) {
      await featureByName.get(i.customId.split(':')[0])?.component?.(i);
    }
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
