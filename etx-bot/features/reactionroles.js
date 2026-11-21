const { SlashCommandBuilder, PermissionFlagsBits, Events, MessageFlags } = require('discord.js');
const db = require('../utils/db');
const { embed } = require('../utils/embed');

const command = new SlashCommandBuilder()
  .setName('reactionrole')
  .setDescription('Rôles par réaction')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
  .addSubcommand((s) => s.setName('add').setDescription('Lier un emoji à un rôle sur un message')
    .addStringOption((o) => o.setName('message_id').setDescription('ID du message').setRequired(true))
    .addStringOption((o) => o.setName('emoji').setDescription('Emoji (standard ou custom)').setRequired(true))
    .addRoleOption((o) => o.setName('role').setDescription('Rôle à donner').setRequired(true))
    .addChannelOption((o) => o.setName('salon').setDescription('Salon du message (défaut : ici)')))
  .addSubcommand((s) => s.setName('remove').setDescription('Supprimer une liaison')
    .addStringOption((o) => o.setName('message_id').setDescription('ID du message').setRequired(true))
    .addStringOption((o) => o.setName('emoji').setDescription('Emoji').setRequired(true)))
  .addSubcommand((s) => s.setName('list').setDescription('Lister les rôles réaction'));

const parseEmoji = (s) => {
  const m = s.match(/<a?:\w+:(\d+)>/);
  return m ? m[1] : s.trim();
};

async function handle(reaction, user, add) {
  if (user.bot) return;
  if (reaction.partial) await reaction.fetch().catch(() => {});
  if (reaction.message.partial) await reaction.message.fetch().catch(() => {});
  const guild = reaction.message.guild;
  if (!guild) return;
  const key = reaction.emoji.id ?? reaction.emoji.name;
  const rr = (db.guild(guild.id).reactionRoles || []).find((r) => r.messageId === reaction.message.id && r.key === key);
  if (!rr) return;
  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return;
  if (add) await member.roles.add(rr.roleId).catch(() => {});
  else await member.roles.remove(rr.roleId).catch(() => {});
}

module.exports = {
  name: 'reactionrole',
  commands: [command],
  async execute(i) {
    const g = db.guild(i.guildId);
    g.reactionRoles ||= [];
    const sub = i.options.getSubcommand();
    const eph = MessageFlags.Ephemeral;

    if (sub === 'add') {
      const role = i.options.getRole('role');
      if (role.managed || role.position >= i.guild.members.me.roles.highest.position)
        return i.reply({ content: '❌ Je ne peux pas attribuer ce rôle (position trop haute ou rôle géré).', flags: eph });
      const ch = i.options.getChannel('salon') || i.channel;
      const msg = await ch.messages.fetch(i.options.getString('message_id')).catch(() => null);
      if (!msg) return i.reply({ content: '❌ Message introuvable dans ce salon.', flags: eph });
      const key = parseEmoji(i.options.getString('emoji'));
      try { await msg.react(key); } catch { return i.reply({ content: '❌ Emoji invalide (le bot doit avoir accès à cet emoji).', flags: eph }); }
      g.reactionRoles = g.reactionRoles.filter((r) => !(r.messageId === msg.id && r.key === key));
      g.reactionRoles.push({ channelId: ch.id, messageId: msg.id, key, roleId: role.id });
      db.save();
      return i.reply({ content: `✅ ${i.options.getString('emoji')} → ${role}`, flags: eph });
    }
    if (sub === 'remove') {
      const key = parseEmoji(i.options.getString('emoji'));
      const before = g.reactionRoles.length;
      g.reactionRoles = g.reactionRoles.filter((r) => !(r.messageId === i.options.getString('message_id') && r.key === key));
      db.save();
      return i.reply({ content: before === g.reactionRoles.length ? '❌ Aucune liaison trouvée.' : '✅ Supprimé.', flags: eph });
    }
    const lines = g.reactionRoles.map((r) => `${/^\d+$/.test(r.key) ? `<:e:${r.key}>` : r.key} → <@&${r.roleId}> — [message](https://discord.com/channels/${i.guildId}/${r.channelId}/${r.messageId})`);
    return i.reply({ embeds: [embed().setTitle('Rôles réaction').setDescription(lines.join('\n') || 'Aucun.')], flags: eph });
  },
  init(client) {
    client.on(Events.MessageReactionAdd, (r, u) => handle(r, u, true).catch(console.error));
    client.on(Events.MessageReactionRemove, (r, u) => handle(r, u, false).catch(console.error));
  },
};
