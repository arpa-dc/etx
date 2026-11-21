const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, Events, MessageFlags } = require('discord.js');
const db = require('../utils/db');
const { embed, log } = require('../utils/helpers');
const lock = require('./lock');

const DEFAULT = {
  enabled: true,
  joinLimit: 5,        // nombre de joins...
  joinWindow: 10,      // ...en X secondes déclenche le raid mode
  action: 'kick',      // kick | ban | timeout
  minAge: 0,           // âge minimum du compte (jours), 0 = désactivé
  raidMinutes: 10,     // durée du raid mode automatique
  autoLock: false,     // verrouille tous les salons pendant un raid
  antiInvite: false,   // supprime les invitations Discord
  mentionLimit: 0,     // mentions max par message, 0 = désactivé
  raidUntil: 0,
};
const cfg = (gid) => {
  const g = db.guild(gid);
  g.antiraid = { ...DEFAULT, ...g.antiraid };
  return g.antiraid;
};

const joins = new Map(); // guildId -> [{ id, t }]
const INVITE = /(discord\.gg|discord(?:app)?\.com\/invite)\/\w+/i;

const command = new SlashCommandBuilder()
  .setName('antiraid')
  .setDescription("Système d'anti-raid")
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((s) => s.setName('status').setDescription("Voir la configuration"))
  .addSubcommand((s) => s.setName('toggle').setDescription("Activer / désactiver l'anti-raid"))
  .addSubcommand((s) => s.setName('config').setDescription('Modifier la configuration')
    .addIntegerOption((o) => o.setName('joins').setDescription('Joins max dans la fenêtre').setMinValue(2).setMaxValue(50))
    .addIntegerOption((o) => o.setName('secondes').setDescription('Taille de la fenêtre (secondes)').setMinValue(3).setMaxValue(120))
    .addStringOption((o) => o.setName('action').setDescription('Sanction des raiders').addChoices(
      { name: 'Kick', value: 'kick' }, { name: 'Ban', value: 'ban' }, { name: 'Timeout (1h)', value: 'timeout' }))
    .addIntegerOption((o) => o.setName('age_minimum').setDescription('Âge minimum des comptes en jours (0 = off)').setMinValue(0).setMaxValue(365))
    .addIntegerOption((o) => o.setName('duree_raid').setDescription('Durée du raid mode auto (minutes)').setMinValue(1).setMaxValue(1440))
    .addBooleanOption((o) => o.setName('autolock').setDescription('Verrouiller tous les salons pendant un raid'))
    .addBooleanOption((o) => o.setName('anti_invite').setDescription('Supprimer les invitations Discord'))
    .addIntegerOption((o) => o.setName('mentions_max').setDescription('Mentions max par message (0 = off)').setMinValue(0).setMaxValue(50)))
  .addSubcommand((s) => s.setName('raidmode').setDescription('Activer / désactiver le raid mode manuellement')
    .addStringOption((o) => o.setName('etat').setDescription('on / off').addChoices({ name: 'on', value: 'on' }, { name: 'off', value: 'off' }).setRequired(true))
    .addIntegerOption((o) => o.setName('minutes').setDescription('Durée en minutes (défaut : config)').setMinValue(1).setMaxValue(1440)));

async function punish(member, why, action) {
  try {
    await member.user.send({ embeds: [embed().setTitle('🛡️ Anti-raid').setDescription(`Serveur : **${member.guild.name}**\n${why}`)] }).catch(() => {});
    if (action === 'ban') await member.ban({ reason: `Anti-raid : ${why}` });
    else if (action === 'timeout') await member.timeout(3600 * 1000, `Anti-raid : ${why}`);
    else await member.kick(`Anti-raid : ${why}`);
    return true;
  } catch { return false; }
}

async function startRaid(guild, minutes, why) {
  const c = cfg(guild.id);
  c.raidUntil = Date.now() + minutes * 60000;
  db.save();
  await log(guild, embed().setColor(0xffffff).setTitle('🚨 RAID MODE ACTIVÉ')
    .setDescription(`${why}\nFin : <t:${Math.floor(c.raidUntil / 1000)}:R>\nSanction : **${c.action}**${c.autoLock ? '\nSalons verrouillés automatiquement.' : ''}`));
  if (c.autoLock) await lock.lockAll(guild, 'Anti-raid');
}

async function endRaid(guild, why = 'Fin de la durée du raid mode.') {
  const c = cfg(guild.id);
  c.raidUntil = 0;
  db.save();
  await log(guild, embed().setTitle('✅ Raid mode terminé').setDescription(why));
  if (c.autoLock) await lock.unlockAll(guild, 'Fin anti-raid');
}

module.exports = {
  name: 'antiraid',
  commands: [command],
  async execute(i) {
    const c = cfg(i.guildId);
    const sub = i.options.getSubcommand();
    const eph = MessageFlags.Ephemeral;

    if (sub === 'toggle') {
      c.enabled = !c.enabled;
      db.save();
      return i.reply({ content: c.enabled ? '🛡️ Anti-raid **activé**.' : '⚠️ Anti-raid **désactivé**.', flags: eph });
    }
    if (sub === 'config') {
      const o = i.options;
      if (o.getInteger('joins') != null) c.joinLimit = o.getInteger('joins');
      if (o.getInteger('secondes') != null) c.joinWindow = o.getInteger('secondes');
      if (o.getString('action')) c.action = o.getString('action');
      if (o.getInteger('age_minimum') != null) c.minAge = o.getInteger('age_minimum');
      if (o.getInteger('duree_raid') != null) c.raidMinutes = o.getInteger('duree_raid');
      if (o.getBoolean('autolock') != null) c.autoLock = o.getBoolean('autolock');
      if (o.getBoolean('anti_invite') != null) c.antiInvite = o.getBoolean('anti_invite');
      if (o.getInteger('mentions_max') != null) c.mentionLimit = o.getInteger('mentions_max');
      db.save();
    }
    if (sub === 'raidmode') {
      if (i.options.getString('etat') === 'on') {
        await i.deferReply({ flags: eph });
        await startRaid(i.guild, i.options.getInteger('minutes') || c.raidMinutes, `Activé manuellement par ${i.user}.`);
        return i.editReply('🚨 Raid mode activé : tous les nouveaux arrivants seront sanctionnés.');
      }
      await i.deferReply({ flags: eph });
      await endRaid(i.guild, `Désactivé manuellement par ${i.user}.`);
      return i.editReply('✅ Raid mode désactivé.');
    }

    const raid = Date.now() < c.raidUntil;
    return i.reply({
      flags: eph,
      embeds: [embed().setTitle('🛡️ Anti-raid').addFields(
        { name: 'État', value: c.enabled ? '✅ Actif' : '❌ Désactivé', inline: true },
        { name: 'Raid mode', value: raid ? `🚨 Actif (fin <t:${Math.floor(c.raidUntil / 1000)}:R>)` : 'Inactif', inline: true },
        { name: 'Détection', value: `${c.joinLimit} joins / ${c.joinWindow}s`, inline: true },
        { name: 'Sanction', value: c.action, inline: true },
        { name: 'Âge min. compte', value: c.minAge ? `${c.minAge} jour(s)` : 'Off', inline: true },
        { name: 'Durée raid', value: `${c.raidMinutes} min`, inline: true },
        { name: 'Auto-lock', value: c.autoLock ? 'Oui' : 'Non', inline: true },
        { name: 'Anti-invite', value: c.antiInvite ? 'Oui' : 'Non', inline: true },
        { name: 'Mentions max', value: c.mentionLimit ? `${c.mentionLimit}` : 'Off', inline: true })],
    });
  },

  init(client) {
    // Détection des raids (flood de joins, raid mode, comptes trop récents)
    client.on(Events.GuildMemberAdd, async (member) => {
      if (member.user.bot) return;
      const c = cfg(member.guild.id);
      if (!c.enabled) return;
      const now = Date.now();
      const list = (joins.get(member.guild.id) || []).filter((j) => now - j.t < c.joinWindow * 1000);
      list.push({ id: member.id, t: now });
      joins.set(member.guild.id, list);

      if (now < c.raidUntil) return void punish(member, 'Raid mode actif : les arrivées sont bloquées.', c.action);
      if (c.minAge > 0 && now - member.user.createdTimestamp < c.minAge * 864e5)
        return void punish(member, `Compte trop récent (minimum ${c.minAge} jour(s)).`, c.action);

      if (list.length >= c.joinLimit) {
        joins.set(member.guild.id, []);
        await startRaid(member.guild, c.raidMinutes, `Flood détecté : **${list.length}** arrivées en ${c.joinWindow}s.`);
        let n = 0;
        for (const j of list) {
          const m = await member.guild.members.fetch(j.id).catch(() => null);
          if (m && (await punish(m, 'Raid détecté.', c.action))) n++;
        }
        await log(member.guild, embed().setDescription(`🛡️ **${n}** raider(s) sanctionné(s) (${c.action}).`));
      }
    });

    // Anti-invite et anti-mentions de masse
    client.on(Events.MessageCreate, async (m) => {
      if (!m.guild || m.author.bot || !m.member) return;
      const c = cfg(m.guild.id);
      if (!c.enabled || m.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;

      if (c.antiInvite && INVITE.test(m.content)) {
        await m.delete().catch(() => {});
        const w = await m.channel.send(`${m.author}, les invitations Discord sont interdites ici.`).catch(() => null);
        setTimeout(() => w?.delete().catch(() => {}), 5000);
        return;
      }
      if (c.mentionLimit && m.mentions.users.size + m.mentions.roles.size > c.mentionLimit) {
        await m.delete().catch(() => {});
        await m.member.timeout(10 * 60000, 'Anti-raid : mentions de masse').catch(() => {});
        await log(m.guild, embed().setTitle('🛡️ Mentions de masse').setDescription(`${m.author} a été mis en timeout 10 min.`));
      }
    });

    // Fin automatique du raid mode
    setInterval(() => {
      for (const guild of client.guilds.cache.values()) {
        const c = cfg(guild.id);
        if (c.raidUntil && Date.now() >= c.raidUntil) endRaid(guild).catch(console.error);
      }
    }, 30 * 1000);
  },
};
