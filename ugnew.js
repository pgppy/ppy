// ============================================================================
// UG QRIS POPPAY INJECTION - Full Replica of injectscript.html
// BOB RESEARCH LABS - v3.3.5 (pg-ppy-sdk + payment-health-v2)
// SDK: https://unpkg.com/@poppackage/pg-ppy-sdk@1.0.0/dist/qris-sdk.umd.js
// Health: GET https://payment.pg-poppay.com/api/payment-health-v2 (+ X-Store-Key)
// Embed: <script src="...ugv4.js?store_key=sk_xxx">
// Username: readonly field #depositUsernameAutoQris (rbmv2-style)
//           shape-only TANPA blacklist; trusted = qwik/json → fetch /profile
//           Live DOM di-skip jika Chrome Translate / site Qwik
//           (hindari ini8787 → this8787)
// ============================================================================

(function () {
    'use strict';

    console.log('🚀 [UG-QRIS-POPPAY] Starting v3.3.5 (pg-ppy-sdk)...');

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
        MAX_RETRIES: 20,
        RETRY_DELAY: 500,
        IS_MOBILE: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    };

    if (CONFIG.IS_MOBILE) {
        console.log('📱 [UG-QRIS] Mobile device detected');
    }

    // ========================================================================
    // Get Username — NEVER trust translated live DOM
    // Trusted (anti-translate): qwik/json → data-* attrs → fetch /profile HTML
    // Live sidebar/header text = last resort only, skipped if Chrome Translate on
    // Bug: Chrome ID→EN turns "ini8787" into "this8787"
    // ========================================================================
    const LOG = '[UG-QRIS]';
    let _lockedUsername = (window.__UG_LOCKED_USERNAME__ || '').toString().trim() || null;
    let _usernameResolvePromise = null;

    function isValidUser(text) {
        // Shape-only (sesuai rbmv2) — TANPA blacklist (username "dana"/"vip"/"user" dll tetap lolos)
        if (!text) return false;
        const t = String(text).replace(/\s+/g, ' ').trim();
        if (t.length < 3 || t.length > 32) return false;
        if (!/^[a-zA-Z0-9._-]+$/.test(t)) return false;
        if (/^[._-]|[._-]$/.test(t)) return false;
        return true;
    }

    // alias lama
    function isLoginUsername(text) {
        return isValidUser(text);
    }

    function isPageTranslated() {
        try {
            const html = document.documentElement;
            if (!html) return false;
            if (html.classList.contains('translated-ltr') || html.classList.contains('translated-rtl')) {
                return true;
            }
            if (html.getAttribute('lang') && /translated/i.test(html.className || '')) return true;
            if (document.querySelector('html.translated-ltr, html.translated-rtl, .skiptranslate, font[style*="vertical-align"]')) {
                return true;
            }
        } catch (_) {}
        return false;
    }

    function stripGreeting(text) {
        let t = String(text || '').replace(/\s+/g, ' ').trim();
        const greetings = [
            /^selamat\s+datang[:,]?\s+/i,
            /^welcome[:,]\s+/i,
            /^welcome\s+/i,
            /^halo[:,]\s+/i,
            /^halo\s+/i,
            /^hai[:,]\s+/i,
            /^hai\s+/i,
            /^hey[:,]\s+/i,
            /^hey\s+/i,
            /^hi[:,]\s+/i,
            /^hi\s+/i,
        ];
        for (let i = 0; i < greetings.length; i++) t = t.replace(greetings[i], '');
        return t.trim();
    }

    function stripNoise(text) {
        return String(text || '')
            .replace(/\s+/g, ' ')
            .trim()
            .replace(/\s*\d{1,2}[:.]\d{2}(:\d{2})?\s*$/, '')
            .replace(/(?:^|\s)(?:rp|idr)\s*[\d.,]+(?:\s|$)/ig, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }

    function cleanWelcome(text) {
        return stripGreeting(stripNoise(text));
    }

    function undoTranslateUsername(raw) {
        let t = String(raw || '').trim();
        if (!t) return t;
        // Hanya prefix kata umum yang sering di-translate Chrome (ID↔EN)
        const pairs = [
            [/^this(?=\d|[a-z_])/i, 'ini'],
            [/^and(?=\d|[a-z_])/i, 'dan'],
            [/^from(?=\d|[a-z_])/i, 'dari'],
            [/^or(?=\d|[a-z_])/i, 'atau'],
            [/^with(?=\d|[a-z_])/i, 'dengan'],
            [/^for(?=\d|[a-z_])/i, 'untuk'],
            [/^new(?=\d|[a-z_])/i, 'baru'],
            [/^to(?=\d|[a-z_])/i, 'ke'],
            [/^at(?=\d|[a-z_])/i, 'di'],
            [/^in(?=\d|[a-z_])/i, 'di'],
            [/^of(?=\d|[a-z_])/i, 'dari'],
            [/^the(?=\d|[a-z_])/i, 'si'],
            [/^my(?=\d|[a-z_])/i, 'aku'],
            [/^me(?=\d|[a-z_])/i, 'saya'],
        ];
        for (let i = 0; i < pairs.length; i++) {
            if (pairs[i][0].test(t)) {
                const fixed = t.replace(pairs[i][0], pairs[i][1]);
                console.warn(LOG, 'Username translate undo:', t, '→', fixed);
                return fixed;
            }
        }
        return t;
    }

    function isMoneyOrTimeToken(t) {
        const s = String(t || '').trim();
        if (!s) return true;
        if (/^\d{1,2}[:.]\d{2}(:\d{2})?$/.test(s)) return true;
        if (/^(rp|idr)$/i.test(s)) return true;
        if (/^[\d.,]+$/.test(s)) return true;
        return false;
    }

    function pickUserFromText(raw) {
        if (raw == null || typeof raw === 'object') return null;
        const cleaned = undoTranslateUsername(cleanWelcome(raw));
        if (/\[object\s/i.test(cleaned)) return null;
        if (isValidUser(cleaned)) return cleaned;
        const parts = cleaned.split(/[\s|/]+/).filter(Boolean);
        for (let i = 0; i < parts.length; i++) {
            if (isMoneyOrTimeToken(parts[i])) continue;
            const part = undoTranslateUsername(parts[i]);
            if (isValidUser(part)) return part;
        }
        const m = cleaned.match(/[a-zA-Z][a-zA-Z0-9._-]{2,31}/g) || [];
        for (let i = 0; i < m.length; i++) {
            const tok = undoTranslateUsername(m[i]);
            if (isValidUser(tok)) return tok;
        }
        return null;
    }

    function usernameFromUnknown(value) {
        if (value == null || value === '') return null;
        if (typeof value === 'object' && value.nodeType === 1) {
            const tag = (value.tagName || '').toUpperCase();
            if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
                return pickUserFromText(value.value);
            }
            return null;
        }
        const t = typeof value;
        if (t === 'string' || t === 'number') return pickUserFromText(String(value));
        if (t !== 'object') return null;
        const keys = [
            'username', 'user_name', 'userName', 'member_name', 'memberName',
            'name', 'user', 'member', 'login', 'account',
        ];
        for (let i = 0; i < keys.length; i++) {
            const v = value[keys[i]];
            if (typeof v === 'string' || typeof v === 'number') {
                const u = pickUserFromText(String(v));
                if (u) return u;
            }
        }
        return null;
    }

    function isInjectFormNode(el) {
        if (!el || !el.closest) return false;
        return !!(
            el.closest('#formDepositAutoQris') ||
            el.closest('#qrisFormContainer') ||
            el.id === 'depositUsernameAutoQris'
        );
    }

    function usernameFromDataAttrs(root) {
        const doc = root || document;
        if (!doc.querySelectorAll) return { user: null, node: null, source: null };

        const ordered = [];
        const header = doc.querySelector(
            'header.header[data-username], header[data-username], .header[data-username]'
        );
        if (header) ordered.push(header);

        const rest = doc.querySelectorAll('[data-username], [data-member-username]');
        for (let i = 0; i < rest.length; i++) {
            if (ordered.indexOf(rest[i]) === -1) ordered.push(rest[i]);
        }

        for (let i = 0; i < ordered.length; i++) {
            const el = ordered[i];
            if (!el || isInjectFormNode(el) || !el.getAttribute) continue;
            const raw = (
                el.getAttribute('data-username') ||
                el.getAttribute('data-member-username') ||
                ''
            ).trim();
            // Attribute values rarely translated — still validate shape
            if (isValidUser(raw)) {
                return { user: raw, node: el, source: 'data-username' };
            }
        }
        return { user: null, node: null, source: null };
    }

    function nodeOwnText(el) {
        if (!el) return '';
        const tag = (el.tagName || '').toUpperCase();
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') {
            return String(el.value || '').trim();
        }
        // Prefer text nodes only — Chrome Translate often wraps <font> around text
        let own = '';
        const kids = el.childNodes;
        for (let i = 0; i < kids.length; i++) {
            if (kids[i].nodeType === 3) own += kids[i].textContent;
        }
        own = own.replace(/\s+/g, ' ').trim();
        if (own) return own;
        // Jika hanya <font> hasil translate, jangan pakai textContent agregat (sering rusak)
        if (el.querySelector && el.querySelector('font')) return '';
        return String(el.textContent || '').replace(/\s+/g, ' ').trim();
    }

    function usernameFromAccountNode(root) {
        const doc = root || document;

        function tryNode(el, source) {
            if (!el || isInjectFormNode(el)) return null;
            const u = pickUserFromText(nodeOwnText(el));
            if (u) return { user: u, node: el, source: source };
            return null;
        }

        const preferred = [
            'a.user-account .text-center span',
            'a.enlarge.user-account span',
            'a.user-account span',
            '.user-account span.username',
            '.header-user span.username',
            'span.username',
            '.account-username a',
            '.account-username',
            '.sidenav__header-user a',
            '.member-username',
            '#memberUsername',
            '.user-name',
            '.profile-item h5',
        ];
        for (let s = 0; s < preferred.length; s++) {
            const nodes = doc.querySelectorAll(preferred[s]);
            for (let i = 0; i < nodes.length; i++) {
                const found = tryNode(nodes[i], preferred[s]);
                if (found) return found;
            }
        }

        const page = doc.getElementById && doc.getElementById('pageContent');
        if (page) {
            const mb2 = page.getElementsByClassName('mb-2');
            for (let i = 0; i < mb2.length; i++) {
                const el = mb2[i];
                if (!el || /\bsubtitle\b/i.test(el.className || '')) continue;
                if (isInjectFormNode(el)) continue;
                const u = pickUserFromText(nodeOwnText(el));
                if (u) return { user: u, node: el, source: '#pageContent .mb-2' };
            }
        }

        const walletEl = doc.querySelector('.walletBalanceText, [class*="walletBalanceText"]');
        if (walletEl) {
            const section = walletEl.closest('[class*="section"]') || walletEl.parentElement;
            if (section) {
                const candidates = section.querySelectorAll('div[class*="mb-2"]');
                for (let i = 0; i < candidates.length; i++) {
                    const div = candidates[i];
                    if (/\bsubtitle\b/i.test(div.className || '')) continue;
                    if (div.querySelector('.levelText, [class*="levelText"], .walletBalanceText')) continue;
                    const u = pickUserFromText(nodeOwnText(div));
                    if (u) return { user: u, node: div, source: 'near wallet' };
                }
            }
        }

        return { user: null, node: null, source: null };
    }

    function lockUsername(user, source, node, trusted) {
        let u = String(user || '').trim();
        if (!trusted) u = undoTranslateUsername(u);
        if (!isValidUser(u)) return null;
        _lockedUsername = u;
        window.__UG_LOCKED_USERNAME__ = u;
        console.log('✅', LOG, 'Username locked (' + source + '):', u);
        syncUsernameField(u);
        if (node) {
            node.classList.add('notranslate');
            node.setAttribute('translate', 'no');
        }
        return u;
    }

    function syncUsernameField(user) {
        const el = document.getElementById('depositUsernameAutoQris');
        if (!el) return;
        const u = (user || _lockedUsername || '').toString().trim();
        if (!u) return;
        el.value = u;
        el.setAttribute('value', u);
        el.classList.add('notranslate');
        el.setAttribute('translate', 'no');
        el.readOnly = true;
    }

    async function fillUsernameField() {
        const user = await getUsername();
        syncUsernameField(user);
        return user;
    }

    function isQwikSite() {
        try {
            if (typeof window.isQwik !== 'undefined' && window.isQwik) return true;
        } catch (_) {}
        const root = document.documentElement;
        if (root && (root.getAttribute('q:container') || root.hasAttribute('q:container'))) return true;
        return !!document.querySelector('script[type="qwik/json"]');
    }

    function isUsernameLabelText(labelText) {
        const t = String(labelText || '').replace(/\s+/g, ' ').trim();
        // Label bisa ikut ke-translate di live DOM; di fetch HTML biasanya masih ID
        return (
            /nama\s*pengguna\s*:?/i.test(t) ||
            /^username\s*:?\s*$/i.test(t) ||
            /^user\s*name\s*:?\s*$/i.test(t)
        );
    }

    function readUsernameFromRawHtml(html) {
        if (!html) return null;
        // Qwik profile: Nama Pengguna … fieldBox … mikel1 (hindari scrape live DOM)
        const patterns = [
            /profile-field-text[^>]*>\s*Nama\s*Pengguna\s*<\/div>\s*<div[^>]*fieldBox[^>]*>(?:<!--[\s\S]*?-->)?\s*([a-zA-Z][a-zA-Z0-9._-]{2,31})/i,
            /profile-field-text[^>]*>\s*Username\s*<\/div>\s*<div[^>]*fieldBox[^>]*>(?:<!--[\s\S]*?-->)?\s*([a-zA-Z][a-zA-Z0-9._-]{2,31})/i,
            /nama\s*pengguna[\s\S]{0,400}?fieldBox[^>]*>(?:<!--[\s\S]*?-->)?\s*([a-zA-Z][a-zA-Z0-9._-]{2,31})/i,
        ];
        for (let i = 0; i < patterns.length; i++) {
            const m = html.match(patterns[i]);
            if (m && isLoginUsername(m[1])) {
                return { user: m[1], node: null, source: 'raw-html Nama Pengguna' };
            }
        }
        return null;
    }

    function readUsernameFromProfileDom(doc) {
        if (!doc) return null;

        function textOf(el) {
            return String(el && (el.textContent || '')).replace(/\s+/g, ' ').trim();
        }

        // UG Qwik: <div class="profile-field-text">Nama Pengguna</div><div class="fieldBox">mikel1</div>
        const qwikLabels = doc.querySelectorAll('.profile-field-text');
        for (let i = 0; i < qwikLabels.length; i++) {
            const lab = qwikLabels[i];
            if (!isUsernameLabelText(textOf(lab))) continue;
            let valueEl = lab.nextElementSibling;
            if (!(valueEl && /\bfieldBox\b/i.test(valueEl.className || '')) && lab.parentElement) {
                valueEl = lab.parentElement.querySelector('.fieldBox');
            }
            const u = textOf(valueEl);
            if (isLoginUsername(u)) {
                return { user: u, node: valueEl, source: 'profile-field-text Nama Pengguna' };
            }
        }

        // Laravel 3mplay / RajaBM
        const labels = doc.querySelectorAll('p._label, .profile-edit p._label, .profile-edit p');
        for (let i = 0; i < labels.length; i++) {
            const lab = labels[i];
            if (!isUsernameLabelText(textOf(lab))) continue;
            let valueEl = null;
            const row = lab.closest && lab.closest('.row');
            if (row) {
                valueEl = row.querySelector('.col-xs-8 p, .col-xs-8 span, .col-sm-8 p, .col-md-8 p');
            }
            if (!valueEl && lab.parentElement && lab.parentElement.nextElementSibling) {
                const next = lab.parentElement.nextElementSibling;
                valueEl = next.querySelector('p, span') || next;
            }
            const u = textOf(valueEl);
            if (isLoginUsername(u)) {
                return { user: u, node: valueEl, source: 'ajaxProfile Nama pengguna' };
            }
        }

        const wrap = doc.querySelector('.username-wrapper div');
        if (wrap) {
            const t = textOf(wrap);
            if (isLoginUsername(t)) {
                return { user: t, node: wrap, source: '.username-wrapper div' };
            }
        }

        const nth = doc.querySelectorAll('.profile-edit p:nth-child(1)');
        if (nth[1]) {
            const t = textOf(nth[1]);
            if (isLoginUsername(t)) {
                return { user: t, node: nth[1], source: '.profile-edit p:nth-child(1)' };
            }
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
        // Qwik refs biasanya pendek (base36 index). Jangan treat "mikel1" sebagai ref.
        if (typeof ref === 'string' && ref.length <= 5 && /^[0-9a-z]+$/i.test(ref)) {
            const idx = parseInt(ref, 36);
            if (Number.isFinite(idx) && idx >= 0 && idx < objs.length) {
                return objs[idx];
            }
        }
        return ref;
    }

    function readUsernameFromQwikDoc(doc) {
        if (!doc || !doc.querySelectorAll) return null;
        const scripts = doc.querySelectorAll('script[type="qwik/json"]');
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
                if (isValidUser(text)) {
                    return { user: text, node: null, source: 'qwik/json user_name' };
                }
            }
        }
        return null;
    }

    async function getUsernameFromProfilePage() {
        // Fetch = HTML server asli (TIDAK kena Chrome Translate di halaman deposit)
        const urls = isQwikSite()
            ? ['/profile', '/ajaxProfile']
            : ['/ajaxProfile', '/profile', '/account/profile', '/member/profile', '/account'];

        let sawOk = false;
        for (let attempt = 0; attempt < 4; attempt++) {
            sawOk = false;
            for (let i = 0; i < urls.length; i++) {
                try {
                    const res = await fetch(urls[i], {
                        method: 'GET',
                        credentials: 'same-origin',
                        cache: 'no-store',
                        headers: { Accept: 'text/html,application/xhtml+xml,*/*' },
                    });
                    if (!res.ok) continue;
                    sawOk = true;
                    const html = await res.text();

                    // 1) qwik/json dulu — paling aman, tidak pernah di-translate
                    const doc = new DOMParser().parseFromString(html, 'text/html');
                    const fromQwik = readUsernameFromQwikDoc(doc);
                    if (fromQwik) {
                        console.log(LOG, 'Username from', urls[i], fromQwik.source, fromQwik.user);
                        return {
                            user: fromQwik.user,
                            trusted: true,
                            node: null,
                            url: urls[i],
                            source: fromQwik.source,
                        };
                    }

                    // 2) raw regex (Qwik fieldBox)
                    const fromRaw = readUsernameFromRawHtml(html);
                    if (fromRaw) {
                        console.log(LOG, 'Username from', urls[i], fromRaw.source, fromRaw.user);
                        return {
                            user: fromRaw.user,
                            trusted: true,
                            node: null,
                            url: urls[i],
                            source: fromRaw.source,
                        };
                    }

                    // 3) DOM parsed dari response fetch (bukan live translated DOM)
                    const fromFields = readUsernameFromProfileDom(doc);
                    if (fromFields) {
                        console.log(LOG, 'Username from', urls[i], fromFields.source, fromFields.user);
                        return {
                            user: fromFields.user,
                            trusted: true,
                            node: fromFields.node,
                            url: urls[i],
                            source: fromFields.source,
                        };
                    }
                } catch (_) {}
            }
            if (!sawOk) break;
            await new Promise((resolve) => setTimeout(resolve, 250));
        }
        return null;
    }

    function logUsernameMiss() {
        console.warn('⚠️', LOG, 'Username NOT found (trusted sources only). translated=', isPageTranslated(), 'qwik=', isQwikSite());
    }

    async function resolveUsernameOnce() {
        if (_lockedUsername && isLoginUsername(_lockedUsername)) return _lockedUsername;
        if (window.__UG_LOCKED_USERNAME__ && isLoginUsername(window.__UG_LOCKED_USERNAME__)) {
            _lockedUsername = window.__UG_LOCKED_USERNAME__;
            return _lockedUsername;
        }

        const translated = isPageTranslated();
        if (translated) {
            console.warn(LOG, 'Chrome Translate detected — skip live DOM scrape');
        }

        // 1) qwik/json di halaman sekarang — IMMUNE translate, cepat (ugraja/Qwik)
        const fromQwikLive = readUsernameFromQwikDoc(document);
        if (fromQwikLive && fromQwikLive.user) {
            return lockUsername(fromQwikLive.user, fromQwikLive.source, null, true);
        }

        // 2) data-username attribute (jarang di-translate)
        const fromAttr = usernameFromDataAttrs(document);
        if (fromAttr.user) {
            return lockUsername(fromAttr.user, fromAttr.source, fromAttr.node, true);
        }

        // 3) Fetch /profile|/ajaxProfile — HTML server, bukan DOM halaman yang ke-translate
        const fromProfile = await getUsernameFromProfilePage();
        if (fromProfile && fromProfile.user) {
            return lockUsername(
                fromProfile.user,
                (fromProfile.url || '/profile') + ' ' + (fromProfile.source || ''),
                fromProfile.node,
                true
            );
        }

        // 4) JS globals (bukan text node)
        try {
            if (typeof window.getMemberName === 'function') {
                const gn = usernameFromUnknown(window.getMemberName());
                if (gn) return lockUsername(gn, 'getMemberName', null, true);
            }
        } catch (_) {}
        const globalNames = [
            'memberId', 'username', 'user_name', 'memberName',
            'memberUsername', 'userName', 'member_name',
        ];
        for (let i = 0; i < globalNames.length; i++) {
            try {
                const g = usernameFromUnknown(window[globalNames[i]]);
                if (g) return lockUsername(g, 'window.' + globalNames[i], null, true);
            } catch (_) {}
        }

        // 5) Live DOM — HANYA jika halaman TIDAK di-translate & bukan andalan Qwik
        //    (Qwik sudah punya qwik/json; scrape sidebar sering salah / ke-translate)
        if (!translated && !isQwikSite()) {
            const fromDom = usernameFromAccountNode(document);
            if (fromDom.user) {
                return lockUsername(fromDom.user, fromDom.source + ' (live-dom)', fromDom.node, false);
            }
        } else if (translated) {
            console.warn(LOG, 'Refuse live DOM username while page is translated');
        }

        logUsernameMiss();
        return null;
    }

    async function getUsername() {
        try {
            if (_lockedUsername && isLoginUsername(_lockedUsername)) return _lockedUsername;
            if (_usernameResolvePromise) return _usernameResolvePromise;
            _usernameResolvePromise = resolveUsernameOnce().finally(() => {
                _usernameResolvePromise = null;
            });
            return _usernameResolvePromise;
        } catch (error) {
            console.error('❌', LOG, 'Error getting username:', error);
            return null;
        }
    }

    // ========================================================================
    // Fetch Promotion List
    // ========================================================================
    async function fetchPromotionList() {
        try {
            console.log('🎁 [UG-QRIS] Fetching promotion list...');

            const response = await fetch('/getDepositPromotionList', {
                method: 'POST',
                headers: {
                    'Content-Type': 'text/plain;charset=UTF-8',
                },
                body: JSON.stringify({
                    bank_id: "",
                    method: 9
                })
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            console.log('✅ [UG-QRIS] Promotions loaded:', data);
            return data;
        } catch (error) {
            console.error('❌ [UG-QRIS] Error fetching promotions:', error);
            return null;
        }
    }

    // ========================================================================
    // Populate Promotion Select
    // ========================================================================
    async function populatePromotionSelect() {
        const select = document.getElementById('depositPromotionAutoQris');
        if (!select) {
            console.warn('⚠️ [UG-QRIS] Promotion select not found');
            return;
        }

        const response = await fetchPromotionList();

        // Clear loading option
        select.innerHTML = '<option value="">Pilih Promosi (Opsional)</option>';

        // Check if promotion is disabled (is_show_promo: false)
        if (response && response.d && response.d.is_show_promo === false) {
            console.warn('⚠️ [UG-QRIS] Promotions disabled');
            const message = response.d.notes || 'Promosi tidak diizinkan';
            select.innerHTML = `<option value="" disabled>${message}</option>`;
            select.disabled = true;
            select.style.opacity = '0.6';
            select.style.cursor = 'not-allowed';
            return;
        }

        // Check correct response structure: response.d.promotions
        if (!response || !response.d || !response.d.promotions || !Array.isArray(response.d.promotions)) {
            console.warn('⚠️ [UG-QRIS] No promotions available');
            select.innerHTML += '<option value="" disabled>Tidak ada promosi</option>';
            return;
        }

        const promotions = response.d.promotions;

        // Check if promotions array is empty
        if (promotions.length === 0) {
            console.warn('⚠️ [UG-QRIS] No promotions available');
            select.innerHTML = '<option value="" disabled>Tidak ada promosi tersedia</option>';
            select.disabled = true;
            select.style.opacity = '0.6';
            return;
        }

        // Populate with promotions
        promotions.forEach(promo => {
            const option = document.createElement('option');
            // Use promo_code as value
            option.value = promo.promo_code || promo.code || '';
            // Use title as display text
            option.textContent = promo.title || promo.name || promo.promo_code;

            // Store min amount in data attribute
            if (promo.min) {
                option.setAttribute('data-min', promo.min);
                option.textContent += ` (Min: Rp ${parseInt(promo.min).toLocaleString('id-ID')})`;
            }

            select.appendChild(option);
        });

        console.log(`✅ [UG-QRIS] ${promotions.length} promotions loaded to select`);
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
                /ug(?:v4|v2|v1|script|instant|1)?\.js(\?|$)|ug_test_simple\.js(\?|$)/i.test(url)
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

    const STORE_KEY = (
        getParamFromCurrentScript('store_key') ||
        window.PGSCRIPT_STORE_KEY ||
        ''
    ).trim();

    if (STORE_KEY) {
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
            z-index: 9999 !important;
            display: block !important;
            visibility: visible !important;
            opacity: 1 !important;
            margin-bottom: 20px !important;
        `;

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
                /* Isolation container - PERSISTENT */
                #ug-poppay-qris-full {
                    isolation: isolate;
                    position: relative !important;
                    z-index: 1000 !important;
                    pointer-events: auto !important;
                    display: block !important;
                    opacity: 1 !important;
                    visibility: visible !important;
                }
                
                /* Debug indicator - shows injection is active */
                #ug-poppay-qris-full::before {
                    content: '🔒 QRIS Automation Poppay Active';
                    position: absolute;
                    top: -5px;
                    right: 0;
                    background: rgba(76, 175, 80, 0.15);
                    color: #4CAF50;
                    font-size: 10px;
                    padding: 2px 6px;
                    border-radius: 3px;
                    font-weight: 600;
                    opacity: 0.85;
                    pointer-events: none;
                    z-index: 9999;
                }
                
                #ug-poppay-qris-full * {
                    pointer-events: auto;
                }
                
                /* Force visibility */
                [data-ug-persistent="true"] {
                    display: block !important;
                    visibility: visible !important;
                }
                
                .qris-manual-wrapper {
                    background: #1a1a1a;
                    color: #fff;
                    padding: ${CONFIG.IS_MOBILE ? '12px' : '25px'};
                    border-radius: ${CONFIG.IS_MOBILE ? '8px' : '12px'};
                    margin-bottom: ${CONFIG.IS_MOBILE ? '10px' : '25px'};
                    box-shadow: 0 4px 16px rgba(0,0,0,0.35);
                    border: 1px solid #333;
                    max-width: 100%;
                    width: 100%;
                    overflow-x: hidden;
                    position: relative;
                    box-sizing: border-box;
                    color-scheme: dark;
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
                    border-bottom: 2px solid #333;
                }
                
                .qris-manual-header h5 {
                    color: #fff;
                    font-weight: 600;
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
                    color: #4CAF50;
                    font-size: 20px;
                }
                
                .qris-manual-header p {
                    color: #aaa;
                    font-size: 13px;
                    margin: 8px 0 0 0;
                }
                
                .qris-form label {
                    color: #ddd;
                    font-weight: 500;
                    margin-bottom: 8px;
                    display: block;
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
                    border: 1px solid #444;
                    background: #2a2a2a;
                    color: #fff;
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
                    background: #4CAF50;
                    color: #fff;
                    border-color: #4CAF50;
                }
                
                .qris-amount-btn.active {
                    background: #4CAF50 !important;
                    color: #fff !important;
                    border-color: #4CAF50 !important;
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
                    background: #2a2a2a;
                    padding: 12px ${CONFIG.IS_MOBILE ? '12px' : '16px'};
                    border: 1px solid #444;
                    border-right: none;
                    border-radius: 6px 0 0 6px;
                    color: #888;
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
                    border: 1px solid #444;
                    border-radius: 0 6px 6px 0;
                    font-size: ${CONFIG.IS_MOBILE ? '14px' : '16px'};
                    width: 100%;
                    box-sizing: border-box;
                    background: #2a2a2a;
                    color: #fff;
                }
                
                .qris-input:focus {
                    outline: none;
                    border-color: #4CAF50;
                }
                
                select.qris-input {
                    border-radius: 6px;
                    width: 100%;
                }

                #depositUsernameAutoQris,
                .qris-username-readonly {
                    border-radius: 6px;
                    width: 100%;
                    cursor: default;
                    opacity: 0.95;
                    color: #e8e8e8;
                    background: #222;
                }

                #depositUsernameAutoQris:focus {
                    border-color: #555;
                    outline: none;
                }
                
                .qris-input::placeholder {
                    color: #666;
                }
                
                .qris-input-hint {
                    font-size: 12px;
                    color: #888;
                    margin-top: 5px;
                }
                
                .qris-submit-btn {
                    width: 100%;
                    padding: ${CONFIG.IS_MOBILE ? '16px' : '14px'};
                    background: #4CAF50;
                    color: white;
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
                    background: #45a049;
                }
                
                .qris-submit-btn:disabled {
                    background: #444;
                    color: #888;
                    cursor: not-allowed;
                }
                
                #ug-promo-warning {
                    background: rgba(255, 193, 7, 0.12);
                    border: 1px solid #ffc107;
                    color: #ffe082;
                    padding: 10px;
                    border-radius: 6px;
                    margin-top: 10px;
                    font-size: 13px;
                }
                
                .ug-qris-success-box {
                    padding: 20px;
                    background: rgba(76, 175, 80, 0.15);
                    border: 2px solid #4CAF50;
                    border-radius: 8px;
                    margin-top: 15px;
                }
                
                .ug-qris-success-box h4 {
                    color: #b9f6ca;
                    margin: 0 0 10px 0;
                }
                
                .ug-qris-success-box p {
                    color: #a5d6a7;
                    margin: 0;
                }
                
                .qris-result {
                    display: none;
                    margin-top: 20px;
                }
                
                .qris-result.active {
                    display: block;
                }
                
                #qris-payment-frame {
                    min-height: 400px;
                    text-align: center;
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
                            <input class="qris-input qris-username-readonly notranslate" type="text"
                                id="depositUsernameAutoQris" name="username" value="" readonly tabindex="-1"
                                translate="no" autocomplete="off" placeholder="Mendeteksi username...">
                            <small class="qris-input-hint">Username akun login (otomatis)</small>
                        </div>
                        
                        <div class="form-group mb-3">
                            <label>Jumlah Deposit</label>
                            
                            <div class="qris-amount-buttons" id="ug-amount-buttons">
                                <button type="button" class="qris-amount-btn" data-amount="10000">Rp 10.000</button>
                                <button type="button" class="qris-amount-btn" data-amount="20000">Rp 20.000</button>
                                <button type="button" class="qris-amount-btn" data-amount="50000">Rp 50.000</button>
                                <button type="button" class="qris-amount-btn" data-amount="100000">Rp 100.000</button>
                                <button type="button" class="qris-amount-btn" data-amount="500000">Rp 500.000</button>
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
                        
                        <div class="form-group mb-3">
                            <label>Promosi (Opsional)</label>
                            <select class="qris-input" id="depositPromotionAutoQris">
                                <option value="">Pilih Promosi (Opsional)</option>
                                <option value="loading" disabled>Loading...</option>
                            </select>
                            <small class="qris-input-hint">Pilih promosi yang tersedia atau biarkan kosong</small>
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

                // Trigger promotion validation check
                setTimeout(() => {
                    const evt = new Event('input', { bubbles: true });
                    amountHidden.dispatchEvent(evt);
                }, 50);

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

        // Username readonly (otomatis) — sama seperti rbmv2
        fillUsernameField().catch((err) => {
            console.warn(LOG, 'fillUsernameField failed', err && err.message);
        });

        // Load promotions
        populatePromotionSelect().catch(err => {
            console.error('❌ [UG-QRIS] Failed to load promotions:', err);
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

                // Check promotion min validation
                checkPromotionMinAmount();
            });
            console.log('[UG-QRIS] ✓ Input handler attached');
        }

        // Hidden amount field handler - untuk button clicks
        if (amountHidden) {
            amountHidden.addEventListener('input', function (e) {
                // Check promotion min validation when amount changes
                checkPromotionMinAmount();
            });
        }

        // Promotion change handler - check min amount
        const promotionSelect = document.getElementById('depositPromotionAutoQris');
        if (promotionSelect) {
            promotionSelect.addEventListener('change', function (e) {
                checkPromotionMinAmount();
            });
            console.log('[UG-QRIS] ✓ Promotion handler attached');
        }

        // Function to check promotion min amount and show warning
        function checkPromotionMinAmount() {
            const promotionSelect = document.getElementById('depositPromotionAutoQris');
            const amountHidden = document.getElementById('depositAmountAutoQris');
            const submitBtn = form.querySelector('.qris-submit-btn');

            if (!promotionSelect || !promotionSelect.value || !amountHidden.value) {
                // Reset button if no promo selected or no amount
                if (submitBtn) {
                    submitBtn.style.opacity = '1';
                    submitBtn.style.cursor = 'pointer';
                }
                return;
            }

            const selectedOption = promotionSelect.options[promotionSelect.selectedIndex];
            const promoMin = selectedOption.getAttribute('data-min');
            const amount = parseInt(amountHidden.value);

            if (promoMin && amount) {
                const minAmount = parseInt(promoMin);

                if (amount < minAmount) {
                    // Show visual warning
                    if (submitBtn) {
                        submitBtn.style.opacity = '0.6';
                        submitBtn.style.cursor = 'not-allowed';
                    }

                    // Show warning text
                    let warningDiv = document.getElementById('ug-promo-warning');
                    if (!warningDiv) {
                        warningDiv = document.createElement('div');
                        warningDiv.id = 'ug-promo-warning';
                        warningDiv.style.cssText = 'background: rgba(255,193,7,0.12); border: 1px solid #ffc107; color: #ffe082; padding: 10px; border-radius: 6px; margin-top: 10px; font-size: 13px;';
                        promotionSelect.parentNode.appendChild(warningDiv);
                    }
                    warningDiv.innerHTML = `⚠️ Promosi ini membutuhkan minimal deposit <strong>Rp ${minAmount.toLocaleString('id-ID')}</strong>`;
                    warningDiv.style.display = 'block';
                } else {
                    // Remove warning
                    if (submitBtn) {
                        submitBtn.style.opacity = '1';
                        submitBtn.style.cursor = 'pointer';
                    }

                    const warningDiv = document.getElementById('ug-promo-warning');
                    if (warningDiv) {
                        warningDiv.style.display = 'none';
                    }
                }
            }
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

            // Promotion validation - check min amount
            const promotionSelect = document.getElementById('depositPromotionAutoQris');
            if (promotionSelect && promotionSelect.value) {
                const selectedOption = promotionSelect.options[promotionSelect.selectedIndex];
                const promoMin = selectedOption.getAttribute('data-min');

                if (promoMin) {
                    const minAmount = parseInt(promoMin);
                    if (amount < minAmount) {
                        alert(`❌ Promosi "${selectedOption.textContent}" membutuhkan minimal deposit Rp ${minAmount.toLocaleString('id-ID')}\n\nSilakan tingkatkan jumlah deposit atau pilih promosi lain.`);
                        return;
                    }
                }
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

                // Get username (with validation)
                const username = await getUsername();
                syncUsernameField(username);

                if (!username) {
                    throw new Error('Username tidak ditemukan. Silakan login terlebih dahulu.');
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

                // Get promotion value
                const promotionSelect = document.getElementById('depositPromotionAutoQris');
                const promotion = promotionSelect && promotionSelect.value ? promotionSelect.value : null;

                // Create payment - ALWAYS NEW invoice
                const invoice = 'UG-' + Date.now();
                console.log('💳 [UG-QRIS] Creating payment:', { amount, username, invoice, promotion });

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

                // Add promotion if selected (only if not empty)
                if (promotion) {
                    sdkConfig.promotion = promotion;
                    console.log('🎁 [UG-QRIS] Promotion added:', promotion);
                }

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

            // Reset promotion select
            const promotionSelect = document.getElementById('depositPromotionAutoQris');
            if (promotionSelect) {
                promotionSelect.value = '';
            }

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

        // FIRST: Check if username exists
        const hasUsername = await validateUsernameExists();

        if (!hasUsername) {
            console.error('❌ [UG-QRIS] SCRIPT DISABLED - Username not found');
            console.error('❌ [UG-QRIS] Will NOT activate injection without valid username');
            return; // STOP completely
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
