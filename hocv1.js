// ============================================================================
// HOC / HOTELBET QRIS INSTANT — hoc.js
// Inject di: https://cek.selasahotelbet.online/desktop/deposit/BANK
// Pola sama ugv6.js (Poppay SDK) + tab native Nexus.
// Tab "QRIS INSTANT" selalu ada, selalu paling kiri.
// Kalau ada QRISAUTO, QRIS INSTANT disisip di kirinya (tetap pertama).
// Embed: <script src="...hoc.js?store_key=sk_xxx&min_depo=10000&max_depo=10000000"></script>
// SDK: https://unpkg.com/@poppackage/pg-ppy-sdk@1.0.0/dist/qris-sdk.umd.js
// ============================================================================

(function () {
    'use strict';

    if (window.__HOC_QRIS_BOOTED__) return;
    window.__HOC_QRIS_BOOTED__ = true;

    const LOG = '[HOC-QRIS]';
    const VERSION = '1.0.9';
    const TAB_ID = 'hoc-qris-instant-tab';
    const WRAPPER_ID = 'hoc-poppay-wrapper';
    const PANEL_ID = 'hoc-poppay-qris-full';
    console.log(LOG, 'v' + VERSION, 'boot');

    window.hocSetAmount = function (amount, button) {
        const amountShow = document.getElementById('depositShowAmountAutoQris');
        const amountHidden = document.getElementById('depositAmountAutoQris');
        if (!amountShow || !amountHidden) return false;
        document.querySelectorAll('#' + PANEL_ID + ' .qris-amount-btn').forEach((b) => b.classList.remove('active'));
        if (button) button.classList.add('active');
        amountShow.value = parseInt(amount, 10).toLocaleString('id-ID');
        amountHidden.value = amount;
        return false;
    };

    const CONFIG = {
        MIN_AMOUNT: 10000,
        MAX_AMOUNT: 10000000,
        AMOUNT_BUTTONS: [10000, 50000, 100000, 200000, 500000],
        MAX_RETRIES: 24,
        RETRY_DELAY: 400,
        IS_MOBILE: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent),
    };

    let _lockedUsername = (window.__HOC_LOCKED_USERNAME__ || '').toString().trim() || null;
    let _userPickedNative = false;
    let injectHandlersAttached = false;
    let paymentHealthCache = null;
    let paymentHealthCacheKey = '';
    let paymentHealthCacheAt = 0;
    const PAYMENT_HEALTH_TTL = 30000;

    function getParamFromCurrentScript(name) {
        try {
            const current = document.currentScript;
            const scripts = Array.from(document.querySelectorAll('script[src]')).map((s) => s.src).reverse();
            const named = current && current.src || scripts.find((url) => /hoc\.js(\?|$)/i.test(url));
            const src = named || scripts.find((url) => {
                try { return !!new URL(url, location.href).searchParams.get('store_key'); } catch (e) { return false; }
            });
            if (!src) return null;
            return new URL(src, location.href).searchParams.get(name);
        } catch (e) {
            return null;
        }
    }

    function parseAmountParam(v, fallback) {
        const n = parseInt(String(v == null ? '' : v).replace(/\D/g, ''), 10);
        return Number.isFinite(n) && n > 0 ? n : fallback;
    }

    function parseButtonList(raw) {
        const src = raw || window.HOC_AMOUNT_BUTTONS || '';
        let nums = [];
        if (Array.isArray(src)) nums = src.map((x) => parseInt(x, 10));
        else if (typeof src === 'string' && src.trim()) {
            nums = src.split(/[,|;\s]+/).map((x) => parseInt(String(x).replace(/\D/g, ''), 10));
        }
        nums = nums.filter((n) => Number.isFinite(n) && n > 0);
        if (!nums.length) nums = CONFIG.AMOUNT_BUTTONS.slice();
        return nums;
    }

    CONFIG.MIN_AMOUNT = parseAmountParam(getParamFromCurrentScript('min_depo') || window.HOC_MIN_DEPO, CONFIG.MIN_AMOUNT);
    CONFIG.MAX_AMOUNT = parseAmountParam(getParamFromCurrentScript('max_depo') || window.HOC_MAX_DEPO, 10000000);
    if (CONFIG.MAX_AMOUNT < CONFIG.MIN_AMOUNT) CONFIG.MAX_AMOUNT = CONFIG.MIN_AMOUNT;
    CONFIG.AMOUNT_BUTTONS = parseButtonList(
        getParamFromCurrentScript('buttons') || getParamFromCurrentScript('amounts')
    ).filter((n) => n >= CONFIG.MIN_AMOUNT && n <= CONFIG.MAX_AMOUNT);
    if (!CONFIG.AMOUNT_BUTTONS.length) CONFIG.AMOUNT_BUTTONS = [CONFIG.MIN_AMOUNT];

    const SKIP_STORE_KEY = false;
    const STORE_KEY = (
        getParamFromCurrentScript('store_key') ||
        window.HOC_PGSCRIPT_STORE_KEY ||
        (window.HOC_PG_CONFIG && window.HOC_PG_CONFIG.STORE_KEY) ||
        ''
    ).toString().trim();

    if (SKIP_STORE_KEY) {
        console.log(LOG, 'store_key SKIP (health bypass ON)');
    } else if (STORE_KEY) {
        console.log(LOG, 'store_key loaded');
    }

    function resolvePgscriptBase() {
        let base = (
            window.PGSCRIPT_BASE_URL || window.PGSCRIPT_BASE ||
            getParamFromCurrentScript('api_base') ||
            'https://payment.pg-poppay.com'
        ).toString().trim();
        try {
            const parsed = new URL(base, location.href);
            if (location.protocol === 'https:' && parsed.protocol === 'http:') parsed.protocol = 'https:';
            base = parsed.origin;
        } catch (e) {
            if (location.protocol === 'https:' && base.startsWith('http://')) base = 'https://' + base.slice(7);
        }
        return base.replace(/\/+$/, '');
    }

    const PGSCRIPT_BASE = resolvePgscriptBase();
    const PGSCRIPT_API_VERSION = (getParamFromCurrentScript('api_version') || 'api').toString().trim();

    async function checkPaymentHealth() {
        if (SKIP_STORE_KEY || !STORE_KEY) {
            if (SKIP_STORE_KEY) return true;
            console.warn(LOG, 'store_key missing');
            return false;
        }
        const now = Date.now();
        if (paymentHealthCache !== null && paymentHealthCacheKey === STORE_KEY && (now - paymentHealthCacheAt) < PAYMENT_HEALTH_TTL) {
            return paymentHealthCache;
        }
        try {
            const res = await fetch(PGSCRIPT_BASE + '/' + PGSCRIPT_API_VERSION + '/payment-health-v2', {
                method: 'GET',
                cache: 'no-store',
                headers: { Accept: 'application/json', 'X-Store-Key': STORE_KEY },
            });
            const body = await res.json().catch(() => ({}));
            const ok = res.ok && body && body.success === true;
            paymentHealthCache = ok;
            paymentHealthCacheKey = STORE_KEY;
            paymentHealthCacheAt = now;
            return ok;
        } catch (err) {
            console.warn(LOG, 'health failed', err);
            paymentHealthCache = false;
            paymentHealthCacheKey = STORE_KEY;
            paymentHealthCacheAt = now;
            return false;
        }
    }

    function isValidUser(text) {
        if (!text) return false;
        const t = String(text).trim();
        if (t.length < 3 || t.length > 32) return false;
        if (!/^[a-zA-Z][a-zA-Z0-9_]{2,31}$/.test(t)) return false;
        const uiWords = new Set([
            'wallet', 'profile', 'deposit', 'withdraw', 'qris', 'qrisauto', 'bank',
            'username', 'login', 'register', 'account', 'instant', 'pulsa',
            'ewallet', 'dana', 'gopay', 'ovo', 'hello', 'halo', 'welcome',
            'selamat', 'datang',
        ]);
        return !uiWords.has(t.toLowerCase());
    }

    function cleanUsernameCandidate(raw) {
        let t = String(raw || '')
            .replace(/[\u200b-\u200d\ufeff]/g, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        t = t.replace(/^(hello|halo|hi|hai|welcome|selamat\s+datang)\s*,?\s*/i, '').trim();
        t = t.replace(/^,\s*/, '');
        return t;
    }

    function pickValidUsername(raw) {
        const t = cleanUsernameCandidate(raw);
        if (isValidUser(t)) return t;
        const matches = t.match(/[a-zA-Z][a-zA-Z0-9_]{2,31}/g) || [];
        const ok = [];
        for (let i = 0; i < matches.length; i++) {
            if (isValidUser(matches[i])) ok.push(matches[i]);
        }
        if (!ok.length) return null;
        if (ok.length === 1) return ok[0];
        const skipBrand = new Set(['hotelbet']);
        const notBrand = ok.filter((m) => !skipBrand.has(m.toLowerCase()));
        if (notBrand.length) return notBrand[notBrand.length - 1];
        return ok[ok.length - 1];
    }

    function readUsernameFromDom(root) {
        const doc = root || document;
        const sels = [
            '.username',
            '#loyalty_level_container > div > a > div > span',
            '#loyalty_level_container span',
            '.member-name',
            '.account-name',
        ];
        for (let i = 0; i < sels.length; i++) {
            const nodes = doc.querySelectorAll(sels[i]);
            for (let j = 0; j < nodes.length; j++) {
                const el = nodes[j];
                if (el.closest && el.closest('#' + WRAPPER_ID)) continue;
                const hit = pickValidUsername(el.textContent) || pickValidUsername(el.innerHTML);
                if (hit) return hit;
            }
        }
        return '';
    }

    function lockUsername(u, source) {
        const t = String(u || '').trim();
        if (!t) return null;
        if (!isValidUser(t)) {
            console.warn(LOG, 'username parsed but rejected:', t, source);
            return null;
        }
        _lockedUsername = t;
        window.__HOC_LOCKED_USERNAME__ = t;
        console.log(LOG, 'username locked (' + source + '):', t);
        return t;
    }

    function getUsername() {
        if (_lockedUsername && isValidUser(_lockedUsername)) return _lockedUsername;
        const field = document.getElementById('depositUsernameAutoQris');
        if (field && isValidUser(field.value)) return lockUsername(field.value, 'field');
        const live = readUsernameFromDom(document);
        if (live) return lockUsername(live, '.username live');
        return null;
    }

    async function fetchUsernameFromPage() {
        if (_lockedUsername && isValidUser(_lockedUsername)) return _lockedUsername;
        const liveNow = readUsernameFromDom(document);
        if (liveNow) {
            const locked = lockUsername(liveNow, '.username live');
            if (locked) return locked;
        }
        try {
            const res = await fetch(window.location.href, { credentials: 'same-origin', cache: 'no-store' });
            const pageText = await res.text();
            const parsedDom = new DOMParser().parseFromString(pageText, 'text/html');
            const username = readUsernameFromDom(parsedDom);
            if (username) {
                const locked = lockUsername(username, 'fetch page');
                if (locked) return locked;
            }
        } catch (e) {
            console.warn(LOG, 'username fetch failed', e);
        }
        return getUsername();
    }

    function isDepositPage() {
        const parts = (location.pathname || '').split('/').filter(Boolean);
        const hash = (location.hash || '').replace(/^#/, '');
        if (parts[0] === 'deposit' || parts[1] === 'deposit' || parts[2] === 'deposit') return true;
        if ((parts[0] || '') + hash === 'deposit' || (parts[1] || '') + hash === 'deposit') return true;
        const path = (location.pathname || '').toLowerCase();
        return path.indexOf('/deposit') !== -1 ||
            !!document.getElementById('payment_method_selection') ||
            !!document.querySelector('a[href*="/deposit/"]');
    }

    function normText(el) {
        return ((el && el.textContent) || '').replace(/\s+/g, ' ').trim().toUpperCase();
    }

    function channelHref(el) {
        if (!el) return '';
        return ((el.getAttribute('href') || el.getAttribute('data-href') || el.dataset.channel || el.dataset.payment || '') + '').toUpperCase();
    }

    function isInstantTab(el) {
        if (!el) return false;
        if (el.id === TAB_ID || (el.closest && el.closest('#' + TAB_ID))) return true;
        const t = normText(el).replace(/\s+/g, '');
        return t.indexOf('QRISINSTANT') !== -1;
    }

    function isQrisAutoNode(el) {
        if (!el || isInstantTab(el)) return false;
        const href = channelHref(el);
        const t = normText(el).replace(/\s+/g, '');
        if (href.indexOf('QRISAUTO') !== -1) return true;
        if (t === 'QRISAUTO' || t === 'QRISAUTOPAY' || t.indexOf('QRISAUTO') !== -1) return true;
        if (t === 'QRIS AUTO' || t.indexOf('QRIS AUTO') !== -1) return true;
        return false;
    }

    function depositAnchors() {
        return Array.from(document.querySelectorAll(
            'a[href*="/deposit/"], a[href*="/desktop/deposit/"], [data-channel], [data-payment]'
        )).filter((el) => {
            const href = channelHref(el);
            return href.indexOf('DEPOSIT') !== -1 || href.indexOf('BANK') !== -1 ||
                href.indexOf('QRIS') !== -1 || href.indexOf('PULSA') !== -1 ||
                href.indexOf('VA') !== -1 || href.indexOf('EWALLET') !== -1 ||
                isQrisAutoNode(el);
        });
    }

    function findTabBar() {
        const nxs = document.getElementById('payment_method_selection');
        if (nxs) return nxs;
        const auto = findQrisAutoRaw();
        if (auto && auto.parentElement) {
            const wrap = auto.closest('ul, ol, nav, .nav, [class*="tab"], [class*="channel"], [class*="payment"]');
            if (wrap) return wrap;
            return auto.parentElement;
        }
        const anchors = depositAnchors();
        if (anchors.length >= 2) {
            let parent = anchors[0].parentElement;
            const allIn = (p) => anchors.filter((a) => p.contains(a)).length >= Math.min(2, anchors.length);
            while (parent && parent !== document.body && !allIn(parent)) parent = parent.parentElement;
            if (parent && parent !== document.body) return parent;
            return anchors[0].parentElement;
        }
        if (anchors.length === 1) return anchors[0].parentElement;
        return null;
    }

    function findQrisAutoRaw() {
        const nxs = document.getElementById('payment_method_QRISAUTO') ||
            document.getElementById('qrisauto') ||
            document.querySelector('label[for="payment_method_QRISAUTO"]');
        if (nxs) return nxs.closest('#qrisauto') || nxs.closest('.available-payment-account-item') || nxs;
        const items = document.querySelectorAll('.available-payment-account-item, #payment_method_selection > div');
        for (let i = 0; i < items.length; i++) {
            if (isQrisAutoNode(items[i])) return items[i];
        }
        const nodes = Array.from(document.querySelectorAll('a, button, [role="tab"], li, div, span, label'));
        for (let i = 0; i < nodes.length; i++) {
            if (isQrisAutoNode(nodes[i])) return nodes[i];
        }
        return null;
    }

    function tabItemRoot(el, bar) {
        if (!el || !bar) return el;
        let n = el;
        while (n.parentElement && n.parentElement !== bar) n = n.parentElement;
        return n;
    }

    function rewriteCloneText(root, label) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        const texts = [];
        while (walker.nextNode()) {
            if (walker.currentNode.nodeValue && walker.currentNode.nodeValue.trim()) {
                texts.push(walker.currentNode);
            }
        }
        if (texts.length) {
            texts[0].nodeValue = label;
            for (let i = 1; i < texts.length; i++) texts[i].nodeValue = '';
        } else {
            const clickable = root.matches('a,button') ? root : root.querySelector('a,button,span');
            if (clickable) clickable.textContent = label;
        }
    }

    function createNxsInstantRadio(bar) {
        let wrap = bar.querySelector('#' + TAB_ID) || bar.querySelector('#qrisinstant');
        if (wrap) {
            wrap.classList.add('hoc-qris-instant-tab');
            if (!wrap.id) wrap.id = TAB_ID;
            wrap.addEventListener('click', onInstantClick, true);
            return wrap;
        }
        wrap = document.createElement('div');
        wrap.id = TAB_ID;
        wrap.className = 'hoc-qris-instant-tab';
        wrap.setAttribute('data-hoc-tab', 'instant');
        wrap.innerHTML =
            '<input type="radio" name="PaymentType" id="payment_method_QRISINSTANT" value="QRISINSTANT">' +
            '<label for="payment_method_QRISINSTANT">' +
            '<svg fill="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="25"><path d="M8,21H4a1,1,0,0,1-1-1V16a1,1,0,0,0-2,0v4a3,3,0,0,0,3,3H8a1,1,0,0,0,0-2Zm14-6a1,1,0,0,0-1,1v4a1,1,0,0,1-1,1H16a1,1,0,0,0,0,2h4a3,3,0,0,0,3-3V16A1,1,0,0,0,22,15ZM20,1H16a1,1,0,0,0,0,2h4a1,1,0,0,1,1,1V8a1,1,0,0,0,2,0V4A3,3,0,0,0,20,1ZM2,9A1,1,0,0,0,3,8V4A1,1,0,0,1,4,3H8A1,1,0,0,0,8,1H4A3,3,0,0,0,1,4V8A1,1,0,0,0,2,9Zm8-4H6A1,1,0,0,0,5,6v4a1,1,0,0,0,1,1h4a1,1,0,0,0,1-1V6A1,1,0,0,0,10,5ZM9,9H7V7H9Zm5,2h4a1,1,0,0,0,1-1V6a1,1,0,0,0-1-1H14a1,1,0,0,0-1,1v4A1,1,0,0,0,14,11Zm1-4h2V9H15Zm-5,6H6a1,1,0,0,0-1,1v4a1,1,0,0,0,1,1h4a1,1,0,0,0,1-1V14A1,1,0,0,0,10,13ZM9,17H7V15H9Zm5-1a1,1,0,0,0,1-1,1,1,0,0,0,0-2H14a1,1,0,0,0-1,1v1A1,1,0,0,0,14,16Zm4-3a1,1,0,0,0-1,1v3a1,1,0,0,0,0,2h1a1,1,0,0,0,1-1V14A1,1,0,0,0,18,13Zm-4,4a1,1,0,1,0,1,1A1,1,0,0,0,14,17Z"></path></svg>' +
            '<span>QRIS INSTANT</span></label>';
        wrap.addEventListener('click', onInstantClick, true);
        return wrap;
    }

    function createInstantTab(bar) {
        if (bar && bar.id === 'payment_method_selection') {
            return createNxsInstantRadio(bar);
        }
        const auto = findQrisAutoRaw();
        const anchors = depositAnchors();
        const template = auto || anchors[0];
        let node;
        if (template && bar.contains(template)) {
            node = tabItemRoot(template, bar).cloneNode(true);
        } else {
            node = document.createElement('a');
        }
        node.setAttribute('data-hoc-tab', 'instant');
        node.classList.add('hoc-qris-instant-tab');
        if (!document.getElementById(TAB_ID)) node.id = TAB_ID;
        rewriteCloneText(node, 'QRIS INSTANT');
        node.querySelectorAll('a').forEach((a) => {
            a.href = 'javascript:void(0)';
            a.setAttribute('data-hoc-tab', 'instant');
        });
        if (node.tagName === 'A') {
            node.href = 'javascript:void(0)';
        }
        node.addEventListener('click', onInstantClick, true);
        return node;
    }

    function placeInstantTab(bar, tab) {
        if (!bar || !tab) return;
        if (bar.firstChild !== tab) bar.insertBefore(tab, bar.firstChild);
    }

    function ensureInstantTab() {
        const bar = findTabBar();
        if (!bar) return null;
        let tab = document.getElementById(TAB_ID);
        if (!tab) {
            tab = createInstantTab(bar);
            placeInstantTab(bar, tab);
        } else {
            if (!bar.contains(tab)) placeInstantTab(bar, tab);
            else placeInstantTab(bar, tabItemRoot(tab, bar));
        }
        return tab;
    }

    function setNativeTabActive(on) {
        const bar = findTabBar();
        if (!bar) return;
        const instant = document.getElementById(TAB_ID);
        const instantRadio = document.getElementById('payment_method_QRISINSTANT');
        if (instantRadio) {
            Array.from(document.querySelectorAll('#payment_method_selection input[name="PaymentType"]')).forEach((el) => {
                el.checked = false;
            });
            if (on) instantRadio.checked = true;
        }
        Array.from(bar.querySelectorAll('a, button, [role="tab"], .active, .selected')).forEach((el) => {
            if (instant && (el === instant || instant.contains(el))) return;
            el.classList.remove('active', 'selected', 'is-active', 'current');
        });
        if (on && instant) {
            instant.classList.add('active', 'selected');
            const inner = instant.querySelector('a, button');
            if (inner) inner.classList.add('active', 'selected');
        }
    }

    function onInstantClick(e) {
        e.preventDefault();
        e.stopPropagation();
        _userPickedNative = false;
        activateInstant();
    }

    function activateInstant() {
        setNativeTabActive(true);
        const wrap = document.getElementById(WRAPPER_ID);
        if (wrap) {
            wrap.style.display = 'block';
            wrap.setAttribute('data-hoc-open', '1');
        }
        hideNativeDeposit(true);
        void syncUsernameField();
    }

    function deactivateInstant() {
        const wrap = document.getElementById(WRAPPER_ID);
        if (wrap) {
            wrap.style.display = 'none';
            wrap.setAttribute('data-hoc-open', '0');
        }
        const instant = document.getElementById(TAB_ID);
        if (instant) {
            instant.classList.remove('active', 'selected');
            const inner = instant.querySelector('a, button');
            if (inner) inner.classList.remove('active', 'selected');
        }
        hideNativeDeposit(false);
    }

    function hideNativeDeposit(hide) {
        const wrap = document.getElementById(WRAPPER_ID);
        const bar = document.getElementById('payment_method_selection') || findTabBar();
        document.body.setAttribute('data-hoc-instant', hide ? '1' : '0');

        function isProtected(el) {
            if (!el || el === document.body || el === document.documentElement) return true;
            if (wrap && (el === wrap || wrap.contains(el))) return true;
            if (bar && (el === bar || bar.contains(el))) return true;
            if (el.id === TAB_ID) return true;
            return false;
        }

        function apply(el) {
            if (isProtected(el)) return;
            if (hide) {
                if (!el.hasAttribute('data-hoc-prev-display')) {
                    el.setAttribute('data-hoc-prev-display', el.style.display || '');
                }
                el.style.setProperty('display', 'none', 'important');
            } else if (el.hasAttribute('data-hoc-prev-display')) {
                el.style.removeProperty('display');
                const prev = el.getAttribute('data-hoc-prev-display');
                el.removeAttribute('data-hoc-prev-display');
                if (prev) el.style.display = prev;
            }
        }

        function hideTree(el) {
            if (!el || isProtected(el)) return;
            if ((wrap && el.contains(wrap)) || (bar && el.contains(bar))) {
                Array.from(el.children).forEach(hideTree);
                return;
            }
            apply(el);
        }

        if (wrap) {
            let n = wrap.nextElementSibling;
            while (n) {
                hideTree(n);
                n = n.nextElementSibling;
            }
            let p = wrap.parentElement;
            let depth = 0;
            while (p && p !== document.body && depth < 5) {
                const cls = ((p.className || '') + ' ' + (p.id || '')).toLowerCase();
                if (!/sidebar|header|footer|menu|promo/.test(cls)) {
                    let s = p.nextElementSibling;
                    while (s) {
                        const sc = ((s.className || '') + ' ' + (s.id || '')).toLowerCase();
                        if (!/sidebar|header|footer|nav|menu|promo|chat|tawk/.test(sc)) hideTree(s);
                        s = s.nextElementSibling;
                    }
                }
                p = p.parentElement;
                depth++;
            }
        }

        document.querySelectorAll('label, .form-group, .row, tr, div, span').forEach((el) => {
            if (isProtected(el)) return;
            const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
            if (!t) return;
            const isNativeRow =
                t.indexOf('Akun Asal') !== -1 ||
                t.indexOf('Akun Tujuan') !== -1 ||
                t === 'Jumlah' ||
                /^Jumlah\b/.test(t) && t.length < 24 && t.indexOf('Deposit') === -1;
            if (!isNativeRow) return;
            const box = el.closest('.form-group, .row, .form-row, tr, table, fieldset, .mb-3, .mb-2') || el.parentElement;
            if (!box || isProtected(box)) return;
            if ((wrap && box.contains(wrap)) || (bar && box.contains(bar))) return;
            apply(box);
        });
    }

    function formatRpLabel(n) {
        return 'Rp ' + Number(n).toLocaleString('id-ID');
    }

    function amountButtonsHtml() {
        return CONFIG.AMOUNT_BUTTONS.map((n) =>
            '<button type="button" class="qris-amount-btn" data-amount="' + n + '" onclick="return window.hocSetAmount(' + n + ', this)">' +
            formatRpLabel(n) + '</button>'
        ).join('');
    }

    async function syncUsernameField(u) {
        const name = u || await fetchUsernameFromPage() || getUsername();
        const field = document.getElementById('depositUsernameAutoQris');
        if (field && name) field.value = name;
        if (!name) scheduleUsernameRetry();
        return name;
    }

    let usernameRetry = 0;
    function scheduleUsernameRetry() {
        if (_lockedUsername && isValidUser(_lockedUsername)) return;
        if (usernameRetry >= 15) return;
        usernameRetry++;
        setTimeout(function () {
            void syncUsernameField();
        }, 400);
    }

    function panelCss() {
        const mob = CONFIG.IS_MOBILE;
        return `
#${WRAPPER_ID}{
  --hoc-bg:#16120a;--hoc-bg-deep:#0c0a06;--hoc-text:#f4e6c3;--hoc-muted:#b5a47a;
  --hoc-accent:#d4af37;--hoc-accent-hover:#e6c65c;--hoc-accent-text:#1a1408;
  --hoc-border:rgba(212,175,55,.35);--hoc-btn-bg:rgba(212,175,55,.1);
  --hoc-shadow:0 4px 16px rgba(0,0,0,.45);z-index:1;position:relative;
}
#${TAB_ID},#${TAB_ID} a,label[for="payment_method_QRISINSTANT"]{cursor:pointer!important}
body[data-hoc-instant="1"] #${WRAPPER_ID} ~ *{display:none!important}
#${PANEL_ID}{position:relative;z-index:auto;display:block}
.hoc-qris-box{background:var(--hoc-bg);color:var(--hoc-text);padding:${mob ? '12px' : '22px'};
  border-radius:10px;margin:12px 0 20px;border:1px solid var(--hoc-border);box-shadow:var(--hoc-shadow);
  font-family:Poppins,Arial,sans-serif;box-sizing:border-box;width:100%}
.hoc-qris-box h5{margin:0 0 6px;font-size:${mob ? '16px' : '18px'};color:var(--hoc-accent)}
.hoc-qris-box p{margin:0 0 14px;color:var(--hoc-muted);font-size:13px}
.hoc-qris-box label{display:block;margin-bottom:6px;font-size:13px;color:var(--hoc-muted)}
.hoc-qris-box .qris-amount-buttons{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:10px}
.hoc-qris-box .qris-amount-btn{background:var(--hoc-btn-bg);color:var(--hoc-text);border:1px solid var(--hoc-border);
  border-radius:6px;padding:${mob ? '10px 8px' : '8px 14px'};cursor:pointer;font-size:${mob ? '12px' : '13px'}}
.hoc-qris-box .qris-amount-btn.active,.hoc-qris-box .qris-amount-btn:hover{
  background:var(--hoc-accent);color:var(--hoc-accent-text);border-color:var(--hoc-accent)}
.hoc-qris-box .qris-input-group{display:flex;margin-bottom:8px}
.hoc-qris-box .qris-input-prefix{background:var(--hoc-bg-deep);padding:12px;border:1px solid var(--hoc-border);
  border-right:none;border-radius:6px 0 0 6px;color:var(--hoc-muted)}
.hoc-qris-box .qris-input{flex:1;padding:12px;border:1px solid var(--hoc-border);border-radius:0 6px 6px 0;
  background:var(--hoc-bg-deep);color:var(--hoc-text);font-size:15px}
.hoc-qris-box .qris-username-readonly{border-radius:6px;width:100%;box-sizing:border-box}
.hoc-qris-box .qris-input-hint{font-size:12px;color:var(--hoc-muted)}
.hoc-qris-box .qris-submit-btn{width:100%;margin-top:12px;padding:14px;background:var(--hoc-accent);
  color:var(--hoc-accent-text);border:none;border-radius:6px;font-weight:600;cursor:pointer;font-size:15px}
.hoc-qris-box .qris-submit-btn:disabled{opacity:.6;cursor:not-allowed}
.hoc-qris-box .qris-result{display:none;margin-top:12px}
.hoc-qris-box .qris-result.active{display:block}
`;
    }

    function buildPanelHtml() {
        return `
<style>${panelCss()}</style>
<div class="hoc-qris-box" id="${PANEL_ID}">
  <div class="qris-manual-header">
    <h5>QRIS INSTANT</h5>
    <p>Scan QR dengan e-wallet (DANA, OVO, GoPay, ShopeePay, dll)</p>
  </div>
  <div class="qris-form" id="qrisFormContainer">
    <form id="formDepositAutoQris">
      <input type="hidden" id="bankSelectAutoQris" value="QRIS">
      <div class="form-group" style="margin-bottom:12px">
        <label for="depositUsernameAutoQris">Username</label>
        <input class="qris-input qris-username-readonly notranslate" type="text" id="depositUsernameAutoQris"
          name="username" readonly tabindex="-1" translate="no" autocomplete="off" placeholder="Mendeteksi username...">
        <small class="qris-input-hint">Username akun login (otomatis)</small>
      </div>
      <div class="form-group">
        <label>Jumlah Deposit</label>
        <div class="qris-amount-buttons">${amountButtonsHtml()}</div>
        <div class="qris-input-group">
          <div class="qris-input-prefix">Rp</div>
          <input class="qris-input" type="text" id="depositShowAmountAutoQris" placeholder="Atau jumlah manual">
        </div>
        <input type="hidden" id="depositAmountAutoQris" value="">
        <small class="qris-input-hint">Min: ${formatRpLabel(CONFIG.MIN_AMOUNT)} | Max: ${formatRpLabel(CONFIG.MAX_AMOUNT)}</small>
      </div>
      <button type="submit" class="qris-submit-btn"><span id="qris-btn-text">Generate QR Code</span></button>
    </form>
  </div>
  <div class="qris-result" id="qrisResultContainer">
    <div id="qris-payment-frame"></div>
    <div id="payment-result"></div>
  </div>
</div>`;
    }

    function insertPanel(bar) {
        let wrap = document.getElementById(WRAPPER_ID);
        if (wrap) return wrap;
        wrap = document.createElement('div');
        wrap.id = WRAPPER_ID;
        wrap.setAttribute('data-ug-persistent', 'true');
        wrap.style.display = 'none';
        wrap.innerHTML = buildPanelHtml();
        if (bar && bar.parentElement) {
            if (bar.nextSibling) bar.parentElement.insertBefore(wrap, bar.nextSibling);
            else bar.parentElement.appendChild(wrap);
        } else {
            (document.querySelector('.deposit-content, .content-container, main, body') || document.body).appendChild(wrap);
        }
        attachFormHandlers();
        return wrap;
    }

    function loadQrisSDK() {
        return new Promise((resolve, reject) => {
            if (window.QrisSDK) { resolve(); return; }
            const url = (
                getParamFromCurrentScript('sdk_url') ||
                window.PGSCRIPT_SDK_URL ||
                'https://unpkg.com/@poppackage/pg-ppy-sdk@1.0.0/dist/qris-sdk.umd.js'
            ).toString().trim();
            const script = document.createElement('script');
            script.src = url;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('SDK load failed'));
            document.head.appendChild(script);
        });
    }

    function attachFormHandlers() {
        if (injectHandlersAttached) return;
        const form = document.getElementById('formDepositAutoQris');
        const amountShow = document.getElementById('depositShowAmountAutoQris');
        const amountHidden = document.getElementById('depositAmountAutoQris');
        const btnText = document.getElementById('qris-btn-text');
        if (!form || !amountShow || !amountHidden) return;
        injectHandlersAttached = true;
        void syncUsernameField();

        amountShow.addEventListener('input', function () {
            const n = parseInt(String(this.value).replace(/\D/g, ''), 10);
            amountHidden.value = Number.isFinite(n) ? n : '';
            document.querySelectorAll('#' + PANEL_ID + ' .qris-amount-btn').forEach((b) => b.classList.remove('active'));
        });

        form.addEventListener('submit', async function (e) {
            e.preventDefault();
            const amount = parseInt(amountHidden.value, 10);
            if (!amount || amount < CONFIG.MIN_AMOUNT) {
                alert('Minimal deposit ' + formatRpLabel(CONFIG.MIN_AMOUNT));
                return;
            }
            if (amount > CONFIG.MAX_AMOUNT) {
                alert('Maksimal deposit ' + formatRpLabel(CONFIG.MAX_AMOUNT));
                return;
            }
            const submitBtn = this.querySelector('.qris-submit-btn');
            submitBtn.disabled = true;
            btnText.textContent = 'Generating...';
            const formContainer = document.getElementById('qrisFormContainer');
            const resultContainer = document.getElementById('qrisResultContainer');
            try {
                if (!window.QrisSDK) await loadQrisSDK();
                const username = await fetchUsernameFromPage();
                await syncUsernameField(username);
                if (!username) throw new Error('Username tidak ditemukan. Login dulu.');
                formContainer.style.display = 'none';
                resultContainer.classList.add('active');
                await new Promise((r) => setTimeout(r, 80));
                const invoice = 'HOC-' + Date.now();
                const payment = new window.QrisSDK({
                    healthCheckEnabled: false,
                    storeKey: STORE_KEY,
                    store_key: STORE_KEY,
                    amount: amount,
                    invoice: invoice,
                    notes: 'HOC Auto Deposit - ' + invoice,
                    username: username,
                    payor_name: username,
                    payor_email: '',
                    displayMode: 'inline',
                    containerId: 'qris-payment-frame',
                    resultContainerId: 'payment-result',
                    onSuccess: function () {
                        document.getElementById('payment-result').innerHTML =
                            '<div><h4>Pembayaran Berhasil</h4><p>Deposit ' + formatRpLabel(amount) + ' diproses</p></div>';
                        setTimeout(resetForm, 5000);
                    },
                    onFailed: function () {
                        alert('Gagal membuat QR. Coba lagi.');
                        resetForm();
                    },
                    onCancel: function () { resetForm(); },
                });
                payment.openPayment();
            } catch (err) {
                console.error(LOG, err);
                alert(err.message || 'Terjadi kesalahan.');
                resetForm();
            }

            function resetForm() {
                formContainer.style.display = 'block';
                resultContainer.classList.remove('active');
                const frame = document.getElementById('qris-payment-frame');
                const result = document.getElementById('payment-result');
                if (frame) frame.innerHTML = '';
                if (result) result.innerHTML = '';
                submitBtn.disabled = false;
                btnText.textContent = 'Generate QR Code';
            }
        });
    }

    function bindNativeTabClicks() {
        document.addEventListener('click', function (e) {
            const t = e.target.closest('a, button, [role="tab"], label, #qrisauto');
            if (!t) return;
            if (isInstantTab(t)) {
                _userPickedNative = false;
                return;
            }
            const bar = findTabBar();
            if (bar && bar.contains(t)) {
                _userPickedNative = true;
                deactivateInstant();
                return;
            }
            const href = channelHref(t);
            if (href.indexOf('DEPOSIT') !== -1) {
                _userPickedNative = false;
                setTimeout(function () {
                    if (_userPickedNative) return;
                    if (document.getElementById(WRAPPER_ID)) activateInstant();
                }, 350);
            }
        }, true);
        document.addEventListener('change', function (e) {
            const t = e.target;
            if (!t || t.name !== 'PaymentType') return;
            if (t.id === 'payment_method_QRISINSTANT') return;
            _userPickedNative = true;
            deactivateInstant();
        }, true);
    }

    function allTabBars() {
        const bars = [];
        const seen = new Set();
        const nxs = document.getElementById('payment_method_selection');
        if (nxs) {
            seen.add(nxs);
            bars.push(nxs);
        }
        const auto = findQrisAutoRaw();
        const nodes = depositAnchors().concat(auto ? [auto] : []);
        nodes.forEach((el) => {
            if (!el || !el.parentElement) return;
            let bar = el.parentElement;
            const wrap = el.closest('#payment_method_selection, ul, ol, nav, .nav, [class*="tab"], [class*="channel"], [class*="payment"], .tabs');
            if (wrap) bar = wrap;
            if (seen.has(bar)) return;
            seen.add(bar);
            bars.push(bar);
        });
        return bars;
    }

    async function injectOnce() {
        if (!isDepositPage() && !findTabBar()) return false;
        const healthOk = await checkPaymentHealth();
        if (!healthOk) return false;
        const bars = allTabBars();
        if (!bars.length) return false;
        bars.forEach((bar) => {
            let tab = bar.querySelector('.hoc-qris-instant-tab');
            if (!tab) {
                tab = createInstantTab(bar);
                placeInstantTab(bar, tab);
            } else {
                placeInstantTab(bar, tabItemRoot(tab, bar));
            }
        });
        insertPanel(bars[0]);
        await syncUsernameField();
        if (!_userPickedNative) activateInstant();
        console.log(LOG, 'tab ready. bars=', bars.length, 'QRISAUTO=', !!findQrisAutoRaw());
        return true;
    }

    let retryCount = 0;
    async function tryStart() {
        const ok = await injectOnce();
        if (ok) return;
        if (retryCount < CONFIG.MAX_RETRIES) {
            retryCount++;
            setTimeout(tryStart, CONFIG.RETRY_DELAY);
        }
    }

    bindNativeTabClicks();
    void fetchUsernameFromPage();
    const mo = new MutationObserver(function () {
        if (!document.querySelector('.hoc-qris-instant-tab') || !document.getElementById(WRAPPER_ID)) {
            injectOnce();
        } else {
            const bars = allTabBars();
            bars.forEach((bar) => {
                const tab = bar.querySelector('.hoc-qris-instant-tab');
                if (tab) placeInstantTab(bar, tabItemRoot(tab, bar) || tab);
            });
            const field = document.getElementById('depositUsernameAutoQris');
            if (field && !field.value) void syncUsernameField();
        }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(tryStart, 300); });
    } else {
        setTimeout(tryStart, 300);
    }
})();
