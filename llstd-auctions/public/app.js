'use strict';

const ARABIC_DIGITS = [...'٠١٢٣٤٥٦٧٨٩'];
const ARABIC_LETTERS = [...'ابحدرسصطعقكلمنهوي'];
const ENGLISH_LETTERS = [...'ABJDRSXTEGKLZNHUV'];
const ROOT_PATH = '/auctions';
const state = {
  user: null,
  csrf: '',
  admin: false,
  blocked: false,
  canListWithoutCode: false,
  currentAuction: null,
  digits: [0, 0, 0, 0],
  letters: [0, 0, 0]
};

const $ = (selector) => document.querySelector(selector);
const notice = $('#notice');
const canvas = $('#plate-canvas');
const ctx = canvas.getContext('2d');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function showNotice(message, type = '') {
  notice.textContent = message;
  notice.className = `notice ${type}`.trim();
  notice.classList.remove('hidden');
  notice.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function clearNotice() {
  notice.textContent = '';
  notice.className = 'notice hidden';
}

async function api(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  if (options.method && options.method !== 'GET' && state.csrf) headers['X-CSRF-Token'] = state.csrf;
  const response = await fetch(`${ROOT_PATH}${url}`, { ...options, headers, credentials: 'same-origin' });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'تعذر تنفيذ الطلب.');
  return payload;
}

function setAccount() {
  const label = $('#user-label');
  const login = $('#login-button');
  const heroLogin = $('#hero-login');
  const logout = $('#logout-button');
  if (state.user) {
    label.textContent = state.user.username;
    login.classList.add('hidden');
    heroLogin.classList.add('hidden');
    logout.classList.remove('hidden');
    $('#create-section').classList.toggle('hidden', state.blocked);
    $('#admin-section').classList.toggle('hidden', !state.admin);
    if (state.admin && location.hash === '#admin') {
      requestAnimationFrame(() => $('#admin-section').scrollIntoView({ behavior: 'smooth', block: 'start' }));
    }
  } else {
    label.textContent = 'زائر';
    login.classList.remove('hidden');
    heroLogin.classList.remove('hidden');
    logout.classList.add('hidden');
    $('#create-section').classList.add('hidden');
    $('#admin-section').classList.add('hidden');
  }
  if (state.blocked && state.user) {
    showNotice('رتبتك تمنع عرض اللوحات والمزايدة. تقدر تتصفح المزادات المتاحة.', 'error');
  }
}

function makeSlots(container, values, alphabet, label) {
  container.innerHTML = '';
  values.forEach((value, index) => {
    const slot = document.createElement('div');
    slot.className = 'slot';
    slot.innerHTML = `
      <button type="button" aria-label="زيادة ${label} ${index + 1}" data-index="${index}" data-step="1">▲</button>
      <b>${escapeHtml(alphabet[value])}</b>
      <button type="button" aria-label="إنقاص ${label} ${index + 1}" data-index="${index}" data-step="-1">▼</button>`;
    slot.addEventListener('click', (event) => {
      const button = event.target.closest('button[data-step]');
      if (!button) return;
      const slotIndex = Number(button.dataset.index);
      const step = Number(button.dataset.step);
      values[slotIndex] = (values[slotIndex] + step + alphabet.length) % alphabet.length;
      makeSlots(container, values, alphabet, label);
      drawPlate();
    });
    container.appendChild(slot);
  });
}

function activeTemplate() {
  return document.querySelector('input[name="template"]:checked')?.value || 'classic';
}

function drawPalm(centerX, centerY, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(centerX, centerY + 21);
  ctx.lineTo(centerX, centerY - 11);
  ctx.stroke();
  for (let i = 0; i < 7; i += 1) {
    const angle = Math.PI + (Math.PI * i / 6);
    ctx.beginPath();
    ctx.moveTo(centerX, centerY - 11);
    ctx.quadraticCurveTo(
      centerX + Math.cos(angle) * 15,
      centerY - 24,
      centerX + Math.cos(angle) * 24,
      centerY - 10 + Math.sin(angle) * 13
    );
    ctx.stroke();
  }
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(centerX - 17, centerY + 19);
  ctx.lineTo(centerX + 17, centerY + 19);
  ctx.stroke();
  ctx.restore();
}

function drawPlate() {
  if (!ctx) return;
  const theme = activeTemplate();
  const palette = theme === 'sand'
    ? { fill: '#e9d6b0', ink: '#211c16', frame: '#1a1712', accent: '#5b4a32' }
    : theme === 'dark'
      ? { fill: '#26332e', ink: '#f1f3eb', frame: '#101613', accent: '#a6d4a5' }
      : { fill: '#f4f4ed', ink: '#151917', frame: '#131715', accent: '#1c6952' };
  const width = canvas.width;
  const height = canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = palette.frame;
  ctx.beginPath();
  ctx.roundRect(5, 5, width - 10, height - 10, 22);
  ctx.fill();
  ctx.fillStyle = palette.fill;
  ctx.beginPath();
  ctx.roundRect(14, 14, width - 28, height - 28, 14);
  ctx.fill();

  const mainRight = 846;
  const numberRight = 500;
  const middle = height / 2;
  ctx.strokeStyle = palette.frame;
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(numberRight, 16);
  ctx.lineTo(numberRight, height - 16);
  ctx.moveTo(mainRight, 16);
  ctx.lineTo(mainRight, height - 16);
  ctx.moveTo(16, middle);
  ctx.lineTo(mainRight, middle);
  ctx.stroke();

  const numberArabic = state.digits.map((digit) => ARABIC_DIGITS[digit]).join(' ');
  const numberEnglish = state.digits.join(' ');
  const lettersArabic = state.letters.map((index) => ARABIC_LETTERS[index]).join(' ');
  const lettersEnglish = state.letters.map((index) => ENGLISH_LETTERS[index]).join(' ');
  ctx.fillStyle = palette.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.direction = 'rtl';
  ctx.font = '700 82px Arial, sans-serif';
  ctx.fillText(numberArabic, numberRight / 2, 90);
  ctx.font = '700 80px Arial, sans-serif';
  ctx.fillText(lettersArabic, (numberRight + mainRight) / 2, 90);
  ctx.direction = 'ltr';
  ctx.font = '700 72px Arial, sans-serif';
  ctx.fillText(numberEnglish, numberRight / 2, 230);
  ctx.font = '700 70px Arial, sans-serif';
  ctx.fillText(lettersEnglish, (numberRight + mainRight) / 2, 230);

  const stripeCenter = (mainRight + width) / 2;
  drawPalm(stripeCenter, 66, palette.accent);
  ctx.fillStyle = palette.accent;
  ctx.font = '700 21px Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.direction = 'ltr';
  ctx.fillText('KSA', stripeCenter, 128);
  ctx.save();
  ctx.translate(stripeCenter, 264);
  ctx.rotate(-Math.PI / 2);
  ctx.direction = 'rtl';
  ctx.font = '600 20px Arial, sans-serif';
  ctx.fillText('السعودية', 0, 0);
  ctx.restore();
}

function remainingTime(endsAt) {
  const milliseconds = Date.parse(endsAt) - Date.now();
  if (milliseconds <= 0) return 'انتهى';
  const hours = Math.floor(milliseconds / 3600000);
  const minutes = Math.floor((milliseconds % 3600000) / 60000);
  if (hours >= 24) return `${Math.floor(hours / 24)} يوم ${hours % 24} س`;
  return `${hours} س ${minutes} د`;
}

function renderAuctions(auctions) {
  const grid = $('#auction-grid');
  $('#open-count').textContent = String(auctions.filter((auction) => auction.status === 'active').length).padStart(2, '0');
  $('#auction-count').textContent = String(auctions.length).padStart(2, '0');
  if (!auctions.length) {
    grid.innerHTML = '<div class="empty-state">ما فيه مزادات مفتوحة حاليًا. ارجع لنا بعدين.</div>';
    return;
  }
  grid.innerHTML = auctions.map((auction) => {
    const current = auction.highestBid || auction.startingPrice;
    const isActive = auction.status === 'active' && Date.parse(auction.endsAt) > Date.now();
    return `
      <article class="auction-card">
        <img src="${escapeHtml(auction.imagePath)}" alt="لوحة ${escapeHtml(auction.plateText)}" loading="lazy">
        <div class="auction-info">
          <div class="auction-topline"><span>${isActive ? 'مزاد مفتوح' : 'انتهى المزاد'}</span><span class="auction-number">${escapeHtml(remainingTime(auction.endsAt))}</span></div>
          <h3>${escapeHtml(auction.plateText)}</h3>
          <div class="auction-meta">
            <div><span class="meta-label">أعلى سومة</span><b class="meta-value">${Number(current).toLocaleString('ar-SA')} ريال</b></div>
            <div><span class="meta-label">عدد المزايدات</span><b class="meta-value">${Number(auction.bidCount || 0).toLocaleString('ar-SA')}</b></div>
          </div>
          <div class="auction-footer">
            <span class="seller-label">البائع: ${escapeHtml(auction.sellerName)}</span>
            ${isActive && !state.blocked ? `<button class="button button-primary bid-button" data-id="${escapeHtml(auction.id)}" data-plate="${escapeHtml(auction.plateText)}" data-current="${Number(current)}">زايد الآن</button>` : ''}
          </div>
        </div>
      </article>`;
  }).join('');
  grid.querySelectorAll('.bid-button').forEach((button) => {
    button.addEventListener('click', () => openBidDialog(button.dataset.id, button.dataset.plate, Number(button.dataset.current)));
  });
}

async function loadAuctions() {
  if (!state.user) {
    renderAuctions([]);
    $('#auction-grid').innerHTML = '<div class="empty-state">سجّل دخولك عشان تظهر لك المزادات.</div>';
    $('#open-count').textContent = '—';
    $('#auction-count').textContent = '—';
    return;
  }
  try {
    const data = await api('/api/auctions');
    renderAuctions(data.auctions);
  } catch (error) {
    showNotice(error.message, 'error');
  }
}

function openBidDialog(id, plate, current) {
  state.currentAuction = id;
  $('#bid-plate-title').textContent = plate;
  const amount = $('#bid-form [name="amount"]');
  amount.min = String(current + 1);
  amount.placeholder = `أكثر من ${current.toLocaleString('ar-SA')}`;
  amount.value = '';
  $('#bid-form [name="acceptTerms"]').checked = false;
  $('#bid-dialog').showModal();
}

function parseIds(value) {
  return value.split(',').map((part) => part.trim()).filter(Boolean);
}

async function loadAdminConfig() {
  if (!state.admin) return;
  try {
    const config = await api('/api/admin/config');
    const form = $('#settings-form');
    form.elements.adminRoleIds.value = config.adminRoleIds.join(', ');
    form.elements.commandRoleIds.value = config.commandRoleIds.join(', ');
    form.elements.blockedRoleIds.value = config.blockedRoleIds.join(', ');
    form.elements.platesChannel.value = config.logChannels.plates || '';
    form.elements.bidsChannel.value = config.logChannels.bids || '';
    form.elements.controlChannel.value = config.logChannels.control || '';
    form.elements.moderationChannel.value = config.logChannels.moderation || '';
    form.elements.adminCanListWithoutCode.checked = config.adminCanListWithoutCode;
    form.elements.logClientIps.checked = config.logClientIps;
  } catch (error) {
    showNotice(error.message, 'error');
  }
}

async function initialize() {
  const savedTheme = localStorage.getItem('th');
  if (['light', 'sunset'].includes(savedTheme)) document.documentElement.dataset.theme = savedTheme;
  document.querySelectorAll('[data-theme-choice]').forEach((button) => {
    const theme = button.dataset.themeChoice;
    button.setAttribute('aria-pressed', String((document.documentElement.dataset.theme || 'night') === theme));
    button.addEventListener('click', () => {
      if (theme === 'night') delete document.documentElement.dataset.theme;
      else document.documentElement.dataset.theme = theme;
      localStorage.setItem('th', theme === 'night' ? '' : theme);
      document.querySelectorAll('[data-theme-choice]').forEach((item) => {
        item.setAttribute('aria-pressed', String(item.dataset.themeChoice === theme));
      });
    });
  });
  const menuButton = $('#menu-toggle');
  const navList = $('#auction-nav-list');
  menuButton?.addEventListener('click', () => {
    const open = navList.classList.toggle('open');
    menuButton.setAttribute('aria-expanded', String(open));
  });
  navList?.querySelectorAll('a').forEach((link) => link.addEventListener('click', () => {
    navList.classList.remove('open');
    menuButton?.setAttribute('aria-expanded', 'false');
  }));
  makeSlots($('#digit-slots'), state.digits, ARABIC_DIGITS, 'رقم');
  makeSlots($('#letter-slots'), state.letters, ARABIC_LETTERS, 'حرف');
  drawPlate();
  document.querySelectorAll('input[name="template"]').forEach((input) => input.addEventListener('change', drawPlate));

  const query = new URLSearchParams(location.search);
  if (query.get('setup') === 'discord') {
    showNotice('قبل تسجيل الدخول، أكمل DISCORD_CLIENT_ID وDISCORD_CLIENT_SECRET وDISCORD_GUILD_ID في ملف .env.', 'error');
    history.replaceState({}, '', '/');
  } else if (query.get('setup') === 'session') {
    showNotice('غيّر SESSION_SECRET في ملف .env إلى قيمة عشوائية طويلة قبل تسجيل الدخول.', 'error');
    history.replaceState({}, '', '/');
  }

  try {
    const data = await api('/api/me');
    state.user = data.user;
    state.csrf = data.csrf;
    state.admin = data.isAdmin;
    state.blocked = data.blocked;
    state.canListWithoutCode = data.canListWithoutCode === true;
    setAccount();
    if (data.logClientIps) {
      $('#privacy-notice').textContent = 'تنبيه خصوصية: عنوان IP ونشاط المزايدة يُسجّلان في قناة لوق خاصة بالإدارة.';
      $('#privacy-notice').classList.remove('hidden');
    }
    await loadAuctions();
    await loadAdminConfig();
  } catch (error) {
    showNotice(error.message, 'error');
  }
}

$('#login-button').addEventListener('click', () => { location.href = `${ROOT_PATH}/auth/discord`; });
$('#hero-login').addEventListener('click', () => { location.href = `${ROOT_PATH}/auth/discord`; });

$('#logout-button').addEventListener('click', async () => {
  try {
    await api('/auth/logout', { method: 'POST', body: '{}' });
    location.reload();
  } catch (error) {
    showNotice(error.message, 'error');
  }
});

$('#create-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const accessCodeInput = form.elements.accessCode;
  if (!state.canListWithoutCode && !String(accessCodeInput.value || '').trim()) {
    $('#access-code-dialog').showModal();
    $('#access-code-form [name="accessCode"]').focus();
    return;
  }
  clearNotice();
  drawPlate();
  const formData = new FormData(form);
  const payload = {
    letters: state.letters.map((index) => ARABIC_LETTERS[index]).join(''),
    digits: state.digits.join(''),
    startingPrice: Number(formData.get('startingPrice')),
    durationHours: Number(formData.get('durationHours')),
    accessCode: String(formData.get('accessCode') || ''),
    template: String(formData.get('template') || 'classic'),
    image: canvas.toDataURL('image/png')
  };
  try {
    await api('/api/auctions', { method: 'POST', body: JSON.stringify(payload) });
    form.reset();
    state.digits = [0, 0, 0, 0];
    state.letters = [0, 0, 0];
    makeSlots($('#digit-slots'), state.digits, ARABIC_DIGITS, 'رقم');
    makeSlots($('#letter-slots'), state.letters, ARABIC_LETTERS, 'حرف');
    drawPlate();
    showNotice('تم نشر اللوحة وفتح المزاد.', 'success');
    await loadAuctions();
    $('#auctions').scrollIntoView({ behavior: 'smooth' });
  } catch (error) {
    accessCodeInput.value = '';
    showNotice(error.message, 'error');
  }
});

$('#access-code-cancel').addEventListener('click', () => {
  $('#access-code-dialog').close();
});

$('#access-code-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const dialogForm = event.currentTarget;
  const code = String(dialogForm.elements.accessCode.value || '').trim();
  if (!code) {
    dialogForm.elements.accessCode.focus();
    return;
  }
  $('#create-form').elements.accessCode.value = code;
  dialogForm.reset();
  $('#access-code-dialog').close();
  $('#create-form').requestSubmit();
});

$('#bid-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = {
    amount: Number(form.elements.amount.value),
    acceptTerms: form.elements.acceptTerms.checked
  };
  try {
    await api(`/api/auctions/${encodeURIComponent(state.currentAuction)}/bids`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    $('#bid-dialog').close();
    showNotice('تم تسجيل مزايدتك. تذكّر أن المزايدة ملزمة حسب التعهد.', 'success');
    await loadAuctions();
  } catch (error) {
    showNotice(error.message, 'error');
  }
});

$('#close-dialog').addEventListener('click', () => $('#bid-dialog').close());

$('#codes-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const output = $('#codes-output');
  try {
    const result = await api('/api/admin/codes', {
      method: 'POST',
      body: JSON.stringify({
        count: Number(form.elements.count.value)
      })
    });
    output.textContent = `${result.warning}\n\n${result.codes.join('\n')}`;
    output.classList.remove('hidden');
    showNotice('تم إنشاء الأكواد. انسخها واحفظها الآن؛ لا يمكن استرجاعها من التطبيق.', 'success');
  } catch (error) {
    showNotice(error.message, 'error');
  }
});

$('#settings-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const logClientIps = form.elements.logClientIps.checked;
  try {
    await api('/api/admin/config', {
      method: 'POST',
      body: JSON.stringify({
        adminRoleIds: parseIds(form.elements.adminRoleIds.value),
        commandRoleIds: parseIds(form.elements.commandRoleIds.value),
        blockedRoleIds: parseIds(form.elements.blockedRoleIds.value),
        adminCanListWithoutCode: form.elements.adminCanListWithoutCode.checked,
        logClientIps,
        logChannels: {
          control: form.elements.controlChannel.value.trim(),
          plates: form.elements.platesChannel.value.trim(),
          bids: form.elements.bidsChannel.value.trim(),
          moderation: form.elements.moderationChannel.value.trim()
        }
      })
    });
    showNotice(
      logClientIps
        ? 'تم حفظ الإعدادات. لتفعيل تسجيل IP فعليًا، اضبط LOG_CLIENT_IPS=true في .env وأظهر إشعار الخصوصية.'
        : 'تم حفظ الإعدادات.',
      'success'
    );
  } catch (error) {
    showNotice(error.message, 'error');
  }
});

$('#register-commands').addEventListener('click', async () => {
  try {
    await api('/api/admin/register-commands', { method: 'POST', body: '{}' });
    showNotice('تم تحديث أوامر البوت في السيرفر.', 'success');
  } catch (error) {
    showNotice(error.message, 'error');
  }
});

initialize();
setInterval(() => { if (state.user) void loadAuctions(); }, 60000);
