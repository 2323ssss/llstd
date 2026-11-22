'use strict';

require('dotenv').config();

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const {
  Client,
  GatewayIntentBits,
  Events,
  ChannelType,
  PermissionFlagsBits,
  MessageFlags,
  SlashCommandBuilder
} = require('discord.js');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'store.json');
const UPLOAD_DIR = path.join(ROOT, 'public', 'plate-uploads');
const PORT = Number(process.env.PORT || 3000);
const API = 'https://discord.com/api/v10';
const TERMS_VERSION = '2026-11-22-v1';
const LETTERS_AR = [...'ابحدرسصطعقكلمَنهوي'.replace('َ', '')];
const LETTERS_EN = [...'ABJDRSXTEGKLZNHUV'];
const DIGIT_AR = '٠١٢٣٤٥٦٧٨٩';

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

function csvEnv(key) {
  return String(process.env[key] || '').split(',').map((x) => x.trim()).filter(Boolean);
}

function emptyStore() {
  return {
    settings: {
      adminRoleIds: [],
      commandRoleIds: [],
      blockedRoleIds: [],
      adminCanListWithoutCode: false,
      logClientIps: String(process.env.LOG_CLIENT_IPS).toLowerCase() === 'true',
      logChannels: { control: '', plates: '', bids: '', moderation: '' }
    },
    codes: [],
    auctions: []
  };
}

function loadStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    const defaults = emptyStore();
    parsed.settings = { ...defaults.settings, ...(parsed.settings || {}) };
    parsed.settings.logChannels = {
      ...defaults.settings.logChannels,
      ...(parsed.settings.logChannels || {})
    };
    parsed.codes = Array.isArray(parsed.codes)
      ? parsed.codes.filter((entry) => Number(entry.usedListings || 0) === 0)
      : [];
    parsed.auctions = Array.isArray(parsed.auctions) ? parsed.auctions : [];
    return parsed;
  } catch {
    return emptyStore();
  }
}

let store = loadStore();

function saveStore() {
  const temp = `${DB_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(temp, DB_FILE);
}

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use((_req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https://cdn.discordapp.com; connect-src 'self'; object-src 'none'; base-uri 'none'");
  next();
});
app.use(express.static(path.join(ROOT, 'public'), { index: false }));

const sessions = new Map();
const SESSION_SECRET = process.env.SESSION_SECRET || '';

function hmac(value) {
  return crypto.createHmac('sha256', SESSION_SECRET || 'not-configured').update(value).digest('hex');
}

function setSessionCookie(res, id) {
  const value = `${id}.${hmac(id)}`;
  const secure = process.env.COOKIE_SECURE === 'true' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=43200${secure}`);
}

function readSessionId(req) {
  const raw = String(req.headers.cookie || '').split(';').map((part) => part.trim())
    .find((part) => part.startsWith('sid='));
  if (!raw) return '';
  const value = decodeURIComponent(raw.slice(4));
  const separator = value.lastIndexOf('.');
  if (separator < 1) return '';
  const id = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const expected = hmac(id);
  if (signature.length !== expected.length) return '';
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected)) ? id : '';
}

app.use((req, res, next) => {
  let id = readSessionId(req);
  let session = id && sessions.get(id);
  if (!session || session.expiresAt < Date.now()) {
    if (id) sessions.delete(id);
    id = crypto.randomBytes(32).toString('hex');
    session = { csrf: crypto.randomBytes(24).toString('hex'), user: null, expiresAt: Date.now() + 43200000 };
    sessions.set(id, session);
    setSessionCookie(res, id);
  } else {
    session.expiresAt = Date.now() + 43200000;
  }
  req.sessionId = id;
  req.session = session;
  next();
});

function userRoles(user) {
  return Array.isArray(user?.roles) ? user.roles : [];
}

function adminRoleIds() {
  return [...new Set([...csvEnv('ADMIN_ROLE_IDS'), ...(store.settings.adminRoleIds || [])])];
}

function commandRoleIds() {
  return [...new Set([...csvEnv('COMMAND_ROLE_IDS'), ...(store.settings.commandRoleIds || [])])];
}

function isAdmin(user) {
  const roles = userRoles(user);
  return adminRoleIds().some((id) => roles.includes(id));
}

function isBlocked(user) {
  const blocked = [...new Set([...csvEnv('BLOCKED_ROLE_IDS'), ...(store.settings.blockedRoleIds || [])])];
  return blocked.some((id) => userRoles(user).includes(id));
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ error: 'سجّل دخولك عبر ديسكورد أولًا.' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.user || !isAdmin(req.session.user)) {
    return res.status(403).json({ error: 'هذه الصفحة للإدارة فقط.' });
  }
  next();
}

function requireCsrf(req, res, next) {
  const origin = req.get('origin');
  const expected = `${req.protocol}://${req.get('host')}`;
  if (origin && origin !== expected) return res.status(403).json({ error: 'طلب غير صالح.' });
  if (!req.session.csrf || req.get('x-csrf-token') !== req.session.csrf) {
    return res.status(403).json({ error: 'انتهت صلاحية الجلسة؛ حدّث الصفحة وحاول مجددًا.' });
  }
  next();
}

function sessionSecretReady() {
  return SESSION_SECRET.length >= 32 && !SESSION_SECRET.startsWith('replace-');
}

function safeId(value) {
  return /^\d{15,22}$/.test(String(value || ''));
}

function idList(value) {
  const list = Array.isArray(value) ? value : [];
  return [...new Set(list.map((x) => String(x).trim()).filter(safeId))].slice(0, 30);
}

function codeHash(code) {
  return crypto.createHash('sha256').update(String(code).trim().toUpperCase()).digest('hex');
}

function generateCodes(count, createdBy) {
  const issued = [];
  for (let i = 0; i < count; i += 1) {
    const code = `LL-${crypto.randomBytes(9).toString('hex').toUpperCase()}`;
    store.codes.push({
      hash: codeHash(code),
      maxListings: 1,
      usedListings: 0,
      createdBy,
      createdAt: new Date().toISOString()
    });
    issued.push(code);
  }
  saveStore();
  return issued;
}

function arabicToAsciiDigits(value) {
  return [...String(value)].map((char) => {
    const index = DIGIT_AR.indexOf(char);
    return index >= 0 ? String(index) : char;
  }).join('');
}

function getClientIp(req) {
  return req.ip || req.socket.remoteAddress || '';
}

let bot = null;
let botReady = false;

async function sendChannelLog(key, title, lines, imagePath = '') {
  const channelId = store.settings.logChannels?.[key];
  if (!botReady || !channelId) return;
  try {
    const channel = await bot.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) return;
    const embed = {
      title: String(title).slice(0, 250),
      color: 0x177a62,
      description: lines.map((line) => String(line).slice(0, 500)).join('\n').slice(0, 3800),
      timestamp: new Date().toISOString()
    };
    const base = String(process.env.APP_BASE_URL || '').replace(/\/$/, '');
    if (imagePath && base.startsWith('https://')) embed.image = { url: `${base}${imagePath}` };
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } });
  } catch {
    console.warn(`Could not post to configured Discord log channel: ${key}`);
  }
}

function privateAuditLines(req, user, extraLines = []) {
  const lines = [
    `الحساب: <@${user.id}> — ${user.username} (${user.id})`,
    ...extraLines
  ];
  if (store.settings.logClientIps && process.env.LOG_CLIENT_IPS === 'true') {
    lines.push(`IP: ${getClientIp(req)}`);
  }
  return lines;
}

function closeExpiredAuctions() {
  const now = Date.now();
  for (const auction of store.auctions) {
    if (auction.status !== 'active' || Date.parse(auction.endsAt) > now) continue;
    auction.status = 'ended';
    auction.endedAt = new Date().toISOString();
    const winner = auction.bids.at(-1) || null;
    auction.winnerId = winner?.userId || null;
    auction.winnerName = winner?.username || null;
    saveStore();
    const summary = winner
      ? `انتهى المزاد ${auction.plateText}؛ أعلى مزايدة ${winner.amount} ريال من ${winner.username}.`
      : `انتهى المزاد ${auction.plateText} دون مزايدات.`;
    void sendChannelLog('bids', 'انتهاء مزاد لوحة', [summary]);
    if (botReady && winner) {
      void bot.users.send(winner.userId, `انتهى مزاد اللوحة ${auction.plateText}، وفزت بمبلغ ${winner.amount} ريال. تواصل مع البائع عبر إدارة السيرفر لإتمام البيع.`).catch(() => {});
      void bot.users.send(auction.sellerId, `انتهى مزاد اللوحة ${auction.plateText}. أعلى مزايدة: ${winner.amount} ريال من ${winner.username}.`).catch(() => {});
    }
  }
}

function discordConfigMissing() {
  return !process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_CLIENT_SECRET || !process.env.DISCORD_GUILD_ID;
}

app.get('/', (_req, res) => res.sendFile(path.join(ROOT, 'public', 'integrated.html')));

app.get('/auth/discord', (req, res) => {
  if (!sessionSecretReady()) return res.redirect('/auctions/?setup=session');
  if (discordConfigMissing()) return res.redirect('/auctions/?setup=discord');
  const state = crypto.randomBytes(24).toString('hex');
  req.session.oauthState = state;
  const redirectUri = process.env.DISCORD_REDIRECT_URI || `http://localhost:${PORT}/auctions/auth/discord/callback`;
  const query = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: 'identify guilds.members.read',
    state
  });
  res.redirect(`https://discord.com/oauth2/authorize?${query}`);
});

app.get('/auth/discord/callback', async (req, res) => {
  try {
    if (!req.query.code || !req.query.state || req.query.state !== req.session.oauthState) {
      return res.status(400).send('تعذر التحقق من تسجيل الدخول. ارجع للصفحة وحاول مرة أخرى.');
    }
    delete req.session.oauthState;
    const redirectUri = process.env.DISCORD_REDIRECT_URI || `http://localhost:${PORT}/auctions/auth/discord/callback`;
    const tokenResponse = await fetch(`${API}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: String(req.query.code),
        redirect_uri: redirectUri
      })
    });
    if (!tokenResponse.ok) throw new Error('oauth token exchange failed');
    const tokenData = await tokenResponse.json();
    const headers = { Authorization: `Bearer ${tokenData.access_token}` };
    const [userResponse, memberResponse] = await Promise.all([
      fetch(`${API}/users/@me`, { headers }),
      fetch(`${API}/users/@me/guilds/${encodeURIComponent(process.env.DISCORD_GUILD_ID)}/member`, { headers })
    ]);
    if (!userResponse.ok) throw new Error('discord user lookup failed');
    if (memberResponse.status === 404) {
      return res.status(403).send('لازم تكون عضوًا في السيرفر قبل دخول المزادات. <a href="https://discord.gg/llstd">انضم للسيرفر</a> ثم أعد تسجيل الدخول.');
    }
    if (!memberResponse.ok) throw new Error('discord member lookup failed');
    const [profile, member] = await Promise.all([userResponse.json(), memberResponse.json()]);
    req.session.user = {
      id: profile.id,
      username: profile.global_name || profile.username,
      avatar: profile.avatar
        ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png?size=96`
        : '',
      roles: Array.isArray(member.roles) ? member.roles : []
    };
    req.session.expiresAt = Date.now() + 43200000;
    res.redirect('/auctions/');
  } catch {
    res.status(502).send('تعذر إكمال تسجيل الدخول من ديسكورد. راجع إعدادات OAuth ثم حاول مرة أخرى.');
  }
});

app.post('/auth/logout', requireCsrf, (req, res) => {
  sessions.delete(req.sessionId);
  res.setHeader('Set-Cookie', 'sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/me', (req, res) => {
  const user = req.session.user;
  res.json({
    user: user ? { id: user.id, username: user.username, avatar: user.avatar } : null,
    csrf: req.session.csrf,
    isAdmin: isAdmin(user),
    blocked: isBlocked(user),
    canListWithoutCode: Boolean(user && isAdmin(user) && store.settings.adminCanListWithoutCode),
    discordReady: !discordConfigMissing(),
    botReady,
    logClientIps: Boolean(store.settings.logClientIps && process.env.LOG_CLIENT_IPS === 'true')
  });
});

app.get('/api/auctions', requireAuth, (_req, res) => {
  closeExpiredAuctions();
  const auctions = store.auctions
    .slice()
    .sort((a, b) => Date.parse(a.endsAt) - Date.parse(b.endsAt))
    .map(({ bids, sellerId, winnerId, ...auction }) => ({
      ...auction,
      bidCount: bids.length,
      highestBid: bids.at(-1)?.amount || auction.startingPrice,
      highestBidder: bids.at(-1)?.username || null
    }));
  res.json({ auctions });
});

app.post('/api/auctions', requireAuth, requireCsrf, async (req, res) => {
  const user = req.session.user;
  if (isBlocked(user)) return res.status(403).json({ error: 'رتبتك لا تسمح بعرض أو مزايدة اللوحات.' });
  const letters = String(req.body.letters || '').trim().replaceAll(' ', '');
  const digits = arabicToAsciiDigits(String(req.body.digits || '').trim());
  const startingPrice = Number(req.body.startingPrice);
  const durationHours = Number(req.body.durationHours);
  const template = ['classic', 'sand', 'dark'].includes(req.body.template) ? req.body.template : 'classic';
  if ([...letters].length !== 3 || [...letters].some((letter) => !LETTERS_AR.includes(letter))) {
    return res.status(400).json({ error: 'اختر 3 أحرف عربية من حروف اللوحات المتاحة.' });
  }
  if (!/^\d{4}$/.test(digits)) return res.status(400).json({ error: 'أدخل 4 أرقام بالضبط.' });
  if (!Number.isInteger(startingPrice) || startingPrice < 1 || startingPrice > 100000000) {
    return res.status(400).json({ error: 'مبلغ البداية يجب أن يكون رقمًا صحيحًا موجبًا.' });
  }
  if (!Number.isInteger(durationHours) || durationHours < 1 || durationHours > 168) {
    return res.status(400).json({ error: 'مدة المزاد من ساعة إلى 168 ساعة.' });
  }

  const hasCodeBypass = isAdmin(user) && store.settings.adminCanListWithoutCode;
  let accessCode = null;
  let accessCodeIndex = -1;
  if (!hasCodeBypass) {
    const hash = codeHash(req.body.accessCode || '');
    accessCodeIndex = store.codes.findIndex((entry) => entry.hash === hash);
    if (accessCodeIndex < 0) {
      return res.status(403).json({ error: 'الكود غير صحيح أو سبق استخدامه.' });
    }
    accessCode = store.codes[accessCodeIndex];
    if (Number(accessCode.usedListings || 0) > 0) {
      return res.status(403).json({ error: 'هذا الكود مستخدم بالفعل.' });
    }
    if (accessCode.boundUserId && accessCode.boundUserId !== user.id) {
      return res.status(403).json({ error: 'هذا الكود مرتبط بحساب آخر.' });
    }
  }

  let imagePath = '';
  const imageData = String(req.body.image || '');
  const match = imageData.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
  if (!match || match[1].length > 1400000) {
    return res.status(400).json({ error: 'تعذر اعتماد صورة اللوحة؛ أعد إنشاء المعاينة.' });
  }
  const imageBuffer = Buffer.from(match[1], 'base64');
  if (!imageBuffer.length || imageBuffer.length > 1024 * 1024) {
    return res.status(400).json({ error: 'حجم صورة اللوحة أكبر من الحد المسموح.' });
  }
  const imageName = `${crypto.randomUUID()}.png`;
  imagePath = `/auctions/plate-uploads/${imageName}`;
  try {
    fs.writeFileSync(path.join(UPLOAD_DIR, imageName), imageBuffer, { flag: 'wx' });
  } catch {
    return res.status(500).json({ error: 'تعذر حفظ صورة اللوحة. حاول مرة أخرى.' });
  }

  const plateText = `${letters} ${digits}`;
  const auction = {
    id: crypto.randomUUID(),
    plateText,
    letters,
    digits,
    template,
    imagePath,
    sellerId: user.id,
    sellerName: user.username,
    startingPrice,
    bids: [],
    status: 'active',
    createdAt: new Date().toISOString(),
    endsAt: new Date(Date.now() + durationHours * 3600000).toISOString()
  };
  const consumedCode = accessCode ? store.codes.splice(accessCodeIndex, 1)[0] : null;
  store.auctions.push(auction);
  try {
    saveStore();
  } catch {
    store.auctions.splice(store.auctions.indexOf(auction), 1);
    if (consumedCode) store.codes.splice(accessCodeIndex, 0, consumedCode);
    try {
      fs.unlinkSync(path.join(UPLOAD_DIR, imageName));
    } catch {}
    return res.status(500).json({ error: 'تعذر حفظ المزاد. الكود لم يُستهلك؛ حاول مرة أخرى.' });
  }
  void sendChannelLog('plates', 'عرض لوحة جديدة', privateAuditLines(req, user, [
    `اللوحة: ${plateText}`,
    `سعر البداية: ${startingPrice} ريال`,
    `تنتهي: ${new Date(auction.endsAt).toLocaleString('ar-SA')}`
  ]), imagePath);
  res.status(201).json({ auction: { ...auction, bids: undefined } });
});

app.post('/api/auctions/:id/bids', requireAuth, requireCsrf, async (req, res) => {
  const user = req.session.user;
  if (isBlocked(user)) return res.status(403).json({ error: 'رتبتك لا تسمح بالمزايدة.' });
  const auction = store.auctions.find((entry) => entry.id === req.params.id);
  if (!auction) return res.status(404).json({ error: 'المزاد غير موجود.' });
  closeExpiredAuctions();
  if (auction.status !== 'active') return res.status(409).json({ error: 'انتهى هذا المزاد.' });
  if (auction.sellerId === user.id) return res.status(403).json({ error: 'لا يمكنك المزايدة على لوحتك.' });
  if (req.body.acceptTerms !== true) return res.status(400).json({ error: 'يجب الموافقة على التعهد قبل المزايدة.' });
  const amount = Number(req.body.amount);
  const current = auction.bids.at(-1)?.amount || auction.startingPrice;
  if (!Number.isInteger(amount) || amount <= current || amount > 100000000) {
    return res.status(400).json({ error: `المزايدة يجب أن تتجاوز ${current} ريال.` });
  }
  const bid = {
    userId: user.id,
    username: user.username,
    amount,
    createdAt: new Date().toISOString(),
    termsVersion: TERMS_VERSION
  };
  auction.bids.push(bid);
  saveStore();
  void sendChannelLog('bids', 'مزايدة جديدة', privateAuditLines(req, user, [
    `اللوحة: ${auction.plateText}`,
    `المبلغ: ${amount} ريال`,
    `البائع: ${auction.sellerName}`,
    `وافق على التعهد: نعم (${TERMS_VERSION})`
  ]));
  res.status(201).json({ ok: true, highestBid: amount });
});

app.get('/api/admin/config', requireAuth, requireAdmin, (_req, res) => {
  res.json({
    adminRoleIds: adminRoleIds(),
    commandRoleIds: commandRoleIds(),
    blockedRoleIds: [...new Set([...csvEnv('BLOCKED_ROLE_IDS'), ...(store.settings.blockedRoleIds || [])])],
    adminCanListWithoutCode: store.settings.adminCanListWithoutCode,
    logClientIps: Boolean(store.settings.logClientIps && process.env.LOG_CLIENT_IPS === 'true'),
    logChannels: store.settings.logChannels
  });
});

app.post('/api/admin/config', requireAuth, requireAdmin, requireCsrf, (req, res) => {
  const body = req.body || {};
  for (const key of ['adminRoleIds', 'commandRoleIds', 'blockedRoleIds']) {
    if (key in body && (!Array.isArray(body[key]) || body[key].some((id) => !safeId(String(id).trim())))) {
      return res.status(400).json({ error: 'استخدم معرّفات Discord الرقمية للرتب، وافصل بينها بفواصل.' });
    }
  }
  if ('adminRoleIds' in body) store.settings.adminRoleIds = idList(body.adminRoleIds);
  if ('commandRoleIds' in body) store.settings.commandRoleIds = idList(body.commandRoleIds);
  if ('blockedRoleIds' in body) store.settings.blockedRoleIds = idList(body.blockedRoleIds);
  if ('adminCanListWithoutCode' in body) store.settings.adminCanListWithoutCode = body.adminCanListWithoutCode === true;
  if ('logClientIps' in body) {
    store.settings.logClientIps = body.logClientIps === true;
  }
  if ('logChannels' in body && body.logChannels && typeof body.logChannels === 'object') {
    for (const key of ['control', 'plates', 'bids', 'moderation']) {
      const value = String(body.logChannels[key] || '').trim();
      store.settings.logChannels[key] = value === '' || safeId(value) ? value : store.settings.logChannels[key];
    }
  }
  saveStore();
  res.json({ ok: true });
});

app.post('/api/admin/codes', requireAuth, requireAdmin, requireCsrf, (req, res) => {
  const count = Number(req.body.count);
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    return res.status(400).json({ error: 'عدد الأكواد من 1 إلى 50.' });
  }
  const codes = generateCodes(count, req.session.user.id);
  void sendChannelLog('moderation', 'إنشاء أكواد دخول', [
    `أنشأ ${req.session.user.username} عدد ${count} كودًا.`,
    'كل كود يسمح بعرض لوحة واحدة، ثم يُحذف.'
  ]);
  res.status(201).json({ codes, warning: 'تظهر الأكواد مرة واحدة فقط؛ احفظها في مكان آمن.' });
});

app.post('/api/admin/register-commands', requireAuth, requireAdmin, requireCsrf, async (_req, res) => {
  if (!botReady || !process.env.DISCORD_GUILD_ID) {
    return res.status(503).json({ error: 'شغّل البوت وأكمل DISCORD_GUILD_ID في ملف .env أولًا.' });
  }
  try {
    await registerBotCommands();
    res.json({ ok: true });
  } catch {
    res.status(502).json({ error: 'تعذر تسجيل أوامر البوت. تأكد من صلاحية التطبيقات والبوت.' });
  }
});

app.get(/.*/, (_req, res) => res.sendFile(path.join(ROOT, 'public', 'integrated.html')));

function roleIdsFromInteraction(interaction) {
  const roles = interaction.member?.roles;
  if (Array.isArray(roles)) return roles;
  if (roles?.cache) return [...roles.cache.keys()];
  return [];
}

function commandAllowed(interaction) {
  const configured = commandRoleIds();
  if (!configured.length) return false;
  const roles = roleIdsFromInteraction(interaction);
  return configured.some((id) => roles.includes(id));
}

const commands = [
  new SlashCommandBuilder().setName('auction-setup').setDescription('إنشاء قنوات إدارة ومزادات اللوحات'),
  new SlashCommandBuilder().setName('auction-config').setDescription('فتح إعدادات مزادات اللوحات'),
  new SlashCommandBuilder()
    .setName('auction-code')
    .setDescription('إنشاء أكواد وصول أحادية الاستخدام وإرسالها للخاص')
    .addIntegerOption((option) => option.setName('count').setDescription('عدد الأكواد (1 إلى 50)').setMinValue(1).setMaxValue(50).setRequired(true))
].map((command) => command.toJSON());

async function registerBotCommands() {
  await bot.application.commands.set(commands, process.env.DISCORD_GUILD_ID);
}

async function handleBotCommand(interaction) {
  if (!interaction.isChatInputCommand()) return;
  if (!commandAllowed(interaction)) {
    return interaction.reply({ content: 'ما عندك الرتبة المسموح لها بهذا الأمر.', flags: MessageFlags.Ephemeral });
  }
  if (interaction.commandName === 'auction-config') {
    const base = String(process.env.APP_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
    return interaction.reply({ content: `إعدادات المزادات: ${base}/auctions/#admin`, flags: MessageFlags.Ephemeral });
  }
  if (interaction.commandName === 'auction-setup') {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const guild = interaction.guild;
    if (!guild) return interaction.editReply('استخدم الأمر داخل سيرفر ديسكورد.');
    const visibleRoles = [...new Set([...adminRoleIds(), ...commandRoleIds()])];
    const category = await guild.channels.create({
      name: 'مزادات اللوحات',
      type: ChannelType.GuildCategory,
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        {
          id: bot.user.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
        },
        ...visibleRoles.map((id) => ({
          id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
        }))
      ]
    });
    const definitions = [
      ['control', 'تحكم-المزادات'],
      ['plates', 'لوق-اللوحات'],
      ['bids', 'لوق-المزايدات'],
      ['moderation', 'لوق-الإدارة']
    ];
    const created = {};
    for (const [key, name] of definitions) {
      const channel = await guild.channels.create({
        name,
        type: ChannelType.GuildText,
        parent: category.id,
        permissionOverwrites: [
          { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          {
            id: bot.user.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
          },
          ...visibleRoles.map((id) => ({
            id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
          }))
        ]
      });
      created[key] = channel.id;
    }
    store.settings.logChannels = created;
    saveStore();
    const base = String(process.env.APP_BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
    const dashboardUrl = `${base}/auctions/#admin`;
    try {
      const controlChannel = await guild.channels.fetch(created.control);
      if (!controlChannel?.isTextBased()) throw new Error('control channel unavailable');
      await controlChannel.send({
        content: [
          '## لوحة التحكم في مزادات اللوحات',
          'من هنا تفتح إعدادات المزاد، وتُنشئ أكواد الدخول وتدير صلاحيات العرض واللوقات.',
          `[فتح لوحة التحكم](${dashboardUrl})`,
          'سجّل الدخول بحساب Discord يحمل رتبة الإدارة المسجلة في إعدادات الموقع.',
          'هذه القناة خاصة بالإدارة؛ لا تشارك رابط الدخول أو أكواد الاستخدام مع غير المخولين.'
        ].join('\n'),
        allowedMentions: { parse: [] }
      });
    } catch {
      await interaction.editReply('أُنشئت القنوات ورُبطت بالموقع، لكن تعذّر إرسال لوحة التحكم. تأكد أن للبوت صلاحية عرض القناة وإرسال الرسائل ثم أعد المحاولة.');
      return;
    }
    await interaction.editReply('تم إنشاء قنوات التحكم واللوقات، وربطها بالموقع وإرسال لوحة التحكم في قناة تحكم المزادات.');
    return;
  }
  if (interaction.commandName === 'auction-code') {
    const count = interaction.options.getInteger('count', true);
    const codes = generateCodes(count, interaction.user.id);
    try {
      await interaction.user.send(`أكواد مزادات اللوحات (كل كود يسمح بعرض لوحة واحدة):\n\n${codes.join('\n')}\n\nاحفظها الآن؛ لن تظهر مرة أخرى.`);
      return interaction.reply({ content: 'أرسلت الأكواد في الخاص. ما بتظهر مرة ثانية.', flags: MessageFlags.Ephemeral });
    } catch {
      return interaction.reply({ content: `تعذر إرسال الخاص. هذه الأكواد تظهر لك أنت فقط الآن:\n\n${codes.join('\n')}`, flags: MessageFlags.Ephemeral });
    }
  }
}

if (process.env.DISCORD_BOT_TOKEN) {
  bot = new Client({ intents: [GatewayIntentBits.Guilds] });
  bot.once(Events.ClientReady, async () => {
    botReady = true;
    console.log(`Discord bot connected as ${bot.user.username}`);
    if (process.env.DISCORD_GUILD_ID) {
      try {
        await registerBotCommands();
        console.log('Guild slash commands registered.');
      } catch {
        console.warn('Could not register slash commands; check bot OAuth scopes and server permissions.');
      }
    }
  });
  bot.on(Events.InteractionCreate, (interaction) => {
    void handleBotCommand(interaction).catch(async () => {
      const response = { content: 'تعذر تنفيذ الأمر. راجع إعدادات البوت والقنوات.', flags: MessageFlags.Ephemeral };
      if (interaction.deferred || interaction.replied) await interaction.followUp(response).catch(() => {});
      else await interaction.reply(response).catch(() => {});
    });
  });
  bot.login(process.env.DISCORD_BOT_TOKEN).catch(() => {
    console.warn('Discord bot login failed. Check DISCORD_BOT_TOKEN in .env.');
  });
}

setInterval(closeExpiredAuctions, 30000).unref();

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`LLSTD Auctions listening at http://localhost:${PORT}/auctions/`);
    if (!sessionSecretReady()) {
      console.warn('Set a unique SESSION_SECRET in .env before using accounts.');
    }
  });
}

module.exports = app;
