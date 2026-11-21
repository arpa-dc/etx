const { EmbedBuilder } = require('discord.js');
const BLUE = 0x1e5bff;
const embed = () => new EmbedBuilder().setColor(BLUE).setFooter({ text: 'ETX' }).setTimestamp();
module.exports = { BLUE, embed };
