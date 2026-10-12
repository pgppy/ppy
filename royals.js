// ============================================================================
// Royalslot QRIS inject (ISports) — royals.js
// Embed: /royals.js?store_key=sk_xxx&min_depo=30000&max_depo=10000000
// SDK: https://unpkg.com/@poppackage/pg-ppy-sdk@1.0.0/dist/qris-sdk.umd.js
// Health: GET https://payment.pg-poppay.com/api/payment-health-v2 (+ X-Store-Key)
// ============================================================================

(function () {
    'use strict';

    const LOG = '[ROYALS-QRIS]';
    const VERSION = '0.6.3';
    const PANEL_TITLE = 'DEPOSIT QRIS (INSTANT AUTO)';
    const ISPORTS_TITLE = 'QRIS Instant Auto';
    const SDK_URL = 'https://unpkg.com/@poppackage/pg-ppy-sdk@1.0.0/dist/qris-sdk.umd.js';

    if (window.__IDN_QRIS_INJECT_BOOTED__) {
        if (typeof window.__IDN_QRIS_BOOT__ === 'function') {
            window.__IDN_QRIS_BOOT__({ rehook: true });
        }
        return;
    }
    window.__IDN_QRIS_INJECT_BOOTED__ = true;

    window.IDN_PG_CONFIG = window.IDN_PG_CONFIG || {
        STORE_KEY: '',
        MIN_DEPO: 30000,
        MAX_DEPO: 10000000,
        INVOICE_PREFIX: 'IDN-',
        SKIP_STORE_KEY: false,
        CONVERSION_RATIO: 1,
    };

    let formSubmitInProgress = false;
    let injectHandlersAttached = false;
    let reinjectionInProgress = false;
    let paymentHealthCache = null;
    let paymentHealthCacheKey = '';
    let paymentHealthCacheAt = 0;
    let healthMonitorStarted = false;
    let lastHealthLogged = null;
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
            const named = scripts.find((url) =>
                /royals\.js(\?|$)/i.test(url) ||
                /idn[_-]?qris[_-]?inject\.js(\?|$)/i.test(url) ||
                /idnv\d+\.js(\?|$)/i.test(url) ||
                /idns\.js(\?|$)/i.test(url)
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

    const DEBUG = parseBool(getParam('debug'), window.IDN_PG_CONFIG.DEBUG === true);

    function parseNum(raw, fallback) {
        if (raw == null || raw === '') return fallback;
        const n = parseInt(String(raw).replace(/[^\d]/g, ''), 10);
        return Number.isFinite(n) && n > 0 ? n : fallback;
    }

    const CONVERSION_RATIO = parseNum(
        getParam('conversion_ratio'),
        window.IDN_PG_CONFIG.CONVERSION_RATIO ?? 1
    );

    const CFG = {
        STORE_KEY: (
            getParam('store_key') ||
            window.IDN_PGSCRIPT_STORE_KEY ||
            window.IDN_PG_CONFIG.STORE_KEY ||
            ''
        ).toString().trim(),
        MIN_DEPO: parseNum(getParam('min_depo'), window.IDN_PG_CONFIG.MIN_DEPO || 30000),
        MAX_DEPO: parseNum(getParam('max_depo'), window.IDN_PG_CONFIG.MAX_DEPO || 10000000),
        INVOICE_PREFIX: getParam('invoice_prefix') || window.IDN_PG_CONFIG.INVOICE_PREFIX || 'IDN-',
        SKIP_STORE_KEY: window.IDN_PG_CONFIG.SKIP_STORE_KEY === true,
        CONVERSION_RATIO,
        HEALTH_BASE: (() => {
            let base = (
                getParam('health_base') ||
                getParam('api_base') ||
                window.IDN_PG_HEALTH_BASE ||
                window.IDN_PGSCRIPT_BASE ||
                window.IDN_PGSCRIPT_BASE_URL ||
                window.PGSCRIPT_BASE ||
                window.PGSCRIPT_BASE_URL ||
                'https://payment.pg-poppay.com'
            ).toString().trim().replace(/\/+$/, '');
            if (location.protocol === 'https:' && base.startsWith('http://')) {
                base = 'https://' + base.slice(7);
            }
            return base;
        })(),
        HEALTH_PATH: (
            getParam('health_path') ||
            window.IDN_PG_HEALTH_PATH ||
            ''
        ).toString().trim().replace(/^\/+/, ''),
        HEALTH_URL: (() => {
            const direct = (
                getParam('health_url') ||
                window.IDN_PG_HEALTH_URL ||
                ''
            ).toString().trim();
            if (direct) return direct.replace(/\/+$/, '');
            return '';
        })(),
        API_VERSION: (getParam('api_version') || window.IDN_PGSCRIPT_API_VERSION || 'api').toString().trim(),
        HEALTH_POLL_SEC: parseNum(getParam('health_poll_sec'), 15),
    };

    CFG.MIN_DISPLAY = CFG.CONVERSION_RATIO === 1
        ? CFG.MIN_DEPO
        : Math.ceil(CFG.MIN_DEPO / CFG.CONVERSION_RATIO);
    CFG.MAX_DISPLAY = CFG.CONVERSION_RATIO === 1
        ? CFG.MAX_DEPO
        : Math.floor(CFG.MAX_DEPO / CFG.CONVERSION_RATIO);

    function depositPath() {
        return (location.pathname || '').replace(/\/+$/, '').toLowerCase();
    }

    function isIdnQrisPage() {
        const path = depositPath();
        if (path === '/deposit' || path.endsWith('/deposit')) return true;
        if (document.getElementById('_hoki-app') && path.includes('deposit')) return true;
        const title = document.querySelector('.pages-box__title');
        if (title && /deposit qris/i.test(title.textContent || '') && path.includes('deposit')) return true;
        return false;
    }

    function getHokiRoot() {
        return document.getElementById('_hoki-app');
    }

    /**
     * Struktur live (setelah HOKI load):
     *   .content-page__wrapper
     *     #_hoki-app          ← HOKI prepend (Deposit QRIS Instan Auto Approve)
     *     .content-page__container ← Manual Deposit + #formDeposit
     * Target inject: sibling PERTAMA di wrapper (prepend), bukan di dalam Manual Deposit.
     */
    function getDepositWrapper() {
        return document.querySelector('.content-page__wrapper')
            || document.getElementById('content')
            || document.querySelector('.forms');
    }

    function isISportsShell() {
        const w = getDepositWrapper();
        return !!(w && (w.id === 'content' || (w.classList && w.classList.contains('forms'))));
    }

    function currentPanelTitle() {
        return isISportsShell() ? ISPORTS_TITLE : PANEL_TITLE;
    }

    /** HOKI biasa mount 1–3s; tanpa HOKI inject setelah grace (jangan nunggu 10s). */
    const HOKI_GRACE_MS = 2500;

    function waitForDepositShell(maxMs) {
        const limit = maxMs || 10000;
        return new Promise((resolve) => {
            const start = Date.now();
            let formReadyAt = 0;

            const tick = () => {
                const w = getDepositWrapper();
                if (!w) {
                    if (Date.now() - start >= limit) {
                        resolve(getDepositWrapper());
                        return;
                    }
                    setTimeout(tick, 100);
                    return;
                }

                const isports = w.id === 'content' || w.classList.contains('forms');
                if (isports) {
                    resolve(w);
                    return;
                }

                const hasForm = !!w.querySelector('#formDeposit');
                const hasHoki = !!getHokiRoot();

                if (hasForm && hasHoki) {
                    resolve(w);
                    return;
                }

                if (hasForm) {
                    if (!formReadyAt) formReadyAt = Date.now();
                    if (Date.now() - formReadyAt >= HOKI_GRACE_MS) {
                        resolve(w);
                        return;
                    }
                }

                if (Date.now() - start >= limit) {
                    resolve(w);
                    return;
                }
                setTimeout(tick, 100);
            };
            tick();
        });
    }

    function dedupeInjectWraps() {
        const nodes = document.querySelectorAll('#idn-qris-inject-wrap');
        for (let i = 1; i < nodes.length; i += 1) {
            nodes[i].remove();
        }
    }

    /** prepend ke .content-page__wrapper — jangan insert ke .pages-box / Manual container. */
    function ensureInjectOnTop(reason) {
        dedupeInjectWraps();
        const wrap = document.getElementById('idn-qris-inject-wrap');
        const wrapper = getDepositWrapper();
        if (!wrap || !wrapper) return false;

        if (wrap.parentElement !== wrapper || wrapper.firstElementChild !== wrap) {
            wrapper.prepend(wrap);
            restorePanelTitle();
            debugLog('panel prepend wrapper', reason || '');
            return true;
        }
        return false;
    }

    function isValidUser(v) {
        const t = String(v || '').trim();
        if (!/^[a-zA-Z0-9_]{3,24}$/.test(t)) return false;
        if (/^\d+$/.test(t) && t.length < 5) return false;
        return true;
    }

    function readUsernameFromDom() {
        const nodes = document.querySelectorAll('a, span, div, li, small');
        for (const el of nodes) {
            if (el.closest('#idn-qris-inject-wrap')) continue;
            const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
            const m = t.match(/^Hi,?\s*([a-zA-Z0-9_]{3,24})$/i);
            if (m && el.children.length <= 3 && isValidUser(m[1])) return m[1];
        }
        const formDeposit = document.getElementById('formDeposit');
        if (formDeposit) {
            const inp = formDeposit.querySelector('input[disabled]');
            const v = (inp?.value || '').trim();
            if (isValidUser(v)) return v;
        }
        const scopes = [getHokiRoot(), document];
        for (const scope of scopes) {
            if (!scope) continue;
            const inputs = scope.querySelectorAll('input[disabled]');
            for (const inp of inputs) {
                const v = (inp.value || '').trim();
                if (isValidUser(v)) return v;
            }
        }
        return null;
    }

    async function fetchUsernameISports() {
        try {
            const r = await fetch('/password/change', {
                credentials: 'same-origin',
                cache: 'no-store',
                signal: AbortSignal.timeout(3500),
            });
            if (r.ok) {
                const html = await r.text();
                const doc = new DOMParser().parseFromString(html, 'text/html');
                const icon = doc.querySelector('i.fa-user');
                let text = icon && icon.parentElement ? icon.parentElement.textContent : '';
                if (!text) {
                    const welcome = doc.querySelector('.user-welcome');
                    text = welcome ? welcome.textContent : '';
                }
                const m = String(text || '').match(/Hi,\s*([a-zA-Z0-9_]{3,24})/i);
                if (m && isValidUser(m[1])) return m[1];
            }
        } catch (_) {}
        try {
            const r = await fetch('/referral', {
                credentials: 'same-origin',
                cache: 'no-store',
                signal: AbortSignal.timeout(3500),
            });
            if (!r.ok) return null;
            const html = await r.text();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            const inp = doc.querySelector('#ref-link');
            const val = inp && inp.value ? String(inp.value) : '';
            const m = val.match(/ref=([a-zA-Z0-9_]{3,24})/i);
            if (m && isValidUser(m[1])) return m[1];
        } catch (_) {}
        return null;
    }

    function parseDigits(str) {
        return String(str || '').replace(/[^\d]/g, '');
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
        return `Min Rp ${min}  ·  Max Rp ${max}`;
    }

    function chipLabel(n) {
        if (n >= 1000000 && n % 1000000 === 0) return `${n / 1000000}JT`;
        if (n >= 1000 && n % 1000 === 0) return `${n / 1000}K`;
        return formatAmountDisplay(n);
    }

    function amountPresets() {
        const presets = [30000, 50000, 100000, 250000, 500000, 1000000, 2000000];
        return presets.filter((n) => n >= CFG.MIN_DEPO && n <= CFG.MAX_DEPO);
    }

    function buildAmountChips() {
        return amountPresets().map((n) =>
            `<button type="button" class="idn-qris-chip" data-amount="${n}">${chipLabel(n)}</button>`
        ).join('');
    }

    function syncChipActive(amount) {
        const raw = parseInt(amount, 10) || 0;
        document.querySelectorAll('#idn-qris-inject-wrap .idn-qris-chip').forEach((btn) => {
            btn.classList.toggle('is-active', parseInt(btn.getAttribute('data-amount'), 10) === raw);
        });
    }

    function setInjectAmount(n) {
        const raw = parseInt(n, 10) || 0;
        const amountInput = document.getElementById('idnDepositInput');
        const amountHidden = document.getElementById('idnDepositAmountHidden');
        const rupiah = raw * (CFG.CONVERSION_RATIO || 1);
        if (amountHidden) amountHidden.value = String(rupiah);
        if (amountInput) {
            if (raw <= 0) {
                amountInput.value = '';
                amountInput.classList.add('currencyInput__formatted--zero');
            } else {
                amountInput.value = formatRpLabel(CFG.CONVERSION_RATIO === 1 ? raw : rupiah);
                amountInput.classList.remove('currencyInput__formatted--zero');
            }
        }
        syncChipActive(raw);
        return rupiah;
    }

    function buildHokiInjectHTML(username) {
        return `
            <style>
                #idn-qris-inject-wrap { margin-bottom: 12px; }
                #idn-qris-inject-wrap .form-deposit-withdraw {
                    min-height: 350px;
                    padding-bottom: 30px;
                }
                #idn-qris-inject-wrap .form-deposit-withdraw .form-row {
                    display: flex;
                    flex-wrap: wrap;
                    flex-direction: row;
                    gap: 20px;
                }
                #idn-qris-inject-wrap .form-deposit-withdraw .form-group,
                #idn-qris-inject-wrap .form-deposit-withdraw .btn-wrapper {
                    flex: 1 1 100%;
                    width: 100%;
                    max-width: 100%;
                    box-sizing: border-box;
                    margin-bottom: 8px;
                }
                #idn-qris-inject-wrap .form-deposit-withdraw .btn-wrapper {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                    margin-top: 12px;
                }
                #idn-qris-inject-wrap .idn-qris-panel__title {
                    color: #fff;
                    font-size: 16px;
                    font-weight: 600;
                    padding: 12px 16px 8px;
                    margin: 0;
                    text-transform: none;
                }
                #idn-qris-inject-wrap .idn-qris-result { display: none; }
                #idn-qris-inject-wrap .idn-qris-result.active { display: block; margin-top: 12px; }
                #idn-qris-inject-wrap .idn-qris-result.active #idn-qris-payment-frame { min-height: 320px; text-align: center; }
                #idn-qris-payment-result { margin-top: 12px; }
                #idn-qris-inject-wrap .idn-qris-success-box {
                    padding: 16px;
                    border-radius: 0.25rem;
                    background: rgba(40, 167, 69, 0.1);
                    border: 1px solid rgba(40, 167, 69, 0.35);
                }
                #idn-qris-inject-wrap .idn-qris-success-box h4 { margin: 0 0 8px; font-size: 16px; }
                #idn-qris-inject-wrap .idn-qris-success-box p { margin: 0; font-size: 14px; }
                @media (max-width: 768px) {
                    #idn-qris-inject-wrap .form-deposit-withdraw {
                        min-height: 350px;
                        padding-bottom: 30px;
                    }
                    #idn-qris-inject-wrap .form-deposit-withdraw .form-row {
                        gap: 18px;
                    }
                    #idn-qris-inject-wrap .form-deposit-withdraw .btn-wrapper {
                        margin-top: 10px;
                    }
                }
            </style>
            <div class="content-page__container content-page__container--bg" id="idn-qris-inject-panel" data-idn-isolated="true">
                <div class="idn-qris-panel__title" id="idnQrisPanelTitle">${PANEL_TITLE}</div>
                <div class="pages-misc">
                    <form class="form-deposit-withdraw" id="idnFormDepositQris" autocomplete="off">
                        <input type="hidden" id="idnQrisUsername" value="${username}">
                        <div class="form-row">
                            <div class="form-group">
                                <label for="idnQrisUsernameDisplay"><i class="fa fa-user"></i> Username</label>
                                <div class="input-group">
                                    <input type="text" id="idnQrisUsernameDisplay" disabled translate="no"
                                        class="form-control form-deposit-withdraw__input form-deposit-withdraw__input--disabled"
                                        value="${username}">
                                </div>
                            </div>
                            <div class="form-group">
                                <label for="idnDepositInput"><i class="far fa-credit-card"></i> Jumlah</label>
                                <div class="input-group number-wrapper" data-currency="idr" data-field="amount">
                                    <input type="hidden" class="currencyInput__unformatted" id="idnDepositAmountHidden" name="amount" value="0">
                                    <input type="text" id="idnDepositInput" placeholder="Rp&nbsp;0"
                                        class="form-control form-deposit-withdraw__input currencyInput__formatted--zero"
                                        style="border-radius: 0.25rem;" autocomplete="off" inputmode="numeric"
                                        name="formatted-amount">
                                </div>
                                <span style="font-size: 12px;">${amountHintText()}</span>
                            </div>
                            <div class="btn-wrapper">
                                <button type="submit"
                                    class="btn form-deposit-withdraw__btn form-deposit-withdraw__btn--deposit pr-2"
                                    id="idnQrisSubmitBtn">
                                    <span id="idnQrisBtnText">TAMPILKAN QRIS</span>
                                </button>
                            </div>
                        </div>
                    </form>
                    <div class="idn-qris-result" id="idnQrisResult">
                        <div id="idn-qris-payment-frame"></div>
                        <div id="idn-qris-payment-result"></div>
                    </div>
                </div>
            </div>`;
    }

    function buildISportsInjectHTML(username) {
        return `
            <style>
                #content:has(> #idn-qris-inject-wrap.idn-isports),
                #content:has(#idn-qris-inject-wrap.idn-isports) {
                    overflow: visible !important;
                    height: auto !important;
                    max-height: none !important;
                }
                #idn-qris-inject-wrap.idn-isports {
                    --idn-teal: #1ed4b3;
                    --idn-teal-2: #12b89c;
                    --idn-cyan: #00bcd4;
                    box-sizing: border-box;
                    width: 100%;
                    margin: 0 0 16px;
                    font-family: inherit;
                    position: relative;
                    z-index: 1;
                }
                #idn-qris-inject-wrap.idn-isports *,
                #idn-qris-inject-wrap.idn-isports *::before,
                #idn-qris-inject-wrap.idn-isports *::after { box-sizing: border-box; }
                #idn-qris-inject-wrap.idn-isports #idn-qris-inject-panel { all: unset; display: block; }
                #idn-qris-inject-wrap.idn-isports .idn-isports-card {
                    background: #141414;
                    border: 2px solid var(--idn-teal);
                    border-radius: 6px;
                    overflow: visible;
                    color: #fff;
                }
                #idn-qris-inject-wrap.idn-isports .idn-isports-head {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                    padding: 14px 16px 12px;
                    background: linear-gradient(90deg, #0e4a4a 0%, #163a3a 55%, #141414 100%);
                    border-bottom: 1px solid rgba(30, 212, 179, 0.35);
                }
                #idn-qris-inject-wrap.idn-isports .idn-isports-kicker {
                    font-size: 11px;
                    letter-spacing: 0.12em;
                    text-transform: uppercase;
                    color: var(--idn-teal);
                    font-weight: 700;
                    margin: 0 0 4px;
                }
                #idn-qris-inject-wrap.idn-isports .idn-qris-panel__title {
                    margin: 0;
                    padding: 0;
                    color: #fff !important;
                    font-size: 20px;
                    font-weight: 800;
                    letter-spacing: 0.02em;
                    line-height: 1.2;
                    text-transform: none;
                }
                #idn-qris-inject-wrap.idn-isports .idn-isports-badge {
                    flex-shrink: 0;
                    background: var(--idn-teal);
                    color: #06241f;
                    font-size: 11px;
                    font-weight: 800;
                    letter-spacing: 0.08em;
                    padding: 6px 10px;
                    border-radius: 999px;
                }
                #idn-qris-inject-wrap.idn-isports #idnFormDepositQris {
                    margin: 0;
                    padding: 16px;
                    display: flex;
                    flex-direction: column;
                    gap: 14px;
                }
                #idn-qris-inject-wrap.idn-isports .idn-isports-field { display: flex; flex-direction: column; gap: 6px; }
                #idn-qris-inject-wrap.idn-isports .idn-isports-label {
                    font-size: 12px;
                    font-weight: 600;
                    color: #c9c9c9 !important;
                }
                #idn-qris-inject-wrap.idn-isports #idnQrisUsernameDisplay {
                    width: 100%;
                    height: 44px;
                    border: 1px solid #2a2a2a;
                    border-radius: 6px;
                    background: #f7f7f7 !important;
                    color: #111 !important;
                    font-size: 15px;
                    font-weight: 700;
                    padding: 0 12px;
                    opacity: 1 !important;
                    -webkit-text-fill-color: #111 !important;
                }
                #idn-qris-inject-wrap.idn-isports .idn-qris-chips {
                    display: grid;
                    grid-template-columns: repeat(7, minmax(0, 1fr));
                    gap: 6px;
                }
                #idn-qris-inject-wrap.idn-isports .idn-qris-chip {
                    appearance: none;
                    border: 0;
                    height: 36px;
                    border-radius: 5px;
                    background: var(--idn-teal);
                    color: #06241f;
                    font-size: 12px;
                    font-weight: 800;
                    cursor: pointer;
                    padding: 0 4px;
                }
                #idn-qris-inject-wrap.idn-isports .idn-qris-chip.is-active {
                    background: #fff;
                    color: #0a7a68;
                    box-shadow: inset 0 0 0 2px #0a7a68;
                }
                #idn-qris-inject-wrap.idn-isports #idnDepositInput {
                    width: 100%;
                    height: 46px;
                    border: 1px solid #2a2a2a;
                    border-radius: 6px;
                    background: #fff !important;
                    color: #111 !important;
                    font-size: 16px;
                    font-weight: 700;
                    padding: 0 12px;
                }
                #idn-qris-inject-wrap.idn-isports #idnDepositInput:focus {
                    outline: none;
                    border-color: var(--idn-teal);
                    box-shadow: 0 0 0 2px rgba(30, 212, 179, 0.35);
                }
                #idn-qris-inject-wrap.idn-isports .idn-isports-hint {
                    font-size: 12px;
                    color: #9aa0a6 !important;
                    margin-top: 2px;
                }
                #idn-qris-inject-wrap.idn-isports #idnQrisSubmitBtn {
                    appearance: none;
                    width: 100%;
                    height: 48px;
                    border: 0;
                    border-radius: 6px;
                    background: linear-gradient(180deg, var(--idn-teal) 0%, var(--idn-teal-2) 100%) !important;
                    color: #06241f !important;
                    font-size: 15px;
                    font-weight: 800;
                    letter-spacing: 0.06em;
                    cursor: pointer;
                    box-shadow: 0 6px 16px rgba(18, 184, 156, 0.28);
                }
                #idn-qris-inject-wrap.idn-isports #idnQrisSubmitBtn:disabled {
                    opacity: 0.65;
                    cursor: wait;
                }
                #idn-qris-inject-wrap.idn-isports .idn-qris-result { display: none; }
                #idn-qris-inject-wrap.idn-isports .idn-qris-result.active { display: block; margin: 0 16px 16px; }
                #idn-qris-inject-wrap.idn-isports .idn-qris-result.active #idn-qris-payment-frame { min-height: 320px; text-align: center; }
                #idn-qris-inject-wrap.idn-isports .idn-qris-success-box {
                    padding: 16px;
                    border-radius: 8px;
                    background: rgba(30, 212, 179, 0.12);
                    border: 1px solid rgba(30, 212, 179, 0.4);
                    color: #fff;
                }
                #idn-qris-inject-wrap.idn-isports .idn-qris-success-box h4 { margin: 0 0 8px; font-size: 16px; }
                #idn-qris-inject-wrap.idn-isports .idn-qris-success-box p { margin: 0; font-size: 14px; }
                @media (max-width: 768px) {
                    #idn-qris-inject-wrap.idn-isports {
                        margin: 8px 12px 20px;
                        padding-bottom: 12px;
                        scroll-margin-top: 58px;
                    }
                    #idn-qris-inject-wrap.idn-isports .idn-isports-card {
                        background: #fff;
                        border: 0;
                        border-radius: 16px;
                        box-shadow: 0 8px 28px rgba(15, 23, 42, 0.08);
                        color: #111;
                    }
                    #idn-qris-inject-wrap.idn-isports .idn-isports-head {
                        background: #fff;
                        border-bottom: 0;
                        padding: 18px 18px 0;
                    }
                    #idn-qris-inject-wrap.idn-isports .idn-qris-panel__title {
                        color: #111 !important;
                        font-size: 26px;
                        font-weight: 800;
                    }
                    #idn-qris-inject-wrap.idn-isports .idn-isports-badge {
                        background: var(--idn-cyan);
                        color: #fff;
                    }
                    #idn-qris-inject-wrap.idn-isports #idnFormDepositQris { padding: 14px 18px 18px; gap: 12px; }
                    #idn-qris-inject-wrap.idn-isports .idn-isports-label { color: #6b7280 !important; }
                    #idn-qris-inject-wrap.idn-isports #idnQrisUsernameDisplay {
                        height: 48px;
                        border: 0;
                        border-radius: 12px;
                        background: #e8eaef !important;
                        color: #4b5563 !important;
                        -webkit-text-fill-color: #4b5563 !important;
                        font-weight: 600;
                    }
                    #idn-qris-inject-wrap.idn-isports .idn-qris-chips {
                        grid-template-columns: repeat(3, minmax(0, 1fr));
                        gap: 8px;
                    }
                    #idn-qris-inject-wrap.idn-isports .idn-qris-chip {
                        height: 40px;
                        border-radius: 10px;
                        background: #e6fffa;
                        color: #0f766e;
                    }
                    #idn-qris-inject-wrap.idn-isports .idn-qris-chip.is-active {
                        background: var(--idn-cyan);
                        color: #fff;
                        box-shadow: none;
                    }
                    #idn-qris-inject-wrap.idn-isports #idnDepositInput {
                        height: 52px;
                        border: 0;
                        border-radius: 12px;
                        background: #2b2f38 !important;
                        color: #fff !important;
                        -webkit-text-fill-color: #fff !important;
                    }
                    #idn-qris-inject-wrap.idn-isports #idnDepositInput::placeholder { color: #9ca3af; }
                    #idn-qris-inject-wrap.idn-isports .idn-isports-hint { color: #6b7280 !important; }
                    #idn-qris-inject-wrap.idn-isports #idnQrisSubmitBtn {
                        height: 52px;
                        border-radius: 12px;
                        background: linear-gradient(180deg, #26c6da 0%, #00acc1 100%) !important;
                        color: #fff !important;
                        box-shadow: 0 8px 18px rgba(0, 172, 193, 0.28);
                    }
                    #idn-qris-inject-wrap.idn-isports .idn-qris-result.active { margin: 0 18px 18px; }
                    #idn-qris-inject-wrap.idn-isports .idn-qris-success-box { color: #111; }
                }
            </style>
            <div id="idn-qris-inject-panel" data-idn-isolated="true">
                <div class="idn-isports-card">
                    <div class="idn-isports-head">
                        <div>
                            <div class="idn-isports-kicker">Auto approve</div>
                            <div class="idn-qris-panel__title" id="idnQrisPanelTitle">${ISPORTS_TITLE}</div>
                        </div>
                        <span class="idn-isports-badge">QRIS</span>
                    </div>
                    <form id="idnFormDepositQris" autocomplete="off">
                        <input type="hidden" id="idnQrisUsername" value="${username}">
                        <div class="idn-isports-field">
                            <label class="idn-isports-label" for="idnQrisUsernameDisplay">Username</label>
                            <input type="text" id="idnQrisUsernameDisplay" disabled translate="no" value="${username}">
                        </div>
                        <div class="idn-isports-field">
                            <label class="idn-isports-label" for="idnDepositInput">Jumlah deposit</label>
                            <div class="idn-qris-chips">${buildAmountChips()}</div>
                            <input type="hidden" id="idnDepositAmountHidden" name="amount" value="0">
                            <input type="text" id="idnDepositInput" placeholder="Rp 0" autocomplete="off" inputmode="numeric" name="formatted-amount">
                            <span class="idn-isports-hint">${amountHintText()}</span>
                        </div>
                        <button type="submit" id="idnQrisSubmitBtn">
                            <span id="idnQrisBtnText">TAMPILKAN QRIS</span>
                        </button>
                    </form>
                    <div class="idn-qris-result" id="idnQrisResult">
                        <div id="idn-qris-payment-frame"></div>
                        <div id="idn-qris-payment-result"></div>
                    </div>
                </div>
            </div>`;
    }

    function buildInjectHTML(username) {
        return isISportsShell() ? buildISportsInjectHTML(username) : buildHokiInjectHTML(username);
    }

    let panelGuardStarted = false;

    function restorePanelTitle() {
        const title = document.getElementById('idnQrisPanelTitle');
        if (!title) return;
        const want = currentPanelTitle();
        if (title.textContent.trim() !== want) {
            title.textContent = want;
            debugLog('title di-restore (HOKI/deposit.js overwrite)');
        }
    }

    function startPanelGuard() {
        if (panelGuardStarted) return;
        panelGuardStarted = true;
        const title = document.getElementById('idnQrisPanelTitle');
        if (!title) return;
        restorePanelTitle();
        const obs = new MutationObserver(() => restorePanelTitle());
        obs.observe(title, { childList: true, subtree: true, characterData: true });
        setInterval(restorePanelTitle, 800);
    }

    function readInjectAmount() {
        const hidden = document.getElementById('idnDepositAmountHidden');
        if (hidden?.value && hidden.value !== '0') {
            return parseInt(hidden.value, 10) || 0;
        }
        return syncAmountFieldsFromInput();
    }

    function syncAmountFieldsFromInput() {
        const amountInput = document.getElementById('idnDepositInput');
        const amountHidden = document.getElementById('idnDepositAmountHidden');
        if (!amountInput || !amountHidden) return 0;

        const digits = parseDigits(amountInput.value);
        if (!digits) {
            amountInput.value = '';
            amountHidden.value = '0';
            amountInput.classList.add('currencyInput__formatted--zero');
            syncChipActive(0);
            return 0;
        }

        const raw = parseInt(digits, 10);
        if (!Number.isFinite(raw) || raw <= 0) {
            amountInput.value = '';
            amountHidden.value = '0';
            amountInput.classList.add('currencyInput__formatted--zero');
            syncChipActive(0);
            return 0;
        }

        const rupiah = raw * CFG.CONVERSION_RATIO;
        amountHidden.value = String(rupiah);
        amountInput.value = formatRpLabel(CFG.CONVERSION_RATIO === 1 ? raw : rupiah);
        amountInput.classList.remove('currencyInput__formatted--zero');
        syncChipActive(raw);
        return rupiah;
    }

    function teardownInject(reason) {
        const wrap = document.getElementById('idn-qris-inject-wrap');
        if (!wrap) return false;
        wrap.remove();
        injectHandlersAttached = false;
        formSubmitInProgress = false;
        panelGuardStarted = false;
        debugLog('panel hidden', reason || '');
        return true;
    }

    function paymentHealthUrl() {
        if (CFG.HEALTH_URL) return CFG.HEALTH_URL;
        const path = CFG.HEALTH_PATH || `${CFG.API_VERSION}/payment-health-v2`;
        return `${CFG.HEALTH_BASE}/${path}`;
    }

    async function checkPaymentHealth(forceRefresh) {
        if (CFG.SKIP_STORE_KEY) {
            logHealthState(true);
            return true;
        }
        if (!CFG.STORE_KEY) {
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
            return paymentHealthCache;
        }
        const url = paymentHealthUrl();
        try {
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
            logHealthState(ok);
            debugLog('payment-health-v2', ok ? 'OK' : 'OFF', url, body?.message || '');
            return ok;
        } catch (e) {
            paymentHealthCache = false;
            paymentHealthCacheKey = CFG.STORE_KEY;
            paymentHealthCacheAt = now;
            logHealthState(false);
            debugLog('payment-health-v2 error', e);
            return false;
        }
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
                        debugLog('ref_id:', refId);
                        onRef(refId, data);
                    }
                } catch (e) {
                    debugLog('ref hook', e);
                }
            }
            return res;
        };
        return () => { window.fetch = orig; };
    }

    function resetInjectForm() {
        formSubmitInProgress = false;
        const form = document.getElementById('idnFormDepositQris');
        const result = document.getElementById('idnQrisResult');
        const frame = document.getElementById('idn-qris-payment-frame');
        const payResult = document.getElementById('idn-qris-payment-result');
        const btn = document.getElementById('idnQrisSubmitBtn');
        const btnText = document.getElementById('idnQrisBtnText');
        const amountInput = document.getElementById('idnDepositInput');
        const amountHidden = document.getElementById('idnDepositAmountHidden');

        if (form) form.style.display = '';
        if (result) result.classList.remove('active');
        if (frame) frame.innerHTML = '';
        if (payResult) payResult.innerHTML = '';
        if (amountInput) {
            amountInput.value = '';
            amountInput.classList.add('currencyInput__formatted--zero');
        }
        if (amountHidden) amountHidden.value = '0';
        if (btn) btn.disabled = false;
        if (btnText) btnText.textContent = 'TAMPILKAN QRIS';
        syncChipActive(0);
    }

    async function startQrisPayment(username, amount) {
        if (typeof window.QrisSDK === 'undefined') {
            await loadQrisSDK();
        }

        const form = document.getElementById('idnFormDepositQris');
        const resultBox = document.getElementById('idnQrisResult');
        const btn = document.getElementById('idnQrisSubmitBtn');
        const btnText = document.getElementById('idnQrisBtnText');
        const frame = document.getElementById('idn-qris-payment-frame');
        const payResult = document.getElementById('idn-qris-payment-result');

        if (form) form.style.display = 'none';
        if (resultBox) resultBox.classList.add('active');
        if (frame) frame.innerHTML = '';
        if (payResult) payResult.innerHTML = '';
        if (btn) btn.disabled = true;
        if (btnText) btnText.textContent = 'Memuat...';

        const invoice = CFG.INVOICE_PREFIX + Date.now();
        let restoreFetch = withCreateTransactionHook((refId) => {
            window.__IDN_LAST_REFID__ = refId;
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
                containerId: 'idn-qris-payment-frame',
                resultContainerId: 'idn-qris-payment-result',
                onSuccess: () => {
                    if (payResult) {
                        payResult.innerHTML = `
                            <div class="idn-qris-success-box">
                                <h4>Pembayaran Berhasil!</h4>
                                <p>Deposit ${formatRpLabel(amount)} sedang diproses</p>
                            </div>`;
                    }
                    if (btnText) btnText.textContent = 'Selesai';
                    setTimeout(resetInjectForm, 8000);
                },
                onFailed: () => {
                    alert('Gagal buat QR. Coba lagi.');
                    resetInjectForm();
                },
                onCancel: () => {
                    resetInjectForm();
                },
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
        const form = document.getElementById('idnFormDepositQris');
        if (!form) return;

        injectHandlersAttached = true;

        const amountInput = document.getElementById('idnDepositInput');
        if (amountInput) {
            const onAmountInput = () => syncAmountFieldsFromInput();
            amountInput.addEventListener('input', onAmountInput);
            amountInput.addEventListener('change', onAmountInput);
            amountInput.addEventListener('blur', onAmountInput);
        }

        document.querySelectorAll('#idn-qris-inject-wrap .idn-qris-chip').forEach((chip) => {
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

            const username = (document.getElementById('idnQrisUsername')?.value || readUsernameFromDom() || '').trim();
            if (!username) {
                alert('Username tidak ditemukan. Login dulu.');
                return false;
            }

            syncAmountFieldsFromInput();
            const amount = readInjectAmount();

            if (!amount) {
                alert(`Masukkan jumlah deposit (min ${formatAmountDisplay(CFG.MIN_DEPO)})`);
                return false;
            }
            if (amount < CFG.MIN_DEPO) {
                alert(`Minimal deposit ${formatAmountDisplay(CFG.MIN_DEPO)}`);
                return false;
            }
            if (amount > CFG.MAX_DEPO) {
                alert(`Maksimal deposit ${formatAmountDisplay(CFG.MAX_DEPO)}`);
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

        debugLog('handlers OK');
    }

    async function injectQrisPanel(force) {
        if (!isIdnQrisPage()) return false;

        const existing = document.getElementById('idn-qris-inject-wrap');
        if (existing && !force) {
            attachInjectHandlers();
            ensureInjectOnTop('existing');
            return true;
        }

        const healthOk = await checkPaymentHealth(true);
        if (!healthOk) {
            if (existing) teardownInject('payment-health OFF');
            return false;
        }

        const wrapper = await waitForDepositShell();
        if (!wrapper) {
            debugLog('content-page__wrapper tidak ada');
            return false;
        }

        let username = readUsernameFromDom();
        if (!username) username = await fetchUsernameISports();
        if (!username) {
            debugLog('Username tidak ada — inject diblok');
            return false;
        }

        if (existing) existing.remove();
        dedupeInjectWraps();

        injectHandlersAttached = false;

        const panelWrap = document.createElement('div');
        panelWrap.id = 'idn-qris-inject-wrap';
        panelWrap.setAttribute('data-idn-persistent', 'true');
        if (isISportsShell()) panelWrap.className = 'idn-isports';
        panelWrap.innerHTML = buildInjectHTML(username);

        wrapper.prepend(panelWrap);

        if (!document.getElementById('idn-qris-inject-panel')) {
            debugLog('Inject gagal verify');
            panelWrap.remove();
            return false;
        }

        attachInjectHandlers();
        startPanelGuard();
        ensureInjectOnTop('inject');
        debugLog('Panel inject → after HOKI, wrapper.prepend');
        return true;
    }

    async function syncInjectPanel(reason) {
        if (!isIdnQrisPage()) {
            teardownInject(reason || 'bukan halaman deposit');
            return;
        }

        const healthOk = await checkPaymentHealth(true);
        const panel = document.getElementById('idn-qris-inject-wrap');

        if (!healthOk) {
            if (panel) teardownInject(`payment-health OFF${reason ? ` (${reason})` : ''}`);
            return;
        }

        if (!panel && !reinjectionInProgress) {
            reinjectionInProgress = true;
            try {
                await injectQrisPanel(true);
            } finally {
                reinjectionInProgress = false;
            }
        } else if (panel) {
            ensureInjectOnTop('sync');
        }
    }

    function startHealthMonitor() {
        if (healthMonitorStarted || CFG.SKIP_STORE_KEY || !CFG.STORE_KEY) return;
        healthMonitorStarted = true;
        const ms = Math.max(5, CFG.HEALTH_POLL_SEC) * 1000;
        setInterval(() => {
            syncInjectPanel('poll').catch((e) => {
                debugLog('health poll error', e);
            });
        }, ms);
        debugLog('health monitor every', ms / 1000, 's');
    }

    function watchInjection() {
        const observeWrapper = () => {
            const wrapper = getDepositWrapper();
            if (!wrapper || wrapper.__idnQrisObserved) return;
            wrapper.__idnQrisObserved = true;

            const obs = new MutationObserver(() => {
                if (document.getElementById('idn-qris-inject-wrap')) {
                    ensureInjectOnTop('hoki-prepend');
                }
            });
            obs.observe(wrapper, { childList: true });
            debugLog('watch wrapper childList');
        };

        observeWrapper();
        const bootObs = new MutationObserver(() => {
            if (getDepositWrapper()) {
                observeWrapper();
                bootObs.disconnect();
            }
        });
        bootObs.observe(document.body, { childList: true, subtree: true });

        let n = 0;
        const topPoll = setInterval(() => {
            n += 1;
            if (!isIdnQrisPage()) {
                teardownInject('path-lock');
                if (n >= 24) clearInterval(topPoll);
                return;
            }
            if (document.getElementById('idn-qris-inject-wrap')) {
                ensureInjectOnTop('poll');
            }
            if (n >= 24) clearInterval(topPoll);
        }, 500);
    }

    function startPathGuard() {
        if (window.__IDN_PATH_GUARD__) return;
        window.__IDN_PATH_GUARD__ = true;
        const check = () => {
            if (!isIdnQrisPage()) {
                teardownInject('path-lock');
                return;
            }
            syncInjectPanel('path').catch(() => {});
        };
        setInterval(check, 400);
        window.addEventListener('popstate', check);
        ['pushState', 'replaceState'].forEach((key) => {
            const orig = history[key];
            if (typeof orig !== 'function') return;
            history[key] = function () {
                const ret = orig.apply(this, arguments);
                setTimeout(check, 0);
                return ret;
            };
        });
        document.addEventListener('click', () => setTimeout(check, 80), true);
    }

    async function boot(opts) {
        const rehook = opts?.rehook === true;

        if (!isIdnQrisPage()) {
            teardownInject('bukan halaman deposit');
            return { ok: false, reason: 'not_idn_page' };
        }

        if (rehook) {
            injectHandlersAttached = false;
            const old = document.getElementById('idn-qris-inject-wrap');
            if (old) old.remove();
        }

        const injected = await injectQrisPanel(rehook);
        startHealthMonitor();
        return {
            ok: true,
            user: readUsernameFromDom(),
            amount: readInjectAmount(),
            injected: !!document.getElementById('idn-qris-inject-wrap'),
            min: CFG.MIN_DEPO,
            max: CFG.MAX_DEPO,
            rehook,
        };
    }

    window.__IDN_QRIS_BOOT__ = boot;
    window.IDN_QRIS_REBOOT = function () {
        formSubmitInProgress = false;
        injectHandlersAttached = false;
        const w = document.getElementById('idn-qris-inject-wrap');
        if (w) w.remove();
        return boot({ rehook: true });
    };
    window.IDN_QRIS_STATUS = function () {
        return {
            version: VERSION,
            user: readUsernameFromDom(),
            amount: readInjectAmount(),
            injected: !!document.getElementById('idn-qris-inject-wrap'),
            lastRef: window.__IDN_LAST_REFID__ || null,
        };
    };

    watchInjection();
    startPathGuard();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => boot());
    } else {
        boot();
    }
})();
