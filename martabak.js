// ============================================================================
// Martabak188 QRIS Instant inject — martabak.js
// Tab native sekarang BANK (type=1) + PULSA (type=2); AUTO (type=3) sudah dihapus situs
// → type=3 di-302 ke type=1. Tab kita = #qris-instant di halaman deposit type apa pun.
// Health ON: tab kita QRIS INSTANT + tab native tetap (desktop & mobile).
// Native tab "QRIS INSTANT" duplikat (bukan AUTO/BANK) di-hide saat health ON.
// Health OFF: tab kita + panel hilang, AUTO/BANK native, duplikat native balik.
// Path: /user/deposit + /mobile/user/deposit
// SDK: https://unpkg.com/@poppackage/pg-ppy-sdk@1.0.0/dist/qris-sdk.umd.js
// Health: GET https://payment.pg-poppay.com/api/payment-health-v2 (+ X-Store-Key)
// Embed:
// <script src=".../martabak.js?store_key=sk_xxx&min_depo=10000&max_depo=10000000"></script>
// Username: header "Selamat datang," / .menu-top
// Native form deposit di-hide saat panel ON
// ============================================================================

(function () {
    'use strict';

    const LOG = '[MARTABAK-QRIS]';
    const VERSION = '1.1.4';
    const SDK_URL = 'https://unpkg.com/@poppackage/pg-ppy-sdk@1.0.0/dist/qris-sdk.umd.js';
    const PANEL_ID = 'mtb-qris-inject-wrap';
    const TAB_ID = 'mtb-poppay-tab';
    const TAB_HASH = '#qris-instant';
    const NATIVE_AUTO_KEY = 'mtb-native-auto';
    const LOCK_KEY = '__MARTABAK_QRIS_USER__';

    if (window.__MARTABAK_QRIS_BOOTED__) {
        if (typeof window.__MARTABAK_QRIS_BOOT__ === 'function') {
            window.__MARTABAK_QRIS_BOOT__({ rehook: true });
        }
        return;
    }
    window.__MARTABAK_QRIS_BOOTED__ = true;

    window.MARTABAK_PG_CONFIG = window.MARTABAK_PG_CONFIG || {};

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
                /martabak(?:188)?\.js(\?|$)/i.test(url) ||
                /mtb[_-]?qris[_-]?inject\.js(\?|$)/i.test(url)
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

    const DEBUG = parseBool(getParam('debug'), window.MARTABAK_PG_CONFIG.DEBUG === true);
    const PREVIEW = parseBool(getParam('preview'), window.MARTABAK_PG_CONFIG.PREVIEW === true);

    function debugLog(...args) {
        if (DEBUG) console.log(LOG, ...args);
    }

    function logHealthState(ok) {
        if (lastHealthLogged === ok) return;
        lastHealthLogged = ok;
        console.log(ok ? 'DEPOSIT HEALTH ON' : 'DEPOSIT HEALTH OFF');
    }

    function parseButtons(raw) {
        if (!raw) return [20000, 50000, 100000, 200000, 500000];
        const list = String(raw).split(/[,\s]+/).map((x) => parseInt(x, 10)).filter((n) => n > 0);
        return list.length ? list : [20000, 50000, 100000, 200000, 500000];
    }

    const CFG = {
        STORE_KEY: (
            getParam('store_key') ||
            window.MARTABAK_PGSCRIPT_STORE_KEY ||
            window.MARTABAK_PG_CONFIG.STORE_KEY ||
            ''
        ).toString().trim(),
        MIN_DEPO: parseNum(getParam('min_depo'), window.MARTABAK_PG_CONFIG.MIN_DEPO || 20000),
        MAX_DEPO: parseNum(getParam('max_depo'), window.MARTABAK_PG_CONFIG.MAX_DEPO || 10000000),
        INVOICE_PREFIX: getParam('invoice_prefix') || window.MARTABAK_PG_CONFIG.INVOICE_PREFIX || 'MTB-',
        SKIP_STORE_KEY: window.MARTABAK_PG_CONFIG.SKIP_STORE_KEY === true,
        BUTTONS: parseButtons(getParam('buttons') || window.MARTABAK_PG_CONFIG.BUTTONS),
        HEALTH_BASE: (
            getParam('health_base') ||
            window.MARTABAK_PG_HEALTH_BASE ||
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
        if (!el || el.getAttribute('data-mtb-tab-hidden') !== '1') return;
        el.style.removeProperty('display');
        const prev = el.getAttribute('data-mtb-tab-disp') || '';
        if (prev) el.style.display = prev;
        el.removeAttribute('data-mtb-tab-hidden');
        el.removeAttribute('data-mtb-tab-disp');
    }

    function hideTabEl(el) {
        if (!el || el.id === TAB_ID) return;
        if (!el.hasAttribute('data-mtb-tab-disp')) {
            el.setAttribute('data-mtb-tab-disp', el.style.display || '');
        }
        el.style.setProperty('display', 'none', 'important');
        el.setAttribute('data-mtb-tab-hidden', '1');
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
        if (!row || row.getAttribute('data-mtb-tab-bound') === '1') return;
        row.setAttribute('data-mtb-tab-bound', '1');
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
            tab = document.createElement('div');
            tab.id = TAB_ID;
            tab.innerHTML = '<i class="fas fa-qrcode"></i> QRIS INSTANT';
            tab.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopPropagation();
                goOurTab();
            });
            row.insertBefore(tab, row.firstChild);
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
        const leftover = document.getElementById('mtb-qris-hide-native');
        if (leftover) leftover.remove();
        document.querySelectorAll('form[data-mtb-hidden="1"]').forEach((el) => {
            if (hide && isDepositQrisPage() && el === nativeForm()) return;
            el.style.display = '';
            el.removeAttribute('data-mtb-hidden');
        });
        if (!hide || !isDepositQrisPage()) return;
        const form = nativeForm();
        if (!form) return;
        form.style.display = 'none';
        form.setAttribute('data-mtb-hidden', '1');
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
        if (document.getElementById('mtb-qris-css')) return;
        const el = document.createElement('style');
        el.id = 'mtb-qris-css';
        el.textContent = `
#${PANEL_ID}{
  --mtb-bg:#00442F;--mtb-deep:#001D14;--mtb-text:#fff;--mtb-muted:rgba(255,255,255,.72);
  --mtb-accent:#FDC23A;--mtb-accent-hover:#FFD15A;--mtb-accent-text:#001739;
  --mtb-border:rgba(253,194,58,.45);--mtb-btn-bg:rgba(253,194,58,.16);
  --mtb-shadow:0 4px 16px rgba(0,0,0,.45);
  font-family:Segoe UI,system-ui,sans-serif;margin:0 0 16px;position:relative;z-index:1;width:100%;
}
#${PANEL_ID} *{box-sizing:border-box}
#${PANEL_ID} .mtb-card{
  position:relative;background:var(--mtb-bg);color:var(--mtb-text);padding:22px;
  border-radius:12px;border:1px solid var(--mtb-border);box-shadow:var(--mtb-shadow);
  overflow:hidden;
}
#${PANEL_ID} .mtb-badge{
  position:absolute;top:-8px;right:12px;background:rgba(253,194,58,.22);color:var(--mtb-accent);
  font-size:10px;font-weight:700;padding:3px 8px;border-radius:3px;letter-spacing:.02em;
}
#${PANEL_ID} .mtb-head{margin-bottom:14px;padding-bottom:10px;border-bottom:1px solid var(--mtb-border)}
#${PANEL_ID} .mtb-title{margin:0;font-size:18px;font-weight:700;color:var(--mtb-text)}
#${PANEL_ID} .mtb-sub{margin:6px 0 0;font-size:13px;color:var(--mtb-muted)}
#${PANEL_ID} form{display:flex;flex-direction:column;gap:4px}
#${PANEL_ID} label{display:block;margin-bottom:6px;font-weight:500;color:var(--mtb-text)}
#${PANEL_ID} .mtb-user{
  width:100%;padding:12px;border:1px solid var(--mtb-border);border-radius:6px;
  background:var(--mtb-deep);color:var(--mtb-text);font-size:16px;
}
#${PANEL_ID} .mtb-chips{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 10px}
#${PANEL_ID} .mtb-chip{
  flex:1 1 auto;min-width:110px;padding:10px 12px;border-radius:6px;
  border:2px solid var(--mtb-accent)!important;background:var(--mtb-deep)!important;color:var(--mtb-accent)!important;
  font-weight:700;cursor:pointer;position:relative;z-index:5;
}
#${PANEL_ID} .mtb-chip:hover,#${PANEL_ID} .mtb-chip.is-active{
  background:var(--mtb-accent)!important;color:var(--mtb-accent-text)!important;border-color:var(--mtb-accent)!important;
}
#${PANEL_ID} .mtb-amt-row{display:flex;width:100%}
#${PANEL_ID} .mtb-amt-prefix{
  background:var(--mtb-deep);padding:12px 14px;border:1px solid var(--mtb-border);border-right:none;
  border-radius:6px 0 0 6px;color:var(--mtb-muted);display:flex;align-items:center;font-weight:700;
}
#${PANEL_ID} .mtb-amount{
  flex:1;width:100%;padding:12px;border:1px solid var(--mtb-border);border-radius:0 6px 6px 0;
  background:var(--mtb-deep);color:var(--mtb-text);font-size:16px;
}
#${PANEL_ID} .mtb-hint{display:block;margin:6px 0 0;font-size:12px;color:var(--mtb-muted)}
#${PANEL_ID} .mtb-submit{
  width:100%;margin-top:12px;padding:14px;border:none;border-radius:6px;
  background:var(--mtb-accent);color:var(--mtb-accent-text);font-size:16px;font-weight:700;cursor:pointer;
}
#${PANEL_ID} .mtb-submit:hover{background:var(--mtb-accent-hover)}
#${PANEL_ID} .mtb-submit:disabled{background:var(--mtb-btn-bg);color:var(--mtb-muted);cursor:not-allowed}
#${PANEL_ID} .mtb-result{display:none;margin-top:16px}
#${PANEL_ID} .mtb-result.active{display:block}
#${PANEL_ID} .mtb-frame{min-height:400px;text-align:center}
#${PANEL_ID} .mtb-ok{padding:16px;background:rgba(253,194,58,.16);border:2px solid var(--mtb-accent);border-radius:8px}
@media (max-width:720px){
  #${PANEL_ID}{margin:8px 0 12px;padding:0}
  #${PANEL_ID} .mtb-card{padding:14px 12px;border-radius:10px}
  #${PANEL_ID} .mtb-title{font-size:15px}
  #${PANEL_ID} .mtb-chip{min-width:calc(50% - 8px);padding:10px 8px;font-size:13px}
  #${PANEL_ID} .mtb-submit{padding:16px}
}`;
        document.head.appendChild(el);
    }

    function buildChips() {
        return CFG.BUTTONS.map((n) =>
            `<button type="button" class="mtb-chip" data-amount="${n}">${formatRp(n)}</button>`
        ).join('');
    }

    function buildPanel(username) {
        return `
<div class="mtb-card">
  <div class="mtb-head">
    <div>
      <div class="mtb-kicker">Auto approve</div>
      <div class="mtb-title" id="mtbQrisTitle">QRIS Instant Auto</div>
    </div>
    <span class="mtb-badge">QRIS</span>
  </div>
  <form id="mtbFormDepositQris" autocomplete="off">
    <input type="hidden" id="mtbQrisUsername" value="${username}">
    <div>
      <label for="mtbQrisUsernameDisplay">Username</label>
      <input class="mtb-user" id="mtbQrisUsernameDisplay" disabled translate="no" value="${username}">
    </div>
    <div>
      <label>Jumlah deposit</label>
      <div class="mtb-chips">${buildChips()}</div>
      <input type="hidden" id="mtbDepositAmountHidden" value="0">
      <input class="mtb-amount" id="mtbDepositInput" placeholder="Rp 0" inputmode="numeric" autocomplete="off">
      <div class="mtb-hint">Min ${formatRp(CFG.MIN_DEPO)} · Max ${formatRp(CFG.MAX_DEPO)}</div>
    </div>
    <button type="submit" class="mtb-submit" id="mtbQrisSubmitBtn">
      <span id="mtbQrisBtnText">TAMPILKAN QRIS</span>
    </button>
  </form>
  <div class="mtb-result" id="mtbQrisResult">
    <div class="mtb-frame" id="mtb-qris-payment-frame"></div>
    <div id="mtb-qris-payment-result"></div>
  </div>
</div>`;
    }

    function syncChipActive(amount) {
        document.querySelectorAll(`#${PANEL_ID} .mtb-chip`).forEach((el) => {
            el.classList.toggle('is-active', String(el.getAttribute('data-amount')) === String(amount));
        });
    }

    function setInjectAmount(amount) {
        const n = parseInt(amount, 10) || 0;
        const input = document.getElementById('mtbDepositInput');
        const hidden = document.getElementById('mtbDepositAmountHidden');
        if (hidden) hidden.value = String(n);
        if (input) input.value = n ? formatRp(n) : '';
        syncChipActive(n);
        return n;
    }

    function readInjectAmount() {
        const hidden = document.getElementById('mtbDepositAmountHidden');
        if (hidden?.value && hidden.value !== '0') return parseInt(hidden.value, 10) || 0;
        return syncAmountFromInput();
    }

    function syncAmountFromInput() {
        const input = document.getElementById('mtbDepositInput');
        const hidden = document.getElementById('mtbDepositAmountHidden');
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
                        window.__MARTABAK_LAST_REFID__ = refId;
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
        const form = document.getElementById('mtbFormDepositQris');
        const result = document.getElementById('mtbQrisResult');
        const btn = document.getElementById('mtbQrisSubmitBtn');
        const btnText = document.getElementById('mtbQrisBtnText');
        const frame = document.getElementById('mtb-qris-payment-frame');
        const payResult = document.getElementById('mtb-qris-payment-result');
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
        const form = document.getElementById('mtbFormDepositQris');
        const resultBox = document.getElementById('mtbQrisResult');
        const btn = document.getElementById('mtbQrisSubmitBtn');
        const btnText = document.getElementById('mtbQrisBtnText');
        const frame = document.getElementById('mtb-qris-payment-frame');
        const payResult = document.getElementById('mtb-qris-payment-result');
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
                containerId: 'mtb-qris-payment-frame',
                resultContainerId: 'mtb-qris-payment-result',
                onSuccess: () => {
                    if (payResult) {
                        payResult.innerHTML = `<div class="mtb-ok"><h4>Pembayaran Berhasil!</h4><p>Deposit ${formatRp(amount)} sedang diproses</p></div>`;
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
        const form = document.getElementById('mtbFormDepositQris');
        if (!form) return;
        injectHandlersAttached = true;

        const amountInput = document.getElementById('mtbDepositInput');
        if (amountInput) {
            const onAmt = () => syncAmountFromInput();
            amountInput.addEventListener('input', onAmt);
            amountInput.addEventListener('change', onAmt);
            amountInput.addEventListener('blur', onAmt);
        }
        document.querySelectorAll(`#${PANEL_ID} .mtb-chip`).forEach((chip) => {
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
                document.getElementById('mtbQrisUsername')?.value ||
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
        wrap.setAttribute('data-mtb-ver', VERSION);
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

    window.__MARTABAK_QRIS_BOOT__ = boot;
    window.MARTABAK_QRIS_STATUS = function () {
        return {
            version: VERSION,
            user: readUsernameFromDom(),
            amount: readInjectAmount(),
            injected: !!document.getElementById(PANEL_ID),
            tab: !!document.getElementById(TAB_ID),
            health: healthIsOn(),
            lastRef: window.__MARTABAK_LAST_REFID__ || null,
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
