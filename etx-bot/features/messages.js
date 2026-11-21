const {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType, ModalBuilder, TextInputBuilder,
  TextInputStyle, ActionRowBuilder, MessageFlags,
} = require('discord.js');
const { embed, BLUE } = require('../utils/embed');
const { EmbedBuilder } = require('discord.js');

const channelOpt = (o) => o.setName('salon').setDescription('Salon cible (défaut : ici)')
  .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement);

const commands = [
  new SlashCommandBuilder().setName('message').setDescription('Envoyer un message via le bot')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages).addChannelOption(channelOpt),
  new SlashCommandBuilder().setName('embed').setDescription('Créer un embed personnalisé')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages).addChannelOption(channelOpt),
];

const field = (id, label, style, required, max) => new ActionRowBuilder().addComponents(
  new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(style).setRequired(required).setMaxLength(max));

module.exports = {
  name: 'messages',
  commands,
  async execute(i) {
    const ch = i.options.getChannel('salon') || i.channel;
    if (i.commandName === 'message') {
      const modal = new ModalBuilder().setCustomId(`messages:msg:${ch.id}`).setTitle('Créer un message')
        .addComponents(field('content', 'Contenu', TextInputStyle.Paragraph, true, 2000));
      return i.showModal(modal);
    }
    const modal = new ModalBuilder().setCustomId(`messages:embed:${ch.id}`).setTitle("Créer un embed").addComponents(
      field('title', 'Titre', TextInputStyle.Short, false, 256),
      field('description', 'Description', TextInputStyle.Paragraph, false, 4000),
      field('color', 'Couleur hexa (ex : 1E5BFF)', TextInputStyle.Short, false, 7),
      field('image', "URL de l'image", TextInputStyle.Short, false, 500),
      field('footer', 'Pied de page', TextInputStyle.Short, false, 200),
    );
    return i.showModal(modal);
  },
  async component(i) {
    const [, kind, channelId] = i.customId.split(':');
    const ch = await i.guild.channels.fetch(channelId).catch(() => null);
    if (!ch) return i.reply({ content: '❌ Salon introuvable.', flags: MessageFlags.Ephemeral });

    if (kind === 'msg') {
      await ch.send({ content: i.fields.getTextInputValue('content') });
    } else {
      const title = i.fields.getTextInputValue('title');
      const desc = i.fields.getTextInputValue('description');
      if (!title && !desc) return i.reply({ content: '❌ Mets au moins un titre ou une description.', flags: MessageFlags.Ephemeral });
      const color = i.fields.getTextInputValue('color').replace('#', '');
      const image = i.fields.getTextInputValue('image');
      const footer = i.fields.getTextInputValue('footer');
      const e = new EmbedBuilder().setColor(/^[0-9a-f]{6}$/i.test(color) ? parseInt(color, 16) : BLUE);
      if (title) e.setTitle(title);
      if (desc) e.setDescription(desc);
      if (/^https?:\/\//.test(image)) e.setImage(image);
      if (footer) e.setFooter({ text: footer });
      await ch.send({ embeds: [e] });
    }
    return i.reply({ content: `✅ Envoyé dans <#${ch.id}>.`, flags: MessageFlags.Ephemeral });
  },
};
