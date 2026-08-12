// ============================================================================
// PIALA11 / AFB-GG QRIS inject — /user/profile → Deposit
// Embed: /piala11_qris_inject.js?store_key=sk_xxx&min_depo=20000&max_depo=10000000
// SDK: https://unpkg.com/@poppackage/pg-ppy-sdk@1.0.0/dist/qris-sdk.umd.js
// Health: GET https://payment.pg-poppay.com/api/payment-health-v2 (+ X-Store-Key)
// ============================================================================

(function () {
    'use strict';

    const LOG = '[PIALA11-QRIS]';
    const VERSION = '0.3.0';
    const PANEL_TITLE = 'DEPOSIT QRIS (INSTANT AUTO)';
    const SDK_URL = 'https://unpkg.com/@poppackage/pg-ppy-sdk@1.0.0/dist/qris-sdk.umd.js';
    /** Nominal penuh IDR — bukan ribuan pendek (20 = salah, 20000 = 20.000) */
    const QUICK_AMOUNTS = [10000, 20000, 30000, 50000, 100000, 200000, 500000];

    if (window.__PIALA11_QRIS_BOOTED__) {
        if (typeof window.__PIALA11_QRIS_BOOT__ === 'function') {
            window.__PIALA11_QRIS_BOOT__({ rehook: true });
        }
        return;
    }
    window.__PIALA11_QRIS_BOOTED__ = true;

    window.PIALA11_PG_CONFIG = window.PIALA11_PG_CONFIG || {
        STORE_KEY: 'sk_4bb2smctkg1oplyvfnkn2svzv3sxzdqs',
        MIN_DEPO: 10000,
        MAX_DEPO: 100000000,
        INVOICE_PREFIX: 'PA11-',
        SKIP_STORE_KEY: false,
    };

    let formSubmitInProgress = false;
    let injectHandlersAttached = false;
    let paymentHealthCache = null;
    let paymentHealthCacheKey = '';
    let paymentHealthCacheAt = 0;
    let depositTabOpened = false;
    let syncInjectTimer = null;
    let syncInjectInFlight = false;
    const PAYMENT_HEALTH_TTL = 30000;

    function parseNum(raw, fallback) {
        if (raw == null || raw === '') return fallback;
        const n = parseInt(String(raw).replace(/[^\d]/g, ''), 10);
        return Number.isFinite(n) && n > 0 ? n : fallback;
    }

    function normalizeMinDepo(raw) {
        const n = parseNum(raw, 20000);
        if (n > 0 && n < 1000) return n * 1000;
        return n;
    }

    function getScriptSrc() {
        try {
            const current = document.currentScript;
            if (current?.src) return current.src;
            return Array.from(document.querySelectorAll('script[src]'))
                .map((s) => s.src)
                .reverse()
                .find((url) => /piala11[_-]?qris[_-]?inject\.js(\?|$)/i.test(url)) || '';
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

    const CFG = {
        STORE_KEY: (
            getParam('store_key') ||
            window.PIALA11_PGSCRIPT_STORE_KEY ||
            window.PIALA11_PG_CONFIG.STORE_KEY ||
            ''
        ).toString().trim(),
        MIN_DEPO: normalizeMinDepo(getParam('min_depo') || window.PIALA11_PG_CONFIG.MIN_DEPO || 20000),
        MAX_DEPO: parseNum(getParam('max_depo'), window.PIALA11_PG_CONFIG.MAX_DEPO || 100000000),
        INVOICE_PREFIX: getParam('invoice_prefix') || window.PIALA11_PG_CONFIG.INVOICE_PREFIX || 'PA11-',
        SKIP_STORE_KEY: window.PIALA11_PG_CONFIG.SKIP_STORE_KEY === true,
        HEALTH_BASE: (() => {
            let base = (
                getParam('health_base') ||
                getParam('api_base') ||
                window.PIALA11_PG_HEALTH_BASE ||
                window.PIALA11_PGSCRIPT_BASE ||
                window.PIALA11_PGSCRIPT_BASE_URL ||
                window.PGSCRIPT_BASE ||
                window.PGSCRIPT_BASE_URL ||
                'https://payment.pg-poppay.com'
            ).toString().trim().replace(/\/+$/, '');
            if (location.protocol === 'https:' && base.startsWith('http://')) {
                base = 'https://' + base.slice(7);
            }
            return base;
        })(),
        API_VERSION: (getParam('api_version') || window.PIALA11_PGSCRIPT_API_VERSION || 'api').toString().trim(),
    };

    console.log(`${LOG} v${VERSION} boot`);

    function isProfilePage() {
        const path = (location.pathname || '').toLowerCase();
        return path.includes('/user/profile') || path.includes('/user/');
    }

    function getDepositForm() {
        return document.getElementById('deposit-form');
    }

    /** Target: .section-content yang berisi tab deposit (#v-pills-tab / #member-deposit) */
    function getSectionContentHost() {
        const tab = document.getElementById('v-pills-tab');
        if (tab) {
            const sc = tab.closest('.section-content');
            if (sc) return sc;
        }
        const form = getDepositForm();
        if (form) {
            const sc = form.closest('.section-content');
            if (sc) return sc;
        }
        return document.querySelector('.section-content:has(#v-pills-tab), .section-content:has(#deposit-form)');
    }

    function isDepositVisible() {
        const pane = document.getElementById('member-deposit');
        if (pane && (pane.classList.contains('active') || pane.classList.contains('show'))) return true;
        const panel = document.getElementById('memberProfileDeposit');
        if (panel && (panel.classList.contains('show') || panel.offsetHeight > 0)) return true;
        return !!getDepositForm();
    }

    function openDepositTab(force) {
        if (depositTabOpened && !force) return false;
        if (isDepositVisible() && getDepositForm()) {
            depositTabOpened = true;
            return false;
        }

        const profileBtn = document.querySelector(
            'button.nav-item-deposit[data-target="#memberProfileDeposit"], button[data-target="#memberProfileDeposit"]'
        );
        if (profileBtn && !profileBtn.classList.contains('active')) {
            profileBtn.click();
        }

        const innerTab = document.querySelector('#v-pills-tab a[href="#member-deposit"]');
        if (innerTab && !innerTab.classList.contains('active')) {
            innerTab.click();
        }

        depositTabOpened = true;
        return true;
    }

    function readUsernameFromDom() {
        const fromWelcome = (document.querySelector('.welcome-username')?.textContent || '').trim();
        if (/^[a-zA-Z0-9_]{3,24}$/.test(fromWelcome)) return fromWelcome;
        const fromVip = (document.querySelector('.vip-user-name')?.textContent || '').trim();
        if (/^[a-zA-Z0-9_]{3,24}$/.test(fromVip)) return fromVip;
        return null;
    }

    function parseDigits(str) {
        return String(str || '').replace(/[^\d]/g, '');
    }

    function formatAmountDisplay(n) {
        const num = parseInt(n, 10) || 0;
        return num > 0 ? num.toLocaleString('id-ID') : '0';
    }

    function formatRpLabel(n) {
        return `Rp ${formatAmountDisplay(n)}`;
    }

    function renderQuickButtons() {
        return QUICK_AMOUNTS
            .filter((a) => a >= CFG.MIN_DEPO && a <= CFG.MAX_DEPO)
            .map((a) =>
                `<button type="button" class="p11-qris-amount-btn" data-amount="${a}">${formatAmountDisplay(a)}</button>`
            ).join('');
    }

    function paymentHealthUrl() {
        return `${CFG.HEALTH_BASE}/${CFG.API_VERSION}/payment-health-v2`;
    }

    async function checkPaymentHealth(forceRefresh) {
        if (CFG.SKIP_STORE_KEY || !CFG.STORE_KEY) return true;
        const now = Date.now();
        if (
            !forceRefresh &&
            paymentHealthCache !== null &&
            paymentHealthCacheKey === CFG.STORE_KEY &&
            (now - paymentHealthCacheAt) < PAYMENT_HEALTH_TTL
        ) {
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
            console.log(ok ? `${LOG} DEPOSIT HEALTH ON` : `${LOG} DEPOSIT HEALTH OFF`, body?.message || '');
            return ok;
        } catch (e) {
            paymentHealthCache = false;
            paymentHealthCacheKey = CFG.STORE_KEY;
            paymentHealthCacheAt = now;
            return false;
        }
    }

    function buildInjectHTML(username) {
        return `
            <style>
                #piala11-qris-inject-wrap { margin-bottom: 16px; }
                #piala11-qris-inject-wrap .p11-qris-card {
                    border: 1px solid rgba(46, 184, 92, 0.55);
                    border-radius: 8px;
                    padding: 16px;
                    background: rgba(0, 0, 0, 0.35);
                }
                #piala11-qris-inject-wrap .p11-qris-title {
                    font-size: 16px; font-weight: 700; margin: 0 0 4px; color: #2eb85c;
                }
                #piala11-qris-inject-wrap .p11-qris-sub { font-size: 12px; color: #aaa; margin: 0 0 14px; }
                #piala11-qris-inject-wrap .p11-qris-row { margin-bottom: 12px; }
                #piala11-qris-inject-wrap .p11-qris-amounts {
                    display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px;
                }
                #piala11-qris-inject-wrap .p11-qris-amount-btn {
                    min-width: 72px; padding: 8px 10px; border-radius: 6px;
                    border: 1px solid #444; background: #222; color: #fff; cursor: pointer;
                    font-size: 13px;
                }
                #piala11-qris-inject-wrap .p11-qris-amount-btn.active {
                    border-color: #2eb85c; background: rgba(46, 184, 92, 0.2);
                }
                #piala11-qris-inject-wrap .p11-qris-result { display: none; margin-top: 12px; }
                #piala11-qris-inject-wrap .p11-qris-result.active { display: block; }
                #piala11-qris-inject-wrap #piala11-qris-payment-frame { min-height: 320px; margin-top: 12px; }
                #piala11-qris-inject-wrap #piala11-qris-payment-result { margin-top: 12px; }
            </style>
            <div class="p11-qris-card" id="piala11-qris-inject-panel">
                <h4 class="p11-qris-title">${PANEL_TITLE}</h4>
                <p class="p11-qris-sub">Scan QRIS — deposit otomatis</p>
                <form id="piala11FormDepositQris" autocomplete="off">
                    <input type="hidden" id="piala11QrisUsername" value="${username}">
                    <div class="form-group p11-qris-row">
                        <label class="whitelabel">Username</label>
                        <input type="text" id="piala11QrisUsernameDisplay" class="form-control" value="${username}" readonly>
                    </div>
                    <div class="form-group p11-qris-row">
                        <label class="whitelabel">Jumlah Deposit (IDR)</label>
                        <div class="p11-qris-amounts" id="piala11QuickAmounts">${renderQuickButtons()}</div>
                        <div class="input-group">
                            <div class="input-group-prepend"><span class="input-group-text">IDR</span></div>
                            <input type="text" id="piala11DepositInput" class="form-control"
                                placeholder="Min ${formatAmountDisplay(CFG.MIN_DEPO)}" inputmode="numeric">
                        </div>
                        <small>Min: Rp ${formatAmountDisplay(CFG.MIN_DEPO)} | Max: Rp ${formatAmountDisplay(CFG.MAX_DEPO)}</small>
                    </div>
                    <input type="hidden" id="piala11DepositAmountHidden" value="0">
                    <button type="submit" class="btn btn-success btn-block afb01" id="piala11QrisSubmitBtn">
                        <span id="piala11QrisBtnText">TAMPILKAN QRIS</span>
                    </button>
                </form>
                <div class="p11-qris-result" id="piala11QrisResult">
                    <div id="piala11-qris-payment-frame"></div>
                    <div id="piala11-qris-payment-result"></div>
                </div>
            </div>`;
    }

    function syncAmountFromInput() {
        const input = document.getElementById('piala11DepositInput');
        const hidden = document.getElementById('piala11DepositAmountHidden');
        if (!input || !hidden) return 0;
        const raw = parseInt(parseDigits(input.value), 10) || 0;
        hidden.value = String(raw);
        return raw;
    }

    function teardownInject(reason) {
        const wrap = document.getElementById('piala11-qris-inject-wrap');
        if (wrap) wrap.remove();
        injectHandlersAttached = false;
        formSubmitInProgress = false;
        console.log(`${LOG} teardown`, reason || '');
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
        formSubmitInProgress = false;
        const form = document.getElementById('piala11FormDepositQris');
        const result = document.getElementById('piala11QrisResult');
        const payResult = document.getElementById('piala11-qris-payment-result');
        const btn = document.getElementById('piala11QrisSubmitBtn');
        const btnText = document.getElementById('piala11QrisBtnText');
        if (form) form.style.display = '';
        if (result) result.classList.remove('active');
        if (payResult) payResult.innerHTML = '';
        if (btn) btn.disabled = false;
        if (btnText) btnText.textContent = 'TAMPILKAN QRIS';
    }

    async function startQrisPayment(username, amount) {
        await loadQrisSDK();

        const form = document.getElementById('piala11FormDepositQris');
        const resultBox = document.getElementById('piala11QrisResult');
        const btn = document.getElementById('piala11QrisSubmitBtn');
        const btnText = document.getElementById('piala11QrisBtnText');
        const payResult = document.getElementById('piala11-qris-payment-result');

        if (form) form.style.display = 'none';
        if (resultBox) resultBox.classList.add('active');
        if (payResult) payResult.innerHTML = '';
        if (btn) btn.disabled = true;
        if (btnText) btnText.textContent = 'Memuat...';

        const invoice = CFG.INVOICE_PREFIX + Date.now();
        const payment = new window.QrisSDK({
            healthCheckEnabled: false,
            storeKey: CFG.STORE_KEY,
            store_key: CFG.STORE_KEY,
            amount,
            invoice,
            username,
            notes: `QRIS ${invoice}`,
            payor_name: username,
            payor_email: '',
            displayMode: 'inline',
            containerId: 'piala11-qris-payment-frame',
            resultContainerId: 'piala11-qris-payment-result',
            onSuccess: (data) => {
                window.__PIALA11_LAST_REFID__ = invoice;
                window.__PIALA11_LAST_PAYMENT__ = data;
                console.log(`${LOG} payment success`, invoice);
                if (btnText) btnText.textContent = 'Selesai';
                setTimeout(resetInjectForm, 8000);
            },
            onFailed: (status) => {
                console.warn(`${LOG} payment failed`, status);
                alert('Gagal buat QR. Coba lagi.');
                resetInjectForm();
            },
        });
        payment.openPayment();
    }

    function attachInjectHandlers() {
        if (injectHandlersAttached) return;
        const form = document.getElementById('piala11FormDepositQris');
        if (!form) return;
        injectHandlersAttached = true;

        const amountInput = document.getElementById('piala11DepositInput');
        if (amountInput) {
            amountInput.addEventListener('input', () => {
                syncAmountFromInput();
                document.querySelectorAll('.p11-qris-amount-btn').forEach((b) => b.classList.remove('active'));
            });
        }

        document.getElementById('piala11QuickAmounts')?.addEventListener('click', (e) => {
            const btn = e.target.closest('.p11-qris-amount-btn');
            if (!btn) return;
            const amt = parseInt(btn.getAttribute('data-amount'), 10);
            if (!amt) return;
            document.querySelectorAll('.p11-qris-amount-btn').forEach((b) => b.classList.remove('active'));
            btn.classList.add('active');
            if (amountInput) {
                amountInput.value = formatAmountDisplay(amt);
                syncAmountFromInput();
            }
        });

        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (formSubmitInProgress) return false;

            const healthOk = await checkPaymentHealth(true);
            if (!healthOk) {
                alert('Layanan QRIS sedang OFF. Cek store_key / whitelist domain.');
                return false;
            }

            const username = (document.getElementById('piala11QrisUsername')?.value || readUsernameFromDom() || '').trim();
            if (!username) {
                alert('Username tidak ditemukan.');
                return false;
            }

            const amount = syncAmountFromInput();
            if (!amount || amount < CFG.MIN_DEPO) {
                alert(`Minimal deposit Rp ${formatAmountDisplay(CFG.MIN_DEPO)}`);
                return false;
            }
            if (amount > CFG.MAX_DEPO) {
                alert(`Maksimal deposit Rp ${formatAmountDisplay(CFG.MAX_DEPO)}`);
                return false;
            }

            formSubmitInProgress = true;
            try {
                await startQrisPayment(username, amount);
            } catch (err) {
                alert(err?.message || 'Error');
                resetInjectForm();
            } finally {
                setTimeout(() => { formSubmitInProgress = false; }, 2000);
            }
            return false;
        });
    }

    function ensureInjectPosition(wrap) {
        const host = getSectionContentHost();
        if (!host || !wrap) return false;
        const tabList = host.querySelector('#v-pills-tab');
        if (wrap.parentElement !== host) {
            if (tabList) host.insertBefore(wrap, tabList);
            else host.prepend(wrap);
        } else if (tabList && wrap.nextElementSibling !== tabList) {
            host.insertBefore(wrap, tabList);
        }
        return true;
    }

    async function injectQrisPanel(force) {
        if (!isProfilePage()) return false;

        const host = getSectionContentHost();
        if (!host || !getDepositForm()) {
            return false;
        }

        let wrap = document.getElementById('piala11-qris-inject-wrap');
        if (wrap && !force) {
            ensureInjectPosition(wrap);
            attachInjectHandlers();
            return true;
        }

        const healthOk = await checkPaymentHealth(false);
        if (!healthOk) {
            if (wrap) teardownInject('payment-health OFF');
            return false;
        }

        const username = readUsernameFromDom();
        if (!username) {
            return false;
        }

        if (wrap) wrap.remove();
        injectHandlersAttached = false;

        wrap = document.createElement('div');
        wrap.id = 'piala11-qris-inject-wrap';
        wrap.innerHTML = buildInjectHTML(username);

        const tabList = host.querySelector('#v-pills-tab');
        if (tabList) host.insertBefore(wrap, tabList);
        else host.prepend(wrap);

        attachInjectHandlers();
        console.log(`${LOG} inject OK username=${username} (above #v-pills-tab)`);
        return true;
    }

    function scheduleSyncInject(delayMs) {
        if (syncInjectTimer) clearTimeout(syncInjectTimer);
        syncInjectTimer = setTimeout(() => {
            syncInjectTimer = null;
            syncInject().catch(() => {});
        }, delayMs == null ? 400 : delayMs);
    }

    async function syncInject() {
        if (!isProfilePage() || !isDepositVisible()) return;
        if (syncInjectInFlight) return;
        if (document.getElementById('piala11-qris-inject-wrap')) {
            ensureInjectPosition(document.getElementById('piala11-qris-inject-wrap'));
            return;
        }
        syncInjectInFlight = true;
        try {
            await injectQrisPanel(false);
        } finally {
            syncInjectInFlight = false;
        }
    }

    function isOurInjectNode(node) {
        if (!node || node.nodeType !== 1) return false;
        return node.id === 'piala11-qris-inject-wrap' || !!node.closest?.('#piala11-qris-inject-wrap');
    }

    function startObservers() {
        const obs = new MutationObserver((mutations) => {
            for (const m of mutations) {
                if (isOurInjectNode(m.target)) return;
                if (m.addedNodes) {
                    for (const n of m.addedNodes) {
                        if (isOurInjectNode(n)) return;
                    }
                }
            }
            if (document.getElementById('piala11-qris-inject-wrap')) return;
            scheduleSyncInject(500);
        });
        obs.observe(document.body, { childList: true, subtree: true });

        document.addEventListener('click', (e) => {
            const t = e.target;
            if (t?.closest?.('.nav-item-deposit, [data-target="#memberProfileDeposit"], a[href="#member-deposit"]')) {
                depositTabOpened = false;
                scheduleSyncInject(600);
            }
        }, true);
    }

    window.__PIALA11_QRIS_BOOT__ = async function (opts) {
        opts = opts || {};
        if (opts.rehook) injectHandlersAttached = false;
        const ok = await injectQrisPanel(!!opts.rehook);
        return {
            ok,
            username: readUsernameFromDom(),
            depositVisible: isDepositVisible(),
            injected: !!document.getElementById('piala11-qris-inject-wrap'),
            aboveTabs: (() => {
                const w = document.getElementById('piala11-qris-inject-wrap');
                const t = document.getElementById('v-pills-tab');
                return !!(w && t && w.nextElementSibling === t);
            })(),
        };
    };

    window.PIALA11_QRIS_DEBUG = function () {
        return {
            version: VERSION,
            profile: isProfilePage(),
            depositVisible: isDepositVisible(),
            username: readUsernameFromDom(),
            injected: !!document.getElementById('piala11-qris-inject-wrap'),
            host: !!getSectionContentHost(),
            aboveTabs: (() => {
                const w = document.getElementById('piala11-qris-inject-wrap');
                const t = document.getElementById('v-pills-tab');
                return !!(w && t && w.nextElementSibling === t);
            })(),
        };
    };

    (async function boot() {
        await new Promise((r) => setTimeout(r, 800));
        openDepositTab(false);
        await new Promise((r) => setTimeout(r, 600));
        await injectQrisPanel(false);
        startObservers();
    })();
})();
