// Mini serveur HTTP pour Render : répond sur / et /health (cible de ton cron de 5 min).
const http = require('http');
const port = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
  })
  .listen(port, '0.0.0.0', () => console.log(`🌐 Keep-alive sur le port ${port}`));
