const { EmbedBuilder } = require('discord.js');
const db = require('./db');

const BLUE = 0x1e5bff;
const embed = () => new EmbedBuilder().setColor(BLUE).setFooter({ text: 'ETX Protect' }).setTimestamp();

// Envoie un embed dans le salon de logs configuré (/modlog)
async function log(guild, e) {
  const id = db.guild(guild.id).logChannel;
  const ch = id && guild.channels.cache.get(id);
  if (ch) await ch.send({ embeds: [e] }).catch(() => {});
}

module.exports = { BLUE, embed, log };
