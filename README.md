# ETX Bots — discord.js v14 (Node 18+)

Deux bots indépendants : **ETX Bot** (`/`) et **ETX Protect** (`+`).
Chacun a son propre token : crée deux applications sur https://discord.com/developers/applications.

## Installation (pour chaque bot)
```
cd etx-bot        # ou etx-protect
npm install
cp .env.example .env   # puis remplis TOKEN
npm start
```

## Intents à activer (portail développeur → Bot → Privileged Gateway Intents)
- **Server Members Intent** (les deux)
- **Message Content Intent** (les deux)

## Invitation
Scope `bot` + `applications.commands`. Permission **Administrateur** recommandée
(indispensable pour Protect : verrouillage des salons, kick/ban, timeout).
Place le rôle du bot **au-dessus** des rôles qu'il doit gérer.

## ETX Bot
| Commande | Rôle |
|---|---|
| `/welcome salon|message|test|desactiver` | Carte de bienvenue (pdp à gauche, pseudo à droite, texte dessous) |
| `/message`, `/embed` | Création de message / d'embed via formulaire |
| `/reactionrole add|remove|list` | Rôles réaction |
| `/ticket setup` | Panneau de tickets (bouton ouvrir / fermer) |
| `/notif add|remove|list` | Twitch, YouTube, TikTok, Twitter |
| `/giveaway start|end|reroll|list` | Giveaways |
| `/poll create|end` | Sondages à boutons |
| `/rank`, `/leaderboard`, `/levels ...` | Niveaux, classement, rôles récompenses |

### Notifications
- **YouTube** : flux RSS, aucune clé. Utilise l'ID de chaîne (`UC...`).
- **Twitch** : renseigne `TWITCH_CLIENT_ID` / `TWITCH_CLIENT_SECRET`.
- **TikTok / Twitter(X)** : pas d'API gratuite → passe par une instance **RSSHub**
  (`RSSHUB_URL`). Pour Twitter, ton instance RSSHub doit avoir ses identifiants Twitter configurés.
  Idéalement héberge ta propre instance (l'instance publique est souvent limitée).

### Police de la carte
Pour un rendu identique partout, dépose `Inter.ttf` dans `etx-bot/assets/fonts/`.

## ETX Protect
| Commande | Rôle |
|---|---|
| `/alllock`, `/unalllock` | Verrouille / déverrouille tous les salons (états d'origine restaurés) |
| `/lock`, `/unlock` | Salon courant |
| `/kick /ban /unban /timeout /untimeout` | Sanctions |
| `/warn /warns /unwarn /clearwarns` | Avertissements |
| `/clear /slowmode /modlog` | Utilitaires et logs |
| `/antiraid status|toggle|config|raidmode` | Anti-raid |

Anti-raid : détection de flood de joins (5 en 10 s par défaut), raid mode temporaire,
âge minimum des comptes, auto-lock optionnel, anti-invites, anti-mentions de masse.
Note : les administrateurs contournent toujours les permissions de salon (limite Discord).

## Hébergement sur Render
- Type : **Web Service** (Build : `npm install`, Start : `npm start`). Les bots ouvrent un petit
  serveur HTTP (`/health`) sur `PORT` : pointe ton cron de 5 min sur l'URL du service pour éviter la mise en veille.
- Variables d'environnement : `TOKEN`, (+ celles de `.env.example`).
- **Données** : le disque Render est éphémère (reset à chaque redéploiement/redémarrage).
  Ajoute un **Disk** (offre payante), monte-le par ex. sur `/data` et mets `DATA_DIR=/data`.
