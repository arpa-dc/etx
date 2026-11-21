const {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder,
  ButtonStyle, MessageFlags,
} = require('discord.js');
const db = require('../utils/db');
const { embed } = require('../utils/embed');

const command = new SlashCommandBuilder()
  .setName('ticket')
  .setDescription('Système de tickets')
  .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
  .addSubcommand((s) => s.setName('setup').setDescription('Envoyer le panneau de tickets')
    .addChannelOption((o) => o.setName('salon').setDescription('Salon du panneau').addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addChannelOption((o) => o.setName('categorie').setDescription('Catégorie où créer les tickets').addChannelTypes(ChannelType.GuildCategory).setRequired(true))
    .addRoleOption((o) => o.setName('staff').setDescription('Rôle du staff').setRequired(true))
    .addStringOption((o) => o.setName('titre').setDescription('Titre du panneau').setMaxLength(100)));

const P = PermissionFlagsBits;
const USER_PERMS = [P.ViewChannel, P.SendMessages, P.ReadMessageHistory, P.AttachFiles, P.EmbedLinks];

module.exports = {
  name: 'tickets',
  commands: [command],
  async execute(i) {
    const panelChannel = i.options.getChannel('salon');
    const g = db.guild(i.guildId);
    g.tickets = { categoryId: i.options.getChannel('categorie').id, staffRoleId: i.options.getRole('staff').id };
    db.save();
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('tickets:open').setLabel('Ouvrir un ticket').setEmoji('🎫').setStyle(ButtonStyle.Primary));
    await panelChannel.send({
      embeds: [embed().setTitle(i.options.getString('titre') || '🎫 Support ETX')
        .setDescription('Une question, un problème ou une demande ?\nClique sur le bouton ci-dessous pour ouvrir un ticket privé avec le staff.')],
      components: [row],
    });
    return i.reply({ content: '✅ Panneau envoyé.', flags: MessageFlags.Ephemeral });
  },
  async component(i) {
    const cfg = db.guild(i.guildId).tickets;
    const eph = MessageFlags.Ephemeral;
    if (!cfg) return i.reply({ content: '❌ Tickets non configurés.', flags: eph });

    if (i.customId === 'tickets:open') {
      const existing = i.guild.channels.cache.find((c) => c.topic === `ticket:${i.user.id}`);
      if (existing) return i.reply({ content: `❌ Tu as déjà un ticket : ${existing}`, flags: eph });
      const ch = await i.guild.channels.create({
        name: `ticket-${i.user.username}`.slice(0, 90),
        type: ChannelType.GuildText,
        parent: cfg.categoryId,
        topic: `ticket:${i.user.id}`,
        permissionOverwrites: [
          { id: i.guild.id, deny: [P.ViewChannel] },
          { id: i.user.id, allow: USER_PERMS },
          { id: cfg.staffRoleId, allow: [...USER_PERMS, P.ManageMessages] },
          { id: i.client.user.id, allow: [...USER_PERMS, P.ManageChannels] },
        ],
      });
      const close = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('tickets:close').setLabel('Fermer le ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger));
      await ch.send({
        content: `${i.user} <@&${cfg.staffRoleId}>`,
        embeds: [embed().setTitle('Ticket ouvert').setDescription('Décris ta demande, le staff va te répondre rapidement.')],
        components: [close],
      });
      return i.reply({ content: `✅ Ticket créé : ${ch}`, flags: eph });
    }

    if (i.customId === 'tickets:close') {
      const ownerId = i.channel.topic?.replace('ticket:', '');
      const isStaff = i.member.roles.cache.has(cfg.staffRoleId) || i.member.permissions.has(P.Administrator);
      if (i.user.id !== ownerId && !isStaff) return i.reply({ content: '❌ Tu ne peux pas fermer ce ticket.', flags: eph });
      await i.reply('🔒 Ticket fermé, suppression dans 5 secondes…');
      setTimeout(() => i.channel.delete().catch(() => {}), 5000);
    }
  },
};
