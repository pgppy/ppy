// ============================================================================
// SPEED ENGINE QRIS POPPAY INJECTION
// Adapted from ug_test_simple.js for speed.html / Sip69 deposit page
// BOB RESEARCH LABS - speednewv2.js (v1.4.0 — pg-ppy-sdk + payment-health-v2)
// Deposit hanya via Poppay webhook — tidak POST /services/deposits
// Target DOM: inject HANYA saat #deposit-qr-tab aktif (aria-selected)
// Tab bank/va/ewallet/pulsa → teardown Poppay, form native balik
//
// PERSIST (widget admin CUMA di INDEX):
// - Soft-nav ke /deposit → script mask URL jadi /?speed_rejoin=/deposit
// - User F5 → browser load INDEX (widget) → soft-nav balik ke deposit
// - Tanpa mask: F5 di /deposit = HTML tanpa script = Poppay hilang
//
// Embed di widget index:
//    <script src="https://cdn.jsdelivr.net/gh/pgppy/ppy@main/speednewv2.js?store_key=sk_xxx&min_depo=50000&max_depo=10000000"></script>
//    SDK: https://unpkg.com/@poppackage/pg-ppy-sdk@1.0.0/dist/qris-sdk.umd.js
//    Health: GET https://payment.pg-poppay.com/api/payment-health-v2 (+ X-Store-Key)
//    min_depo / max_depo opsional — kalau tidak diisi: default min 10.000 (10rb), max 10.000.000 (10jt)
//    atau PG_CONFIG: window.PG_CONFIG={STORE_KEY:'sk_xxx',MIN_DEPO:10000,MAX_DEPO:10000000}
// ============================================================================

(function () {
    'use strict';

    // Hindari double-load (userscript + embed)
    if (window.__SPEED_QRIS_INJECT_BOOTED__) {
        console.log('[SPEED-QRIS] Already booted — skip duplicate');
        return;
    }
    window.__SPEED_QRIS_INJECT_BOOTED__ = true;

    console.log('🚀 [SPEED-QRIS] Starting speednewv2 v1.4.0 (pg-ppy-sdk + payment-health-v2)...');

    // Sniff X-Data-Reference dari native Speed fetch/XHR (wajib untuk players/identity API)
    let _speedXRefSniffed = '';
    (function installSpeedNetworkSniffer() {
        if (window.__SPEED_NET_SNIFFER__) return;
        window.__SPEED_NET_SNIFFER__ = true;

        function rememberXRef(xref) {
            if (xref && /^[0-9a-f-]{36}$/i.test(String(xref).trim())) {
                _speedXRefSniffed = String(xref).trim();
            }
        }

        function sniffHeaders(headers) {
            if (!headers) return;
            if (headers instanceof Headers) {
                rememberXRef(headers.get('X-Data-Reference') || headers.get('x-data-reference'));
                return;
            }
            if (typeof headers === 'object') {
                rememberXRef(headers['X-Data-Reference'] || headers['x-data-reference']);
            }
        }

        const origFetch = window.fetch;
        window.fetch = function (...args) {
            try { sniffHeaders((args[1] || {}).headers); } catch (_) { }
            return origFetch.apply(this, args);
        };

        const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;
        XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
            if (/x-data-reference/i.test(String(name || ''))) rememberXRef(value);
            return origSetHeader.apply(this, arguments);
        };
    })();

    // Optional hardcoded config (override via ?store_key= or window.PGSCRIPT_STORE_KEY)
    window.PG_CONFIG = window.PG_CONFIG || {
        STORE_KEY: '',       // e.g. 'sk_xxxx'
        USERNAME: '',        // optional force username if auto-detect gagal
        SPEED_X_DATA_REFERENCE: '',  // kosong = auto (sniff + __NEXT_DATA__)
    };

    // true = skip payment-health / store_key gate (dev / test tanpa SK)
    const SKIP_STORE_KEY = false;
    // Setelah landing /deposit, otomatis klik tab QRIS biar UI Poppay muncul
    // false = jangan maksa ke tab QRIS; user klik sendiri baru inject
    const AUTO_SELECT_QRIS_TAB = false;
    // Widget admin cuma di INDEX: mask URL non-index → /?speed_rejoin=...
    // supaya F5 selalu load index (widget+script), lalu soft-nav balik.
    const MASK_URL_TO_INDEX = true;
    const REJOIN_PARAM = 'speed_rejoin';

    // ========================================================================
    // Global Amount Setter (Direct onclick - accessible from HTML)
    // Conversion: Display 20 → Backend 20000 (×1000)
    // ========================================================================
    window.speedSetAmount = function (amount, button) {
        console.log('[SPEED-QRIS] 💰 speedSetAmount called:', amount);

        try {
            const amountInput = document.getElementById('depositInputAutoQris');
            const amountDisplay = document.getElementById('depositShowAmountAutoQris');
            const amountHidden = document.getElementById('depositAmountAutoQris');

            if (!amountInput || !amountDisplay || !amountHidden) {
                console.error('[SPEED-QRIS] ❌ Elements not found!');
                return false;
            }

            document.querySelectorAll('.qris-amount-btn').forEach(btn => btn.classList.remove('active'));
            if (button) button.classList.add('active');

            // Input: plain small number (20)
            amountInput.value = parseInt(amount);
            // Display: formatted Rupiah (Rp 20.000)
            const rupiah = parseInt(amount) * 1000;
            amountDisplay.value = 'Rp ' + rupiah.toLocaleString('id-ID');
            // Hidden: SDK amount (20000)
            amountHidden.value = rupiah;

            console.log('[SPEED-QRIS] ✅ Input:', amount, '→ Display:', amountDisplay.value, '→ SDK:', amountHidden.value);
            return false;
        } catch (error) {
            console.error('[SPEED-QRIS] ❌ Error:', error);
            return false;
        }
    };
    // Keep ugSetAmount alias for shared HTML snippets
    window.ugSetAmount = window.speedSetAmount;

    // ========================================================================
    // Script URL params (?store_key= &min_depo= &max_depo=)
    // ========================================================================
    function getParamFromCurrentScript(name) {
        try {
            const current = document.currentScript;
            const scripts = Array.from(document.querySelectorAll('script[src]'))
                .map((s) => s.src)
                .reverse();
            const named = current?.src || scripts.find((url) =>
                /speed(?:newv2|newv1|new|jwt|v7|instantv4)?\.js(\?|$)|speed[_-]?qris[_-]?inject\.js(\?|$)|ug(script|instant|v2|1|test_simple)?\.js(\?|$)/i.test(url)
            );
            const src = named || scripts.find((url) => {
                try {
                    return !!new URL(url, window.location.href).searchParams.get('store_key');
                } catch (e) {
                    return false;
                }
            });
            if (!src) return null;
            const url = new URL(src, window.location.href);
            return url.searchParams.get(name);
        } catch (e) {
            return null;
        }
    }

    function parseDepositLimit(raw) {
        if (raw == null || raw === '') return null;
        const n = parseInt(String(raw).replace(/[^\d]/g, ''), 10);
        return Number.isFinite(n) && n > 0 ? n : null;
    }

    function resolveDepositLimit(paramNames, configKeys, windowKey, defaultValue) {
        for (const name of paramNames) {
            const fromUrl = parseDepositLimit(getParamFromCurrentScript(name));
            if (fromUrl != null) return fromUrl;
        }
        if (windowKey && window[windowKey] != null) {
            const fromWin = parseDepositLimit(window[windowKey]);
            if (fromWin != null) return fromWin;
        }
        const cfg = window.PG_CONFIG || {};
        for (const key of configKeys) {
            if (cfg[key] != null) {
                const fromCfg = parseDepositLimit(cfg[key]);
                if (fromCfg != null) return fromCfg;
            }
        }
        return defaultValue;
    }

    const CONVERSION_RATIO = 1000;
    const MIN_AMOUNT = resolveDepositLimit(
        ['min_depo', 'min_deposit', 'min_amount'],
        ['MIN_DEPO', 'MIN_DEPOSIT', 'MIN_AMOUNT'],
        'PGSCRIPT_MIN_DEPO',
        10000
    );
    const MAX_AMOUNT = resolveDepositLimit(
        ['max_depo', 'max_deposit', 'max_amount'],
        ['MAX_DEPO', 'MAX_DEPOSIT', 'MAX_AMOUNT'],
        'PGSCRIPT_MAX_DEPO',
        10000000
    );

    // ========================================================================
    // Configuration
    // ========================================================================
    const CONFIG = {
        MIN_AMOUNT,              // Backend Rupiah (10000 = Rp 10.000)
        MAX_AMOUNT,              // Backend Rupiah (10000000 = Rp 10.000.000)
        MIN_DISPLAY: Math.ceil(MIN_AMOUNT / CONVERSION_RATIO),
        MAX_DISPLAY: Math.floor(MAX_AMOUNT / CONVERSION_RATIO),
        MAX_RETRIES: 30,
        RETRY_DELAY: 500,
        IS_MOBILE: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent),
        INVOICE_PREFIX: 'SPEED-',
        REQUIRE_DEPOSIT_PAGE: true,
        CONVERSION_RATIO
    };

    if (MIN_AMOUNT !== 10000 || MAX_AMOUNT !== 10000000) {
        console.log('[SPEED-QRIS] deposit limits:', {
            min: MIN_AMOUNT,
            max: MAX_AMOUNT,
            minDisplay: CONFIG.MIN_DISPLAY,
            maxDisplay: CONFIG.MAX_DISPLAY
        });
    }

    /** Tombol cepat: hanya tampil yang >= min dan <= max (mis. min 20 → tombol 10 disembunyikan) */
    function getQuickAmountPresets() {
        const presets = [10, 20, 50, 100, 500];
        const min = CONFIG.MIN_DISPLAY;
        const max = CONFIG.MAX_DISPLAY;
        const merged = [...new Set([...presets, min])];
        return merged.filter((a) => a >= min && a <= max).sort((a, b) => a - b);
    }

    function renderQuickAmountButtons() {
        return getQuickAmountPresets()
            .map((a) => `<button type="button" class="qris-amount-btn" data-amount="${a}">${a}</button>`)
            .join('\n                                ');
    }

    if (CONFIG.IS_MOBILE) {
        console.log('📱 [SPEED-QRIS] Mobile device detected');
    }

    function isDepositPage() {
        const path = (window.location.pathname || '').toLowerCase();
        if (path.includes('/deposit')) return true;
        if (document.getElementById('deposit-amount')) return true;
        if (document.getElementById('deposit-desktop-tab')) return true;
        if (document.getElementById('deposit-qr-tab')) return true;
        if (document.getElementById('deposit-submit')) return true;
        return false;
    }

    /** Inject HANYA saat tab QRIS aktif (#deposit-qr-tab selected) */
    function isQRISTabActive() {
        const tab = document.getElementById('deposit-qr-tab');
        if (!tab) return false;
        if (tab.getAttribute('aria-selected') === 'true') return true;
        const state = (tab.getAttribute('data-headlessui-state') || '').toLowerCase();
        if (state.includes('selected')) return true;
        return false;
    }

    function hideNativeDepositFormOnQRIS() {
        // Sembunyikan form native Speed saat Poppay aktif (bukan tab / bukan ancestor Poppay)
        const amount = document.getElementById('deposit-amount');
        if (!amount) return;
        let formRoot = amount.closest('form');
        if (!formRoot) {
            formRoot =
                amount.closest('[class*="jsx-2877637026"]')?.parentElement ||
                amount.parentElement?.parentElement?.parentElement;
        }
        if (!formRoot || formRoot.id === 'ug-poppay-wrapper') return;
        const poppay = document.getElementById('ug-poppay-wrapper');
        if (poppay && formRoot.contains(poppay)) return; // jangan hide ancestor panel kita
        if (formRoot.getAttribute('data-speed-native-form') === 'true') return;
        formRoot.style.display = 'none';
        formRoot.setAttribute('data-poppay-hidden', 'true');
        formRoot.setAttribute('data-speed-native-form', 'true');
    }

    function showNativeDepositForm() {
        document.querySelectorAll('[data-speed-native-form="true"]').forEach((el) => {
            el.style.display = '';
            el.style.visibility = '';
            el.removeAttribute('data-poppay-hidden');
            el.removeAttribute('data-speed-native-form');
        });
    }

    // ========================================================================
    // Get Username — Speed Engine / Sip69 (session-locked, anti stale localStorage)
    // ========================================================================
    let _cachedUsername = '';
    const SPEED_EW_REFRESH_TOKEN_RE = /^__ew-912rt/i;
    const SPEED_UUID_RE = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
    let _speedXRefCache = '';

    const USERNAME_BLACKLIST = new Set([
        'wallet', 'saldo', 'profil', 'profile', 'deposit', 'withdraw',
        'referral', 'referal', 'promo', 'bonus', 'keluar', 'logout',
        'login', 'register', 'daftar', 'masuk', 'hai', 'dompet',
        'silver', 'gold', 'platinum', 'member', 'account', 'username',
        'sip69', 'pilih', 'kirim', 'transfer', 'bank', 'ewallet', 'qris',
        'null', 'undefined', 'true', 'false', 'desktop', 'mobile',
    ]);

    function isValidUsername(text) {
        if (!text) return false;
        const t = String(text).trim();
        if (t.length < 3 || t.length > 24) return false;
        if (!/^[a-zA-Z0-9_]+$/.test(t)) return false;
        if (USERNAME_BLACKLIST.has(t.toLowerCase())) return false;
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t)) return false;
        return true;
    }

    function parseCookieMap() {
        const out = {};
        (document.cookie || '').split(';').forEach((part) => {
            const idx = part.indexOf('=');
            if (idx <= 0) return;
            out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
        });
        return out;
    }

    function iterEwCookieEntries() {
        return Object.entries(parseCookieMap()).filter(([key]) => String(key).startsWith('__ew-'));
    }

    function decodeJwtPayload(token) {
        try {
            const parts = String(token || '').split('.');
            if (parts.length < 2) return null;
            const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
            const pad = b64.length % 4 ? '='.repeat(4 - (b64.length % 4)) : '';
            return JSON.parse(atob(b64 + pad));
        } catch (_) {
            return null;
        }
    }

    function isPlayerJwtPayload(payload) {
        return !!(payload && (payload.type === 'player' || payload.aud));
    }

    function findPlayerAuthToken() {
        const cookies = parseCookieMap();
        for (const key of ['__ew-id', '__ew-iusyc7162']) {
            const val = cookies[key];
            if (val && String(val).startsWith('eyJ') && isPlayerJwtPayload(decodeJwtPayload(val))) {
                return val;
            }
        }
        for (const [key, val] of iterEwCookieEntries()) {
            if (!/^__ew-i/i.test(key)) continue;
            if (!val || !String(val).startsWith('eyJ')) continue;
            if (isPlayerJwtPayload(decodeJwtPayload(val))) return val;
        }
        for (const [key, val] of iterEwCookieEntries()) {
            if (SPEED_EW_REFRESH_TOKEN_RE.test(key)) continue;
            if (!val || !String(val).startsWith('eyJ')) continue;
            if (isPlayerJwtPayload(decodeJwtPayload(val))) return val;
        }
        return null;
    }

    function findSpeedDeviceId() {
        for (const [key, val] of iterEwCookieEntries()) {
            if (/^__ew-/.test(key) && /^[a-f0-9]{32}$/i.test(val || '')) return val;
        }
        return null;
    }

    function getPlayerIdFromToken() {
        const payload = decodeJwtPayload(findPlayerAuthToken());
        return payload?.aud || payload?.sub || null;
    }

    function getUsernameFromOverride() {
        const forced = (
            window.SPEED_USERNAME ||
            window.PGSCRIPT_USERNAME ||
            (window.PG_CONFIG && window.PG_CONFIG.USERNAME) ||
            ''
        ).toString().trim();
        return isValidUsername(forced) ? forced : null;
    }

    function getUsernameFromEwUsCookie() {
        try {
            const cookies = parseCookieMap();
            const fixed = cookies['__ew-us'];
            if (fixed && !String(fixed).startsWith('eyJ')) {
                const u = decodeURIComponent(String(fixed).trim());
                if (isValidUsername(u)) return u;
            }
            for (const [key, val] of iterEwCookieEntries()) {
                if (key === '__ew-us' || !/^__ew-u/i.test(key)) continue;
                if (!val || String(val).startsWith('eyJ')) continue;
                const u = decodeURIComponent(String(val).trim());
                if (isValidUsername(u)) return u;
            }
        } catch (_) { }
        return null;
    }

    function getUsernameFromAuthToken() {
        try {
            const token = findPlayerAuthToken();
            if (!token) return null;
            const payload = decodeJwtPayload(token);
            if (!isPlayerJwtPayload(payload)) return null;
            for (const field of ['username', 'user_name', 'preferred_username']) {
                if (isValidUsername(payload[field])) return payload[field];
            }
        } catch (_) { }
        return null;
    }

    function getUsernameFromHeaderProfile() {
        const profileEl = document.getElementById('header-profile');
        if (!profileEl) return null;
        const pText = (profileEl.textContent || '').replace(/\s+/g, ' ').trim();
        const pm = pText.match(/^Hai[, ]+([a-zA-Z0-9_]{3,24})\b/i);
        if (pm && isValidUsername(pm[1])) return pm[1];
        return null;
    }

    function purgeStaleUserInfo(sessionUser) {
        if (!sessionUser) return;
        try {
            for (const store of [localStorage, sessionStorage]) {
                const raw = store.getItem('user-info');
                if (!raw || raw === 'null') continue;
                const obj = JSON.parse(raw);
                const stored = obj?.username || obj?.user?.username || obj?.user_name;
                if (stored && stored.toLowerCase() !== sessionUser.toLowerCase()) {
                    store.removeItem('user-info');
                    console.warn(`⚠️ [SPEED-QRIS] Purged stale user-info (${stored} ≠ session ${sessionUser})`);
                }
            }
        } catch (_) { }
    }

    function detectSpeedXDataReference() {
        const configured = (window.PG_CONFIG?.SPEED_X_DATA_REFERENCE || '').trim();
        if (configured) return configured;
        if (_speedXRefCache) return _speedXRefCache;
        if (_speedXRefSniffed) {
            _speedXRefCache = _speedXRefSniffed;
            return _speedXRefCache;
        }

        const pick = (val, source) => {
            if (val && /^[0-9a-f-]{36}$/i.test(val)) {
                _speedXRefCache = val;
                console.log('[SPEED-QRIS] X-Data-Reference auto (' + source + '):', val);
                return val;
            }
            return '';
        };

        try {
            const nd = document.getElementById('__NEXT_DATA__');
            if (nd) {
                const dump = nd.textContent || '';
                const patterns = [
                    new RegExp('"rule_challenge_ref"\\s*:\\s*\\{[^}]*"value"\\s*:\\s*"' + SPEED_UUID_RE + '"', 'i'),
                    new RegExp('"challenge_ref"\\s*:\\s*\\{[^}]*"value"\\s*:\\s*"' + SPEED_UUID_RE + '"', 'i'),
                    new RegExp('"x-data-reference"\\s*:\\s*"' + SPEED_UUID_RE + '"', 'i'),
                    new RegExp('"data_reference"\\s*:\\s*"' + SPEED_UUID_RE + '"', 'i'),
                ];
                for (const re of patterns) {
                    const m = dump.match(re);
                    if (m) return pick(m[1], '__NEXT_DATA__');
                }
            }
        } catch (_) { }

        try {
            const html = document.documentElement.innerHTML;
            const m2 = html.match(new RegExp('x-data-reference[^0-9a-f-]*' + SPEED_UUID_RE, 'i'));
            if (m2) return pick(m2[1], 'html');
        } catch (_) { }

        return '';
    }

    function buildSpeedApiHeaders(token) {
        const headers = {
            Accept: 'application/json, text/plain, */*',
            Authorization: 'Bearer ' + token,
        };
        const xref = detectSpeedXDataReference();
        if (xref) headers['X-Data-Reference'] = xref;
        const deviceId = findSpeedDeviceId();
        if (deviceId) headers['X-Device-Id'] = deviceId;
        headers['X-Device'] = CONFIG.IS_MOBILE ? 'mobile' : 'desktop';
        return headers;
    }

    async function getUsernameFromPlayerApi() {
        const token = findPlayerAuthToken();
        const playerId = getPlayerIdFromToken();
        if (!token) return null;

        const paths = [];
        if (playerId) paths.push('players/' + encodeURIComponent(playerId));
        paths.push('players/identity', 'players/me');

        for (const path of paths) {
            try {
                const res = await fetch('/services/' + path, {
                    method: 'GET',
                    headers: buildSpeedApiHeaders(token),
                    credentials: 'same-origin',
                });
                if (!res.ok) continue;
                const body = await res.json();
                const row = body?.data || body;
                const u = row?.username || row?.user?.username || row?.player?.username;
                if (isValidUsername(u)) return u;
            } catch (_) { }
        }
        return null;
    }

    /** Header hanya untuk cross-check — BUKAN sumber username. */
    function crossCheckSessionUsername(candidate) {
        const u = String(candidate || '').trim();
        if (!isValidUsername(u)) return false;
        const jwt = getUsernameFromAuthToken();
        const ewUs = getUsernameFromEwUsCookie();
        const header = getUsernameFromHeaderProfile();
        if (jwt && jwt.toLowerCase() !== u.toLowerCase()) return false;
        if (ewUs && ewUs.toLowerCase() !== u.toLowerCase()) return false;
        if (header && header.toLowerCase() !== u.toLowerCase()) return false;
        return true;
    }

    function collectSessionUsernameSignals() {
        return {
            ewUs: getUsernameFromEwUsCookie(),
            jwt: getUsernameFromAuthToken(),
            header: getUsernameFromHeaderProfile(),
            hasPlayerToken: !!findPlayerAuthToken(),
        };
    }

    /**
     * Username session — ZERO scrape.
     * Sumber utama: __ew-us cookie → JWT username field.
     * Header/localStorage/DOM scan TIDAK pernah jadi sumber utama.
     */
    function resolveSessionUsernameStrict() {
        const sig = collectSessionUsernameSignals();
        const { ewUs, jwt, header, hasPlayerToken } = sig;

        if (!hasPlayerToken && !ewUs && !jwt) {
            return { ok: false, u: null, src: '', err: 'Belum login (token player tidak ada)', needApi: false };
        }

        if (ewUs) {
            if (jwt && jwt.toLowerCase() !== ewUs.toLowerCase()) {
                return { ok: false, u: null, src: '', err: `Session bentrok: __ew-us=${ewUs} jwt=${jwt}`, needApi: false };
            }
            if (header && header.toLowerCase() !== ewUs.toLowerCase()) {
                return { ok: false, u: null, src: '', err: `Session bentrok: __ew-us=${ewUs} header=${header}`, needApi: false };
            }
            return { ok: true, u: ewUs, src: '__ew-us', sig, needApi: false };
        }

        if (jwt) {
            if (header && header.toLowerCase() !== jwt.toLowerCase()) {
                return { ok: false, u: null, src: '', err: `Session bentrok: jwt=${jwt} header=${header}`, needApi: false };
            }
            if (!hasPlayerToken) {
                return { ok: false, u: null, src: '', err: 'Token player tidak valid', needApi: false };
            }
            return { ok: true, u: jwt, src: 'jwt', sig, needApi: false };
        }

        if (hasPlayerToken) {
            return {
                ok: false, u: null, src: '', needApi: true,
                err: 'JWT tanpa field username — wajib konfirmasi API players/',
            };
        }

        return { ok: false, u: null, src: '', err: 'Username session tidak terbaca — login ulang', needApi: false };
    }

    async function resolveUsernameFromApiStrict() {
        const apiUser = await getUsernameFromPlayerApi();
        if (!apiUser) return null;
        if (!crossCheckSessionUsername(apiUser)) {
            console.error(`❌ [SPEED-QRIS] API username (${apiUser}) tidak cocok dengan session signals — BLOCK`);
            return null;
        }
        purgeStaleUserInfo(apiUser);
        return apiUser;
    }

    async function resolvePayUsername(options) {
        const force = options?.force === true;
        const validateApi = options?.validateApi === true;
        const strict = resolveSessionUsernameStrict();

        if (!force && _cachedUsername && strict.ok && strict.u &&
            _cachedUsername.toLowerCase() === strict.u.toLowerCase()) {
            return _cachedUsername;
        }

        const override = getUsernameFromOverride();
        if (override) {
            if (!crossCheckSessionUsername(override)) {
                console.error('❌ [SPEED-QRIS] SPEED_USERNAME override bentrok dengan session — BLOCK');
                return null;
            }
            _cachedUsername = override;
            return override;
        }

        let sessionUser = null;
        let sessionSrc = '';

        if (strict.ok && strict.u) {
            sessionUser = strict.u;
            sessionSrc = strict.src;
        } else if (strict.needApi || (findPlayerAuthToken() && !strict.ok)) {
            const apiUser = await resolveUsernameFromApiStrict();
            if (!apiUser) {
                _cachedUsername = '';
                console.error('❌ [SPEED-QRIS] ' + (strict.err || 'API username gagal'));
                return null;
            }
            sessionUser = apiUser;
            sessionSrc = 'api';
        } else {
            _cachedUsername = '';
            console.error('❌ [SPEED-QRIS] ' + (strict.err || 'Username session gagal'));
            return null;
        }

        purgeStaleUserInfo(sessionUser);

        if (validateApi) {
            const apiUser = await getUsernameFromPlayerApi();
            if (!apiUser) {
                console.error('❌ [SPEED-QRIS] Payment BLOCK — API players/ wajib saat bayar');
                _cachedUsername = '';
                return null;
            }
            if (apiUser.toLowerCase() !== sessionUser.toLowerCase()) {
                console.error(`❌ [SPEED-QRIS] API (${apiUser}) ≠ session (${sessionUser}) — BLOCK payment`);
                _cachedUsername = '';
                return null;
            }
            console.log(`✅ [SPEED-QRIS] API confirmed session: ${apiUser}`);
        }

        _cachedUsername = sessionUser;
        console.log(`✅ [SPEED-QRIS] Username locked (${sessionSrc}): ${sessionUser}`);
        return sessionUser;
    }

    async function getUsername() {
        try {
            return await resolvePayUsername({ force: false, validateApi: false });
        } catch (error) {
            console.error('❌ [SPEED-QRIS] Error getting username:', error);
            return null;
        }
    }

    async function resolvePayUsernameForPayment() {
        _cachedUsername = '';
        return resolvePayUsername({ force: true, validateApi: true });
    }

    async function assertPayUsernameLocked(expectedUser) {
        const exp = String(expectedUser || '').trim();
        if (!isValidUsername(exp)) {
            throw new Error('Username tidak valid saat bayar.');
        }
        const strict = resolveSessionUsernameStrict();
        if (strict.ok && strict.u) {
            if (exp.toLowerCase() !== strict.u.toLowerCase()) {
                throw new Error(`Username berubah (${exp} → ${strict.u}). Generate QR lagi.`);
            }
            return strict.u;
        }
        const apiUser = await getUsernameFromPlayerApi();
        if (!apiUser || apiUser.toLowerCase() !== exp.toLowerCase()) {
            throw new Error('Username session tidak valid saat bayar. Logout → login ulang.');
        }
        if (!crossCheckSessionUsername(apiUser)) {
            throw new Error('Session bentrok saat bayar — generate QR lagi.');
        }
        return apiUser;
    }

    function patchPoppayCreateTransactionBody(body, payUsername) {
        const forcedUser = (payUsername || '').trim();
        if (!forcedUser) return body;
        try {
            const parsed = typeof body === 'string' ? JSON.parse(body) : (body && typeof body === 'object' ? body : null);
            if (!parsed) return body;
            parsed.username = forcedUser;
            parsed.payor_name = forcedUser;
            return typeof body === 'string' ? JSON.stringify(parsed) : parsed;
        } catch (e) {
            console.warn('[SPEED-QRIS] create-transaction patch skip:', e?.message || e);
            return body;
        }
    }

    function lockedPayUsername(fallback) {
        const fb = String(fallback || '').trim();
        if (isValidUsername(fb) && crossCheckSessionUsername(fb)) return fb;
        const strict = resolveSessionUsernameStrict();
        if (strict.ok && strict.u) return strict.u;
        if (isValidUsername(_cachedUsername) && crossCheckSessionUsername(_cachedUsername)) {
            return _cachedUsername;
        }
        return null;
    }

    /** Hook fetch + XHR — paksa username session lock, bukan SDK/DOM scrape. */
    function withPoppayCreateTransactionHook(payUsername) {
        const origFetch = window.fetch;
        const origXhrOpen = XMLHttpRequest.prototype.open;
        const origXhrSend = XMLHttpRequest.prototype.send;

        window.fetch = async function (...args) {
            const url = String(args[0] || '');
            if (url.includes('create-transaction') && args[1]) {
                const forceUser = lockedPayUsername(payUsername);
                if (!forceUser) {
                    throw new Error('Username session tidak valid saat create-transaction');
                }
                const opts = args[1];
                if (opts.body) {
                    opts.body = patchPoppayCreateTransactionBody(opts.body, forceUser);
                    console.log('[SPEED-QRIS] fetch create-transaction username patched:', forceUser);
                }
            }
            return origFetch.apply(this, args);
        };

        XMLHttpRequest.prototype.open = function (method, url) {
            this.__speedPoppayUrl = String(url || '');
            this.__speedPoppayMethod = String(method || 'GET').toUpperCase();
            return origXhrOpen.apply(this, arguments);
        };

        XMLHttpRequest.prototype.send = function (body) {
            const url = this.__speedPoppayUrl || '';
            if (url.includes('create-transaction') && body) {
                const forceUser = lockedPayUsername(payUsername);
                if (!forceUser) {
                    throw new Error('Username session tidak valid saat create-transaction (XHR)');
                }
                body = patchPoppayCreateTransactionBody(body, forceUser);
                console.log('[SPEED-QRIS] XHR create-transaction username patched:', forceUser);
            }
            return origXhrSend.call(this, body);
        };

        return function restore() {
            window.fetch = origFetch;
            XMLHttpRequest.prototype.open = origXhrOpen;
            XMLHttpRequest.prototype.send = origXhrSend;
        };
    }

    function syncInjectUsernameDisplay(username) {
        const u = (username || '').trim();
        if (!isValidUsername(u)) return;
        _cachedUsername = u;
        const hidden = document.getElementById('speedQrisUsername');
        const display = document.getElementById('speedQrisUsernameDisplay');
        if (hidden) hidden.value = u;
        if (display) {
            display.value = u;
            display.placeholder = '';
            display.removeAttribute('data-error');
        }
    }

    function showUsernameSessionError(message) {
        const display = document.getElementById('speedQrisUsernameDisplay');
        if (!display) return;
        display.value = '';
        display.placeholder = message || 'Session error — login ulang';
        display.setAttribute('data-error', 'true');
    }

    async function refreshInjectUsernameFromSession(reason) {
        _cachedUsername = '';
        const u = await resolvePayUsername({ force: true, validateApi: false });
        if (u) {
            syncInjectUsernameDisplay(u);
            return true;
        }
        showUsernameSessionError('Session username invalid — login ulang');
        console.warn('[SPEED-QRIS] Username refresh fail (' + (reason || '') + ')');
        return false;
    }

    function readInjectUsername() {
        const strict = resolveSessionUsernameStrict();
        if (strict.ok && strict.u) return strict.u;
        if (isValidUsername(_cachedUsername) && crossCheckSessionUsername(_cachedUsername)) {
            return _cachedUsername;
        }
        return null;
    }

    async function refreshInjectUsernameFromSessionAsync(reason, validateApi) {
        _cachedUsername = '';
        const u = await resolvePayUsername({ force: true, validateApi: !!validateApi });
        if (u) {
            syncInjectUsernameDisplay(u);
            console.log('[SPEED-QRIS] Username refreshed (' + (reason || '') + '):', u);
            return u;
        }
        showUsernameSessionError('Session username invalid — login ulang');
        return null;
    }

    // ========================================================================
    // Fetch Promotion List (Speed — soft fail, endpoint UG sering tidak ada)
    // ========================================================================
    async function fetchPromotionList() {
        try {
            console.log('🎁 [SPEED-QRIS] Fetching promotion list...');

            // Try UG-style endpoint first (some skins proxy it)
            let response = await fetch('/getDepositPromotionList', {
                method: 'POST',
                headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
                body: JSON.stringify({ bank_id: '', method: 9 })
            });

            if (!response.ok) {
                // Speed Engine common promo endpoints (best-effort)
                const altUrls = [
                    '/api/promotion/deposit',
                    '/api/deposit/promotions',
                    '/promotion/deposit-list'
                ];
                for (const url of altUrls) {
                    try {
                        response = await fetch(url, {
                            method: 'GET',
                            headers: { Accept: 'application/json' },
                            cache: 'no-store'
                        });
                        if (response.ok) break;
                    } catch (_) { }
                }
            }

            if (!response || !response.ok) {
                console.warn('⚠️ [SPEED-QRIS] Promo API tidak tersedia — skip (optional)');
                return { success: true, data: [], promotions: [] };
            }

            const data = await response.json();
            console.log('✅ [SPEED-QRIS] Promotions loaded:', data);
            return data;
        } catch (error) {
            console.warn('⚠️ [SPEED-QRIS] Promo fetch skipped:', error?.message || error);
            return { success: true, data: [], promotions: [] };
        }
    }

    // ========================================================================
    // Populate Promotion Select
    // ========================================================================
    async function populatePromotionSelect() {
        const select = document.getElementById('depositPromotionAutoQris');
        if (!select) {
            console.warn('⚠️ [SPEED-QRIS] Promotion select not found');
            return;
        }

        const response = await fetchPromotionList();
        select.innerHTML = '<option value="">Pilih Promosi (Opsional)</option>';

        let promotions = [];
        if (response && response.d && Array.isArray(response.d.promotions)) {
            promotions = response.d.promotions;
        } else if (response && Array.isArray(response.promotions)) {
            promotions = response.promotions;
        } else if (response && Array.isArray(response.data)) {
            promotions = response.data;
        }

        if (response && response.d && response.d.is_show_promo === false) {
            console.warn('⚠️ [SPEED-QRIS] Promotions disabled');
            const group = select.closest('.form-group');
            if (group) group.style.display = 'none';
            return;
        }

        if (!promotions.length) {
            console.warn('⚠️ [SPEED-QRIS] No promotions — hide promo field');
            const group = select.closest('.form-group');
            if (group) group.style.display = 'none';
            return;
        }

        promotions.forEach(promo => {
            const option = document.createElement('option');
            option.value = promo.promo_code || promo.code || promo.id || '';
            option.textContent = promo.title || promo.name || promo.promo_code || String(option.value);
            if (promo.min) {
                option.setAttribute('data-min', promo.min);
                option.textContent += ' (Min: Rp ' + parseInt(promo.min).toLocaleString('id-ID') + ')';
            }
            select.appendChild(option);
        });

        console.log('✅ [SPEED-QRIS] ' + promotions.length + ' promotions loaded to select');
    }

    // ========================================================================
    // Check if Username Exists (Pre-Injection Validation)
    // ========================================================================
    async function validateUsernameExists() {
        const strict = resolveSessionUsernameStrict();
        if (!strict.ok || !strict.u) {
            showUsernameSessionError(strict.err || 'Username tidak valid');
            console.warn('⚠️ [SPEED-QRIS] INJECTION DISABLED -', strict.err || 'Username session tidak valid');
            return false;
        }
        purgeStaleUserInfo(strict.u);
        syncInjectUsernameDisplay(strict.u);
        console.log(`✅ [SPEED-QRIS] Username validation passed (${strict.src}): ${strict.u}`);
        return true;
    }

    // Payment-health cache
    let paymentHealthCache = null;
    let paymentHealthCacheKey = '';
    let paymentHealthCacheAt = 0;
    const PAYMENT_HEALTH_CACHE_TTL_MS = 30000;

    const STORE_KEY = (
        getParamFromCurrentScript('store_key') ||
        window.PGSCRIPT_STORE_KEY ||
        (window.PG_CONFIG && window.PG_CONFIG.STORE_KEY) ||
        ''
    ).toString().trim();

    if (STORE_KEY) {
        console.log('[SPEED-QRIS] store_key loaded from script/config');
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
            if (window.location.protocol === 'https:' && parsed.protocol === 'http:') {
                parsed.protocol = 'https:';
            }
            base = parsed.origin;
        } catch (e) {
            if (window.location.protocol === 'https:' && base.startsWith('http://')) {
                base = 'https://' + base.slice('http://'.length);
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
        // Dev bypass: inject jalan tanpa store_key / payment-health
        if (SKIP_STORE_KEY || !STORE_KEY) {
            if (SKIP_STORE_KEY) {
                console.log('⚠️ [SPEED-QRIS] SKIP_STORE_KEY=true — payment-health bypassed');
            } else {
                console.warn('⚠️ [SPEED-QRIS] store_key empty — bypass health (set SKIP_STORE_KEY=false + SK untuk production)');
            }
            return true;
        }

        const now = Date.now();
        if (
            paymentHealthCache !== null &&
            paymentHealthCacheKey === STORE_KEY &&
            (now - paymentHealthCacheAt) < PAYMENT_HEALTH_CACHE_TTL_MS
        ) {
            return paymentHealthCache;
        }

        try {
            const res = await fetch(`${PGSCRIPT_BASE}/${PGSCRIPT_API_VERSION}/payment-health-v2`, {
                method: 'GET',
                cache: 'no-store',
                headers: {
                    Accept: 'application/json',
                    'X-Store-Key': STORE_KEY,
                },
            });

            const body = await res.json().catch(() => ({}));
            // Wajib success === true. Response 200 tanpa success TIDAK dianggap ON.
            if (!res.ok || body?.success !== true) {
                console.log('[Deposit is disabled]');
                console.warn('❌ [SPEED-QRIS] payment-health OFF:', body?.message || `HTTP ${res.status}`);
                paymentHealthCache = false;
                paymentHealthCacheKey = STORE_KEY;
                paymentHealthCacheAt = now;
                return false;
            }

            console.log('✅ [SPEED-QRIS] payment-health OK');
            paymentHealthCache = true;
            paymentHealthCacheKey = STORE_KEY;
            paymentHealthCacheAt = now;
            return true;
        } catch (err) {
            console.log('[Deposit is disabled]');
            console.warn('❌ [SPEED-QRIS] payment-health check failed (fail-closed):', err?.message || err);
            paymentHealthCache = false;
            paymentHealthCacheKey = STORE_KEY;
            paymentHealthCacheAt = now;
            return false;
        }
    }

    function teardownInjection() {
        const wrapper = document.getElementById('ug-poppay-wrapper');
        if (wrapper) {
            wrapper.remove();
        }

        showNativeDepositForm();

        document.querySelectorAll('[data-poppay-hidden="true"]').forEach((el) => {
            // Jangan unhide tab QRIS secara keliru — tab tidak pernah di-hide
            if (el.id === 'deposit-qr-tab') {
                el.removeAttribute('data-poppay-hidden');
                return;
            }
            el.style.display = '';
            el.style.visibility = '';
            el.removeAttribute('data-poppay-hidden');
        });

        isInjected = false;
        handlersAttached = false;
        console.log('[SPEED-QRIS] Injection removed (left QRIS tab / OFF)');
    }

    async function syncInjectionToQRISTab(reason) {
        if (!isDepositPage()) {
            if (isInjected) teardownInjection();
            return false;
        }

        if (!isQRISTabActive()) {
            if (isInjected || document.getElementById('ug-poppay-wrapper')) {
                console.log(`[SPEED-QRIS] ${reason || 'sync'}: bukan tab QRIS → teardown`);
                teardownInjection();
            }
            return false;
        }

        // Tab QRIS aktif
        const wrapper = document.getElementById('ug-poppay-wrapper');
        const inner = document.getElementById('ug-poppay-qris-full');
        if (wrapper && inner) {
            hideNativeDepositFormOnQRIS();
            refreshInjectUsernameFromSession(reason || 'sync');
            return true;
        }

        console.log(`[SPEED-QRIS] ${reason || 'sync'}: tab QRIS aktif → inject`);
        const ok = await replaceQRIS();
        if (ok) {
            isInjected = true;
            hideNativeDepositFormOnQRIS();
        }
        return ok;
    }

    // ========================================================================
    // Find Stable Injection Container (NEW APPROACH - Don't rely on QRIS element!)
    // ========================================================================
    function findStableContainer() {
        console.log('[SPEED-QRIS] 🔍 Finding Speed Engine deposit container...');

        // 1) Form area containing #deposit-amount (best)
        const amountInput = document.getElementById('deposit-amount');
        if (amountInput) {
            const form = amountInput.closest('form') || amountInput.closest('div.jsx-2877637026')?.parentElement || amountInput.parentElement?.parentElement?.parentElement;
            if (form) {
                console.log('✅ [SPEED-QRIS] Found container via #deposit-amount');
                return form.parentElement || form;
            }
        }

        // 2) Sidebar tabs panel parent
        const tabs = document.getElementById('deposit-desktop-tab');
        if (tabs && tabs.parentElement) {
            // Prefer sibling content panel (deposit form) over the tablist itself
            const parent = tabs.parentElement;
            console.log('✅ [SPEED-QRIS] Found container via #deposit-desktop-tab parent');
            return parent;
        }

        // 3) Deposit title / header button area
        const title = Array.from(document.querySelectorAll('b, h1, h2, h3')).find(el =>
            (el.textContent || '').trim().toLowerCase() === 'deposit'
        );
        if (title && title.parentElement) {
            console.log('✅ [SPEED-QRIS] Found container via Deposit title');
            return title.parentElement;
        }

        console.warn('⚠️ [SPEED-QRIS] Stable container not found!');
        return null;
    }

    // ========================================================================
    // Find original Speed QR tab / QRIS logo (optional hide)
    // ========================================================================
    function findQRISElement() {
        function isInsidePoppay(element) {
            return element.closest('#ug-poppay-qris-full') !== null ||
                element.closest('#speed-poppay-qris-full') !== null ||
                element.closest('[data-ug-persistent="true"]') !== null ||
                element.closest('[data-speed-persistent="true"]') !== null;
        }

        const qrTab = document.getElementById('deposit-qr-tab');
        if (qrTab && !isInsidePoppay(qrTab)) {
            console.log('✅ [SPEED-QRIS] Found #deposit-qr-tab');
            return qrTab;
        }

        const qrisImg = Array.from(document.querySelectorAll('img')).find(img =>
            (img.src || '').toLowerCase().includes('qris') ||
            (img.alt || '').toLowerCase().includes('qris')
        );
        if (qrisImg && !isInsidePoppay(qrisImg)) {
            const wrap = qrisImg.closest('button') || qrisImg.closest('div');
            if (wrap && !isInsidePoppay(wrap)) {
                console.log('✅ [SPEED-QRIS] Found QRIS image container');
                return wrap;
            }
        }

        console.log('ℹ️ [SPEED-QRIS] Original QRIS tab not found (optional)');
        return null;
    }

    // ========================================================================
    // Inject Poppay Form (NEW APPROACH - Use stable container!)
    // ========================================================================
    async function replaceQRIS() {
        const paymentHealthOk = await checkPaymentHealth();
        if (!paymentHealthOk) {
            teardownInjection();
            return false;
        }

        // Hanya inject di tab QRIS
        if (!isQRISTabActive()) {
            console.log('ℹ️ [SPEED-QRIS] replaceQRIS skipped — tab QRIS belum aktif');
            return false;
        }

        // Check if already injected
        const existingElement = document.getElementById('ug-poppay-qris-full') || document.getElementById('speed-poppay-qris-full');
        if (existingElement) {
            console.log('ℹ️ [SPEED-QRIS] Already injected — refresh username from session');
            hideNativeDepositFormOnQRIS();
            refreshInjectUsernameFromSession('replaceQRIS-existing');
            return true;
        }

        // Reset handler flag for fresh injection
        handlersAttached = false;
        console.log('[SPEED-QRIS] Handler flag reset for fresh injection');

        // CRITICAL: Validate username exists BEFORE injection
        const isValid = await validateUsernameExists();
        if (!isValid) {
            console.error('❌ [SPEED-QRIS] INJECTION BLOCKED - No valid username found');
            return false;
        }
        const strictUser = resolveSessionUsernameStrict();
        if (strictUser.ok && strictUser.u) syncInjectUsernameDisplay(strictUser.u);

        // Reset button handlers flag for fresh injection
        buttonHandlersAttached = false;
        console.log('[SPEED-QRIS] Button handler flag reset for fresh injection');

        // Find stable container (NEW!)
        const stableContainer = findStableContainer();

        if (!stableContainer) {
            console.error('❌ [SPEED-QRIS] Stable container not found!');
            return false;
        }

        console.log('🔄 [SPEED-QRIS] Injecting Poppay to stable container...');
        console.log('[SPEED-QRIS] Stable container:', stableContainer);

        // Try to find original QRIS (optional — JANGAN hide #deposit-qr-tab)
        const originalQRIS = findQRISElement();
        if (originalQRIS && originalQRIS.id !== 'deposit-qr-tab') {
            console.log('[SPEED-QRIS] Hiding original QRIS element...');
            originalQRIS.style.display = 'none';
            originalQRIS.style.visibility = 'hidden';
            originalQRIS.setAttribute('data-poppay-hidden', 'true');
        } else if (originalQRIS) {
            console.log('[SPEED-QRIS] QR tab found — leave visible, inject Poppay panel separately');
        }

        // Use stable container as parent
        const parentContainer = stableContainer;
        console.log('[SPEED-QRIS] Parent container:', parentContainer);

        if (!parentContainer) {
            console.error('❌ [SPEED-QRIS] Parent container not found!');
            return false;
        }

        // MARK parent container to track it
        parentContainer.setAttribute('data-ug-parent', 'true');
        console.log('[SPEED-QRIS] Parent container marked');

        // Prevent parent container from being removed
        const preventParentRemoval = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.removedNodes.forEach(async (node) => {
                    // If parent container was removed
                    if (node === parentContainer ||
                        (node.nodeType === 1 && node.querySelector && node.querySelector('[data-ug-parent="true"]'))) {
                        console.warn('[SPEED-QRIS] ⚠️ Parent container removed! Re-injecting ASAP...');

                        setTimeout(async () => {
                            if (!reinjectionInProgress) {
                                reinjectionInProgress = true;
                                try {
                                    await syncInjectionToQRISTab('ParentRemoved');
                                } finally {
                                    reinjectionInProgress = false;
                                }
                            }
                        }, 100);
                    }
                });
            });
        });

        // Watch for parent removal
        preventParentRemoval.observe(document.body, {
            childList: true,
            subtree: true
        });

        console.log('[SPEED-QRIS] Parent container protection active');

        // Create SUPER-PERSISTENT wrapper
        const wrapper = document.createElement('div');
        wrapper.id = 'ug-poppay-wrapper';
        wrapper.setAttribute('data-ug-persistent', 'true');
        wrapper.style.cssText = `
            position: relative !important;
            z-index: 9999 !important;
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
            margin-bottom: 20px !important;
        `;

        // Create new Poppay element (isolated container)
        const newElement = document.createElement('div');
        newElement.id = 'ug-poppay-qris-full';

        // MARK as persistent (don't let site remove this!)
        newElement.setAttribute('data-ug-persistent', 'true');
        newElement.setAttribute('data-payment-method', 'qris-poppay');

        // Prevent event bubbling ONLY from non-interactive elements (NOT buttons/inputs)
        newElement.addEventListener('click', function (e) {
            // Allow clicks on buttons, inputs, and interactive elements
            const interactive = e.target.closest('button, input, select, a, [role="button"]');
            if (!interactive) {
                e.stopPropagation();
                e.stopImmediatePropagation();
            }
        }, true);

        // Prevent wrapper from being removed (HARDCORE!)
        const preventRemoval = new MutationObserver((mutations) => {
            const wrapperElement = document.getElementById('ug-poppay-wrapper');
            const innerElement = document.getElementById('ug-poppay-qris-full');

            if ((!wrapperElement || !innerElement) && isInjected) {
                console.warn('[SPEED-QRIS] ⚠️ Injection removed! Re-injecting NOW...');
                setTimeout(async () => {
                    if (!reinjectionInProgress) {
                        reinjectionInProgress = true;
                        await replaceQRIS();
                        reinjectionInProgress = false;
                    }
                }, 50);
            }
        });

        // Watch for removal (capture phase!)
        preventRemoval.observe(document.body, {
            childList: true,
            subtree: true
        });

        newElement.innerHTML = `
            <style>
                /* Isolation container - PERSISTENT */
                #ug-poppay-qris-full {
                    isolation: isolate;
                    position: relative !important;
                    z-index: 1000 !important;
                    pointer-events: auto !important;
                    display: block !important;
                    opacity: 1 !important;
                    visibility: visible !important;
                }
                
                /* Debug indicator - shows injection is active */
                #ug-poppay-qris-full::before {
                    content: '🔒 QRIS Automation Poppay Active';
                    position: absolute;
                    top: -5px;
                    right: 0;
                    background: rgba(76, 175, 80, 0.15);
                    color: #4CAF50;
                    font-size: 10px;
                    padding: 2px 6px;
                    border-radius: 3px;
                    font-weight: 600;
                    opacity: 0.85;
                    pointer-events: none;
                    z-index: 9999;
                }
                
                #ug-poppay-qris-full * {
                    pointer-events: auto;
                }
                
                /* Force visibility */
                [data-ug-persistent="true"] {
                    display: block !important;
                    visibility: visible !important;
                }
                
                .qris-manual-wrapper {
                    background: #1a1a1a;
                    color: #fff;
                    padding: ${CONFIG.IS_MOBILE ? '12px' : '25px'};
                    border-radius: ${CONFIG.IS_MOBILE ? '8px' : '12px'};
                    margin-bottom: ${CONFIG.IS_MOBILE ? '10px' : '25px'};
                    box-shadow: 0 4px 16px rgba(0,0,0,0.35);
                    border: 1px solid #333;
                    max-width: 100%;
                    width: 100%;
                    overflow-x: hidden;
                    position: relative;
                    box-sizing: border-box;
                    color-scheme: dark;
                }
                
                @media (max-width: 768px) {
                    .qris-manual-wrapper {
                        padding: 10px !important;
                        margin: 0 !important;
                    }
                }
                
                .qris-manual-header {
                    margin-bottom: 20px;
                    padding-bottom: 15px;
                    border-bottom: 2px solid #333;
                }
                
                .qris-manual-header h5 {
                    color: #fff;
                    font-weight: 600;
                    margin: 0;
                    display: flex;
                    align-items: center;
                    font-size: ${CONFIG.IS_MOBILE ? '16px' : '18px'};
                    word-wrap: break-word;
                }
                
                @media (max-width: 768px) {
                    .qris-manual-header h5 {
                        font-size: 14px !important;
                    }
                }
                
                .qris-manual-header .qris-icon {
                    width: 24px;
                    height: 24px;
                    margin-right: 10px;
                    color: #4CAF50;
                    font-size: 20px;
                }
                
                .qris-manual-header p {
                    color: #aaa;
                    font-size: 13px;
                    margin: 8px 0 0 0;
                }
                
                .qris-form label {
                    color: #ddd;
                    font-weight: 500;
                    margin-bottom: 8px;
                    display: block;
                }
                
                .qris-amount-buttons {
                    display: flex;
                    flex-wrap: wrap;
                    gap: ${CONFIG.IS_MOBILE ? '8px' : '10px'};
                    margin-bottom: 15px;
                    user-select: none;
                    -webkit-user-select: none;
                    pointer-events: auto;
                    width: 100%;
                    box-sizing: border-box;
                }
                
                @media (max-width: 768px) {
                    .qris-amount-buttons {
                        gap: 6px !important;
                    }
                }
                
                .qris-amount-btn {
                    padding: ${CONFIG.IS_MOBILE ? '10px 8px' : '8px 16px'};
                    border: 1px solid #444;
                    background: #2a2a2a;
                    color: #fff;
                    border-radius: 6px;
                    cursor: pointer !important;
                    font-size: ${CONFIG.IS_MOBILE ? '12px' : '14px'};
                    font-weight: 500;
                    transition: all 0.3s;
                    flex: ${CONFIG.IS_MOBILE ? '1 1 calc(50% - 3px)' : '0 0 auto'};
                    min-width: ${CONFIG.IS_MOBILE ? '0' : 'auto'};
                    max-width: ${CONFIG.IS_MOBILE ? 'calc(50% - 3px)' : 'none'};
                    touch-action: manipulation;
                    -webkit-tap-highlight-color: transparent;
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    box-sizing: border-box;
                    pointer-events: auto !important;
                    user-select: none;
                    -webkit-user-select: none;
                    position: relative;
                    z-index: 1;
                }
                
                @media (max-width: 768px) {
                    .qris-amount-btn {
                        flex: 1 1 calc(50% - 3px) !important;
                        max-width: calc(50% - 3px) !important;
                        font-size: 11px !important;
                        padding: 10px 6px !important;
                    }
                }
                
                @media (max-width: 400px) {
                    .qris-amount-btn {
                        flex: 1 1 calc(50% - 3px) !important;
                        font-size: 10px !important;
                        padding: 8px 4px !important;
                    }
                }
                
                .qris-amount-btn:hover {
                    background: #4CAF50;
                    color: #fff;
                    border-color: #4CAF50;
                }
                
                .qris-amount-btn.active {
                    background: #4CAF50 !important;
                    color: #fff !important;
                    border-color: #4CAF50 !important;
                }
                
                .qris-amount-btn:active {
                    transform: scale(0.98);
                }
                
                .qris-dual-input-wrapper {
                    display: flex;
                    align-items: center;
                    gap: ${CONFIG.IS_MOBILE ? '8px' : '12px'};
                    margin-bottom: 10px;
                    width: 100%;
                }
                
                .qris-input-group {
                    display: flex;
                    flex: 1;
                }
                
                .qris-input-small {
                    flex: 0 0 ${CONFIG.IS_MOBILE ? '90px' : '120px'};
                }
                
                .qris-input-display {
                    flex: 1;
                }
                
                .qris-input-arrow {
                    color: #4CAF50;
                    font-size: ${CONFIG.IS_MOBILE ? '18px' : '24px'};
                    font-weight: bold;
                    flex-shrink: 0;
                }
                
                .qris-input {
                    flex: 1;
                    min-width: 0;
                    padding: 12px ${CONFIG.IS_MOBILE ? '12px' : '16px'};
                    border: 1px solid #444;
                    border-radius: 6px;
                    font-size: ${CONFIG.IS_MOBILE ? '14px' : '16px'};
                    width: 100%;
                    box-sizing: border-box;
                    background: #2a2a2a;
                    color: #fff;
                    text-align: center;
                }
                
                .qris-display-readonly {
                    background: #1a1a1a;
                    color: #4CAF50;
                    font-weight: 600;
                    cursor: not-allowed;
                    border-color: #4CAF50;
                }

                .qris-username-readonly {
                    text-align: left;
                    letter-spacing: 0.02em;
                    font-family: ui-monospace, Consolas, monospace;
                }

                .qris-username-readonly[data-error="true"] {
                    border-color: #f44336 !important;
                    color: #ff8a80 !important;
                }
                
                .qris-input:focus {
                    outline: none;
                    border-color: #4CAF50;
                }
                
                select.qris-input {
                    border-radius: 6px;
                    width: 100%;
                }
                
                .qris-input::placeholder {
                    color: #666;
                }
                
                .qris-input-hint {
                    font-size: 12px;
                    color: #888;
                    margin-top: 5px;
                }
                
                .qris-submit-btn {
                    width: 100%;
                    padding: ${CONFIG.IS_MOBILE ? '16px' : '14px'};
                    background: #4CAF50;
                    color: white;
                    border: none;
                    border-radius: 6px;
                    font-size: ${CONFIG.IS_MOBILE ? '15px' : '16px'};
                    font-weight: 600;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    transition: all 0.3s;
                    touch-action: manipulation;
                    -webkit-tap-highlight-color: transparent;
                    min-height: ${CONFIG.IS_MOBILE ? '48px' : 'auto'};
                }
                
                .qris-submit-btn:hover {
                    background: #45a049;
                }
                
                .qris-submit-btn:disabled {
                    background: #444;
                    color: #888;
                    cursor: not-allowed;
                }
                
                #ug-promo-warning {
                    background: rgba(255, 193, 7, 0.12);
                    border: 1px solid #ffc107;
                    color: #ffe082;
                    padding: 10px;
                    border-radius: 6px;
                    margin-top: 10px;
                    font-size: 13px;
                }
                
                .ug-qris-success-box {
                    padding: 20px;
                    background: rgba(76, 175, 80, 0.15);
                    border: 2px solid #4CAF50;
                    border-radius: 8px;
                    margin-top: 15px;
                }
                
                .ug-qris-success-box h4 {
                    color: #b9f6ca;
                    margin: 0 0 10px 0;
                }
                
                .ug-qris-success-box p {
                    color: #a5d6a7;
                    margin: 0;
                }
                
                .qris-result {
                    display: none;
                    margin-top: 20px;
                }
                
                .qris-result.active {
                    display: block;
                }
                
                #qris-payment-frame {
                    min-height: 400px;
                    text-align: center;
                }
                
                #payment-result {
                    margin-top: 15px;
                }
            </style>
            
            <div class="qris-manual-wrapper">
                <div class="qris-manual-header">
                    <h5>
                        <span class="qris-icon">💳</span>
                        QRIS Instant
                    </h5>
                    <p>Scan QR code dengan e-wallet favorit Anda (DANA, OVO, GoPay, ShopeePay, dll)</p>
                </div>
                
                <div class="qris-form" id="qrisFormContainer">
                    <form id="formDepositAutoQris">
                        <input type="hidden" id="bankSelectAutoQris" value="QRIS">
                        <input type="hidden" id="speedQrisUsername" value="">
                        
                        <div class="form-group mb-3">
                            <label>Username</label>
                            <input
                                class="qris-input qris-display-readonly qris-username-readonly"
                                type="text"
                                id="speedQrisUsernameDisplay"
                                readonly
                                tabindex="-1"
                                autocomplete="off"
                                placeholder="Memuat username..."
                            >
                            <small class="qris-input-hint">Terisi otomatis dari session login (readonly)</small>
                        </div>
                        
                        <div class="form-group mb-3">
                            <label>Jumlah Deposit</label>
                            
                            <div class="qris-amount-buttons" id="ug-amount-buttons">
                                ${renderQuickAmountButtons()}
                            </div>
                            
                            <div style="display: flex; justify-content: space-between; margin-top: 12px; margin-bottom: 4px;">
                                <small style="color: #888; font-size: 11px;">Masukkan Jumlah</small>
                                <small style="color: #4CAF50; font-size: 11px;">= Setara Rupiah</small>
                            </div>
                            
                            <div class="qris-dual-input-wrapper">
                                <div class="qris-input-group qris-input-small">
                                    <input 
                                        class="qris-input" 
                                        type="text" 
                                        id="depositInputAutoQris" 
                                        placeholder="${CONFIG.MIN_DISPLAY}"
                                        inputmode="numeric"
                                        autocomplete="off"
                                    >
                                </div>
                                <div class="qris-input-arrow">→</div>
                                <div class="qris-input-group qris-input-display">
                                    <input 
                                        class="qris-input qris-display-readonly" 
                                        type="text" 
                                        id="depositShowAmountAutoQris" 
                                        placeholder="Rp ${CONFIG.MIN_AMOUNT.toLocaleString('id-ID')}"
                                        readonly
                                        tabindex="-1"
                                    >
                                </div>
                            </div>
                            <input type="hidden" id="depositAmountAutoQris" value="">
                            
                            <small class="qris-input-hint">Min: ${CONFIG.MIN_DISPLAY} (= Rp ${CONFIG.MIN_AMOUNT.toLocaleString('id-ID')}) | Max: ${CONFIG.MAX_DISPLAY} (= Rp ${CONFIG.MAX_AMOUNT.toLocaleString('id-ID')})</small>
                        </div>
                        
                        <div class="form-group mb-3">
                            <label>Promosi (Opsional)</label>
                            <select class="qris-input" id="depositPromotionAutoQris">
                                <option value="">Pilih Promosi (Opsional)</option>
                                <option value="loading" disabled>Loading...</option>
                            </select>
                            <small class="qris-input-hint">Pilih promosi yang tersedia atau biarkan kosong</small>
                        </div>
                        
                        <button type="submit" class="qris-submit-btn">
                            <span>💳</span>
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

        // Put newElement inside wrapper
        wrapper.appendChild(newElement);
        console.log('[SPEED-QRIS] Element wrapped in super-persistent wrapper');

        // Insert wrapper — Speed Engine layout
        try {
            let insertedOk = false;

            // 1) Prefer: right before the Nominal Koin form block
            const amountInput = document.getElementById('deposit-amount');
            if (amountInput) {
                const formBlock = amountInput.closest('form') ||
                    amountInput.closest('[class*="jsx-2877637026"]')?.parentElement ||
                    amountInput.parentElement?.parentElement?.parentElement;
                if (formBlock && formBlock.parentNode) {
                    formBlock.parentNode.insertBefore(wrapper, formBlock);
                    console.log('[SPEED-QRIS] Wrapper inserted before deposit amount form');
                    insertedOk = true;
                }
            }

            // 2) After "Deposit" title (b/h*)
            if (!insertedOk) {
                const title = Array.from(parentContainer.querySelectorAll('b, h1, h2, h3, h4, h5'))
                    .find(el => (el.textContent || '').trim().toLowerCase() === 'deposit');
                if (title && title.parentNode) {
                    title.parentNode.insertBefore(wrapper, title.nextSibling);
                    console.log('[SPEED-QRIS] Wrapper inserted after Deposit title');
                    insertedOk = true;
                }
            }

            // 3) After sidebar tabs (#deposit-desktop-tab)
            if (!insertedOk) {
                const tabs = document.getElementById('deposit-desktop-tab');
                if (tabs && tabs.parentNode) {
                    // insert after the whole tab column's sibling content start, else after tabs
                    const col = tabs.parentElement;
                    if (col && col.nextElementSibling) {
                        col.nextElementSibling.insertBefore(wrapper, col.nextElementSibling.firstChild);
                        console.log('[SPEED-QRIS] Wrapper inserted into content column');
                        insertedOk = true;
                    } else {
                        tabs.parentNode.insertBefore(wrapper, tabs.nextSibling);
                        console.log('[SPEED-QRIS] Wrapper inserted after deposit tabs');
                        insertedOk = true;
                    }
                }
            }

            // 4) Fallback beginning / append
            if (!insertedOk) {
                parentContainer.insertBefore(wrapper, parentContainer.firstChild);
                console.log('[SPEED-QRIS] Wrapper inserted at beginning');
            }
        } catch (error) {
            console.error('❌ [SPEED-QRIS] Failed to insert:', error);
            try {
                parentContainer.appendChild(wrapper);
                console.log('[SPEED-QRIS] Wrapper appended (fallback)');
            } catch (e2) {
                console.error('❌ [SPEED-QRIS] Failed to append:', e2);
                return false;
            }
        }

        // Verify insertion
        const inserted = document.getElementById('ug-poppay-qris-full');
        if (inserted) {
            console.log('✅ [SPEED-QRIS] Injection verified successfully!');
            hideNativeDepositFormOnQRIS();
            refreshInjectUsernameFromSession('post-inject');
        } else {
            console.error('❌ [SPEED-QRIS] Injection verification failed!');
            return false;
        }

        // HARDCORE: Multiple event attachment strategies
        console.log('[SPEED-QRIS] 🔥 HARDCORE MODE: Attaching multiple event types...');

        // Function to set amount (Input 20 → Display Rp 20.000 → SDK 20000)
        const setAmount = (amount, button) => {
            console.log('[SPEED-QRIS] 💰 setAmount called:', amount);

            const amountInput = document.getElementById('depositInputAutoQris');
            const amountDisplay = document.getElementById('depositShowAmountAutoQris');
            const amountHidden = document.getElementById('depositAmountAutoQris');

            if (amountInput && amountDisplay && amountHidden) {
                document.querySelectorAll('.qris-amount-btn').forEach(b => b.classList.remove('active'));
                if (button) button.classList.add('active');

                // Input: plain number
                amountInput.value = parseInt(amount);
                // Display: formatted Rupiah
                const rupiah = parseInt(amount) * CONFIG.CONVERSION_RATIO;
                amountDisplay.value = 'Rp ' + rupiah.toLocaleString('id-ID');
                // Hidden: SDK amount
                amountHidden.value = rupiah;

                console.log('[SPEED-QRIS] ✅ Input:', amount, '→ Display:', amountDisplay.value, '→ SDK:', amountHidden.value);

                // Trigger promotion validation check
                setTimeout(() => {
                    const evt = new Event('input', { bubbles: true });
                    amountHidden.dispatchEvent(evt);
                }, 50);

                return true;
            } else {
                console.error('[SPEED-QRIS] ❌ Input elements not found!');
                return false;
            }
        };

        // Strategy 1: Event delegation on container - MULTIPLE event types for compatibility
        const buttonContainer = document.getElementById('ug-amount-buttons');
        if (buttonContainer) {
            console.log('[SPEED-QRIS] 🎯 Attaching container delegation events...');

            // Desktop: click + mousedown
            ['click', 'mousedown'].forEach(eventType => {
                buttonContainer.addEventListener(eventType, function (e) {
                    const button = e.target.closest('.qris-amount-btn');
                    if (!button) return;

                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();

                    const amount = button.getAttribute('data-amount');
                    console.log(`[SPEED-QRIS] 🎯 Container ${eventType} on button:`, amount);

                    setAmount(amount, button);
                    return false;
                }, { capture: true, passive: false });
            });

            // Mobile: touchstart + touchend
            if (CONFIG.IS_MOBILE) {
                ['touchstart', 'touchend'].forEach(eventType => {
                    buttonContainer.addEventListener(eventType, function (e) {
                        const button = e.target.closest('.qris-amount-btn');
                        if (!button) return;

                        e.preventDefault();
                        const amount = button.getAttribute('data-amount');
                        console.log(`[SPEED-QRIS] 🎯 Container ${eventType} on button:`, amount);

                        if (eventType === 'touchend') {
                            setAmount(amount, button);
                        }
                        return false;
                    }, { capture: true, passive: false });
                });
            }

            console.log('[SPEED-QRIS] ✅ Container delegation attached');
        }

        // Strategy 2: Direct attachment to each button (with retry guard)
        const attachToButtons = () => {
            // Prevent duplicate attachment
            if (buttonHandlersAttached) {
                console.log('[SPEED-QRIS] ℹ️ Button handlers already attached, skipping...');
                return;
            }

            const buttons = document.querySelectorAll('.qris-amount-btn');
            if (buttons.length === 0) {
                console.log('[SPEED-QRIS] ⚠️ No buttons found yet');
                return;
            }

            console.log('[SPEED-QRIS] 🔍 Found', buttons.length, 'buttons to attach');

            // Mobile: touchstart only to prevent ghost clicks, Desktop: click only
            const eventType = CONFIG.IS_MOBILE ? 'touchstart' : 'click';

            buttons.forEach((btn, index) => {
                const amount = btn.getAttribute('data-amount');
                console.log(`[SPEED-QRIS] 📌 Attaching events to button ${index + 1}:`, amount);

                // Attach MULTIPLE event types for maximum compatibility
                ['click', 'mousedown', 'touchstart', 'touchend'].forEach(eventType => {
                    btn.addEventListener(eventType, function (e) {
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation();

                        console.log(`[SPEED-QRIS] 🎯 Direct ${eventType} on button:`, amount);

                        // Only setAmount on click/mousedown/touchend (not touchstart)
                        if (eventType !== 'touchstart') {
                            setAmount(amount, this);
                        }
                        return false;
                    }, { capture: true, passive: false });
                });

                // Visual confirmation
                btn.style.cursor = 'pointer';
                btn.style.pointerEvents = 'auto';
                btn.style.userSelect = 'none';
                const backendAmount = parseInt(amount) * CONFIG.CONVERSION_RATIO;
                btn.title = `Click to set ${amount} (= Rp ${backendAmount.toLocaleString('id-ID')})`;
            });

            buttonHandlersAttached = true;
            console.log(`[SPEED-QRIS] ✅ Direct ${eventType} attachment complete for ${buttons.length} buttons (flag set)`);
        };

        // Attach with retry (but flag prevents duplicate)
        attachToButtons();
        setTimeout(attachToButtons, 100);
        setTimeout(attachToButtons, 300);
        setTimeout(attachToButtons, 500);
        setTimeout(attachToButtons, 1000);

        // Initialize form (with multiple attempts)
        let initAttempts = 0;
        const tryInit = () => {
            initAttempts++;
            console.log(`[SPEED-QRIS] Init attempt ${initAttempts}...`);
            initializeForm();
        };

        // Try multiple times with increasing delays
        setTimeout(tryInit, 100);
        setTimeout(tryInit, 300);
        setTimeout(tryInit, 500);

        return true;
    }

    // ========================================================================
    // Initialize Form
    // ========================================================================
    let handlersAttached = false;  // Prevent duplicate attachments

    function initializeForm() {
        console.log('[SPEED-QRIS] Initializing form...');

        // Skip if handlers already attached
        if (handlersAttached) {
            console.log('[SPEED-QRIS] ℹ️ Handlers already attached, skipping...');
            return;
        }

        // Wait for elements to be ready
        const checkElements = setInterval(() => {
            const form = document.getElementById('formDepositAutoQris');
            const amountInput = document.getElementById('depositInputAutoQris');
            const amountShow = document.getElementById('depositShowAmountAutoQris');
            const amountHidden = document.getElementById('depositAmountAutoQris');
            const amountBtns = document.querySelectorAll('.qris-amount-btn');

            if (form && amountInput && amountShow && amountHidden && amountBtns.length > 0) {
                clearInterval(checkElements);

                // Double-check flag before attaching
                if (!handlersAttached) {
                    console.log('[SPEED-QRIS] ✓ All elements found, attaching handlers...');
                    attachHandlers();
                    handlersAttached = true;
                    console.log('[SPEED-QRIS] ✅ Handlers attached, flag set to prevent duplicates');
                } else {
                    console.log('[SPEED-QRIS] ℹ️ Race condition avoided - handlers already attached');
                }
            }
        }, 50);

        // Timeout after 5 seconds
        setTimeout(() => {
            clearInterval(checkElements);
            if (!handlersAttached) {
                console.warn('[SPEED-QRIS] ⚠️ Timeout waiting for elements');
            }
        }, 5000);
    }

    function attachHandlers() {
        const form = document.getElementById('formDepositAutoQris');
        const amountShow = document.getElementById('depositShowAmountAutoQris');
        const amountHidden = document.getElementById('depositAmountAutoQris');
        const formContainer = document.getElementById('qrisFormContainer');
        const resultContainer = document.getElementById('qrisResultContainer');
        const btnText = document.getElementById('qris-btn-text');

        console.log('[SPEED-QRIS] ✓ Form elements found, attaching handlers...');

        // Load promotions
        populatePromotionSelect().catch(err => {
            console.error('❌ [SPEED-QRIS] Failed to load promotions:', err);
        });

        // Amount input handler - untuk manual typing
        // User ketik angka kecil → update display (formatted) + hidden (SDK)
        const amountInput = document.getElementById('depositInputAutoQris');
        const amountDisplay = document.getElementById('depositShowAmountAutoQris');

        if (amountInput && amountDisplay && amountHidden) {
            amountInput.addEventListener('input', function (e) {
                e.stopPropagation();

                // Remove all non-digits
                const val = this.value.replace(/\D/g, '');

                // Input: plain integer only
                this.value = val;

                if (val) {
                    // Display: formatted Rupiah (Rp 20.000)
                    const rupiah = parseInt(val) * CONFIG.CONVERSION_RATIO;
                    amountDisplay.value = 'Rp ' + rupiah.toLocaleString('id-ID');
                    // Hidden: SDK amount (20000)
                    amountHidden.value = rupiah;

                    console.log('[SPEED-QRIS] Input:', val, '→ Display:', amountDisplay.value, '→ SDK:', amountHidden.value);
                } else {
                    amountDisplay.value = '';
                    amountHidden.value = '';
                }

                // Remove active class from buttons when typing
                document.querySelectorAll('.qris-amount-btn').forEach(b => b.classList.remove('active'));

                // Check promotion min validation
                checkPromotionMinAmount();
            });
            console.log('[SPEED-QRIS] ✓ Input handler attached (3-field mode)');
        }

        // Hidden amount field handler - untuk button clicks
        if (amountHidden) {
            amountHidden.addEventListener('input', function (e) {
                // Check promotion min validation when amount changes
                checkPromotionMinAmount();
            });
        }

        // Promotion change handler - check min amount
        const promotionSelect = document.getElementById('depositPromotionAutoQris');
        if (promotionSelect) {
            promotionSelect.addEventListener('change', function (e) {
                checkPromotionMinAmount();
            });
            console.log('[SPEED-QRIS] ✓ Promotion handler attached');
        }

        // Function to check promotion min amount and show warning
        // Amount already in backend units (×1000)
        function checkPromotionMinAmount() {
            const promotionSelect = document.getElementById('depositPromotionAutoQris');
            const amountHidden = document.getElementById('depositAmountAutoQris');
            const submitBtn = form.querySelector('.qris-submit-btn');

            if (!promotionSelect || !promotionSelect.value || !amountHidden.value) {
                // Reset button if no promo selected or no amount
                if (submitBtn) {
                    submitBtn.style.opacity = '1';
                    submitBtn.style.cursor = 'pointer';
                }
                return;
            }

            const selectedOption = promotionSelect.options[promotionSelect.selectedIndex];
            const promoMin = selectedOption.getAttribute('data-min');
            const amount = parseInt(amountHidden.value); // Already backend units (20→20000)

            if (promoMin && amount) {
                const minAmount = parseInt(promoMin); // Backend units
                const minDisplay = Math.floor(minAmount / CONFIG.CONVERSION_RATIO); // Display units

                if (amount < minAmount) {
                    // Show visual warning
                    if (submitBtn) {
                        submitBtn.style.opacity = '0.6';
                        submitBtn.style.cursor = 'not-allowed';
                    }

                    // Show warning text
                    let warningDiv = document.getElementById('ug-promo-warning');
                    if (!warningDiv) {
                        warningDiv = document.createElement('div');
                        warningDiv.id = 'ug-promo-warning';
                        warningDiv.style.cssText = 'background: rgba(255,193,7,0.12); border: 1px solid #ffc107; color: #ffe082; padding: 10px; border-radius: 6px; margin-top: 10px; font-size: 13px;';
                        promotionSelect.parentNode.appendChild(warningDiv);
                    }
                    warningDiv.innerHTML = `⚠️ Promosi ini membutuhkan minimal deposit <strong>Rp ${minAmount.toLocaleString('id-ID')}</strong> (input: ${minDisplay})`;
                } else {
                    // Remove warning
                    if (submitBtn) {
                        submitBtn.style.opacity = '1';
                        submitBtn.style.cursor = 'pointer';
                    }

                    const warningDiv = document.getElementById('ug-promo-warning');
                    if (warningDiv) {
                        warningDiv.style.display = 'none';
                    }
                }
            }
        }

        // Button onclick sudah di-handle langsung di HTML, ga perlu addEventListener lagi!
        console.log('[SPEED-QRIS] ✓ All handlers attached!');

        // Form submit (with double-submit prevention)
        form.addEventListener('submit', async function (e) {
            e.preventDefault();
            e.stopPropagation();

            // CRITICAL: Prevent double submit (mobile issue)
            if (formSubmitInProgress) {
                console.warn('⚠️ [SPEED-QRIS] Form submit already in progress, ignoring...');
                return false;
            }
            formSubmitInProgress = true;
            console.log('🚀 [SPEED-QRIS] Form submit started (flag set)');

            const amount = parseInt(amountHidden.value); // Already backend units (×1000)

            // Validation (amount already in backend units)
            if (!amount || amount < CONFIG.MIN_AMOUNT) {
                alert(`❌ Minimal deposit ${CONFIG.MIN_DISPLAY} (= Rp ${CONFIG.MIN_AMOUNT.toLocaleString('id-ID')})`);
                formSubmitInProgress = false;
                return false;
            }

            if (amount > CONFIG.MAX_AMOUNT) {
                alert(`❌ Maksimal deposit ${CONFIG.MAX_DISPLAY} (= Rp ${CONFIG.MAX_AMOUNT.toLocaleString('id-ID')})`);
                formSubmitInProgress = false;
                return false;
            }

            // Promotion validation - check min amount
            const promotionSelect = document.getElementById('depositPromotionAutoQris');
            if (promotionSelect && promotionSelect.value) {
                const selectedOption = promotionSelect.options[promotionSelect.selectedIndex];
                const promoMin = selectedOption.getAttribute('data-min');

                if (promoMin) {
                    const minAmount = parseInt(promoMin); // Backend units
                    const minDisplay = Math.floor(minAmount / CONFIG.CONVERSION_RATIO); // Display
                    if (amount < minAmount) {
                        alert(`❌ Promosi "${selectedOption.textContent}" membutuhkan minimal deposit ${minDisplay} (= Rp ${minAmount.toLocaleString('id-ID')})\n\nSilakan tingkatkan jumlah deposit atau pilih promosi lain.`);
                        formSubmitInProgress = false;
                        return false;
                    }
                }
            }

            // Disable button
            const submitBtn = this.querySelector('.qris-submit-btn');
            submitBtn.disabled = true;
            btnText.textContent = 'Generating...';

            let restorePoppayFetchHook = null;

            try {
                // Load SDK
                if (typeof window.QrisSDK === 'undefined') {
                    console.log('📦 [SPEED-QRIS] Loading SDK...');
                    await loadQrisSDK();
                }

                // Get username fresh from session + API confirm (anti stale / random DOM)
                const username = await resolvePayUsernameForPayment();

                if (!username) {
                    throw new Error('Username session tidak valid. Logout → login ulang.');
                }
                await assertPayUsernameLocked(username);
                syncInjectUsernameDisplay(username);

                restorePoppayFetchHook = withPoppayCreateTransactionHook(username);

                // Hide form, show result
                formContainer.style.display = 'none';
                resultContainer.classList.add('active');

                // WAIT for container to be ready
                await new Promise(resolve => setTimeout(resolve, 100));

                // Verify container exists
                const container = document.getElementById('qris-payment-frame');
                if (!container) {
                    throw new Error('Container qris-payment-frame not found in DOM');
                }
                console.log('[SPEED-QRIS] Container verified:', container);

                // Get promotion value
                const promotionSelect = document.getElementById('depositPromotionAutoQris');
                const promotion = promotionSelect && promotionSelect.value ? promotionSelect.value : null;

                // Create payment - ALWAYS NEW invoice
                const invoice = (CONFIG.INVOICE_PREFIX || 'SPEED-') + Date.now();
                const displayInput = Math.floor(amount / CONFIG.CONVERSION_RATIO); // For logging (20)
                console.log('💳 [SPEED-QRIS] Creating payment:', { amount, displayInput, username, invoice, promotion });

                // pg-ppy-sdk: auth via store_key (bukan x-domain)
                const sdkConfig = {
                    healthCheckEnabled: false,
                    storeKey: STORE_KEY,
                    store_key: STORE_KEY,
                    amount: amount,
                    invoice: invoice,
                    notes: `Speed Auto Deposit - ${invoice}`,
                    username: username,
                    payor_name: username,
                    payor_email: '',
                    displayMode: 'inline',
                    containerId: 'qris-payment-frame',
                    resultContainerId: 'payment-result'
                };

                // Add promotion if selected (only if not empty)
                if (promotion) {
                    sdkConfig.promotion = promotion;
                    console.log('🎁 [SPEED-QRIS] Promotion added:', promotion);
                }

                sdkConfig.onSuccess = (data) => {
                    console.log('✅ [SPEED-QRIS] Payment success:', data);

                    // Display amount in Rupiah (already backend units)
                    document.getElementById('payment-result').innerHTML = `
                        <div class="ug-qris-success-box">
                            <h4>✅ Pembayaran Berhasil!</h4>
                            <p>Deposit Rp ${amount.toLocaleString('id-ID')} sedang diproses</p>
                        </div>
                    `;

                    setTimeout(() => {
                        resetForm();
                        formSubmitInProgress = false;
                        console.log('✅ [SPEED-QRIS] Submit flag reset (success)');
                    }, 5000);
                };

                sdkConfig.onFailed = (error) => {
                    console.error('❌ [SPEED-QRIS] Payment failed:', error);
                    alert('Gagal membuat QR Code. Silakan coba lagi.');
                    resetForm();
                    formSubmitInProgress = false;
                    console.log('✅ [SPEED-QRIS] Submit flag reset (failed)');
                };

                sdkConfig.onCancel = () => {
                    console.log('ℹ️ [SPEED-QRIS] Payment cancelled');
                    resetForm();
                    formSubmitInProgress = false;
                    console.log('✅ [SPEED-QRIS] Submit flag reset (cancelled)');
                };

                const payment = new window.QrisSDK(sdkConfig);
                payment.openPayment();

                // Reset flag after SDK initialized (QR shown)
                setTimeout(() => {
                    formSubmitInProgress = false;
                    console.log('✅ [SPEED-QRIS] Submit flag reset (SDK opened)');
                }, 2000);

            } catch (error) {
                console.error('❌ [SPEED-QRIS] Error:', error);
                alert(error?.message || 'Terjadi kesalahan. Silakan coba lagi.');
                resetForm();
                formSubmitInProgress = false;
                console.log('✅ [SPEED-QRIS] Submit flag reset (error)');
            } finally {
                if (restorePoppayFetchHook) restorePoppayFetchHook();
            }

            return false;
        });

        function resetForm() {
            formContainer.style.display = 'block';
            resultContainer.classList.remove('active');
            document.getElementById('qris-payment-frame').innerHTML = '';
            document.getElementById('payment-result').innerHTML = '';

            const amountInput = document.getElementById('depositInputAutoQris');
            const amountShow = document.getElementById('depositShowAmountAutoQris');
            const amountHidden = document.getElementById('depositAmountAutoQris');

            if (amountInput) amountInput.value = '';
            if (amountShow) amountShow.value = '';
            if (amountHidden) amountHidden.value = '';

            // Reset promotion select
            const promotionSelect = document.getElementById('depositPromotionAutoQris');
            if (promotionSelect) {
                promotionSelect.value = '';
            }

            document.querySelectorAll('.qris-amount-btn').forEach(b => b.classList.remove('active'));
            const submitBtn = form.querySelector('.qris-submit-btn');
            submitBtn.disabled = false;
            btnText.textContent = 'Generate QR Code';
        }
    }

    // ========================================================================
    // Load QRIS SDK
    // ========================================================================
    function loadQrisSDK() {
        return new Promise((resolve, reject) => {
            if (typeof window.QrisSDK !== 'undefined') {
                resolve();
                return;
            }

            const QRIS_SDK_URL = (
                getParamFromCurrentScript('sdk_url') ||
                window.PGSCRIPT_SDK_URL ||
                'https://unpkg.com/@poppackage/pg-ppy-sdk@1.0.0/dist/qris-sdk.umd.js'
            ).toString().trim();

            const script = document.createElement('script');
            script.src = QRIS_SDK_URL;
            script.onload = () => {
                console.log('✅ [SPEED-QRIS] SDK loaded');
                resolve();
            };
            script.onerror = () => {
                console.error('❌ [SPEED-QRIS] SDK load failed');
                reject(new Error('Failed to load SDK'));
            };

            document.head.appendChild(script);
        });
    }

    // ========================================================================
    // Global State
    // ========================================================================
    let isInjected = false;
    let observer = null;
    let reinjectionInProgress = false;
    let lifecycleStarted = false; // monitors sekali saja (interval/observer/click)
    let activateInFlight = false;
    let buttonHandlersAttached = false; // Prevent duplicate button attachment
    let formSubmitInProgress = false; // Prevent double submit

    // ========================================================================
    // Activate on deposit page (bisa dipanggil ulang saat SPA soft-nav)
    // ========================================================================

    async function activateOnDeposit(reason) {
        if (activateInFlight) return;
        activateInFlight = true;
        try {
            console.log(`🔄 [SPEED-QRIS] activateOnDeposit (${reason || 'n/a'})...`);

            const paymentHealthOk = await checkPaymentHealth();
            if (!paymentHealthOk) {
                teardownInjection();
                return;
            }

            const isValid = await validateUsernameExists();
            if (!isValid) {
                console.error('❌ [SPEED-QRIS] INJECTION ABORTED - No username detected');
                return;
            }

            // Form handlers harus bisa re-bind ke DOM baru setelah SPA remount
            handlersAttached = false;
            buttonHandlersAttached = false;
            formSubmitInProgress = false;

            if (AUTO_SELECT_QRIS_TAB && !isQRISTabActive()) {
                const qr = document.getElementById('deposit-qr-tab');
                if (qr) {
                    console.log('[SPEED-QRIS] AUTO_SELECT_QRIS_TAB → click #deposit-qr-tab');
                    try { qr.click(); } catch (e) { }
                    await new Promise((r) => setTimeout(r, 400));
                }
            }

            await syncInjectionToQRISTab(reason || 'Activate');
            if (!isQRISTabActive()) {
                console.log('ℹ️ [SPEED-QRIS] Menunggu user klik tab QRIS (#deposit-qr-tab)...');
            }

            ensureLifecycleMonitors();
        } finally {
            activateInFlight = false;
        }
    }

    function ensureLifecycleMonitors() {
        if (lifecycleStarted) return;
        lifecycleStarted = true;
        console.log('🔄 [SPEED-QRIS] Starting persistent monitors (QRIS-tab only)...');

        // Tab monitoring: QRIS = inject, tab lain = teardown
        function monitorManualPaymentClicks() {
            console.log('🔍 [SPEED-QRIS] Setting up QRIS-only tab monitoring...');

            const onTabChange = (source) => {
                [50, 150, 350, 700, 1200].forEach((delay) => {
                    setTimeout(() => {
                        syncInjectionToQRISTab(source + '@' + delay).catch(() => { });
                    }, delay);
                });
            };

            document.addEventListener('click', function (e) {
                const tab = e.target.closest(
                    '#deposit-bank-tab, #deposit-qr-tab, #deposit-va-tab, #deposit-ewallet-tab, #deposit-pulsa-tab, .sidebar_deposit'
                );
                if (!tab) return;
                if (tab.closest('#ug-poppay-wrapper') || tab.closest('#ug-poppay-qris-full')) return;

                const isQr = !!(tab.id === 'deposit-qr-tab' || tab.closest('#deposit-qr-tab'));
                console.log(`⚠️ [SPEED-QRIS] Tab click → ${isQr ? 'QRIS (inject)' : 'other (teardown)'}`);
                onTabChange(isQr ? 'QRISClick' : 'OtherTab');
            }, true);

            console.log('✅ [SPEED-QRIS] Click monitoring active (QRIS-only)');
        }

        monitorManualPaymentClicks();

        setInterval(async () => {
            try {
                const healthOk = await checkPaymentHealth();
                if (!healthOk) {
                    teardownInjection();
                    return;
                }

                if (!isDepositPage()) {
                    if (isInjected) teardownInjection();
                    return;
                }

                // SPA remount: wrapper hilang tapi masih di /deposit + tab QRIS
                await syncInjectionToQRISTab('Interval');
            } catch (_) { }
        }, 1500);
        console.log('✅ [SPEED-QRIS] Interval monitoring active (1.5s, QRIS-only)');

        observer = new MutationObserver(() => {
            if (reinjectionInProgress) return;
            if (!isDepositPage()) return;

            const qrTab = document.getElementById('deposit-qr-tab');
            if (qrTab) {
                qrTab.style.display = '';
                qrTab.style.visibility = '';
                qrTab.removeAttribute('data-poppay-hidden');
            }

            if (!isQRISTabActive()) {
                if (document.getElementById('ug-poppay-wrapper')) {
                    teardownInjection();
                }
                return;
            }

            const wrapper = document.getElementById('ug-poppay-wrapper');
            const inner = document.getElementById('ug-poppay-qris-full');
            if ((!wrapper || !inner) && !reinjectionInProgress) {
                reinjectionInProgress = true;
                (async () => {
                    try {
                        await syncInjectionToQRISTab('MutationObserver');
                    } finally {
                        reinjectionInProgress = false;
                    }
                })();
            }
        });

        observer.observe(document.documentElement || document.body, {
            childList: true,
            subtree: true
        });

        console.log('✅ [SPEED-QRIS] Persistent injection active (QRIS tab only)');
    }

    // Start with retry mechanism
    let retryCount = 0;

    async function tryStart(reason) {
        console.log('🎯 [SPEED-QRIS] tryStart...', reason || '');

        if (CONFIG.REQUIRE_DEPOSIT_PAGE && !isDepositPage()) {
            console.log('[SPEED-QRIS] ⛔ Not on deposit page — skip (path=' + window.location.pathname + ')');
            if (isInjected) teardownInjection();
            return;
        }

        const paymentHealthOk = await checkPaymentHealth();
        if (!paymentHealthOk) {
            teardownInjection();
            return;
        }

        const hasUsername = await validateUsernameExists();
        if (!hasUsername) {
            console.error('❌ [SPEED-QRIS] SCRIPT DISABLED - Username not found');
            console.error('❌ [SPEED-QRIS] Tip: window.SPEED_USERNAME = "userxxx" sebelum load script, atau pastikan login');
            // SPA: DOM login header kadang belom siap — retry sebentar
            if (retryCount < CONFIG.MAX_RETRIES) {
                retryCount++;
                setTimeout(() => tryStart('username-retry'), CONFIG.RETRY_DELAY);
            }
            return;
        }
        const strictUser = resolveSessionUsernameStrict();
        if (strictUser.ok && strictUser.u) syncInjectUsernameDisplay(strictUser.u);

        const stableContainer = findStableContainer();
        if (stableContainer || retryCount >= CONFIG.MAX_RETRIES) {
            console.log('✅ [SPEED-QRIS] Ready — container found or max retries');
            retryCount = 0;
            await activateOnDeposit(reason || 'tryStart');
        } else {
            retryCount++;
            console.log(`🔄 [SPEED-QRIS] Waiting for deposit DOM... (${retryCount}/${CONFIG.MAX_RETRIES})`);
            setTimeout(() => tryStart(reason || 'dom-wait'), CONFIG.RETRY_DELAY);
        }
    }

    /** Dipanggil tiap soft-nav (Next.js) masuk/keluar deposit */
    function onSpaRoute(reason) {
        // Selama script hidup: jaga address bar biar F5 kena index (widget)
        maskNonIndexUrl();

        retryCount = 0;
        if (!isDepositPage()) {
            if (isInjected || document.getElementById('ug-poppay-wrapper')) {
                console.log(`[SPEED-QRIS] SPA leave deposit (${reason}) → teardown`);
                teardownInjection();
            }
            return;
        }
        console.log(`[SPEED-QRIS] SPA → deposit (${reason}), schedule re-inject`);
        refreshInjectUsernameFromSessionAsync('spa-deposit', false).catch(() => { });
        // Next.js sering mount form telat — beberapa attempt
        [200, 700, 1500, 2800].forEach((delay) => {
            setTimeout(() => tryStart(`${reason}@${delay}`), delay);
        });
    }

    // ========================================================================
    // INDEX-ONLY WIDGET WORKAROUND
    // Script cuma load di index. Mask URL page lain → /?speed_rejoin=/path
    // Refresh = load index + widget, lalu soft-nav balik ke path semula.
    // ========================================================================
    function isIndexPath(pathname) {
        const p = (pathname || '/').replace(/\/+$/, '') || '/';
        return p === '/' || p === '/index' || p === '/index.html' || p === '/home';
    }

    function getRejoinTarget() {
        try {
            return new URLSearchParams(location.search).get(REJOIN_PARAM) || '';
        } catch (_) {
            return '';
        }
    }

    function maskNonIndexUrl() {
        if (!MASK_URL_TO_INDEX) return;
        const path = location.pathname || '/';
        if (isIndexPath(path)) return;
        if (path.startsWith('/_next') || path.startsWith('/api') || path.startsWith('/static')) return;

        const realPath = path + (location.search || '');
        const already = getRejoinTarget();
        if (already === path || already === realPath || already === path + '/') return;

        const nextUrl = '/?' + REJOIN_PARAM + '=' + encodeURIComponent(path);
        console.log('[SPEED-QRIS] URL mask (F5→index):', path, '→', nextUrl);
        try {
            const state = Object.assign({}, history.state || {}, { speedMasked: true, real: path });
            history.replaceState(state, '', nextUrl);
        } catch (e) {
            console.warn('[SPEED-QRIS] mask failed', e);
        }
    }

    function softNavigateTo(path) {
        let target = path || '/deposit';
        try { target = decodeURIComponent(target); } catch (_) { }
        if (!target.startsWith('/')) target = '/' + target;
        target = target.split('?')[0].split('#')[0] || '/deposit';
        console.log('[SPEED-QRIS] soft-nav →', target);

        const go = () => {
            try {
                if (window.next && window.next.router && typeof window.next.router.push === 'function') {
                    window.next.router.push(target);
                    return true;
                }
            } catch (_) { }
            const links = document.querySelectorAll('a[href]');
            for (let i = 0; i < links.length; i++) {
                const href = links[i].getAttribute('href') || '';
                if (href === target || href === target + '/' || href.replace(/\/+$/, '') === target) {
                    links[i].click();
                    return true;
                }
            }
            return false;
        };

        if (go()) {
            setTimeout(maskNonIndexUrl, 400);
            setTimeout(maskNonIndexUrl, 1200);
            setTimeout(() => tryStart('soft-nav'), 800);
            return;
        }
        let n = 0;
        const timer = setInterval(() => {
            n++;
            if (go() || n >= 30) {
                clearInterval(timer);
                setTimeout(maskNonIndexUrl, 400);
                setTimeout(() => tryStart('soft-nav-late'), 600);
            }
        }, 250);
    }

    function consumeRejoinFromIndex() {
        if (!MASK_URL_TO_INDEX) return false;
        if (!isIndexPath(location.pathname)) return false;
        const rejoin = getRejoinTarget();
        if (!rejoin) return false;
        let dest = rejoin;
        try { dest = decodeURIComponent(rejoin); } catch (_) { }
        const destPath = (dest.split('?')[0] || '').replace(/\/+$/, '') || '/';
        if (isIndexPath(destPath)) return false;

        console.log('[SPEED-QRIS] Index + rejoin param → soft-nav', destPath);
        [500, 1200, 2500, 4000].forEach((ms) => {
            setTimeout(() => softNavigateTo(destPath), ms);
        });
        return true;
    }

    function installSpaHooks() {
        let lastKey = location.pathname + location.search + location.hash;
        const check = (why) => {
            const key = location.pathname + location.search + location.hash;
            const changed = key !== lastKey;
            lastKey = key;
            // Mask dulu supaya F5 selalu ke index
            maskNonIndexUrl();
            if (changed || why === 'force' || why === 'link-deposit' || why === 'poll') {
                if (changed || why === 'force' || why === 'link-deposit') {
                    onSpaRoute(why + (changed ? '' : '-sameurl'));
                } else if (isDepositPage()) {
                    // poll: tetap sync inject kalau DOM deposit ada
                    syncInjectionToQRISTab('poll').catch(() => { });
                }
            }
        };

        const wrapHistory = (fnName) => {
            const orig = history[fnName];
            if (typeof orig !== 'function' || orig.__speedPatched) return;
            const wrapped = function () {
                const ret = orig.apply(this, arguments);
                setTimeout(() => check(fnName), 0);
                setTimeout(() => check(fnName + '-late'), 500);
                return ret;
            };
            wrapped.__speedPatched = true;
            history[fnName] = wrapped;
        };
        wrapHistory('pushState');
        wrapHistory('replaceState');
        window.addEventListener('popstate', () => check('popstate'));

        document.addEventListener('click', (e) => {
            const a = e.target.closest('a[href]');
            if (!a) return;
            const href = (a.getAttribute('href') || '') + ' ' + (a.href || '');
            if (!/deposit/i.test(href)) return;
            setTimeout(() => check('link-deposit'), 50);
            setTimeout(() => check('link-deposit'), 400);
            setTimeout(() => check('link-deposit'), 1200);
            setTimeout(() => check('link-deposit'), 2500);
        }, true);

        setInterval(() => check('poll'), 1000);

        window.SPEED_QRIS_REBOOT = () => {
            retryCount = 0;
            handlersAttached = false;
            teardownInjection();
            onSpaRoute('manual-reboot');
        };

        console.log('✅ [SPEED-QRIS] SPA hooks + index URL-mask installed');
    }

    // Start + SPA soft-nav watch (Next.js — tanpa full refresh)
    function boot() {
        installSpaHooks();
        // Kalau F5 dari /deposit → land di /?speed_rejoin=/deposit → soft-nav balik
        consumeRejoinFromIndex();
        maskNonIndexUrl();
        setTimeout(() => tryStart('boot'), 800);
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', boot);
    } else {
        boot();
    }

    window.SPEED_QRIS_USERNAME_DEBUG = function () {
        const sig = typeof collectSessionUsernameSignals === 'function'
            ? collectSessionUsernameSignals()
            : {};
        const strict = typeof resolveSessionUsernameStrict === 'function'
            ? resolveSessionUsernameStrict()
            : null;
        return {
            version: 'speednewv1-1.3.0',
            strict,
            signals: sig,
            cached: typeof _cachedUsername !== 'undefined' ? _cachedUsername : '',
            display: document.getElementById('speedQrisUsernameDisplay')?.value || '',
            hidden: document.getElementById('speedQrisUsername')?.value || '',
        };
    };

})();
