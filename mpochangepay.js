window.__PG_SELF_SCRIPT_SRC =
  (document.currentScript && document.currentScript.src) ||
  window.__PG_SELF_SCRIPT_SRC ||
  '';

(function () {
    console.log('[MASTER FIX] Initializing...');
  
    function injectDarkTheme() {
      const oldStyle = document.getElementById('qris-dark-theme');
      if (oldStyle) oldStyle.remove();
  
      const darkThemeCSS = `
              html body #v-autobank,
              html body #v-autobank .qris-manual-wrapper,
              html body #v-autobank .card,
              html body #v-autobank .modal-content {
                  background: #1a1a1a !important;
                  background-color: #1a1a1a !important;
                  color: #ffffff !important;
              }
              html body #v-autobank .qris-manual-header h5,
              html body #v-autobank .qris-manual-header p,
              html body #v-autobank .qris-form label {
                  color: #ffffff !important;
              }
              html body #v-autobank .text-muted {
                  color: #aaaaaa !important;
              }
              html body #v-autobank .form-control {
                  background: #2a2a2a !important;
                  background-color: #2a2a2a !important;
                  color: #ffffff !important;
                  border-color: #444444 !important;
              }
              html body #v-autobank .input-group-text {
                  background: #333333 !important;
                  background-color: #333333 !important;
                  color: #ffffff !important;
                  border-color: #444444 !important;
              }
              html body #v-autobank .btn-outline-primary {
                  color: #ffffff !important;
                  border-color: #444444 !important;
                  background: #2a2a2a !important;
                  background-color: #2a2a2a !important;
              }
              html body #v-autobank .btn-outline-primary:hover,
              html body #v-autobank .btn-outline-primary.active {
                  background: #0d6efd !important;
                  background-color: #0d6efd !important;
                  color: #ffffff !important;
              }
          `;
  
      const styleElement = document.createElement('style');
      styleElement.id = 'qris-dark-theme';
      styleElement.textContent = darkThemeCSS;
      document.head.appendChild(styleElement);
      console.log('[DARK THEME] ✅ CSS injected');
    }
  
    // 2. FIX NEGATIVE AMOUNTS & NaN - GLOBAL WATCHER
    function fixNegativeAmounts() {
      // Find all amount inputs
      const inputs = [
        document.getElementById('depositShowAmountAutoQris'),
        document.getElementById('depositShowAmountAuto'),
        document.getElementById('depositAmountAutoQris'),
        document.getElementById('depositAmountAuto')
      ].filter(el => el);
  
      inputs.forEach(input => {
        const val = input.value;
  
        // Fix NaN or empty string
        if (val === 'NaN' || val === 'undefined' || val === 'null') {
          input.value = '';
          console.log('[AMOUNT FIX] ✅ Cleared NaN/invalid value');
          return;
        }
  
        // Fix negative values (clear them instead of taking absolute value)
        if (val && (val.includes('-') || parseFloat(val.replace(/[^0-9.-]/g, '')) < 0)) {
          input.value = '';
          console.log('[AMOUNT FIX] ✅ Cleared negative value:', val);
        }
      });
    }
  
    // Inject CSS immediately
    injectDarkTheme();
  
    // Re-inject CSS every 2 seconds to ensure it stays
    if (window.qrisDarkThemeInterval) clearInterval(window.qrisDarkThemeInterval);
    window.qrisDarkThemeInterval = setInterval(injectDarkTheme, 2000);
  
    // Fix amounts every 50ms (very aggressive)
    if (window.qrisAmountFixInterval) clearInterval(window.qrisAmountFixInterval);
    window.qrisAmountFixInterval = setInterval(fixNegativeAmounts, 50);
  
    console.log('[MASTER FIX] ✅ Active - Dark theme + Amount fix running');
  })();
  
  // Popup Window Interceptor
  (function () {
    const originalWindowOpen = window.open;
    window.capturedPopup = null;
  
    window.open = function (...args) {
      console.log('[POPUP INTERCEPT] Opening popup:', args[0]);
      const popup = originalWindowOpen.apply(this, args);
      window.capturedPopup = popup;
  
      if (popup) {
        setTimeout(() => {
          if (popup && !popup.closed) {
            popup.close();
            console.log('[POPUP INTERCEPT] Popup closed!');
          }
        }, 100);
  
        try {
          popup.moveTo(-9999, -9999);
          popup.resizeTo(1, 1);
          popup.blur();
          window.focus();
        } catch (e) { }
  
        // Monitor popup for QR
        let checkCount = 0;
        const checkInterval = setInterval(() => {
          checkCount++;
  
          try {
            if (popup.document && popup.document.body) {
              const qrImg = popup.document.querySelector('img[alt*="QR"], img[alt*="qr"], img');
              if (qrImg && qrImg.src && qrImg.src.includes('data:image')) {
                console.log('[POPUP CHECK] Found QR image!');
                window.dispatchEvent(new CustomEvent('popup-qr-found', {
                  detail: { imageUrl: qrImg.src }
                }));
                clearInterval(checkInterval);
              }
  
              const canvas = popup.document.querySelector('canvas');
              if (canvas && canvas.width > 100) {
                const imageUrl = canvas.toDataURL('image/png');
                window.dispatchEvent(new CustomEvent('popup-qr-found', {
                  detail: { imageUrl: imageUrl }
                }));
                clearInterval(checkInterval);
              }
            }
          } catch (e) { }
  
          if (checkCount > 60) {
            clearInterval(checkInterval);
          }
        }, 500);
      }
  
      return popup;
    };
  })();
  
  // Network Interceptor
  (function () {
    const originalFetch = window.fetch;
    window.qrInterceptData = {};
  
    window.fetch = function (...args) {
      const url = args[0];
      return originalFetch.apply(this, args).then(response => {
        const clonedResponse = response.clone();
  
        if (url.includes('create-transaction') || url.includes('qris') || url.includes('payment')) {
          clonedResponse.json().then(data => {
            window.qrInterceptData = { url: url, data: data, timestamp: Date.now() };
            window.dispatchEvent(new CustomEvent('qris-data-intercepted', { detail: data }));
          }).catch(e => {
            clonedResponse.blob().then(blob => {
              if (blob.type.includes('image')) {
                const imageUrl = URL.createObjectURL(blob);
                window.qrInterceptData.imageUrl = imageUrl;
                window.dispatchEvent(new CustomEvent('qris-image-intercepted', { detail: { imageUrl: imageUrl } }));
              }
            });
          });
        }
  
        return response;
      });
    };
  })();
  
  // Get username from page
  async function getUsername() {
    try {
      // Try DOM elements first
      var elem = document.querySelector('.account-username');
      var usernameQris = elem ? elem.textContent.trim() : '';
  
      if (!usernameQris || usernameQris.trim() === '' || usernameQris.trim().toLowerCase() === 'undefined' || usernameQris.trim().toLowerCase() === 'null') {
        var headerElem = document.querySelector('.header-title h5');
        if (headerElem) {
          var text = headerElem.textContent.trim();
          usernameQris = text.replace(/^Selamat\s+Datang[:,]?\s*/i, '').trim();
        }
      }
  
      // Only try API if we have a valid host (not file://)
      if ((!usernameQris || usernameQris.trim() === '') && window.location.protocol !== 'file:') {
        const hostURL = window.location.host;
        if (hostURL) {
          const apiUrl = `https://${hostURL}/profile`;
  
          try {
            const response = await fetch(apiUrl);
            if (response.ok) {
              const htmlString = await response.text();
              const parser = new DOMParser();
              const doc = parser.parseFromString(htmlString, "text/html");
  
              var headerElem = doc.querySelector('.header-title h5');
              if (headerElem) {
                var text = headerElem.textContent.trim();
                usernameQris = text.replace(/^Selamat\s+Datang[:,]?\s*/i, '').trim();
              } else {
                var xpath = "//div[@class='profile-item']/h5";
                var result = doc.evaluate(xpath, doc, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
                var elemData = result.singleNodeValue;
                if (elemData) {
                  usernameQris = elemData.textContent.trim();
                }
              }
            }
          } catch (e) {
            console.log('[INFO] Could not fetch from API, using fallback');
          }
        }
      }
  
      if (!usernameQris || usernameQris.trim() === '' || usernameQris.trim().toLowerCase() === 'undefined' || usernameQris.trim().toLowerCase() === 'null') {
        const guestUser = 'GUEST-' + Math.floor(Math.random() * 10000);
        console.log('[INFO] Using guest username:', guestUser);
        return guestUser;
      }
  
      return usernameQris;
  
    } catch (error) {
      console.log('[INFO] Username detection failed, using guest mode');
      return 'GUEST-' + Math.floor(Math.random() * 10000);
    }
  }
  
  class QrisSDKCustom {
    constructor(config) {
      this.formId = config.formId || 'formDepositAuto';
      this.onSuccess = config.onSuccess || function () { };
      this.onFailed = config.onFailed || function () { };
  
      this.checkAndCreateContainers();
  
      this.form = document.getElementById(this.formId);
      this.formContainer = document.getElementById('qrisFormContainer');
      this.resultContainer = document.getElementById('qrisResultContainer');
  
      // Auto-detect input IDs based on form ID
      if (this.formId === 'formDepositAutoQris') {
        this.amountInput = document.getElementById('depositAmountAutoQris');
        this.invoiceInput = document.getElementById('bankSelectAutoQris');
      } else {
        this.amountInput = document.getElementById('depositAmountAuto');
        this.invoiceInput = document.getElementById('bankSelectAuto');
      }
  
      this.initFormEvent();
    }
  
    checkAndCreateContainers() {
      // Containers will be created by HTML injection, no need to create here
    }
  
    initFormEvent() {
      if (!this.form) return;
  
      $(`#${this.formId}`).off('submit').on('submit', async (e) => {
        if (typeof $(this.form).valid === 'function' && !$(this.form).valid()) {
          return;
        }
  
        e.preventDefault();
  
        const $depoForm = $(`#${this.formId}`);
        if ($depoForm.data("depositSubmitting")) return;
        $depoForm.data("depositSubmitting", true);
  
        const $depoBtn = $depoForm.find('button[type="submit"], input[type="submit"]');
        $depoBtn.prop("disabled", true);
  
        const amountValue = parseFloat(this.amountInput.value);
        const randomRefId = 'INV-' + Date.now();
        const bankChannel = this.invoiceInput ? this.invoiceInput.value : 'QRIS';
        const username = await getUsername();

        // Live re-check gate sebelum create QR
        if (window.__PG_SKIP_STORE_KEY !== true && typeof window.__mpoCheckPaymentHealth === 'function') {
          const liveOk = await window.__mpoCheckPaymentHealth();
          if (!liveOk) {
            console.log('[Deposit is disabled]');
            alert('Deposit PopPay nonaktif. Pakai metode deposit bawaan toko.');
            $depoForm.data("depositSubmitting", false);
            $depoBtn.prop("disabled", false);
            if (typeof window.__pgTeardownPoppayScript === 'function') {
              window.__pgTeardownPoppayScript('live health OFF');
            }
            return;
          }
        }
  
        // Safety check: Block transaction if username is GUEST
        if (username.startsWith('GUEST-')) {
          console.log('[QRIS AUTO] ❌ Transaction blocked - Username not authenticated');
          alert('Mohon login terlebih dahulu untuk melakukan deposit.');
          $depoForm.data("depositSubmitting", false);
          $depoBtn.prop("disabled", false);
          return;
        }
  
        // Hide form, show result container
        if (this.formContainer) this.formContainer.style.display = 'none';
        if (this.resultContainer) this.resultContainer.style.display = 'block';
  
        this.openPayment(amountValue, randomRefId, bankChannel, username);
      });
    }
  
    resetForm() {
      if (this.formContainer) this.formContainer.style.display = 'block';
      if (this.resultContainer) this.resultContainer.style.display = 'none';
  
      const $depoForm = $(`#${this.formId}`);
      $depoForm.data("depositSubmitting", false);
      $depoForm.find('button[type="submit"]').prop("disabled", false);
  
      // Clear result containers
      document.getElementById('qris-payment-frame').innerHTML = '';
      document.getElementById('payment-result').innerHTML = '';
    }
  
    openPayment(amount, invoice, channel, username) {
      console.log('[QRIS AUTO] Generating QR with inline mode:', { amount, username, invoice });

      const storeKey = (
        window.__PG_STORE_KEY ||
        window.PGSCRIPT_STORE_KEY ||
        ''
      ).trim();

      if (!storeKey && window.__PG_SKIP_STORE_KEY !== true) {
        console.error('[QRIS AUTO] store_key missing');
        alert('Konfigurasi deposit belum lengkap (store_key).');
        this.resetForm();
        return;
      }

      // Initialize QRIS SDK with inline mode (NO POPUP)
      if (typeof window.QrisSDK !== "undefined") {
        try {
          // pg-ppy-sdk: auth via store_key (bukan x-domain)
          const payment = new window.QrisSDK({
            healthCheckEnabled: false,
            storeKey: storeKey,
            store_key: storeKey,
            amount: amount,
            invoice: invoice,
            notes: 'Deposit Auto - ' + invoice,
            username: username,
            payor_name: username || '',
            payor_email: '',
            displayMode: 'inline',  // ← INLINE MODE (iframe)
            containerId: 'qris-payment-frame',
            resultContainerId: 'payment-result',
            onSuccess: (data) => {
              console.log('[QRIS AUTO] Success:', data);
              this.onSuccess(data);
  
              // Callback functions if available
              if (typeof checkDepoStatus === "function") {
                checkDepoStatus(invoice);
              }
              setTimeout(() => {
                if (typeof getBalance === "function") {
                  getBalance();
                }
              }, 1500);
            },
            onFailed: (status) => {
              console.error('[QRIS AUTO] Failed:', status);
              alert('Gagal membuat QR Code. Silakan coba lagi.');
              this.resetForm();
              this.onFailed(status);
            }
          });
  
          payment.openPayment();
  
        } catch (error) {
          console.error('[QRIS AUTO] Error:', error);
          alert('Terjadi kesalahan. Silakan coba lagi.');
          this.resetForm();
        }
      } else {
        alert('QRIS SDK tidak tersedia. Silakan refresh halaman.');
        this.resetForm();
      }
    }
  }
  
  $(document).ready(async function () {
    console.log('[INJECT SCRIPT] Version 5.11 - store_key ON');

    // ===================================================================
    // PGScript gate — store_key + payment-health (fail-closed)
    // SDK: https://unpkg.com/@poppackage/pg-ppy-sdk@1.0.0/dist/qris-sdk.umd.js
    // Embed: <script src="...mpochangepay.js?store_key=sk_...">  (nama file bebas)
    // ===================================================================
    let paymentHealthCache = null;
    let paymentHealthCacheKey = '';
    let paymentHealthCacheAt = 0;
    const PAYMENT_HEALTH_CACHE_TTL_MS = 30000;

    function resolveEmbedScriptSrc() {
      if (window.__PG_SELF_SCRIPT_SRC) return String(window.__PG_SELF_SCRIPT_SRC);
      if (document.currentScript && document.currentScript.src) {
        return document.currentScript.src;
      }
      const hit = Array.from(document.querySelectorAll('script[src]'))
        .map((s) => s.src)
        .reverse()
        .find((src) => {
          try {
            return !!new URL(src, window.location.href).searchParams.get('store_key');
          } catch (e) {
            return false;
          }
        });
      return hit || '';
    }

    function getParamFromEmbedScript(name) {
      try {
        const src = resolveEmbedScriptSrc();
        if (!src) return null;
        return new URL(src, window.location.href).searchParams.get(name);
      } catch (e) {
        return null;
      }
    }

    const SKIP_STORE_KEY = false;
    const STORE_KEY = (
      getParamFromEmbedScript('store_key') ||
      window.PGSCRIPT_STORE_KEY ||
      ''
    ).trim();

    window.__PG_STORE_KEY = STORE_KEY;
    window.__PG_SKIP_STORE_KEY = SKIP_STORE_KEY;

    const QRIS_SDK_URL = (
      getParamFromEmbedScript('sdk_url') ||
      window.PGSCRIPT_SDK_URL ||
      'https://unpkg.com/@poppackage/pg-ppy-sdk@1.0.0/dist/qris-sdk.umd.js'
    ).trim();

    const HEALTH_BASE = 'https://payment.pg-poppay.com';
    const HEALTH_API_VERSION = 'api';

    console.log('[INJECT] gate=v20260810-mpo pg-ppy-sdk health=' + HEALTH_BASE);
    if (resolveEmbedScriptSrc()) {
      console.log('[INJECT] embed src:', resolveEmbedScriptSrc());
    }

    if (SKIP_STORE_KEY) {
      console.log('[INJECT] store_key SKIP (health bypass ON) — tes console');
    } else if (STORE_KEY) {
      console.log('[INJECT] store_key loaded from script/config');
    } else {
      console.log('[Deposit is disabled]');
      console.error('[INJECT] ABORT — store_key kosong. Embed: <script src="...ANYNAME.js?store_key=sk_...">');
      window.__PG_DEPOSIT_DISABLED = true;
      if (window.qrisDarkThemeInterval) {
        clearInterval(window.qrisDarkThemeInterval);
        window.qrisDarkThemeInterval = null;
      }
      $('#qris-dark-theme').remove();
      return;
    }

    function teardownMpoInjection(reason) {
      try {
        // OFF = cabut SCRIPT kita saja. JANGAN matikan deposit/mpay bawaan toko.
        console.log('[Deposit is disabled]');
        console.log('[INJECT] PopPay script OFF — restore toko UI', reason || '');
        window.__PG_DEPOSIT_DISABLED = true;

        // Hapus hanya UI yang kita inject
        $('[data-pg-inject="1"]').remove();
        $('.qris-manual-wrapper').has('#formDepositAutoQris, #qris-payment-frame').remove();
        $('#formDepositAutoQris').closest('.qris-manual-wrapper').remove();
        $('#qrButton[data-pg-inject], #containerqris[data-pg-inject]').remove();
        $('.component-tabs').has('#btnInstant').remove();
        $('#btnInstant, #btnManual').remove();

        // Hapus CSS yang nyembunyiin mpay bawaan
        $('#pg-poppay-hide-mpay').remove();
        $('#pg-keep-instant-tab').remove();
        window.__pgQrisSdkBound = false;
        $('#qris-dark-theme').remove();
        if (window.qrisDarkThemeInterval) {
          clearInterval(window.qrisDarkThemeInterval);
          window.qrisDarkThemeInterval = null;
        }

        // Restore form mpay / note bawaan toko (yang kita hide saat ON)
        $('#v-autobank #formDepositAuto, #v-autobank .transaksi-note').each(function () {
          this.style.removeProperty('display');
          $(this).show();
        });

        // Jika tab Instant kita (created) sudah hilang → aktifkan manual toko
        if (!$('#nav-autobank-tab').length && $('#nav-manualtrf-tab').length) {
          $('#nav-manualtrf-tab').addClass('active');
          $('#v-manualtrf').addClass('show active');
        }

        // JANGAN hapus #v-autobank / #nav-autobank-tab bawaan toko
        console.log('[INJECT] Toko Instant/Manual deposit tetap aktif (script PopPay off)');
      } catch (e) {
        console.log('[INJECT] teardown error', e);
      }
    }

    window.__pgTeardownPoppayScript = teardownMpoInjection;

    async function checkPaymentHealth() {
      if (SKIP_STORE_KEY) return true;
      if (!STORE_KEY) {
        console.log('[Deposit is disabled]');
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
        const res = await fetch(`${HEALTH_BASE}/${HEALTH_API_VERSION}/payment-health-v2`, {
          method: 'GET',
          cache: 'no-store',
          headers: {
            Accept: 'application/json',
            'X-Store-Key': STORE_KEY,
          },
        });

        const body = await res.json().catch(() => ({}));
        if (!res.ok || body?.success !== true) {
          console.log('[Deposit is disabled]');
          console.warn('[INJECT] payment-health OFF:', body?.message || `HTTP ${res.status}`);
          paymentHealthCache = false;
          paymentHealthCacheKey = STORE_KEY;
          paymentHealthCacheAt = now;
          return false;
        }

        console.log('[INJECT] payment-health OK');
        paymentHealthCache = true;
        paymentHealthCacheKey = STORE_KEY;
        paymentHealthCacheAt = now;
        return true;
      } catch (err) {
        console.log('[Deposit is disabled]');
        console.warn('[INJECT] payment-health failed (fail-closed):', err?.message || err);
        paymentHealthCache = false;
        paymentHealthCacheKey = STORE_KEY;
        paymentHealthCacheAt = now;
        return false;
      }
    }

    window.__mpoCheckPaymentHealth = checkPaymentHealth;

    const healthOk = await checkPaymentHealth();
    if (!healthOk) {
      // Belum inject → jangan sentuh UI toko. Cuma stop script kita.
      console.log('[Deposit is disabled]');
      console.log('[INJECT] PopPay OFF — skip inject, leave toko deposit as-is');
      window.__PG_DEPOSIT_DISABLED = true;
      if (window.qrisDarkThemeInterval) {
        clearInterval(window.qrisDarkThemeInterval);
        window.qrisDarkThemeInterval = null;
      }
      $('#qris-dark-theme').remove();
      return;
    }
  
    // Helper to load external scripts dynamically
    function loadExternalScript(url) {
      return new Promise((resolve) => {
        if (url.includes('qris-sdk') && typeof window.QrisSDK !== 'undefined') {
          resolve();
          return;
        }
        if (url.includes('qrcode') && typeof window.QRCode !== 'undefined') {
          resolve();
          return;
        }
        const script = document.createElement('script');
        script.src = url;
        script.async = true;
        script.onload = () => {
          console.log(`[INJECT] Loaded: ${url}`);
          resolve();
        };
        script.onerror = () => {
          console.error(`[INJECT] Failed to load: ${url}`);
          resolve(); // Resolve anyway to avoid blocking execution
        };
        document.head.appendChild(script);
      });
    }
  
    // Helper to synchronize visible and hidden inputs
    function syncInputs(showInputId, hiddenInputId) {
      const showInput = document.getElementById(showInputId);
      const hiddenInput = document.getElementById(hiddenInputId);
      if (!showInput || !hiddenInput) return;
  
      const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  
      function formatNumber(val) {
        const num = parseInt(val.toString().replace(/[^0-9]/g, '')) || 0;
        return num > 0 ? num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',') : '';
      }
  
      function cleanNumber(val) {
        return parseInt(val.toString().replace(/[^0-9]/g, '')) || 0;
      }
  
      // Watch programmatic changes on hidden input
      Object.defineProperty(hiddenInput, 'value', {
        get: function () {
          return descriptor.get.call(this);
        },
        set: function (val) {
          descriptor.set.call(this, val);
          const cleanVal = cleanNumber(val);
          const formatted = cleanVal > 0 ? formatNumber(cleanVal) : '';
          descriptor.set.call(showInput, formatted);
        }
      });
  
      // Watch programmatic changes on show input
      Object.defineProperty(showInput, 'value', {
        get: function () {
          return descriptor.get.call(this);
        },
        set: function (val) {
          descriptor.set.call(this, val);
          const cleanVal = cleanNumber(val);
          descriptor.set.call(hiddenInput, cleanVal > 0 ? cleanVal.toString() : '');
        }
      });
  
      // Listen to user input events on show input
      $(showInput).on('input keyup change', function () {
        const val = this.value;
        const cleanVal = cleanNumber(val);
        descriptor.set.call(hiddenInput, cleanVal > 0 ? cleanVal.toString() : '');
      });
    }
  
    // Load external SDKs
    await Promise.all([
      loadExternalScript(QRIS_SDK_URL),
      loadExternalScript("https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js")
    ]);
    console.log('[INJECT] SDK loaded:', QRIS_SDK_URL);
  
    // Safety check: Don't inject if username is not fetched
    const username = await getUsername();
    if (username.startsWith('GUEST-')) {
      console.log(`[INJECT] ❌ Username ${username} gagal inject - GUEST mode not allowed`);
      return;
    }
    console.log(`[INJECT] ✅ Username ${username} inject success`);
  
    function qrisPanelHtml() {
      return '<' + 'div class="qris-manual-wrapper" data-pg-inject="1" style="background: #1a1a1a; padding: 25px; border-radius: 12px; margin-bottom: 25px; box-shadow: 0 4px 12px rgba(0,0,0,0.08);">' +
        '<' + 'div class="qris-manual-header" style="margin-bottom: 20px; padding-bottom: 15px; border-bottom: 2px solid #f0f0f0;">' +
        '<' + 'h5 style="color: #333; font-weight: 600; margin: 0; display: flex; align-items: center;">' +
        '<' + 'i class="fas fa-qrcode" style="margin-right: 10px; color: #4CAF50;"><' + '/i>' +
        'QRIS Payment - Deposit Instant' +
        '<' + '/h5>' +
        '<' + 'p style="color: #666; font-size: 13px; margin: 8px 0 0 0;">Scan QR code dengan e-wallet favorit Anda (DANA, OVO, GoPay, ShopeePay, dll)<' + '/p>' +
        '<' + '/div>' +
        '<' + 'div class="qris-form" id="qrisFormContainer">' +
        '<' + 'form id="formDepositAutoQris" enctype="multipart/form-data" novalidate="novalidate">' +
        '<' + 'input type="hidden" name="bankAuto" id="bankSelectAutoQris" value="QRIS">' +
        '<' + 'div class="form-group mb-3">' +
        '<' + 'label style="color: #555; font-weight: 500; margin-bottom: 8px; display: block;">Jumlah Deposit</' + 'label>' +
        '<' + 'div class="d-flex flex-wrap gap-2 mb-3" style="gap: 10px;">' +
        '<' + 'button type="button" class="btn btn-outline-primary qris-amount-btn" data-amount="10000">Rp 10.000<' + '/button>' +
        '<' + 'button type="button" class="btn btn-outline-primary qris-amount-btn" data-amount="20000">Rp 20.000<' + '/button>' +
        '<' + 'button type="button" class="btn btn-outline-primary qris-amount-btn" data-amount="50000">Rp 50.000<' + '/button>' +
        '<' + 'button type="button" class="btn btn-outline-primary qris-amount-btn" data-amount="100000">Rp 100.000<' + '/button>' +
        '<' + 'button type="button" class="btn btn-outline-primary qris-amount-btn" data-amount="500000">Rp 500.000<' + '/button>' +
        '<' + '/div>' +
        '<' + 'div class="input-group">' +
        '<' + 'div class="input-group-prepend">' +
        '<' + 'span class="input-group-text">Rp<' + '/span>' +
        '<' + '/div>' +
        '<' + 'input class="form-control" type="text" id="depositShowAmountAutoQris" placeholder="Atau masukkan jumlah manual" oninput="this.value=this.value.replace(/[^0-9]/g,\'\');let n=parseInt(this.value)||0;this.value=Math.max(0,n).toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g,\',\');" onkeydown="if(event.key===\'-\'||event.keyCode===189||event.keyCode===109)event.preventDefault();">' +
        '<' + 'input name="amountAuto" id="depositAmountAutoQris" type="hidden" value="">' +
        '<' + '/div>' +
        '<' + 'small class="form-text text-muted">Min: Rp 10.000 | Max: Rp 10.000.000<' + '/small>' +
        '<' + '/div>' +
        '<' + 'button name="deposit" type="submit" class="btn btn-success btn-block" style="padding: 12px; font-weight: 600;">' +
        '<' + 'i class="fas fa-qrcode"><' + '/i> Generate QR Code' +
        '<' + '/button>' +
        '<' + '/form>' +
        '<' + '/div>' +
        '<' + 'div class="qris-result" id="qrisResultContainer" style="display: none; margin-top: 20px;">' +
        '<' + 'div class="text-center">' +
        '<' + 'div id="qris-payment-frame" style="min-height: 400px;"><' + '/div>' +
        '<' + 'div id="payment-result"><' + '/div>' +
        '<' + '/div>' +
        '<' + '/div>' +
        '<' + '/div>';
    }

    function instantTabButtonHtml() {
      return '<' + 'li class="nav-item" data-pg-inject="1" data-pg-created="1">' +
        '<' + 'a class="button-pills nav-link-pm" id="nav-autobank-tab" data-toggle="tab" data-type="Auto" href="#v-autobank" role="tab" aria-controls="nav-autobank" aria-expanded="true" aria-selected="true">' +
        '<' + 'i class="fas fa-wallet"><' + '/i>' +
        '<' + 'span>Instan Deposit<' + '/span>' +
        '<' + '/a>' +
        '<' + '/li>';
    }

    function manualTabButtonHtml() {
      return '<' + 'li class="nav-item" data-pg-inject="1" data-pg-created="1">' +
        '<' + 'a class="button-pills nav-link-pm" id="nav-manualtrf-tab" data-toggle="tab" data-type="Manual" href="#v-manualtrf" role="tab" aria-controls="nav-manualtrf" aria-selected="false">' +
        '<' + 'i class="fas fa-wallet"><' + '/i>' +
        '<' + 'span>Transfer Manual<' + '/span>' +
        '<' + '/a>' +
        '<' + '/li>';
    }

    function isMainDepositWithdrawList($ul) {
      if (!$ul || !$ul.length) return true;
      return $ul.find(
        '#nav-deposit-tab, #nav-withdraw-tab, a[href="#nav-deposit"], a[href="#nav-withdraw"]'
      ).length > 0;
    }

    function findDepositTabList() {
      const $hits = $('#nav-deposit #transactionTabs, #nav-deposit ul.payment-method').filter(function () {
        return !isMainDepositWithdrawList($(this));
      });
      return $hits.first();
    }

    function findDepositTabContent() {
      const $el = $('#nav-deposit #transactionContent');
      if (!$el.length) return $el;
      if ($el.is('#pills-tabContent')) return $();
      if ($el.find('> #nav-deposit, > #nav-withdraw').length) return $();
      return $el.first();
    }

    function removeStrayInstantFromMainPills() {
      $('ul').has('#nav-deposit-tab, #nav-withdraw-tab, a[href="#nav-deposit"]').each(function () {
        $(this).find('#nav-autobank-tab').closest('li').remove();
      });
    }

    function createInstantManualScaffold() {
      const $formWrap = $('#nav-deposit .transaksi-formulir').first();
      if (!$formWrap.length) return false;

      let $tabs = findDepositTabList();
      if (!$tabs.length) {
        $tabs = $('<ul class="component-tabs nav nav-tabs payment-method m-3" id="transactionTabs" data-pg-inject="1"></ul>');
        const $holder = $formWrap.find('.transaksi-payment-holder').first();
        if ($holder.length) $holder.after($tabs);
        else $formWrap.find('.formulir-title').first().after($tabs);
        console.log('[INJECT] Created #transactionTabs inside formulir');
      }

      let $content = findDepositTabContent();
      if (!$content.length) {
        $content = $('<div class="tab-content" id="transactionContent" data-pg-inject="1"></div>');
        $tabs.after($content);
        console.log('[INJECT] Created #transactionContent inside formulir');
      }

      ensureManualTabAndPane($tabs, $content);
      return true;
    }

    function ensureManualTabAndPane($tabs, $content) {
      if (!$tabs || !$tabs.length || !$content || !$content.length) return;

      const $manualForm = $('#nav-deposit #formDepositManual');
      let $pane = $('#nav-deposit #v-manualtrf');

      if (!$pane.length && $manualForm.length) {
        const $note = $manualForm.prev('.transaksi-note');
        $manualForm.wrap('<div class="tab-pane text-white fade" id="v-manualtrf" role="tabpanel" aria-labelledby="v-manualtrf-tab"></div>');
        $pane = $('#v-manualtrf');
        if ($note.length) $pane.prepend($note);
        console.log('[INJECT] Wrapped #formDepositManual into #v-manualtrf');
      }
      if (!$pane.length) {
        $pane = $('<div class="tab-pane text-white fade" id="v-manualtrf" role="tabpanel" aria-labelledby="v-manualtrf-tab"></div>');
        $content.append($pane);
      }
      if ($pane.length && $content.length && $pane[0] && !$.contains($content[0], $pane[0])) {
        $content.append($pane);
      }
      if ($manualForm.length && $pane.length && $manualForm[0] && !$.contains($pane[0], $manualForm[0])) {
        $pane.append($manualForm);
      }

      if (!$tabs.find('#nav-manualtrf-tab').length) {
        $tabs.append(manualTabButtonHtml());
        console.log('[INJECT] Recreate Transfer Manual tab');
      } else if (!$tabs.has($('#nav-manualtrf-tab')).length) {
        $tabs.append($('#nav-manualtrf-tab').closest('li'));
      }
      $tabs.find('#nav-manualtrf-tab').closest('li').show().css({ visibility: 'visible' });
    }

    function bindDepositMethodTabs() {
      $(document).off('click.pgtabs', '#transactionTabs a[data-toggle="tab"]').on('click.pgtabs', '#transactionTabs a[data-toggle="tab"]', function (e) {
        e.preventDefault();
        const target = $(this).attr('href');
        $('#transactionTabs a[data-toggle="tab"]').removeClass('active').attr('aria-selected', 'false');
        $(this).addClass('active').attr('aria-selected', 'true');
        $('#transactionContent > .tab-pane').removeClass('show active');
        $(target).addClass('show active');
      });
    }

    function ensureInstantTabVisible() {
      $('#pg-keep-instant-tab').remove();
      $('<' + 'style' + ' id="pg-keep-instant-tab">')
        .html(
          '#transactionTabs li:has(#nav-autobank-tab), ' +
          '#transactionTabs li:has(#nav-manualtrf-tab) { display: list-item !important; visibility: visible !important; } ' +
          '#transactionTabs #nav-autobank-tab, #transactionTabs #nav-manualtrf-tab { visibility: visible !important; } ' +
          '#transactionContent > .tab-pane { display: none !important; } ' +
          '#transactionContent > .tab-pane.active, #transactionContent > .tab-pane.show.active { display: block !important; }'
        )
        .appendTo('head');

      const $tab = $('#nav-autobank-tab');
      if ($tab.length) {
        $tab.closest('li').show().css({ visibility: 'visible' });
        $tab.css({ visibility: 'visible' });
      }
    }

    function activateInstantTab() {
      $('#nav-manualtrf-tab').removeClass('active').attr('aria-selected', 'false');
      $('#v-manualtrf').removeClass('show active');
      $('#nav-autobank-tab').addClass('active').attr('aria-selected', 'true').attr('aria-expanded', 'true');
      $('#v-autobank').addClass('show active');
    }

    function ensureInstantUi(activate) {
      removeStrayInstantFromMainPills();
      if (!findDepositTabList().length || !findDepositTabContent().length) {
        createInstantManualScaffold();
      }
      const $tabs = findDepositTabList();
      const $content = findDepositTabContent();
      if (!$tabs.length || !$content.length) return false;

      if (!$('#nav-autobank-tab').length) {
        console.log('[INJECT] MPAY off / tab Instant hilang — recreate Instan Deposit tab');
        $tabs.prepend(instantTabButtonHtml());
      } else if (!$tabs.has($('#nav-autobank-tab')).length) {
        $tabs.prepend($('#nav-autobank-tab').closest('li'));
      }
      if (!$('#v-autobank').length) {
        console.log('[INJECT] Pane #v-autobank missing — recreate');
        $content.prepend(
          '<' + 'div class="tab-pane text-white fade" id="v-autobank" data-pg-inject="1" data-pg-created="1" role="tabpanel" aria-labelledby="v-autobank-tab"><' + '/div>'
        );
      } else if (!$content.has($('#v-autobank')).length) {
        $content.prepend($('#v-autobank'));
      }

      ensureManualTabAndPane($tabs, $content);
      bindDepositMethodTabs();
      ensureInstantTabVisible();
      if (activate) activateInstantTab();
      return true;
    }

    function hideNativeMpayForm() {
      $('#pg-poppay-hide-mpay').remove();
      $('<' + 'style' + ' id="pg-poppay-hide-mpay">')
        .html('#v-autobank #formDepositAuto, #v-autobank .transaksi-note { display: none !important; }')
        .appendTo('head');
    }

    function bindQrisAmountButtons() {
      $(document).off('click.pgqris', '.qris-amount-btn').on('click.pgqris', '.qris-amount-btn', function () {
        $('.qris-amount-btn').removeClass('active');
        $(this).addClass('active');
        const amount = parseInt($(this).data('amount'), 10) || 0;
        $('#depositShowAmountAutoQris').val(Math.max(0, amount));
      });
    }

    function initInjectedQrisSdk() {
      if (window.__pgQrisSdkBound) return;
      if (!document.getElementById('formDepositAutoQris')) return;
      window.__pgQrisSdkBound = true;
      setTimeout(function () {
        new QrisSDKCustom({
          formId: 'formDepositAutoQris',
          onSuccess: function (data) {
            console.log('[QRIS AUTO] Payment Success:', data);
          },
          onFailed: function (status) {
            console.log('[QRIS AUTO] Payment Failed:', status);
          }
        });
        console.log('[INJECT] QRIS SDK initialized for injected form');
      }, 400);
    }

    function injectQrisForm() {
      const $pane = $('#v-autobank');
      if (!$pane.length) return false;
      if ($pane.find('#formDepositAutoQris').length) {
        hideNativeMpayForm();
        return true;
      }

      const html = qrisPanelHtml();
      const $nativeForm = $pane.find('form#formDepositAuto');
      if ($nativeForm.length) {
        console.log('[INJECT] Replace MPAY form with PopPay Instant');
        $nativeForm.before(html);
      } else {
        console.log('[INJECT] MPAY form absent — inject PopPay Instant into empty pane');
        $pane.prepend(html);
      }

      hideNativeMpayForm();
      syncInputs('depositShowAmountAutoQris', 'depositAmountAutoQris');
      bindQrisAmountButtons();
      initInjectedQrisSdk();
      return true;
    }

    async function waitForDepositTabs(tries) {
      for (let i = 0; i < (tries || 24); i++) {
        if ($('#nav-deposit .transaksi-formulir').length) return true;
        await new Promise(function (r) { setTimeout(r, 250); });
      }
      return false;
    }

    function startInstantTabGuard() {
      if (window.__pgInstantTabGuard) return;
      window.__pgInstantTabGuard = true;
      const mo = new MutationObserver(function () {
        if (window.__PG_DEPOSIT_DISABLED) return;
        if (!$('#nav-deposit .transaksi-formulir').length) return;
        removeStrayInstantFromMainPills();
        const tabMissing = !$('#transactionTabs #nav-autobank-tab').length;
        const manualTabMissing = !$('#transactionTabs #nav-manualtrf-tab').length;
        const paneMissing = !$('#transactionContent #v-autobank').length;
        const formMissing = !$('#formDepositAutoQris').length;
        if (tabMissing || manualTabMissing || paneMissing || formMissing) {
          if (ensureInstantUi(tabMissing)) injectQrisForm();
        } else {
          ensureInstantTabVisible();
        }
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }

    const tabsReady = await waitForDepositTabs(24);
    if (!tabsReady) {
      console.warn('[INJECT] Deposit tabs not found — retry via observer');
    }

    ensureInstantUi(true);
    injectQrisForm();
    startInstantTabGuard();

    if (typeof amountPicker === 'function') {
      try { amountPicker('Auto'); } catch (e) { }
    }

    console.log('[INJECT SCRIPT] ========== INJECTION PROCESS COMPLETE ==========');
  });
