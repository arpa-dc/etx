const {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, MessageFlags,
} = require('discord.js');
const db = require('../utils/db');
const { embed } = require('../utils/embed');
const { parseDuration } = require('../utils/time');

const command = new SlashCommandBuilder()
  .setName('giveaway')
  .setDescription('Système de giveaway')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) => s.setName('start').setDescription('Lancer un giveaway')
    .addStringOption((o) => o.setName('prix').setDescription('Lot à gagner').setMaxLength(200).setRequired(true))
    .addStringOption((o) => o.setName('duree').setDescription('Ex : 30m, 2h, 1d, 1h30m').setRequired(true))
    .addIntegerOption((o) => o.setName('gagnants').setDescription('Nombre de gagnants (défaut 1)').setMinValue(1).setMaxValue(20))
    .addChannelOption((o) => o.setName('salon').setDescription('Salon (défaut : ici)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
  .addSubcommand((s) => s.setName('end').setDescription('Terminer un giveaway maintenant')
    .addStringOption((o) => o.setName('message_id').setDescription('ID du message').setRequired(true)))
  .addSubcommand((s) => s.setName('reroll').setDescription('Retirer un nouveau gagnant')
    .addStringOption((o) => o.setName('message_id').setDescription('ID du message').setRequired(true)))
  .addSubcommand((s) => s.setName('list').setDescription('Giveaways en cours'));

const row = (disabled = false) => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId('giveaways:join').setLabel('Participer').setEmoji('🎉').setStyle(ButtonStyle.Primary).setDisabled(disabled));

function gwEmbed(gw) {
  const e = embed().setTitle(`🎉 ${gw.prize}`).setFooter({ text: `ETX • ${gw.entries.length} participant(s)` });
  if (gw.ended) {
    const w = gw.winnersList?.length ? gw.winnersList.map((id) => `<@${id}>`).join(', ') : 'Aucun participant';
    return e.setDescription(`**Giveaway terminé**\nGagnant(s) : ${w}\nOrganisé par <@${gw.host}>`);
  }
  return e.setDescription(`Clique sur **Participer** pour tenter ta chance !\n\nFin : <t:${Math.floor(gw.endsAt / 1000)}:R>\nGagnant(s) : **${gw.winners}**\nOrganisé par <@${gw.host}>`);
}

const pick = (arr, n) => [...arr].sort(() => Math.random() - 0.5).slice(0, n);

async function endGiveaway(client, guildId, messageId) {
  const gw = db.guild(guildId).giveaways?.[messageId];
  if (!gw || gw.ended) return false;
  gw.ended = true;
  gw.winnersList = pick(gw.entries, gw.winners);
  db.save();
  const ch = await client.channels.fetch(gw.channelId).catch(() => null);
  if (!ch) return true;
  const msg = await ch.messages.fetch(messageId).catch(() => null);
  await msg?.edit({ embeds: [gwEmbed(gw)], components: [row(true)] }).catch(() => {});
  await ch.send(gw.winnersList.length
    ? `🎉 Félicitations ${gw.winnersList.map((id) => `<@${id}>`).join(', ')} ! Vous avez gagné **${gw.prize}** !`
    : `😕 Personne n'a participé au giveaway **${gw.prize}**.`).catch(() => {});
  return true;
}

module.exports = {
  name: 'giveaways',
  commands: [command],
  async execute(i) {
    const g = db.guild(i.guildId);
    g.giveaways ||= {};
    const sub = i.options.getSubcommand();
    const eph = MessageFlags.Ephemeral;

    if (sub === 'start') {
      const ms = parseDuration(i.options.getString('duree'));
      if (!ms || ms < 10000) return i.reply({ content: '❌ Durée invalide (min 10s). Ex : `2h`, `1d`.', flags: eph });
      const ch = i.options.getChannel('salon') || i.channel;
      const gw = { channelId: ch.id, prize: i.options.getString('prix'), winners: i.options.getInteger('gagnants') || 1,
        host: i.user.id, endsAt: Date.now() + ms, entries: [], ended: false };
      const msg = await ch.send({ embeds: [gwEmbed(gw)], components: [row()] });
      g.giveaways[msg.id] = gw;
      db.save();
      return i.reply({ content: `✅ Giveaway lancé dans ${ch}.`, flags: eph });
    }
    if (sub === 'end') {
      const ok = await endGiveaway(i.client, i.guildId, i.options.getString('message_id'));
      return i.reply({ content: ok ? '✅ Giveaway terminé.' : '❌ Giveaway introuvable ou déjà terminé.', flags: eph });
    }
    if (sub === 'reroll') {
      const id = i.options.getString('message_id');
      const gw = g.giveaways[id];
      if (!gw?.ended) return i.reply({ content: '❌ Giveaway introuvable ou pas encore terminé.', flags: eph });
      const winners = pick(gw.entries, gw.winners);
      if (!winners.length) return i.reply({ content: '❌ Aucun participant.', flags: eph });
      await i.reply(`🔁 Nouveau(x) gagnant(s) pour **${gw.prize}** : ${winners.map((w) => `<@${w}>`).join(', ')} 🎉`);
      return;
    }
    const active = Object.entries(g.giveaways).filter(([, gw]) => !gw.ended);
    const lines = active.map(([id, gw]) => `**${gw.prize}** — fin <t:${Math.floor(gw.endsAt / 1000)}:R> — [lien](https://discord.com/channels/${i.guildId}/${gw.channelId}/${id})`);
    return i.reply({ embeds: [embed().setTitle('Giveaways en cours').setDescription(lines.join('\n') || 'Aucun.')], flags: eph });
  },
  async component(i) {
    const gw = db.guild(i.guildId).giveaways?.[i.message.id];
    if (!gw || gw.ended) return i.reply({ content: '❌ Ce giveaway est terminé.', flags: MessageFlags.Ephemeral });
    const idx = gw.entries.indexOf(i.user.id);
    if (idx === -1) gw.entries.push(i.user.id);
    else gw.entries.splice(idx, 1);
    db.save();
    await i.update({ embeds: [gwEmbed(gw)] });
    i.followUp({ content: idx === -1 ? '✅ Participation enregistrée !' : '↩️ Participation retirée.', flags: MessageFlags.Ephemeral }).catch(() => {});
  },
  init(client) {
    setInterval(() => {
      for (const guild of client.guilds.cache.values()) {
        for (const [id, gw] of Object.entries(db.guild(guild.id).giveaways || {})) {
          if (!gw.ended && gw.endsAt <= Date.now()) endGiveaway(client, guild.id, id).catch(console.error);
        }
      }
    }, 10 * 1000);
  },
};
