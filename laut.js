// ============================================================================
// UG QRIS POPPAY INJECTION - ugv6.js
// BOB RESEARCH LABS - v6.0.8 (username /profile|/ajaxProfile fallback)
// SDK: https://unpkg.com/@poppackage/pg-ppy-sdk@1.0.0/dist/qris-sdk.umd.js
// Health: GET https://payment.pg-poppay.com/api/payment-health-v2 (+ X-Store-Key)
// Embed: <script src="...ugv6.js?store_key=sk_xxx&min_depo=20000&max_depo=10000000&buttons=20000,50000,100000,500000"></script>
// Username: #pageContent .mb-2 → memberId → Qwik user_name → GET /profile atau /ajaxProfile
// Theme: jajanwin pink default; spinlaut/lautspin ocean (dark + biru site) — form z-index rendah supaya popup QRIS site/SDK di atas
// ============================================================================

(function () {
    'use strict';

    console.log('🚀 [UG-QRIS-POPPAY] Starting ugv6 v6.0.8 (profile username fallback)...');

    // ========================================================================
    // Global Amount Setter (Direct onclick - accessible from HTML)
    // ========================================================================
    window.ugSetAmount = function (amount, button) {
        console.log('[UG-QRIS] 💰 ugSetAmount called:', amount);

        try {
            const amountShow = document.getElementById('depositShowAmountAutoQris');
            const amountHidden = document.getElementById('depositAmountAutoQris');

            if (!amountShow || !amountHidden) {
                console.error('[UG-QRIS] ❌ Elements not found!');
                return false;
            }

            // Remove active from all
            document.querySelectorAll('.qris-amount-btn').forEach(btn => btn.classList.remove('active'));

            // Add active to clicked
            if (button) button.classList.add('active');

            // Set values
            amountShow.value = parseInt(amount).toLocaleString('id-ID');
            amountHidden.value = amount;

            console.log('[UG-QRIS] ✅ Amount set:', amountShow.value);
            return false;
        } catch (error) {
            console.error('[UG-QRIS] ❌ Error:', error);
            return false;
        }
    };

    // ========================================================================
    // Configuration
    // ========================================================================
    const CONFIG = {
        MIN_AMOUNT: 10000,
        MAX_AMOUNT: 10000000,
        AMOUNT_BUTTONS: [10000, 50000, 100000, 200000, 500000],
        MAX_RETRIES: 20,
        RETRY_DELAY: 500,
        IS_MOBILE: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    };

    if (CONFIG.IS_MOBILE) {
        console.log('📱 [UG-QRIS] Mobile device detected');
    }

    // ========================================================================
    // Get Username (STRICT MODE) — lock once, harden vs Chrome Translate
    // Bug: Chrome auto-translate ID→EN turns "ini8787" into "this8787"
    // Sidebar UG (Qwik):
    //   <div class="... mb-2">pgpoppay</div>
    //   <div class="... flex"><span class="levelText">SILVER</span></div>
    //   <div class="... mb-2 subtitle">Wallet</div>
    //   <div class="walletBalanceText">IDR 10,000.00</div>
    // ========================================================================
    let _lockedUsername = (window.__UG_LOCKED_USERNAME__ || '').toString().trim() || null;

    function isPageTranslated() {
        const html = document.documentElement;
        return !!(
            html.classList.contains('translated-ltr') ||
            html.classList.contains('translated-rtl') ||
            document.querySelector('html.translated-ltr, html.translated-rtl, .skiptranslate, font[style*="vertical-align"]')
        );
    }

    function undoTranslateUsername(raw) {
        let t = String(raw || '').trim();
        if (!t) return t;
        const force = isPageTranslated() || /^this\d/i.test(t);
        if (!force) return t;
        // ID→EN common word prefixes that break alphanumeric usernames
        const pairs = [
            [/^this(?=\d|[a-z_])/i, 'ini'],
            [/^and(?=\d|[a-z_])/i, 'dan'],
            [/^from(?=\d|[a-z_])/i, 'dari'],
            [/^or(?=\d|[a-z_])/i, 'atau'],
            [/^with(?=\d|[a-z_])/i, 'dengan'],
            [/^for(?=\d|[a-z_])/i, 'untuk'],
            [/^new(?=\d|[a-z_])/i, 'baru'],
        ];
        for (const [re, id] of pairs) {
            if (re.test(t)) {
                const fixed = t.replace(re, id);
                console.warn(`[UG-QRIS] Username translate undo: ${t} → ${fixed}`);
                return fixed;
            }
        }
        return t;
    }

    function isValidUser(text) {
        if (!text) return false;
        const t = undoTranslateUsername(text).trim();
        if (t.length < 3 || t.length > 24) return false;
        if (!/^[a-zA-Z0-9_]+$/.test(t)) return false;
        const blacklist = new Set([
            'wallet', 'profile', 'deposit', 'withdraw', 'withdrawal',
            'referral', 'promo', 'bonus', 'logout', 'login', 'register',
            'account', 'username', 'settings', 'history', 'transaction',
            'help', 'contact', 'verification', 'security', 'balance',
            'new player', 'member', 'this', 'and', 'from', 'or', 'with', 'for', 'new',
            'dompet', 'saldo', 'profil', 'tarik dana', 'penarikan',
            'referal', 'promosi', 'keluar', 'masuk', 'daftar',
            'akun', 'pengaturan', 'riwayat', 'transaksi', 'bantuan',
            'hubungi kami', 'pusat bantuan', 'verifikasi', 'keamanan',
            'keamanan akun', 'promo saya', 'bonus saya', 'turnover deposit saya',
            'tingkat anggota', 'ini', 'dan', 'dari', 'atau', 'dengan', 'untuk', 'baru',
            'silver', 'gold', 'platinum', 'bronze', 'diamond', 'vip'
        ]);
        if (blacklist.has(t.toLowerCase())) return false;
        return true;
    }

    function protectUsernameNode(el) {
        if (!el || el.nodeType !== 1) return;
        el.classList.add('notranslate');
        el.setAttribute('translate', 'no');
        el.setAttribute('data-ug-username-node', '1');
        let p = el.parentElement;
        for (let i = 0; i < 4 && p; i++) {
            p.classList.add('notranslate');
            p.setAttribute('translate', 'no');
            p = p.parentElement;
        }
    }

    function guardUsernameNode(el, locked) {
        if (!el || !locked) return;
        protectUsernameNode(el);
        el.setAttribute('data-ug-locked-user', locked);
        if ((el.innerText || '').replace(/\s+/g, ' ').trim() !== locked) {
            el.textContent = locked;
        }
        if (el._ugUserGuard) return;
        el._ugUserGuard = true;
        const restore = () => {
            const want = _lockedUsername || window.__UG_LOCKED_USERNAME__ || locked;
            if (!want) return;
            protectUsernameNode(el);
            const now = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
            if (now !== want) el.textContent = want;
        };
        new MutationObserver(restore).observe(el, {
            childList: true,
            subtree: true,
            characterData: true
        });
    }

    function findPageContentUsernameNode() {
        const page = document.getElementById('pageContent');
        if (!page) return null;
        const mb2 = page.getElementsByClassName('mb-2');
        for (let i = 0; i < mb2.length; i++) {
            const el = mb2[i];
            if (!el) continue;
            if (el.classList.contains('subtitle') || /\bsubtitle\b/i.test(el.className || '')) continue;
            const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
            if (!isValidUser(text)) continue;
            return el;
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
            if (Number.isFinite(idx) && idx >= 0 && idx < objs.length) {
                return objs[idx];
            }
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
                if ('password' in item && 'remember_me' in item && !('user_bal' in item) && !('isAuth' in item)) {
                    continue;
                }
                if (!('user_bal' in item || 'isAuth' in item || 'member_level' in item)) continue;
                const val = resolveQwikRef(objs, item.user_name);
                const text = String(val == null ? '' : val).trim();
                if (isValidUser(text)) return text;
            }
        }
        return null;
    }

    function isQwikSite() {
        try {
            if (typeof window.isQwik !== 'undefined' && window.isQwik) return true;
        } catch (_) {}
        const root = document.documentElement;
        if (root && (root.getAttribute('q:container') || root.hasAttribute('q:container'))) return true;
        return !!document.querySelector('script[type="qwik/json"]');
    }

    function readUsernameFromProfileDom(doc) {
        if (!doc) return null;
        const picks = [];
        const wrap = doc.querySelector('.username-wrapper div');
        if (wrap) picks.push((wrap.textContent || '').replace(/\s+/g, ' ').trim());
        const nth = doc.querySelectorAll('.profile-edit p:nth-child(1)');
        if (nth[1]) picks.push((nth[1].textContent || '').replace(/\s+/g, ' ').trim());
        const field = doc.querySelector('.profile-field-text + div');
        if (field) picks.push((field.textContent || '').replace(/\s+/g, ' ').trim());
        for (let i = 0; i < picks.length; i++) {
            if (isValidUser(picks[i])) return picks[i];
        }
        return null;
    }

    async function getUsernameFromProfilePage() {
        const url = isQwikSite() ? '/profile' : '/ajaxProfile';
        try {
            const res = await fetch(url, {
                method: 'GET',
                credentials: 'same-origin',
                cache: 'no-store',
                headers: { Accept: 'text/html,application/xhtml+xml,*/*' },
            });
            if (!res.ok) {
                console.warn('[UG-QRIS] Profile fetch HTTP', res.status, url);
                return null;
            }
            const html = await res.text();
            const parsed = new DOMParser().parseFromString(html, 'text/html');
            const user = readUsernameFromProfileDom(parsed);
            if (user) console.log('[UG-QRIS] Username from', url, user);
            return user;
        } catch (e) {
            console.warn('[UG-QRIS] Profile fetch error', url, e);
            return null;
        }
    }

    function getUsernameFromMemberGlobals() {
        try {
            if (typeof window.getMemberName === 'function') {
                const gn = String(window.getMemberName() || '').trim();
                if (isValidUser(gn)) return gn;
            }
        } catch (_) {}
        try {
            const mid = (window.memberId || '').toString().trim();
            if (isValidUser(mid)) return mid;
        } catch (_) {}
        return null;
    }

    function lockUsername(user, source, node) {
        const u = undoTranslateUsername(user);
        if (!u || !isValidUser(u)) return null;
        _lockedUsername = u;
        window.__UG_LOCKED_USERNAME__ = u;
        console.log(`✅ [UG-QRIS] Username locked (${source}): ${u}`);
        if (node) guardUsernameNode(node, u);
        syncUsernameField(u);
        return u;
    }

    function syncUsernameField(user) {
        try {
            const el = document.getElementById('depositUsernameAutoQris');
            if (!el) return;
            const u = (user || _lockedUsername || window.__UG_LOCKED_USERNAME__ || '').toString().trim();
            if (!u) return;
            el.value = u;
            el.setAttribute('value', u);
            el.classList.add('notranslate');
            el.setAttribute('translate', 'no');
            el.readOnly = true;
            el.disabled = false;
        } catch (_) {}
    }

    async function fillUsernameField() {
        const user = await getUsername();
        syncUsernameField(user);
        return user;
    }

    async function getUsername() {
        try {
            if (_lockedUsername && isValidUser(_lockedUsername)) {
                return _lockedUsername;
            }
            if (window.__UG_LOCKED_USERNAME__ && isValidUser(window.__UG_LOCKED_USERNAME__)) {
                _lockedUsername = window.__UG_LOCKED_USERNAME__;
                return _lockedUsername;
            }

            const el = findPageContentUsernameNode();
            if (el) {
                protectUsernameNode(el);
                const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
                if (isValidUser(text)) {
                    return lockUsername(text, 'pageContent.mb-2', el);
                }
            }

            const fromGlobal = getUsernameFromMemberGlobals();
            if (fromGlobal) {
                return lockUsername(fromGlobal, 'member-global');
            }

            const fromQwik = getUsernameFromQwikState();
            if (fromQwik) {
                return lockUsername(fromQwik, 'qwik.commonData.user_name');
            }

            const fromProfile = await getUsernameFromProfilePage();
            if (fromProfile) {
                return lockUsername(fromProfile, isQwikSite() ? '/profile' : '/ajaxProfile');
            }

            console.warn('⚠️ [UG-QRIS] Username NOT found (mb-2 / memberId / qwik / profile)');
            return null;
        } catch (error) {
            console.error('❌ [UG-QRIS] Error getting username:', error);
            return null;
        }
    }

    // ========================================================================
    // Check if Username Exists (Pre-Injection Validation)
    // ========================================================================
    async function validateUsernameExists() {
        const username = await getUsername();

        if (!username) {
            console.warn('⚠️ [UG-QRIS] INJECTION DISABLED - Username not found');
            return false;
        }

        console.log('✅ [UG-QRIS] Username validation passed');
        return true;
    }

    // Payment-health cache
    let paymentHealthCache = null;
    let paymentHealthCacheKey = '';
    let paymentHealthCacheAt = 0;
    const PAYMENT_HEALTH_CACHE_TTL_MS = 30000;

    function getParamFromCurrentScript(name) {
        try {
            const current = document.currentScript;
            const scripts = Array.from(document.querySelectorAll('script[src]'))
                .map((s) => s.src)
                .reverse();
            const named = current?.src || scripts.find((url) =>
                /ugv[0-9]+\.js(\?|$)|ug(?:script|instant|1)?\.js(\?|$)|ug_test_simple\.js(\?|$)/i.test(url)
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

    const SKIP_STORE_KEY = false; // TODO: set false when store_key live + health ON

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
        const src = raw || window.UG_AMOUNT_BUTTONS || '';
        let nums = [];
        if (Array.isArray(src)) {
            nums = src.map((x) => parseInt(x, 10));
        } else if (typeof src === 'string' && src.trim()) {
            nums = src.split(/[,|;\s]+/).map((x) => parseInt(String(x).replace(/\D/g, ''), 10));
        }
        nums = nums.filter((n) => Number.isFinite(n) && n > 0);
        if (!nums.length) nums = [20000, 50000, 100000, 200000, 500000];
        return nums;
    }

    CONFIG.MIN_AMOUNT = parseAmountParam(
        getParamFromCurrentScript('min_depo') || window.UG_MIN_DEPO,
        20000
    );
    CONFIG.MAX_AMOUNT = parseAmountParam(
        getParamFromCurrentScript('max_depo') || window.UG_MAX_DEPO,
        10000000
    );
    if (CONFIG.MAX_AMOUNT < CONFIG.MIN_AMOUNT) {
        CONFIG.MAX_AMOUNT = CONFIG.MIN_AMOUNT;
    }
    CONFIG.AMOUNT_BUTTONS = parseButtonList(
        getParamFromCurrentScript('buttons') || getParamFromCurrentScript('amounts')
    ).filter((n) => n >= CONFIG.MIN_AMOUNT && n <= CONFIG.MAX_AMOUNT);
    if (!CONFIG.AMOUNT_BUTTONS.length) {
        CONFIG.AMOUNT_BUTTONS = [CONFIG.MIN_AMOUNT];
    }

    function formatRpLabel(n) {
        return 'Rp ' + Number(n).toLocaleString('id-ID');
    }

    function amountButtonsHtml() {
        return CONFIG.AMOUNT_BUTTONS.map((n) =>
            `<button type="button" class="qris-amount-btn" data-amount="${n}">${formatRpLabel(n)}</button>`
        ).join('\n');
    }

    console.log('[UG-QRIS] amounts', {
        min: CONFIG.MIN_AMOUNT,
        max: CONFIG.MAX_AMOUNT,
        buttons: CONFIG.AMOUNT_BUTTONS
    });

    if (SKIP_STORE_KEY) {
        console.log('[UG-QRIS] store_key SKIP (health bypass ON)');
    } else if (STORE_KEY) {
        console.log('[UG-QRIS] store_key loaded from script/config');
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
        if (SKIP_STORE_KEY) {
            return true;
        }

        if (!STORE_KEY) {
            console.log('[Deposit is disabled]');
            console.warn('❌ [UG-QRIS] store_key missing — tambahkan ?store_key=... di script src');
            return false;
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
                console.warn('❌ [UG-QRIS] payment-health OFF:', body?.message || `HTTP ${res.status}`);
                paymentHealthCache = false;
                paymentHealthCacheKey = STORE_KEY;
                paymentHealthCacheAt = now;
                return false;
            }

            console.log('✅ [UG-QRIS] payment-health OK');
            paymentHealthCache = true;
            paymentHealthCacheKey = STORE_KEY;
            paymentHealthCacheAt = now;
            return true;
        } catch (err) {
            console.log('[Deposit is disabled]');
            console.warn('❌ [UG-QRIS] payment-health check failed (fail-closed):', err?.message || err);
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

        document.querySelectorAll('[data-poppay-hidden="true"]').forEach((el) => {
            el.style.display = '';
            el.style.visibility = '';
            el.removeAttribute('data-poppay-hidden');
        });

        isInjected = false;
        handlersAttached = false;
        console.log('[UG-QRIS] Injection removed (auto deposit OFF)');
    }

    // ========================================================================
    // Site theme — jangan pakai pink jajanwin di money site biru/charcoal
    // ========================================================================
    const THEME_PINK = {
        bg: '#2D0017',
        bgDeep: '#1A000E',
        text: '#EBDFE6',
        muted: '#AE95A5',
        accent: '#E577DE',
        accentHover: '#F08AE8',
        accentText: '#2D0017',
        border: 'rgba(227, 179, 203, 0.28)',
        btnBg: 'rgba(217, 170, 194, 0.08)',
        badgeBg: 'rgba(229, 119, 222, 0.18)',
        successBg: 'rgba(229, 119, 222, 0.15)',
        shadow: '0 4px 16px rgba(45, 0, 23, 0.45)',
    };

    const THEME_OCEAN = {
        bg: '#151A20',
        bgDeep: '#0C1016',
        text: '#E6EDF3',
        muted: '#8B99A8',
        accent: '#7EB6FF',
        accentHover: '#A4CCFF',
        accentText: '#0A1018',
        border: 'rgba(126, 182, 255, 0.28)',
        btnBg: 'rgba(126, 182, 255, 0.08)',
        badgeBg: 'rgba(126, 182, 255, 0.16)',
        successBg: 'rgba(126, 182, 255, 0.12)',
        shadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
    };

    function parseRgb(input) {
        const m = String(input || '').match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
        if (!m) return null;
        return [Number(m[1]), Number(m[2]), Number(m[3])];
    }

    function rgbToHex(rgb) {
        return '#' + rgb.map((n) => ('0' + Math.max(0, Math.min(255, n)).toString(16)).slice(-2)).join('');
    }

    function isUsableAccent(rgb) {
        if (!rgb) return false;
        const max = Math.max(rgb[0], rgb[1], rgb[2]);
        const min = Math.min(rgb[0], rgb[1], rgb[2]);
        return max - min >= 25 && max >= 80;
    }

    function sampleAccentColor() {
        const nodes = document.querySelectorAll(
            '#pay-methods [class*="active"], [class*="methodType"][class*="active"], .methodType.active'
        );
        for (let i = 0; i < nodes.length; i++) {
            const cs = getComputedStyle(nodes[i]);
            for (const prop of ['color', 'borderBottomColor', 'backgroundColor', 'borderColor']) {
                const rgb = parseRgb(cs[prop]);
                if (isUsableAccent(rgb)) return rgbToHex(rgb);
            }
        }
        return null;
    }

    function getInjectTheme() {
        const host = (location.hostname || '').toLowerCase();
        if (/spinlaut|lautspin/.test(host)) {
            const t = Object.assign({}, THEME_OCEAN);
            const sampled = sampleAccentColor();
            if (sampled) t.accent = sampled;
            return t;
        }
        return Object.assign({}, THEME_PINK);
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
        console.log('[UG-QRIS] Theme', t.accent, location.hostname);
    }

    // ========================================================================
    // Find Stable Injection Container (NEW APPROACH - Don't rely on QRIS element!)
    // ========================================================================
    function findStableContainer() {
        console.log('[UG-QRIS] 🔍 Finding stable container...');

        // Strategy 1: Find by ID "pay-methods"
        const payMethods = document.getElementById('pay-methods');
        if (payMethods) {
            console.log('✅ [UG-QRIS] Found stable container: #pay-methods');
            return payMethods;
        }

        // Strategy 2: Find by heading "Metode Deposit"
        const headings = document.querySelectorAll('h3, h2, h4');
        for (const heading of headings) {
            if (heading.textContent.trim().toLowerCase().includes('metode deposit')) {
                const container = heading.parentElement;
                if (container) {
                    console.log('✅ [UG-QRIS] Found stable container: via "Metode Deposit" heading');
                    return container;
                }
            }
        }

        // Strategy 3: Find section with "Proses Otomatis" text
        const sections = document.querySelectorAll('section, div');
        for (const section of sections) {
            const text = section.textContent;
            if (text.includes('Proses Otomatis') && text.includes('Proses Manual')) {
                console.log('✅ [UG-QRIS] Found stable container: section with "Proses Otomatis"');
                return section;
            }
        }

        console.warn('⚠️ [UG-QRIS] Stable container not found!');
        return null;
    }

    // ========================================================================
    // Find QRIS Element (for hiding original)
    // ========================================================================
    function findQRISElement() {
        // SKIP if element is inside our Poppay container
        function isInsidePoppay(element) {
            return element.closest('#ug-poppay-qris-full') !== null ||
                element.closest('[data-ug-persistent="true"]') !== null;
        }

        // Find by image (MOST SPECIFIC - qrisoke logo)
        const qrisImages = Array.from(document.querySelectorAll('img')).filter(img =>
            img.alt && (img.alt.toLowerCase().includes('qrisoke') ||
                img.src && img.src.toLowerCase().includes('qrisoke'))
        );

        if (qrisImages.length > 0 && !isInsidePoppay(qrisImages[0])) {
            const container = qrisImages[0].closest('div[class*="hvpgtl"]') ||
                qrisImages[0].closest('div[class*="root"]') ||
                qrisImages[0].closest('li');

            if (container && !isInsidePoppay(container)) {
                console.log('✅ [UG-QRIS] Original QRIS found (will hide)');
                return container;
            }
        }

        // Find by text "Qris"
        const allDivs = document.querySelectorAll('div');
        for (const div of allDivs) {
            if (isInsidePoppay(div)) continue;

            const text = div.textContent.trim().toLowerCase();
            if (text === 'qris' || text === 'qrisoke') {
                const container = div.closest('div[class*="hvpgtl"]') ||
                    div.closest('div[class*="root"]') ||
                    div.closest('li');

                if (container && !isInsidePoppay(container)) {
                    console.log('✅ [UG-QRIS] Original QRIS found (will hide)');
                    return container;
                }
            }
        }

        console.log('ℹ️ [UG-QRIS] Original QRIS not found (maybe already hidden)');
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

        // Check if already injected
        const existingElement = document.getElementById('ug-poppay-qris-full');
        if (existingElement) {
            console.log('ℹ️ [UG-QRIS] Already injected');
            return true;
        }

        // Reset handler flag for fresh injection
        handlersAttached = false;
        console.log('[UG-QRIS] Handler flag reset for fresh injection');

        // CRITICAL: Validate username exists BEFORE injection
        const isValid = await validateUsernameExists();
        if (!isValid) {
            console.error('❌ [UG-QRIS] INJECTION BLOCKED - No valid username found');
            return false;
        }

        // Find stable container (NEW!)
        const stableContainer = findStableContainer();

        if (!stableContainer) {
            console.error('❌ [UG-QRIS] Stable container not found!');
            return false;
        }

        console.log('🔄 [UG-QRIS] Injecting Poppay to stable container...');
        console.log('[UG-QRIS] Stable container:', stableContainer);

        // Try to find and hide original QRIS (optional now!)
        const originalQRIS = findQRISElement();
        if (originalQRIS) {
            console.log('[UG-QRIS] Hiding original QRIS...');
            originalQRIS.style.display = 'none';
            originalQRIS.style.visibility = 'hidden';
            originalQRIS.setAttribute('data-poppay-hidden', 'true');
        }

        // Use stable container as parent
        const parentContainer = stableContainer;
        console.log('[UG-QRIS] Parent container:', parentContainer);

        if (!parentContainer) {
            console.error('❌ [UG-QRIS] Parent container not found!');
            return false;
        }

        // MARK parent container to track it
        parentContainer.setAttribute('data-ug-parent', 'true');
        console.log('[UG-QRIS] Parent container marked');

        // Prevent parent container from being removed
        const preventParentRemoval = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                mutation.removedNodes.forEach(async (node) => {
                    // If parent container was removed
                    if (node === parentContainer ||
                        (node.nodeType === 1 && node.querySelector && node.querySelector('[data-ug-parent="true"]'))) {
                        console.warn('[UG-QRIS] ⚠️ Parent container removed! Re-injecting ASAP...');

                        setTimeout(async () => {
                            if (!reinjectionInProgress) {
                                reinjectionInProgress = true;
                                const isValid = await validateUsernameExists();
                                if (isValid) {
                                    const reinjected = await replaceQRIS();
                                    if (reinjected) {
                                        console.log('✅ [UG-QRIS] Re-injection successful after parent removal');
                                    }
                                }
                                reinjectionInProgress = false;
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

        console.log('[UG-QRIS] Parent container protection active');

        // Create SUPER-PERSISTENT wrapper
        const wrapper = document.createElement('div');
        wrapper.id = 'ug-poppay-wrapper';
        wrapper.setAttribute('data-ug-persistent', 'true');
        wrapper.style.cssText = `
            position: relative !important;
            z-index: 1 !important;
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
            margin-bottom: 20px !important;
        `;
        applyInjectTheme(wrapper);

        // Create new Poppay element (isolated container)
        const newElement = document.createElement('div');
        newElement.id = 'ug-poppay-qris-full';

        // MARK as persistent (don't let site remove this!)
        newElement.setAttribute('data-ug-persistent', 'true');
        newElement.setAttribute('data-payment-method', 'qris-poppay');

        // Prevent ALL event bubbling from this container
        newElement.addEventListener('click', function (e) {
            e.stopPropagation();
            e.stopImmediatePropagation();
        }, true);

        // Prevent wrapper from being removed (HARDCORE!)
        const preventRemoval = new MutationObserver((mutations) => {
            const wrapperElement = document.getElementById('ug-poppay-wrapper');
            const innerElement = document.getElementById('ug-poppay-qris-full');

            if ((!wrapperElement || !innerElement) && isInjected) {
                console.warn('[UG-QRIS] ⚠️ Injection removed! Re-injecting NOW...');
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
                #ug-poppay-wrapper {
                    --ug-bg: #2D0017;
                    --ug-bg-deep: #1A000E;
                    --ug-text: #EBDFE6;
                    --ug-muted: #AE95A5;
                    --ug-accent: #E577DE;
                    --ug-accent-hover: #F08AE8;
                    --ug-accent-text: #2D0017;
                    --ug-border: rgba(227, 179, 203, 0.28);
                    --ug-btn-bg: rgba(217, 170, 194, 0.08);
                    --ug-badge-bg: rgba(229, 119, 222, 0.18);
                    --ug-success-bg: rgba(229, 119, 222, 0.15);
                    --ug-shadow: 0 4px 16px rgba(45, 0, 23, 0.45);
                }
                /* Jangan z-index tinggi — popup QRIS native/SDK harus di atas form */
                #ug-poppay-qris-full {
                    position: relative !important;
                    z-index: auto !important;
                    pointer-events: auto !important;
                    display: block !important;
                    opacity: 1 !important;
                    visibility: visible !important;
                }
                
                #ug-poppay-qris-full::before {
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
                    opacity: 0.85;
                    pointer-events: none;
                    z-index: 2;
                }
                
                #ug-poppay-qris-full * {
                    pointer-events: auto;
                }
                
                [data-ug-persistent="true"] {
                    display: block !important;
                    visibility: visible !important;
                }
                
                .qris-manual-wrapper {
                    background: var(--ug-bg);
                    color: var(--ug-text);
                    padding: ${CONFIG.IS_MOBILE ? '12px' : '25px'};
                    border-radius: ${CONFIG.IS_MOBILE ? '8px' : '12px'};
                    margin-bottom: ${CONFIG.IS_MOBILE ? '10px' : '25px'};
                    box-shadow: var(--ug-shadow);
                    border: 1px solid var(--ug-border);
                    max-width: 100%;
                    width: 100%;
                    overflow-x: hidden;
                    position: relative;
                    box-sizing: border-box;
                    color-scheme: dark;
                    font-family: poppins, poppins-fallback, sans-serif;
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
                    border-bottom: 2px solid var(--ug-border);
                }
                
                .qris-manual-header h5 {
                    color: var(--ug-text);
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
                    color: var(--ug-accent);
                }
                
                .qris-manual-header p {
                    color: var(--ug-muted);
                    margin: 8px 0 0 0;
                }
                
                .qris-form label {
                    color: var(--ug-text);
                    margin-bottom: 8px;
                    display: block;
                }

                .qris-input.qris-username-readonly,
                #depositUsernameAutoQris {
                    background: var(--ug-bg-deep) !important;
                    color: var(--ug-accent) !important;
                    border: 1px solid var(--ug-border) !important;
                    cursor: default !important;
                    font-weight: 600;
                    letter-spacing: 0.3px;
                    caret-color: transparent;
                    border-radius: 6px !important;
                }

                .qris-input.qris-username-readonly:focus,
                #depositUsernameAutoQris:focus {
                    outline: none !important;
                    box-shadow: none !important;
                    border-color: var(--ug-accent) !important;
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
                    border: 1px solid var(--ug-border);
                    background: var(--ug-btn-bg);
                    color: var(--ug-text);
                    border-radius: 6px;
                    cursor: pointer;
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
                    background: var(--ug-accent);
                    color: var(--ug-accent-text);
                    border-color: var(--ug-accent);
                }
                
                .qris-amount-btn.active {
                    background: var(--ug-accent) !important;
                    color: var(--ug-accent-text) !important;
                    border-color: var(--ug-accent) !important;
                }
                
                .qris-amount-btn:active {
                    transform: scale(0.98);
                }
                
                .qris-input-group {
                    display: flex;
                    margin-bottom: 10px;
                    width: 100%;
                    max-width: 100%;
                }
                
                .qris-input-prefix {
                    background: var(--ug-bg-deep);
                    padding: 12px ${CONFIG.IS_MOBILE ? '12px' : '16px'};
                    border: 1px solid var(--ug-border);
                    border-right: none;
                    border-radius: 6px 0 0 6px;
                    color: var(--ug-muted);
                    font-weight: 500;
                    flex-shrink: 0;
                    min-width: ${CONFIG.IS_MOBILE ? '40px' : '50px'};
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                
                .qris-input {
                    flex: 1;
                    min-width: 0;
                    padding: 12px ${CONFIG.IS_MOBILE ? '12px' : '16px'};
                    border: 1px solid var(--ug-border);
                    border-radius: 0 6px 6px 0;
                    font-size: ${CONFIG.IS_MOBILE ? '14px' : '16px'};
                    width: 100%;
                    box-sizing: border-box;
                    background: var(--ug-bg-deep);
                    color: var(--ug-text);
                }
                
                .qris-input:focus {
                    outline: none;
                    border-color: var(--ug-accent);
                }
                
                select.qris-input {
                    border-radius: 6px;
                    width: 100%;
                }
                
                .qris-input::placeholder {
                    color: var(--ug-muted);
                }
                
                .qris-input-hint {
                    font-size: 12px;
                    color: var(--ug-muted);
                    margin-top: 5px;
                }
                
                .qris-submit-btn {
                    width: 100%;
                    padding: ${CONFIG.IS_MOBILE ? '16px' : '14px'};
                    background: var(--ug-accent);
                    color: var(--ug-accent-text);
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
                    background: var(--ug-accent-hover);
                    color: var(--ug-accent-text);
                }
                
                .qris-submit-btn:disabled {
                    background: var(--ug-btn-bg);
                    color: var(--ug-muted);
                    cursor: not-allowed;
                }
                
                .ug-qris-success-box {
                    padding: 20px;
                    background: var(--ug-success-bg);
                    border: 2px solid var(--ug-accent);
                    border-radius: 8px;
                    margin-top: 15px;
                }
                
                .ug-qris-success-box h4 {
                    color: var(--ug-accent);
                    margin: 0 0 10px 0;
                }
                
                .ug-qris-success-box p {
                    color: var(--ug-text);
                    margin: 0;
                }
                
                .qris-result {
                    display: none;
                    margin-top: 20px;
                    position: relative;
                    z-index: 3;
                }
                
                .qris-result.active {
                    display: block;
                }
                
                #qris-payment-frame {
                    min-height: 400px;
                    text-align: center;
                    position: relative;
                    z-index: 3;
                }
                
                #payment-result {
                    margin-top: 15px;
                }
            </style>
            
            <div class="qris-manual-wrapper">
                <div class="qris-manual-header">
                    <h5>
                        <span class="qris-icon">💳</span>
                        QRIS Payment - Deposit Instant
                    </h5>
                    <p>Scan QR code dengan e-wallet favorit Anda (DANA, OVO, GoPay, ShopeePay, dll)</p>
                </div>
                
                <div class="qris-form" id="qrisFormContainer">
                    <form id="formDepositAutoQris">
                        <input type="hidden" id="bankSelectAutoQris" value="QRIS">

                        <div class="form-group mb-3">
                            <label for="depositUsernameAutoQris">Username</label>
                            <input
                                class="qris-input qris-username-readonly notranslate"
                                type="text"
                                id="depositUsernameAutoQris"
                                name="username"
                                value=""
                                readonly
                                tabindex="-1"
                                translate="no"
                                autocomplete="off"
                                spellcheck="false"
                                placeholder="Mendeteksi username..."
                            >
                            <small class="qris-input-hint">Username akun login (otomatis, tidak bisa diubah)</small>
                        </div>
                        
                        <div class="form-group mb-3">
                            <label>Jumlah Deposit</label>
                            
                            <div class="qris-amount-buttons" id="ug-amount-buttons">
                                ${amountButtonsHtml()}
                            </div>
                            
                            <div class="qris-input-group">
                                <div class="qris-input-prefix">Rp</div>
                                <input 
                                    class="qris-input" 
                                    type="text" 
                                    id="depositShowAmountAutoQris" 
                                    placeholder="Atau masukkan jumlah manual"
                                >
                            </div>
                            <input type="hidden" id="depositAmountAutoQris" value="">
                            
                            <small class="qris-input-hint">Min: Rp ${CONFIG.MIN_AMOUNT.toLocaleString('id-ID')} | Max: Rp ${CONFIG.MAX_AMOUNT.toLocaleString('id-ID')}</small>
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
        console.log('[UG-QRIS] Element wrapped in super-persistent wrapper');

        // Insert wrapper at BEGINNING of stable container (or after heading)
        try {
            // Find "Metode Deposit" or "Proses Otomatis" heading
            const headings = parentContainer.querySelectorAll('h3, h2, h4');
            let insertAfter = null;

            for (const heading of headings) {
                const text = heading.textContent.trim().toLowerCase();
                if (text.includes('metode deposit') || text.includes('proses otomatis')) {
                    insertAfter = heading;
                    break;
                }
            }

            if (insertAfter) {
                // Insert after heading
                insertAfter.parentNode.insertBefore(wrapper, insertAfter.nextSibling);
                console.log('[UG-QRIS] Wrapper inserted after heading');
            } else {
                // Insert at beginning
                parentContainer.insertBefore(wrapper, parentContainer.firstChild);
                console.log('[UG-QRIS] Wrapper inserted at beginning');
            }
        } catch (error) {
            console.error('❌ [UG-QRIS] Failed to insert:', error);
            // Fallback: try appendChild
            try {
                parentContainer.appendChild(wrapper);
                console.log('[UG-QRIS] Wrapper appended (fallback)');
            } catch (e2) {
                console.error('❌ [UG-QRIS] Failed to append:', e2);
                return false;
            }
        }

        // Verify insertion
        const inserted = document.getElementById('ug-poppay-qris-full');
        if (inserted) {
            console.log('✅ [UG-QRIS] Injection verified successfully!');
        } else {
            console.error('❌ [UG-QRIS] Injection verification failed!');
            return false;
        }

        // HARDCORE: Multiple event attachment strategies
        console.log('[UG-QRIS] 🔥 HARDCORE MODE: Attaching multiple event types...');

        // Function to set amount
        const setAmount = (amount, button) => {
            console.log('[UG-QRIS] 💰 setAmount called:', amount);

            const amountShow = document.getElementById('depositShowAmountAutoQris');
            const amountHidden = document.getElementById('depositAmountAutoQris');

            if (amountShow && amountHidden) {
                document.querySelectorAll('.qris-amount-btn').forEach(b => b.classList.remove('active'));
                if (button) button.classList.add('active');

                const formatted = parseInt(amount).toLocaleString('id-ID');
                amountShow.value = formatted;
                amountHidden.value = amount;

                console.log('[UG-QRIS] ✅ SUCCESS! Set to:', formatted);

                return true;
            } else {
                console.error('[UG-QRIS] ❌ Input elements not found!');
                return false;
            }
        };

        // Strategy 1: Event delegation on container
        const buttonContainer = document.getElementById('ug-amount-buttons');
        if (buttonContainer) {
            ['click', 'mousedown', 'touchstart'].forEach(eventType => {
                buttonContainer.addEventListener(eventType, function (e) {
                    const button = e.target.closest('.qris-amount-btn');
                    if (!button) return;

                    e.preventDefault();
                    e.stopPropagation();
                    e.stopImmediatePropagation();

                    const amount = button.getAttribute('data-amount');
                    console.log(`[UG-QRIS] 🎯 ${eventType} detected on button:`, amount);

                    setAmount(amount, button);
                    return false;
                }, true);
            });
            console.log('[UG-QRIS] ✅ Container delegation: click + mousedown + touchstart');
        }

        // Strategy 2: Direct attachment to each button (with retry)
        const attachToButtons = () => {
            const buttons = document.querySelectorAll('.qris-amount-btn');
            console.log('[UG-QRIS] 🔍 Found', buttons.length, 'buttons to attach');

            buttons.forEach((btn, index) => {
                const amount = btn.getAttribute('data-amount');
                console.log(`[UG-QRIS] 📌 Attaching to button ${index + 1}:`, amount);

                // Multiple event types
                ['click', 'mousedown', 'touchstart'].forEach(eventType => {
                    btn.addEventListener(eventType, function (e) {
                        e.preventDefault();
                        e.stopPropagation();
                        e.stopImmediatePropagation();

                        console.log(`[UG-QRIS] 🎯 Direct ${eventType}:`, amount);
                        setAmount(amount, this);
                        return false;
                    }, { capture: true, passive: false });
                });

                // Visual confirmation
                btn.style.cursor = 'pointer';
                btn.title = `Click to set Rp ${parseInt(amount).toLocaleString('id-ID')}`;
            });

            if (buttons.length > 0) {
                console.log('[UG-QRIS] ✅ Direct attachment complete for', buttons.length, 'buttons');
            }
        };

        // Attach immediately and retry multiple times
        attachToButtons();
        setTimeout(attachToButtons, 100);
        setTimeout(attachToButtons, 300);
        setTimeout(attachToButtons, 500);
        setTimeout(attachToButtons, 1000);

        // Initialize form (with multiple attempts)
        let initAttempts = 0;
        const tryInit = () => {
            initAttempts++;
            console.log(`[UG-QRIS] Init attempt ${initAttempts}...`);
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
        console.log('[UG-QRIS] Initializing form...');

        // Skip if handlers already attached
        if (handlersAttached) {
            console.log('[UG-QRIS] ℹ️ Handlers already attached, skipping...');
            return;
        }

        // Wait for elements to be ready
        const checkElements = setInterval(() => {
            const form = document.getElementById('formDepositAutoQris');
            const amountShow = document.getElementById('depositShowAmountAutoQris');
            const amountHidden = document.getElementById('depositAmountAutoQris');
            const amountBtns = document.querySelectorAll('.qris-amount-btn');

            if (form && amountShow && amountHidden && amountBtns.length > 0) {
                clearInterval(checkElements);

                // Double-check flag before attaching
                if (!handlersAttached) {
                    console.log('[UG-QRIS] ✓ All elements found, attaching handlers...');
                    attachHandlers();
                    handlersAttached = true;
                    console.log('[UG-QRIS] ✅ Handlers attached, flag set to prevent duplicates');
                } else {
                    console.log('[UG-QRIS] ℹ️ Race condition avoided - handlers already attached');
                }
            }
        }, 50);

        // Timeout after 5 seconds
        setTimeout(() => {
            clearInterval(checkElements);
            if (!handlersAttached) {
                console.warn('[UG-QRIS] ⚠️ Timeout waiting for elements');
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

        console.log('[UG-QRIS] ✓ Form elements found, attaching handlers...');

        // Fill readonly username field (locked source)
        fillUsernameField().then((u) => {
            console.log('[UG-QRIS] ✓ Username field filled:', u);
        }).catch((err) => {
            console.error('❌ [UG-QRIS] Failed to fill username field:', err);
        });

        // Amount input handler - untuk manual typing
        if (amountShow) {
            amountShow.addEventListener('input', function (e) {
                e.stopPropagation();

                const val = this.value.replace(/\D/g, '');
                amountHidden.value = val;
                this.value = val.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

                // Remove active class from buttons when typing
                document.querySelectorAll('.qris-amount-btn').forEach(b => b.classList.remove('active'));
            });
            console.log('[UG-QRIS] ✓ Input handler attached');
        }

        // Button onclick sudah di-handle langsung di HTML, ga perlu addEventListener lagi!
        console.log('[UG-QRIS] ✓ All handlers attached!');

        // Form submit
        form.addEventListener('submit', async function (e) {
            e.preventDefault();

            const amount = parseInt(amountHidden.value);

            // Validation
            if (!amount || amount < CONFIG.MIN_AMOUNT) {
                alert(`❌ Minimal deposit Rp ${CONFIG.MIN_AMOUNT.toLocaleString('id-ID')}`);
                return;
            }

            if (amount > CONFIG.MAX_AMOUNT) {
                alert(`❌ Maksimal deposit Rp ${CONFIG.MAX_AMOUNT.toLocaleString('id-ID')}`);
                return;
            }

            // Disable button
            const submitBtn = this.querySelector('.qris-submit-btn');
            submitBtn.disabled = true;
            btnText.textContent = 'Generating...';

            try {
                // Load SDK
                if (typeof window.QrisSDK === 'undefined') {
                    console.log('📦 [UG-QRIS] Loading SDK...');
                    await loadQrisSDK();
                }

                // Get username (locked) — prefer field if matches lock
                const username = await getUsername();
                const fieldEl = document.getElementById('depositUsernameAutoQris');
                if (fieldEl && username) {
                    syncUsernameField(username);
                }

                if (!username) {
                    throw new Error('Username tidak ditemukan. Silakan login terlebih dahulu.');
                }

                const fieldVal = (fieldEl && fieldEl.value || '').trim();
                if (fieldVal && fieldVal !== username) {
                    console.warn('[UG-QRIS] Username field mismatch, using locked:', { fieldVal, username });
                    syncUsernameField(username);
                }

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
                console.log('[UG-QRIS] Container verified:', container);

                // Create payment - ALWAYS NEW invoice
                const invoice = 'UG-' + Date.now();
                console.log('💳 [UG-QRIS] Creating payment:', { amount, username, invoice });

                // pg-ppy-sdk: auth via store_key (bukan x-domain)
                const sdkConfig = {
                    healthCheckEnabled: false,
                    storeKey: STORE_KEY,
                    store_key: STORE_KEY,
                    amount: amount,
                    invoice: invoice,
                    notes: `UG Auto Deposit - ${invoice}`,
                    username: username,
                    payor_name: username,
                    payor_email: '',
                    displayMode: 'inline',
                    containerId: 'qris-payment-frame',
                    resultContainerId: 'payment-result'
                };

                sdkConfig.onSuccess = (data) => {
                    console.log('✅ [UG-QRIS] Payment success:', data);

                    document.getElementById('payment-result').innerHTML = `
                        <div class="ug-qris-success-box">
                            <h4>✅ Pembayaran Berhasil!</h4>
                            <p>Deposit Rp ${amount.toLocaleString('id-ID')} sedang diproses</p>
                        </div>
                    `;

                    setTimeout(() => {
                        resetForm();
                    }, 5000);
                };

                sdkConfig.onFailed = (error) => {
                    console.error('❌ [UG-QRIS] Payment failed:', error);
                    alert('Gagal membuat QR Code. Silakan coba lagi.');
                    resetForm();
                };

                sdkConfig.onCancel = () => {
                    console.log('ℹ️ [UG-QRIS] Payment cancelled');
                    resetForm();
                };

                const payment = new window.QrisSDK(sdkConfig);
                payment.openPayment();

            } catch (error) {
                console.error('❌ [UG-QRIS] Error:', error);
                alert('Terjadi kesalahan. Silakan coba lagi.');
                resetForm();
            }
        });

        function resetForm() {
            formContainer.style.display = 'block';
            resultContainer.classList.remove('active');
            document.getElementById('qris-payment-frame').innerHTML = '';
            document.getElementById('payment-result').innerHTML = '';
            amountShow.value = '';
            amountHidden.value = '';

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
                console.log('✅ [UG-QRIS] SDK loaded');
                resolve();
            };
            script.onerror = () => {
                console.error('❌ [UG-QRIS] SDK load failed');
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

    // ========================================================================
    // Persistent Injection (handles Qwik re-renders)
    // ========================================================================

    async function startPersistentInjection() {
        console.log('🔄 [UG-QRIS] Starting persistent injection...');

        const paymentHealthOk = await checkPaymentHealth();
        if (!paymentHealthOk) {
            teardownInjection();
            return;
        }

        // Validate username FIRST
        const isValid = await validateUsernameExists();
        if (!isValid) {
            console.error('❌ [UG-QRIS] INJECTION ABORTED - No username detected');
            console.error('❌ [UG-QRIS] Script will NOT activate without valid username');
            return;
        }

        // Initial inject
        const success = await replaceQRIS();
        if (success) {
            isInjected = true;
            console.log('✅ [UG-QRIS] Initial injection successful');
        }

        // ====================================================================
        // HARDCORE: Monitor Bank/Pulsa clicks (prevent injection loss)
        // ====================================================================
        function monitorManualPaymentClicks() {
            console.log('🔍 [UG-QRIS] Setting up Bank/Pulsa click monitoring...');

            // Monitor all clicks on the page
            document.addEventListener('click', function (e) {
                // Check if click is on Bank or Pulsa section
                const target = e.target;
                const text = target.textContent?.trim().toLowerCase() || '';

                // Detect Bank/Pulsa section clicks
                if (text.includes('bank') || text.includes('pulsa') ||
                    target.closest('[class*="hvpgtl"]') ||
                    target.id?.includes('bank') || target.id?.includes('pulsa')) {

                    console.log('⚠️ [UG-QRIS] Manual payment section clicked, protecting injection...');

                    // Function to check and re-inject
                    const checkAndReinject = async (checkName, delay) => {
                        setTimeout(async () => {
                            const wrapper = document.getElementById('ug-poppay-wrapper');
                            const inner = document.getElementById('ug-poppay-qris-full');

                            if ((!wrapper || !inner) && !reinjectionInProgress) {
                                console.log(`🔄 [UG-QRIS] ${checkName}: Injection lost, re-injecting NOW...`);
                                reinjectionInProgress = true;

                                const isValid = await validateUsernameExists();
                                if (isValid) {
                                    const reinjected = await replaceQRIS();
                                    if (reinjected) {
                                        console.log(`✅ [UG-QRIS] ${checkName}: Re-injection successful`);
                                    }
                                }

                                reinjectionInProgress = false;
                            }
                        }, delay);
                    };

                    // Multiple checks with increasing delays
                    checkAndReinject('Immediate', 30);
                    checkAndReinject('Quick', 100);
                    checkAndReinject('Double', 250);
                    checkAndReinject('Triple', 500);
                    checkAndReinject('Final', 1000);
                }
            }, true); // Use capture phase

            console.log('✅ [UG-QRIS] Click monitoring active');
        }

        // Start click monitoring
        monitorManualPaymentClicks();

        // ====================================================================
        // HARDCORE: Interval-based monitoring (every 1.5 seconds - more aggressive!)
        // ====================================================================
        function startIntervalMonitoring() {
            setInterval(async () => {
                const healthOk = await checkPaymentHealth();
                if (!healthOk) {
                    teardownInjection();
                    return;
                }

                const wrapper = document.getElementById('ug-poppay-wrapper');
                const inner = document.getElementById('ug-poppay-qris-full');

                // If injection lost and username still valid, re-inject
                if ((!wrapper || !inner) && isInjected && !reinjectionInProgress) {
                    console.log('⚠️ [UG-QRIS] Interval check: Injection lost, re-injecting...');
                    reinjectionInProgress = true;

                    const isValid = await validateUsernameExists();
                    if (isValid) {
                        const reinjected = await replaceQRIS();
                        if (reinjected) {
                            console.log('✅ [UG-QRIS] Interval re-injection successful');
                        }
                    }

                    reinjectionInProgress = false;
                }

                // Also check if original QRIS reappeared and hide it
                if (wrapper && inner) {
                    const originalQRIS = findQRISElement();
                    if (originalQRIS) {
                        originalQRIS.style.display = 'none';
                        originalQRIS.style.visibility = 'hidden';
                        originalQRIS.setAttribute('data-poppay-hidden', 'true');
                    }
                }
            }, 1500); // Check every 1.5 seconds (more aggressive!)

            console.log('✅ [UG-QRIS] Interval monitoring active (1.5s)');
        }

        // Start interval monitoring
        startIntervalMonitoring();

        // ====================================================================
        // Watch for DOM changes (Qwik re-renders) - AGGRESSIVE MODE
        // ====================================================================
        observer = new MutationObserver((mutations) => {
            // Check if our injected elements still exist
            const wrapper = document.getElementById('ug-poppay-wrapper');
            const inner = document.getElementById('ug-poppay-qris-full');

            // Check if original QRIS reappeared
            const originalQRIS = findQRISElement();

            // If original QRIS exists and we're injected, hide it again
            if (originalQRIS && wrapper && inner) {
                originalQRIS.style.display = 'none';
                originalQRIS.style.visibility = 'hidden';
                originalQRIS.setAttribute('data-poppay-hidden', 'true');
            }

            // If our elements were removed, re-inject IMMEDIATELY (with username check)
            if ((!wrapper || !inner) && isInjected && !reinjectionInProgress) {
                console.log('⚠️ [UG-QRIS] Injection removed by DOM change, re-injecting IMMEDIATELY...');

                reinjectionInProgress = true;

                // Immediate re-inject (no timeout!)
                (async () => {
                    const isValid = await validateUsernameExists();
                    if (isValid) {
                        const reinjected = await replaceQRIS();
                        if (reinjected) {
                            console.log('✅ [UG-QRIS] MutationObserver: Re-injection successful');
                        }
                    } else {
                        console.warn('⚠️ [UG-QRIS] Re-injection skipped - no username');
                    }

                    reinjectionInProgress = false;
                })();
            }

            // If not injected yet, try to inject (with username check)
            if (!isInjected && !reinjectionInProgress) {
                reinjectionInProgress = true;

                (async () => {
                    const isValid = await validateUsernameExists();
                    if (isValid) {
                        const success = await replaceQRIS();
                        if (success) {
                            isInjected = true;
                            console.log('✅ [UG-QRIS] Initial injection via MutationObserver');
                        }
                    }

                    reinjectionInProgress = false;
                })();
            }
        });

        // Start observing
        observer.observe(document.body, {
            childList: true,
            subtree: true
        });

        console.log('✅ [UG-QRIS] Persistent injection active');
    }

    // Start with retry mechanism
    let retryCount = 0;

    async function tryStart() {
        const paymentHealthOk = await checkPaymentHealth();
        if (!paymentHealthOk) {
            teardownInjection();
            return;
        }

        // FIRST: Check if username exists (Qwik SSR state is in page; retry if SPA belum siap)
        const hasUsername = await validateUsernameExists();

        if (!hasUsername) {
            if (retryCount < CONFIG.MAX_RETRIES) {
                retryCount++;
                console.log(`🔄 [UG-QRIS] Waiting for username... (${retryCount}/${CONFIG.MAX_RETRIES})`);
                setTimeout(tryStart, CONFIG.RETRY_DELAY);
                return;
            }
            console.error('❌ [UG-QRIS] SCRIPT DISABLED - Username not found');
            console.error('❌ [UG-QRIS] Will NOT activate injection without valid username');
            return;
        }

        // NEW: Check for stable container instead of QRIS element
        const stableContainer = findStableContainer();

        if (stableContainer || retryCount >= CONFIG.MAX_RETRIES) {
            console.log('✅ [UG-QRIS] Ready to start - stable container found or max retries reached');
            await startPersistentInjection();
        } else {
            retryCount++;
            console.log(`🔄 [UG-QRIS] Waiting for stable container... (${retryCount}/${CONFIG.MAX_RETRIES})`);
            setTimeout(tryStart, CONFIG.RETRY_DELAY);
        }
    }

    // Start
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            setTimeout(tryStart, 1000);
        });
    } else {
        setTimeout(tryStart, 1000);
    }

})();
