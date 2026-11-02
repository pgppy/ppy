// ============================================================================
// Kingkongtoto — tab "QRIS Auto" di halaman deposit (lobby?page=cashier).
// Tab pertama di #bankCategory, di atas Bank Transfer.
// Klik tab tidak pindah halaman. Form tampil di kolom kanan kasir.
// Embed: <script src="...kingkongtoto.js?store_key=sk_xxx"></script>
// ============================================================================

(function () {
    'use strict';

    if (window.top !== window) return;
    if (window.__KKT_QRIS_BOOTED__) return;
    window.__KKT_QRIS_BOOTED__ = true;

    const LOG = '[KKT-QRIS]';
    const VERSION = '1.0.9';
    const TAB_ID = 'kkt-qris-tab';
    const PANEL_ID = 'kkt-qris-panel';

    const params = new URLSearchParams(
        (document.currentScript && document.currentScript.src || '').split('?')[1] || ''
    );
    const PREVIEW = window.__KKT_PREVIEW__ === true || params.get('preview') === '1';
    const CFG = {
        STORE_KEY: (params.get('store_key') || window.__KKT_STORE_KEY__ || '').trim(),
        HEALTH_BASE: 'https://payment.pg-poppay.com',
        MIN_AMOUNT: parseInt(params.get('min_depo') || '10000', 10),
        MAX_AMOUNT: parseInt(params.get('max_depo') || '10000000', 10),
        AMOUNTS: [10000, 50000, 100000, 200000, 500000, 1000000],
    };
    const PAYMENT_HEALTH_TTL = 30000;

    let paymentHealthCache = null;
    let paymentHealthCacheKey = '';
    let paymentHealthCacheAt = 0;
    let holdOurs = true;
    let opening = false;

    console.log(LOG, 'v' + VERSION, 'boot', location.pathname);

    function onShell() {
        const path = location.pathname;
        return path === '/lobby' || path === '/lobby/' || path === '/cashier';
    }

    function readUsername() {
        const mob = document.querySelector('.mb-lobby-username');
        const fromMob = mob && (mob.textContent || '').trim();
        if (fromMob) return fromMob;
        const right = document.querySelector('ul.nav.navbar-nav.quick-actions.rightz');
        const raw = (right && right.innerText) || '';
        const m = raw.replace(/\s+/g, ' ').match(/\b([A-Za-z0-9._-]{3,32})\s+IDR\b/);
        if (m) return m[1];
        const labeled = (document.body.innerText || '').match(/Username\s*:\s*([A-Za-z0-9._-]{3,32})/i);
        return labeled ? labeled[1] : '';
    }

    function rememberHealth(ok) {
        paymentHealthCache = ok;
        paymentHealthCacheKey = CFG.STORE_KEY;
        paymentHealthCacheAt = Date.now();
        return ok;
    }

    async function checkPaymentHealth() {
        if (PREVIEW) return rememberHealth(true);
        if (!CFG.STORE_KEY) return rememberHealth(false);
        const now = Date.now();
        if (
            paymentHealthCache !== null &&
            paymentHealthCacheKey === CFG.STORE_KEY &&
            (now - paymentHealthCacheAt) < PAYMENT_HEALTH_TTL
        ) {
            return paymentHealthCache;
        }
        if (healthFlight) return healthFlight;
        healthFlight = (async () => {
            try {
                const res = await fetch(CFG.HEALTH_BASE + '/api/payment-health-v2', {
                    method: 'GET',
                    cache: 'no-store',
                    headers: { 'X-Store-Key': CFG.STORE_KEY, 'Accept': 'application/json' },
                });
                const body = await res.json().catch(() => null);
                return rememberHealth(!!(res.ok && body && body.success === true));
            } catch (err) {
                console.warn(LOG, 'health failed', err && err.message);
                return rememberHealth(false);
            } finally {
                healthFlight = null;
            }
        })();
        return healthFlight;
    }

    function ensureStyle() {
        if (document.getElementById('kkt-qris-style')) return;
        const style = document.createElement('style');
        style.id = 'kkt-qris-style';
        style.textContent = [
            'html.kkt-scroll,html.kkt-scroll body{overflow-y:auto!important;height:auto!important;position:static!important;touch-action:pan-y!important}',
            '@media (max-width:800px){html,body,#wrap,#content,.overflow-visible,.pg-container{overflow:visible!important;overflow-y:visible!important;height:auto!important;max-height:none!important;position:static!important}}',
            '#bankTabs > button#' + TAB_ID + '::before{content:""!important;display:block!important;width:34px!important;height:34px!important;background:url("https://kingkongtoto-21.info/assets/menu-icon/qr-payment.png") center/contain no-repeat!important}',
            '#' + TAB_ID + '.kkt-on{background:#f6d365!important;color:#1a1a1a!important;box-shadow:none!important}',
            '#' + TAB_ID + '.kkt-on .category-title,#' + TAB_ID + '.kkt-on h4{color:#1a1a1a!important}',
            '#' + PANEL_ID + '{box-sizing:border-box;padding:16px 14px 28px;font-family:inherit}',
            '#' + PANEL_ID + ' h3{margin:0 0 4px;font-size:18px;font-weight:700}',
            '#' + PANEL_ID + ' .kkt-note{margin:0 0 14px;font-size:12px;opacity:.75}',
            '#' + PANEL_ID + ' label{display:block;font-size:13px;margin:12px 0 6px;font-weight:600}',
            '#' + PANEL_ID + ' input{display:block;width:100%;max-width:none;box-sizing:border-box;margin:0;padding:12px 14px;border-radius:10px;font-size:16px}',
            '#' + PANEL_ID + ' .kkt-row{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin:12px 0 4px}',
            '#' + PANEL_ID + ' button{font-family:inherit;cursor:pointer}',
            '#' + PANEL_ID + ' button.kkt-amt{width:100%;padding:11px 4px;border-radius:10px;font-size:13px;font-weight:600}',
            '#' + PANEL_ID + ' button.kkt-pay{display:block;width:100%;margin-top:16px;padding:14px;border:none;border-radius:12px;font-size:16px;font-weight:800}',
            '#' + PANEL_ID + '.kkt-mobile{background:#161616;color:#f3f3f3;border-radius:14px;margin:10px 10px 28px}',
            '#' + PANEL_ID + '.kkt-mobile input{background:#141414;color:#fff;border:1px solid #3a3a3a}',
            '#' + PANEL_ID + '.kkt-mobile button.kkt-amt{background:#1b1b1b;color:#fff;border:1px solid #4a4a4a}',
            '#' + PANEL_ID + '.kkt-mobile button.kkt-amt.active{border-color:#f6d365;color:#f6d365;background:#242014}',
            '#' + PANEL_ID + '.kkt-mobile button.kkt-pay{background:linear-gradient(#ffe27a,#e0b32a);color:#1a1a1a}',
            '#' + PANEL_ID + '.kkt-desk{background:#fff;color:#1a1a1a;border-radius:12px}',
            '#' + PANEL_ID + '.kkt-desk input{background:#fff;color:#111;border:1px solid #ddd}',
            '#' + PANEL_ID + '.kkt-desk button.kkt-amt{background:#fff;color:#222;border:1px solid #ddd}',
            '#' + PANEL_ID + '.kkt-desk button.kkt-amt.active{border-color:#c9a227;color:#8a6a10;background:#fffaf0}',
            '#' + PANEL_ID + '.kkt-desk button.kkt-pay{background:#111;color:#f6d365}',
            '#' + PANEL_ID + ' .kkt-off{color:#e11d48;font-weight:600}',
        ].join('');
        (document.head || document.documentElement).appendChild(style);
    }

    const QR_LOGO = 'https://kingkongtoto-21.info/assets/menu-icon/qr-payment.png';

    function methodTab(bar) {
        if (bar && bar.id === 'bankTabs') {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.id = TAB_ID;
            btn.className = 'tablinks tab-pcjaa';
            btn.innerHTML =
                '<img class="menu-icon" src="' + QR_LOGO + '">' +
                '<span class="category-title">QRIS Auto</span>';
            btn.addEventListener('click', onTabClick);
            return btn;
        }
        const li = document.createElement('li');
        li.id = TAB_ID;
        li.className = 'p-4 py-6 cursor-pointer transition duration-150 ease-in-out mop-menu hover:bg-white';
        li.innerHTML =
            '<div class="text-left leading-none">' +
            '<h4 class="text-md font-bold text-menu-pcjaa">QRIS Auto</h4>' +
            '</div>';
        li.addEventListener('click', onTabClick);
        return li;
    }

    function pinFirst(parent, node) {
        if (!parent || !node) return;
        if (parent.firstElementChild !== node) parent.insertBefore(node, parent.firstElementChild);
    }

    function depositBar() {
        return document.getElementById('bankCategory') || document.getElementById('bankTabs');
    }

    function placeTabs() {
        if (!onShell()) {
            teardown();
            return;
        }
        const bar = depositBar();
        if (!bar) {
            teardown();
            return;
        }
        ensureStyle();
        let tab = document.getElementById(TAB_ID);
        if (!tab || tab.parentElement !== bar) {
            if (tab) tab.remove();
            tab = methodTab(bar);
        }
        pinFirst(bar, tab);
        if (!bar.dataset.kktBound) {
            bar.dataset.kktBound = '1';
            bar.addEventListener('click', (ev) => {
                const item = ev.target.closest('li, button');
                if (!item || item.id === TAB_ID) return;
                if (!ev.isTrusted) {
                    ev.preventDefault();
                    ev.stopPropagation();
                    if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
                    return;
                }
                holdOurs = false;
                document.documentElement.classList.remove('kkt-scroll');
                releasePanes();
            }, true);
        }
    }

    function teardown() {
        releasePanes();
        const panel = document.getElementById(PANEL_ID);
        if (panel) panel.remove();
        const tab = document.getElementById(TAB_ID);
        if (tab) tab.remove();
    }

    function depositWrap() {
        const bar = depositBar();
        if (!bar) return null;
        if (bar.id === 'bankTabs') return bar.parentElement;
        return bar.closest('.pg-wrapper');
    }

    function contentPanes() {
        const bar = depositBar();
        const wrap = depositWrap();
        if (!wrap) return [];
        return Array.from(wrap.children).filter((el) => el.id !== PANEL_ID && el !== bar && !el.contains(bar));
    }

    function hideOtherPanes() {
        contentPanes().forEach((el) => {
            if (el.dataset.kktHide == null) el.dataset.kktHide = el.style.display || '';
            el.style.display = 'none';
        });
    }

    function releasePanes() {
        contentPanes().forEach((el) => {
            if (el.dataset.kktHide == null) return;
            el.style.display = el.dataset.kktHide;
            delete el.dataset.kktHide;
        });
        const tab = document.getElementById(TAB_ID);
        if (tab) tab.classList.remove('kkt-on');
        const panel = document.getElementById(PANEL_ID);
        if (panel) panel.style.display = 'none';
    }

    function unlockScroll() {
        document.documentElement.classList.add('kkt-scroll');
        let n = document.getElementById(PANEL_ID);
        for (let i = 0; i < 8 && n; i++) {
            const cs = getComputedStyle(n);
            if (/(hidden|clip)/.test(cs.overflowY) || /(hidden|clip)/.test(cs.overflow)) {
                n.style.setProperty('overflow-y', 'auto', 'important');
                n.style.setProperty('max-height', 'none', 'important');
            }
            n = n.parentElement;
        }
    }

    function markActive() {
        const bar = depositBar();
        const tab = document.getElementById(TAB_ID);
        if (!bar || !tab) return;
        bar.querySelectorAll('li, button').forEach((el) => {
            if (el === tab) return;
            el.classList.remove('active', 'bg-white', 'kkt-on');
        });
        tab.classList.add('kkt-on');
        if (bar.id === 'bankTabs') tab.classList.add('active');
        else tab.classList.add('bg-white');
    }

    async function ensureOurs() {
        if (!holdOurs || !depositBar()) return;
        const panel = document.getElementById(PANEL_ID);
        if (panel && panel.isConnected && panel.style.display !== 'none') {
            hideOtherPanes();
            markActive();
            unlockScroll();
            return;
        }
        if (opening) return;
        opening = true;
        try {
            await renderPanel();
        } finally {
            opening = false;
        }
    }

    function selectedAmount() {
        const el = document.getElementById('kkt-amount');
        return parseInt(String(el && el.value || '').replace(/\D/g, ''), 10) || 0;
    }

    function setAmount(n, btn) {
        const el = document.getElementById('kkt-amount');
        if (el) el.value = Number(n).toLocaleString('id-ID');
        document.querySelectorAll('#' + PANEL_ID + ' .kkt-amt').forEach((b) => b.classList.remove('active'));
        if (btn) btn.classList.add('active');
    }

    async function renderPanel() {
        ensureStyle();
        let panel = document.getElementById(PANEL_ID);
        if (!panel) {
            panel = document.createElement('div');
            panel.id = PANEL_ID;
        }
        const user = readUsername();
        const ok = await checkPaymentHealth();
        const chips = CFG.AMOUNTS.map((n) =>
            '<button type="button" class="kkt-amt" data-amt="' + n + '">' + n.toLocaleString('id-ID') + '</button>'
        ).join('');
        const wrap = depositWrap();
        panel.innerHTML =
            '<h3>QRIS Auto</h3>' +
            '<p class="kkt-note">Minimal ' + CFG.MIN_AMOUNT.toLocaleString('id-ID') + '</p>' +
            '<label>Username</label>' +
            '<input id="kkt-user" readonly value="' + user.replace(/"/g, '') + '">' +
            '<label>Nominal</label>' +
            '<input id="kkt-amount" inputmode="numeric" placeholder="Masukkan nominal" value="">' +
            '<div class="kkt-row">' + chips + '</div>' +
            (ok
                ? '<button type="button" class="kkt-pay" id="kkt-pay">Buat QR</button>'
                : '<p class="kkt-off">Auto deposit sedang OFF.</p>');
        const bar = depositBar();
        const mobile = bar && bar.id === 'bankTabs';
        panel.className = mobile ? 'kkt-mobile' : 'kkt-desk w-9/12';
        panel.style.display = 'block';
        document.documentElement.style.overflowY = 'auto';
        document.body.style.overflowY = 'auto';
        panel.querySelectorAll('.kkt-amt').forEach((btn) => {
            btn.addEventListener('click', () => setAmount(parseInt(btn.getAttribute('data-amt'), 10), btn));
        });
        const pay = document.getElementById('kkt-pay');
        if (pay) pay.addEventListener('click', onPay);
        if (wrap && panel.parentElement !== wrap) {
            if (mobile && bar) bar.insertAdjacentElement('afterend', panel);
            else wrap.appendChild(panel);
        }
        hideOtherPanes();
        markActive();
        unlockScroll();
    }

    function onTabClick(ev) {
        if (ev) {
            ev.preventDefault();
            ev.stopPropagation();
            if (ev.stopImmediatePropagation) ev.stopImmediatePropagation();
        }
        if (!depositBar()) return false;
        renderPanel();
        return false;
    }

    async function onPay(ev) {
        if (ev) ev.preventDefault();
        const amount = selectedAmount();
        const user = (document.getElementById('kkt-user') || {}).value || readUsername();
        if (!user) return;
        if (amount < CFG.MIN_AMOUNT || amount > CFG.MAX_AMOUNT) return;
        const ok = await checkPaymentHealth();
        if (!ok) return;
        if (PREVIEW) {
            console.log(LOG, 'preview, tidak membuat transaksi', user, amount);
            return;
        }
        console.log(LOG, 'siap bayar', user, amount);
    }

    function boot() {
        if (!onShell()) return;
        placeTabs();
        ensureOurs();
    }

    function start() {
        if (!document.documentElement) return;
        boot();
        if (window.__KKT_QRIS_WATCH__) return;
        window.__KKT_QRIS_WATCH__ = true;
    const obs = new MutationObserver(() => {
        if (!onShell()) return;
        const bar = depositBar();
        const ok = bar && bar.firstElementChild && bar.firstElementChild.id === TAB_ID;
        if (!ok) placeTabs();
    });
    if (document.documentElement) {
        obs.observe(document.documentElement, { childList: true, subtree: true });
    }
    setInterval(() => {
        if (!onShell()) return;
        placeTabs();
        ensureOurs();
    }, 300);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    }
    start();
    setInterval(start, 500);
})();
