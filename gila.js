// ============================================================================
// GILA138 / Robotaset QRIS PopPay — gila138.js
// Halaman: /bank/deposit (link-masukgila138.lol dan white-label Robotaset lain)
// Pola form: qqmamibet.js (PopPay QrisSDK, payment-health-v2)
// Invoice: GILA138-<acak>
// Username: window.__balanceScope + memberScope di HTML /bank/deposit (SSR Robotaset)
// Inject: paling atas .info-page-content atau sebelum #DepositForm
// SDK: https://unpkg.com/@poppackage/pg-ppy-sdk@1.0.0/dist/qris-sdk.umd.js
// Embed:
// <script src=".../gila138.js?store_key=sk_xxx&min_depo=10000&max_depo=10000000&buttons=10000,50000,100000,200000,500000,1000000"></script>
// ============================================================================

(function () {
    'use strict';

    const LOG = '[GILA138-QRIS]';
    const VERSION = '1.0.4';

    if (window.__GILA138_QRIS_BOOTED__ === VERSION) {
        console.log(LOG, 'already booted', VERSION);
        return;
    }
    window.__GILA138_QRIS_BOOTED__ = VERSION;

    console.log('🚀', LOG, 'Starting gila138', VERSION);

    window.gila138SetAmount = function (amount, button) {
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

    const LOCK_KEY = '__GILA138_QRIS_USER__';
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
    let lastHealthLogged = null;

    function logHealthState(ok) {
        if (lastHealthLogged === ok) return;
        lastHealthLogged = ok;
        console.log(ok ? 'DEPOSIT HEALTH ON' : 'DEPOSIT HEALTH OFF');
    }
    let handlersAttached = false;
    let isInjected = false;
    let reinjectionInProgress = false;
    let depositEnabled = false;

    function getParamFromCurrentScript(name) {
        try {
            const current = document.currentScript;
            const scripts = Array.from(document.querySelectorAll('script[src]')).map((s) => s.src).reverse();
            const named = current?.src || scripts.find((url) =>
                /gila138(?:_qris)?\.js(\?|$)|masukgila138\.js(\?|$)|qqmamibet\.js(\?|$)/i.test(url)
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

    // Prod: health + store_key wajib. Override hanya ?skip_health=1 atau flag review CDP (bukan embed prod)
    const SKIP_STORE_KEY = (
        getParamFromCurrentScript('skip_health') === '1' ||
        window.__GILA138_SKIP_HEALTH_REVIEW__ === true
    );
    const STORE_KEY = (
        getParamFromCurrentScript('store_key') ||
        window.PGSCRIPT_STORE_KEY ||
        'sk_rxn6ecg1h8jbsgheb4eqk45njovroqiq'
    ).trim();

    function parseAmountParam(v, fallback) {
        const n = parseInt(String(v == null ? '' : v).replace(/\D/g, ''), 10);
        return Number.isFinite(n) && n > 0 ? n : fallback;
    }

    function parseButtonList(raw) {
        const src = raw || window.GILA138_AMOUNT_BUTTONS || window.QQMAMI_AMOUNT_BUTTONS || '';
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
        getParamFromCurrentScript('min_depo') || window.GILA138_MIN_DEPO || window.QQMAMI_MIN_DEPO,
        CONFIG.MIN_AMOUNT
    );
    CONFIG.MAX_AMOUNT = parseAmountParam(
        getParamFromCurrentScript('max_depo') || window.GILA138_MAX_DEPO || window.QQMAMI_MAX_DEPO,
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
            `<button type="button" class="qris-amount-btn" data-amount="${n}" onclick="return window.gila138SetAmount(${n}, this)">${formatRpLabel(n)}</button>`
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

    // Robotaset baru: __balanceScope / memberScope sering token internal (bukan login).
    function looksLikeInternalScope(text) {
        const t = String(text || '').trim();
        if (!t) return true;
        if (t.length >= 18) return true;
        const caps = (t.match(/[A-Z]/g) || []).length;
        if (caps >= 3 && /[a-z]/.test(t) && t.length >= 14) return true;
        return false;
    }

    function getUsernameFromRobotasetGreeting(doc) {
        const root = doc || document;
        if (!root || !root.querySelector) return null;
        const haiRe = /Hai,?\s*([a-zA-Z0-9_]{3,24})\b/i;
        const scopes = [
            '#header-profile',
            '.login-after',
            '.after-login',
            '.member-info',
            '.user-detail',
            '.nav-right',
            'header',
            '.navbar',
        ];
        for (let i = 0; i < scopes.length; i++) {
            const nodes = root.querySelectorAll(scopes[i]);
            for (let j = 0; j < nodes.length; j++) {
                const m = String(nodes[j].textContent || '')
                    .replace(/\s+/g, ' ')
                    .match(haiRe);
                if (m && isValidUser(m[1]) && !looksLikeInternalScope(m[1])) return m[1];
            }
        }
        return null;
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
        if (!u || !isValidUser(u) || looksLikeInternalScope(u)) return null;
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
    function readUsernameFromRobotasetHtml(html) {
        const text = String(html || '');
        const pick = (raw) => {
            const u = String(raw || '').trim();
            return isValidUser(u) && !looksLikeInternalScope(u) ? u : null;
        };
        const patterns = [
            /memberName\s*=\s*String\(\s*'([a-zA-Z0-9_]{3,24})'/,
            /loginName\s*=\s*String\(\s*'([a-zA-Z0-9_]{3,24})'/,
            /Hai,?\s*([a-zA-Z0-9_]{3,24})/i,
            /memberScope\s*=\s*String\(\s*'([a-zA-Z0-9_]{3,24})'/,
            /window\.__balanceScope\s*=\s*["']([a-zA-Z0-9_]{3,24})["']/,
            /__balanceScope\s*=\s*["']([a-zA-Z0-9_]{3,24})["']/,
        ];
        for (let i = 0; i < patterns.length; i++) {
            const m = text.match(patterns[i]);
            const u = m && pick(m[1]);
            if (u) return u;
        }
        try {
            const parsed = new DOMParser().parseFromString(text, 'text/html');
            return getUsernameFromRobotasetGreeting(parsed);
        } catch (_) {
            return null;
        }
    }

    function getUsernameFromBalanceScope() {
        const scope = (window.__balanceScope || '').toString().trim();
        if (!isValidUser(scope) || looksLikeInternalScope(scope)) return null;
        return scope;
    }

    async function getUsernameFromProfilePage() {
        const liveScope = getUsernameFromBalanceScope();
        if (liveScope) return { user: liveScope, url: '__balanceScope' };

        const urls = ['/bank/deposit', '/'];
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
                    const fromRs = readUsernameFromRobotasetHtml(html);
                    if (fromRs) {
                        console.log(LOG, 'Username from', urls[i], fromRs);
                        return { user: fromRs, url: urls[i] };
                    }
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
            if (
                _lockedUsername &&
                isValidUser(_lockedUsername) &&
                !looksLikeInternalScope(_lockedUsername)
            ) {
                return _lockedUsername;
            }
            if (_lockedUsername && looksLikeInternalScope(_lockedUsername)) {
                console.warn(LOG, 'Unlock scope token salah:', _lockedUsername);
                _lockedUsername = null;
            }

            const fromMemberName = getUsernameFromMemberName();
            if (fromMemberName) return lockUsername(fromMemberName, 'getMemberName()');

            const fromGreeting = getUsernameFromRobotasetGreeting(document);
            if (fromGreeting) return lockUsername(fromGreeting, 'robotaset-greeting');

            const fromProfile = await getUsernameFromProfilePage();
            if (fromProfile && !looksLikeInternalScope(fromProfile.user)) {
                return lockUsername(fromProfile.user, fromProfile.url);
            }

            const fromQwik = getUsernameFromQwikState();
            if (fromQwik && !looksLikeInternalScope(fromQwik)) {
                return lockUsername(fromQwik, 'qwik.commonData.user_name');
            }

            console.warn('⚠️', LOG, 'Username NOT found (getMemberName / greeting / profile)');
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
            logHealthState(true);
            return true;
        }
        if (!STORE_KEY) {
            console.log('[Deposit is disabled]');
            console.warn('❌', LOG, 'store_key missing — tambahkan ?store_key=... di script src');
            depositEnabled = false;
            logHealthState(false);
            teardownInjection();
            return false;
        }
        const now = Date.now();
        if (
            paymentHealthCache !== null &&
            paymentHealthCacheKey === STORE_KEY &&
            (now - paymentHealthCacheAt) < PAYMENT_HEALTH_CACHE_TTL_MS
        ) {
            depositEnabled = !!paymentHealthCache;
            logHealthState(depositEnabled);
            if (!paymentHealthCache) teardownInjection();
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
                logHealthState(false);
                teardownInjection();
                return false;
            }
            console.log('✅', LOG, 'payment-health OK');
            paymentHealthCache = true;
            paymentHealthCacheKey = STORE_KEY;
            paymentHealthCacheAt = now;
            depositEnabled = true;
            logHealthState(true);
            return true;
        } catch (err) {
            console.log('[Deposit is disabled]');
            console.warn('❌', LOG, 'payment-health failed:', err && err.message);
            paymentHealthCache = false;
            paymentHealthCacheKey = STORE_KEY;
            paymentHealthCacheAt = now;
            depositEnabled = false;
            logHealthState(false);
            teardownInjection();
            return false;
        }
    }

    function teardownInjection() {
        const wrapper = document.getElementById('GILA138-poppay-wrapper');
        const hidden = document.querySelectorAll('[data-BESTIE-hidden="true"]');
        if (!wrapper && !hidden.length && !isInjected && !depositEnabled) return;
        depositEnabled = false;
        if (wrapper) wrapper.remove();
        document.querySelectorAll('[data-GILA138-hidden="true"]').forEach((el) => {
            el.style.display = '';
            el.style.visibility = '';
            el.removeAttribute('data-GILA138-hidden');
        });
        hidden.forEach((el) => {
            el.style.display = '';
            el.style.visibility = '';
            el.removeAttribute('data-BESTIE-hidden');
        });
        isInjected = false;
        handlersAttached = false;
        console.log(LOG, 'Injection dihapus');
    }

    // GILA138 — aksen merah/gold Robotaset
    const THEME_MONEY = {
        bg: '#ffffff',
        bgDeep: '#f5f5f5',
        text: '#31353b',
        muted: 'rgba(49, 53, 59, 0.72)',
        accent: '#c41e3a',
        accentHover: '#e11d48',
        accentText: '#ffffff',
        border: 'rgba(49, 53, 59, 0.12)',
        btnBg: '#ffffff',
        chipText: '#31353b',
        chipBorder: 'rgba(49, 53, 59, 0.22)',
        gold: '#fbbf24',
        badgeBg: 'rgba(251, 191, 36, 0.22)',
        successBg: 'rgba(16, 196, 105, 0.12)',
        shadow: 'rgb(49 53 59 / 12%) 0 1px 6px 0',
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
            '--qq-card-shadow': t.shadow,
        };
        Object.keys(map).forEach((k) => wrapper.style.setProperty(k, map[k]));
    }

    function isPreviewFixture() {
        return (
            getParamFromCurrentScript('preview_fixture') === '1' ||
            window.__GILA138_FIXTURE__ === true
        );
    }

    function isDepositPath() {
        if (isPreviewFixture()) return true;
        const path = (location.pathname || '').replace(/\/+$/, '').toLowerCase();
        return path === '/bank/deposit';
    }

    function isLoggedInDeposit() {
        if (document.getElementById('HeaderLoginForm')) return false;
        if (document.getElementById('DepositForm')) return true;
        const info = document.querySelector('.info-page-content');
        if (!info) return false;
        const empty = (info.getAttribute('data-empty') || '').toLowerCase() === 'true';
        return !empty;
    }

    function getDepositMethodsForm() {
        return document.querySelector('.info-page-content, #DepositForm, .payment-cardbox');
    }

    function isOnDepositPage() {
        if (!isDepositPath()) return false;
        if (!isLoggedInDeposit()) return false;
        return !!(document.getElementById('DepositForm') || document.querySelector('.info-page-content'));
    }

    function findStableContainer() {
        if (!isDepositPath()) {
            console.warn('⚠️', LOG, 'skip: bukan /bank/deposit');
            return null;
        }
        const host = document.querySelector('.info-page-content')
            || document.getElementById('DepositForm')?.closest('.container')
            || document.querySelector('.payment-cardbox')?.parentElement;
        if (host) {
            console.log('✅', LOG, 'container: Robotaset deposit host');
            return host;
        }
        console.warn('⚠️', LOG, 'container deposit belum ada');
        return null;
    }

    function hideNativeInstant() {
        document.querySelectorAll('.qris-dp-note').forEach((el) => {
            if (el.closest('#GILA138-poppay-wrapper')) return;
            el.style.display = 'none';
            el.style.visibility = 'hidden';
            el.setAttribute('data-GILA138-hidden', 'true');
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
        const W = '#GILA138-poppay-wrapper';
        return `
            ${W} {
                position: relative !important;
                z-index: 2 !important;
                display: block !important;
                flex: 0 0 100% !important;
                flex-basis: 100% !important;
                width: 100% !important;
                max-width: 100% !important;
                margin: 0 auto 14px !important;
                padding: 0 !important;
                font-family: inherit;
                color: #31353b !important;
                clear: both !important;
                float: none !important;
                background: transparent !important;
                border: none !important;
                box-shadow: none !important;
            }
            ${W} #GILA138-poppay-qris-full {
                display: flex !important;
                justify-content: center !important;
                width: 100%;
            }
            ${W} *, ${W} *::before, ${W} *::after { box-sizing: border-box; }
            ${W} .gila138-qris-card {
                position: relative;
                display: block !important;
                width: 100% !important;
                max-width: 400px;
                margin: 0 auto;
                padding: 0 !important;
                border-radius: 8px !important;
                border: 1px solid rgba(49, 53, 59, 0.08) !important;
                background: #fff !important;
                box-shadow: var(--qq-card-shadow, rgb(49 53 59 / 12%) 0 1px 6px 0) !important;
                overflow: hidden;
                float: none !important;
                color: #31353b !important;
            }
            ${W} .gila138-qris-card,
            ${W} .gila138-qris-card .qris-form,
            ${W} .gila138-qris-card label,
            ${W} .gila138-qris-card p,
            ${W} .gila138-qris-card h3,
            ${W} .gila138-qris-card small {
                color: #31353b !important;
            }
            ${W} .gila138-qris-sub,
            ${W} .gila138-qris-card .qris-input-hint {
                color: #5c6370 !important;
            }
            ${W} .gila138-qris-head {
                padding: 14px 16px 10px;
                text-align: center;
                border-bottom: 1px solid var(--qq-border);
                background: linear-gradient(180deg, #fff 0%, #fafafa 100%);
            }
            ${W} .gila138-qris-title {
                margin: 0;
                font-size: 16px;
                font-weight: 700;
                text-transform: uppercase;
                letter-spacing: 0.04em;
                line-height: 1.3;
                color: var(--qq-text);
            }
            ${W} .gila138-qris-tag {
                display: inline-block;
                margin-top: 6px;
                padding: 3px 10px;
                border-radius: 999px;
                background: var(--qq-gold);
                color: #1a0a0a;
                font-size: 11px;
                font-weight: 700;
                letter-spacing: 0.04em;
            }
            ${W} .gila138-qris-body {
                padding: 14px 16px 16px;
            }
            ${W} .gila138-qris-sub {
                margin: 0 0 14px;
                color: var(--qq-muted);
                font-size: 12.5px;
                line-height: 1.45;
                text-align: center;
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
                height: 40px;
                padding: 6px 12px;
                border: 1px solid #ccc !important;
                border-radius: 3px;
                background: #fff !important;
                color: var(--qq-text) !important;
                font-family: inherit;
                font-size: 14px;
                font-weight: 600;
                line-height: 1.3;
                box-shadow: none;
                outline: none;
                -webkit-appearance: none;
            }
            ${W} .qris-input::placeholder { color: #999; font-weight: 400; }
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
                ${W} {
                    padding: 0 8px !important;
                    margin-bottom: 12px !important;
                }
                #GILA138-poppay-qris-full,
                ${W} .gila138-qris-card { max-width: none; }
                ${W} .gila138-qris-head { padding: 12px 14px 8px; }
                ${W} .gila138-qris-body { padding: 12px 14px 14px; }
                ${W} .gila138-qris-title { font-size: 15px; }
                ${W} .gila138-qris-sub { font-size: 12px; }
                ${W} .qris-amount-buttons {
                    gap: 8px;
                    display: grid;
                    grid-template-columns: repeat(2, minmax(0, 1fr));
                }
                ${W} button.qris-amount-btn,
                ${W} .qris-amount-btn {
                    width: 100%;
                    justify-content: center;
                    font-size: 13px;
                }
            }
        `;
    }

    function panelHtml() {
        return `
            <style>${panelCss()}</style>
            <div class="gila138-qris-card">
                <div class="gila138-qris-head">
                    <h3 class="gila138-qris-title">QRIS Instant</h3>
                    <span class="gila138-qris-tag">Auto Masuk</span>
                </div>
                <div class="gila138-qris-body">
                    <p class="gila138-qris-sub">Scan QR pakai DANA, OVO, GoPay, ShopeePay, LinkAja, atau m-banking. Saldo masuk otomatis tanpa konfirmasi.</p>
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
        if (!parent || !isDepositPath()) {
            console.warn('⚠️', LOG, 'insert dibatalkan — host deposit tidak valid');
            return;
        }
        // Selalu baris penuh di dalam .info-page-content — jangan di flex sibling #DepositForm
        const info = document.querySelector('.info-page-content');
        if (info) {
            info.insertBefore(wrapper, info.firstChild);
            return;
        }
        const form = document.getElementById('DepositForm');
        if (form && form.parentElement) {
            form.parentElement.insertBefore(wrapper, form);
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
            const button = e.target && e.target.closest && e.target.closest('#GILA138-poppay-wrapper .qris-amount-btn');
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
        return 'GILA138-' + Date.now().toString(36).toUpperCase() + rand;
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
                    notes: 'GILA138 Auto Deposit - ' + invoice,
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
        const host = getDepositMethodsForm();
        if (!host || host.getAttribute('data-gila138-bound') === '1') return;
        host.setAttribute('data-gila138-bound', '1');
        const transfer = document.getElementById('TransferTo');
        if (transfer) {
            transfer.addEventListener('change', function () {
                setTimeout(function () {
                    hideNativeInstant();
                    const wrap = document.getElementById('GILA138-poppay-wrapper');
                    if (wrap) wrap.style.display = 'block';
                }, 80);
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
        if (document.getElementById('GILA138-poppay-qris-full')) {
            const existing = document.getElementById('GILA138-poppay-wrapper');
            if (
                existing &&
                existing.getAttribute('data-gila138-ver') === VERSION &&
                isDepositPath()
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
        wrapper.id = 'GILA138-poppay-wrapper';
        wrapper.setAttribute('data-BESTIE-persistent', 'true');
        wrapper.setAttribute('data-gila138-ver', VERSION);
        applyInjectTheme(wrapper);

        const inner = document.createElement('div');
        inner.id = 'GILA138-poppay-qris-full';
        inner.setAttribute('data-payment-method', 'qris-poppay');
        inner.innerHTML = panelHtml();
        inner.addEventListener('click', function (e) {
            if (e.target && e.target.closest && e.target.closest('.qris-amount-btn, .qris-submit-btn, .qris-input')) return;
            e.stopPropagation();
        });
        wrapper.appendChild(inner);
        insertWrapper(parent, wrapper);

        const placed = document.getElementById('GILA138-poppay-wrapper');
        if (!placed || !isDepositPath()) {
            console.error('❌', LOG, 'Insert di luar halaman deposit — dibatalkan');
            teardownInjection();
            return false;
        }

        keepInstantTabActive();
        attachAmountButtons();
        setTimeout(attachHandlers, 50);
        setTimeout(attachHandlers, 250);
        console.log('✅', LOG, 'Injected into /bank/deposit');
        return true;
    }

    async function startPersistentInjection() {
        if (!isDepositPath()) {
            console.log(LOG, 'skip — hanya /bank/deposit');
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
            const wrap = document.getElementById('GILA138-poppay-wrapper');
            if (wrap && !isDepositPath()) {
                teardownInjection();
            }
            const live = document.getElementById('GILA138-poppay-wrapper');
            if ((!live || !document.getElementById('GILA138-poppay-qris-full')) && !reinjectionInProgress) {
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
            if (!depositEnabled || !isOnDepositPage() || reinjectionInProgress) {
                if (!depositEnabled && document.getElementById('GILA138-poppay-wrapper')) {
                    teardownInjection();
                }
                return;
            }
            const wrap = document.getElementById('GILA138-poppay-wrapper');
            if (wrap && !isDepositPath()) {
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
            console.log(LOG, 'skip — hanya /bank/deposit');
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
            console.log(LOG, 'skip — hanya /bank/deposit');
            return;
        }
        setTimeout(tryStart, 600);
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
