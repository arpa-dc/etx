const {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType, ModalBuilder, TextInputBuilder,
  TextInputStyle, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} = require('discord.js');
const db = require('../utils/db');
const { embed } = require('../utils/embed');

const command = new SlashCommandBuilder()
  .setName('reglement')
  .setDescription('Envoyer un règlement avec un bouton « Accepter » qui donne un rôle')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addChannelOption((o) => o.setName('salon').setDescription('Salon du règlement').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
  .addRoleOption((o) => o.setName('role').setDescription('Rôle donné quand on accepte').setRequired(true));

// Envoie le règlement + bouton et enregistre le rôle lié à ce message
async function sendRules(channel, { title, content, roleId, label }) {
  const guild = channel.guild;
  const role = guild.roles.cache.get(roleId);
  if (!role || role.managed || role.position >= guild.members.me.roles.highest.position)
    throw new Error('Rôle inaccessible (place le rôle du bot au-dessus de celui-ci)');
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('rules:accept').setLabel((label || 'Accepter le règlement').slice(0, 80)).setEmoji('✅').setStyle(ButtonStyle.Primary));
  const msg = await channel.send({ embeds: [embed().setTitle(title || '📜 Règlement').setDescription(content)], components: [row] });
  (db.guild(guild.id).rules ||= {})[msg.id] = { roleId: role.id, channelId: channel.id };
  db.save();
  return msg;
}

const field = (id, label, style, required, max) => new ActionRowBuilder().addComponents(
  new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(max));

module.exports = {
  name: 'rules',
  commands: [command],
  sendRules,
  async execute(i) {
    const ch = i.options.getChannel('salon');
    const role = i.options.getRole('role');
    return i.showModal(new ModalBuilder().setCustomId(`rules:modal:${ch.id}:${role.id}`).setTitle('Règlement').addComponents(
      field('title', 'Titre', TextInputStyle.Short, false, 100),
      field('content', 'Texte du règlement', TextInputStyle.Paragraph, true, 4000),
      field('label', 'Texte du bouton', TextInputStyle.Short, false, 60)));
  },
  async component(i) {
    const eph = MessageFlags.Ephemeral;
    const [, kind, channelId, roleId] = i.customId.split(':');

    if (kind === 'modal') {
      const ch = await i.guild.channels.fetch(channelId).catch(() => null);
      if (!ch) return i.reply({ content: '❌ Salon introuvable.', flags: eph });
      try {
        await sendRules(ch, {
          title: i.fields.getTextInputValue('title'),
          content: i.fields.getTextInputValue('content'),
          label: i.fields.getTextInputValue('label'),
          roleId,
        });
      } catch (e) { return i.reply({ content: `❌ ${e.message}`, flags: eph }); }
      return i.reply({ content: `✅ Règlement envoyé dans ${ch}.`, flags: eph });
    }

    // Clic sur « Accepter »
    const r = db.guild(i.guildId).rules?.[i.message.id];
    const role = r && i.guild.roles.cache.get(r.roleId);
    if (!role) return i.reply({ content: '❌ Ce règlement n\'est plus configuré.', flags: eph });
    if (i.member.roles.cache.has(role.id)) return i.reply({ content: '✅ Tu as déjà accepté le règlement.', flags: eph });
    try { await i.member.roles.add(role, 'Règlement accepté'); }
    catch { return i.reply({ content: '❌ Je ne peux pas te donner ce rôle (permissions du bot).', flags: eph }); }
    return i.reply({ content: `✅ Règlement accepté ! Tu as reçu le rôle ${role}.`, flags: eph });
  },
};
