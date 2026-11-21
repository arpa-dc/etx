const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, OverwriteType, MessageFlags } = require('discord.js');
const db = require('../utils/db');
const { embed, log } = require('../utils/helpers');

const PERMS = ['SendMessages', 'SendMessagesInThreads'];
const LOCKABLE = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum];

const commands = [
  new SlashCommandBuilder().setName('alllock').setDescription('Verrouille tous les salons (seul le propriétaire / les admins peuvent écrire)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('unalllock').setDescription('Déverrouille tous les salons')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
  new SlashCommandBuilder().setName('lock').setDescription('Verrouille le salon actuel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
  new SlashCommandBuilder().setName('unlock').setDescription('Déverrouille le salon actuel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels),
];

const readState = (ow) => Object.fromEntries(PERMS.map((p) => [p, ow?.allow.has(p) ? true : ow?.deny.has(p) ? false : null]));

// Verrouille @everyone + tous les rôles ayant une autorisation explicite d'écrire dans le salon.
async function lockChannel(channel, reason = 'Verrouillage') {
  const g = db.guild(channel.guild.id);
  g.locks ||= {};
  if (g.locks[channel.id]) return false;
  const everyone = channel.guild.roles.everyone.id;
  const botRole = channel.guild.members.me?.roles.botRole?.id;
  const targets = [everyone];
  for (const ow of channel.permissionOverwrites.cache.values()) {
    if (ow.type === OverwriteType.Role && ow.id !== everyone && ow.id !== botRole && ow.allow.has('SendMessages')) targets.push(ow.id);
  }
  const saved = {};
  for (const id of targets) {
    saved[id] = readState(channel.permissionOverwrites.cache.get(id));
    await channel.permissionOverwrites.edit(id, Object.fromEntries(PERMS.map((p) => [p, false])), { reason });
  }
  g.locks[channel.id] = saved;
  db.save();
  return true;
}

async function unlockChannel(channel, reason = 'Déverrouillage') {
  const g = db.guild(channel.guild.id);
  const saved = g.locks?.[channel.id];
  if (!saved) {
    // Salon verrouillé à la main : on réinitialise simplement @everyone
    await channel.permissionOverwrites.edit(channel.guild.roles.everyone.id,
      Object.fromEntries(PERMS.map((p) => [p, null])), { reason });
    return false;
  }
  for (const [id, state] of Object.entries(saved)) {
    await channel.permissionOverwrites.edit(id, state, { reason }).catch(() => {});
  }
  delete g.locks[channel.id];
  db.save();
  return true;
}

const lockable = (guild) => guild.channels.cache.filter((c) => LOCKABLE.includes(c.type));

async function lockAll(guild, reason = 'Verrouillage global') {
  let n = 0;
  for (const ch of lockable(guild).values()) {
    try { if (await lockChannel(ch, reason)) n++; } catch (e) { console.error(`lock ${ch.name}`, e.message); }
  }
  return n;
}

async function unlockAll(guild, reason = 'Déverrouillage global') {
  let n = 0;
  const g = db.guild(guild.id);
  for (const id of Object.keys(g.locks || {})) {
    const ch = guild.channels.cache.get(id);
    if (!ch) { delete g.locks[id]; continue; }
    try { if (await unlockChannel(ch, reason)) n++; } catch (e) { console.error(`unlock ${ch.name}`, e.message); }
  }
  db.save();
  return n;
}

module.exports = {
  name: 'lock',
  commands,
  lockAll,
  unlockAll,
  async execute(i) {
    const eph = MessageFlags.Ephemeral;
    if (i.commandName === 'alllock') {
      await i.deferReply({ flags: eph });
      const n = await lockAll(i.guild, `alllock par ${i.user.tag}`);
      await log(i.guild, embed().setTitle('🔒 Verrouillage global').setDescription(`Par ${i.user} — **${n}** salon(s) verrouillé(s).`));
      return i.editReply(`🔒 **${n}** salon(s) verrouillé(s). Seuls le propriétaire et les administrateurs peuvent écrire.`);
    }
    if (i.commandName === 'unalllock') {
      await i.deferReply({ flags: eph });
      const n = await unlockAll(i.guild, `unalllock par ${i.user.tag}`);
      await log(i.guild, embed().setTitle('🔓 Déverrouillage global').setDescription(`Par ${i.user} — **${n}** salon(s) déverrouillé(s).`));
      return i.editReply(`🔓 **${n}** salon(s) déverrouillé(s).`);
    }
    if (!LOCKABLE.includes(i.channel.type)) return i.reply({ content: '❌ Salon non verrouillable.', flags: eph });
    if (i.commandName === 'lock') {
      const done = await lockChannel(i.channel, `lock par ${i.user.tag}`);
      if (!done) return i.reply({ content: '⚠️ Ce salon est déjà verrouillé.', flags: eph });
      await log(i.guild, embed().setTitle('🔒 Salon verrouillé').setDescription(`${i.channel} par ${i.user}`));
      return i.reply({ embeds: [embed().setDescription('🔒 **Ce salon est verrouillé.**')] });
    }
    await unlockChannel(i.channel, `unlock par ${i.user.tag}`);
    await log(i.guild, embed().setTitle('🔓 Salon déverrouillé').setDescription(`${i.channel} par ${i.user}`));
    return i.reply({ embeds: [embed().setDescription('🔓 **Ce salon est déverrouillé.**')] });
  },
};
