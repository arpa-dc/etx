const { createCanvas, loadImage, GlobalFonts } = require('@napi-rs/canvas');
const fs = require('fs');
const path = require('path');

// Optionnel : dépose une police dans assets/fonts/Inter.ttf pour un meilleur rendu
const fontPath = path.join(__dirname, '..', 'assets', 'fonts', 'Inter.ttf');
if (fs.existsSync(fontPath)) GlobalFonts.registerFromPath(fontPath, 'Inter');
const FONT = fs.existsSync(fontPath) ? 'Inter' : 'sans-serif';

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

async function buildWelcomeCard(member, text = 'Bienvenue sur ETX') {
  const W = 1000, H = 360;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  // Fond bleu dégradé
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0a2fd6');
  bg.addColorStop(1, '#2a8bff');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  // Motif décoratif discret
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 2;
  for (let x = -H; x < W; x += 40) {
    ctx.beginPath(); ctx.moveTo(x, H); ctx.lineTo(x + H, 0); ctx.stroke();
  }

  // Panneau sombre
  roundRect(ctx, 24, 24, W - 48, H - 48, 24);
  ctx.fillStyle = 'rgba(4, 15, 66, 0.92)';
  ctx.fill();

  // Avatar (à gauche)
  const url = member.user.displayAvatarURL({ extension: 'png', size: 512, forceStatic: true });
  const img = await loadImage(Buffer.from(await (await fetch(url)).arrayBuffer()));
  const cx = 190, cy = H / 2, r = 110;
  ctx.save();
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
  ctx.drawImage(img, cx - r, cy - r, r * 2, r * 2);
  ctx.restore();
  ctx.beginPath(); ctx.arc(cx, cy, r + 4, 0, Math.PI * 2);
  ctx.lineWidth = 9; ctx.strokeStyle = '#ffffff'; ctx.stroke();

  // Textes (à droite)
  const x = 350;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#7fa8ff';
  ctx.font = `600 26px ${FONT}`;
  ctx.fillText('NOUVEAU MEMBRE', x, 125);

  const name = member.displayName;
  let size = 68;
  ctx.font = `bold ${size}px ${FONT}`;
  while (ctx.measureText(name).width > W - x - 60 && size > 28) {
    size -= 2;
    ctx.font = `bold ${size}px ${FONT}`;
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillText(name, x, 205);

  ctx.fillStyle = '#2f7bff';
  ctx.fillRect(x, 222, 90, 5);

  ctx.fillStyle = '#c9dbff';
  ctx.font = `34px ${FONT}`;
  ctx.fillText(text, x, 272);

  ctx.fillStyle = '#6f8fd8';
  ctx.font = `22px ${FONT}`;
  ctx.fillText(`Membre n°${member.guild.memberCount}`, x, 312);

  return canvas.encode('png');
}

module.exports = { buildWelcomeCard };
