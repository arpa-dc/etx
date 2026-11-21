const {
  SlashCommandBuilder, PermissionFlagsBits, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} = require('discord.js');
const db = require('../utils/db');
const { embed } = require('../utils/embed');

const command = new SlashCommandBuilder()
  .setName('poll')
  .setDescription('Système de sondage')
  .addSubcommand((s) => s.setName('create').setDescription('Créer un sondage')
    .addStringOption((o) => o.setName('question').setDescription('Question').setMaxLength(250).setRequired(true))
    .addStringOption((o) => o.setName('options').setDescription('2 à 5 choix séparés par | (ex : Oui | Non | Peut-être)').setRequired(true)))
  .addSubcommand((s) => s.setName('end').setDescription('Clôturer un sondage')
    .addStringOption((o) => o.setName('message_id').setDescription('ID du message du sondage').setRequired(true)));

const counts = (p) => p.options.map((_, i) => Object.values(p.votes).filter((v) => v === i).length);

function pollEmbed(p) {
  const c = counts(p);
  const total = c.reduce((a, b) => a + b, 0);
  const lines = p.options.map((o, i) => {
    const pct = total ? Math.round((c[i] / total) * 100) : 0;
    const filled = Math.round(pct / 10);
    return `**${i + 1}. ${o}**\n${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${pct}% (${c[i]})`;
  });
  return embed().setTitle(`📊 ${p.question}`)
    .setDescription(`${lines.join('\n\n')}\n\n${p.ended ? '🔒 **Sondage terminé**' : 'Clique sur un bouton pour voter (tu peux changer ton vote).'}`)
    .setFooter({ text: `ETX • ${total} vote(s)` });
}

const buttons = (p, disabled = false) => new ActionRowBuilder().addComponents(
  p.options.map((o, i) => new ButtonBuilder().setCustomId(`polls:vote:${i}`).setLabel(`${i + 1}. ${o}`.slice(0, 80))
    .setStyle(ButtonStyle.Primary).setDisabled(disabled)));

module.exports = {
  name: 'polls',
  commands: [command],
  async execute(i) {
    const g = db.guild(i.guildId);
    g.polls ||= {};
    const eph = MessageFlags.Ephemeral;
    if (i.options.getSubcommand() === 'create') {
      const options = i.options.getString('options').split('|').map((s) => s.trim()).filter(Boolean);
      if (options.length < 2 || options.length > 5) return i.reply({ content: '❌ Il faut entre 2 et 5 choix, séparés par `|`.', flags: eph });
      const p = { question: i.options.getString('question'), options, votes: {}, author: i.user.id, ended: false };
      const msg = await i.channel.send({ embeds: [pollEmbed(p)], components: [buttons(p)] });
      g.polls[msg.id] = p;
      db.save();
      return i.reply({ content: '✅ Sondage créé.', flags: eph });
    }
    const id = i.options.getString('message_id');
    const p = g.polls[id];
    if (!p || p.ended) return i.reply({ content: '❌ Sondage introuvable ou déjà terminé.', flags: eph });
    if (p.author !== i.user.id && !i.member.permissions.has(PermissionFlagsBits.ManageMessages))
      return i.reply({ content: '❌ Seul l\'auteur ou un modérateur peut clôturer.', flags: eph });
    p.ended = true;
    db.save();
    const msg = await i.channel.messages.fetch(id).catch(() => null);
    await msg?.edit({ embeds: [pollEmbed(p)], components: [buttons(p, true)] });
    return i.reply({ content: '✅ Sondage clôturé.', flags: eph });
  },
  async component(i) {
    const p = db.guild(i.guildId).polls?.[i.message.id];
    if (!p || p.ended) return i.reply({ content: '❌ Sondage terminé.', flags: MessageFlags.Ephemeral });
    p.votes[i.user.id] = Number(i.customId.split(':')[2]);
    db.save();
    await i.update({ embeds: [pollEmbed(p)] });
  },
};
