// ============================================================================
// BVS QRIS Inject — Replace "Deposit Cepat" tab
// Embed: /bvsv1.js?store_key=sk_xxx&min_depo=5000&max_depo=10000000
// Health: GET https://payment.pg-poppay.com/api/payment-health-v2 (+ X-Store-Key)
// ============================================================================

(function () {
    'use strict';

    const LOG = '[BVS-QRIS]';
    const VERSION = '1.1.4';
    const PANEL_TITLE = 'DEPOSIT CEPAT (QRIS INSTANT)';
    const SDK_URL = 'https://unpkg.com/@poppackage/pg-ppy-sdk@1.0.0/dist/qris-sdk.umd.js';
    const POPPAY_RE = /pop\s*-?pay|pg-poppay/i;

    function isPoppayOption(opt) {
        if (!opt) return false;
        const val = String(opt.value || '').trim();
        const text = String(opt.textContent || opt.innerText || opt.label || '');
        const bid = String((opt.getAttribute && opt.getAttribute('bid')) || '');
        if (POPPAY_RE.test(text) || POPPAY_RE.test(val)) return true;
        if (val === '10396:51' || /^10396(:|$)/.test(val)) return true;
        if (bid === '51' && /qris/i.test(text)) return true;
        return false;
    }

    function stripNativePoppay() {
        try {
            const selects = document.querySelectorAll('select[name="bankId"], select.bank-get');
            selects.forEach((sel) => {
                Array.from(sel.options || []).forEach((opt) => {
                    if (!isPoppayOption(opt)) return;
                    try {
                        if (sel.value === opt.value) sel.selectedIndex = 0;
                        opt.remove();
                    } catch (_) {
                        opt.disabled = true;
                        opt.hidden = true;
                        opt.style.display = 'none';
                    }
                });
                const left = Array.from(sel.options || []).filter((o) => String(o.value || '').trim() && !isPoppayOption(o));
                const box = sel.closest('.form-detail');
                if (!box) return;
                if (!left.length) {
                    box.setAttribute('data-bvs-poppay-box', '1');
                    box.style.setProperty('display', 'none', 'important');
                } else if (box.getAttribute('data-bvs-poppay-box') === '1') {
                    box.removeAttribute('data-bvs-poppay-box');
                    box.style.removeProperty('display');
                }
            });
        } catch (_) {}
    }

    function startPoppayStrip() {
        stripNativePoppay();
        if (!window.__BVS_POPPAY_STRIP_TIMER__) {
            window.__BVS_POPPAY_STRIP_TIMER__ = setInterval(stripNativePoppay, 250);
        }
        if (document.documentElement && !window.__BVS_POPPAY_STRIP_OBS__) {
            try {
                window.__BVS_POPPAY_STRIP_OBS__ = new MutationObserver(() => stripNativePoppay());
                window.__BVS_POPPAY_STRIP_OBS__.observe(document.documentElement, { childList: true, subtree: true });
            } catch (_) {}
        }
        if (!window.__BVS_POPPAY_CLICK__) {
            window.__BVS_POPPAY_CLICK__ = true;
            document.addEventListener('click', (e) => {
                if (e.target && e.target.closest && e.target.closest('.row-list-metode, .bank-get, .depo-form')) {
                    setTimeout(stripNativePoppay, 50);
                    setTimeout(stripNativePoppay, 300);
                    setTimeout(stripNativePoppay, 800);
                }
            }, true);
        }
        if (window.jQuery && !window.__BVS_POPPAY_AJAX__) {
            window.__BVS_POPPAY_AJAX__ = true;
            window.jQuery(document).ajaxComplete(() => {
                setTimeout(stripNativePoppay, 0);
                setTimeout(stripNativePoppay, 250);
            });
        }
    }

    startPoppayStrip();

    if (window.__BVS_QRIS_INJECT_BOOTED__) {
        if (typeof window.__BVS_QRIS_RESHOW__ === 'function') {
            try { window.__BVS_QRIS_RESHOW__(); } catch (_) {}
        }
        console.log(LOG, 'Already booted — Poppay strip v' + VERSION);
        return LOG + ' already booted';
    }
    window.__BVS_QRIS_INJECT_BOOTED__ = true;
    window.__BVS_QRIS_TAB__ = window.__BVS_QRIS_TAB__ || '';

    window.BVS_PG_CONFIG = window.BVS_PG_CONFIG || {
        STORE_KEY: '',
        MIN_DEPO: 10000,
        MAX_DEPO: 10000000,
        INVOICE_PREFIX: 'BVS-',
        SKIP_STORE_KEY: false,
        CONVERSION_RATIO: 1,
    };

    let formSubmitInProgress = false;
    let lockedUsername = (window.__BVS_LOCKED_USERNAME__ || '').toString().trim();
    let lockedUsernameSource = lockedUsername ? 'previous lock' : '';
    let paymentHealthCache = null;
    let paymentHealthCacheKey = '';
    let paymentHealthCacheAt = 0;
    let lastHealthLogged = null;
    let lastHealthOk = false;
    let healthMonitorStarted = false;
    const PAYMENT_HEALTH_TTL = 30000;

    function parseBool(raw, fallback) {
        if (raw == null || raw === '') return fallback;
        const v = String(raw).trim().toLowerCase();
        if (v === '1' || v === 'true' || v === 'yes') return true;
        if (v === '0' || v === 'false' || v === 'no') return false;
        return fallback;
    }

    function debugLog(...args) {
        if (DEBUG) console.log(LOG, ...args);
    }

    function logHealthState(ok) {
        if (lastHealthLogged === ok) return;
        lastHealthLogged = ok;
        console.log(ok ? 'DEPOSIT HEALTH ON' : 'DEPOSIT HEALTH OFF');
    }

    function getScriptSrc() {
        try {
            const current = document.currentScript;
            if (current?.src) return current.src;
            const scripts = Array.from(document.querySelectorAll('script[src]'))
                .map((s) => s.src)
                .reverse();
            const named = scripts.find((url) => /bvsv\d+\.js(\?|$)/i.test(url));
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

    const DEBUG = parseBool(getParam('debug'), window.BVS_PG_CONFIG.DEBUG === true);

    function parseNum(raw, fallback) {
        if (raw == null || raw === '') return fallback;
        const n = parseInt(String(raw).replace(/[^\d]/g, ''), 10);
        return Number.isFinite(n) && n > 0 ? n : fallback;
    }

    const CFG = {
        STORE_KEY: getParam('store_key') || window.BVS_PG_CONFIG.STORE_KEY || 'sk_mfd1nzunq6a2xmozi9vqft4t32ahivce',
        MIN_DEPO: parseNum(getParam('min_depo'), window.BVS_PG_CONFIG.MIN_DEPO),
        MAX_DEPO: parseNum(getParam('max_depo'), window.BVS_PG_CONFIG.MAX_DEPO),
        INVOICE_PREFIX: getParam('invoice_prefix') || window.BVS_PG_CONFIG.INVOICE_PREFIX || 'BVS-',
        SKIP_STORE_KEY: parseBool(getParam('skip_store_key'), window.BVS_PG_CONFIG.SKIP_STORE_KEY),
        CONVERSION_RATIO: parseFloat(getParam('conversion_ratio') || window.BVS_PG_CONFIG.CONVERSION_RATIO) || 1,
        HEALTH_BASE: (getParam('health_base') || 'https://payment.pg-poppay.com').replace(/\/+$/, ''),
        HEALTH_PATH: (getParam('health_path') || '').replace(/^\/+/, ''),
        HEALTH_URL: (getParam('health_url') || '').replace(/\/+$/, ''),
        HEALTH_POLL_SEC: parseNum(getParam('health_poll_sec'), 15),
    };

    debugLog('Config:', CFG);

    function paymentHealthUrl() {
        if (CFG.HEALTH_URL) return CFG.HEALTH_URL;
        const path = CFG.HEALTH_PATH || 'api/payment-health-v2';
        return `${CFG.HEALTH_BASE}/${path}`;
    }

    async function checkPaymentHealth(forceRefresh) {
        if (CFG.SKIP_STORE_KEY || !CFG.STORE_KEY) {
            lastHealthOk = true;
            logHealthState(true);
            return true;
        }
        const now = Date.now();
        if (
            !forceRefresh
            && paymentHealthCache !== null
            && paymentHealthCacheKey === CFG.STORE_KEY
            && (now - paymentHealthCacheAt) < PAYMENT_HEALTH_TTL
        ) {
            lastHealthOk = paymentHealthCache;
            return paymentHealthCache;
        }
        try {
            const url = paymentHealthUrl();
            const res = await fetch(url, {
                method: 'GET',
                cache: 'no-store',
                headers: { Accept: 'application/json', 'X-Store-Key': CFG.STORE_KEY },
            });
            const body = await res.json().catch(() => ({}));
            const ok = res.ok && body?.success === true;
            paymentHealthCache = ok;
            paymentHealthCacheKey = CFG.STORE_KEY;
            paymentHealthCacheAt = now;
            lastHealthOk = ok;
            logHealthState(ok);
            debugLog('payment-health-v2', ok ? 'OK' : 'OFF', url, body?.message || '');
            return ok;
        } catch (e) {
            paymentHealthCache = false;
            paymentHealthCacheKey = CFG.STORE_KEY;
            paymentHealthCacheAt = now;
            lastHealthOk = false;
            logHealthState(false);
            debugLog('payment-health-v2 error', e);
            return false;
        }
    }

    async function applyHealthAndSync(force) {
        const ok = await checkPaymentHealth(!!force);
        syncCepatTabUi();
        return ok;
    }

    function startHealthMonitor() {
        if (healthMonitorStarted || CFG.SKIP_STORE_KEY || !CFG.STORE_KEY) return;
        healthMonitorStarted = true;
        const ms = Math.max(5, CFG.HEALTH_POLL_SEC) * 1000;
        setInterval(() => {
            applyHealthAndSync(true).catch((e) => debugLog('health poll error', e));
        }, ms);
        debugLog('health monitor every', ms / 1000, 's');
    }

    function isValidUser(text) {
        const u = String(text || '').replace(/\s+/g, ' ').trim();
        if (!u || u.length < 3 || u.length > 40) return false;
        if (/demo_user|silahkan|pilih|username|login|welcome/i.test(u)) return false;
        if (!/^[a-zA-Z0-9._@-]+$/.test(u)) return false;
        if (/^\d+$/.test(u)) return false;
        return true;
    }

    function lockUsername(u, source) {
        const name = String(u || '').replace(/\s+/g, ' ').trim();
        if (!isValidUser(name)) return '';
        if (lockedUsername && lockedUsername !== name) {
            console.warn(LOG, 'Ignore username', name, 'from', source, '— already locked', lockedUsername, 'via', lockedUsernameSource);
            return lockedUsername;
        }
        if (!lockedUsername) {
            lockedUsername = name;
            lockedUsernameSource = source;
            window.__BVS_LOCKED_USERNAME__ = name;
            console.log(LOG, 'Username locked from', source + ':', name);
        }
        return lockedUsername;
    }

    function readG8Names() {
        const names = [];
        document.querySelectorAll('span.g8-name, .g8-name').forEach((el) => {
            const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
            if (isValidUser(t)) names.push(t);
        });
        return names;
    }

    function readWelcomeName() {
        const blob = (
            (document.querySelector('.header, header, .nav-mobile, .m-header') || {}).innerText
            || (document.body && document.body.innerText)
            || ''
        ).slice(0, 600);
        const m = blob.match(/Selamat\s+Datang[,:\s]+([a-zA-Z0-9._@-]{3,40})/i);
        if (m && isValidUser(m[1])) return m[1];
        return '';
    }

    function getUsername() {
        if (lockedUsername) return lockedUsername;

        const fromCfg = window.BVS_PG_CONFIG && window.BVS_PG_CONFIG.USERNAME;
        if (isValidUser(fromCfg)) return lockUsername(fromCfg, 'BVS_PG_CONFIG');

        const fromParam = getParam('username');
        if (isValidUser(fromParam)) return lockUsername(fromParam, 'script ?username=');

        const names = readG8Names();
        const unique = [...new Set(names)];
        if (unique.length === 1) return lockUsername(unique[0], 'span.g8-name');
        if (unique.length > 1) {
            console.warn(LOG, 'Multiple .g8-name values, using first:', unique);
            return lockUsername(unique[0], 'span.g8-name (first)');
        }

        const welcome = readWelcomeName();
        if (welcome) return lockUsername(welcome, 'Selamat Datang');

        return '';
    }

    function applyUsernameToForm(username) {
        const u = lockedUsername || username || '';
        const hidden = document.getElementById('bvsQrisUsername');
        const display = document.getElementById('bvsQrisUsernameDisplay');
        if (hidden) hidden.value = u;
        if (display) display.value = u;
    }

    function waitAndLockUsername(tries) {
        const left = tries == null ? 25 : tries;
        const u = getUsername();
        if (u) {
            applyUsernameToForm(u);
            return;
        }
        if (left > 0) setTimeout(() => waitAndLockUsername(left - 1), 400);
        else console.warn(LOG, 'Username not found — expected span.g8-name in header');
    }

    function watchUsername() {
        if (window.__BVS_QRIS_USER_WATCH__) return;
        window.__BVS_QRIS_USER_WATCH__ = true;
        const obs = new MutationObserver(() => {
            if (!lockedUsername) waitAndLockUsername(1);
        });
        const root = document.querySelector('header') || document.body;
        if (root) obs.observe(root, { childList: true, characterData: true, subtree: true });
    }

    function formatAmountDisplay(n) {
        const num = parseInt(n, 10) || 0;
        if (num <= 0) return '';
        return num.toLocaleString('id-ID');
    }

    function formatRpLabel(n) {
        const text = formatAmountDisplay(n);
        return text ? `Rp ${text}` : 'Rp 0';
    }

    function amountHintText() {
        const min = formatAmountDisplay(CFG.MIN_DEPO);
        const max = formatAmountDisplay(CFG.MAX_DEPO);
        return `Min: ${min} | Max: ${max}`;
    }

    function buildInjectHTML(username) {
        return `
            <div id="bvs-qris-inject-wrap" class="bvs-qris-hidden">
                <style>
                    #bvs-qris-inject-wrap {
                        width: 100%;
                        box-sizing: border-box;
                        padding: 14px 12px 18px;
                        min-height: 180px;
                        position: relative;
                        z-index: 20;
                        color: #f3f3f3 !important;
                        background: #141414;
                        border: 1px solid #2e2e2e;
                        border-radius: 8px;
                    }
                    #bvs-qris-inject-wrap.bvs-qris-hidden { display: none !important; }
                    #bvs-qris-inject-wrap * { box-sizing: border-box; }
                    #bvs-qris-inject-wrap .bvs-qris-panel__title {
                        color: #fbb11a !important;
                        font-size: 16px;
                        font-weight: 700;
                        padding: 4px 0 10px;
                        margin: 0;
                        text-align: center;
                    }
                    #bvs-qris-inject-wrap .bvs-qris-form {
                        display: flex;
                        flex-direction: column;
                        gap: 15px;
                    }
                    #bvs-qris-inject-wrap .form-group label {
                        display: block;
                        margin-bottom: 8px;
                        font-size: 14px;
                        font-weight: 600;
                        color: #f3f3f3 !important;
                    }
                    #bvs-qris-inject-wrap .form-control {
                        width: 100%;
                        max-width: 100%;
                        padding: 12px 14px;
                        border: 1px solid #3a3a3a !important;
                        border-radius: 4px;
                        font-size: 16px;
                        box-sizing: border-box;
                        background: #1f1f1f !important;
                        color: #ffffff !important;
                    }
                    #bvs-qris-inject-wrap .form-control:disabled {
                        background: #1f1f1f !important;
                        color: #fbb11a !important;
                        opacity: 1;
                        -webkit-text-fill-color: #fbb11a;
                    }
                    #bvs-qris-inject-wrap .bvs-qris-hint {
                        font-size: 12px;
                        margin-top: 6px;
                        color: #c8c8c8 !important;
                    }
                    #bvs-qris-inject-wrap .button {
                        width: 100%;
                        padding: 14px 20px;
                        background: #fbb11a !important;
                        color: #111 !important;
                        border: none;
                        border-radius: 4px;
                        font-size: 16px;
                        font-weight: 700;
                        cursor: pointer;
                        -webkit-tap-highlight-color: transparent;
                        touch-action: manipulation;
                    }
                    #bvs-qris-inject-wrap .button:hover {
                        background: #e9a010;
                    }
                    #bvs-qris-inject-wrap .button:disabled {
                        background: #ccc;
                        cursor: not-allowed;
                    }
                    #bvs-qris-inject-wrap .bvs-qris-result { display: none; margin-top: 20px; }
                    #bvs-qris-inject-wrap .bvs-qris-result.active { display: block; }
                    #bvs-qris-inject-wrap #bvs-qris-payment-frame { min-height: 320px; text-align: center; }
                    #bvs-qris-inject-wrap .bvs-qris-success-box {
                        padding: 16px;
                        border-radius: 4px;
                        background: rgba(40, 167, 69, 0.1);
                        border: 1px solid rgba(40, 167, 69, 0.35);
                    }
                </style>
                <div class="bvs-qris-panel__title">${PANEL_TITLE}</div>
                <div class="bvs-qris-form" id="bvsFormDepositQris">
                    <input type="hidden" id="bvsQrisUsername" value="${username}">
                    
                    <div class="form-group">
                        <label><i class="fa fa-user"></i> Username</label>
                        <input type="text" id="bvsQrisUsernameDisplay" disabled
                            class="form-control" value="${username}">
                    </div>
                    
                    <div class="form-group">
                        <label><i class="fa fa-credit-card"></i> Jumlah (IDR)</label>
                        <input type="text" id="bvsDepositInput" placeholder="Rp 0"
                            class="form-control" autocomplete="off" inputmode="numeric">
                        <input type="hidden" id="bvsDepositAmountHidden" value="0">
                        <div class="bvs-qris-hint">${amountHintText()}</div>
                    </div>
                    
                    <button type="button" class="button" id="bvsQrisSubmitBtn">
                        <span id="bvsQrisBtnText">TAMPILKAN QRIS</span>
                    </button>
                </div>
                
                <div class="bvs-qris-result" id="bvsQrisResult">
                    <div id="bvs-qris-payment-frame"></div>
                    <div id="bvs-qris-payment-result"></div>
                </div>
            </div>`;
    }

    function isShown(el) {
        if (!el) return false;
        const s = getComputedStyle(el);
        return s.display !== 'none' && s.visibility !== 'hidden' && (el.offsetWidth + el.offsetHeight) > 0;
    }

    function visibleQ(sel) {
        return Array.from(document.querySelectorAll(sel)).find(isShown) || null;
    }

    function injectCepatTabStyle() {
        let st = document.getElementById('bvs-qris-tab-style');
        if (!st) {
            st = document.createElement('style');
            st.id = 'bvs-qris-tab-style';
            (document.head || document.documentElement).appendChild(st);
        }
        st.textContent = [
            '.bvs-qris-cepat-tab{display:flex!important;flex-direction:column!important;',
            'align-items:center!important;justify-content:center!important;',
            'text-align:center!important;position:relative!important;}',
            '.bvs-qris-cepat-tab.bvs-qris-tab-off{display:none!important;}',
            '.bvs-qris-cepat-tab .icon-menu{position:static!important;margin:0!important;',
            'transform:none!important;display:flex!important;align-items:center!important;',
            'justify-content:center!important;}',
            '.bvs-qris-cepat-tab .badge-description{display:none!important;}',
            '.bvs-qris-cepat-tab p{display:block!important;visibility:visible!important;opacity:1!important;',
            'position:static!important;top:auto!important;left:auto!important;right:auto!important;bottom:auto!important;',
            'transform:none!important;float:none!important;',
            'font-size:12px!important;font-weight:700!important;line-height:1.2!important;',
            'margin:6px 0 0!important;padding:0 6px!important;text-align:center!important;',
            'white-space:nowrap!important;width:auto!important;height:auto!important;',
            'overflow:visible!important;color:inherit!important;}',
            '@media (max-width:768px){',
            '.bvs-qris-cepat-tab .icon-menu{display:none!important;}',
            '.bvs-qris-cepat-tab p{margin:0!important;padding:0 8px!important;font-size:12px!important;',
            'white-space:normal!important;line-height:1.2!important;}',
            '}',
        ].join('');
    }

    function ensureCepatTab() {
        injectCepatTabStyle();
        document.querySelectorAll('.depo-select-wrap').forEach((strip) => {
            const parent = strip.parentElement;
            if (parent && !isShown(parent) && parent.offsetParent === null) return;

            let ours = strip.querySelector('.bvs-qris-cepat-tab');
            if (!ours) {
                const li = document.createElement('li');
                li.className = 'depocepat bvs-qris-cepat-tab';
                li.setAttribute('role', 'button');
                li.style.cursor = 'pointer';
                li.innerHTML = (
                    '<div class="icon-menu"><i class="fa fa-qrcode"></i></div>'
                    + '<p>DEPOSIT CEPAT QRIS INSTANT</p>'
                    + '<div class="badge-description bg-green fly">'
                    + '<span class="field-description">Otomatis</span></div>'
                );
                const natives = Array.from(
                    strip.querySelectorAll('.depocepat, .depovip, .depohumpay')
                ).filter((el) => !el.classList.contains('bvs-qris-cepat-tab') && isShown(el));
                const lastNative = natives[natives.length - 1];
                const manual = strip.querySelector('.depomanual');
                if (lastNative && lastNative.parentNode) lastNative.after(li);
                else if (manual && manual.parentNode) manual.after(li);
                else {
                    const ul = strip.querySelector('ul.depo-select');
                    if (ul) ul.appendChild(li);
                    else strip.appendChild(li);
                }
                ours = li;
                console.log(LOG, 'Added DEPOSIT CEPAT tab');
            }

            const label = ours.querySelector('p');
            if (label) label.textContent = 'DEPOSIT CEPAT QRIS INSTANT';

            if (lastHealthOk) {
                ours.classList.remove('bvs-qris-tab-off');
                ours.style.display = '';
                if (window.__BVS_QRIS_TAB__ !== 'qris') ours.classList.remove('active');
                if (!isShown(strip) || strip.classList.contains('hide')) {
                    strip.classList.remove('hide');
                    if (strip.style.display === 'none') strip.style.display = '';
                    strip.setAttribute('data-bvs-unhid-strip', '1');
                }
            } else {
                ours.classList.add('bvs-qris-tab-off');
                ours.classList.remove('active');
                ours.style.display = 'none';
                if (window.__BVS_QRIS_TAB__ === 'qris') {
                    window.__BVS_QRIS_TAB__ = 'manual';
                    strip.querySelectorAll('.depomanual').forEach((t) => t.classList.add('active'));
                }
                if (strip.getAttribute('data-bvs-unhid-strip') === '1') {
                    const nativeCepatOn = Array.from(
                        strip.querySelectorAll('.depocepat, .depovip, .depohumpay')
                    ).some((el) => (
                        !el.classList.contains('bvs-qris-cepat-tab')
                        && !el.classList.contains('hide')
                        && el.style.display !== 'none'
                    ));
                    if (!nativeCepatOn) strip.classList.add('hide');
                }
            }
        });
    }

    function findMountTarget() {
        ensureCepatTab();
        return visibleQ('.depo-select-wrap')
            || visibleQ('#confirm-form .detail-box')
            || visibleQ('.funds__detail-right .detail-box')
            || visibleQ('.detail-box')
            || document.querySelector('#confirm-form, form.depo-select-form')
            || document.querySelector('.depo-select-wrap')
            || null;
    }

    function placeWrap(node) {
        if (!node) return false;
        ensureCepatTab();
        const tabStrip = visibleQ('.depo-select-wrap')
            || Array.from(document.querySelectorAll('.depo-select-wrap'))
                .find((s) => s.getAttribute('data-bvs-unhid-strip') === '1');
        if (tabStrip) {
            if (node.previousElementSibling !== tabStrip) {
                tabStrip.insertAdjacentElement('afterend', node);
            }
            return true;
        }
        const detailBox = visibleQ('#confirm-form .detail-box')
            || visibleQ('.funds__detail-right .detail-box')
            || visibleQ('.detail-box');
        if (detailBox) {
            if (node.parentElement !== detailBox) {
                detailBox.insertBefore(node, detailBox.firstChild);
            }
            return true;
        }
        const form = document.querySelector('#confirm-form, form.depo-select-form');
        if (form && node.parentElement !== form) {
            form.insertBefore(node, form.firstChild);
            return true;
        }
        return !!node.parentElement;
    }

    function tabLooksOn(el) {
        if (!el) return false;
        return /(?:^|\s)(active|on|selected|current)(?:\s|$)/i.test(el.className);
    }

    function visibleEl(sel) {
        return visibleQ(sel) || document.querySelector(sel);
    }

    function detectCepatFromDom() {
        const cepatTab = visibleEl('.depocepat');
        const manualTab = visibleEl('.depomanual');
        if (tabLooksOn(cepatTab) && !tabLooksOn(manualTab)) return true;
        if (tabLooksOn(manualTab) && !tabLooksOn(cepatTab)) return false;

        const cepatFull = document.querySelector('.form-detail--full.depo-form.cepat');
        const manualFull = document.querySelector('.form-detail--full.depo-form.manual');
        const cepatVisible = !!(cepatFull && !cepatFull.classList.contains('hide'));
        const manualVisible = !!(manualFull && !manualFull.classList.contains('hide'));
        if (cepatVisible && !manualVisible) return true;
        if (manualVisible && !cepatVisible) return false;
        return false;
    }

    function isQrisTabActive() {
        if (window.__BVS_QRIS_TAB__ === 'qris') return true;
        if (window.__BVS_QRIS_TAB__ === 'manual' || window.__BVS_QRIS_TAB__ === 'native') return false;
        const ourTab = visibleQ('.bvs-qris-cepat-tab');
        return !!(ourTab && tabLooksOn(ourTab));
    }

    function unhideAncestors(el) {
        let p = el && el.parentElement;
        while (p && p !== document.body) {
            if (p.classList && p.classList.contains('depo-select-wrap')) break;
            if (p.classList && p.classList.contains('hide')) p.classList.remove('hide');
            if (p.style && p.style.display === 'none') p.style.display = '';
            p = p.parentElement;
        }
    }

    function setWrapVisible(wrap, visible) {
        if (!wrap) return;
        wrap.classList.toggle('bvs-qris-hidden', !visible);
        wrap.style.display = visible ? 'block' : 'none';
        if (visible) unhideAncestors(wrap);
    }

    function hideSiblingsAfterWrap(wrap, hide) {
        if (!wrap) return;
        const prev = wrap.previousElementSibling;
        if (!prev || !prev.classList.contains('depo-select-wrap') || !isShown(prev)) return;
        let sib = wrap.nextElementSibling;
        while (sib) {
            if (hide) {
                if (!sib.hasAttribute('data-bvs-disp')) {
                    sib.setAttribute('data-bvs-disp', sib.style.display || '');
                }
                sib.style.display = 'none';
            } else if (sib.hasAttribute('data-bvs-disp')) {
                sib.style.display = sib.getAttribute('data-bvs-disp') || '';
                sib.removeAttribute('data-bvs-disp');
            }
            sib = sib.nextElementSibling;
        }
    }

    function syncCepatTabUi() {
        ensureCepatTab();
        const wrap = document.getElementById('bvs-qris-inject-wrap');
        if (wrap) placeWrap(wrap);
        bindTabSync();
        const showQris = isQrisTabActive() && lastHealthOk;
        setWrapVisible(wrap, showQris);
        hideSiblingsAfterWrap(wrap, showQris);
        stripNativePoppay();

        document.querySelectorAll('.bvs-qris-cepat-tab').forEach((tab) => {
            tab.classList.toggle('active', !!showQris);
        });
        if (showQris) {
            document.querySelectorAll('.depomanual, .depocepat:not(.bvs-qris-cepat-tab), .depovip, .depohumpay, .depousdt').forEach((tab) => {
                tab.classList.remove('active');
            });
        }

        document.querySelectorAll('.depo-form.cepat').forEach((el) => {
            if (el.id === 'bvs-qris-inject-wrap' || (wrap && el.contains(wrap))) return;
            if (showQris) {
                el.classList.add('hide');
                el.style.display = 'none';
            } else {
                el.style.display = '';
                if (window.__BVS_QRIS_TAB__ === 'native' && !lastHealthOk) el.classList.remove('hide');
            }
        });

        const submitBtn = document.querySelector('#confirm-form button.btn-submit');
        const depositOption = document.querySelector('#confirm-form .deposit-option');
        if (showQris) {
            if (depositOption) depositOption.style.display = 'none';
            if (submitBtn) submitBtn.style.display = 'none';
        } else {
            if (depositOption) depositOption.style.display = '';
            if (submitBtn) submitBtn.style.display = '';
        }
    }

    function hideNativePoppay() {
        stripNativePoppay();
    }

    function watchNativePoppay() {
        startPoppayStrip();
    }

    function bindTabSync() {
        const bind = (nodes, tabName) => {
            nodes.forEach((tab) => {
                if (tab.classList.contains('bvs-qris-cepat-tab')) return;
                if (tab.dataset.bvsTabBound) return;
                tab.dataset.bvsTabBound = tabName;
                const go = () => {
                    window.__BVS_QRIS_TAB__ = tabName === 'cepat' ? 'native' : 'manual';
                    document.querySelectorAll('.bvs-qris-cepat-tab').forEach((t) => t.classList.remove('active'));
                    setTimeout(syncCepatTabUi, 30);
                    setTimeout(syncCepatTabUi, 160);
                    setTimeout(syncCepatTabUi, 400);
                };
                tab.addEventListener('click', go);
                tab.addEventListener('touchend', go, { passive: true });
            });
        };
        bind(document.querySelectorAll('.depocepat, [data-subtarget=".cepat"]'), 'cepat');
        bind(document.querySelectorAll('.depomanual, [data-subtarget=".manual"]'), 'manual');

        document.querySelectorAll('.bvs-qris-cepat-tab').forEach((tab) => {
            if (tab.dataset.bvsTabBound) return;
            tab.dataset.bvsTabBound = 'qris';
            const go = (e) => {
                if (e) {
                    e.preventDefault();
                    e.stopPropagation();
                    if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
                }
                if (!lastHealthOk) {
                    alert('Layanan QRIS sedang OFF. Coba lagi nanti.');
                    return;
                }
                window.__BVS_QRIS_TAB__ = 'qris';
                document.querySelectorAll('.depomanual, .depocepat:not(.bvs-qris-cepat-tab), .depovip, .depohumpay').forEach((t) => {
                    t.classList.remove('active');
                });
                document.querySelectorAll('.bvs-qris-cepat-tab').forEach((t) => t.classList.add('active'));
                syncCepatTabUi();
            };
            tab.addEventListener('click', go, true);
            tab.addEventListener('touchend', go, { capture: true, passive: false });
        });
    }

    window.__BVS_QRIS_RESHOW__ = function () {
        const wrap = document.getElementById('bvs-qris-inject-wrap');
        if (wrap) placeWrap(wrap);
        bindTabSync();
        watchNativePoppay();
        syncCepatTabUi();
        return !!document.getElementById('bvsFormDepositQris');
    };

    function replaceCepatTab() {
        const mount = findMountTarget();
        if (!mount) {
            console.warn(LOG, 'Deposit form not found');
            return false;
        }

        let node = document.getElementById('bvs-qris-inject-wrap');
        if (!node) {
            const username = getUsername();
            const wrapper = document.createElement('div');
            wrapper.innerHTML = buildInjectHTML(username).trim();
            node = wrapper.querySelector('#bvs-qris-inject-wrap');
            if (!node) {
                console.warn(LOG, 'Inject HTML missing wrap');
                return false;
            }
        }

        placeWrap(node);
        waitAndLockUsername();
        watchUsername();

        bindTabSync();
        watchNativePoppay();
        window.__BVS_QRIS_TAB__ = detectCepatFromDom() ? 'native' : 'manual';
        syncCepatTabUi();

        const formOk = !!document.getElementById('bvsFormDepositQris');
        const parentCls = node.parentElement ? node.parentElement.className : '';
        const userNow = (document.getElementById('bvsQrisUsername') || {}).value || '';
        console.log(
            LOG,
            'Injected, form=', formOk,
            'tab=', window.__BVS_QRIS_TAB__,
            'user=', userNow || '(empty)',
            'parent=', parentCls
        );
        return formOk;
    }

    function attachHandlers() {
        const box = document.getElementById('bvsFormDepositQris');
        const amountInput = document.getElementById('bvsDepositInput');
        const amountHidden = document.getElementById('bvsDepositAmountHidden');
        const btn = document.getElementById('bvsQrisSubmitBtn');

        if (!box || !amountInput || !btn) {
            console.warn(LOG, 'Form elements not found');
            return;
        }
        if (box.dataset.bvsBound === '1') return;
        box.dataset.bvsBound = '1';

        amountInput.addEventListener('input', (e) => {
            const raw = e.target.value.replace(/[^\d]/g, '');
            const num = parseInt(raw, 10) || 0;
            amountHidden.value = num;
            e.target.value = num > 0 ? formatRpLabel(num) : '';
        });

        async function startQris(e) {
            if (e) {
                e.preventDefault();
                e.stopPropagation();
            }
            if (formSubmitInProgress) return;

            const username = lockedUsername || getUsername();
            const amount = parseInt(amountHidden.value, 10) || 0;
            applyUsernameToForm(username);

            if (!username) {
                alert('Username tidak ditemukan (span.g8-name). Login dulu, lalu refresh.');
                return;
            }
            if (amount < CFG.MIN_DEPO) {
                alert(`Minimal deposit ${formatRpLabel(CFG.MIN_DEPO)}`);
                return;
            }
            if (amount > CFG.MAX_DEPO) {
                alert(`Maksimal deposit ${formatRpLabel(CFG.MAX_DEPO)}`);
                return;
            }

            const healthOk = await checkPaymentHealth(true);
            syncCepatTabUi();
            if (!healthOk) {
                alert('Layanan QRIS sedang OFF. Coba lagi nanti.');
                return;
            }

            formSubmitInProgress = true;
            const btnText = document.getElementById('bvsQrisBtnText');
            btn.disabled = true;
            if (btnText) btnText.textContent = 'MEMPROSES...';

            try {
                await showPayment(username, amount);
            } catch (err) {
                alert(`Error: ${err.message}`);
                console.error(LOG, 'Payment error:', err);
                resetQrisForm();
            } finally {
                formSubmitInProgress = false;
                btn.disabled = false;
                if (btnText) btnText.textContent = 'TAMPILKAN QRIS';
            }
        }

        btn.addEventListener('click', startQris);
        amountInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') startQris(e);
        });

        const nativeForm = document.getElementById('confirm-form');
        if (nativeForm && nativeForm.dataset.bvsBlock !== '1') {
            nativeForm.dataset.bvsBlock = '1';
            nativeForm.addEventListener('submit', (e) => {
                const wrap = document.getElementById('bvs-qris-inject-wrap');
                if (wrap && !wrap.classList.contains('bvs-qris-hidden') && wrap.style.display !== 'none') {
                    e.preventDefault();
                    e.stopPropagation();
                    return;
                }
                const bankSel = nativeForm.querySelector('select[name="bankId"], select.bank-get');
                const opt = bankSel && bankSel.options[bankSel.selectedIndex];
                if (opt && isPoppayOption(opt)) {
                    e.preventDefault();
                    e.stopPropagation();
                    hideNativePoppay();
                }
            }, true);
        }
    }

    function resetQrisForm() {
        formSubmitInProgress = false;
        const form = document.getElementById('bvsFormDepositQris');
        const resultDiv = document.getElementById('bvsQrisResult');
        const frameDiv = document.getElementById('bvs-qris-payment-frame');
        const payResult = document.getElementById('bvs-qris-payment-result');
        const btn = document.getElementById('bvsQrisSubmitBtn');
        const btnText = document.getElementById('bvsQrisBtnText');
        if (form) form.style.display = '';
        if (resultDiv) resultDiv.classList.remove('active');
        if (frameDiv) frameDiv.innerHTML = '';
        if (payResult) payResult.innerHTML = '';
        if (btn) btn.disabled = false;
        if (btnText) btnText.textContent = 'TAMPILKAN QRIS';
    }

    async function showPayment(username, amount) {
        if (typeof window.QrisSDK === 'undefined') {
            await loadQrisSDK();
        }
        if (typeof window.QrisSDK === 'undefined') {
            throw new Error('QRIS SDK gagal load (QrisSDK undefined)');
        }

        const form = document.getElementById('bvsFormDepositQris');
        const resultDiv = document.getElementById('bvsQrisResult');
        const frameDiv = document.getElementById('bvs-qris-payment-frame');
        const payResult = document.getElementById('bvs-qris-payment-result');
        const btnText = document.getElementById('bvsQrisBtnText');

        if (form) form.style.display = 'none';
        if (resultDiv) resultDiv.classList.add('active');
        if (frameDiv) frameDiv.innerHTML = '';
        if (payResult) payResult.innerHTML = '';
        if (btnText) btnText.textContent = 'Memuat...';

        const invoice = `${CFG.INVOICE_PREFIX}${Date.now()}`;
        console.log(LOG, 'Creating QRIS', { username, amount, invoice, source: lockedUsernameSource });

        const payment = new window.QrisSDK({
            healthCheckEnabled: false,
            storeKey: CFG.STORE_KEY,
            store_key: CFG.STORE_KEY,
            amount,
            invoice,
            notes: `BVS QRIS ${invoice}`,
            username,
            payor_name: username,
            payor_email: '',
            displayMode: 'inline',
            containerId: 'bvs-qris-payment-frame',
            resultContainerId: 'bvs-qris-payment-result',
            onSuccess: () => {
                if (payResult) {
                    payResult.innerHTML = `
                        <div class="bvs-qris-success-box">
                            <h4>Pembayaran Berhasil!</h4>
                            <p>Deposit ${formatRpLabel(amount)} sedang diproses</p>
                        </div>`;
                }
                setTimeout(resetQrisForm, 8000);
            },
            onFailed: () => {
                alert('Gagal buat QR. Coba lagi.');
                resetQrisForm();
            },
            onCancel: () => {
                resetQrisForm();
            },
        });

        payment.openPayment();
    }

    function loadQrisSDK() {
        return new Promise((resolve, reject) => {
            if (typeof window.QrisSDK !== 'undefined') {
                resolve();
                return;
            }
            const script = document.createElement('script');
            script.src = SDK_URL;
            script.onload = () => {
                if (typeof window.QrisSDK === 'undefined') {
                    reject(new Error('SDK loaded tapi window.QrisSDK tidak ada'));
                    return;
                }
                console.log(LOG, 'QrisSDK loaded');
                resolve();
            };
            script.onerror = () => reject(new Error('Gagal load QRIS SDK dari ' + SDK_URL));
            document.head.appendChild(script);
        });
    }

    function init() {
        debugLog('Initializing BVS QRIS inject v' + VERSION);
        startPoppayStrip();
        
        // Wait for page to be ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', init);
            return;
        }
        
        // Check if we're on deposit page
        if (!window.location.pathname.includes('/deposit')) {
            debugLog('Not on deposit page, skipping');
            return;
        }
        
        let tries = 0;
        const maxTries = 20;

        function attempt() {
            if (replaceCepatTab()) {
                attachHandlers();
                waitAndLockUsername();
                applyHealthAndSync(true).catch((e) => debugLog('health boot error', e));
                startHealthMonitor();
                loadQrisSDK().catch((err) => console.warn(LOG, err.message));
                return;
            }
            tries += 1;
            if (tries < maxTries) {
                setTimeout(attempt, 500);
            } else {
                console.warn(LOG, 'Gave up waiting for Deposit Cepat tab');
            }
        }

        attempt();
        return true;
    }

    init();
    return LOG + ' v' + VERSION + ' ready';
})();
