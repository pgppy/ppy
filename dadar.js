// ============================================================================
// Dadar88 QRIS Instant inject — dadar.js
// Pola sama martabak.js (Laravel /user/deposit). Tab native sekarang BANK (type=1) +
// PULSA (type=2); AUTO (type=3) sudah dihapus situs → type=3 di-302 ke type=1.
// Tab kita = #qris-instant di halaman deposit type apa pun.
// Health ON: tab QRIS INSTANT + tab native tetap.
// Health OFF: tab kita + panel hilang.
// Path: /user/deposit + /mobile/user/deposit
// Embed: <script src=".../dadar.js?store_key=sk_xxx&min_depo=10000&max_depo=10000000"></script>
// SDK: https://unpkg.com/@poppackage/pg-ppy-sdk@1.0.0/dist/qris-sdk.umd.js
// ============================================================================

(function () {
    'use strict';

    const LOG = '[DADAR-QRIS]';
    const VERSION = '1.0.2';
    const SDK_URL = 'https://unpkg.com/@poppackage/pg-ppy-sdk@1.0.0/dist/qris-sdk.umd.js';
    const PANEL_ID = 'ddr-qris-inject-wrap';
    const TAB_ID = 'ddr-poppay-tab';
    const TAB_HASH = '#qris-instant';
    const NATIVE_AUTO_KEY = 'ddr-native-auto';
    const LOCK_KEY = '__DADAR_QRIS_USER__';

    if (window.__DADAR_QRIS_BOOTED__) {
        if (typeof window.__DADAR_QRIS_BOOT__ === 'function') {
            window.__DADAR_QRIS_BOOT__({ rehook: true });
        }
        return;
    }
    window.__DADAR_QRIS_BOOTED__ = true;

    window.DADAR_PG_CONFIG = window.DADAR_PG_CONFIG || {};

    let formSubmitInProgress = false;
    let injectHandlersAttached = false;
    let reinjectionInProgress = false;
    let paymentHealthCache = null;
    let paymentHealthCacheKey = '';
    let paymentHealthCacheAt = 0;
    let healthMonitorStarted = false;
    let lastHealthLogged = null;
    let pathGuardStarted = false;
    let healthReady = false;
    const PAYMENT_HEALTH_TTL = 30000;

    function parseBool(raw, fallback) {
        if (raw == null || raw === '') return fallback;
        const v = String(raw).trim().toLowerCase();
        if (v === '1' || v === 'true' || v === 'yes') return true;
        if (v === '0' || v === 'false' || v === 'no') return false;
        return fallback;
    }

    function parseNum(raw, fallback) {
        if (raw == null || raw === '') return fallback;
        const n = parseInt(String(raw).replace(/[^\d]/g, ''), 10);
        return Number.isFinite(n) && n > 0 ? n : fallback;
    }

    function getScriptSrc() {
        try {
            const current = document.currentScript;
            if (current?.src) return current.src;
            const scripts = Array.from(document.querySelectorAll('script[src]'))
                .map((s) => s.src)
                .reverse();
            const named = scripts.find((url) =>
                /dadar(?:88)?\.js(\?|$)/i.test(url) ||
                /ddr[_-]?qris[_-]?inject\.js(\?|$)/i.test(url)
            );
            if (named) return named;
            return scripts.find((url) => {
                try {
                    return !!new URL(url, location.href).searchParams.get('store_key');
                } catch (_) {
                    return false;
                }
            }) || '';
        } catch (_) {
            return '';
        }
    }

    function getParam(name) {
        try {
            const src = getScriptSrc();
            if (!src) return null;
            return new URL(src, location.href).searchParams.get(name);
        } catch (_) {
            return null;
        }
    }

    const DEBUG = parseBool(getParam('debug'), window.DADAR_PG_CONFIG.DEBUG === true);
    const PREVIEW = parseBool(getParam('preview'), window.DADAR_PG_CONFIG.PREVIEW === true);

    function debugLog(...args) {
        if (DEBUG) console.log(LOG, ...args);
    }

    function logHealthState(ok) {
        if (lastHealthLogged === ok) return;
        lastHealthLogged = ok;
        console.log(ok ? 'DEPOSIT HEALTH ON' : 'DEPOSIT HEALTH OFF');
    }

    function parseButtons(raw) {
        if (!raw) return [10000, 20000, 50000, 100000, 200000, 500000];
        const list = String(raw).split(/[,\s]+/).map((x) => parseInt(x, 10)).filter((n) => n > 0);
        return list.length ? list : [10000, 20000, 50000, 100000, 200000, 500000];
    }

    const CFG = {
        STORE_KEY: (
            getParam('store_key') ||
            window.DADAR_PGSCRIPT_STORE_KEY ||
            window.DADAR_PG_CONFIG.STORE_KEY ||
            ''
        ).toString().trim(),
        MIN_DEPO: parseNum(getParam('min_depo'), window.DADAR_PG_CONFIG.MIN_DEPO || 10000),
        MAX_DEPO: parseNum(getParam('max_depo'), window.DADAR_PG_CONFIG.MAX_DEPO || 10000000),
        INVOICE_PREFIX: getParam('invoice_prefix') || window.DADAR_PG_CONFIG.INVOICE_PREFIX || 'DDR-',
        SKIP_STORE_KEY: window.DADAR_PG_CONFIG.SKIP_STORE_KEY === true,
        BUTTONS: parseButtons(getParam('buttons') || window.DADAR_PG_CONFIG.BUTTONS),
        HEALTH_BASE: (
            getParam('health_base') ||
            window.DADAR_PG_HEALTH_BASE ||
            'https://payment.pg-poppay.com'
        ).toString().trim().replace(/\/+$/, ''),
        HEALTH_POLL_SEC: parseNum(getParam('health_poll_sec'), 15),
    };

    function depositPath() {
        return (location.pathname || '').replace(/\/+$/, '').toLowerCase();
    }

    function isMobileDeposit() {
        return depositPath() === '/mobile/user/deposit';
    }

    function isDepositMenu() {
        const p = depositPath();
        return PREVIEW || p === '/user/deposit' || p === '/mobile/user/deposit';
    }

    function depositBase() {
        return isMobileDeposit() ? '/mobile/user/deposit' : '/user/deposit';
    }

    function depositType() {
        return new URLSearchParams(location.search).get('type') || '';
    }

    function isOurTab() {
        if (PREVIEW) return true;
        if (!isDepositMenu()) return false;
        return location.hash === TAB_HASH;
    }

    function isDepositQrisPage() {
        return isOurTab();
    }

    function isValidUser(v) {
        const t = String(v || '').trim();
        if (!t || t.length < 3 || t.length > 32) return false;
        if (/\s/.test(t)) return false;
        if (/^(username|user|member|akun|saya|welcome|deposit|qris|promo|banking|keluar|saldo|auto|bank|rtp|togel|slot|casino|sport|virtual|crash)$/i.test(t)) return false;
        return /^[a-zA-Z0-9._-]+$/.test(t);
    }

    function scrapeWelcomeUser() {
        const tops = document.querySelectorAll('.menu-top');
        for (const top of tops) {
            const ctx = ((top.parentElement && top.parentElement.textContent) || '').replace(/\s+/g, ' ');
            if (!/selamat\s+datang/i.test(ctx)) continue;
            const u = (top.textContent || '').replace(/\s+/g, ' ').trim();
            if (isValidUser(u)) return u;
        }
        const nodes = document.querySelectorAll('div, span, p, b, strong, label');
        for (const lab of nodes) {
            const own = Array.from(lab.childNodes)
                .filter((n) => n.nodeType === 3)
                .map((n) => n.textContent || '')
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim();
            if (!/^selamat datang,?$/i.test(own)) continue;
            const wrap = lab.parentElement || lab;
            const top = wrap.querySelector('.menu-top');
            const fromTop = (top?.textContent || '').replace(/\s+/g, ' ').trim();
            if (isValidUser(fromTop)) return fromTop;
            const nextEl = lab.nextElementSibling;
            const next = (nextEl?.textContent || '').replace(/\s+/g, ' ').trim();
            if (nextEl && !nextEl.querySelector('a, button, input') && isValidUser(next)) return next;
        }
        return '';
    }

    function lockedUser() {
        try {
            const prev = window[LOCK_KEY];
            if (prev && typeof prev === 'object' && isValidUser(prev.user)) return String(prev.user).trim();
        } catch (_) {}
        return '';
    }

    function lockUser(user, source) {
        if (!isValidUser(user)) return '';
        const u = String(user).trim();
        window[LOCK_KEY] = { user: u, source: source || 'dom' };
        return u;
    }

    function readUsernameFromDom() {
        return lockedUser() || scrapeWelcomeUser();
    }

    async function fetchProfilUser() {
        const urls = isMobileDeposit()
            ? ['/mobile/user/profil', '/user/profil']
            : ['/user/profil', '/mobile/user/profil'];
        for (const profil of urls) {
            try {
                const r = await fetch(profil, { credentials: 'include', cache: 'no-store' });
                if (!r.ok) continue;
                const html = await r.text();
                const patterns = [
                    /Selamat datang,[\s\S]{0,320}?class="menu-top"[^>]*>([^<]+)/i,
                    /class="menu-top"[^>]*>([a-zA-Z0-9._-]{3,32})</i,
                    /selamat\s+datang,?\s*<\/[^>]+>\s*<[^>]+>([a-zA-Z0-9._-]{3,32})/i,
                ];
                for (const re of patterns) {
                    const m = html.match(re);
                    const u = m ? m[1].replace(/\s+/g, ' ').trim() : '';
                    if (isValidUser(u)) return u;
                }
            } catch (_) {}
        }
        return '';
    }

    async function resolveUsername() {
        const fromDom = scrapeWelcomeUser();
        if (fromDom) return lockUser(fromDom, 'welcome');
        const locked = lockedUser();
        if (locked) return locked;
        const fromProfil = await fetchProfilUser();
        if (fromProfil) return lockUser(fromProfil, 'profil');
        return '';
    }

    function nativeForm() {
        return document.querySelector(
            'form.from-prevent-multiple-submits, form.form-prevent-multiple-submits, form[action*="deposit"]'
        );
    }

    function nativeTabType(el) {
        if (!el || el.id === TAB_ID) return '';
        const m = String(el.getAttribute('onclick') || el.getAttribute('href') || '').match(/[?&]type=(\d+)/);
        if (m) return m[1];
        const t = el.textContent || '';
        if (/AUTO/i.test(t)) return '3';
        if (/BANK/i.test(t)) return '1';
        if (/PULSA/i.test(t)) return '2';
        return '';
    }

    function isNativeTabEl(el) {
        return !!nativeTabType(el);
    }

    function nativeTabRow() {
        const tabs = Array.from(document.querySelectorAll('div.tab-active, div.tab-nonactive, div[onclick*="deposit"]'))
            .filter((el) => el.id !== TAB_ID && isNativeTabEl(el));
        const visible = tabs.find((el) => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        });
        const first = visible || tabs[0];
        if (!first) return null;
        return first.parentElement;
    }

    function isNativeAutoEl(el) {
        return nativeTabType(el) === '3';
    }

    function activeNativeType() {
        return depositType() || '1';
    }

    function tabLabel(el) {
        return (el && el.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function isNativeQrisInstantEl(el) {
        if (!el || el.id === TAB_ID) return false;
        if (!/qris\s*instant/i.test(tabLabel(el))) return false;
        return !/[?&]type=\d/.test(String(el.getAttribute('onclick') || ''));
    }

    function restoreTabDisplay(el) {
        if (!el || el.getAttribute('data-ddr-tab-hidden') !== '1') return;
        el.style.removeProperty('display');
        const prev = el.getAttribute('data-ddr-tab-disp') || '';
        if (prev) el.style.display = prev;
        el.removeAttribute('data-ddr-tab-hidden');
        el.removeAttribute('data-ddr-tab-disp');
    }

    function hideTabEl(el) {
        if (!el || el.id === TAB_ID) return;
        if (!el.hasAttribute('data-ddr-tab-disp')) {
            el.setAttribute('data-ddr-tab-disp', el.style.display || '');
        }
        el.style.setProperty('display', 'none', 'important');
        el.setAttribute('data-ddr-tab-hidden', '1');
    }

    function paintNativeTabsOnly() {
        const row = nativeTabRow();
        if (!row) return;
        const type = activeNativeType();
        Array.from(row.children).forEach((el) => {
            if (el.id === TAB_ID) return;
            const t = nativeTabType(el);
            if (t) el.className = t === type ? 'tab-active' : 'tab-nonactive';
        });
    }

    function applyNativeTabVisibility() {
        const row = nativeTabRow();
        if (!row) return;
        const hideDup = healthIsOn() && isDepositMenu();
        Array.from(row.children).forEach((el) => {
            if (el.id === TAB_ID) return;
            if (isNativeTabEl(el)) {
                restoreTabDisplay(el);
                return;
            }
            if (isNativeQrisInstantEl(el)) {
                if (hideDup) hideTabEl(el);
                else restoreTabDisplay(el);
            }
        });
    }

    function paintTabs() {
        if (!isDepositMenu()) return;
        const row = nativeTabRow();
        if (!row) return;
        const ours = isOurTab() && healthIsOn();
        const type = activeNativeType();
        Array.from(row.children).forEach((el) => {
            if (el.id === TAB_ID) {
                el.className = ours ? 'tab-active' : 'tab-nonactive';
                return;
            }
            const t = nativeTabType(el);
            if (!t) return;
            if (ours) {
                el.className = 'tab-nonactive';
                return;
            }
            el.className = t === type ? 'tab-active' : 'tab-nonactive';
        });
        applyNativeTabVisibility();
    }

    function setOurHashQuiet() {
        const url = location.pathname + location.search + TAB_HASH;
        if (location.hash === TAB_HASH) return;
        history.replaceState(null, '', url);
    }

    function goOurTab(opts) {
        try { sessionStorage.removeItem(NATIVE_AUTO_KEY); } catch (_) {}
        if (isDepositMenu()) {
            setOurHashQuiet();
            paintTabs();
            if (!(opts && opts.skipSync)) syncInjectPanel('tab').catch(() => {});
            return;
        }
        window.location = depositBase() + '?type=1' + TAB_HASH;
    }

    function markNativeAuto() {
        try { sessionStorage.setItem(NATIVE_AUTO_KEY, '1'); } catch (_) {}
    }

    function consumeNativeAuto() {
        try {
            if (sessionStorage.getItem(NATIVE_AUTO_KEY) === '1') {
                sessionStorage.removeItem(NATIVE_AUTO_KEY);
                return true;
            }
        } catch (_) {}
        return false;
    }

    function bindNativeTabClicks(row) {
        if (!row || row.getAttribute('data-ddr-tab-bound') === '1') return;
        row.setAttribute('data-ddr-tab-bound', '1');
        row.addEventListener('click', function (e) {
            const el = e.target && e.target.closest && e.target.closest('div.tab-active, div.tab-nonactive');
            if (isNativeTabEl(el)) markNativeAuto();
        }, true);
    }

    function preferOurTabOnEntry() {
        if (PREVIEW) return true;
        if (!isDepositMenu() || !healthIsOn()) return false;
        if (isOurTab()) return true;
        // Klik tab BANK/PULSA native → biarkan native sekali.
        if (consumeNativeAuto()) return false;
        if (depositType() === '2') return false;
        goOurTab({ skipSync: true });
        return true;
    }

    function ensureOurTab() {
        if (!isDepositMenu() || !healthIsOn()) return null;
        const row = nativeTabRow();
        if (!row) return null;
        bindNativeTabClicks(row);
        let tab = document.getElementById(TAB_ID);
        if (!tab) {
            const existing = Array.from(row.children).find((el) => isNativeQrisInstantEl(el));
            const auto = Array.from(row.children).find((el) => isNativeAutoEl(el));
            if (existing) {
                tab = existing;
                tab.id = TAB_ID;
                tab.removeAttribute('onclick');
            } else {
                tab = document.createElement('div');
                tab.id = TAB_ID;
                tab.innerHTML = (auto && auto.innerHTML)
                    ? auto.innerHTML.replace(/AUTO/gi, 'QRIS INSTANT')
                    : '<i class="fas fa-qrcode"></i> QRIS INSTANT';
            }
            tab.style.cursor = 'pointer';
            tab.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                goOurTab();
            });
            if (tab.parentElement !== row || row.firstChild !== tab) {
                row.insertBefore(tab, row.firstChild);
            }
        }
        paintTabs();
        return row;
    }

    function purgeExtraWraps(keep) {
        document.querySelectorAll('#' + PANEL_ID).forEach((el) => {
            if (el !== keep) el.remove();
        });
    }

    function insertBelowTabs(wrap) {
        if (!wrap) return false;
        purgeExtraWraps(wrap);
        const row = nativeTabRow();
        if (row && row.parentElement) {
            if (wrap.previousElementSibling === row) return true;
            row.parentElement.insertBefore(wrap, row.nextElementSibling);
            return wrap.previousElementSibling === row;
        }
        const form = nativeForm();
        if (form && form.parentElement) {
            form.parentElement.insertBefore(wrap, form);
            return wrap.parentElement === form.parentElement;
        }
        return false;
    }

    function setNativeHidden(hide) {
        const leftover = document.getElementById('ddr-qris-hide-native');
        if (leftover) leftover.remove();
        document.querySelectorAll('form[data-ddr-hidden="1"]').forEach((el) => {
            if (hide && isDepositQrisPage() && el === nativeForm()) return;
            el.style.display = '';
            el.removeAttribute('data-ddr-hidden');
        });
        if (!hide || !isDepositQrisPage()) return;
        const form = nativeForm();
        if (!form) return;
        form.style.display = 'none';
        form.setAttribute('data-ddr-hidden', '1');
    }

    function formatRp(n) {
        const v = parseInt(n, 10) || 0;
        return 'Rp ' + v.toLocaleString('id-ID');
    }

    function parseDigits(s) {
        return String(s || '').replace(/[^\d]/g, '');
    }

    function paymentHealthUrl() {
        return CFG.HEALTH_BASE + '/api/payment-health-v2';
    }

    function healthIsOn() {
        if (PREVIEW || CFG.SKIP_STORE_KEY) return true;
        if (!CFG.STORE_KEY) return false;
        return paymentHealthCache === true;
    }

    async function checkPaymentHealth(forceRefresh) {
        if (CFG.SKIP_STORE_KEY) {
            paymentHealthCache = true;
            healthReady = true;
            logHealthState(true);
            return true;
        }
        if (!CFG.STORE_KEY) {
            paymentHealthCache = false;
            healthReady = true;
            logHealthState(false);
            return false;
        }
        const now = Date.now();
        if (
            !forceRefresh &&
            paymentHealthCache !== null &&
            paymentHealthCacheKey === CFG.STORE_KEY &&
            (now - paymentHealthCacheAt) < PAYMENT_HEALTH_TTL
        ) {
            healthReady = true;
            return paymentHealthCache;
        }
        try {
            const res = await fetch(paymentHealthUrl(), {
                method: 'GET',
                cache: 'no-store',
                headers: { Accept: 'application/json', 'X-Store-Key': CFG.STORE_KEY },
            });
            const body = await res.json().catch(() => ({}));
            const ok = res.ok && body?.success === true;
            paymentHealthCache = ok;
            paymentHealthCacheKey = CFG.STORE_KEY;
            paymentHealthCacheAt = now;
            healthReady = true;
            logHealthState(ok);
            return ok;
        } catch (e) {
            paymentHealthCache = false;
            paymentHealthCacheKey = CFG.STORE_KEY;
            paymentHealthCacheAt = now;
            healthReady = true;
            logHealthState(false);
            debugLog('health error', e);
            return false;
        }
    }

    function injectCss() {
        if (document.getElementById('ddr-qris-css')) return;
        const el = document.createElement('style');
        el.id = 'ddr-qris-css';
        el.textContent = `
#${PANEL_ID}{
  --ddr-bg:#116466;--ddr-deep:#0a3d3e;--ddr-text:#fff;--ddr-muted:rgba(255,255,255,.78);
  --ddr-accent:#D9B08C;--ddr-accent-hover:#E8C4A8;--ddr-accent-text:#2a1c14;
  --ddr-gold:#FFCC00;--ddr-border:rgba(217,176,140,.5);--ddr-btn-bg:rgba(217,176,140,.18);
  --ddr-shadow:0 4px 16px rgba(0,0,0,.35);
  font-family:Segoe UI,system-ui,sans-serif;margin:0 0 16px;position:relative;z-index:1;width:100%;
}
#${PANEL_ID} *{box-sizing:border-box}
#${PANEL_ID} .ddr-card{
  position:relative;background:var(--ddr-bg);color:var(--ddr-text);padding:22px;
  border-radius:12px;border:1px solid var(--ddr-border);box-shadow:var(--ddr-shadow);
  overflow:hidden;
}
#${PANEL_ID} .ddr-title{margin:0;font-size:18px;font-weight:700;color:var(--ddr-gold)}
#${PANEL_ID} .ddr-badge{
  position:absolute;top:-8px;right:12px;background:rgba(217,176,140,.28);color:var(--ddr-accent);
  font-size:10px;font-weight:700;padding:3px 8px;border-radius:3px;letter-spacing:.02em;
}
#${PANEL_ID} .ddr-head{margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--ddr-border)}
#${PANEL_ID} .ddr-sub{margin:6px 0 0;font-size:13px;color:var(--ddr-muted)}
#${PANEL_ID} form{display:flex;flex-direction:column;gap:4px}
#${PANEL_ID} label{display:block;margin-bottom:6px;font-weight:500;color:var(--ddr-text)}
#${PANEL_ID} .ddr-user{
  width:100%;padding:12px;border:1px solid var(--ddr-border);border-radius:6px;
  background:var(--ddr-deep);color:var(--ddr-text);font-size:16px;
}
#${PANEL_ID} .ddr-chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 10px}
#${PANEL_ID} .ddr-chip{
  flex:1 1 auto;min-width:110px;padding:10px 12px;border-radius:6px;
  border:2px solid var(--ddr-accent)!important;background:var(--ddr-deep)!important;color:var(--ddr-accent)!important;
  font-weight:700;cursor:pointer;position:relative;z-index:5;
}
#${PANEL_ID} .ddr-chip:hover,#${PANEL_ID} .ddr-chip.is-active{
  background:var(--ddr-accent)!important;color:var(--ddr-accent-text)!important;border-color:var(--ddr-accent)!important;
}
#${PANEL_ID} .ddr-amt-row{display:flex;width:100%}
#${PANEL_ID} .ddr-amt-prefix{
  background:var(--ddr-deep);padding:12px 14px;border:1px solid var(--ddr-border);border-right:none;
  border-radius:6px 0 0 6px;color:var(--ddr-muted);display:flex;align-items:center;font-weight:700;
}
#${PANEL_ID} .ddr-amount{
  flex:1;width:100%;padding:12px;border:1px solid var(--ddr-border);border-radius:0 6px 6px 0;
  background:var(--ddr-deep);color:var(--ddr-text);font-size:16px;
}
#${PANEL_ID} .ddr-hint{display:block;margin:6px 0 0;font-size:12px;color:var(--ddr-muted)}
#${PANEL_ID} .ddr-submit{
  width:100%;margin-top:12px;padding:14px;border:none;border-radius:6px;
  background:var(--ddr-accent);color:var(--ddr-accent-text);font-size:16px;font-weight:700;cursor:pointer;
}
#${PANEL_ID} .ddr-submit:hover{background:var(--ddr-accent-hover)}
#${PANEL_ID} .ddr-submit:disabled{background:var(--ddr-btn-bg);color:var(--ddr-muted);cursor:not-allowed}
#${PANEL_ID} .ddr-result{display:none;margin-top:16px}
#${PANEL_ID} .ddr-result.active{display:block}
#${PANEL_ID} .ddr-frame{min-height:400px;text-align:center}
#${PANEL_ID} .ddr-ok{padding:16px;background:rgba(253,194,58,.16);border:2px solid var(--ddr-accent);border-radius:8px}
@media (max-width:720px){
  #${PANEL_ID}{margin:8px 0 12px;padding:0 0 88px}
  #${PANEL_ID} .ddr-card{padding:12px 10px 14px;border-radius:10px}
  #${PANEL_ID} .ddr-head{margin-bottom:10px;padding-bottom:8px}
  #${PANEL_ID} .ddr-title{font-size:15px}
  #${PANEL_ID} .ddr-user,#${PANEL_ID} .ddr-amount{padding:10px}
  #${PANEL_ID} .ddr-chip{min-width:calc(50% - 8px);padding:8px 6px;font-size:12px}
  #${PANEL_ID} .ddr-submit{padding:14px;margin-top:10px;position:relative;z-index:6}
}`;
        document.head.appendChild(el);
    }

    function buildChips() {
        return CFG.BUTTONS.map((n) =>
            `<button type="button" class="ddr-chip" data-amount="${n}">${formatRp(n)}</button>`
        ).join('');
    }

    function buildPanel(username) {
        return `
<div class="ddr-card">
  <div class="ddr-head">
    <div>
      <div class="ddr-kicker">Auto approve</div>
      <div class="ddr-title" id="ddrQrisTitle">QRIS Instant Auto</div>
    </div>
    <span class="ddr-badge">QRIS</span>
  </div>
  <form id="ddrFormDepositQris" autocomplete="off">
    <input type="hidden" id="ddrQrisUsername" value="${username}">
    <div>
      <label for="ddrQrisUsernameDisplay">Username</label>
      <input class="ddr-user" id="ddrQrisUsernameDisplay" disabled translate="no" value="${username}">
    </div>
    <div>
      <label>Jumlah deposit</label>
      <div class="ddr-chips">${buildChips()}</div>
      <input type="hidden" id="ddrDepositAmountHidden" value="0">
      <input class="ddr-amount" id="ddrDepositInput" placeholder="Rp 0" inputmode="numeric" autocomplete="off">
      <div class="ddr-hint">Min ${formatRp(CFG.MIN_DEPO)} · Max ${formatRp(CFG.MAX_DEPO)}</div>
    </div>
    <button type="submit" class="ddr-submit" id="ddrQrisSubmitBtn">
      <span id="ddrQrisBtnText">TAMPILKAN QRIS</span>
    </button>
  </form>
  <div class="ddr-result" id="ddrQrisResult">
    <div class="ddr-frame" id="ddr-qris-payment-frame"></div>
    <div id="ddr-qris-payment-result"></div>
  </div>
</div>`;
    }

    function syncChipActive(amount) {
        document.querySelectorAll(`#${PANEL_ID} .ddr-chip`).forEach((el) => {
            el.classList.toggle('is-active', String(el.getAttribute('data-amount')) === String(amount));
        });
    }

    function setInjectAmount(amount) {
        const n = parseInt(amount, 10) || 0;
        const input = document.getElementById('ddrDepositInput');
        const hidden = document.getElementById('ddrDepositAmountHidden');
        if (hidden) hidden.value = String(n);
        if (input) input.value = n ? formatRp(n) : '';
        syncChipActive(n);
        return n;
    }

    function readInjectAmount() {
        const hidden = document.getElementById('ddrDepositAmountHidden');
        if (hidden?.value && hidden.value !== '0') return parseInt(hidden.value, 10) || 0;
        return syncAmountFromInput();
    }

    function syncAmountFromInput() {
        const input = document.getElementById('ddrDepositInput');
        const hidden = document.getElementById('ddrDepositAmountHidden');
        if (!input || !hidden) return 0;
        const digits = parseDigits(input.value);
        if (!digits) {
            input.value = '';
            hidden.value = '0';
            syncChipActive(0);
            return 0;
        }
        const n = parseInt(digits, 10) || 0;
        hidden.value = String(n);
        input.value = formatRp(n);
        syncChipActive(n);
        return n;
    }

    function removeOurTab() {
        const tab = document.getElementById(TAB_ID);
        if (tab) tab.remove();
    }

    function clearOurHashQuiet() {
        if (location.hash !== TAB_HASH) return;
        history.replaceState(null, '', location.pathname + location.search);
    }

    function teardownInject(reason) {
        const wrap = document.getElementById(PANEL_ID);
        if (wrap) wrap.remove();
        setNativeHidden(false);
        injectHandlersAttached = false;
        debugLog('teardown', reason || '');
    }

    function teardownHealthOff(reason) {
        teardownInject(reason);
        removeOurTab();
        applyNativeTabVisibility();
        paintNativeTabsOnly();
        clearOurHashQuiet();
    }

    function ensureOnTop() {
        const wrap = document.getElementById(PANEL_ID);
        if (!wrap) return false;
        return insertBelowTabs(wrap);
    }

    function extractRefId(data) {
        if (!data || typeof data !== 'object') return '';
        const l1 = data.data || data;
        const l2 = (l1 && typeof l1 === 'object') ? (l1.data || l1) : l1;
        for (const val of [l2?.ref_id, l2?.refid, l1?.ref_id, l1?.refid, data.ref_id, data.refid]) {
            if (val != null && String(val).trim()) return String(val).trim();
        }
        return '';
    }

    function withCreateTransactionHook(onRef) {
        const orig = window.fetch;
        let done = false;
        window.fetch = async function (...args) {
            const res = await orig.apply(this, args);
            const url = String(args[0] || '');
            if (!done && url.includes('create-transaction')) {
                done = true;
                try {
                    const data = await res.clone().json();
                    const refId = extractRefId(data);
                    if (refId) {
                        window.__DADAR_LAST_REFID__ = refId;
                        onRef(refId, data);
                    }
                } catch (_) {}
            }
            return res;
        };
        return function restore() {
            if (window.fetch !== orig) window.fetch = orig;
        };
    }

    function loadQrisSDK() {
        return new Promise((resolve, reject) => {
            if (typeof window.QrisSDK !== 'undefined') {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = SDK_URL;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('Gagal load QRIS SDK'));
            document.head.appendChild(script);
        });
    }

    function resetInjectForm() {
        const form = document.getElementById('ddrFormDepositQris');
        const result = document.getElementById('ddrQrisResult');
        const btn = document.getElementById('ddrQrisSubmitBtn');
        const btnText = document.getElementById('ddrQrisBtnText');
        const frame = document.getElementById('ddr-qris-payment-frame');
        const payResult = document.getElementById('ddr-qris-payment-result');
        if (form) form.style.display = '';
        if (result) result.classList.remove('active');
        if (frame) frame.innerHTML = '';
        if (payResult) payResult.innerHTML = '';
        if (btn) btn.disabled = false;
        if (btnText) btnText.textContent = 'TAMPILKAN QRIS';
        setInjectAmount(0);
    }

    async function startQrisPayment(username, amount) {
        if (typeof window.QrisSDK === 'undefined') await loadQrisSDK();
        const form = document.getElementById('ddrFormDepositQris');
        const resultBox = document.getElementById('ddrQrisResult');
        const btn = document.getElementById('ddrQrisSubmitBtn');
        const btnText = document.getElementById('ddrQrisBtnText');
        const frame = document.getElementById('ddr-qris-payment-frame');
        const payResult = document.getElementById('ddr-qris-payment-result');
        if (form) form.style.display = 'none';
        if (resultBox) resultBox.classList.add('active');
        if (frame) frame.innerHTML = '';
        if (payResult) payResult.innerHTML = '';
        if (btn) btn.disabled = true;
        if (btnText) btnText.textContent = 'Memuat...';

        const invoice = CFG.INVOICE_PREFIX + Date.now();
        const restoreFetch = withCreateTransactionHook((refId) => {
            debugLog('ref_id', refId);
        });

        try {
            const payment = new window.QrisSDK({
                healthCheckEnabled: false,
                storeKey: CFG.STORE_KEY,
                store_key: CFG.STORE_KEY,
                amount,
                invoice,
                notes: `QRIS ${invoice}`,
                username,
                payor_name: username,
                payor_email: '',
                displayMode: 'inline',
                containerId: 'ddr-qris-payment-frame',
                resultContainerId: 'ddr-qris-payment-result',
                onSuccess: () => {
                    if (payResult) {
                        payResult.innerHTML = `<div class="ddr-ok"><h4>Pembayaran Berhasil!</h4><p>Deposit ${formatRp(amount)} sedang diproses</p></div>`;
                    }
                    if (btnText) btnText.textContent = 'Selesai';
                    setTimeout(resetInjectForm, 8000);
                },
                onFailed: () => {
                    alert('Gagal buat QR. Coba lagi.');
                    resetInjectForm();
                },
                onCancel: () => resetInjectForm(),
            });
            payment.openPayment();
            setTimeout(() => { if (restoreFetch) restoreFetch(); }, 30000);
        } catch (err) {
            if (restoreFetch) restoreFetch();
            throw err;
        }
    }

    function attachInjectHandlers() {
        if (injectHandlersAttached) return;
        const form = document.getElementById('ddrFormDepositQris');
        if (!form) return;
        injectHandlersAttached = true;

        const amountInput = document.getElementById('ddrDepositInput');
        if (amountInput) {
            const onAmt = () => syncAmountFromInput();
            amountInput.addEventListener('input', onAmt);
            amountInput.addEventListener('change', onAmt);
            amountInput.addEventListener('blur', onAmt);
        }
        document.querySelectorAll(`#${PANEL_ID} .ddr-chip`).forEach((chip) => {
            chip.addEventListener('click', (e) => {
                e.preventDefault();
                setInjectAmount(chip.getAttribute('data-amount'));
            });
        });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (formSubmitInProgress) return false;

            const healthOk = await checkPaymentHealth(true);
            if (!healthOk) {
                teardownInject('payment-health OFF');
                alert('Layanan QRIS sedang OFF. Coba lagi nanti.');
                return false;
            }

            const username = (
                document.getElementById('ddrQrisUsername')?.value ||
                readUsernameFromDom() ||
                ''
            ).trim();
            if (!isValidUser(username)) {
                alert('Username tidak ditemukan. Login dulu.');
                return false;
            }

            const amount = syncAmountFromInput();
            if (!amount) {
                alert(`Masukkan jumlah deposit (min ${formatRp(CFG.MIN_DEPO)})`);
                return false;
            }
            if (amount < CFG.MIN_DEPO) {
                alert(`Minimal deposit ${formatRp(CFG.MIN_DEPO)}`);
                return false;
            }
            if (amount > CFG.MAX_DEPO) {
                alert(`Maksimal deposit ${formatRp(CFG.MAX_DEPO)}`);
                return false;
            }

            formSubmitInProgress = true;
            try {
                await startQrisPayment(username, amount);
            } catch (err) {
                debugLog('Error', err);
                alert(err?.message || 'Terjadi kesalahan');
                resetInjectForm();
            } finally {
                setTimeout(() => { formSubmitInProgress = false; }, 2000);
            }
            return false;
        });
    }

    async function injectQrisPanel(force) {
        if (!isDepositQrisPage()) return false;
        const existing = document.getElementById(PANEL_ID);
        if (existing && !force) {
            purgeExtraWraps(existing);
            ensureOnTop();
            setNativeHidden(true);
            return true;
        }
        if (reinjectionInProgress && existing) {
            purgeExtraWraps(existing);
            return true;
        }
        const username = await resolveUsername();
        injectCss();
        document.querySelectorAll('#' + PANEL_ID).forEach((el) => el.remove());
        const wrap = document.createElement('div');
        wrap.id = PANEL_ID;
        wrap.setAttribute('data-ddr-ver', VERSION);
        wrap.innerHTML = buildPanel(username);
        let placed = insertBelowTabs(wrap);
        if (!placed) {
            for (let i = 0; i < 25 && !placed; i++) {
                await new Promise((r) => setTimeout(r, 160));
                if (!isDepositQrisPage()) break;
                placed = insertBelowTabs(wrap);
            }
        }
        if (!placed) {
            wrap.remove();
            console.warn(LOG, 'inject gagal — baris tab deposit (BANK/PULSA) belum ada');
            return false;
        }
        setNativeHidden(true);
        injectHandlersAttached = false;
        attachInjectHandlers();
        debugLog('injected user=', username, 'v' + VERSION);
        return true;
    }

    async function syncInjectPanel(reason) {
        if (!isDepositMenu()) {
            teardownHealthOff(reason || 'path-lock');
            return;
        }
        const healthOk = await checkPaymentHealth(reason === 'poll' ? false : true);
        if (!healthOk) {
            teardownHealthOff(`payment-health OFF${reason ? ` (${reason})` : ''}`);
            return;
        }
        ensureOurTab();
        applyNativeTabVisibility();
        if (!isOurTab()) {
            teardownInject(reason || 'native-tab');
            paintTabs();
            return;
        }
        const panel = document.getElementById(PANEL_ID);
        if (!panel && !reinjectionInProgress) {
            reinjectionInProgress = true;
            try {
                await injectQrisPanel(true);
            } finally {
                reinjectionInProgress = false;
            }
        } else if (panel) {
            ensureOnTop();
            setNativeHidden(true);
        }
    }

    function startHealthMonitor() {
        if (healthMonitorStarted || CFG.SKIP_STORE_KEY || !CFG.STORE_KEY) return;
        healthMonitorStarted = true;
        const ms = Math.max(5, CFG.HEALTH_POLL_SEC) * 1000;
        setInterval(() => {
            syncInjectPanel('poll').catch((e) => debugLog('poll', e));
        }, ms);
    }

    function startPathGuard() {
        if (pathGuardStarted) return;
        pathGuardStarted = true;
        const check = () => {
            if (!isDepositMenu()) {
                teardownHealthOff('path-lock');
                return;
            }
            if (!healthReady) return;
            if (!healthIsOn()) {
                teardownHealthOff('path-health-off');
                return;
            }
            ensureOurTab();
            applyNativeTabVisibility();
            paintTabs();
            if (isOurTab()) syncInjectPanel('path').catch(() => {});
            else teardownInject('native-tab');
        };
        setInterval(check, 800);
        window.addEventListener('popstate', check);
        window.addEventListener('hashchange', check);
    }

    async function boot(opts) {
        const rehook = opts?.rehook === true;
        if (!isDepositMenu()) {
            teardownHealthOff('bukan /user/deposit');
            return { ok: false, reason: 'path-lock' };
        }
        try { history.scrollRestoration = 'manual'; } catch (_) {}
        if (location.hash === TAB_HASH) {
            window.scrollTo(0, 0);
        }
        const healthOk = await checkPaymentHealth(true);
        if (!healthOk) {
            console.warn(LOG, 'health OFF — tab QRIS INSTANT + panel dilepas, AUTO/BANK native');
            teardownHealthOff('boot health OFF');
            startHealthMonitor();
            startPathGuard();
            return { ok: false, reason: 'health-off', version: VERSION, tab: false, injected: false };
        }
        ensureOurTab();
        applyNativeTabVisibility();
        preferOurTabOnEntry();
        if (rehook) {
            injectHandlersAttached = false;
            const old = document.getElementById(PANEL_ID);
            if (old) old.remove();
        }
        const injected = await injectQrisPanel(rehook);
        startHealthMonitor();
        startPathGuard();
        console.log(LOG, 'boot', {
            ok: !!injected,
            version: VERSION,
            user: readUsernameFromDom(),
            injected: !!document.getElementById(PANEL_ID),
            tab: !!document.getElementById(TAB_ID),
            path: depositPath() + location.search,
        });
        return {
            ok: !!injected,
            version: VERSION,
            user: readUsernameFromDom(),
            injected: !!document.getElementById(PANEL_ID),
            tab: !!document.getElementById(TAB_ID),
            min: CFG.MIN_DEPO,
            path: depositPath() + location.search,
        };
    }

    window.__DADAR_QRIS_BOOT__ = boot;
    window.DADAR_QRIS_STATUS = function () {
        return {
            version: VERSION,
            user: readUsernameFromDom(),
            amount: readInjectAmount(),
            injected: !!document.getElementById(PANEL_ID),
            tab: !!document.getElementById(TAB_ID),
            health: healthIsOn(),
            lastRef: window.__DADAR_LAST_REFID__ || null,
            pathOk: isDepositQrisPage(),
        };
    };

    startPathGuard();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => boot());
    } else {
        boot();
    }
})();
