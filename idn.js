// ============================================================================
// IDN QRIS inject — sibling pertama di .content-page__wrapper (HOKI prepend _hoki-app ~1–3s)
// Embed: /idn_qris_inject.js?store_key=sk_xxx&min_depo=20000&max_depo=10000000
// Health: GET https://script.pg-poppay.com/api/payment-health (+ X-Store-Key)
// ============================================================================

(function () {
    'use strict';

    const LOG = '[IDN-QRIS]';
    const VERSION = '0.5.0';

    if (window.__IDN_QRIS_INJECT_BOOTED__) {
        if (typeof window.__IDN_QRIS_BOOT__ === 'function') {
            window.__IDN_QRIS_BOOT__({ rehook: true });
        }
        return;
    }
    window.__IDN_QRIS_INJECT_BOOTED__ = true;

    window.IDN_PG_CONFIG = window.IDN_PG_CONFIG || {
        STORE_KEY: '',
        MIN_DEPO: 10000,
        MAX_DEPO: 10000000,
        INVOICE_PREFIX: 'IDN-',
        SKIP_STORE_KEY: false,
        CONVERSION_RATIO: 1,
    };

    let formSubmitInProgress = false;
    let injectHandlersAttached = false;
    let reinjectionInProgress = false;
    let paymentHealthCache = null;
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
            return Array.from(document.querySelectorAll('script[src]'))
                .map((s) => s.src)
                .reverse()
                .find((url) => /idn[_-]?qris[_-]?inject\.js(\?|$)/i.test(url)) || '';
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
        MIN_DEPO: parseNum(getParam('min_depo'), window.IDN_PG_CONFIG.MIN_DEPO || 20000),
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
                'https://script.pg-poppay.com'
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

    function isIdnQrisPage() {
        if (document.getElementById('_hoki-app')) return true;
        const title = document.querySelector('.pages-box__title');
        if (title && /deposit qris/i.test(title.textContent || '')) return true;
        return (location.pathname || '').toLowerCase().includes('/deposit');
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
        return document.querySelector('.content-page__wrapper');
    }

    function depositShellReady(wrapper) {
        if (!wrapper) return false;
        return !!(wrapper.querySelector('#formDeposit') || getHokiRoot());
    }

    function waitForDepositShell(maxMs) {
        const limit = maxMs || 8000;
        return new Promise((resolve) => {
            const start = Date.now();
            const tick = () => {
                const w = getDepositWrapper();
                if (w && depositShellReady(w)) {
                    resolve(w);
                    return;
                }
                if (Date.now() - start >= limit) {
                    resolve(getDepositWrapper());
                    return;
                }
                setTimeout(tick, 150);
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
            debugLog('panel prepend wrapper', reason || '');
            return true;
        }
        return false;
    }

    function readUsernameFromDom() {
        const scopes = [getHokiRoot(), document.querySelector('.content-page__container'), document];
        for (const scope of scopes) {
            if (!scope) continue;
            const inputs = scope.querySelectorAll('form.form-deposit-withdraw input[disabled], input[disabled]');
            for (const inp of inputs) {
                const v = (inp.value || '').trim();
                if (/^[a-zA-Z0-9_]{3,24}$/.test(v)) return v;
            }
        }
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
        return `Min: ${min} | Max: ${max}`;
    }

    function buildInjectHTML(username) {
        return `
            <style>
                #idn-qris-inject-wrap { margin-bottom: 12px; }
                #idn-qris-inject-wrap .idn-qris-result { display: none; }
                #idn-qris-inject-wrap .idn-qris-result.active { display: block; margin-top: 12px; }
                #idn-qris-payment-frame { min-height: 320px; text-align: center; }
                #idn-qris-payment-result { margin-top: 12px; }
                #idn-qris-inject-wrap .idn-qris-success-box {
                    padding: 16px;
                    border-radius: 0.25rem;
                    background: rgba(40, 167, 69, 0.1);
                    border: 1px solid rgba(40, 167, 69, 0.35);
                }
                #idn-qris-inject-wrap .idn-qris-success-box h4 { margin: 0 0 8px; font-size: 16px; }
                #idn-qris-inject-wrap .idn-qris-success-box p { margin: 0; font-size: 14px; }
            </style>
            <div class="content-page__container content-page__container--bg" id="idn-qris-inject-panel">
                <div class="pages-box__title pages-box__title--no-pad">Instant Auto</div>
                <div class="pages-misc">
                    <form class="form-deposit-withdraw" id="idnFormDepositQris">
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
                                <button type="submit" data-action="submit"
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
            return 0;
        }

        const raw = parseInt(digits, 10);
        if (!Number.isFinite(raw) || raw <= 0) {
            amountInput.value = '';
            amountHidden.value = '0';
            amountInput.classList.add('currencyInput__formatted--zero');
            return 0;
        }

        const rupiah = raw * CFG.CONVERSION_RATIO;
        amountHidden.value = String(rupiah);
        amountInput.value = formatRpLabel(CFG.CONVERSION_RATIO === 1 ? raw : rupiah);
        amountInput.classList.remove('currencyInput__formatted--zero');
        return rupiah;
    }

    function teardownInject(reason) {
        const wrap = document.getElementById('idn-qris-inject-wrap');
        if (!wrap) return false;
        wrap.remove();
        injectHandlersAttached = false;
        formSubmitInProgress = false;
        debugLog('panel hidden', reason || '');
        return true;
    }

    function paymentHealthUrl() {
        if (CFG.HEALTH_URL) return CFG.HEALTH_URL;
        const path = CFG.HEALTH_PATH || `${CFG.API_VERSION}/payment-health`;
        return `${CFG.HEALTH_BASE}/${path}`;
    }

    async function checkPaymentHealth(forceRefresh) {
        if (CFG.SKIP_STORE_KEY || !CFG.STORE_KEY) {
            logHealthState(true);
            return true;
        }
        const now = Date.now();
        if (
            !forceRefresh &&
            paymentHealthCache !== null &&
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
            paymentHealthCacheAt = now;
            logHealthState(ok);
            debugLog('payment-health', ok ? 'OK' : 'OFF', url, body?.message || '');
            return ok;
        } catch (e) {
            paymentHealthCache = false;
            paymentHealthCacheAt = now;
            logHealthState(false);
            debugLog('payment-health error', e);
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
            script.src = 'https://unpkg.com/@poppackage/qris-payment-sdk/dist/qris-sdk.umd.js';
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

        const username = readUsernameFromDom();
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
        panelWrap.innerHTML = buildInjectHTML(username);

        wrapper.prepend(panelWrap);

        if (!document.getElementById('idn-qris-inject-panel')) {
            debugLog('Inject gagal verify');
            panelWrap.remove();
            return false;
        }

        attachInjectHandlers();
        ensureInjectOnTop('inject');
        debugLog('Panel inject → wrapper.prepend (hoki=', !!getHokiRoot(), ')');
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
            if (document.getElementById('idn-qris-inject-wrap')) {
                ensureInjectOnTop('poll');
            }
            if (n >= 24) clearInterval(topPoll);
        }, 500);
    }

    async function boot(opts) {
        const rehook = opts?.rehook === true;

        if (!isIdnQrisPage()) {
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

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => boot());
    } else {
        boot();
    }
})();
