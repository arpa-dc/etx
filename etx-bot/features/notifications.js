const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const Parser = require('rss-parser');
const db = require('../utils/db');
const { embed } = require('../utils/embed');

const parser = new Parser();
const PLATFORMS = {
  twitch: { label: 'Twitch', icon: '🟣' },
  youtube: { label: 'YouTube', icon: '🔴' },
  tiktok: { label: 'TikTok', icon: '⚫' },
  twitter: { label: 'Twitter / X', icon: '🐦' },
};
const choices = Object.entries(PLATFORMS).map(([value, p]) => ({ name: p.label, value }));

const command = new SlashCommandBuilder()
  .setName('notif')
  .setDescription('Notifications Twitch, YouTube, TikTok et Twitter')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .addSubcommand((s) => s.setName('add').setDescription('Ajouter une notification')
    .addStringOption((o) => o.setName('plateforme').setDescription('Plateforme').addChoices(...choices).setRequired(true))
    .addStringOption((o) => o.setName('compte').setDescription('Pseudo (YouTube : ID de chaîne commençant par UC)').setRequired(true))
    .addChannelOption((o) => o.setName('salon').setDescription('Salon des annonces').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
    .addStringOption((o) => o.setName('message').setDescription('Texte : {account} {title} {url}').setMaxLength(500)))
  .addSubcommand((s) => s.setName('remove').setDescription('Supprimer une notification')
    .addStringOption((o) => o.setName('plateforme').setDescription('Plateforme').addChoices(...choices).setRequired(true))
    .addStringOption((o) => o.setName('compte').setDescription('Compte').setRequired(true)))
  .addSubcommand((s) => s.setName('list').setDescription('Lister les notifications'));

// ---------- Récupération du dernier contenu ----------
let twitchToken = null, twitchExp = 0;
async function getTwitchToken() {
  if (twitchToken && Date.now() < twitchExp) return twitchToken;
  const { TWITCH_CLIENT_ID: id, TWITCH_CLIENT_SECRET: secret } = process.env;
  if (!id || !secret) throw new Error('TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET manquants');
  const r = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${id}&client_secret=${secret}&grant_type=client_credentials`, { method: 'POST' });
  const j = await r.json();
  twitchToken = j.access_token;
  twitchExp = Date.now() + (j.expires_in - 60) * 1000;
  return twitchToken;
}

const rssFetchers = {
  async youtube(account) {
    const feed = await parser.parseURL(`https://www.youtube.com/feeds/videos.xml?channel_id=${account}`);
    const it = feed.items[0];
    if (!it) return null;
    const vid = (it.id || '').split(':').pop();
    return { id: it.id || it.link, title: it.title, url: it.link, author: feed.title, image: `https://i.ytimg.com/vi/${vid}/hqdefault.jpg` };
  },
  async tiktok(account) {
    const feed = await parser.parseURL(`${process.env.RSSHUB_URL || 'https://rsshub.app'}/tiktok/user/@${account.replace('@', '')}`);
    const it = feed.items[0];
    return it && { id: it.guid || it.link, title: it.title, url: it.link, author: account };
  },
  async twitter(account) {
    const feed = await parser.parseURL(`${process.env.RSSHUB_URL || 'https://rsshub.app'}/twitter/user/${account.replace('@', '')}`);
    const it = feed.items[0];
    return it && { id: it.guid || it.link, title: (it.contentSnippet || it.title || '').slice(0, 250), url: it.link, author: account };
  },
  async twitch(account) {
    const token = await getTwitchToken();
    const r = await fetch(`https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(account)}`, {
      headers: { 'Client-Id': process.env.TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` },
    });
    const s = (await r.json()).data?.[0];
    if (!s) return null; // hors ligne
    return {
      id: s.id, title: s.title, url: `https://twitch.tv/${s.user_login}`, author: s.user_name,
      game: s.game_name, image: s.thumbnail_url.replace('{width}', '1280').replace('{height}', '720') + `?t=${Date.now()}`,
    };
  },
};

async function checkAll(client) {
  for (const guild of client.guilds.cache.values()) {
    const g = db.guild(guild.id);
    for (const n of g.notifs || []) {
      try {
        const item = await rssFetchers[n.platform](n.account);
        if (!item) continue;
        if (n.last === undefined || n.last === null) { n.last = item.id; db.save(); continue; } // base de départ, pas de spam
        if (n.last === item.id) continue;
        n.last = item.id;
        db.save();
        const ch = guild.channels.cache.get(n.channelId);
        if (!ch) continue;
        const p = PLATFORMS[n.platform];
        const text = (n.message || (n.platform === 'twitch' ? '{account} est en live !' : 'Nouveau contenu de {account} !'))
          .replaceAll('{account}', item.author || n.account).replaceAll('{title}', item.title || '').replaceAll('{url}', item.url);
        const e = embed().setTitle(`${p.icon} ${item.title || p.label}`.slice(0, 256)).setURL(item.url)
          .setAuthor({ name: `${item.author || n.account} • ${p.label}` });
        if (item.game) e.setDescription(`Joue à **${item.game}**`);
        if (item.image) e.setImage(item.image);
        await ch.send({ content: `${text}\n${item.url}`, embeds: [e] });
      } catch (err) {
        console.error(`[notif ${n.platform}/${n.account}]`, err.message);
      }
    }
  }
}

module.exports = {
  name: 'notifications',
  commands: [command],
  async execute(i) {
    const g = db.guild(i.guildId);
    g.notifs ||= [];
    const sub = i.options.getSubcommand();
    const eph = MessageFlags.Ephemeral;
    if (sub === 'add') {
      const platform = i.options.getString('plateforme');
      const account = i.options.getString('compte').trim();
      if (platform === 'youtube' && !/^UC[\w-]{22}$/.test(account))
        return i.reply({ content: "❌ Pour YouTube, donne l'**ID de chaîne** (commence par `UC`, 24 caractères).", flags: eph });
      g.notifs = g.notifs.filter((n) => !(n.platform === platform && n.account.toLowerCase() === account.toLowerCase()));
      g.notifs.push({ platform, account, channelId: i.options.getChannel('salon').id, message: i.options.getString('message'), last: null });
      db.save();
      return i.reply({ content: `✅ Notification **${PLATFORMS[platform].label}** pour \`${account}\` ajoutée.`, flags: eph });
    }
    if (sub === 'remove') {
      const before = g.notifs.length;
      g.notifs = g.notifs.filter((n) => !(n.platform === i.options.getString('plateforme') && n.account.toLowerCase() === i.options.getString('compte').toLowerCase()));
      db.save();
      return i.reply({ content: before === g.notifs.length ? '❌ Introuvable.' : '✅ Supprimée.', flags: eph });
    }
    const lines = g.notifs.map((n) => `${PLATFORMS[n.platform].icon} **${n.account}** → <#${n.channelId}>`);
    return i.reply({ embeds: [embed().setTitle('Notifications').setDescription(lines.join('\n') || 'Aucune.')], flags: eph });
  },
  init(client) {
    setInterval(() => checkAll(client).catch(console.error), 2 * 60 * 1000);
    setTimeout(() => checkAll(client).catch(console.error), 10 * 1000);
  },
};
