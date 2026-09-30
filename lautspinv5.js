// ============================================================================
// UG QRIS POPPAY INJECTION - lautspinv3.js (basis ugv6)
// BOB RESEARCH LABS - v6.2.6 (store_key aktif lagi: wajib & dikirim ke SDK; payment-health masih di-skip: SKIP_PAYMENT_HEALTH; popup selalu di tengah layar; form jadi popup layar penuh + kartu buka ulang; cek payment-health baru sebelum QR; tanpa blacklist kata; timeout fetch profil 8s; hapus wl_v2 aksesbayar dulu; username hanya dari sumber kebal Translate: /profile|/ajaxProfile (wajib label "Nama Pengguna") → Qwik JSON → getMemberName; teks DOM tidak dipakai; cek ulang profil sebelum QR)
// SDK: https://unpkg.com/@poppackage/pg-ppy-sdk@1.0.0/dist/qris-sdk.umd.js
// Health: GET https://payment.pg-poppay.com/api/payment-health-v2 (+ X-Store-Key)
// Embed: <script src="...ugv6.js?store_key=sk_xxx&min_depo=10000&max_depo=10000000&buttons=10000,50000,100000,500000"></script>
// Username: GET /ajaxProfile (/profile kalau Qwik) retry 300ms, hanya nilai berlabel Nama Pengguna/Username → Qwik user_name → getMemberName(); tidak ada → form tidak dipasang
// Theme: jajanwin pink default; spinlaut/lautspin ocean (dark + biru site) — form z-index rendah supaya popup QRIS site/SDK di atas
// ============================================================================

(function () {
    'use strict';

    console.log('🚀 [UG-QRIS-POPPAY] Starting lautspinv3 v6.2.6 (username via profile like pglain)...');

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
        AMOUNT_BUTTONS: [10000, 50000, 100000, 200000, 500000],
        MAX_RETRIES: 20,
        RETRY_DELAY: 500,
        IS_MOBILE: /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
    };

    if (CONFIG.IS_MOBILE) {
        console.log('📱 [UG-QRIS] Mobile device detected');
    }

    // ========================================================================
    // Hapus QRIS pihak lain (https://aksesbayar.com/wl/wl_v2.js) sebelum form kita dipasang.
    // wl_v2 menambah: popup #auto-qris-wrapper (di <html>, z-index 9999), tombol button.qr-btn
    // "QRIS INSTANT" (Qwik), kotak #qrisauto (.methods_form), dan CSS global .qris-input/.qris-btn
    // (!important) yang bentrok dengan class form kita. Bisa jalan sebelum/sesudah script ini → diawasi terus.
    // ========================================================================
    const FOREIGN_QRIS_STYLE_MARKERS = ['#auto-qris-wrapper', '.qris-modal-container', '.qr-btn', 'color-scheme: light only'];
    const FOREIGN_QRIS_SELECTOR = '#auto-qris-wrapper, button.qr-btn, #qrisauto, script[src*="aksesbayar.com/wl/"]';

    function removeForeignQris() {
        let removed = 0;
        document.querySelectorAll('#auto-qris-wrapper').forEach((el) => { el.remove(); removed++; });
        document.querySelectorAll('button.qr-btn').forEach((el) => {
            if (/qris\s*instant/i.test(el.textContent || '')) { el.remove(); removed++; }
        });
        document.querySelectorAll('#qrisauto').forEach((el) => {
            (el.closest('.box-wrapper') || el).remove();
            removed++;
        });
        document.querySelectorAll('style').forEach((st) => {
            if (st.id === 'ug-block-foreign-qris') return;
            const css = st.textContent || '';
            if (FOREIGN_QRIS_STYLE_MARKERS.some((m) => css.includes(m))) { st.remove(); removed++; }
        });
        document.querySelectorAll('script[src*="aksesbayar.com/wl/"]').forEach((s) => { s.remove(); removed++; });
        if (removed) console.log(`🧹 [UG-QRIS] wl_v2 (aksesbayar) dihapus: ${removed} elemen`);
        return removed;
    }

    // Tidak boleh melempar error: kalau gagal, script utama (form QRIS kita) tetap harus jalan.
    function startForeignQrisGuard() {
        try {
            if (window.__UG_FOREIGN_QRIS_GUARD__) return;
            const root = document.documentElement;
            if (!root) {
                setTimeout(startForeignQrisGuard, 10);
                return;
            }
            window.__UG_FOREIGN_QRIS_GUARD__ = true;
            const block = document.createElement('style');
            block.id = 'ug-block-foreign-qris';
            block.textContent = '#auto-qris-wrapper, button.qr-btn, #qrisauto { display: none !important; }';
            (document.head || root).appendChild(block);
            removeForeignQris();
            new MutationObserver((mutations) => {
                try {
                    let hit = false;
                    for (let i = 0; i < mutations.length && !hit; i++) {
                        const added = mutations[i].addedNodes;
                        for (let j = 0; j < added.length; j++) {
                            if (added[j].nodeName === 'STYLE' || added[j].nodeName === 'SCRIPT') { hit = true; break; }
                        }
                    }
                    if (hit || document.querySelector(FOREIGN_QRIS_SELECTOR)) removeForeignQris();
                } catch (_) {}
            }).observe(root, { childList: true, subtree: true });
        } catch (e) {
            console.warn('[UG-QRIS] Guard wl_v2 gagal (form tetap jalan):', e);
        }
    }

    startForeignQrisGuard();

    // ========================================================================
    // Get Username (STRICT MODE) — lock once, kebal Chrome/Safari/Edge Translate
    // Bug lama: teks sidebar yang diterjemahkan ("ini8787" → "this8787", "Withdraw" → "dengandraw")
    // ========================================================================
    // Key privat: jangan pakai __UG_LOCKED_USERNAME__ yang bisa sudah diisi ugv6 versi lama (mis. "dengandraw").
    const LOCK_KEY = '__UG_LAUTSPIN_USER__';
    let _lockedUsername = null;
    let _lockedSource = null;
    try {
        const prev = window[LOCK_KEY];
        if (prev && typeof prev === 'object' && prev.user && prev.source && !/mb-2/.test(String(prev.source))) {
            _lockedUsername = String(prev.user).trim() || null;
            _lockedSource = String(prev.source);
        }
    } catch (_) {}

    // Jangan pernah menebak "un-translate" username (with→dengan dsb): "Withdraw" jadi "dengandraw",
    // "orange77" jadi "atauange77". Hanya sumber yang tidak ikut diterjemahkan yang dipakai
    // (fetch /profile, Qwik JSON, getMemberName()).
    // Tanpa blacklist kata: semua sumber adalah field username resmi, dan username sah seperti
    // "member", "silver", "dengan", "deposit" tidak boleh ditolak (aturan lautspin: 6-12 huruf/angka).
    function isValidUser(text) {
        if (!text) return false;
        const t = String(text).trim();
        if (t.length < 3 || t.length > 24) return false;
        return /^[a-zA-Z0-9_]+$/.test(t);
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
        if (typeof ref === 'string' && /^[0-9a-z]+$/i.test(ref)) {
            const idx = parseInt(ref, 36);
            if (Number.isFinite(idx) && idx >= 0 && idx < objs.length) {
                return objs[idx];
            }
        }
        return ref;
    }

    function getUsernameFromQwikState() {
        const scripts = document.querySelectorAll('script[type="qwik/json"]');
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
                if (isValidUser(text)) return text;
            }
        }
        return null;
    }

    function isQwikSite() {
        try {
            if (typeof window.isQwik !== 'undefined' && window.isQwik) return true;
        } catch (_) {}
        const root = document.documentElement;
        if (root && (root.getAttribute('q:container') || root.hasAttribute('q:container'))) return true;
        return !!document.querySelector('script[type="qwik/json"]');
    }

    // Nilai hanya diambil kalau labelnya benar-benar "Nama Pengguna"/"Username" — field lain
    // (Nama Lengkap, Email, No. HP, Bank) tidak boleh ikut, walau bentuknya mirip username.
    const USERNAME_LABEL_RE = /^(nama\s*pengguna|username|user\s*name|user\s*id)\s*:?$/i;

    function readUsernameFromProfileDom(doc) {
        if (!doc || !doc.body) return null;
        const textOf = (el) => String(el && (el.textContent || '')).replace(/\s+/g, ' ').trim();
        const found = [];
        const add = (u, how) => {
            if (isValidUser(u) && !found.some((f) => f.user === u)) found.push({ user: u, how });
        };

        // UG/Qwik: <div class="profile-field-text"> Nama Pengguna</div><div class="filledBox">user</div>
        doc.querySelectorAll('.profile-field-text').forEach((lab) => {
            if (!USERNAME_LABEL_RE.test(textOf(lab))) return;
            const v = lab.nextElementSibling;
            if (v && !v.querySelector('input,select,button')) add(textOf(v), 'profile-field-text');
        });

        // Laravel: <p class="_label">Nama pengguna :</p> <div class="col-xs-8"><p>user</p></div>
        doc.querySelectorAll('p._label, .profile-edit p, label, th, dt, td, .label').forEach((lab) => {
            if (lab.children.length > 1 || !USERNAME_LABEL_RE.test(textOf(lab))) return;
            let v = null;
            const row = lab.closest && lab.closest('.row');
            if (row) v = row.querySelector('.col-xs-8 p, .col-xs-8 span, .col-sm-8 p, .col-md-8 p');
            if (!v && lab.nextElementSibling) v = lab.nextElementSibling;
            if (!v && lab.parentElement && lab.parentElement.nextElementSibling) {
                const next = lab.parentElement.nextElementSibling;
                v = next.querySelector('p, span') || next;
            }
            if (!v) return;
            if (v.tagName === 'INPUT') add(String(v.getAttribute('value') || '').trim(), 'label+input');
            else if (!v.querySelector('input,select,button')) add(textOf(v), 'label');
        });

        // pglain: .username-wrapper — div label ("Username", "User ID", "Nama Pengguna") dilewati
        doc.querySelectorAll('.username-wrapper div').forEach((d) => {
            if (d.children.length > 0 || USERNAME_LABEL_RE.test(textOf(d))) return;
            add(textOf(d), 'username-wrapper');
        });

        if (found.length === 0) return null;
        if (found.length > 1) {
            console.warn('[UG-QRIS] Profile: kandidat username bentrok, ditolak', found);
            return null;
        }
        return found[0].user;
    }

    const PROFILE_FETCH_TIMEOUT_MS = 8000;

    // Sama pglain.js: Qwik → /profile, lainnya → /ajaxProfile; kosong → ulang tiap 300ms.
    async function getUsernameFromProfilePage() {
        const urls = isQwikSite() ? ['/profile', '/ajaxProfile'] : ['/ajaxProfile', '/profile'];
        for (let attempt = 0; attempt < 6; attempt++) {
            let sawOk = false;
            for (let i = 0; i < urls.length; i++) {
                // Server lambat/menggantung tidak boleh bikin script menunggu selamanya.
                const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
                const timer = ctrl ? setTimeout(() => ctrl.abort(), PROFILE_FETCH_TIMEOUT_MS) : null;
                try {
                    const res = await fetch(urls[i], {
                        method: 'GET',
                        credentials: 'same-origin',
                        cache: 'no-store',
                        headers: { Accept: 'text/html,application/xhtml+xml,*/*' },
                        signal: ctrl ? ctrl.signal : undefined,
                    });
                    if (!res.ok) {
                        console.warn('[UG-QRIS] Profile fetch HTTP', res.status, urls[i]);
                        continue;
                    }
                    sawOk = true;
                    const html = await res.text();
                    const user = readUsernameFromProfileDom(new DOMParser().parseFromString(html, 'text/html'));
                    if (user) {
                        console.log('[UG-QRIS] Username from', urls[i], user);
                        return { user, url: urls[i] };
                    }
                } catch (e) {
                    console.warn('[UG-QRIS] Profile fetch error', urls[i], e && e.name === 'AbortError' ? 'timeout' : e);
                } finally {
                    if (timer) clearTimeout(timer);
                }
            }
            if (!sawOk) break;
            await new Promise((resolve) => setTimeout(resolve, 300));
        }
        return null;
    }

    function getUsernameFromMemberName() {
        try {
            if (typeof window.getMemberName === 'function') {
                const gn = String(window.getMemberName() || '').trim();
                if (isValidUser(gn)) return gn;
            }
        } catch (_) {}
        return null;
    }

    function lockUsername(user, source) {
        const u = String(user || '').trim();
        if (!u || !isValidUser(u)) return null;
        _lockedUsername = u;
        _lockedSource = source;
        try { window[LOCK_KEY] = { user: u, source }; } catch (_) {}
        console.log(`✅ [UG-QRIS] Username locked (${source}): ${u}`);
        syncUsernameField(u);
        return u;
    }

    // Sebelum bikin QR: cek ulang ke halaman profil (HTML server, tidak kena Translate).
    // Kalau beda dengan yang dikunci (ganti akun / kunci lama salah) → pakai hasil profil.
    async function getVerifiedUsernameForPayment() {
        const fresh = await getUsernameFromProfilePage();
        if (fresh) {
            if (fresh.user !== _lockedUsername) {
                console.warn('[UG-QRIS] Username dikoreksi dari profil:', { before: _lockedUsername, after: fresh.user });
            }
            return lockUsername(fresh.user, fresh.url);
        }
        return getUsername();
    }

    function syncUsernameField(user) {
        try {
            const el = document.getElementById('depositUsernameAutoQris');
            if (!el) return;
            const u = (user || _lockedUsername || '').toString().trim();
            if (!u) return;
            el.value = u;
            el.setAttribute('value', u);
            el.classList.add('notranslate');
            el.setAttribute('translate', 'no');
            el.readOnly = true;
            el.disabled = false;
        } catch (_) {}
    }

    async function fillUsernameField() {
        const user = await getUsername();
        syncUsernameField(user);
        return user;
    }

    async function getUsername() {
        try {
            if (_lockedUsername && isValidUser(_lockedUsername)) {
                return _lockedUsername;
            }

            const fromProfile = await getUsernameFromProfilePage();
            if (fromProfile) {
                return lockUsername(fromProfile.user, fromProfile.url);
            }

            const fromQwik = getUsernameFromQwikState();
            if (fromQwik) {
                return lockUsername(fromQwik, 'qwik.commonData.user_name');
            }

            const fromMemberName = getUsernameFromMemberName();
            if (fromMemberName) {
                return lockUsername(fromMemberName, 'getMemberName()');
            }

            // Teks DOM halaman (sidebar dll.) sengaja TIDAK dipakai: Chrome/Safari/Edge Translate
            // mengubahnya, dan Safari/Edge tidak memberi tanda (class translated-ltr) yang bisa dideteksi.
            console.warn('⚠️ [UG-QRIS] Username NOT found (profile / qwik / getMemberName)');
            return null;
        } catch (error) {
            console.error('❌ [UG-QRIS] Error getting username:', error);
            return null;
        }
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
    // true = payment-health tidak dicek sama sekali (form selalu tampil & QR tetap bisa dibuat). Set false untuk menyalakan lagi.
    const SKIP_PAYMENT_HEALTH = false;

    function getParamFromCurrentScript(name) {
        try {
            const current = document.currentScript;
            const scripts = Array.from(document.querySelectorAll('script[src]'))
                .map((s) => s.src)
                .reverse();
            const named = current?.src || scripts.find((url) =>
                /ugv[0-9]+\.js(\?|$)|lautspinv?[0-9]*\.js(\?|$)|ug(?:script|instant|1)?\.js(\?|$)|ug_test_simple\.js(\?|$)/i.test(url)
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

    const SKIP_STORE_KEY = false; // false = store_key wajib & dikirim ke SDK. true = store_key tidak dicek & tidak dikirim (payment-health juga dilewati).

    const STORE_KEY = (
        getParamFromCurrentScript('store_key') ||
        window.PGSCRIPT_STORE_KEY ||
        ''
    ).trim();

    function parseAmountParam(v, fallback) {
        const n = parseInt(String(v == null ? '' : v).replace(/\D/g, ''), 10);
        return Number.isFinite(n) && n > 0 ? n : fallback;
    }

    function parseButtonList(raw) {
        const src = raw || window.UG_AMOUNT_BUTTONS || '';
        let nums = [];
        if (Array.isArray(src)) {
            nums = src.map((x) => parseInt(x, 10));
        } else if (typeof src === 'string' && src.trim()) {
            nums = src.split(/[,|;\s]+/).map((x) => parseInt(String(x).replace(/\D/g, ''), 10));
        }
        nums = nums.filter((n) => Number.isFinite(n) && n > 0);
        if (!nums.length) nums = CONFIG.AMOUNT_BUTTONS.slice();
        return nums;
    }

    CONFIG.MIN_AMOUNT = parseAmountParam(
        getParamFromCurrentScript('min_depo') || window.UG_MIN_DEPO,
        CONFIG.MIN_AMOUNT
    );
    CONFIG.MAX_AMOUNT = parseAmountParam(
        getParamFromCurrentScript('max_depo') || window.UG_MAX_DEPO,
        10000000
    );
    if (CONFIG.MAX_AMOUNT < CONFIG.MIN_AMOUNT) {
        CONFIG.MAX_AMOUNT = CONFIG.MIN_AMOUNT;
    }
    CONFIG.AMOUNT_BUTTONS = parseButtonList(
        getParamFromCurrentScript('buttons') || getParamFromCurrentScript('amounts')
    ).filter((n) => n >= CONFIG.MIN_AMOUNT && n <= CONFIG.MAX_AMOUNT);
    if (!CONFIG.AMOUNT_BUTTONS.length) {
        CONFIG.AMOUNT_BUTTONS = [CONFIG.MIN_AMOUNT];
    }

    function formatRpLabel(n) {
        return 'Rp ' + Number(n).toLocaleString('id-ID');
    }

    function amountButtonsHtml() {
        return CONFIG.AMOUNT_BUTTONS.map((n) =>
            `<button type="button" class="qris-amount-btn" data-amount="${n}">${formatRpLabel(n)}</button>`
        ).join('\n');
    }

    console.log('[UG-QRIS] amounts', {
        min: CONFIG.MIN_AMOUNT,
        max: CONFIG.MAX_AMOUNT,
        buttons: CONFIG.AMOUNT_BUTTONS
    });

    if (SKIP_STORE_KEY) {
        console.log('[UG-QRIS] store_key SKIP (health bypass ON)');
    } else if (STORE_KEY) {
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

    // fresh=true: abaikan cache (dipakai tepat sebelum QR dibuat).
    async function checkPaymentHealth(fresh) {
        if (SKIP_STORE_KEY) {
            return true;
        }

        if (!STORE_KEY) {
            console.log('[Deposit is disabled]');
            console.warn('❌ [UG-QRIS] store_key missing — tambahkan ?store_key=... di script src');
            return false;
        }

        if (SKIP_PAYMENT_HEALTH) {
            return true;
        }

        const now = Date.now();
        if (
            !fresh &&
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

    // ========================================================================
    // Popup: buka otomatis sekali per kunjungan halaman deposit; setelah ditutup pemain,
    // tetap tertutup (bisa dibuka lagi dari kartu "QRIS Instant" di daftar metode deposit).
    // ========================================================================
    let popupDismissed = false;

    function setPageScrollLock(on) {
        document.documentElement.classList.toggle('ug-scroll-lock', !!on);
    }

    function openPopup() {
        const wrapper = document.getElementById('ug-poppay-wrapper');
        if (!wrapper) return;
        popupDismissed = false;
        wrapper.setAttribute('data-ug-open', '1');
        setPageScrollLock(true);
    }

    function closePopup() {
        const wrapper = document.getElementById('ug-poppay-wrapper');
        popupDismissed = true;
        if (wrapper) wrapper.setAttribute('data-ug-open', '0');
        setPageScrollLock(false);
    }

    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && document.querySelector('#ug-poppay-wrapper[data-ug-open="1"]')) closePopup();
    });

    function findStableContainerQuiet() {
        const payMethods = document.getElementById('pay-methods');
        if (payMethods) return payMethods;
        const headings = document.querySelectorAll('h3, h2, h4');
        for (const heading of headings) {
            if (heading.textContent.trim().toLowerCase().includes('metode deposit')) return heading.parentElement;
        }
        return null;
    }

    function ensureReopenCard(parent) {
        if (!parent || document.getElementById('ug-poppay-reopen')) return;
        const card = document.createElement('div');
        card.id = 'ug-poppay-reopen';
        card.setAttribute('data-ug-persistent', 'true');
        card.setAttribute('role', 'button');
        card.setAttribute('tabindex', '0');
        card.innerHTML = `
            <div class="ug-reopen-text">
                <strong>💳 QRIS Instant</strong>
            </div>
            <span class="ug-reopen-btn">Buka</span>
        `;
        applyInjectTheme(card);
        card.addEventListener('click', function (e) {
            e.preventDefault();
            e.stopPropagation();
            openPopup();
        });
        card.addEventListener('keydown', function (e) {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPopup(); }
        });
        let insertAfter = null;
        const headings = parent.querySelectorAll('h3, h2, h4');
        for (const heading of headings) {
            const text = heading.textContent.trim().toLowerCase();
            if (text.includes('metode deposit') || text.includes('proses otomatis')) {
                insertAfter = heading;
                break;
            }
        }
        try {
            if (insertAfter) insertAfter.parentNode.insertBefore(card, insertAfter.nextSibling);
            else parent.insertBefore(card, parent.firstChild);
        } catch (_) {
            try { parent.appendChild(card); } catch (_) {}
        }
    }

    // Pemain pindah dari halaman deposit (SPA) → popup tidak boleh ikut muncul di halaman lain.
    function removePopupOffDepositPage() {
        if (!document.getElementById('ug-poppay-wrapper') || findStableContainerQuiet()) return false;
        isInjected = false;
        popupDismissed = false;
        const wrapper = document.getElementById('ug-poppay-wrapper');
        if (wrapper) wrapper.remove();
        const card = document.getElementById('ug-poppay-reopen');
        if (card) card.remove();
        setPageScrollLock(false);
        console.log('[UG-QRIS] Popup dilepas (bukan halaman deposit)');
        return true;
    }

    function teardownInjection() {
        const wrapper = document.getElementById('ug-poppay-wrapper');
        if (wrapper) {
            wrapper.remove();
        }
        const card = document.getElementById('ug-poppay-reopen');
        if (card) card.remove();
        setPageScrollLock(false);

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
    // Site theme — jangan pakai pink jajanwin di money site biru/charcoal
    // ========================================================================
    const THEME_PINK = {
        bg: '#2D0017',
        bgDeep: '#1A000E',
        text: '#EBDFE6',
        muted: '#AE95A5',
        accent: '#E577DE',
        accentHover: '#F08AE8',
        accentText: '#2D0017',
        border: 'rgba(227, 179, 203, 0.28)',
        btnBg: 'rgba(217, 170, 194, 0.08)',
        badgeBg: 'rgba(229, 119, 222, 0.18)',
        successBg: 'rgba(229, 119, 222, 0.15)',
        shadow: '0 4px 16px rgba(45, 0, 23, 0.45)',
    };

    const THEME_OCEAN = {
        bg: '#151A20',
        bgDeep: '#0C1016',
        text: '#E6EDF3',
        muted: '#8B99A8',
        accent: '#7EB6FF',
        accentHover: '#A4CCFF',
        accentText: '#0A1018',
        border: 'rgba(126, 182, 255, 0.28)',
        btnBg: 'rgba(126, 182, 255, 0.08)',
        badgeBg: 'rgba(126, 182, 255, 0.16)',
        successBg: 'rgba(126, 182, 255, 0.12)',
        shadow: '0 4px 16px rgba(0, 0, 0, 0.4)',
    };

    function parseRgb(input) {
        const m = String(input || '').match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
        if (!m) return null;
        return [Number(m[1]), Number(m[2]), Number(m[3])];
    }

    function rgbToHex(rgb) {
        return '#' + rgb.map((n) => ('0' + Math.max(0, Math.min(255, n)).toString(16)).slice(-2)).join('');
    }

    function isUsableAccent(rgb) {
        if (!rgb) return false;
        const max = Math.max(rgb[0], rgb[1], rgb[2]);
        const min = Math.min(rgb[0], rgb[1], rgb[2]);
        return max - min >= 25 && max >= 80;
    }

    function sampleAccentColor() {
        const nodes = document.querySelectorAll(
            '#pay-methods [class*="active"], [class*="methodType"][class*="active"], .methodType.active'
        );
        for (let i = 0; i < nodes.length; i++) {
            const cs = getComputedStyle(nodes[i]);
            for (const prop of ['color', 'borderBottomColor', 'backgroundColor', 'borderColor']) {
                const rgb = parseRgb(cs[prop]);
                if (isUsableAccent(rgb)) return rgbToHex(rgb);
            }
        }
        return null;
    }

    function getInjectTheme() {
        const host = (location.hostname || '').toLowerCase();
        if (/spinlaut|lautspin/.test(host)) {
            const t = Object.assign({}, THEME_OCEAN);
            const sampled = sampleAccentColor();
            if (sampled) t.accent = sampled;
            return t;
        }
        return Object.assign({}, THEME_PINK);
    }

    function applyInjectTheme(wrapper, theme) {
        const t = theme || getInjectTheme();
        const map = {
            '--ug-bg': t.bg,
            '--ug-bg-deep': t.bgDeep,
            '--ug-text': t.text,
            '--ug-muted': t.muted,
            '--ug-accent': t.accent,
            '--ug-accent-hover': t.accentHover,
            '--ug-accent-text': t.accentText,
            '--ug-border': t.border,
            '--ug-btn-bg': t.btnBg,
            '--ug-badge-bg': t.badgeBg,
            '--ug-success-bg': t.successBg,
            '--ug-shadow': t.shadow,
        };
        Object.keys(map).forEach((k) => wrapper.style.setProperty(k, map[k]));
        console.log('[UG-QRIS] Theme', t.accent, location.hostname);
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
            removePopupOffDepositPage();
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
        // Popup layar penuh (di <body>, bukan di dalam #pay-methods) — display diatur lewat data-ug-open,
        // jadi jangan pasang display di style inline.
        const wrapper = document.createElement('div');
        wrapper.id = 'ug-poppay-wrapper';
        wrapper.className = 'ug-popup-overlay';
        wrapper.setAttribute('role', 'dialog');
        wrapper.setAttribute('aria-modal', 'true');
        wrapper.setAttribute('data-ug-open', popupDismissed ? '0' : '1');
        applyInjectTheme(wrapper);
        wrapper.addEventListener('click', function (e) {
            const closeBtn = e.target.closest && e.target.closest('.ug-popup-close');
            const resultActive = !!document.querySelector('#qrisResultContainer.active');
            if (closeBtn || (e.target === wrapper && !resultActive)) {
                e.preventDefault();
                e.stopPropagation();
                closePopup();
            }
        }, true);

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
                #ug-poppay-wrapper {
                    --ug-bg: #2D0017;
                    --ug-bg-deep: #1A000E;
                    --ug-text: #EBDFE6;
                    --ug-muted: #AE95A5;
                    --ug-accent: #E577DE;
                    --ug-accent-hover: #F08AE8;
                    --ug-accent-text: #2D0017;
                    --ug-border: rgba(227, 179, 203, 0.28);
                    --ug-btn-bg: rgba(217, 170, 194, 0.08);
                    --ug-badge-bg: rgba(229, 119, 222, 0.18);
                    --ug-success-bg: rgba(229, 119, 222, 0.15);
                    --ug-shadow: 0 4px 16px rgba(45, 0, 23, 0.45);
                }
                /* Popup menutupi seluruh halaman (header, menu bawah, widget chat situs) */
                #ug-poppay-wrapper.ug-popup-overlay {
                    position: fixed !important;
                    inset: 0 !important;
                    z-index: 2147483000 !important;
                    background: rgba(0, 0, 0, 0.72) !important;
                    -webkit-backdrop-filter: blur(4px);
                    backdrop-filter: blur(4px);
                    overflow-y: auto !important;
                    -webkit-overflow-scrolling: touch;
                    overscroll-behavior: contain;
                    padding: 24px 12px !important;
                    box-sizing: border-box !important;
                    margin: 0 !important;
                    visibility: visible !important;
                    opacity: 1 !important;
                }
                #ug-poppay-wrapper.ug-popup-overlay[data-ug-open="1"] {
                    display: flex !important;
                    align-items: flex-start;
                    justify-content: flex-start;
                }
                #ug-poppay-wrapper.ug-popup-overlay[data-ug-open="0"] {
                    display: none !important;
                }

                #ug-poppay-qris-full {
                    position: relative !important;
                    z-index: auto !important;
                    pointer-events: auto !important;
                    display: block !important;
                    opacity: 1 !important;
                    visibility: visible !important;
                    width: 100%;
                    max-width: 480px;
                    /* margin auto (bukan align-items:center) supaya tetap di tengah tapi bagian atas form tidak terpotong saat form lebih tinggi dari layar */
                    margin: auto !important;
                    flex-shrink: 0;
                }
                
                #ug-poppay-qris-full * {
                    pointer-events: auto;
                }

                #ug-poppay-qris-full .qris-manual-wrapper {
                    margin: 0 !important;
                    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.55);
                }

                .ug-popup-close {
                    position: absolute;
                    top: 8px;
                    right: 8px;
                    width: 36px;
                    height: 36px;
                    border-radius: 50%;
                    border: 1px solid var(--ug-border);
                    background: var(--ug-btn-bg);
                    color: var(--ug-text);
                    font-size: 22px;
                    line-height: 1;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    padding: 0;
                    z-index: 5;
                    touch-action: manipulation;
                }
                .ug-popup-close:hover { border-color: var(--ug-accent); color: var(--ug-accent); }
                #ug-poppay-qris-full .qris-manual-header { padding-right: 44px; }

                html.ug-scroll-lock, html.ug-scroll-lock body { overflow: hidden !important; }

                #ug-poppay-reopen {
                    display: flex !important;
                    align-items: center;
                    justify-content: space-between;
                    gap: 12px;
                    margin: 10px 0 16px;
                    padding: 12px 14px;
                    border-radius: 10px;
                    border: 1px solid var(--ug-accent);
                    background: var(--ug-bg);
                    color: var(--ug-text);
                    cursor: pointer;
                    box-shadow: var(--ug-shadow);
                    font-family: poppins, poppins-fallback, sans-serif;
                    box-sizing: border-box;
                    width: 100%;
                    touch-action: manipulation;
                    -webkit-tap-highlight-color: transparent;
                }
                #ug-poppay-reopen .ug-reopen-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
                #ug-poppay-reopen strong { color: var(--ug-accent); font-size: 15px; }
                #ug-poppay-reopen span { color: var(--ug-muted); font-size: 12px; }
                #ug-poppay-reopen .ug-reopen-btn {
                    flex: 0 0 auto;
                    padding: 8px 18px;
                    border-radius: 8px;
                    background: var(--ug-accent);
                    color: var(--ug-accent-text);
                    font-weight: 700;
                    font-size: 14px;
                }
                
                .qris-manual-wrapper {
                    background: var(--ug-bg);
                    color: var(--ug-text);
                    padding: ${CONFIG.IS_MOBILE ? '12px' : '25px'};
                    border-radius: ${CONFIG.IS_MOBILE ? '8px' : '12px'};
                    margin-bottom: ${CONFIG.IS_MOBILE ? '10px' : '25px'};
                    box-shadow: var(--ug-shadow);
                    border: 1px solid var(--ug-border);
                    max-width: 100%;
                    width: 100%;
                    overflow-x: hidden;
                    position: relative;
                    box-sizing: border-box;
                    color-scheme: dark;
                    font-family: poppins, poppins-fallback, sans-serif;
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
                    border-bottom: 2px solid var(--ug-border);
                }
                
                .qris-manual-header h5 {
                    color: var(--ug-text);
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
                    color: var(--ug-accent);
                }
                
                .qris-manual-header p {
                    color: var(--ug-muted);
                    margin: 8px 0 0 0;
                }
                
                .qris-form label {
                    color: var(--ug-text);
                    margin-bottom: 8px;
                    display: block;
                }

                .qris-input.qris-username-readonly,
                #depositUsernameAutoQris {
                    background: var(--ug-bg-deep) !important;
                    color: var(--ug-accent) !important;
                    border: 1px solid var(--ug-border) !important;
                    cursor: default !important;
                    font-weight: 600;
                    letter-spacing: 0.3px;
                    caret-color: transparent;
                    border-radius: 6px !important;
                }

                .qris-input.qris-username-readonly:focus,
                #depositUsernameAutoQris:focus {
                    outline: none !important;
                    box-shadow: none !important;
                    border-color: var(--ug-accent) !important;
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
                    border: 1px solid var(--ug-border);
                    background: var(--ug-btn-bg);
                    color: var(--ug-text);
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
                    background: var(--ug-accent);
                    color: var(--ug-accent-text);
                    border-color: var(--ug-accent);
                }
                
                .qris-amount-btn.active {
                    background: var(--ug-accent) !important;
                    color: var(--ug-accent-text) !important;
                    border-color: var(--ug-accent) !important;
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
                    background: var(--ug-bg-deep);
                    padding: 12px ${CONFIG.IS_MOBILE ? '12px' : '16px'};
                    border: 1px solid var(--ug-border);
                    border-right: none;
                    border-radius: 6px 0 0 6px;
                    color: var(--ug-muted);
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
                    border: 1px solid var(--ug-border);
                    border-radius: 0 6px 6px 0;
                    font-size: ${CONFIG.IS_MOBILE ? '14px' : '16px'};
                    width: 100%;
                    box-sizing: border-box;
                    background: var(--ug-bg-deep);
                    color: var(--ug-text);
                }
                
                .qris-input:focus {
                    outline: none;
                    border-color: var(--ug-accent);
                }
                
                select.qris-input {
                    border-radius: 6px;
                    width: 100%;
                }
                
                .qris-input::placeholder {
                    color: var(--ug-muted);
                }
                
                .qris-input-hint {
                    font-size: 12px;
                    color: var(--ug-muted);
                    margin-top: 5px;
                }
                
                .qris-submit-btn {
                    width: 100%;
                    padding: ${CONFIG.IS_MOBILE ? '16px' : '14px'};
                    background: var(--ug-accent);
                    color: var(--ug-accent-text);
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
                    background: var(--ug-accent-hover);
                    color: var(--ug-accent-text);
                }
                
                .qris-submit-btn:disabled {
                    background: var(--ug-btn-bg);
                    color: var(--ug-muted);
                    cursor: not-allowed;
                }
                
                .ug-qris-success-box {
                    padding: 20px;
                    background: var(--ug-success-bg);
                    border: 2px solid var(--ug-accent);
                    border-radius: 8px;
                    margin-top: 15px;
                }
                
                .ug-qris-success-box h4 {
                    color: var(--ug-accent);
                    margin: 0 0 10px 0;
                }
                
                .ug-qris-success-box p {
                    color: var(--ug-text);
                    margin: 0;
                }
                
                .qris-result {
                    display: none;
                    margin-top: 20px;
                    position: relative;
                    z-index: 3;
                }
                
                .qris-result.active {
                    display: block;
                }
                
                #qris-payment-frame {
                    min-height: 400px;
                    text-align: center;
                    position: relative;
                    z-index: 3;
                }
                
                #payment-result {
                    margin-top: 15px;
                }
            </style>
            
            <div class="qris-manual-wrapper">
                <button type="button" class="ug-popup-close" aria-label="Tutup">&times;</button>
                <div class="qris-manual-header">
                    <h5>
                        <span class="qris-icon">💳</span>
                        QRIS Payment - Deposit Instant
                    </h5>
                </div>
                
                <div class="qris-form" id="qrisFormContainer">
                    <form id="formDepositAutoQris">
                        <input type="hidden" id="bankSelectAutoQris" value="QRIS">

                        <div class="form-group mb-3">
                            <label for="depositUsernameAutoQris">Username</label>
                            <input
                                class="qris-input qris-username-readonly notranslate"
                                type="text"
                                id="depositUsernameAutoQris"
                                name="username"
                                value=""
                                readonly
                                tabindex="-1"
                                translate="no"
                                autocomplete="off"
                                spellcheck="false"
                                placeholder="Mendeteksi username..."
                            >
                            <small class="qris-input-hint">Username akun login (otomatis, tidak bisa diubah)</small>
                        </div>
                        
                        <div class="form-group mb-3">
                            <label>Jumlah Deposit</label>
                            
                            <div class="qris-amount-buttons" id="ug-amount-buttons">
                                ${amountButtonsHtml()}
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

        try {
            document.body.appendChild(wrapper);
            console.log('[UG-QRIS] Popup attached to body');
        } catch (error) {
            console.error('❌ [UG-QRIS] Failed to attach popup:', error);
            return false;
        }
        setPageScrollLock(wrapper.getAttribute('data-ug-open') === '1');
        ensureReopenCard(parentContainer);

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

        // Fill readonly username field (locked source)
        fillUsernameField().then((u) => {
            console.log('[UG-QRIS] ✓ Username field filled:', u);
        }).catch((err) => {
            console.error('❌ [UG-QRIS] Failed to fill username field:', err);
        });

        // Amount input handler - untuk manual typing
        if (amountShow) {
            amountShow.addEventListener('input', function (e) {
                e.stopPropagation();

                const val = this.value.replace(/\D/g, '');
                amountHidden.value = val;
                this.value = val.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

                // Remove active class from buttons when typing
                document.querySelectorAll('.qris-amount-btn').forEach(b => b.classList.remove('active'));
            });
            console.log('[UG-QRIS] ✓ Input handler attached');
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

            // Disable button
            const submitBtn = this.querySelector('.qris-submit-btn');
            submitBtn.disabled = true;
            btnText.textContent = 'Generating...';

            try {
                if (!(await checkPaymentHealth(true))) {
                    teardownInjection();
                    alert('Deposit QRIS sedang tidak tersedia. Silakan coba lagi nanti.');
                    return;
                }

                // Load SDK
                if (typeof window.QrisSDK === 'undefined') {
                    console.log('📦 [UG-QRIS] Loading SDK...');
                    await loadQrisSDK();
                }

                const username = await getVerifiedUsernameForPayment();
                const fieldEl = document.getElementById('depositUsernameAutoQris');
                if (fieldEl && username) {
                    syncUsernameField(username);
                }

                if (!username) {
                    throw new Error('Username tidak ditemukan. Silakan login terlebih dahulu.');
                }

                const fieldVal = (fieldEl && fieldEl.value || '').trim();
                if (fieldVal && fieldVal !== username) {
                    console.warn('[UG-QRIS] Username field mismatch, using locked:', { fieldVal, username });
                    syncUsernameField(username);
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

                // Create payment - ALWAYS NEW invoice
                const invoice = 'UG-' + Date.now();
                console.log('💳 [UG-QRIS] Creating payment:', { amount, username, invoice });

                // pg-ppy-sdk: auth via store_key (bukan x-domain)
                const sdkConfig = {
                    healthCheckEnabled: false,
                    ...(SKIP_STORE_KEY ? {} : { storeKey: STORE_KEY, store_key: STORE_KEY }),
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
                if (removePopupOffDepositPage()) return;

                const wrapper = document.getElementById('ug-poppay-wrapper');
                const inner = document.getElementById('ug-poppay-qris-full');
                if (wrapper && inner) ensureReopenCard(findStableContainerQuiet());

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
            if (removePopupOffDepositPage()) return;
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
            if (wrapper && inner) ensureReopenCard(findStableContainerQuiet());

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

        // FIRST: Check if username exists (Qwik SSR state is in page; retry if SPA belum siap)
        const hasUsername = await validateUsernameExists();

        if (!hasUsername) {
            if (retryCount < CONFIG.MAX_RETRIES) {
                retryCount++;
                console.log(`🔄 [UG-QRIS] Waiting for username... (${retryCount}/${CONFIG.MAX_RETRIES})`);
                setTimeout(tryStart, CONFIG.RETRY_DELAY);
                return;
            }
            console.error('❌ [UG-QRIS] SCRIPT DISABLED - Username not found');
            console.error('❌ [UG-QRIS] Will NOT activate injection without valid username');
            return;
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
