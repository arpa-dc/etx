const { SlashCommandBuilder, PermissionFlagsBits, AttachmentBuilder, ChannelType, Events, MessageFlags } = require('discord.js');
const db = require('../utils/db');
const { buildWelcomeCard } = require('../utils/welcomeCard');

const command = new SlashCommandBuilder()
  .setName('welcome')
  .setDescription('Configurer la carte de bienvenue')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) => s.setName('salon').setDescription('Définir le salon de bienvenue')
    .addChannelOption((o) => o.setName('salon').setDescription('Salon').addChannelTypes(ChannelType.GuildText).setRequired(true)))
  .addSubcommand((s) => s.setName('message').setDescription('Changer le texte sous le pseudo')
    .addStringOption((o) => o.setName('texte').setDescription('Ex : Bienvenue sur ETX').setMaxLength(40).setRequired(true)))
  .addSubcommand((s) => s.setName('test').setDescription('Tester la carte avec ton profil'))
  .addSubcommand((s) => s.setName('desactiver').setDescription('Désactiver la bienvenue'));

async function sendWelcome(member, channel) {
  const g = db.guild(member.guild.id);
  const png = await buildWelcomeCard(member, g.welcome?.text || 'Bienvenue sur ETX');
  await channel.send({
    content: `Bienvenue ${member} !`,
    files: [new AttachmentBuilder(png, { name: 'welcome.png' })],
  });
}

module.exports = {
  name: 'welcome',
  commands: [command],
  async execute(i) {
    const g = db.guild(i.guildId);
    g.welcome ||= {};
    const sub = i.options.getSubcommand();
    if (sub === 'salon') {
      g.welcome.channelId = i.options.getChannel('salon').id;
      db.save();
      return i.reply({ content: `✅ Salon de bienvenue : <#${g.welcome.channelId}>`, flags: MessageFlags.Ephemeral });
    }
    if (sub === 'message') {
      g.welcome.text = i.options.getString('texte');
      db.save();
      return i.reply({ content: '✅ Message mis à jour.', flags: MessageFlags.Ephemeral });
    }
    if (sub === 'desactiver') {
      delete g.welcome.channelId;
      db.save();
      return i.reply({ content: '✅ Bienvenue désactivée.', flags: MessageFlags.Ephemeral });
    }
    // test
    await i.deferReply({ flags: MessageFlags.Ephemeral });
    const png = await buildWelcomeCard(i.member, g.welcome.text || 'Bienvenue sur ETX');
    await i.editReply({ files: [new AttachmentBuilder(png, { name: 'welcome.png' })] });
  },
  init(client) {
    client.on(Events.GuildMemberAdd, async (member) => {
      if (member.user.bot) return;
      const id = db.guild(member.guild.id).welcome?.channelId;
      const channel = id && member.guild.channels.cache.get(id);
      if (channel) await sendWelcome(member, channel).catch(console.error);
    });
  },
};
