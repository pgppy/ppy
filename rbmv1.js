// ============================================================================
// RajaBM / 3mplay QRIS POPPAY inject — rbmv1.js
// Laravel 3mplay deposit UI — any domain, path /account/deposit only
// SDK: https://unpkg.com/@poppackage/pg-ppy-sdk@1.0.0/dist/qris-sdk.umd.js
// Health: GET https://payment.pg-poppay.com/api/payment-health-v2 (+ X-Store-Key)
// Embed:
// <script src=".../rbmv1.js?store_key=sk_xxx&min_depo=10000&max_depo=10000000&buttons=10000,50000,100000,500000"></script>
// Username: .account-username a → .account-username → /profile
// Inject: hanya /account/deposit di dalam .deposit .methods_form (QRIS Otomatis)
// ============================================================================

(function () {
    'use strict';

    const LOG = '[RBM-QRIS]';
    const VERSION = '1.0.8';

    if (window.__RBM_QRIS_BOOTED__ === VERSION) {
        console.log(LOG, 'already booted', VERSION);
        return;
    }
    window.__RBM_QRIS_BOOTED__ = VERSION;

    console.log('🚀', LOG, 'Starting rbmv1', VERSION);

    window.rbmSetAmount = function (amount, button) {
        const amountShow = document.getElementById('depositShowAmountAutoQris');
        const amountHidden = document.getElementById('depositAmountAutoQris');
        if (!amountShow || !amountHidden) return false;
        document.querySelectorAll('.qris-amount-btn').forEach((btn) => btn.classList.remove('active'));
        if (button) button.classList.add('active');
        amountShow.value = parseInt(amount, 10).toLocaleString('id-ID');
        amountHidden.value = amount;
        return false;
    };

    const CONFIG = {
        MIN_AMOUNT: 10000,
        MAX_AMOUNT: 10000000,
        AMOUNT_BUTTONS: [10000, 50000, 100000, 200000, 500000],
        MAX_RETRIES: 24,
        RETRY_DELAY: 400,
        IS_MOBILE: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent),
    };

    let _lockedUsername = (window.__RBM_LOCKED_USERNAME__ || '').toString().trim() || null;
    let paymentHealthCache = null;
    let paymentHealthCacheKey = '';
    let paymentHealthCacheAt = 0;
    const PAYMENT_HEALTH_CACHE_TTL_MS = 30000;
    let handlersAttached = false;
    let isInjected = false;
    let reinjectionInProgress = false;
    let depositEnabled = false;

    function getParamFromCurrentScript(name) {
        try {
            const current = document.currentScript;
            const scripts = Array.from(document.querySelectorAll('script[src]')).map((s) => s.src).reverse();
            const named = current?.src || scripts.find((url) =>
                /rbmv[0-9]+\.js(\?|$)|rajabm(?:_qris)?\.js(\?|$)|rbm[_-]?qris[_-]?inject\.js(\?|$)/i.test(url)
            );
            const src = named || scripts.find((url) => {
                try {
                    return !!new URL(url, window.location.href).searchParams.get('store_key');
                } catch (e) {
                    return false;
                }
            });
            if (!src) return null;
            return new URL(src, window.location.href).searchParams.get(name);
        } catch (e) {
            return null;
        }
    }

    const SKIP_STORE_KEY = false;
    const STORE_KEY = (
        getParamFromCurrentScript('store_key') ||
        window.PGSCRIPT_STORE_KEY ||
        ''
    ).trim();

    function parseAmountParam(v, fallback) {
        const n = parseInt(String(v == null ? '' : v).replace(/\D/g, ''), 10);
        return Number.isFinite(n) && n > 0 ? n : fallback;
    }

    function parseButtonList(raw) {
        const src = raw || window.RBM_AMOUNT_BUTTONS || '';
        let nums = [];
        if (Array.isArray(src)) nums = src.map((x) => parseInt(x, 10));
        else if (typeof src === 'string' && src.trim()) {
            nums = src.split(/[,|;\s]+/).map((x) => parseInt(String(x).replace(/\D/g, ''), 10));
        }
        nums = nums.filter((n) => Number.isFinite(n) && n > 0);
        if (!nums.length) nums = CONFIG.AMOUNT_BUTTONS.slice();
        return nums;
    }

    CONFIG.MIN_AMOUNT = parseAmountParam(
        getParamFromCurrentScript('min_depo') || window.RBM_MIN_DEPO,
        CONFIG.MIN_AMOUNT
    );
    CONFIG.MAX_AMOUNT = parseAmountParam(
        getParamFromCurrentScript('max_depo') || window.RBM_MAX_DEPO,
        10000000
    );
    if (CONFIG.MAX_AMOUNT < CONFIG.MIN_AMOUNT) CONFIG.MAX_AMOUNT = CONFIG.MIN_AMOUNT;
    CONFIG.AMOUNT_BUTTONS = parseButtonList(
        getParamFromCurrentScript('buttons') || getParamFromCurrentScript('amounts')
    ).filter((n) => n >= CONFIG.MIN_AMOUNT && n <= CONFIG.MAX_AMOUNT);
    if (!CONFIG.AMOUNT_BUTTONS.length) CONFIG.AMOUNT_BUTTONS = [CONFIG.MIN_AMOUNT];

    function formatRpLabel(n) {
        return 'Rp ' + Number(n).toLocaleString('id-ID');
    }

    function amountButtonsHtml() {
        return CONFIG.AMOUNT_BUTTONS.map((n) =>
            `<button type="button" class="qris-amount-btn" data-amount="${n}" onclick="return window.rbmSetAmount(${n}, this)">${formatRpLabel(n)}</button>`
        ).join('\n');
    }

    function isValidUser(text) {
        if (!text) return false;
        const t = String(text).replace(/\s+/g, ' ').trim();
        if (t.length < 3 || t.length > 32) return false;
        if (!/^[a-zA-Z0-9._-]+$/.test(t)) return false;
        if (/^[._-]|[._-]$/.test(t)) return false;
        const blacklist = new Set([
            'wallet', 'profile', 'deposit', 'withdraw', 'withdrawal',
            'referral', 'promo', 'bonus', 'logout', 'login', 'register',
            'account', 'username', 'settings', 'history', 'transaction',
            'help', 'contact', 'member', 'silver', 'gold', 'platinum',
            'bronze', 'diamond', 'vip', 'online', 'offline',
            'dompet', 'saldo', 'profil', 'keluar', 'masuk', 'daftar',
            'tambah', 'dana', 'newplayer', 'new', 'player', 'user',
            'qris', 'instant', 'manual', 'undefined', 'null',
            'object', 'string', 'number', 'boolean', 'function',
            'true', 'false', 'nan', 'icomoon',
        ]);
        return !blacklist.has(t.toLowerCase());
    }

    function cleanWelcome(text) {
        return String(text || '')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/^selamat\s+datang[:,]?\s*/i, '')
            .replace(/^welcome[:,]?\s*/i, '')
            .replace(/^hi[:,]?\s*/i, '')
            .trim();
    }

    function pickUserFromText(raw) {
        if (raw == null || typeof raw === 'object') return null;
        const cleaned = cleanWelcome(raw);
        if (/\[object\s/i.test(cleaned)) return null;
        if (isValidUser(cleaned)) return cleaned;
        const parts = cleaned.split(/[\s|/]+/).filter(Boolean);
        for (let i = parts.length - 1; i >= 0; i--) {
            if (isValidUser(parts[i])) return parts[i];
        }
        const m = cleaned.match(/[a-zA-Z][a-zA-Z0-9._-]{2,31}/);
        if (m && isValidUser(m[0])) return m[0];
        return null;
    }

    function usernameFromUnknown(value) {
        if (value == null || value === '') return null;
        if (typeof value === 'object' && value.nodeType === 1) {
            const tag = (value.tagName || '').toUpperCase();
            if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
                return pickUserFromText(value.value);
            }
            return null;
        }
        const t = typeof value;
        if (t === 'string' || t === 'number') return pickUserFromText(String(value));
        if (t !== 'object') return null;
        const keys = [
            'username', 'user_name', 'userName', 'member_name', 'memberName',
            'name', 'user', 'member', 'login', 'account',
        ];
        for (let i = 0; i < keys.length; i++) {
            const v = value[keys[i]];
            if (typeof v === 'string' || typeof v === 'number') {
                const u = pickUserFromText(String(v));
                if (u) return u;
            }
        }
        return null;
    }

    function usernameFromAccountNode(root) {
        const doc = root || document;
        const attrNodes = doc.querySelectorAll(
            'header[data-username], [data-username], [data-user], [data-member-username], [data-member]'
        );
        for (let i = 0; i < attrNodes.length; i++) {
            const el = attrNodes[i];
            const attrs = [
                el.getAttribute('data-username'),
                el.getAttribute('data-user'),
                el.getAttribute('data-member-username'),
                el.getAttribute('data-member'),
            ];
            for (let a = 0; a < attrs.length; a++) {
                const u = pickUserFromText(attrs[a]);
                if (u) return { user: u, node: el, source: 'data-username' };
            }
        }

        const page = doc.getElementById && doc.getElementById('pageContent');
        if (page) {
            const mb2 = page.getElementsByClassName('mb-2');
            for (let i = 0; i < mb2.length; i++) {
                const el = mb2[i];
                if (!el || /\bsubtitle\b/i.test(el.className || '')) continue;
                const u = pickUserFromText(el.textContent);
                if (u) return { user: u, node: el, source: '#pageContent .mb-2' };
            }
        }

        const selectors = [
            '.user-account span',
            'a.user-account span',
            '.account-username a',
            '.account-username',
            '.sidenav__header-user a',
            '.sidenav__header-user',
            '.header-title h5',
            '.header-user a',
            '.header-user',
            '.profile-item h5',
            '.user-name',
            '.member-username',
            '#memberUsername',
            '[name="username"]',
        ];
        for (let s = 0; s < selectors.length; s++) {
            const el = doc.querySelector(selectors[s]);
            if (!el) continue;
            const value = el.tagName === 'INPUT' || el.tagName === 'SELECT'
                ? el.value
                : (el.textContent || '');
            const u = pickUserFromText(value);
            if (u) return { user: u, node: el, source: selectors[s] };
        }
        return { user: null, node: null, source: null };
    }

    function lockUsername(user, source, node) {
        const u = String(user || '').trim();
        if (!isValidUser(u)) return null;
        _lockedUsername = u;
        window.__RBM_LOCKED_USERNAME__ = u;
        console.log('✅', LOG, 'Username locked (' + source + '):', u);
        syncUsernameField(u);
        if (node) {
            node.classList.add('notranslate');
            node.setAttribute('translate', 'no');
        }
        return u;
    }

    function syncUsernameField(user) {
        const el = document.getElementById('depositUsernameAutoQris');
        if (!el) return;
        const u = (user || _lockedUsername || '').toString().trim();
        if (!u) return;
        el.value = u;
        el.setAttribute('value', u);
        el.readOnly = true;
    }

    async function getUsernameFromProfilePage() {
        const urls = ['/profile', '/account/profile', '/member/profile', '/account'];
        for (let i = 0; i < urls.length; i++) {
            try {
                const res = await fetch(urls[i], {
                    method: 'GET',
                    credentials: 'same-origin',
                    cache: 'no-store',
                    headers: { Accept: 'text/html' },
                });
                if (!res.ok) continue;
                const html = await res.text();
                const doc = new DOMParser().parseFromString(html, 'text/html');
                const found = usernameFromAccountNode(doc);
                if (found.user) {
                    console.log(LOG, 'Username from', urls[i], found.source, found.user);
                    return found.user;
                }
                const item = doc.querySelector('.profile-item h5, .profile-item .value, .account-info h5');
                const fromItem = item && pickUserFromText(item.textContent);
                if (fromItem) {
                    console.log(LOG, 'Username from', urls[i], '.profile-item', fromItem);
                    return fromItem;
                }
            } catch (_) {}
        }
        return null;
    }

    function logUsernameMiss() {
        const header = document.querySelector('header');
        console.warn('⚠️', LOG, 'Username NOT found. header dataset:', header && header.dataset);
        console.warn(LOG, 'hint: paste di console → document.querySelector("header") && document.querySelector("header").outerHTML.slice(0,800)');
    }

    async function getUsername() {
        if (_lockedUsername && isValidUser(_lockedUsername)) return _lockedUsername;
        if (window.__RBM_LOCKED_USERNAME__ && isValidUser(window.__RBM_LOCKED_USERNAME__)) {
            _lockedUsername = window.__RBM_LOCKED_USERNAME__;
            return _lockedUsername;
        }

        const fromDom = usernameFromAccountNode(document);
        if (fromDom.user) return lockUsername(fromDom.user, fromDom.source, fromDom.node);

        try {
            if (typeof window.getMemberName === 'function') {
                const gn = usernameFromUnknown(window.getMemberName());
                if (gn) return lockUsername(gn, 'getMemberName');
            }
        } catch (_) {}

        const globalNames = [
            'memberId', 'username', 'user_name', 'memberName',
            'memberUsername', 'userName', 'member_name', 'user',
        ];
        for (let i = 0; i < globalNames.length; i++) {
            const g = usernameFromUnknown(window[globalNames[i]]);
            if (g) return lockUsername(g, 'window.' + globalNames[i]);
        }

        const fromProfile = await getUsernameFromProfilePage();
        if (fromProfile) return lockUsername(fromProfile, '/profile');

        logUsernameMiss();
        return null;
    }

    async function validateUsernameExists() {
        const username = await getUsername();
        if (!username) {
            console.warn('⚠️', LOG, 'INJECTION DISABLED - Username not found');
            return false;
        }
        return true;
    }

    function resolvePgscriptBase() {
        const configured = (
            window.PGSCRIPT_BASE_URL ||
            window.PGSCRIPT_BASE ||
            getParamFromCurrentScript('api_base') ||
            ''
        ).toString().trim();
        let base = configured || 'https://payment.pg-poppay.com';
        try {
            const parsed = new URL(base, window.location.href);
            if (window.location.protocol === 'https:' && parsed.protocol === 'http:') parsed.protocol = 'https:';
            base = parsed.origin;
        } catch (e) {
            if (window.location.protocol === 'https:' && base.startsWith('http://')) {
                base = 'https://' + base.slice(7);
            }
        }
        return base.replace(/\/+$/, '');
    }

    const PGSCRIPT_BASE = resolvePgscriptBase();
    const PGSCRIPT_API_VERSION = (
        window.PGSCRIPT_API_VERSION ||
        getParamFromCurrentScript('api_version') ||
        'api'
    ).toString().trim();

    async function checkPaymentHealth() {
        if (SKIP_STORE_KEY) {
            depositEnabled = true;
            return true;
        }
        if (!STORE_KEY) {
            console.log('[Deposit is disabled]');
            console.warn('❌', LOG, 'store_key missing — tambahkan ?store_key=... di script src');
            depositEnabled = false;
            return false;
        }
        const now = Date.now();
        if (
            paymentHealthCache !== null &&
            paymentHealthCacheKey === STORE_KEY &&
            (now - paymentHealthCacheAt) < PAYMENT_HEALTH_CACHE_TTL_MS
        ) {
            depositEnabled = !!paymentHealthCache;
            return paymentHealthCache;
        }
        try {
            const res = await fetch(`${PGSCRIPT_BASE}/${PGSCRIPT_API_VERSION}/payment-health-v2`, {
                method: 'GET',
                cache: 'no-store',
                headers: { Accept: 'application/json', 'X-Store-Key': STORE_KEY },
            });
            const body = await res.json().catch(() => ({}));
            if (!res.ok || body?.success !== true) {
                console.log('[Deposit is disabled]');
                console.warn('❌', LOG, 'payment-health OFF:', body?.message || ('HTTP ' + res.status));
                paymentHealthCache = false;
                paymentHealthCacheKey = STORE_KEY;
                paymentHealthCacheAt = now;
                depositEnabled = false;
                return false;
            }
            console.log('✅', LOG, 'payment-health OK');
            paymentHealthCache = true;
            paymentHealthCacheKey = STORE_KEY;
            paymentHealthCacheAt = now;
            depositEnabled = true;
            return true;
        } catch (err) {
            console.log('[Deposit is disabled]');
            console.warn('❌', LOG, 'payment-health failed:', err && err.message);
            paymentHealthCache = false;
            paymentHealthCacheKey = STORE_KEY;
            paymentHealthCacheAt = now;
            depositEnabled = false;
            return false;
        }
    }

    function teardownInjection() {
        const wrapper = document.getElementById('rbm-poppay-wrapper');
        const hidden = document.querySelectorAll('[data-rbm-hidden="true"]');
        if (!wrapper && !hidden.length && !isInjected && !depositEnabled) return;
        depositEnabled = false;
        if (wrapper) wrapper.remove();
        hidden.forEach((el) => {
            el.style.display = '';
            el.style.visibility = '';
            el.removeAttribute('data-rbm-hidden');
        });
        isInjected = false;
        handlersAttached = false;
        console.log(LOG, 'Injection dihapus');
    }

    // UG Sports money site (RajaBM theme-3): body #471525, header #181733, button #FDBB2C
    const THEME_MONEY = {
        bg: '#471525',
        bgDeep: '#181733',
        text: '#FFFFFF',
        muted: 'rgba(255, 255, 255, 0.72)',
        accent: '#FDBB2C',
        accentHover: '#FFD15A',
        accentText: '#181733',
        border: 'rgba(253, 187, 44, 0.38)',
        btnBg: 'rgba(253, 187, 44, 0.12)',
        badgeBg: 'rgba(253, 187, 44, 0.20)',
        successBg: 'rgba(253, 187, 44, 0.16)',
        shadow: '0 4px 16px rgba(0, 0, 0, 0.45)',
    };

    function parseRgb(input) {
        const m = String(input || '').match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/i);
        if (!m) return null;
        const a = m[4] == null ? 1 : Number(m[4]);
        if (a < 0.12) return null;
        return [Number(m[1]), Number(m[2]), Number(m[3])];
    }

    function rgbToHex(rgb) {
        return '#' + rgb.map((n) => ('0' + Math.max(0, Math.min(255, n)).toString(16)).slice(-2)).join('');
    }

    function rgbToRgba(rgb, a) {
        return 'rgba(' + rgb[0] + ', ' + rgb[1] + ', ' + rgb[2] + ', ' + a + ')';
    }

    function luminance(rgb) {
        return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
    }

    function darken(rgb, f) {
        return rgb.map((n) => Math.round(Math.max(0, Math.min(255, n * f))));
    }

    function lighten(rgb, f) {
        return rgb.map((n) => Math.round(Math.max(0, Math.min(255, n + (255 - n) * f))));
    }

    function isUsableAccent(rgb) {
        if (!rgb) return false;
        const max = Math.max(rgb[0], rgb[1], rgb[2]);
        const min = Math.min(rgb[0], rgb[1], rgb[2]);
        return max - min >= 20 && max >= 70;
    }

    function sampleComputed(sel, prop) {
        const el = document.querySelector(sel);
        if (!el) return null;
        try {
            return parseRgb(getComputedStyle(el)[prop]);
        } catch (_) {
            return null;
        }
    }

    function sampleAccentColor() {
        const nodes = document.querySelectorAll([
            'a.button',
            '.payment-methods-items.online',
            '.payment-methods-items',
            '.btn-refresh-wallet',
            '.wallet .button',
            '.pay-title',
            '.user-account',
            '.header-wrapper a.button',
        ].join(','));
        for (let i = 0; i < nodes.length; i++) {
            const cs = getComputedStyle(nodes[i]);
            for (const prop of ['backgroundColor', 'borderBottomColor', 'borderColor', 'color']) {
                const rgb = parseRgb(cs[prop]);
                if (isUsableAccent(rgb)) return rgb;
            }
        }
        return [253, 187, 44];
    }

    function getInjectTheme() {
        const t = Object.assign({}, THEME_MONEY);
        const bodyBg = sampleComputed('body', 'backgroundColor')
            || sampleComputed('.deposit', 'backgroundColor')
            || [71, 21, 37];
        const headerBg = sampleComputed('.header-wrapper', 'backgroundColor')
            || sampleComputed('.main-header', 'backgroundColor')
            || [24, 23, 51];
        const textRgb = sampleComputed('body', 'color')
            || sampleComputed('.user-account', 'color')
            || [255, 255, 255];
        const accentRgb = sampleAccentColor();

        t.bg = rgbToHex(bodyBg);
        t.bgDeep = rgbToHex(luminance(headerBg) < luminance(bodyBg) ? headerBg : darken(bodyBg, 0.62));
        t.text = rgbToHex(textRgb);
        t.muted = rgbToRgba(textRgb, 0.72);
        t.accent = rgbToHex(accentRgb);
        t.accentHover = rgbToHex(lighten(accentRgb, 0.22));
        t.accentText = luminance(accentRgb) > 0.55 ? rgbToHex(headerBg) : '#FFFFFF';
        t.border = rgbToRgba(accentRgb, 0.38);
        t.btnBg = rgbToRgba(accentRgb, 0.12);
        t.badgeBg = rgbToRgba(accentRgb, 0.20);
        t.successBg = rgbToRgba(accentRgb, 0.16);
        console.log(LOG, 'Theme from money site', t);
        return t;
    }

    function applyInjectTheme(wrapper, theme) {
        const t = theme || getInjectTheme();
        const map = {
            '--ug-bg': t.bg,
            '--ug-bg-deep': t.bgDeep,
            '--ug-text': t.text,
            '--ug-muted': t.muted,
            '--ug-accent': t.accent,
            '--ug-accent-hover': t.accentHover,
            '--ug-accent-text': t.accentText,
            '--ug-border': t.border,
            '--ug-btn-bg': t.btnBg,
            '--ug-badge-bg': t.badgeBg,
            '--ug-success-bg': t.successBg,
            '--ug-shadow': t.shadow,
        };
        Object.keys(map).forEach((k) => wrapper.style.setProperty(k, map[k]));
    }

    function isDepositPath() {
        const path = (location.pathname || '').replace(/\/+$/, '').toLowerCase();
        return path === '/account/deposit';
    }

    function getDepositMethodsForm() {
        return document.querySelector('.deposit .content-form .methods_form, .deposit .methods_form');
    }

    function isOnDepositPage() {
        if (!isDepositPath()) return false;
        const form = getDepositMethodsForm();
        if (!form) return false;
        return !!(form.querySelector('#qrisauto') || form.querySelector('.payment-methods-items'));
    }

    function findStableContainer() {
        if (!isDepositPath()) {
            console.warn('⚠️', LOG, 'skip: bukan /account/deposit');
            return null;
        }
        const methods = getDepositMethodsForm();
        if (methods && methods.closest('.deposit')) {
            console.log('✅', LOG, 'container: .deposit .methods_form');
            return methods;
        }
        console.warn('⚠️', LOG, 'container .deposit .methods_form belum ada');
        return null;
    }

    function hideNativeInstant() {
        const methods = getDepositMethodsForm();
        if (!methods) return;
        const qris = methods.querySelector('#qrisauto');
        const qrisBox = qris && qris.closest('.box-wrapper');
        const nodes = [];
        if (qris) nodes.push(qris);
        if (qrisBox) nodes.push(qrisBox);
        nodes.forEach((el) => {
            if (!el || el.closest('#rbm-poppay-wrapper')) return;
            el.style.display = 'none';
            el.style.visibility = 'hidden';
            el.setAttribute('data-rbm-hidden', 'true');
        });
    }

    function loadQrisSDK() {
        return new Promise((resolve, reject) => {
            if (typeof window.QrisSDK !== 'undefined') {
                resolve();
                return;
            }
            const url = (
                getParamFromCurrentScript('sdk_url') ||
                window.PGSCRIPT_SDK_URL ||
                'https://unpkg.com/@poppackage/pg-ppy-sdk@1.0.0/dist/qris-sdk.umd.js'
            ).toString().trim();
            const script = document.createElement('script');
            script.src = url;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Failed to load SDK'));
            document.head.appendChild(script);
        });
    }

    function panelCss() {
        const m = CONFIG.IS_MOBILE;
        const t = getInjectTheme();
        return `
            #rbm-poppay-wrapper {
                --ug-bg: ${t.bg};
                --ug-bg-deep: ${t.bgDeep};
                --ug-text: ${t.text};
                --ug-muted: ${t.muted};
                --ug-accent: ${t.accent};
                --ug-accent-hover: ${t.accentHover};
                --ug-accent-text: ${t.accentText};
                --ug-border: ${t.border};
                --ug-btn-bg: ${t.btnBg};
                --ug-badge-bg: ${t.badgeBg};
                --ug-success-bg: ${t.successBg};
                --ug-shadow: ${t.shadow};
                position: relative !important;
                z-index: 1 !important;
                display: block !important;
                width: 100%;
                margin-bottom: 16px !important;
            }
            #rbm-poppay-qris-full { position: relative; display: block !important; }
            #rbm-poppay-qris-full::before {
                content: 'QRIS Instant Active';
                position: absolute;
                top: -5px;
                right: 0;
                background: var(--ug-badge-bg);
                color: var(--ug-accent);
                font-size: 10px;
                padding: 2px 6px;
                border-radius: 3px;
                font-weight: 600;
                z-index: 2;
            }
            .qris-manual-wrapper {
                background: var(--ug-bg);
                color: var(--ug-text);
                padding: ${m ? '12px' : '22px'};
                border-radius: ${m ? '8px' : '12px'};
                border: 1px solid var(--ug-border);
                box-shadow: var(--ug-shadow);
                box-sizing: border-box;
                width: 100%;
                color-scheme: dark;
            }
            .qris-manual-header { margin-bottom: 14px; padding-bottom: 10px; border-bottom: 1px solid var(--ug-border); }
            .qris-manual-header h5 { margin: 0; color: var(--ug-text); font-size: ${m ? '15px' : '18px'}; }
            .qris-manual-header p { margin: 6px 0 0; color: var(--ug-muted); font-size: 13px; }
            .qris-form label { display: block; margin-bottom: 6px; color: var(--ug-text); font-weight: 500; }
            #depositUsernameAutoQris, .qris-input {
                width: 100%;
                box-sizing: border-box;
                padding: 12px;
                border: 1px solid var(--ug-border);
                border-radius: 6px;
                background: var(--ug-bg-deep);
                color: var(--ug-text);
                font-size: ${m ? '14px' : '16px'};
            }
            .qris-amount-buttons { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
            .qris-amount-btn {
                flex: 1 1 auto;
                min-width: ${m ? '30%' : '110px'};
                padding: ${m ? '10px 8px' : '10px 12px'};
                border-radius: 6px;
                border: 1px solid var(--ug-border);
                background: var(--ug-btn-bg);
                color: var(--ug-text);
                cursor: pointer;
                pointer-events: auto !important;
                position: relative;
                z-index: 5;
                -webkit-tap-highlight-color: transparent;
                touch-action: manipulation;
            }
            .qris-amount-btn:hover, .qris-amount-btn.active {
                background: var(--ug-accent) !important;
                color: var(--ug-accent-text) !important;
                border-color: var(--ug-accent) !important;
            }
            .qris-input-group { display: flex; width: 100%; }
            .qris-input-prefix {
                background: var(--ug-bg-deep);
                padding: 12px 14px;
                border: 1px solid var(--ug-border);
                border-right: none;
                border-radius: 6px 0 0 6px;
                color: var(--ug-muted);
                display: flex;
                align-items: center;
            }
            .qris-input-group .qris-input { border-radius: 0 6px 6px 0; }
            .qris-input-hint { display: block; margin-top: 6px; font-size: 12px; color: var(--ug-muted); }
            .qris-submit-btn {
                width: 100%;
                margin-top: 12px;
                padding: ${m ? '16px' : '14px'};
                background: var(--ug-accent);
                color: var(--ug-accent-text);
                border: none;
                border-radius: 6px;
                font-size: 16px;
                font-weight: 600;
                cursor: pointer;
            }
            .qris-submit-btn:disabled { background: var(--ug-btn-bg); color: var(--ug-muted); cursor: not-allowed; }
            .qris-result { display: none; margin-top: 16px; }
            .qris-result.active { display: block; }
            .ug-qris-success-box {
                padding: 16px;
                background: var(--ug-success-bg);
                border: 2px solid var(--ug-accent);
                border-radius: 8px;
            }
            #qris-payment-frame { min-height: 400px; text-align: center; }
        `;
    }

    function panelHtml() {
        return `
            <style>${panelCss()}</style>
            <div class="qris-manual-wrapper transaksi-formulir">
                <div class="qris-manual-header">
                    <h5>QRIS Payment - Deposit Instant</h5>
                    <p>Scan QR code dengan e-wallet (DANA, OVO, GoPay, ShopeePay, dll)</p>
                </div>
                <div class="qris-form" id="qrisFormContainer">
                    <form id="formDepositAutoQris">
                        <input type="hidden" id="bankSelectAutoQris" value="QRIS">
                        <div class="form-group mb-3">
                            <label for="depositUsernameAutoQris">Username</label>
                            <input class="qris-input qris-username-readonly notranslate" type="text"
                                id="depositUsernameAutoQris" name="username" value="" readonly tabindex="-1"
                                translate="no" autocomplete="off" placeholder="Mendeteksi username...">
                            <small class="qris-input-hint">Username akun login (otomatis)</small>
                        </div>
                        <div class="form-group mb-3">
                            <label>Jumlah Deposit</label>
                            <div class="qris-amount-buttons" id="rbm-amount-buttons">${amountButtonsHtml()}</div>
                            <div class="qris-input-group">
                                <div class="qris-input-prefix">Rp</div>
                                <input class="qris-input" type="text" id="depositShowAmountAutoQris" placeholder="Atau masukkan jumlah manual">
                            </div>
                            <input type="hidden" id="depositAmountAutoQris" value="">
                            <small class="qris-input-hint">Min: ${formatRpLabel(CONFIG.MIN_AMOUNT)} | Max: ${formatRpLabel(CONFIG.MAX_AMOUNT)}</small>
                        </div>
                        <button type="submit" class="qris-submit-btn">
                            <span id="qris-btn-text">Generate QR Code</span>
                        </button>
                    </form>
                </div>
                <div class="qris-result" id="qrisResultContainer">
                    <div class="text-center">
                        <div id="qris-payment-frame"></div>
                        <div id="payment-result"></div>
                    </div>
                </div>
            </div>
        `;
    }

    function insertWrapper(parent, wrapper) {
        const inDepositMethods = parent && parent.closest && (
            parent.closest('.deposit .methods_form') ||
            (parent.classList && parent.classList.contains('methods_form') && parent.closest('.deposit'))
        );
        if (!inDepositMethods) {
            console.warn('⚠️', LOG, 'insert dibatalkan — hanya di dalam .deposit .methods_form');
            return;
        }
        const qris = parent.querySelector('#qrisauto');
        const qrisBox = qris && qris.closest('.box-wrapper');
        if (qrisBox && qrisBox.parentNode === parent) {
            parent.insertBefore(wrapper, qrisBox);
            return;
        }
        parent.insertBefore(wrapper, parent.firstChild);
    }

    function setAmount(amount, button) {
        const amountShow = document.getElementById('depositShowAmountAutoQris');
        const amountHidden = document.getElementById('depositAmountAutoQris');
        if (!amountShow || !amountHidden) return;
        document.querySelectorAll('.qris-amount-btn').forEach((b) => b.classList.remove('active'));
        if (button) button.classList.add('active');
        amountShow.value = parseInt(amount, 10).toLocaleString('id-ID');
        amountHidden.value = amount;
    }

    function attachAmountButtons() {
        if (window.__RBM_AMOUNT_BOUND__) return;
        window.__RBM_AMOUNT_BOUND__ = true;
        const onPick = function (e) {
            const button = e.target && e.target.closest && e.target.closest('#rbm-poppay-wrapper .qris-amount-btn');
            if (!button) return;
            e.preventDefault();
            e.stopPropagation();
            if (e.stopImmediatePropagation) e.stopImmediatePropagation();
            setAmount(button.getAttribute('data-amount'), button);
        };
        ['click', 'mousedown', 'touchstart', 'pointerdown'].forEach(function (type) {
            document.addEventListener(type, onPick, true);
        });
    }

    function attachHandlers() {
        const form = document.getElementById('formDepositAutoQris');
        const amountShow = document.getElementById('depositShowAmountAutoQris');
        const amountHidden = document.getElementById('depositAmountAutoQris');
        const formContainer = document.getElementById('qrisFormContainer');
        const resultContainer = document.getElementById('qrisResultContainer');
        const btnText = document.getElementById('qris-btn-text');
        const submitBtn = form && form.querySelector('.qris-submit-btn');
        if (!form || handlersAttached) return;
        handlersAttached = true;

        fillUsernameField();
        attachAmountButtons();

        if (amountShow) {
            amountShow.addEventListener('input', function () {
                const val = this.value.replace(/\D/g, '');
                amountHidden.value = val;
                this.value = val.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
                document.querySelectorAll('.qris-amount-btn').forEach((b) => b.classList.remove('active'));
            });
        }

        form.addEventListener('submit', async function (e) {
            e.preventDefault();
            e.stopPropagation();
            const amount = parseInt(amountHidden.value, 10);
            if (!amount || amount < CONFIG.MIN_AMOUNT) {
                alert('Minimal deposit ' + formatRpLabel(CONFIG.MIN_AMOUNT));
                return;
            }
            if (amount > CONFIG.MAX_AMOUNT) {
                alert('Maksimal deposit ' + formatRpLabel(CONFIG.MAX_AMOUNT));
                return;
            }
            if (submitBtn) submitBtn.disabled = true;
            if (btnText) btnText.textContent = 'Generating...';
            try {
                if (typeof window.QrisSDK === 'undefined') await loadQrisSDK();
                const username = await getUsername();
                syncUsernameField(username);
                if (!username) throw new Error('Username tidak ditemukan. Login dulu.');
                formContainer.style.display = 'none';
                resultContainer.classList.add('active');
                await new Promise((r) => setTimeout(r, 80));
                const invoice = 'RBM-' + Date.now();
                const payment = new window.QrisSDK({
                    healthCheckEnabled: false,
                    storeKey: STORE_KEY,
                    store_key: STORE_KEY,
                    amount: amount,
                    invoice: invoice,
                    notes: 'RBM Auto Deposit - ' + invoice,
                    username: username,
                    payor_name: username,
                    payor_email: '',
                    displayMode: 'inline',
                    containerId: 'qris-payment-frame',
                    resultContainerId: 'payment-result',
                    onSuccess: function () {
                        document.getElementById('payment-result').innerHTML =
                            '<div class="ug-qris-success-box"><h4>Pembayaran Berhasil!</h4><p>Deposit ' +
                            formatRpLabel(amount) + ' sedang diproses</p></div>';
                        setTimeout(resetForm, 5000);
                    },
                    onFailed: function () {
                        alert('Gagal membuat QR Code. Silakan coba lagi.');
                        resetForm();
                    },
                    onCancel: function () {
                        resetForm();
                    },
                });
                payment.openPayment();
            } catch (err) {
                console.error('❌', LOG, err);
                alert((err && err.message) || 'Terjadi kesalahan. Silakan coba lagi.');
                resetForm();
            }
        });

        function resetForm() {
            formContainer.style.display = 'block';
            resultContainer.classList.remove('active');
            const frame = document.getElementById('qris-payment-frame');
            const result = document.getElementById('payment-result');
            if (frame) frame.innerHTML = '';
            if (result) result.innerHTML = '';
            amountShow.value = '';
            amountHidden.value = '';
            document.querySelectorAll('.qris-amount-btn').forEach((b) => b.classList.remove('active'));
            if (submitBtn) submitBtn.disabled = false;
            if (btnText) btnText.textContent = 'Generate QR Code';
        }
    }

    async function fillUsernameField() {
        const user = await getUsername();
        syncUsernameField(user);
        return user;
    }

    function keepInstantTabActive() {
        const instant = document.getElementById('btnInstant');
        const manual = document.getElementById('btnManual');
        if (instant) {
            instant.classList.add('active');
            instant.addEventListener('click', function () {
                hideNativeInstant();
                const wrap = document.getElementById('rbm-poppay-wrapper');
                if (wrap) wrap.style.display = 'block';
            });
        }
        if (manual) {
            manual.addEventListener('click', function () {
                const wrap = document.getElementById('rbm-poppay-wrapper');
                if (wrap) wrap.style.display = 'none';
            });
        }
    }

    async function injectPanel() {
        if (!isOnDepositPage()) {
            console.log(LOG, 'skip inject — bukan halaman pilih metode deposit');
            return false;
        }
        const healthOk = await checkPaymentHealth();
        if (!healthOk) {
            teardownInjection();
            return false;
        }
        if (document.getElementById('rbm-poppay-qris-full')) {
            const existing = document.getElementById('rbm-poppay-wrapper');
            if (existing && existing.closest('.deposit .methods_form')) {
                hideNativeInstant();
                return true;
            }
            teardownInjection();
        }
        handlersAttached = false;
        const okUser = await validateUsernameExists();
        if (!okUser) return false;
        const parent = findStableContainer();
        if (!parent) {
            console.error('❌', LOG, 'Stable container not found');
            return false;
        }

        hideNativeInstant();

        const wrapper = document.createElement('div');
        wrapper.id = 'rbm-poppay-wrapper';
        wrapper.setAttribute('data-rbm-persistent', 'true');
        applyInjectTheme(wrapper);

        const inner = document.createElement('div');
        inner.id = 'rbm-poppay-qris-full';
        inner.setAttribute('data-payment-method', 'qris-poppay');
        inner.innerHTML = panelHtml();
        inner.addEventListener('click', function (e) {
            if (e.target && e.target.closest && e.target.closest('.qris-amount-btn, .qris-submit-btn, .qris-input')) return;
            e.stopPropagation();
        });
        wrapper.appendChild(inner);
        insertWrapper(parent, wrapper);

        const placed = document.getElementById('rbm-poppay-wrapper');
        if (!placed || !placed.closest('.deposit .methods_form')) {
            console.error('❌', LOG, 'Insert di luar .deposit .methods_form — dibatalkan');
            teardownInjection();
            return false;
        }

        keepInstantTabActive();
        attachAmountButtons();
        setTimeout(attachHandlers, 50);
        setTimeout(attachHandlers, 250);
        console.log('✅', LOG, 'Injected into .deposit .methods_form');
        return true;
    }

    async function startPersistentInjection() {
        if (!isDepositPath()) {
            console.log(LOG, 'skip — hanya /account/deposit');
            return;
        }
        const healthOk = await checkPaymentHealth();
        if (!healthOk) {
            teardownInjection();
            return;
        }
        if (!(await validateUsernameExists())) return;
        const success = await injectPanel();
        if (success) isInjected = true;

        setInterval(async () => {
            if (!isDepositPath()) {
                teardownInjection();
                return;
            }
            if (!getDepositMethodsForm()) {
                teardownInjection();
                return;
            }
            const ok = await checkPaymentHealth();
            if (!ok) {
                teardownInjection();
                return;
            }
            if (!isOnDepositPage()) return;
            const wrap = document.getElementById('rbm-poppay-wrapper');
            if (wrap && !wrap.closest('.deposit .methods_form')) {
                teardownInjection();
            }
            const live = document.getElementById('rbm-poppay-wrapper');
            if ((!live || !document.getElementById('rbm-poppay-qris-full')) && !reinjectionInProgress) {
                reinjectionInProgress = true;
                if (await validateUsernameExists()) {
                    const okInject = await injectPanel();
                    if (okInject) isInjected = true;
                }
                reinjectionInProgress = false;
            } else if (live && depositEnabled) {
                hideNativeInstant();
            }
        }, 1500);

        const mo = new MutationObserver(() => {
            if (!isDepositPath()) {
                teardownInjection();
                return;
            }
            if (!getDepositMethodsForm()) {
                teardownInjection();
                return;
            }
            if (!depositEnabled || !isOnDepositPage() || reinjectionInProgress) return;
            const wrap = document.getElementById('rbm-poppay-wrapper');
            if (wrap && !wrap.closest('.deposit .methods_form')) {
                teardownInjection();
                return;
            }
            if (!wrap) {
                reinjectionInProgress = true;
                injectPanel().then((ok) => {
                    if (ok) isInjected = true;
                }).finally(() => { reinjectionInProgress = false; });
            } else {
                hideNativeInstant();
            }
        });
        mo.observe(document.body, { childList: true, subtree: true });
    }

    let retryCount = 0;
    async function tryStart() {
        if (!isDepositPath()) {
            console.log(LOG, 'skip — hanya /account/deposit');
            return;
        }
        if (!(await checkPaymentHealth())) {
            teardownInjection();
            return;
        }
        const hasUsername = await validateUsernameExists();
        if (!hasUsername) {
            if (retryCount < CONFIG.MAX_RETRIES) {
                retryCount++;
                setTimeout(tryStart, CONFIG.RETRY_DELAY);
                return;
            }
            console.error('❌', LOG, 'SCRIPT DISABLED - Username not found');
            return;
        }
        const container = findStableContainer();
        if (container || retryCount >= CONFIG.MAX_RETRIES) {
            await startPersistentInjection();
        } else {
            retryCount++;
            setTimeout(tryStart, CONFIG.RETRY_DELAY);
        }
    }

    function boot() {
        if (!isDepositPath()) {
            console.log(LOG, 'skip — hanya /account/deposit');
            return;
        }
        setTimeout(tryStart, 600);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
