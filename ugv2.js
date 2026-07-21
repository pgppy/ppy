// ============================================================================
// UG QRIS POPPAY INJECTION - Full Replica of injectscript.html
// BOB RESEARCH LABS - v3.1.0 (dark theme)
// ============================================================================

(function() {
    'use strict';
    
    console.log('🚀 [UG-QRIS-POPPAY] Starting v3.1.0 (dark)...');
    
    // ========================================================================
    // Global Amount Setter (Direct onclick - accessible from HTML)
    // ========================================================================
    window.ugSetAmount = function(amount, button) {
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
    // Get Username (STRICT MODE - No Fallback)
    // ========================================================================
    async function getUsername() {
        try {
            // UG specific: find username in DOM
            const allDivs = document.querySelectorAll('div[class*="mb-2"]');
            for (const div of allDivs) {
                const text = div.textContent.trim();
                if (text.length >= 3 && text.length <= 20 && /^[a-zA-Z0-9_]+$/.test(text)) {
                    console.log(`✅ [UG-QRIS] Username found: ${text}`);
                    return text;
                }
            }
            
            // NO FALLBACK - Return null if not found
            console.warn('⚠️ [UG-QRIS] Username NOT found - will NOT inject');
            return null;
        } catch (error) {
            console.error('❌ [UG-QRIS] Error getting username:', error);
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
            const src = current?.src || Array.from(document.querySelectorAll('script[src]'))
                .map((s) => s.src)
                .reverse()
                .find((url) => /ug(script|instant|v2|1)?\.js(\?|$)/i.test(url));
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

        let base = configured || 'https://script.pg-poppay.com';

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
            const res = await fetch(`${PGSCRIPT_BASE}/${PGSCRIPT_API_VERSION}/payment-health`, {
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
        newElement.addEventListener('click', function(e) {
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
                buttonContainer.addEventListener(eventType, function(e) {
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
                    btn.addEventListener(eventType, function(e) {
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
        
        // Load promotions
        populatePromotionSelect().catch(err => {
            console.error('❌ [UG-QRIS] Failed to load promotions:', err);
        });
        
        // Amount input handler - untuk manual typing
        if (amountShow) {
            amountShow.addEventListener('input', function(e) {
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
            amountHidden.addEventListener('input', function(e) {
                // Check promotion min validation when amount changes
                checkPromotionMinAmount();
            });
        }
        
        // Promotion change handler - check min amount
        const promotionSelect = document.getElementById('depositPromotionAutoQris');
        if (promotionSelect) {
            promotionSelect.addEventListener('change', function(e) {
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
        form.addEventListener('submit', async function(e) {
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
                
                // baseUrl TIDAK di-set ke script.pg-poppay.com —
                // server itu cuma untuk payment-health ON/OFF.
                // Create-transaction pakai default SDK (payment.pg-poppay.com).
                const sdkConfig = {
                    healthCheckEnabled: false,
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
            
            const script = document.createElement('script');
            script.src = 'https://unpkg.com/@poppackage/qris-payment-sdk/dist/qris-sdk.umd.js';
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
            document.addEventListener('click', function(e) {
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
