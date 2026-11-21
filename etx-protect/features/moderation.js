const { SlashCommandBuilder, PermissionFlagsBits: P, ChannelType, MessageFlags } = require('discord.js');
const db = require('../utils/db');
const { parseDuration } = require('../utils/time');
const { embed, log } = require('../utils/helpers');

const reason = (o) => o.setName('raison').setDescription('Raison').setMaxLength(400);
const member = (o) => o.setName('membre').setDescription('Membre').setRequired(true);

const commands = [
  new SlashCommandBuilder().setName('kick').setDescription('Expulser un membre').setDefaultMemberPermissions(P.KickMembers)
    .addUserOption(member).addStringOption(reason),
  new SlashCommandBuilder().setName('ban').setDescription('Bannir un membre').setDefaultMemberPermissions(P.BanMembers)
    .addUserOption(member).addStringOption(reason)
    .addIntegerOption((o) => o.setName('jours').setDescription('Jours de messages à supprimer (0-7)').setMinValue(0).setMaxValue(7)),
  new SlashCommandBuilder().setName('unban').setDescription('Débannir un utilisateur').setDefaultMemberPermissions(P.BanMembers)
    .addStringOption((o) => o.setName('id').setDescription("ID de l'utilisateur").setRequired(true)).addStringOption(reason),
  new SlashCommandBuilder().setName('timeout').setDescription('Mettre un membre en timeout').setDefaultMemberPermissions(P.ModerateMembers)
    .addUserOption(member).addStringOption((o) => o.setName('duree').setDescription('Ex : 10m, 2h, 1d (max 28d)').setRequired(true)).addStringOption(reason),
  new SlashCommandBuilder().setName('untimeout').setDescription('Retirer le timeout').setDefaultMemberPermissions(P.ModerateMembers)
    .addUserOption(member).addStringOption(reason),
  new SlashCommandBuilder().setName('warn').setDescription('Avertir un membre').setDefaultMemberPermissions(P.ModerateMembers)
    .addUserOption(member).addStringOption((o) => reason(o).setRequired(true)),
  new SlashCommandBuilder().setName('warns').setDescription("Voir les avertissements d'un membre").setDefaultMemberPermissions(P.ModerateMembers)
    .addUserOption(member),
  new SlashCommandBuilder().setName('unwarn').setDescription('Retirer un avertissement').setDefaultMemberPermissions(P.ModerateMembers)
    .addUserOption(member).addIntegerOption((o) => o.setName('numero').setDescription("Numéro de l'avertissement (voir /warns)").setRequired(true)),
  new SlashCommandBuilder().setName('clearwarns').setDescription('Effacer tous les avertissements').setDefaultMemberPermissions(P.ModerateMembers)
    .addUserOption(member),
  new SlashCommandBuilder().setName('clear').setDescription('Supprimer des messages').setDefaultMemberPermissions(P.ManageMessages)
    .addIntegerOption((o) => o.setName('nombre').setDescription('1 à 100').setMinValue(1).setMaxValue(100).setRequired(true))
    .addUserOption((o) => o.setName('membre').setDescription('Uniquement les messages de ce membre')),
  new SlashCommandBuilder().setName('slowmode').setDescription('Définir le mode lent').setDefaultMemberPermissions(P.ManageChannels)
    .addIntegerOption((o) => o.setName('secondes').setDescription('0 pour désactiver (max 21600)').setMinValue(0).setMaxValue(21600).setRequired(true)),
  new SlashCommandBuilder().setName('modlog').setDescription('Définir le salon de logs').setDefaultMemberPermissions(P.Administrator)
    .addChannelOption((o) => o.setName('salon').setDescription('Salon de logs').addChannelTypes(ChannelType.GuildText).setRequired(true)),
];

const eph = MessageFlags.Ephemeral;

// Vérifie la hiérarchie des rôles
function hierarchyError(i, target) {
  if (target.id === i.user.id) return '❌ Tu ne peux pas te cibler toi-même.';
  if (target.id === i.guild.ownerId) return '❌ Impossible sur le propriétaire du serveur.';
  if (target.id === i.client.user.id) return '❌ Je ne peux pas me cibler moi-même.';
  if (target.roles.highest.position >= i.guild.members.me.roles.highest.position) return '❌ Ce membre a un rôle supérieur ou égal au mien.';
  if (i.user.id !== i.guild.ownerId && target.roles.highest.position >= i.member.roles.highest.position) return '❌ Ce membre a un rôle supérieur ou égal au tien.';
  return null;
}

async function dm(user, title, guild, why) {
  await user.send({ embeds: [embed().setTitle(title).setDescription(`Serveur : **${guild.name}**\nRaison : ${why}`)] }).catch(() => {});
}

async function record(i, title, target, why, extra = '') {
  await log(i.guild, embed().setTitle(title).addFields(
    { name: 'Membre', value: `${target} (${target.id})`, inline: true },
    { name: 'Modérateur', value: `${i.user}`, inline: true },
    { name: 'Raison', value: `${why}${extra}` }));
}

const handlers = {
  async kick(i) {
    const target = await i.guild.members.fetch(i.options.getUser('membre').id).catch(() => null);
    if (!target) return i.reply({ content: '❌ Membre introuvable.', flags: eph });
    const err = hierarchyError(i, target); if (err) return i.reply({ content: err, flags: eph });
    const why = i.options.getString('raison') || 'Aucune raison';
    await dm(target.user, '👢 Tu as été expulsé', i.guild, why);
    await target.kick(`${i.user.tag} : ${why}`);
    await record(i, '👢 Kick', target.user, why);
    return i.reply({ embeds: [embed().setDescription(`👢 **${target.user.tag}** a été expulsé.\nRaison : ${why}`)] });
  },
  async ban(i) {
    const user = i.options.getUser('membre');
    const target = await i.guild.members.fetch(user.id).catch(() => null);
    if (target) { const err = hierarchyError(i, target); if (err) return i.reply({ content: err, flags: eph }); }
    const why = i.options.getString('raison') || 'Aucune raison';
    if (target) await dm(user, '🔨 Tu as été banni', i.guild, why);
    await i.guild.members.ban(user, { reason: `${i.user.tag} : ${why}`, deleteMessageSeconds: (i.options.getInteger('jours') || 0) * 86400 });
    await record(i, '🔨 Ban', user, why);
    return i.reply({ embeds: [embed().setDescription(`🔨 **${user.tag}** a été banni.\nRaison : ${why}`)] });
  },
  async unban(i) {
    const id = i.options.getString('id');
    const why = i.options.getString('raison') || 'Aucune raison';
    const ban = await i.guild.bans.fetch(id).catch(() => null);
    if (!ban) return i.reply({ content: "❌ Cet utilisateur n'est pas banni.", flags: eph });
    await i.guild.members.unban(id, `${i.user.tag} : ${why}`);
    await record(i, '♻️ Unban', ban.user, why);
    return i.reply({ embeds: [embed().setDescription(`♻️ **${ban.user.tag}** a été débanni.`)] });
  },
  async timeout(i) {
    const target = await i.guild.members.fetch(i.options.getUser('membre').id).catch(() => null);
    if (!target) return i.reply({ content: '❌ Membre introuvable.', flags: eph });
    const err = hierarchyError(i, target); if (err) return i.reply({ content: err, flags: eph });
    const ms = parseDuration(i.options.getString('duree'));
    if (!ms || ms > 28 * 864e5) return i.reply({ content: '❌ Durée invalide (ex : `10m`, `2h`, `1d`, max 28d).', flags: eph });
    const why = i.options.getString('raison') || 'Aucune raison';
    await target.timeout(ms, `${i.user.tag} : ${why}`);
    await dm(target.user, '⏳ Tu as été mis en timeout', i.guild, why);
    const until = `<t:${Math.floor((Date.now() + ms) / 1000)}:R>`;
    await record(i, '⏳ Timeout', target.user, why, `\nFin : ${until}`);
    return i.reply({ embeds: [embed().setDescription(`⏳ **${target.user.tag}** est en timeout (fin ${until}).\nRaison : ${why}`)] });
  },
  async untimeout(i) {
    const target = await i.guild.members.fetch(i.options.getUser('membre').id).catch(() => null);
    if (!target) return i.reply({ content: '❌ Membre introuvable.', flags: eph });
    if (!target.isCommunicationDisabled()) return i.reply({ content: "❌ Ce membre n'est pas en timeout.", flags: eph });
    const why = i.options.getString('raison') || 'Aucune raison';
    await target.timeout(null, `${i.user.tag} : ${why}`);
    await record(i, '✅ Untimeout', target.user, why);
    return i.reply({ embeds: [embed().setDescription(`✅ Timeout retiré pour **${target.user.tag}**.`)] });
  },
  async warn(i) {
    const user = i.options.getUser('membre');
    const target = await i.guild.members.fetch(user.id).catch(() => null);
    if (!target) return i.reply({ content: '❌ Membre introuvable.', flags: eph });
    const err = hierarchyError(i, target); if (err) return i.reply({ content: err, flags: eph });
    const g = db.guild(i.guildId);
    g.warns ||= {};
    const list = (g.warns[user.id] ||= []);
    const why = i.options.getString('raison');
    list.push({ mod: i.user.id, reason: why, date: Date.now() });
    db.save();
    await dm(user, '⚠️ Tu as reçu un avertissement', i.guild, why);
    await record(i, '⚠️ Warn', user, why, `\nTotal : ${list.length}`);
    return i.reply({ embeds: [embed().setDescription(`⚠️ **${user.tag}** a été averti (total : ${list.length}).\nRaison : ${why}`)] });
  },
  async warns(i) {
    const user = i.options.getUser('membre');
    const list = db.guild(i.guildId).warns?.[user.id] || [];
    const lines = list.map((w, n) => `**${n + 1}.** ${w.reason} — <@${w.mod}> — <t:${Math.floor(w.date / 1000)}:d>`);
    return i.reply({ embeds: [embed().setTitle(`Avertissements de ${user.tag}`).setDescription(lines.join('\n') || 'Aucun avertissement.')], flags: eph });
  },
  async unwarn(i) {
    const user = i.options.getUser('membre');
    const list = db.guild(i.guildId).warns?.[user.id] || [];
    const n = i.options.getInteger('numero') - 1;
    if (!list[n]) return i.reply({ content: '❌ Numéro invalide.', flags: eph });
    list.splice(n, 1);
    db.save();
    return i.reply({ content: '✅ Avertissement retiré.', flags: eph });
  },
  async clearwarns(i) {
    const g = db.guild(i.guildId);
    if (g.warns) delete g.warns[i.options.getUser('membre').id];
    db.save();
    return i.reply({ content: '✅ Avertissements effacés.', flags: eph });
  },
  async clear(i) {
    await i.deferReply({ flags: eph });
    const n = i.options.getInteger('nombre');
    const user = i.options.getUser('membre');
    let msgs = await i.channel.messages.fetch({ limit: 100 });
    if (user) msgs = msgs.filter((m) => m.author.id === user.id);
    const deleted = await i.channel.bulkDelete([...msgs.values()].slice(0, n), true);
    await log(i.guild, embed().setTitle('🧹 Clear').setDescription(`${i.user} a supprimé **${deleted.size}** message(s) dans ${i.channel}.`));
    return i.editReply(`🧹 **${deleted.size}** message(s) supprimé(s) (les messages de plus de 14 jours sont ignorés).`);
  },
  async slowmode(i) {
    const s = i.options.getInteger('secondes');
    await i.channel.setRateLimitPerUser(s);
    return i.reply({ embeds: [embed().setDescription(s ? `🐌 Mode lent : **${s}s**.` : '🐇 Mode lent désactivé.')] });
  },
  async modlog(i) {
    db.guild(i.guildId).logChannel = i.options.getChannel('salon').id;
    db.save();
    return i.reply({ content: '✅ Salon de logs défini.', flags: eph });
  },
};

module.exports = {
  name: 'moderation',
  commands,
  execute: (i) => handlers[i.commandName](i),
};
