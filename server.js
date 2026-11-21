require('dotenv').config();
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, AttachmentBuilder, Events } = require('discord.js');

const bots = {
  bot: { mod: require('./etx-bot'), token: process.env.TOKEN_BOT, name: 'ETX Bot' },
  protect: { mod: require('./etx-protect'), token: process.env.TOKEN_PROTECT, name: 'ETX Protect' },
};
const dbBot = require('./etx-bot/utils/db');
const dbProt = require('./etx-protect/utils/db');
const lock = require('./etx-protect/features/lock');
const raid = require('./etx-protect/features/antiraid');
const G = require('./etx-bot/features/giveaways');
const PL = require('./etx-bot/features/polls');
const { embed: bEmbed } = require('./etx-bot/utils/embed');
const { buildWelcomeCard } = require('./etx-bot/utils/welcomeCard');
const { parseDuration } = require('./etx-protect/utils/time');
const { embed: pEmbed, log: pLog } = require('./etx-protect/utils/helpers');

// ---------- Authentification (mot de passe en variable d'environnement) ----------
const PASS = process.env.DASHBOARD_PASSWORD;
if (!PASS) console.warn('⚠️ DASHBOARD_PASSWORD manquant : connexion impossible.');
const SECRET = process.env.SESSION_SECRET || crypto.createHash('sha256').update(`etx:${PASS}`).digest('hex');
const sign = (v) => crypto.createHmac('sha256', SECRET).update(v).digest('hex');
const newToken = () => { const exp = Date.now() + 7 * 864e5; return `${exp}.${sign(String(exp))}`; };
const validToken = (t) => {
  if (!t) return false;
  const [exp, sig] = t.split('.');
  if (!sig || Date.now() > Number(exp)) return false;
  const a = Buffer.from(sig), b = Buffer.from(sign(exp));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest();
const attempts = new Map();

// ---------- Actions ----------
const ch = (g, id) => {
  const c = g.channels.cache.get(String(id));
  if (!c || !c.isTextBased()) throw new Error('Salon invalide');
  return c;
};
const num = (v, min, max) => Math.min(max, Math.max(min, parseInt(v, 10) || 0));

const dbs = { bot: dbBot, protect: dbProt };
const ACT = { playing: 0, listening: 2, watching: 3, custom: 4, competing: 5 };
function applyStatus(k) {
  const c = bots[k].mod.client;
  const s = dbs[k].guild('_global').status;
  if (!s || !c.isReady()) return;
  const type = ACT[s.type] ?? 0;
  c.user.setPresence({
    status: s.status || 'online',
    activities: s.text ? [type === 4 ? { name: 'custom', state: s.text, type } : { name: s.text, type }] : [],
  });
}
function setStatus(k, d) {
  if (!['online', 'idle', 'dnd', 'invisible'].includes(d.status) || !(d.type in ACT)) throw new Error('Statut invalide');
  dbs[k].guild('_global').status = { status: d.status, type: d.type, text: String(d.text || '').slice(0, 100) };
  dbs[k].save();
  applyStatus(k);
}
const globalActions = new Set(['bot.status', 'protect.status']);

const actions = {
  'bot.status': (_, d) => setStatus('bot', d),
  'protect.status': (_, d) => setStatus('protect', d),
  'bot.rr.add': async (g, d) => {
    const role = g.roles.cache.get(d.roleId);
    if (!role || role.managed || role.position >= g.members.me.roles.highest.position) throw new Error('Rôle inaccessible (mets le rôle du bot plus haut)');
    const c = ch(g, d.channelId);
    const msg = await c.messages.fetch(String(d.messageId || '').trim()).catch(() => null);
    if (!msg) throw new Error('Message introuvable dans ce salon');
    const m = String(d.emoji || '').match(/<a?:\w+:(\d+)>/);
    const key = m ? m[1] : String(d.emoji || '').trim();
    if (!key) throw new Error('Emoji requis');
    await msg.react(key).catch(() => { throw new Error('Emoji invalide'); });
    const s = dbBot.guild(g.id);
    s.reactionRoles = (s.reactionRoles || []).filter((r) => !(r.messageId === msg.id && r.key === key));
    s.reactionRoles.push({ channelId: c.id, messageId: msg.id, key, roleId: role.id });
    dbBot.save();
  },
  'bot.rr.remove': (g, d) => { (dbBot.guild(g.id).reactionRoles || []).splice(Number(d.index), 1); dbBot.save(); },
  'bot.ticket': async (g, d) => {
    const cat = g.channels.cache.get(d.categoryId);
    if (!cat || cat.type !== ChannelType.GuildCategory) throw new Error('Catégorie invalide');
    if (!g.roles.cache.has(d.roleId)) throw new Error('Rôle staff invalide');
    dbBot.guild(g.id).tickets = { categoryId: cat.id, staffRoleId: d.roleId };
    dbBot.save();
    const row = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('tickets:open').setLabel('Ouvrir un ticket').setEmoji('🎫').setStyle(ButtonStyle.Primary));
    await ch(g, d.channelId).send({ embeds: [bEmbed().setTitle(d.title || '🎫 Support ETX').setDescription('Une question, un problème ou une demande ?\nClique sur le bouton ci-dessous pour ouvrir un ticket privé avec le staff.')], components: [row] });
  },
  'bot.gw.start': async (g, d) => {
    const ms = parseDuration(d.duration);
    if (!ms || ms < 10000) throw new Error('Durée invalide (ex : 30m, 2h, 1d)');
    const c = ch(g, d.channelId);
    const gw = { channelId: c.id, prize: String(d.prize || '').slice(0, 200) || 'Surprise', winners: num(d.winners, 1, 20) || 1, host: g.client.user.id, endsAt: Date.now() + ms, entries: [], ended: false };
    const msg = await c.send({ embeds: [G.gwEmbed(gw)], components: [G.row()] });
    (dbBot.guild(g.id).giveaways ||= {})[msg.id] = gw;
    dbBot.save();
  },
  'bot.gw.end': async (g, d) => { if (!(await G.endGiveaway(g.client, g.id, d.id))) throw new Error('Introuvable ou déjà terminé'); },
  'bot.gw.reroll': async (g, d) => {
    const gw = dbBot.guild(g.id).giveaways?.[d.id];
    if (!gw?.ended) throw new Error('Giveaway non terminé');
    const w = G.pick(gw.entries, gw.winners);
    if (!w.length) throw new Error('Aucun participant');
    await ch(g, gw.channelId).send(`🔁 Nouveau(x) gagnant(s) pour **${gw.prize}** : ${w.map((x) => `<@${x}>`).join(', ')} 🎉`);
  },
  'bot.poll.create': async (g, d) => {
    const options = String(d.options || '').split(/\n|\|/).map((s) => s.trim()).filter(Boolean);
    if (options.length < 2 || options.length > 5) throw new Error('2 à 5 choix (un par ligne)');
    const c = ch(g, d.channelId);
    const p = { question: String(d.question || '').slice(0, 250), options, votes: {}, author: g.client.user.id, ended: false, channelId: c.id };
    const msg = await c.send({ embeds: [PL.pollEmbed(p)], components: [PL.buttons(p)] });
    (dbBot.guild(g.id).polls ||= {})[msg.id] = p;
    dbBot.save();
  },
  'bot.poll.end': async (g, d) => {
    const p = dbBot.guild(g.id).polls?.[d.id];
    if (!p || p.ended) throw new Error('Introuvable ou déjà terminé');
    p.ended = true;
    dbBot.save();
    const msg = await ch(g, p.channelId).messages.fetch(d.id).catch(() => null);
    await msg?.edit({ embeds: [PL.pollEmbed(p)], components: [PL.buttons(p, true)] });
  },
  'bot.reward.add': (g, d) => {
    if (!g.roles.cache.has(d.roleId)) throw new Error('Rôle invalide');
    (dbBot.guild(g.id).levelRewards ||= {})[num(d.level, 1, 1000)] = d.roleId;
    dbBot.save();
  },
  'bot.reward.remove': (g, d) => { delete dbBot.guild(g.id).levelRewards?.[d.level]; dbBot.save(); },
  'protect.clear': async (g, d) => {
    const c = ch(g, d.channelId);
    let msgs = await c.messages.fetch({ limit: 100 });
    if (d.userId) msgs = msgs.filter((m) => m.author.id === String(d.userId).trim());
    const del = await c.bulkDelete([...msgs.values()].slice(0, num(d.count, 1, 100) || 1), true);
    return { msg: `🧹 ${del.size} message(s) supprimé(s)` };
  },
  'protect.slowmode': async (g, d) => { await ch(g, d.channelId).setRateLimitPerUser(num(d.seconds, 0, 21600)); },
  'bot.welcome': async (g, d) => {
    const s = dbBot.guild(g.id);
    s.welcome = { ...s.welcome, channelId: ch(g, d.channelId).id };
    if (d.text) s.welcome.text = String(d.text).slice(0, 40);
    dbBot.save();
    if (d.v === 'test') {
      const png = await buildWelcomeCard(g.members.me, s.welcome.text || 'Bienvenue sur ETX');
      await ch(g, d.channelId).send({ content: 'Aperçu de la carte de bienvenue :', files: [new AttachmentBuilder(png, { name: 'welcome.png' })] });
    }
  },
  'bot.message': (g, d) => ch(g, d.channelId).send({ content: String(d.content || '').slice(0, 2000) || '\u200b' }),
  'bot.embed': (g, d) => {
    if (!d.title && !d.description) throw new Error('Titre ou description requis');
    const e = new EmbedBuilder().setColor(/^#?[0-9a-f]{6}$/i.test(d.color || '') ? parseInt(d.color.replace('#', ''), 16) : 0x1e5bff);
    if (d.title) e.setTitle(String(d.title).slice(0, 256));
    if (d.description) e.setDescription(String(d.description).slice(0, 4000));
    if (/^https?:\/\//.test(d.image || '')) e.setImage(d.image);
    return ch(g, d.channelId).send({ embeds: [e] });
  },
  'bot.levels': (g, d) => {
    const s = dbBot.guild(g.id);
    s.levelCfg = { ...s.levelCfg, disabled: !d.enabled, channelId: d.channelId ? ch(g, d.channelId).id : null };
    dbBot.save();
  },
  'bot.notif.add': (g, d) => {
    if (!['twitch', 'youtube', 'tiktok', 'twitter'].includes(d.platform) || !d.account) throw new Error('Plateforme / compte invalide');
    if (d.platform === 'youtube' && !/^UC[\w-]{22}$/.test(d.account.trim())) throw new Error('YouTube : ID de chaîne (UC...) requis');
    const s = dbBot.guild(g.id);
    s.notifs = (s.notifs || []).filter((n) => !(n.platform === d.platform && n.account.toLowerCase() === d.account.toLowerCase()));
    s.notifs.push({ platform: d.platform, account: d.account.trim(), channelId: ch(g, d.channelId).id, message: d.message || null, last: null });
    dbBot.save();
  },
  'bot.notif.remove': (g, d) => {
    const s = dbBot.guild(g.id);
    (s.notifs || []).splice(Number(d.index), 1);
    dbBot.save();
  },
  'protect.lockall': async (g) => ({ msg: `🔒 ${await lock.lockAll(g, 'Dashboard')} salon(s) verrouillé(s)` }),
  'protect.unlockall': async (g) => ({ msg: `🔓 ${await lock.unlockAll(g, 'Dashboard')} salon(s) déverrouillé(s)` }),
  'protect.lock': async (g, d) => { const c = ch(g, d.channelId); if (d.v === 'off') await lock.unlockChannel(c, 'Dashboard'); else await lock.lockChannel(c, 'Dashboard'); },
  'protect.modlog': (g, d) => { dbProt.guild(g.id).logChannel = ch(g, d.channelId).id; dbProt.save(); },
  'protect.antiraid': (g, d) => {
    const c = raid.cfg(g.id);
    c.enabled = !!d.enabled; c.autoLock = !!d.autoLock; c.antiInvite = !!d.antiInvite;
    c.joinLimit = num(d.joinLimit, 2, 50); c.joinWindow = num(d.joinWindow, 3, 120);
    c.minAge = num(d.minAge, 0, 365); c.raidMinutes = num(d.raidMinutes, 1, 1440); c.mentionLimit = num(d.mentionLimit, 0, 50);
    if (['kick', 'ban', 'timeout'].includes(d.action)) c.action = d.action;
    dbProt.save();
  },
  'protect.raidmode': async (g, d) => {
    if (d.v === 'on') await raid.startRaid(g, num(d.minutes, 1, 1440) || raid.cfg(g.id).raidMinutes, 'Activé depuis le dashboard.');
    else await raid.endRaid(g, 'Désactivé depuis le dashboard.');
  },
  'protect.mod': async (g, d) => {
    const id = String(d.userId || '').trim();
    if (!/^\d{17,20}$/.test(id)) throw new Error('ID utilisateur invalide');
    const why = `Dashboard : ${String(d.reason || 'Aucune raison').slice(0, 400)}`;
    const sw = dbProt.guild(g.id);
    sw.warns ||= {};
    if (d.type === 'warn') { (sw.warns[id] ||= []).push({ mod: g.client.user.id, reason: String(d.reason || 'Aucune raison').slice(0, 400), date: Date.now() }); dbProt.save(); }
    else if (d.type === 'unwarn') {
      const l = sw.warns[id] || [], n = parseInt(d.duration, 10) - 1;
      if (!l[n]) throw new Error('N° de warn invalide (mets-le dans le champ « Durée / N° »)');
      l.splice(n, 1); dbProt.save();
    } else if (d.type === 'clearwarns') { delete sw.warns[id]; dbProt.save(); }
    else if (d.type === 'unban') await g.members.unban(id, why);
    else if (d.type === 'ban') await g.members.ban(id, { reason: why });
    else {
      const m = await g.members.fetch(id).catch(() => null);
      if (!m) throw new Error('Membre introuvable');
      if (d.type === 'kick') await m.kick(why);
      else if (d.type === 'untimeout') await m.timeout(null, why);
      else if (d.type === 'timeout') {
        const ms = parseDuration(d.duration);
        if (!ms || ms > 28 * 864e5) throw new Error('Durée invalide (ex : 10m, 2h, 1d)');
        await m.timeout(ms, why);
      } else throw new Error('Action inconnue');
    }
    await pLog(g, pEmbed().setTitle(`🖥️ ${d.type} (dashboard)`).setDescription(`<@${id}> — ${why}`));
  },
};

// ---------- Serveur HTTP ----------
const json = (res, code, obj, headers = {}) => {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(obj));
};
const readBody = (req) => new Promise((resolve, reject) => {
  let b = '';
  req.on('data', (c) => { b += c; if (b.length > 1e5) { reject(new Error('Trop gros')); req.destroy(); } });
  req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { reject(new Error('JSON invalide')); } });
});
const guildOf = (botKey, id) => {
  const g = bots[botKey]?.mod.client.guilds.cache.get(String(id));
  if (!g) throw new Error('Serveur introuvable (le bot y est-il ?)');
  return g;
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/health') { res.writeHead(200); return res.end('OK'); }
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(fs.readFileSync(path.join(__dirname, 'dashboard', 'index.html')));
    }
    if (!url.pathname.startsWith('/api/')) { res.writeHead(404); return res.end('Not found'); }

    if (url.pathname === '/api/login' && req.method === 'POST') {
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
      const a = attempts.get(ip) || { n: 0, reset: Date.now() + 15 * 60000 };
      if (Date.now() > a.reset) { a.n = 0; a.reset = Date.now() + 15 * 60000; }
      if (a.n >= 5) return json(res, 429, { error: 'Trop de tentatives, réessaie dans 15 minutes.' });
      const { password } = await readBody(req);
      if (!PASS || !crypto.timingSafeEqual(hash(password || ''), hash(PASS))) {
        a.n++; attempts.set(ip, a);
        return json(res, 401, { error: 'Mot de passe incorrect.' });
      }
      attempts.delete(ip);
      return json(res, 200, { ok: true }, { 'Set-Cookie': `sid=${newToken()}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${7 * 86400}` });
    }
    if (url.pathname === '/api/logout') return json(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0' });

    // Tout le reste exige une session valide
    const sid = /(?:^|; )sid=([^;]+)/.exec(req.headers.cookie || '')?.[1];
    if (!validToken(sid)) return json(res, 401, { error: 'Non connecté' });

    if (url.pathname === '/api/status') {
      return json(res, 200, Object.fromEntries(Object.entries(bots).map(([k, b]) => {
        const c = b.mod.client;
        return [k, { name: b.name, online: c.isReady(), tag: c.user?.tag, ping: c.ws.ping, uptime: c.uptime,
          guilds: [...c.guilds.cache.values()].map((g) => ({ id: g.id, name: g.name, members: g.memberCount })) }];
      })));
    }
    if (url.pathname === '/api/guild') {
      const k = url.searchParams.get('bot');
      const g = guildOf(k, url.searchParams.get('id'));
      const channels = [...g.channels.cache.values()].filter((c) => c.isTextBased() && !c.isThread() && !c.isVoiceBased())
        .sort((a, b) => a.rawPosition - b.rawPosition).map((c) => ({ id: c.id, name: c.name }));
      const roles = [...g.roles.cache.values()].filter((r) => !r.managed && r.id !== g.id).sort((x, y) => y.position - x.position).map((r) => ({ id: r.id, name: r.name }));
      const categories = [...g.channels.cache.values()].filter((c) => c.type === ChannelType.GuildCategory).map((c) => ({ id: c.id, name: c.name }));
      const s = dbs[k].guild(g.id);
      const status = dbs[k].guild('_global').status || {};
      const uname = (id) => g.members.cache.get(id)?.user.username || id;
      const data = k === 'bot'
        ? {
          welcome: s.welcome || {}, levelCfg: s.levelCfg || {}, notifs: s.notifs || [], reactionRoles: s.reactionRoles || [],
          tickets: s.tickets || null, rewards: s.levelRewards || {},
          top: Object.entries(s.levels || {}).sort((x, y) => y[1].total - x[1].total).slice(0, 10).map(([id, u]) => ({ name: uname(id), level: u.level, total: u.total })),
          giveaways: Object.entries(s.giveaways || {}).slice(-8).reverse().map(([id, x]) => ({ id, prize: x.prize, endsAt: x.endsAt, ended: x.ended, entries: x.entries.length })),
          polls: Object.entries(s.polls || {}).filter(([, p]) => p.channelId).slice(-8).reverse().map(([id, p]) => ({ id, question: p.question, ended: p.ended, votes: Object.keys(p.votes).length })),
        }
        : {
          antiraid: raid.cfg(g.id), logChannel: s.logChannel || null, locked: Object.keys(s.locks || {}).length,
          warns: Object.entries(s.warns || {}).filter(([, l]) => l.length).map(([id, l]) => ({ id, name: uname(id), list: l.map((w) => w.reason) })),
        };
      return json(res, 200, { channels, roles, categories, status, ...data });
    }
    if (url.pathname === '/api/action' && req.method === 'POST') {
      if (!(req.headers['content-type'] || '').includes('application/json')) return json(res, 415, { error: 'JSON requis' });
      const { bot, guildId, action, data } = await readBody(req);
      if (!actions[action] || !action.startsWith(`${bot}.`)) return json(res, 400, { error: 'Action inconnue' });
      const result = await actions[action](globalActions.has(action) ? null : guildOf(bot, guildId), data || {});
      return json(res, 200, { ok: true, ...(result && Object.getPrototypeOf(result) === Object.prototype ? result : {}) });
    }
    return json(res, 404, { error: 'Not found' });
  } catch (e) {
    return json(res, 400, { error: e.message || 'Erreur' });
  }
});

server.listen(process.env.PORT || 3000, '0.0.0.0', () => console.log(`🌐 Dashboard sur le port ${process.env.PORT || 3000}`));

for (const k of Object.keys(bots)) bots[k].mod.client.once(Events.ClientReady, () => applyStatus(k));
(async () => {
  for (const [k, b] of Object.entries(bots)) {
    if (!b.token) { console.warn(`⚠️ Token manquant pour ${b.name} (TOKEN_${k.toUpperCase()})`); continue; }
    await b.mod.start(b.token).catch((e) => console.error(`❌ ${b.name} :`, e.message));
  }
})();
