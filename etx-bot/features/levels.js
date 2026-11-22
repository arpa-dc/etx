const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, Events, MessageFlags } = require('discord.js');
const db = require('../utils/db');
const { embed } = require('../utils/embed');

const commands = [
  new SlashCommandBuilder().setName('rank').setDescription("Voir ton niveau")
    .addUserOption((o) => o.setName('membre').setDescription('Membre')),
  new SlashCommandBuilder().setName('leaderboard').setDescription('Classement du serveur'),
  new SlashCommandBuilder().setName('levels').setDescription('Configurer les niveaux')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((s) => s.setName('salon').setDescription('Salon des annonces de niveau (vide = salon du message)')
      .addChannelOption((o) => o.setName('salon').setDescription('Salon').addChannelTypes(ChannelType.GuildText)))
    .addSubcommand((s) => s.setName('reward-add').setDescription('Rôle donné à un niveau')
      .addIntegerOption((o) => o.setName('niveau').setDescription('Niveau').setMinValue(1).setRequired(true))
      .addRoleOption((o) => o.setName('role').setDescription('Rôle').setRequired(true)))
    .addSubcommand((s) => s.setName('reward-remove').setDescription('Retirer une récompense')
      .addIntegerOption((o) => o.setName('niveau').setDescription('Niveau').setMinValue(1).setRequired(true)))
    .addSubcommand((s) => s.setName('toggle').setDescription('Activer / désactiver le système')),
];

const need = (lvl) => 5 * lvl * lvl + 50 * lvl + 100; // XP pour passer du niveau lvl à lvl+1
const cooldown = new Map();

module.exports = {
  name: 'levels',
  commands,
  async execute(i) {
    const g = db.guild(i.guildId);
    g.levels ||= {};
    if (i.commandName === 'rank') {
      const user = i.options.getUser('membre') || i.user;
      const u = g.levels[user.id] || { xp: 0, level: 0, total: 0 };
      const rank = Object.values(g.levels).filter((x) => x.total > u.total).length + 1;
      const n = need(u.level);
      const filled = Math.round((u.xp / n) * 15);
      return i.reply({ embeds: [embed().setAuthor({ name: user.username, iconURL: user.displayAvatarURL() })
        .setTitle(`Niveau ${u.level}`)
        .setDescription(`${'🟦'.repeat(filled)}${'⬜'.repeat(15 - filled)}\n**${u.xp} / ${n}** XP`)
        .addFields({ name: 'Classement', value: `#${rank}`, inline: true }, { name: 'XP total', value: `${u.total}`, inline: true })] });
    }
    if (i.commandName === 'leaderboard') {
      const top = Object.entries(g.levels).sort((a, b) => b[1].total - a[1].total).slice(0, 10);
      const medals = ['🥇', '🥈', '🥉'];
      const lines = top.map(([id, u], idx) => `${medals[idx] || `**${idx + 1}.**`} <@${id}> — niveau **${u.level}** (${u.total} XP)`);
      return i.reply({ embeds: [embed().setTitle('🏆 Classement').setDescription(lines.join('\n') || 'Personne pour le moment.')] });
    }
    const eph = MessageFlags.Ephemeral;
    const sub = i.options.getSubcommand();
    g.levelCfg ||= {};
    if (sub === 'salon') {
      g.levelCfg.channelId = i.options.getChannel('salon')?.id || null;
      db.save();
      return i.reply({ content: '✅ Salon des annonces mis à jour.', flags: eph });
    }
    if (sub === 'toggle') {
      g.levelCfg.disabled = !g.levelCfg.disabled;
      db.save();
      return i.reply({ content: g.levelCfg.disabled ? '⏸️ Niveaux désactivés.' : '▶️ Niveaux activés.', flags: eph });
    }
    g.levelRewards ||= {};
    if (sub === 'reward-add') {
      g.levelRewards[i.options.getInteger('niveau')] = i.options.getRole('role').id;
      db.save();
      return i.reply({ content: '✅ Récompense ajoutée.', flags: eph });
    }
    delete g.levelRewards[i.options.getInteger('niveau')];
    db.save();
    return i.reply({ content: '✅ Récompense supprimée.', flags: eph });
  },
  init(client) {
    client.on(Events.MessageCreate, async (m) => {
      if (m.author.bot || !m.guild || !m.member) return;
      const g = db.guild(m.guild.id);
      if (g.levelCfg?.disabled) return;
      const key = `${m.guild.id}:${m.author.id}`;
      if (Date.now() - (cooldown.get(key) || 0) < 60000) return;
      cooldown.set(key, Date.now());

      g.levels ||= {};
      const u = (g.levels[m.author.id] ||= { xp: 0, level: 0, total: 0 });
      const gain = 15 + Math.floor(Math.random() * 11);
      u.xp += gain;
      u.total += gain;
      let up = false;
      while (u.xp >= need(u.level)) { u.xp -= need(u.level); u.level++; up = true; }
      db.save();
      if (!up) return;

      for (const [lvl, roleId] of Object.entries(g.levelRewards || {})) {
        if (u.level >= Number(lvl)) m.member.roles.add(roleId).catch(() => {});
      }
      const ch = (g.levelCfg?.channelId && m.guild.channels.cache.get(g.levelCfg.channelId)) || m.channel;
      ch.send({ content: `🎉 ${m.author} passe au **niveau ${u.level}** !` }).catch(() => {});
    });
  },
};
