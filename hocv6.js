// ============================================================================
// Inject: /desktop/deposit dan /mobile/deposit → paksa tab QRIS INSTANT
// /desktop/deposit/BANK|EMONEY|PULSA dan /mobile/deposit/BANK|EMONEY|PULSA → jangan paksa
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
    const VERSION = '1.3.1';
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
        AMOUNT_BUTTONS: [10000, 50000, 100000, 200000, 500000, 1000000, 5000000, 10000000],
        MAX_RETRIES: 24,
        RETRY_DELAY: 400,
        IS_MOBILE: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent),
    };

    let _lockedUsername = (window.__HOC_LOCKED_USERNAME__ || '').toString().trim() || null;
    let _userChoseInstant = false;
    const SUBMIT_COOLDOWN = 0; // 0 = cooldown matikan
    let _cooldownTimer = null;

    function _cooldownStorageKey(username) {
        const u = (username || '').toLowerCase().trim();
        return u ? '__hoc_last_submit__:' + u : '__hoc_last_submit__';
    }

    function _getLastSubmit(username) {
        try { return parseInt(localStorage.getItem(_cooldownStorageKey(username)) || '0', 10); } catch (e) { return 0; }
    }

    function _setLastSubmit(username, t) {
        try { localStorage.setItem(_cooldownStorageKey(username), String(t)); } catch (e) {}
    }

    function _cooldownRemainingMs(username) {
        const last = _getLastSubmit(username);
        if (!last) return 0;
        const rem = SUBMIT_COOLDOWN - (Date.now() - last);
        return rem > 0 ? rem : 0;
    }

    function _clearCooldownTimer() {
        if (_cooldownTimer) {
            clearInterval(_cooldownTimer);
            _cooldownTimer = null;
        }
    }

    function _resolveCooldownUsername() {
        const el = document.getElementById('depositUsernameAutoQris');
        const fromField = el && el.value ? el.value.trim() : '';
        return fromField || (_lockedUsername || '').trim();
    }

    function _applySubmitCooldown(submitBtn, btnText, username) {
        if (!submitBtn || !btnText) return;
        _clearCooldownTimer();
        if (!SUBMIT_COOLDOWN) {
            submitBtn.disabled = false;
            btnText.textContent = 'Generate QR Code';
            return;
        }
        const user = (username || _resolveCooldownUsername() || '').trim();
        const tick = function () {
            const rem = _cooldownRemainingMs(user);
            if (!rem) {
                _clearCooldownTimer();
                submitBtn.disabled = false;
                btnText.textContent = 'Generate QR Code';
                return;
            }
            submitBtn.disabled = true;
            btnText.textContent = 'Tunggu ' + Math.ceil(rem / 1000) + ' detik...';
        };
        tick();
        if (_cooldownRemainingMs(user)) {
            _cooldownTimer = setInterval(tick, 1000);
        }
    }
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
        return /^[a-zA-Z0-9_]{3,32}$/.test(t);
    }

    function cleanUsernameCandidate(raw) {
        let t = String(raw || '')
            .replace(/[\u200b-\u200d\ufeff]/g, '')
            .replace(/<[^>]+>/g, ' ')
            .replace(/&nbsp;/gi, ' ')
            .replace(/\u00a0/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
        t = t.replace(/^(hello|halo|hi|hai|welcome|selamat\s+datang)(\s*,\s*|\s+)/i, '').trim();
        t = t.replace(/^,\s*/, '');
        return t;
    }

    function pickValidUsername(raw) {
        const t = cleanUsernameCandidate(raw);
        if (isValidUser(t)) return t;
        const matches = t.match(/[a-zA-Z0-9_]{3,32}/g) || [];
        for (let i = matches.length - 1; i >= 0; i--) {
            if (isValidUser(matches[i])) return matches[i];
        }
        return null;
    }

    function extractLoggedInUsername(source) {
        const m = String(source || '').match(/const\s+loggedInUsername\s*=\s*['"]([^'"]+)['"]/);
        if (m && isValidUser(m[1])) return m[1];
        return null;
    }

    function readUsernameFromDom(root) {
        const doc = root || document;
        const sels = [
            '.username-container > span',
            'span.username',
            '.username',
            '.side-menu-user-info .username',
        ];
        for (let i = 0; i < sels.length; i++) {
            const nodes = doc.querySelectorAll(sels[i]);
            for (let j = 0; j < nodes.length; j++) {
                const el = nodes[j];
                if (el.closest && el.closest('#' + WRAPPER_ID)) continue;
                const hit = pickValidUsername(el.textContent);
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
        return null;
    }

    async function fetchUsernameFromPage() {
        if (_lockedUsername && isValidUser(_lockedUsername)) return _lockedUsername;

        try {
            const scripts = Array.from(document.scripts || []).map((s) => s.textContent || '').join('\n');
            const fromScript = extractLoggedInUsername(scripts);
            if (fromScript) return lockUsername(fromScript, 'loggedInUsername script');
        } catch (e) { /* ignore */ }

        try {
            const res = await fetch(window.location.href, { credentials: 'same-origin', cache: 'no-store' });
            const html = await res.text();
            const fromConst = extractLoggedInUsername(html);
            if (fromConst) return lockUsername(fromConst, 'fetch loggedInUsername');
            const parsedDom = new DOMParser().parseFromString(html, 'text/html');
            const fromHtml = readUsernameFromDom(parsedDom);
            if (fromHtml) return lockUsername(fromHtml, 'fetch html');
        } catch (e) {
            console.warn(LOG, 'username fetch failed', e);
        }

        try {
            const ls = (window.localStorage && localStorage.getItem('logged_in_username')) || '';
            if (isValidUser(ls)) return lockUsername(ls, 'localStorage');
        } catch (e) { /* ignore */ }

        const live = readUsernameFromDom(document);
        if (live) return lockUsername(live, 'live DOM');
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

    function isBareDepositPath() {
        const path = (location.pathname || '').replace(/\/+$/, '').toLowerCase();
        if (
            path === '/desktop/deposit' ||
            path === '/mobile/deposit' ||
            path === '/deposit'
        ) return true;
        const parts = path.split('/').filter(Boolean);
        const i = parts.findIndex((p) => p === 'deposit');
        return i >= 0 && i === parts.length - 1;
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

    function pickNative() {
        _userChoseInstant = false;
    }

    function pickInstant() {
        _userChoseInstant = true;
    }

    function applyUrlTabPolicy() {
        if (isBareDepositPath()) {
            activateInstant();
            return;
        }
        if (_userChoseInstant) {
            activateInstant();
            return;
        }
        deactivateInstant();
    }

    function isNativePayTarget(el) {
        if (!el || isInstantTab(el)) return false;
        const href = channelHref(el);
        const txt = normText(el).replace(/\s+/g, '');
        const idFor = ((el.id || '') + ' ' + (el.getAttribute && el.getAttribute('for') || '')).toUpperCase();
        const val = ((el.value || '') + '').toUpperCase();
        if (/PAYMENT_METHOD_(BANK|EMONEY|PULSA|QRISAUTO|QRIS|VA|EWALLET)/.test(idFor)) return true;
        if (/\/DEPOSIT\/(BANK|EMONEY|PULSA|QRISAUTO|QRIS|VA|EWALLET)(\/|$)/.test(href)) return true;
        if (['BANK', 'EMONEY', 'PULSA', 'QRISAUTO', 'QRIS', 'VA', 'EWALLET'].indexOf(txt) !== -1) return true;
        if (['BANK', 'EMONEY', 'PULSA', 'QRISAUTO', 'QRIS', 'VA', 'EWALLET'].indexOf(val) !== -1) return true;
        if (el.name === 'PaymentType' && el.id !== 'payment_method_QRISINSTANT') return true;
        return false;
    }

    function onInstantClick(e) {
        e.preventDefault();
        e.stopPropagation();
        pickInstant();
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

    /** Floor ke kelipatan 1000: 20500/20900/20999 → 20000 */
    function roundAmountDown(n) {
        const v = parseInt(n, 10);
        if (!Number.isFinite(v) || v < 1000) return 0;
        return Math.floor(v / 1000) * 1000;
    }

    function formatAmountBtnLabel(n) {
        const v = Number(n);
        if (v >= 1000000) {
            const jt = v / 1000000;
            return (Number.isInteger(jt) ? jt : jt.toString().replace('.', ',')) + 'jt';
        }
        if (v >= 1000) {
            const rb = v / 1000;
            return (Number.isInteger(rb) ? rb : rb.toString().replace('.', ',')) + 'rb';
        }
        return formatRpLabel(v);
    }

    function amountButtonsHtml() {
        return CONFIG.AMOUNT_BUTTONS.map((n) =>
            '<button type="button" class="qris-amount-btn" data-amount="' + n + '" onclick="return window.hocSetAmount(' + n + ', this)">' +
            formatAmountBtnLabel(n) + '</button>'
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
            void syncUsernameField().then(function (name) {
                const submitBtn = document.querySelector('#formDepositAutoQris .qris-submit-btn');
                const btnText = document.getElementById('qris-btn-text');
                if (submitBtn && btnText) _applySubmitCooldown(submitBtn, btnText, name);
            });
        }, 400);
    }

    function panelCss() {
        const mob = CONFIG.IS_MOBILE;
        return `
#${WRAPPER_ID}{
  --hoc-bg:#111;--hoc-bg-deep:#141414;--hoc-text:#fff;--hoc-muted:#dbdbdb;
  --hoc-accent:#bda270;--hoc-accent-hover:#ebcb80;--hoc-accent-text:#fff;
  --hoc-border:#2b2b2b;--hoc-btn-bg:#141414;
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
  background:linear-gradient(to right,#bda270 0%,#675a43 100%);color:var(--hoc-accent-text);border-color:#bda270}
.hoc-qris-box .qris-input-group{display:flex;margin-bottom:8px}
.hoc-qris-box .qris-input-prefix{background:var(--hoc-bg-deep);padding:12px;border:1px solid var(--hoc-border);
  border-right:none;border-radius:6px 0 0 6px;color:var(--hoc-muted)}
.hoc-qris-box .qris-input{flex:1;padding:12px;border:1px solid var(--hoc-border);border-radius:0 6px 6px 0;
  background:#000;color:var(--hoc-text);font-size:15px}
.hoc-qris-box .qris-username-readonly{border-radius:6px;width:100%;box-sizing:border-box}
.hoc-qris-box .qris-input-hint{font-size:12px;color:var(--hoc-muted)}
.hoc-qris-box .qris-submit-btn{width:100%;margin-top:12px;padding:14px;
  background:linear-gradient(to right,#bda270 0%,#675a43 100%);
  color:var(--hoc-accent-text);border:none;border-radius:6px;font-weight:600;cursor:pointer;font-size:15px}
.hoc-qris-box .qris-submit-btn:hover:not(:disabled){
  background:linear-gradient(to right,#675a43 0%,#bda270 100%)}
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
        <small class="qris-input-hint">Min: ${formatRpLabel(CONFIG.MIN_AMOUNT)} | Max: ${formatRpLabel(CONFIG.MAX_AMOUNT)} | Auto dibulatkan ke bawah (x.000)</small>
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
        const submitBtn = form.querySelector('.qris-submit-btn');
        void syncUsernameField().then(function () {
            _applySubmitCooldown(submitBtn, btnText, _resolveCooldownUsername());
        });

        amountShow.addEventListener('input', function () {
            const n = parseInt(String(this.value).replace(/\D/g, ''), 10);
            amountHidden.value = Number.isFinite(n) ? n : '';
            document.querySelectorAll('#' + PANEL_ID + ' .qris-amount-btn').forEach((b) => b.classList.remove('active'));
        });

        amountShow.addEventListener('blur', function () {
            const n = parseInt(String(this.value).replace(/\D/g, ''), 10);
            if (!Number.isFinite(n) || n <= 0) return;
            const rounded = roundAmountDown(n);
            if (!rounded) {
                this.value = '';
                amountHidden.value = '';
                return;
            }
            this.value = rounded.toLocaleString('id-ID');
            amountHidden.value = rounded;
        });

        form.addEventListener('submit', async function (e) {
            e.preventDefault();
            let amount = parseInt(amountHidden.value, 10);
            if (Number.isFinite(amount) && amount > 0) {
                amount = roundAmountDown(amount);
                amountHidden.value = amount || '';
                amountShow.value = amount ? amount.toLocaleString('id-ID') : '';
            }
            if (!amount || amount < CONFIG.MIN_AMOUNT) {
                alert('Minimal deposit ' + formatRpLabel(CONFIG.MIN_AMOUNT));
                return;
            }
            if (amount > CONFIG.MAX_AMOUNT) {
                alert('Maksimal deposit ' + formatRpLabel(CONFIG.MAX_AMOUNT));
                return;
            }
            const submitBtn = this.querySelector('.qris-submit-btn');
            const usernameForCd = _resolveCooldownUsername();
            const rem = _cooldownRemainingMs(usernameForCd);
            if (rem) {
                _applySubmitCooldown(submitBtn, btnText, usernameForCd);
                return;
            }
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
                _setLastSubmit(username, Date.now());
                _applySubmitCooldown(submitBtn, btnText, username);
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
                _applySubmitCooldown(submitBtn, btnText, _resolveCooldownUsername());
            }
        });
    }

    function bindNativeTabClicks() {
        document.addEventListener('click', function (e) {
            const t = e.target.closest(
                'a, button, [role="tab"], label, input, #qrisauto, .available-payment-account-item'
            );
            if (!t) return;
            if (isInstantTab(t)) {
                pickInstant();
                return;
            }
            const bar = findTabBar();
            if (isNativePayTarget(t) || (bar && bar.contains(t))) {
                pickNative();
                deactivateInstant();
            }
        }, true);
        document.addEventListener('change', function (e) {
            const t = e.target;
            if (!t || t.name !== 'PaymentType') return;
            if (t.id === 'payment_method_QRISINSTANT') {
                pickInstant();
                return;
            }
            pickNative();
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
        applyUrlTabPolicy();
        console.log(LOG, 'tab ready. bars=', bars.length, 'bareDeposit=', isBareDepositPath(), 'choseInstant=', _userChoseInstant);
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
    let lastPath = location.pathname;
    function watchDepositPath() {
        if (location.pathname === lastPath) return;
        lastPath = location.pathname;
        _userChoseInstant = false;
        if (document.getElementById(WRAPPER_ID)) applyUrlTabPolicy();
    }
    window.addEventListener('popstate', watchDepositPath);
    setInterval(watchDepositPath, 250);
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
