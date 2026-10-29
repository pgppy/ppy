// ============================================================================
// RajaBM / 3mplay QRIS POPPAY inject — qqmamibet.js (QQMamiBet / qqmamibet29.vip)
// Basis mamibet.js 1.0.0 (kingbet.js → bidadari.js 1.0.1, 3mplay Laravel) — tema terang QQMamiBet
// Invoice: QQMAMI-<acak> (huruf besar + angka)
// Laravel 3mplay deposit UI — any domain, path /account/deposit only
// SDK: https://unpkg.com/@poppackage/pg-ppy-sdk@1.0.0/dist/qris-sdk.umd.js
// Health: GET https://payment.pg-poppay.com/api/payment-health-v2 (+ X-Store-Key)
// Embed:
// <script src=".../qqmamibet.js?store_key=sk_xxx&min_depo=10000&max_depo=10000000&buttons=10000,50000,100000,200000,500000,1000000"></script>
// Username: GET /ajaxProfile → /profile (retry 300ms, timeout 8s); hanya nilai berlabel "Nama pengguna"/"Username"
//   (kebal Translate, sama di desktop & mobile); teks DOM tidak dipakai; kandidat bentrok ditolak; cek ulang profil sebelum QR
// Inject: hanya /account/deposit, grup paling atas di .deposit .methods_form (QQQQMamiBet tidak punya #qrisauto)
// ============================================================================

(function () {
    'use strict';

    const LOG = '[QQMAMI-QRIS]';
    const VERSION = '1.0.0';

    if (window.__QQMAMI_QRIS_BOOTED__ === VERSION) {
        console.log(LOG, 'already booted', VERSION);
        return;
    }
    window.__QQMAMI_QRIS_BOOTED__ = VERSION;

    console.log('🚀', LOG, 'Starting qqmamibet', VERSION);

    window.qqmamibetSetAmount = function (amount, button) {
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
        AMOUNT_BUTTONS: [10000, 50000, 100000, 200000, 500000, 1000000],
        MAX_RETRIES: 24,
        RETRY_DELAY: 400,
        IS_MOBILE: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent),
    };

    // Key privat: jangan pakai __BESTIE_LOCKED_USERNAME__ lama yang bisa berisi hasil scrape DOM ter-Translate.
    const LOCK_KEY = '__QQMAMI_QRIS_USER__';
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
                /qqmamibet\.js(\?|$)|atlas98?\.js(\?|$)|bestie\.js(\?|$)|BESTIEv[0-9]+\.js(\?|$)|rajabm(?:_qris)?\.js(\?|$)|rbmv[0-9]+\.js(\?|$)/i.test(url)
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
        const src = raw || window.QQMAMI_AMOUNT_BUTTONS || window.BESTIE_AMOUNT_BUTTONS || '';
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
        getParamFromCurrentScript('min_depo') || window.QQMAMI_MIN_DEPO || window.BESTIE_MIN_DEPO,
        CONFIG.MIN_AMOUNT
    );
    CONFIG.MAX_AMOUNT = parseAmountParam(
        getParamFromCurrentScript('max_depo') || window.QQMAMI_MAX_DEPO || window.BESTIE_MAX_DEPO,
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
            `<button type="button" class="qris-amount-btn" data-amount="${n}" onclick="return window.qqmamibetSetAmount(${n}, this)">${formatRpLabel(n)}</button>`
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
        const wrapper = document.getElementById('QQMAMI-poppay-wrapper');
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

    // QQQQMamiBet live (tema terang): body #FFFFFF teks #000, garis kotak hitam 1px,
    // aksen emas #FDB813 (logo, tab aktif), navy #013B7A (menu, tombol KELUAR, item bank),
    // input rgba(0,8,34,.3) radius 4px, font Montserrat.
    const THEME_MONEY = {
        bg: 'transparent',
        bgDeep: 'rgba(0, 8, 34, 0.12)',
        text: '#000000',
        muted: 'rgba(0, 0, 0, 0.65)',
        accent: '#013B7A',
        accentHover: '#FDB813',
        accentText: '#FFFFFF',
        border: '#000000',
        btnBg: '#FFFFFF',
        chipText: '#013B7A',
        chipBorder: '#013B7A',
        gold: '#FDB813',
        badgeBg: 'rgba(253, 184, 19, 0.22)',
        successBg: 'rgba(253, 184, 19, 0.18)',
        shadow: 'none',
    };

    function getInjectTheme() {
        return Object.assign({}, THEME_MONEY);
    }

    function applyInjectTheme(wrapper, theme) {
        const t = theme || getInjectTheme();
        const map = {
            '--qq-text': t.text,
            '--qq-muted': t.muted,
            '--qq-accent': t.accent,
            '--qq-accent-hover': t.accentHover,
            '--qq-accent-text': t.accentText,
            '--qq-border': t.border,
            '--qq-input-bg': t.bgDeep,
            '--qq-chip-bg': t.btnBg,
            '--qq-chip-text': t.chipText,
            '--qq-chip-border': t.chipBorder,
            '--qq-gold': t.gold,
            '--qq-success-bg': t.successBg,
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
            if (!el || el.closest('#QQMAMI-poppay-wrapper')) return;
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
        const W = '#QQMAMI-poppay-wrapper';
        return `
            ${W} {
                position: relative !important;
                z-index: 0 !important;
                display: block !important;
                width: 100%;
                margin: 0 0 10px !important;
                font-family: inherit;
                color: var(--qq-text);
            }
            ${W} *, ${W} *::before, ${W} *::after { box-sizing: border-box; }
            #QQMAMI-poppay-qris-full { position: relative; display: block !important; }
            ${W} .qq-qris-box {
                display: flex;
                align-items: stretch;
                border: 1px solid var(--qq-border);
                background: transparent;
                color: var(--qq-text);
                padding: 0;
                width: 100%;
            }
            ${W} .qq-qris-title {
                flex: 0 0 25%;
                max-width: 25%;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                text-align: center;
                padding: 14px 15px;
                font-weight: 700;
                text-transform: uppercase;
                line-height: 1.35;
                color: var(--qq-text);
            }
            ${W} .qq-qris-title .qq-qris-tag {
                display: inline-block;
                margin-top: 6px;
                padding: 2px 8px;
                border-radius: 4px;
                background: var(--qq-accent);
                color: var(--qq-accent-text);
                font-size: 11px;
                letter-spacing: 0.04em;
            }
            ${W} .qq-qris-body {
                flex: 1 1 auto;
                min-width: 0;
                padding: 14px 15px 16px;
            }
            ${W} .qq-qris-sub {
                margin: 0 0 12px;
                color: var(--qq-muted);
                font-size: 13px;
                line-height: 1.4;
            }
            ${W} .qris-form .form-group { margin: 0 0 12px; }
            ${W} .qris-form label {
                display: block;
                margin: 0 0 6px;
                color: var(--qq-text);
                font-weight: 700;
                font-size: 14px;
            }
            ${W} #depositUsernameAutoQris,
            ${W} .qris-input {
                width: 100%;
                height: 38px;
                padding: 6px 12px;
                border: 1px solid var(--qq-input-bg);
                border-radius: 4px;
                background: var(--qq-input-bg);
                color: var(--qq-text);
                font-family: inherit;
                font-size: 15px;
                font-weight: 600;
                box-shadow: none;
                outline: none;
            }
            ${W} .qris-input::placeholder { color: rgba(0, 0, 0, 0.5); font-weight: 400; }
            ${W} .qris-input:focus { border-color: var(--qq-accent-hover); }
            ${W} .qris-amount-buttons {
                display: flex;
                flex-wrap: wrap;
                gap: 8px 10px;
                margin: 0 0 10px;
            }
            ${W} button.qris-amount-btn,
            ${W} .qris-amount-btn {
                position: relative;
                display: inline-flex;
                align-items: center;
                min-height: 34px;
                padding: 7px 12px 7px 26px;
                border: 1px solid var(--qq-chip-border) !important;
                border-radius: 6px;
                background: var(--qq-chip-bg) !important;
                color: var(--qq-chip-text) !important;
                font-family: inherit;
                font-size: 14px;
                font-weight: 600 !important;
                line-height: 1.2;
                cursor: pointer;
                pointer-events: auto !important;
                z-index: 1;
                -webkit-tap-highlight-color: transparent;
                touch-action: manipulation;
                transition: box-shadow 0.15s, transform 0.1s;
            }
            ${W} .qris-amount-btn::before {
                content: '';
                position: absolute;
                left: 9px;
                top: 50%;
                width: 10px;
                height: 10px;
                margin-top: -5px;
                border-radius: 50%;
                background: #b9b9b9;
                box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15);
            }
            ${W} .qris-amount-btn:hover { box-shadow: 0 0 0 2px var(--qq-accent-hover); }
            ${W} .qris-amount-btn.active {
                box-shadow: 0 0 0 2px var(--qq-accent);
            }
            ${W} .qris-amount-btn.active::before {
                background: #7ed321;
                box-shadow: 0 0 6px #7ed321;
            }
            ${W} .qris-amount-btn:active { transform: scale(0.98); }
            ${W} .qris-input-group { display: flex; width: 100%; }
            ${W} .qris-input-prefix {
                flex: 0 0 auto;
                display: flex;
                align-items: center;
                padding: 0 12px;
                border-radius: 4px 0 0 4px;
                background: var(--qq-accent);
                color: var(--qq-accent-text);
                font-weight: 700;
            }
            ${W} .qris-input-group .qris-input { border-radius: 0 4px 4px 0; }
            ${W} .qris-input-hint {
                display: block;
                margin-top: 6px;
                font-size: 12px;
                color: var(--qq-muted);
            }
            ${W} button.qris-submit-btn,
            ${W} .qris-submit-btn {
                width: 100%;
                height: 40px;
                margin-top: 4px;
                border: 1px solid transparent !important;
                border-radius: 5px;
                background: var(--qq-accent) !important;
                color: var(--qq-accent-text) !important;
                font-family: inherit;
                font-size: 15px;
                font-weight: 700 !important;
                letter-spacing: 0.03em;
                text-transform: uppercase;
                cursor: pointer;
            }
            ${W} .qris-submit-btn:hover { background: var(--qq-accent-hover) !important; }
            ${W} .qq-qris-title .qq-qris-tag { background: var(--qq-gold); color: #000; }
            ${W} .qris-submit-btn:disabled {
                background: rgba(0, 0, 0, 0.15) !important;
                color: rgba(0, 0, 0, 0.55) !important;
                cursor: not-allowed;
            }
            ${W} .qris-result { display: none; margin-top: 12px; }
            ${W} .qris-result.active { display: block; }
            ${W} .ug-qris-success-box {
                padding: 14px;
                border: 1px solid var(--qq-accent);
                background: var(--qq-success-bg);
                border-radius: 5px;
            }
            ${W} #qris-payment-frame { min-height: 400px; text-align: center; }
            @media (min-width: 768px) {
                ${W} .qris-amount-buttons {
                    display: grid;
                    grid-template-columns: repeat(3, minmax(0, 1fr));
                    gap: 8px;
                }
                ${W} button.qris-amount-btn,
                ${W} .qris-amount-btn {
                    justify-content: center;
                    padding: 7px 8px 7px 22px;
                    font-size: 13.5px;
                    white-space: nowrap;
                }
                ${W} .qris-amount-btn::before { left: 8px; }
            }
            @media (max-width: 767px) {
                ${W} .qq-qris-box { flex-direction: column; }
                ${W} .qq-qris-title {
                    flex: 0 0 auto;
                    max-width: none;
                    padding: 12px 15px 8px;
                }
                ${W} .qq-qris-body { padding: 4px 15px 16px; }
                ${W} .qq-qris-sub { text-align: center; }
                ${W} .qris-amount-buttons { gap: 8px; }
                ${W} button.qris-amount-btn,
                ${W} .qris-amount-btn {
                    flex: 1 1 calc(50% - 4px);
                    justify-content: center;
                }
            }
        `;
    }

    function panelHtml() {
        return `
            <style>${panelCss()}</style>
            <div class="qq-qris-box box-wrapper plr-15">
                <div class="qq-qris-title pay-title">
                    <div>QRIS Instant<br>(Otomatis)</div>
                    <span class="qq-qris-tag">Langsung Masuk</span>
                </div>
                <div class="qq-qris-body">
                    <p class="qq-qris-sub">Scan QR pakai DANA, OVO, GoPay, ShopeePay, LinkAja, atau m-banking. Saldo masuk otomatis tanpa konfirmasi.</p>
                    <div class="qris-form" id="qrisFormContainer">
                        <form id="formDepositAutoQris">
                            <input type="hidden" id="bankSelectAutoQris" value="QRIS">
                            <div class="form-group">
                                <label for="depositUsernameAutoQris">Username</label>
                                <input class="qris-input qris-username-readonly notranslate" type="text"
                                    id="depositUsernameAutoQris" name="username" value="" readonly tabindex="-1"
                                    translate="no" autocomplete="off" placeholder="Mendeteksi username...">
                            </div>
                            <div class="form-group">
                                <label>Jumlah Deposit</label>
                                <div class="qris-amount-buttons" id="BESTIE-amount-buttons">${amountButtonsHtml()}</div>
                                <div class="qris-input-group">
                                    <div class="qris-input-prefix">Rp</div>
                                    <input class="qris-input" type="text" id="depositShowAmountAutoQris" inputmode="numeric" placeholder="Atau ketik jumlah lain">
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
            const button = e.target && e.target.closest && e.target.closest('#QQMAMI-poppay-wrapper .qris-amount-btn');
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

    /** QQMAMI-<waktu base36><acak 6>, huruf besar + angka; unik per klik. */
    function makeInvoiceId() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let rand = '';
        try {
            const buf = new Uint32Array(6);
            window.crypto.getRandomValues(buf);
            for (let i = 0; i < buf.length; i++) rand += chars[buf[i] % chars.length];
        } catch (_) {
            for (let i = 0; i < 6; i++) rand += chars[Math.floor(Math.random() * chars.length)];
        }
        return 'QQMAMI-' + Date.now().toString(36).toUpperCase() + rand;
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
                const invoice = makeInvoiceId();
                const payment = new window.QrisSDK({
                    healthCheckEnabled: false,
                    storeKey: STORE_KEY,
                    store_key: STORE_KEY,
                    amount: amount,
                    invoice: invoice,
                    notes: 'QQMAMI Auto Deposit - ' + invoice,
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
                const wrap = document.getElementById('QQMAMI-poppay-wrapper');
                if (wrap) wrap.style.display = 'block';
            });
        }
        if (manual) {
            manual.addEventListener('click', function () {
                const wrap = document.getElementById('QQMAMI-poppay-wrapper');
                if (wrap) wrap.style.display = 'none';
            });
        }
        const methods = getDepositMethodsForm();
        if (!methods || methods.getAttribute('data-qqmamibet-tab-bound') === '1') return;
        methods.setAttribute('data-qqmamibet-tab-bound', '1');
        methods.addEventListener('click', function () {
            setTimeout(function () {
                const form = getDepositMethodsForm();
                if (!form || !isDepositPath()) return;
                let wrap = document.getElementById('QQMAMI-poppay-wrapper');
                if (wrap && !form.contains(wrap)) {
                    form.insertBefore(wrap, form.firstChild);
                }
                if (wrap) {
                    wrap.style.display = 'block';
                    hideNativeInstant();
                    return;
                }
                if (depositEnabled && !reinjectionInProgress) {
                    reinjectionInProgress = true;
                    injectPanel().finally(function () { reinjectionInProgress = false; });
                }
            }, 80);
        }, true);
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
        if (document.getElementById('QQMAMI-poppay-qris-full')) {
            const existing = document.getElementById('QQMAMI-poppay-wrapper');
            if (
                existing &&
                existing.getAttribute('data-qqmamibet-ver') === VERSION &&
                existing.closest('.deposit .methods_form')
            ) {
                hideNativeInstant();
                applyInjectTheme(existing);
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
        wrapper.id = 'QQMAMI-poppay-wrapper';
        wrapper.setAttribute('data-BESTIE-persistent', 'true');
        wrapper.setAttribute('data-qqmamibet-ver', VERSION);
        applyInjectTheme(wrapper);

        const inner = document.createElement('div');
        inner.id = 'QQMAMI-poppay-qris-full';
        inner.setAttribute('data-payment-method', 'qris-poppay');
        inner.innerHTML = panelHtml();
        inner.addEventListener('click', function (e) {
            if (e.target && e.target.closest && e.target.closest('.qris-amount-btn, .qris-submit-btn, .qris-input')) return;
            e.stopPropagation();
        });
        wrapper.appendChild(inner);
        insertWrapper(parent, wrapper);

        const placed = document.getElementById('QQMAMI-poppay-wrapper');
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
            const wrap = document.getElementById('QQMAMI-poppay-wrapper');
            if (wrap && !wrap.closest('.deposit .methods_form')) {
                teardownInjection();
            }
            const live = document.getElementById('QQMAMI-poppay-wrapper');
            if ((!live || !document.getElementById('QQMAMI-poppay-qris-full')) && !reinjectionInProgress) {
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
            const wrap = document.getElementById('QQMAMI-poppay-wrapper');
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
