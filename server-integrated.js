'use strict';

require('dotenv').config();

const path = require('node:path');
const express = require('express');
const app = express();
const root = __dirname;
const port = Number(process.env.PORT || 3000);
const auctions = require('./llstd-auctions/server');

app.disable('x-powered-by');
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://i.ibb.co https://cdn.discordapp.com; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'");
  next();
});

app.use('/auctions', auctions);
app.use('/assets', express.static(path.join(root, 'assets'), { index: false, dotfiles: 'deny' }));
app.get('/auction-nav.js', (_req, res) => res.sendFile(path.join(root, 'auction-nav.js')));
app.get('/og-image.gif', (_req, res) => res.sendFile(path.join(root, 'og-image.gif')));
app.get('/og-image.png', (_req, res) => res.sendFile(path.join(root, 'og-image.png')));
app.get('/robots.txt', (_req, res) => res.sendFile(path.join(root, 'robots.txt')));
app.get('/', (_req, res) => res.sendFile(path.join(root, 'index.html')));
app.get(/.*/, (req, res) => {
  if (req.path.startsWith('/assets/') || req.path.includes('.')) {
    return res.status(404).send('Not found');
  }
  return res.sendFile(path.join(root, 'index.html'));
});

app.listen(port, '0.0.0.0', () => {
  console.log(`قاموس أبو فلاح + المزادات يعمل على المنفذ ${port}`);
  if (String(process.env.SESSION_SECRET || '').length < 32 || String(process.env.SESSION_SECRET || '').startsWith('replace-')) {
    console.warn('غيّر SESSION_SECRET في .env قبل تسجيل الدخول.');
  }
});
