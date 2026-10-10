// ============================================================================
// RajaBM / 3mplay QRIS POPPAY inject — BESTIEv1.js
// Laravel 3mplay deposit UI — any domain, path /account/deposit only
// SDK: https://unpkg.com/@poppackage/pg-ppy-sdk@1.0.0/dist/qris-sdk.umd.js
// Health: GET https://payment.pg-poppay.com/api/payment-health-v2 (+ X-Store-Key)
// Embed:
// <script src=".../BESTIEv1.js?store_key=sk_xxx&min_depo=10000&max_depo=10000000&buttons=10000,50000,100000,500000"></script>
// Username: GET /ajaxProfile → /profile (retry 300ms, timeout 8s); hanya nilai berlabel "Nama pengguna"/"Username"
//   (kebal Translate, sama di desktop & mobile); teks DOM tidak dipakai; kandidat bentrok ditolak; cek ulang profil sebelum QR
// Inject: hanya /account/deposit di dalam .deposit .methods_form (QRIS Otomatis)
// ============================================================================

(function () {
    'use strict';

    const LOG = '[BESTIE-QRIS]';
    const VERSION = '1.0.9';

    if (window.__BESTIE_QRIS_BOOTED__ === VERSION) {
        console.log(LOG, 'already booted', VERSION);
        return;
    }
    window.__BESTIE_QRIS_BOOTED__ = VERSION;

    console.log('🚀', LOG, 'Starting BESTIEv1', VERSION);

    window.BESTIESetAmount = function (amount, button) {
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

    // Key privat: jangan pakai __BESTIE_LOCKED_USERNAME__ lama yang bisa berisi hasil scrape DOM ter-Translate.
    const LOCK_KEY = '__BESTIE_QRIS_USER__';
    let _lockedUsername = null;
    let _lockedSource = null;
    try {
        const prev = window[LOCK_KEY];
        if (prev && typeof prev === 'object' && prev.user && prev.source) {
            _lockedUsername = String(prev.user).trim() || null;
            _lockedSource = String(prev.source);
        }
    } catch (_) {}
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
                /BESTIEv[0-9]+\.js(\?|$)|rajabm(?:_qris)?\.js(\?|$)|BESTIE[_-]?qris[_-]?inject\.js(\?|$)/i.test(url)
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
        const src = raw || window.BESTIE_AMOUNT_BUTTONS || '';
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
        getParamFromCurrentScript('min_depo') || window.BESTIE_MIN_DEPO,
        CONFIG.MIN_AMOUNT
    );
    CONFIG.MAX_AMOUNT = parseAmountParam(
        getParamFromCurrentScript('max_depo') || window.BESTIE_MAX_DEPO,
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
            `<button type="button" class="qris-amount-btn" data-amount="${n}" onclick="return window.BESTIESetAmount(${n}, this)">${formatRpLabel(n)}</button>`
        ).join('\n');
    }

    // Jangan pernah menebak "un-translate" username (with→dengan dsb): "Withdraw" jadi "dengandraw",
    // "orange77" jadi "atauange77". Hanya sumber yang tidak ikut diterjemahkan yang dipakai
    // (fetch /ajaxProfile|/profile, Qwik JSON, getMemberName()).
    // Tanpa blacklist kata: semua sumber adalah field username resmi, dan username sah seperti
    // "member", "silver", "dengan", "deposit" tidak boleh ditolak.
    function isValidUser(text) {
        if (!text) return false;
        const t = String(text).trim();
        if (t.length < 3 || t.length > 24) return false;
        return /^[a-zA-Z0-9_]+$/.test(t);
    }

    function parseQwikJsonText(raw) {
        const text = String(raw || '').trim();
        if (!text) return null;
        try {
            return JSON.parse(text);
        } catch (_) {}
        try {
            const norm = text.replace(/\\x([0-9A-Fa-f]{2})/g, (_, h) => '\\u00' + h);
            return JSON.parse(norm);
        } catch (_) {
            return null;
        }
    }

    function resolveQwikRef(objs, ref) {
        if (typeof ref === 'string' && /^[0-9a-z]+$/i.test(ref)) {
            const idx = parseInt(ref, 36);
            if (Number.isFinite(idx) && idx >= 0 && idx < objs.length) return objs[idx];
        }
        return ref;
    }

    function getUsernameFromQwikState() {
        const scripts = document.querySelectorAll('script[type="qwik/json"]');
        for (let s = 0; s < scripts.length; s++) {
            const data = parseQwikJsonText(scripts[s].textContent || '');
            const objs = data && data.objs;
            if (!Array.isArray(objs)) continue;
            for (let i = 0; i < objs.length; i++) {
                const item = objs[i];
                if (!item || typeof item !== 'object') continue;
                if (!Object.prototype.hasOwnProperty.call(item, 'user_name')) continue;
                if ('password' in item && 'remember_me' in item && !('user_bal' in item) && !('isAuth' in item)) continue;
                if (!('user_bal' in item || 'isAuth' in item || 'member_level' in item)) continue;
                const val = resolveQwikRef(objs, item.user_name);
                const text = String(val == null ? '' : val).trim();
                if (isValidUser(text)) return text;
            }
        }
        return null;
    }

    // Nilai hanya diambil kalau labelnya benar-benar "Nama Pengguna"/"Username" — field lain
    // (Nama Lengkap, Nama Sesuai Rekening, Email, No. HP, Bank) tidak boleh ikut.
    const USERNAME_LABEL_RE = /^(nama\s*pengguna|username|user\s*name|user\s*id)\s*:?$/i;

    function readUsernameFromProfileDom(doc) {
        if (!doc || !doc.body) return null;
        const textOf = (el) => String(el && (el.textContent || '')).replace(/\s+/g, ' ').trim();
        const found = [];
        const add = (u, how) => {
            if (isValidUser(u) && !found.some((f) => f.user === u)) found.push({ user: u, how });
        };

        // UG/Qwik: <div class="profile-field-text"> Nama Pengguna</div><div class="filledBox">user</div>
        doc.querySelectorAll('.profile-field-text').forEach((lab) => {
            if (!USERNAME_LABEL_RE.test(textOf(lab))) return;
            const v = lab.nextElementSibling;
            if (v && !v.querySelector('input,select,button')) add(textOf(v), 'profile-field-text');
        });

        // Laravel: <p class="_label">Nama pengguna :</p> <div class="col-xs-8"><p>user</p></div>
        doc.querySelectorAll('p._label, .profile-edit p, label, th, dt, td, .label').forEach((lab) => {
            if (lab.children.length > 1 || !USERNAME_LABEL_RE.test(textOf(lab))) return;
            let v = null;
            const row = lab.closest && lab.closest('.row');
            if (row) v = row.querySelector('.col-xs-8 p, .col-xs-8 span, .col-sm-8 p, .col-md-8 p');
            if (!v && lab.nextElementSibling) v = lab.nextElementSibling;
            if (!v && lab.parentElement && lab.parentElement.nextElementSibling) {
                const next = lab.parentElement.nextElementSibling;
                v = next.querySelector('p, span') || next;
            }
            if (!v) return;
            if (v.tagName === 'INPUT') add(String(v.getAttribute('value') || '').trim(), 'label+input');
            else if (!v.querySelector('input,select,button')) add(textOf(v), 'label');
        });

        // pglain: .username-wrapper — div label ("Username", "User ID", "Nama Pengguna") dilewati
        doc.querySelectorAll('.username-wrapper div').forEach((d) => {
            if (d.children.length > 0 || USERNAME_LABEL_RE.test(textOf(d))) return;
            add(textOf(d), 'username-wrapper');
        });

        if (found.length === 0) return null;
        if (found.length > 1) {
            console.warn(LOG, 'Profile: kandidat username bentrok, ditolak', found);
            return null;
        }
        return found[0].user;
    }

    function lockUsername(user, source) {
        const u = String(user || '').trim();
        if (!u || !isValidUser(u)) return null;
        _lockedUsername = u;
        _lockedSource = source;
        try { window[LOCK_KEY] = { user: u, source }; } catch (_) {}
        console.log('✅', LOG, 'Username locked (' + source + '):', u);
        syncUsernameField(u);
        return u;
    }

    function syncUsernameField(user) {
        const el = document.getElementById('depositUsernameAutoQris');
        if (!el) return;
        const u = (user || _lockedUsername || '').toString().trim();
        if (!u) return;
        el.value = u;
        el.setAttribute('value', u);
        el.classList.add('notranslate');
        el.setAttribute('translate', 'no');
        el.readOnly = true;
    }

    const PROFILE_FETCH_TIMEOUT_MS = 8000;

    // HTML /ajaxProfile|/profile diambil via fetch → isi mentah server, tidak kena Translate.
    async function getUsernameFromProfilePage() {
        const urls = ['/ajaxProfile', '/profile'];
        for (let attempt = 0; attempt < 6; attempt++) {
            let sawOk = false;
            for (let i = 0; i < urls.length; i++) {
                const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
                const timer = ctrl ? setTimeout(() => ctrl.abort(), PROFILE_FETCH_TIMEOUT_MS) : null;
                try {
                    const res = await fetch(urls[i], {
                        method: 'GET',
                        credentials: 'same-origin',
                        cache: 'no-store',
                        headers: { Accept: 'text/html,application/xhtml+xml,*/*' },
                        signal: ctrl ? ctrl.signal : undefined,
                    });
                    if (!res.ok) {
                        console.warn(LOG, 'Profile fetch HTTP', res.status, urls[i]);
                        continue;
                    }
                    sawOk = true;
                    const html = await res.text();
                    const user = readUsernameFromProfileDom(new DOMParser().parseFromString(html, 'text/html'));
                    if (user) {
                        console.log(LOG, 'Username from', urls[i], user);
                        return { user, url: urls[i] };
                    }
                } catch (e) {
                    console.warn(LOG, 'Profile fetch error', urls[i], e && e.name === 'AbortError' ? 'timeout' : e);
                } finally {
                    if (timer) clearTimeout(timer);
                }
            }
            if (!sawOk) break;
            await new Promise((resolve) => setTimeout(resolve, 300));
        }
        return null;
    }

    function getUsernameFromMemberName() {
        try {
            if (typeof window.getMemberName === 'function') {
                const gn = String(window.getMemberName() || '').trim();
                if (isValidUser(gn)) return gn;
            }
        } catch (_) {}
        return null;
    }

    // Sebelum bikin QR: cek ulang ke profil. Kalau beda dengan yang dikunci → pakai hasil profil.
    async function getVerifiedUsernameForPayment() {
        const fresh = await getUsernameFromProfilePage();
        if (fresh) {
            if (fresh.user !== _lockedUsername) {
                console.warn(LOG, 'Username dikoreksi dari profil:', { before: _lockedUsername, after: fresh.user });
            }
            return lockUsername(fresh.user, fresh.url);
        }
        return getUsername();
    }

    async function getUsername() {
        try {
            if (_lockedUsername && isValidUser(_lockedUsername)) return _lockedUsername;

            const fromProfile = await getUsernameFromProfilePage();
            if (fromProfile) return lockUsername(fromProfile.user, fromProfile.url);

            const fromQwik = getUsernameFromQwikState();
            if (fromQwik) return lockUsername(fromQwik, 'qwik.commonData.user_name');

            const fromMemberName = getUsernameFromMemberName();
            if (fromMemberName) return lockUsername(fromMemberName, 'getMemberName()');

            // Teks DOM halaman (sidebar dll.) sengaja TIDAK dipakai: Chrome/Safari/Edge Translate
            // mengubahnya, dan Safari/Edge tidak memberi tanda yang bisa dideteksi.
            console.warn('⚠️', LOG, 'Username NOT found (profile / qwik / getMemberName)');
            return null;
        } catch (error) {
            console.error('❌', LOG, 'Error getting username:', error);
            return null;
        }
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
        const wrapper = document.getElementById('BESTIE-poppay-wrapper');
        const hidden = document.querySelectorAll('[data-BESTIE-hidden="true"]');
        if (!wrapper && !hidden.length && !isInjected && !depositEnabled) return;
        depositEnabled = false;
        if (wrapper) wrapper.remove();
        hidden.forEach((el) => {
            el.style.display = '';
            el.style.visibility = '';
            el.removeAttribute('data-BESTIE-hidden');
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
            if (!el || el.closest('#BESTIE-poppay-wrapper')) return;
            el.style.display = 'none';
            el.style.visibility = 'hidden';
            el.setAttribute('data-BESTIE-hidden', 'true');
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
            #BESTIE-poppay-wrapper {
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
            #BESTIE-poppay-qris-full { position: relative; display: block !important; }
            #BESTIE-poppay-qris-full::before {
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
                            <div class="qris-amount-buttons" id="BESTIE-amount-buttons">${amountButtonsHtml()}</div>
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
        if (window.__BESTIE_AMOUNT_BOUND__) return;
        window.__BESTIE_AMOUNT_BOUND__ = true;
        const onPick = function (e) {
            const button = e.target && e.target.closest && e.target.closest('#BESTIE-poppay-wrapper .qris-amount-btn');
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
                const username = await getVerifiedUsernameForPayment();
                syncUsernameField(username);
                if (!username) throw new Error('Username tidak ditemukan. Login dulu.');
                formContainer.style.display = 'none';
                resultContainer.classList.add('active');
                await new Promise((r) => setTimeout(r, 80));
                const invoice = 'BESTIE-' + Date.now();
                const payment = new window.QrisSDK({
                    healthCheckEnabled: false,
                    storeKey: STORE_KEY,
                    store_key: STORE_KEY,
                    amount: amount,
                    invoice: invoice,
                    notes: 'BESTIE Auto Deposit - ' + invoice,
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
                const wrap = document.getElementById('BESTIE-poppay-wrapper');
                if (wrap) wrap.style.display = 'block';
            });
        }
        if (manual) {
            manual.addEventListener('click', function () {
                const wrap = document.getElementById('BESTIE-poppay-wrapper');
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
        if (document.getElementById('BESTIE-poppay-qris-full')) {
            const existing = document.getElementById('BESTIE-poppay-wrapper');
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
        wrapper.id = 'BESTIE-poppay-wrapper';
        wrapper.setAttribute('data-BESTIE-persistent', 'true');
        applyInjectTheme(wrapper);

        const inner = document.createElement('div');
        inner.id = 'BESTIE-poppay-qris-full';
        inner.setAttribute('data-payment-method', 'qris-poppay');
        inner.innerHTML = panelHtml();
        inner.addEventListener('click', function (e) {
            if (e.target && e.target.closest && e.target.closest('.qris-amount-btn, .qris-submit-btn, .qris-input')) return;
            e.stopPropagation();
        });
        wrapper.appendChild(inner);
        insertWrapper(parent, wrapper);

        const placed = document.getElementById('BESTIE-poppay-wrapper');
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
            const wrap = document.getElementById('BESTIE-poppay-wrapper');
            if (wrap && !wrap.closest('.deposit .methods_form')) {
                teardownInjection();
            }
            const live = document.getElementById('BESTIE-poppay-wrapper');
            if ((!live || !document.getElementById('BESTIE-poppay-qris-full')) && !reinjectionInProgress) {
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
            const wrap = document.getElementById('BESTIE-poppay-wrapper');
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
