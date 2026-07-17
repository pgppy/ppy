// ============================================================================
// MASTER FIX SCRIPT - Dark Theme + Amount Validation
// ============================================================================
(function () {
  console.log('[MASTER FIX] Initializing...');

  // 1. INJECT DARK THEME CSS
  function injectDarkTheme() {
    // Remove old if exists
    const oldStyle = document.getElementById('qris-dark-theme');
    if (oldStyle) oldStyle.remove();

    const darkThemeCSS = `
            /* Only affect deposit section, not withdraw */
            html body #nav-deposit #v-autobank,
            html body #nav-deposit .qris-manual-wrapper,
            html body #nav-deposit .card,
            html body #nav-deposit .modal-content,
            html body #qrButton,
            html body #containerqris,
            html body .transaksi-form #v-autobank,
            html body .transaksi-form .qris-manual-wrapper {
                background: #1a1a1a !important;
                background-color: #1a1a1a !important;
                color: #ffffff !important;
            }
            html body #v-autobank .qris-manual-header h5,
            html body #v-autobank .qris-manual-header p,
            html body #v-autobank .qris-form label,
            html body #qrButton .qris-manual-header h5,
            html body #qrButton .qris-manual-header p,
            html body #qrButton .qris-form label {
                color: #ffffff !important;
            }
            html body #v-autobank .text-muted,
            html body #qrButton .text-muted {
                color: #aaaaaa !important;
            }
            html body #v-autobank .form-control,
            html body #qrButton .form-control {
                background: #2a2a2a !important;
                background-color: #2a2a2a !important;
                color: #ffffff !important;
                border-color: #444444 !important;
            }
            html body #v-autobank .input-group-text,
            html body #qrButton .input-group-text {
                background: #333333 !important;
                background-color: #333333 !important;
                color: #ffffff !important;
                border-color: #444444 !important;
            }
            html body #v-autobank .btn-outline-primary,
            html body #qrButton .btn-outline-primary,
            .qris-amount-btn {
                color: #ffffff !important;
                border-color: #444444 !important;
                background: #2a2a2a !important;
                background-color: #2a2a2a !important;
            }
            html body #v-autobank .btn-outline-primary:hover,
            html body #v-autobank .btn-outline-primary.active,
            html body #qrButton .btn-outline-primary:hover,
            html body #qrButton .btn-outline-primary.active,
            .qris-amount-btn:hover,
            .qris-amount-btn.active {
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
    if (!this.form) {
      console.log('[QRIS SDK] ⚠️ Form not found:', this.formId);
      return;
    }

    console.log('[QRIS SDK] Initializing form event for:', this.formId);
    
    // Remove form action to prevent default submission
    $(`#${this.formId}`).attr('action', 'javascript:void(0);');
    
    // Attach submit handler with multiple preventDefault mechanisms
    $(`#${this.formId}`).off('submit.qrisSDK').on('submit.qrisSDK', async (e) => {
      // ALWAYS prevent default first
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      
      console.log('[QRIS SDK] Form submit intercepted');
      
      // Check jQuery validation if available
      if (typeof $(this.form).valid === 'function' && !$(this.form).valid()) {
        console.log('[QRIS SDK] ❌ Form validation failed');
        return false;
      }

      const $depoForm = $(`#${this.formId}`);
      
      // Prevent double submission
      if ($depoForm.data("depositSubmitting")) {
        console.log('[QRIS SDK] ⚠️ Already submitting, blocked');
        return false;
      }
      $depoForm.data("depositSubmitting", true);

      const $depoBtn = $depoForm.find('button[type="submit"], input[type="submit"]');
      $depoBtn.prop("disabled", true);

      const amountValue = parseFloat(this.amountInput.value);
      
      // Validate amount
      if (!amountValue || amountValue < 10000) {
        alert('Jumlah deposit minimal Rp 10.000');
        console.log('[QRIS SDK] ❌ Amount validation failed:', amountValue);
        $depoForm.data("depositSubmitting", false);
        $depoBtn.prop("disabled", false);
        return false;
      }

      // Live re-check gate sebelum create QR (OFF = jangan proses)
      if (typeof window.__mpoCheckPaymentHealth === 'function') {
        const liveOk = await window.__mpoCheckPaymentHealth();
        if (!liveOk) {
          console.log('[Deposit is disabled]');
          alert('Deposit otomatis sedang nonaktif. Silakan coba lagi nanti.');
          $depoForm.data("depositSubmitting", false);
          $depoBtn.prop("disabled", false);
          return false;
        }
      }
      
      const randomRefId = 'INV-' + Date.now();
      const bankChannel = this.invoiceInput ? this.invoiceInput.value : 'QRIS';
      const username = await getUsername();

      // Safety check: Block transaction if username is GUEST
      if (username.startsWith('GUEST-')) {
        console.log('[QRIS SDK] ❌ Transaction blocked - Username not authenticated');
        alert('Mohon login terlebih dahulu untuk melakukan deposit.');
        $depoForm.data("depositSubmitting", false);
        $depoBtn.prop("disabled", false);
        return false;
      }

      console.log('[QRIS SDK] ✅ Processing payment:', { amount: amountValue, username, invoice: randomRefId });
      
      // Hide form, show result container
      if (this.formContainer) this.formContainer.style.display = 'none';
      if (this.resultContainer) this.resultContainer.style.display = 'block';

      this.openPayment(amountValue, randomRefId, bankChannel, username);
      
      return false;
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
        const payment = new window.QrisSDK({
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
console.log('[INJECT SCRIPT] Version 5.6 - Smart Inject Mode Starting...');

// ===================================================================
// URL CHECK - Only inject on transaction/deposit page
// ===================================================================
const currentPath = window.location.pathname.toLowerCase();
const currentHash = window.location.hash.toLowerCase();

// Check if we're on deposit page
const isDepositPage = currentPath.includes('/transaction') || 
                     currentPath.includes('/deposit') ||
                     currentHash.includes('#deposit') ||
                     currentHash.includes('#transaction');

if (!isDepositPage) {
  console.log('[INJECT] ⛔ Not on deposit/transaction page, skipping injection');
  console.log('[INJECT] Current path:', currentPath);
  console.log('[INJECT] Current hash:', currentHash);
  return; // Exit early - don't inject
}

console.log('[INJECT] ✅ On deposit/transaction page, proceeding with injection...');

  // ===================================================================
  // PGScript gate — store_key + payment-health (fail-closed)
  // Health HANYA ke script.pg-poppay.com (sama seperti ug1.js)
  // ===================================================================
  let paymentHealthCache = null;
  let paymentHealthCacheKey = '';
  let paymentHealthCacheAt = 0;
  const PAYMENT_HEALTH_CACHE_TTL_MS = 30000;

  function getParamFromCurrentScript(name) {
    try {
      const src =
        (document.currentScript && document.currentScript.src) ||
        $('script[src*="mpo.js"]').last().attr('src') ||
        Array.from(document.querySelectorAll('script[src]'))
          .map((s) => s.src)
          .reverse()
          .find((url) => /mpo\.js(\?|$)/i.test(url)) ||
        '';
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

  const HEALTH_BASE = 'https://script.pg-poppay.com';
  const HEALTH_API_VERSION = 'api';

  console.log('[INJECT] gate=v20260717-mpo health=' + HEALTH_BASE);

  if (STORE_KEY) {
    console.log('[INJECT] store_key loaded from script/config');
  } else {
    console.log('[Deposit is disabled]');
    console.error('[INJECT] ABORT — store_key kosong. Embed: .../mpo.js?store_key=sk_...');
    return;
  }

  function teardownMpoInjection(reason) {
    try {
      console.log('[Deposit is disabled]');
      console.log('[INJECT] 🚫 Auto deposit OFF — teardown UI', reason || '');
      window.__PG_DEPOSIT_DISABLED = true;

      $('#qrButton').remove();
      $('#containerqris').remove();
      $('.qris-manual-wrapper').remove();
      $('.component-tabs').has('#btnInstant').remove();
      $('#btnInstant, #btnManual').remove();
    } catch (e) {
      console.log('[INJECT] teardown error', e);
    }
  }

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

      console.log('[INJECT] ✅ payment-health OK');
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
    teardownMpoInjection('payment-health OFF');
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

  function initQrisSdk() {
    setTimeout(() => {
      if (typeof QrisSDKCustom !== "undefined") {
        new QrisSDKCustom({
          formId: 'formDepositAutoQris',
          onSuccess: (data) => {
            console.log('[QRIS AUTO] Payment Success:', data);
          },
          onFailed: (status) => {
            console.log('[QRIS AUTO] Payment Failed:', status);
          }
        });
        console.log('[INJECT] ✅ QRIS SDK initialized for formDepositAutoQris!');
      }
    }, 1000);
  }

  function setupQrisFormHandlers() {
    // Sync inputs
    syncInputs('depositShowAmountAutoQris', 'depositAmountAutoQris');

    // Amount button click handlers (use delegated events for dynamic content)
    $(document).off('click.qrisAmountBtn', '.qris-amount-btn');
    $(document).on('click.qrisAmountBtn', '.qris-amount-btn', function (e) {
      e.preventDefault();
      console.log('[QRIS] Amount button clicked:', $(this).data('amount'));
      
      $('.qris-amount-btn').removeClass('active');
      $(this).addClass('active');
      
      const amount = parseInt($(this).data('amount')) || 0;
      const validAmount = Math.max(0, amount);
      
      // Format with comma for display
      const formattedAmount = validAmount.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
      
      $("#depositShowAmountAutoQris").val(formattedAmount);
      $("#depositAmountAutoQris").val(validAmount);
      
      console.log('[QRIS] Amount set:', { show: formattedAmount, hidden: validAmount });
    });
    
    // Submit button click handler (additional safety)
    $(document).off('click.qrisSubmitBtn', '#formDepositAutoQris button[type="submit"]');
    $(document).on('click.qrisSubmitBtn', '#formDepositAutoQris button[type="submit"]', function(e) {
      e.preventDefault();
      e.stopPropagation();
      console.log('[QRIS] Submit button clicked - triggering form submit');
      
      // Trigger form submit which will be handled by QrisSDKCustom
      $('#formDepositAutoQris').trigger('submit');
      
      return false;
    });
  }

  // Define QRIS HTML Template (used globally)
  const qrisHTML = '<' + 'div class="qris-manual-wrapper" style="background: #1a1a1a; padding: 25px; border-radius: 12px; margin-bottom: 25px; box-shadow: 0 4px 12px rgba(0,0,0,0.08);">' +
    '<' + 'div class="qris-manual-header" style="margin-bottom: 20px; padding-bottom: 15px; border-bottom: 2px solid #f0f0f0;">' +
    '<' + 'h5 style="color: #fff; font-weight: 600; margin: 0; display: flex; align-items: center;">' +
    '<' + 'i class="fas fa-qrcode" style="margin-right: 10px; color: #4CAF50;"><' + '/i>' +
    'QRIS Payment - PopPay Instant' +
    '<' + '/h5>' +
    '<' + 'p style="color: #ccc; font-size: 13px; margin: 8px 0 0 0;">Scan QR code dengan e-wallet favorit Anda (DANA, OVO, GoPay, ShopeePay, dll)<' + '/p>' +
    '<' + '/div>' +
    '<' + 'div class="qris-form" id="qrisFormContainer">' +
    '<' + 'form id="formDepositAutoQris" action="javascript:void(0);" enctype="multipart/form-data" novalidate="novalidate" onsubmit="return false;">' +
    '<' + 'input type="hidden" name="bankAuto" id="bankSelectAutoQris" value="QRIS">' +
    '<' + 'div class="form-group mb-3">' +
    '<' + 'label style="color: #fff; font-weight: 500; margin-bottom: 8px; display: block;">Jumlah Deposit</' + 'label>' +
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

  // Tab Button HTML Templates with inline styles (Instant active by default)
  const btnInstantHTML = '<' + 'a href="javascript:void(0)" id="btnInstant" class="button-pills nav-link active" style="background: #0d6efd !important; color: #fff !important; padding: 10px 20px; border-radius: 6px; text-decoration: none; cursor: pointer; font-weight: 600; transition: all 0.3s;">🚀 PopPay Instant<' + '/a>';
  const btnManualHTML = '<' + 'a href="javascript:void(0)" id="btnManual" class="button-pills nav-link" style="background: #333 !important; color: #fff !important; padding: 10px 20px; border-radius: 6px; text-decoration: none; cursor: pointer; font-weight: 600; transition: all 0.3s;">🏦 Manual deposit<' + '/a>';

  const componentTabsHTML = '<' + 'div class="component-tabs" style="margin-bottom:10px; display: flex !important; gap: 10px; padding: 10px; background: #2a2a2a; border-radius: 8px;">' +
    btnInstantHTML +
    btnManualHTML +
    '<' + '/div>';

  const qrButtonHTML = '<' + 'div class="transaksi-formulir flip-card" id="qrButton">' +
    '<' + 'div id="containerqris" style="width:100%;">' +
    qrisHTML +
    '<' + '/div>' +
    '<' + '/div>';

  // Function to set default tab state: Instant visible, Manual hidden
  function setDefaultTabState() {
    // Update button states
    $('#btnInstant').addClass('active').css('background', '#0d6efd');
    $('#btnManual').removeClass('active').css('background', '#333');
    
    // Show Instant (QRIS)
    $('#qrButton').css('display', 'block').show();
    $('#containerqris').css('display', 'block').show();
    
    // Store manual DEPOSIT forms reference before hiding (only in transaksi-form container)
    const $transaksiFormContainer = $('.transaksi-form').first();
    if ($transaksiFormContainer.length) {
      window.manualDepositForms = $transaksiFormContainer.find('.transaksi-formulir').not('#qrButton, #containerqris').get();
    }
    
    // Hide ONLY deposit manual forms (be specific to avoid hiding withdraw tab)
    $('#formDepositManual').css('display', 'none').hide();
    $('#v-manualtrf').css('display', 'none').hide();
    
    // Only hide transaksi-formulir inside .transaksi-form container (avoid withdraw tab)
    if ($transaksiFormContainer.length) {
      $transaksiFormContainer.find('.transaksi-formulir').not('#qrButton, #containerqris').css('display', 'none').hide();
    }
    
    console.log('[INJECT] ✅ Default state applied:', {
      instantVisible: $('#qrButton').is(':visible'),
      manualFormsStored: window.manualDepositForms ? window.manualDepositForms.length : 0,
      btnInstantActive: $('#btnInstant').hasClass('active'),
      btnManualActive: $('#btnManual').hasClass('active')
    });
  }

  // Setup Deposit Tab Switching
  function setupDepositTabSwitching() {
    $(document).off('click.mpoDepositTab', '#btnInstant')
      .on('click.mpoDepositTab', '#btnInstant', function (e) {
        e.preventDefault();
        console.log('[TAB SWITCH] Switching to Instant');
        
        // Update button styles
        $('#btnManual').removeClass('active').css('background', '#333');
        $('#btnInstant').addClass('active').css('background', '#0d6efd');
        
        // Hide ONLY deposit manual forms (be specific)
        $('#formDepositManual').css('display', 'none');
        $('#v-manualtrf').css('display', 'none');
        
        // Only hide forms inside .transaksi-form container
        const $transaksiFormContainer = $('.transaksi-form').first();
        if ($transaksiFormContainer.length) {
          $transaksiFormContainer.find('.transaksi-formulir').not('#qrButton, #containerqris').css('display', 'none');
        }
        
        // Show instant deposit
        $('#qrButton').css('display', 'block');
        $('#containerqris').css('display', 'block');
        
        console.log('[TAB SWITCH] ✅ Instant deposit visible, manual hidden');
      });

    $(document).off('click.mpoDepositTabManual', '#btnManual')
      .on('click.mpoDepositTabManual', '#btnManual', function (e) {
        e.preventDefault();
        console.log('[TAB SWITCH] Switching to Manual');
        
        // Update button styles
        $('#btnInstant').removeClass('active').css('background', '#333');
        $('#btnManual').addClass('active').css('background', '#0d6efd');
        
        // Hide instant deposit
        $('#qrButton').css('display', 'none');
        $('#containerqris').css('display', 'none');
        
        // Show ONLY deposit manual forms (be specific - don't touch withdraw)
        let foundCount = 0;
        
        // Show main deposit forms
        if ($('#formDepositManual').length) {
          $('#formDepositManual').css('display', 'block').show();
          foundCount++;
          console.log('[TAB SWITCH] Showing #formDepositManual');
        }
        
        if ($('#v-manualtrf').length) {
          $('#v-manualtrf').css('display', 'block').show();
          foundCount++;
          console.log('[TAB SWITCH] Showing #v-manualtrf');
        }
        
        // Show stored manual forms (only from transaksi-form container)
        if (window.manualDepositForms && window.manualDepositForms.length > 0) {
          window.manualDepositForms.forEach(el => {
            $(el).css('display', 'block').show();
          });
          foundCount += window.manualDepositForms.length;
          console.log(`[TAB SWITCH] Restored ${window.manualDepositForms.length} stored manual form(s)`);
        }
        
        // Fallback: show transaksi-formulir inside transaksi-form container
        const $transaksiFormContainer = $('.transaksi-form').first();
        if ($transaksiFormContainer.length) {
          const $forms = $transaksiFormContainer.find('.transaksi-formulir').not('#qrButton, #containerqris');
          if ($forms.length) {
            $forms.css('display', 'block').show();
            foundCount += $forms.length;
            console.log(`[TAB SWITCH] Showing ${$forms.length} forms from .transaksi-form container`);
          }
        }
        
        if (foundCount === 0) {
          console.warn('[TAB SWITCH] ⚠️ No manual forms found!');
        }
        
        console.log('[TAB SWITCH] ✅ Manual deposit visible (', foundCount, 'elements shown)');
      });
  }

  // Ensure Deposit Tab Buttons
  function ensureDepositTabButtons() {
    // Try to find DEPOSIT section specifically (not withdraw)
    let $transaksiForm = null;
    
    // Method 1: Look for deposit tab content area
    const $depositTab = $('#nav-deposit, .tab-pane:has(#formDepositManual), .tab-pane:has(form[name*="deposit"]i)').first();
    if ($depositTab.length) {
      $transaksiForm = $depositTab.find('.transaksi-form').first();
      if (!$transaksiForm.length) {
        $transaksiForm = $depositTab;
      }
      console.log('[INJECT] Found deposit tab via deposit-specific selector');
    }
    
    // Method 2: Look for .transaksi-form that contains deposit form
    if (!$transaksiForm || !$transaksiForm.length) {
      $('.transaksi-form').each(function() {
        if ($(this).find('#formDepositManual, form[action*="transaction"]').length > 0) {
          $transaksiForm = $(this);
          console.log('[INJECT] Found deposit form container via deposit form selector');
          return false; // break
        }
      });
    }
    
    // Method 3: Fallback to first .transaksi-form
    if (!$transaksiForm || !$transaksiForm.length) {
      $transaksiForm = $('.transaksi-form').first();
      console.log('[INJECT] Using first .transaksi-form as fallback');
    }

    if (!$transaksiForm || !$transaksiForm.length) {
      console.log('[INJECT] ⚠️ No suitable container found for tab buttons');
      console.log('[INJECT] Available elements:', {
        forms: $('form').length,
        depositForms: $('form[action*="transaction"], #formDepositManual').length,
        transaksiForm: $('.transaksi-form').length
      });
      return;
    }
    
    console.log('[INJECT] ✅ Found container:', $transaksiForm.attr('class') || $transaksiForm[0].tagName);

    let $componentTabs = $transaksiForm.find('.component-tabs').first();
    
    if (!$componentTabs.length) {
      console.log('[INJECT] Creating .component-tabs');
      const $insertBefore = $transaksiForm.find('.transaksi-formulir, #qrButton').first();
      if ($insertBefore.length) {
        $insertBefore.before(componentTabsHTML);
      } else {
        $transaksiForm.prepend(componentTabsHTML);
      }
      $componentTabs = $transaksiForm.find('.component-tabs').first();
    }

    if ($('#btnInstant').length === 0) {
      console.log('[INJECT] Adding btnInstant');
      $componentTabs.prepend(btnInstantHTML);
    }

    // Check if manual deposit form exists (before we create #qrButton)
    const hasManualForm = $('#formDepositManual').length > 0 || 
                         $('#v-manualtrf').length > 0 || 
                         $('.transaksi-formulir').not('#qrButton, #containerqris').length > 0;
    
    if ($('#btnManual').length === 0) {
      if (hasManualForm) {
        console.log('[INJECT] Adding btnManual (manual form detected)');
        $componentTabs.append(btnManualHTML);
      } else {
        console.log('[INJECT] ℹ️ No manual form found, only Instant button');
      }
    }

    if (!$('#qrButton').length) {
      console.log('[INJECT] Creating #qrButton container');
      $componentTabs.after(qrButtonHTML);
    } else {
      if ($('#containerqris').length && !$('#containerqris').find('.qris-manual-wrapper').length) {
        console.log('[INJECT] Injecting QRIS into existing #containerqris');
        $('#containerqris').html(qrisHTML);
      }
    }
    
    // ALWAYS set correct default state after injection (regardless of new or existing)
    console.log('[INJECT] Setting default state...');
    setDefaultTabState();
  }

  // ===================================================================
  // OLD TAB INJECTION SYSTEM - DISABLED
  // Now using component-tabs approach (ensureDepositTabButtons)
  // ===================================================================
  console.log('[INJECT] ℹ️ Old tab system disabled - using component-tabs approach');

  // Global form submit interceptor as safety net
  function setupFormSubmitInterceptor() {
    $(document).off('submit.qrisGlobal', '#formDepositAutoQris');
    $(document).on('submit.qrisGlobal', '#formDepositAutoQris', function(e) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      console.log('[QRIS INTERCEPTOR] Global submit blocked');
      return false;
    });
    
    console.log('[QRIS INTERCEPTOR] ✅ Global form interceptor active');
  }

  // Initialize all components (dark theme already running from MASTER FIX SCRIPT)
  setupFormSubmitInterceptor();
  ensureDepositTabButtons();
  setupDepositTabSwitching();
  setupQrisFormHandlers();
  initQrisSdk();
  
  // Force set default state after a short delay to ensure DOM is ready and override any website scripts
  setTimeout(() => {
    setDefaultTabState();
    console.log('[INJECT] ✅ Default state forcefully re-applied after 500ms');
  }, 500);
  
  // Double-check after 1 second (in case website has delayed scripts)
  setTimeout(() => {
    if ($('#btnManual').hasClass('active') || !$('#qrButton').is(':visible')) {
      console.log('[INJECT] ⚠️ State was overridden, re-applying...');
      setDefaultTabState();
    }
  }, 1000);

  console.log('[INJECT SCRIPT] ========== INJECTION PROCESS COMPLETE ==========');
});
