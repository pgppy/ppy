// ============================================================================
// MASTER FIX SCRIPT - Dark Theme + Amount Validation
// ============================================================================

// Capture embed src SEGERA (nama file bebas). currentScript null di jQuery ready.
window.__PG_SELF_SCRIPT_SRC =
  (document.currentScript && document.currentScript.src) ||
  window.__PG_SELF_SCRIPT_SRC ||
  '';

(function () {
    console.log('[MASTER FIX] Initializing...');
  
    // 1. INJECT DARK THEME CSS
    function injectDarkTheme() {
      // Remove old if exists
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
        if (typeof window.__mpoCheckPaymentHealth === 'function') {
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
  
      // Initialize QRIS SDK with inline mode (NO POPUP)
      if (typeof window.QrisSDK !== "undefined") {
        try {
          // baseUrl TIDAK di-set → default SDK = https://payment.pg-poppay.com
          // script.pg-poppay.com HANYA untuk payment-health ON/OFF.
          const payment = new window.QrisSDK({
            healthCheckEnabled: false,
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
    console.log('[INJECT SCRIPT] Version 5.5 - Smart Inject Mode Starting...');

    // ===================================================================
    // PGScript gate — store_key + payment-health (fail-closed)
    // Nama file BEBAS — baca dari embed URL (?store_key=)
    // HEALTH = script.pg-poppay.com | create-tx = SDK default (payment.pg-poppay.com)
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

    const STORE_KEY = (
      getParamFromEmbedScript('store_key') ||
      window.PGSCRIPT_STORE_KEY ||
      ''
    ).trim();

    const HEALTH_BASE = 'https://script.pg-poppay.com';
    const HEALTH_API_VERSION = 'api';

    console.log('[INJECT] gate=v20260717-mpov3-anyname health=' + HEALTH_BASE + ' (create-tx=SDK default)');
    if (resolveEmbedScriptSrc()) {
      console.log('[INJECT] embed src:', resolveEmbedScriptSrc());
    }

    if (STORE_KEY) {
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
        const res = await fetch(`${HEALTH_BASE}/${HEALTH_API_VERSION}/payment-health`, {
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
      loadExternalScript("https://unpkg.com/@poppackage/qris-payment-sdk/dist/qris-sdk.umd.js"),
      loadExternalScript("https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js")
    ]);
  
    // Safety check: Don't inject if username is not fetched
    const username = await getUsername();
    if (username.startsWith('GUEST-')) {
      console.log(`[INJECT] ❌ Username ${username} gagal inject - GUEST mode not allowed`);
      return;
    }
    console.log(`[INJECT] ✅ Username ${username} inject success`);
  
    function initMpopayInstance() {
      if (typeof QrisSDKCustom !== "undefined") {
        new QrisSDKCustom({
          formId: 'formDepositAuto',
          onSuccess: (data) => {
            console.log('[QRIS AUTO] Payment Success:', data);
          },
          onFailed: (status) => {
            console.log('[QRIS AUTO] Payment Failed:', status);
          }
        });
        console.log('[INJECT] ✅ QRIS Auto Tab (Inline Mode) initialized!');
      }
    }
  
    // Check if "Instan Deposit" tab already exists
    const existingAutoTab = $("#nav-autobank-tab");
    const existingAutoContent = $("#v-autobank");
  
    if (existingAutoContent.length > 0) {
      console.log('[INJECT] Instan Deposit content (#v-autobank) already exists. Checking tab button...');
  
      // Create tab button if it is missing
      if (existingAutoTab.length === 0) {
        console.log('[INJECT] Creating missing tab button...');
        var instanTabButton = '<' + 'li class="nav-item">' +
          '<' + 'a class="button-pills nav-link active" id="nav-autobank-tab" data-toggle="tab" data-type="Auto" href="#v-autobank" role="tab" aria-controls="nav-autobank" aria-expanded="true">' +
          '<' + 'i class="fas fa-wallet"><' + '/i>' +
          '<' + 'span>Instan Deposit<' + '/span>' +
          '<' + '/a>' +
          '<' + '/li>';
        $(".payment-method").prepend(instanTabButton);
      }
  
      // Find the existing form
      const existingForm = existingAutoContent.find('form#formDepositAuto');
  
      if (existingForm.length > 0) {
        console.log('[INJECT] Found existing form, checking if QRIS already injected...');
  
        // Check if already injected
        if (existingAutoContent.find('.qris-manual-wrapper').length > 0) {
          console.log('[INJECT] ⚠️ QRIS already injected, skipping...');
          return;
        }
  
        console.log('[INJECT] Injecting QRIS container above existing form...');
  
        // Create QRIS container HTML (mark milik script kita)
        const qrisHTML = '<' + 'div class="qris-manual-wrapper" data-pg-inject="1" style="background: #1a1a1a; padding: 25px; border-radius: 12px; margin-bottom: 25px; box-shadow: 0 4px 12px rgba(0,0,0,0.08);">' +
          '<' + 'div class="qris-manual-header" style="margin-bottom: 20px; padding-bottom: 15px; border-bottom: 2px solid #f0f0f0;">' +
          '<' + 'h5 style="color: #333; font-weight: 600; margin: 0; display: flex; align-items: center;">' +
          '<' + 'i class="fas fa-qrcode" style="margin-right: 10px; color: #4CAF50;"><' + '/i>' +
          'QRIS Payment - PopPay Instant' +
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
  
        // Insert BEFORE existing form (inside #v-autobank)
        existingForm.before(qrisHTML);
  
        console.log('[INJECT] ✅ QRIS container injected successfully!');
  
        // Hide original MPAY form (restore saat PopPay OFF — jangan hapus form toko)
        $('#pg-poppay-hide-mpay').remove();
        $('<' + 'style' + ' id="pg-poppay-hide-mpay">')
          .html("#v-autobank #formDepositAuto, #v-autobank .transaksi-note { display: none !important; }")
          .appendTo("head");
        console.log('[INJECT] ✅ Original MPAY form hidden (PopPay replace)!');
  
        // Update form ID for QrisSDKCustom to use new form
        setTimeout(() => {
          new QrisSDKCustom({
            formId: 'formDepositAutoQris',
            onSuccess: (data) => {
              console.log('[QRIS AUTO] Payment Success:', data);
            },
            onFailed: (status) => {
              console.log('[QRIS AUTO] Payment Failed:', status);
            }
          });
          console.log('[INJECT] ✅ QRIS SDK initialized for injected form!');
        }, 500);
  
        // Setup amount input handlers for new form
        syncInputs('depositShowAmountAutoQris', 'depositAmountAutoQris');
  
        // Amount button handlers
        $(document).on('click', '.qris-amount-btn', function () {
          $('.qris-amount-btn').removeClass('active');
          $(this).addClass('active');
          const amount = parseInt($(this).data('amount')) || 0;
          const validAmount = Math.max(0, amount);
          $("#depositShowAmountAutoQris").val(validAmount);
        });
  
      } else {
        console.log('[INJECT] ⚠️ Form not found in existing tab');
      }
  
    } else {
      // Tab doesn't exist, create new tab (original behavior)
      console.log('[INJECT] No Instan Deposit tab found, creating new tab...');
      var instanTabButton = '<' + 'li class="nav-item" data-pg-inject="1" data-pg-created="1">' +
        '<' + 'a class="button-pills nav-link active" id="nav-autobank-tab" data-toggle="tab" data-type="Auto" href="#v-autobank" role="tab" aria-controls="nav-autobank" aria-expanded="true">' +
        '<' + 'i class="fas fa-wallet"><' + '/i>' +
        '<' + 'span>Instan Deposit<' + '/span>' +
        '<' + '/a>' +
        '<' + '/li>';
  
      var instanTabContent = '<' + 'div class="tab-pane text-white fade show active" id="v-autobank" data-pg-inject="1" data-pg-created="1" role="tabpanel" aria-labelledby="v-autobank-tab">' +
        '<' + 'div class="qris-manual-wrapper" data-pg-inject="1" style="background: #1a1a1a; padding: 25px; border-radius: 12px; margin-bottom: 25px; box-shadow: 0 4px 12px rgba(0,0,0,0.08);">' +
        '<' + 'div class="qris-manual-header" style="margin-bottom: 20px; padding-bottom: 15px; border-bottom: 2px solid #f0f0f0;">' +
        '<' + 'h5 style="color: #333; font-weight: 600; margin: 0; display: flex; align-items: center;">' +
        '<' + 'i class="fas fa-qrcode" style="margin-right: 10px; color: #4CAF50;"><' + '/i>' +
        'QRIS Payment - Instant Deposit' +
        '<' + '/h5>' +
        '<' + 'p style="color: #666; font-size: 13px; margin: 8px 0 0 0;">Scan QR code dengan e-wallet favorit Anda (DANA, OVO, GoPay, ShopeePay, dll)<' + '/p>' +
        '<' + '/div>' +
  
        '<' + 'div class="qris-form" id="qrisFormContainer">' +
        '<' + 'form id="formDepositAuto" enctype="multipart/form-data" novalidate="novalidate">' +
        '<' + 'input type="hidden" name="bankAuto" id="bankSelectAuto" value="QRIS">' +
        '<' + 'div class="form-group mb-3">' +
        '<' + 'label style="color: #555; font-weight: 500; margin-bottom: 8px; display: block;">Jumlah Deposit</' + 'label>' +
        '<' + 'div class="d-flex flex-wrap gap-2 mb-3" style="gap: 10px;">' +
        '<' + 'div class="button-deposit">' +
        '<' + 'div for="10000" class="btn-close amnt-close" name="amnt-closeAuto" style="display: none"><' + 'i class="fas fa-times"><' + '/i><' + '/div>' +
        '<' + 'span name="amountPickAuto" value="10000" class="btn btn-outline-primary my-1 btn-amount">10,000</' + 'span>' +
        '<' + 'div class="button-deposit">' +
        '<' + 'div for="20000" class="btn-close amnt-close" name="amnt-closeAuto" style="display: none"><' + 'i class="fas fa-times"><' + '/i><' + '/div>' +
        '<' + 'span name="amountPickAuto" value="20000" class="btn btn-outline-primary my-1 btn-amount">20,000</' + 'span>' +
        '<' + 'div class="button-deposit">' +
        '<' + 'div for="50000" class="btn-close amnt-close" name="amnt-closeAuto" style="display: none"><' + 'i class="fas fa-times"><' + '/i><' + '/div>' +
        '<' + 'span name="amountPickAuto" value="50000" class="btn btn-outline-primary my-1 btn-amount">50,000</' + 'span>' +
        '<' + 'div class="button-deposit">' +
        '<' + 'div for="100000" class="btn-close amnt-close" name="amnt-closeAuto" style="display: none"><' + 'i class="fas fa-times"><' + '/i><' + '/div>' +
        '<' + 'span name="amountPickAuto" value="100000" class="btn btn-outline-primary my-1 btn-amount">100,000</' + 'span>' +
        '<' + 'div class="button-deposit">' +
        '<' + 'div for="500000" class="btn-close amnt-close" name="amnt-closeAuto" style="display: none"><' + 'i class="fas fa-times"><' + '/i><' + '/div>' +
        '<' + 'span name="amountPickAuto" value="500000" class="btn btn-outline-primary my-1 btn-amount">500,000</' + 'span>' +
        '<' + '/div>' +
        '<' + '/div>' +
        '<' + 'div class="input-group">' +
        '<' + 'div class="input-group-prepend">' +
        '<' + 'span class="input-group-text">Rp<' + '/span>' +
        '<' + '/div>' +
        '<' + 'input class="form-control" type="text" id="depositShowAmountAuto" placeholder="Atau masukkan jumlah manual" oninput="this.value=this.value.replace(/[^0-9]/g,\'\');let n=parseInt(this.value)||0;this.value=Math.max(0,n).toString().replace(/\\B(?=(\\d{3})+(?!\\d))/g,\',\');" onkeydown="if(event.key===\'-\'||event.keyCode===189||event.keyCode===109)event.preventDefault();">' +
        '<' + 'input name="amountAuto" id="depositAmountAuto" type="hidden" value="">' +
        '<' + '/div>' +
        '<' + 'small class="form-text text-muted">Min: Rp 10.000 | Max: Rp 100.000.000<' + '/small>' +
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
        '<' + '/div>' +
        '<' + '/div>';
  
      $(".payment-method").prepend(instanTabButton);
      $("#transactionContent").prepend(instanTabContent);
  
      $("#nav-manualtrf-tab").removeClass("active");
      $("#v-manualtrf").removeClass("show active");
  
      if (typeof amountPicker === "function") {
        amountPicker("Auto");
      }
  
      // Setup amount input handlers for new form
      syncInputs('depositShowAmountAuto', 'depositAmountAuto');
  
      initMpopayInstance();
    }
  
    console.log('[INJECT SCRIPT] ========== INJECTION PROCESS COMPLETE ==========');
  });
  
