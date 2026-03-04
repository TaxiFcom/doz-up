/**
 * DOZ UP - Internationalization (i18n) Engine
 * Enterprise-level multi-language support for 13 languages
 */

window.DOZi18n = (function() {
    'use strict';

    // Supported languages with metadata
    const SUPPORTED_LANGUAGES = {
        en: { name: 'English', nativeName: 'English', flag: '🇺🇸', dir: 'ltr' },
        zh: { name: 'Chinese', nativeName: '中文', flag: '🇨🇳', dir: 'ltr' },
        hi: { name: 'Hindi', nativeName: 'हिन्दी', flag: '🇮🇳', dir: 'ltr' },
        es: { name: 'Spanish', nativeName: 'Español', flag: '🇪🇸', dir: 'ltr' },
        fr: { name: 'French', nativeName: 'Français', flag: '🇫🇷', dir: 'ltr' },
        ar: { name: 'Arabic', nativeName: 'العربية', flag: '🇸🇦', dir: 'rtl' },
        bn: { name: 'Bengali', nativeName: 'বাংলা', flag: '🇧🇩', dir: 'ltr' },
        pt: { name: 'Portuguese', nativeName: 'Português', flag: '🇧🇷', dir: 'ltr' },
        ru: { name: 'Russian', nativeName: 'Русский', flag: '🇷🇺', dir: 'ltr' },
        ja: { name: 'Japanese', nativeName: '日本語', flag: '🇯🇵', dir: 'ltr' },
        de: { name: 'German', nativeName: 'Deutsch', flag: '🇩🇪', dir: 'ltr' },
        ko: { name: 'Korean', nativeName: '한국어', flag: '🇰🇷', dir: 'ltr' },
        it: { name: 'Italian', nativeName: 'Italiano', flag: '🇮🇹', dir: 'ltr' }
    };

    // Cache settings
    const CACHE_KEY_PREFIX = 'doz_i18n_';
    const CACHE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours
    const PREFERENCE_KEY = 'doz_language';

    // State
    let currentLang = 'en';
    let translations = {};
    let isInitialized = false;

    /**
     * Detect user's preferred language
     * Priority: 1) Stored preference, 2) Browser language, 3) Default (en)
     */
    function detectLanguage() {
        // Check stored preference
        const stored = localStorage.getItem(PREFERENCE_KEY);
        if (stored && SUPPORTED_LANGUAGES[stored]) {
            return stored;
        }

        // Check browser language
        const browserLang = navigator.language || navigator.userLanguage;
        if (browserLang) {
            // Try exact match first (e.g., 'zh-CN')
            const exactLang = browserLang.toLowerCase();
            if (SUPPORTED_LANGUAGES[exactLang]) {
                return exactLang;
            }

            // Try language code only (e.g., 'zh' from 'zh-CN')
            const langCode = browserLang.split('-')[0].toLowerCase();
            if (SUPPORTED_LANGUAGES[langCode]) {
                return langCode;
            }
        }

        // Default to English
        return 'en';
    }

    /**
     * Load translations for a language
     * Uses cache with expiry, falls back to server
     */
    async function loadTranslations(lang) {
        if (!SUPPORTED_LANGUAGES[lang]) {
            console.warn(`[i18n] Unsupported language: ${lang}, falling back to English`);
            lang = 'en';
        }

        // Check cache
        const cacheKey = CACHE_KEY_PREFIX + lang;
        const cached = localStorage.getItem(cacheKey);

        if (cached) {
            try {
                const { data, timestamp } = JSON.parse(cached);
                const age = Date.now() - timestamp;

                if (age < CACHE_EXPIRY_MS) {
                    translations = data;
                    console.log(`[i18n] Loaded ${lang} from cache (age: ${Math.round(age / 60000)}min)`);
                    return true;
                }
            } catch (e) {
                console.warn('[i18n] Cache parse error:', e);
            }
        }

        // Fetch from server
        try {
            const response = await fetch(`/api/i18n/${lang}`);

            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }

            const data = await response.json();
            translations = data;

            // Cache the translations
            localStorage.setItem(cacheKey, JSON.stringify({
                data: data,
                timestamp: Date.now()
            }));

            console.log(`[i18n] Loaded ${lang} from server (${Object.keys(data).length} strings)`);
            return true;
        } catch (error) {
            console.error(`[i18n] Failed to load ${lang}:`, error);

            // If not English, try to fall back
            if (lang !== 'en') {
                console.log('[i18n] Falling back to English');
                return loadTranslations('en');
            }

            return false;
        }
    }

    /**
     * Get a translation by key with optional placeholder replacement
     * @param {string} key - Translation key (e.g., 'nav.home')
     * @param {object} params - Optional placeholder values (e.g., {count: 5})
     * @returns {string} Translated text
     */
    function t(key, params = {}) {
        let text = translations[key];

        if (!text) {
            console.warn(`[i18n] Missing translation: ${key}`);
            return key;
        }

        // Replace placeholders like {count}, {name}, etc.
        if (params && typeof params === 'object') {
            Object.keys(params).forEach(param => {
                text = text.replace(new RegExp(`\\{${param}\\}`, 'g'), params[param]);
            });
        }

        return text;
    }

    /**
     * Translate all elements with data-i18n attribute
     */
    function translatePage() {
        // Translate text content
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            const params = el.getAttribute('data-i18n-params');

            let parsedParams = {};
            if (params) {
                try {
                    parsedParams = JSON.parse(params);
                } catch (e) {
                    console.warn('[i18n] Invalid params:', params);
                }
            }

            const translated = t(key, parsedParams);
            if (translated !== key) {
                el.textContent = translated;
            }
        });

        // Translate placeholders
        document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            const translated = t(key);
            if (translated !== key) {
                el.placeholder = translated;
            }
        });

        // Translate titles (tooltips)
        document.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            const translated = t(key);
            if (translated !== key) {
                el.title = translated;
            }
        });

        // Translate aria-labels
        document.querySelectorAll('[data-i18n-aria]').forEach(el => {
            const key = el.getAttribute('data-i18n-aria');
            const translated = t(key);
            if (translated !== key) {
                el.setAttribute('aria-label', translated);
            }
        });

        // Update document direction for RTL languages
        const langInfo = SUPPORTED_LANGUAGES[currentLang];
        if (langInfo) {
            document.documentElement.dir = langInfo.dir;
            document.documentElement.lang = currentLang;
        }

        // Dispatch event for custom handling
        document.dispatchEvent(new CustomEvent('doz:languageChanged', {
            detail: { language: currentLang, translations }
        }));
    }

    /**
     * Create and inject the language selector UI
     * NOTE: Disabled - language is now auto-detected from browser/location
     */
    function createLanguageSelector() {
        // Language selector UI disabled - auto-detection only
        // Language is detected from browser's Accept-Language header
        return;

        // Check if selector already exists
        if (document.getElementById('doz-language-selector')) {
            return;
        }

        const langInfo = SUPPORTED_LANGUAGES[currentLang];

        const selector = document.createElement('div');
        selector.id = 'doz-language-selector';
        selector.className = 'doz-lang-selector';
        selector.innerHTML = `
            <button class="doz-lang-btn" onclick="DOZi18n.toggleSelector()" aria-label="Select language">
                <span class="doz-lang-flag">${langInfo.flag}</span>
                <span class="doz-lang-name">${langInfo.nativeName}</span>
                <svg class="doz-lang-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
            </button>
            <div class="doz-lang-dropdown" id="doz-lang-dropdown">
                ${Object.entries(SUPPORTED_LANGUAGES).map(([code, info]) => `
                    <button class="doz-lang-option ${code === currentLang ? 'active' : ''}"
                            onclick="DOZi18n.setLanguage('${code}')"
                            data-lang="${code}">
                        <span class="doz-lang-flag">${info.flag}</span>
                        <span class="doz-lang-native">${info.nativeName}</span>
                        <span class="doz-lang-english">${info.name}</span>
                        ${code === currentLang ? '<svg class="doz-lang-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>' : ''}
                    </button>
                `).join('')}
            </div>
        `;

        // Add styles if not already added
        if (!document.getElementById('doz-i18n-styles')) {
            const styles = document.createElement('style');
            styles.id = 'doz-i18n-styles';
            styles.textContent = `
                .doz-lang-selector {
                    position: relative;
                    display: inline-block;
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                    z-index: 9990;
                }

                .doz-lang-btn {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    padding: 8px 12px;
                    background: var(--bg-card, rgba(255, 255, 255, 0.1));
                    border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
                    border-radius: 10px;
                    color: var(--text-primary, #fff);
                    font-size: 14px;
                    cursor: pointer;
                    transition: all 0.2s ease;
                }

                .doz-lang-btn:hover {
                    background: var(--bg-card-hover, rgba(255, 255, 255, 0.15));
                    border-color: var(--primary, #10b981);
                }

                .doz-lang-flag {
                    font-size: 18px;
                    line-height: 1;
                }

                .doz-lang-name {
                    font-weight: 500;
                }

                .doz-lang-arrow {
                    transition: transform 0.2s ease;
                }

                .doz-lang-selector.open .doz-lang-arrow {
                    transform: rotate(180deg);
                }

                .doz-lang-dropdown {
                    position: absolute;
                    top: calc(100% + 8px);
                    right: 0;
                    min-width: 220px;
                    max-height: 400px;
                    overflow-y: auto;
                    background: var(--bg-card, rgba(26, 26, 46, 0.98));
                    border: 1px solid var(--border, rgba(255, 255, 255, 0.1));
                    border-radius: 12px;
                    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
                    opacity: 0;
                    visibility: hidden;
                    transform: translateY(-10px);
                    transition: all 0.2s ease;
                    backdrop-filter: blur(20px);
                    -webkit-backdrop-filter: blur(20px);
                }

                .doz-lang-selector.open .doz-lang-dropdown {
                    opacity: 1;
                    visibility: visible;
                    transform: translateY(0);
                }

                .doz-lang-option {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    width: 100%;
                    padding: 12px 16px;
                    background: transparent;
                    border: none;
                    color: var(--text-primary, #fff);
                    font-size: 14px;
                    text-align: left;
                    cursor: pointer;
                    transition: background 0.15s ease;
                }

                .doz-lang-option:first-child {
                    border-radius: 11px 11px 0 0;
                }

                .doz-lang-option:last-child {
                    border-radius: 0 0 11px 11px;
                }

                .doz-lang-option:hover {
                    background: var(--bg-card-hover, rgba(255, 255, 255, 0.1));
                }

                .doz-lang-option.active {
                    background: rgba(16, 185, 129, 0.15);
                }

                .doz-lang-native {
                    flex: 1;
                    font-weight: 500;
                }

                .doz-lang-english {
                    font-size: 12px;
                    color: var(--text-secondary, #94a3b8);
                }

                .doz-lang-check {
                    color: #10b981;
                }

                /* Light theme adjustments */
                [data-theme="light"] .doz-lang-btn {
                    background: rgba(0, 0, 0, 0.05);
                    border-color: rgba(0, 0, 0, 0.1);
                    color: #1a1a2e;
                }

                [data-theme="light"] .doz-lang-btn:hover {
                    background: rgba(0, 0, 0, 0.08);
                }

                [data-theme="light"] .doz-lang-dropdown {
                    background: rgba(255, 255, 255, 0.98);
                    border-color: rgba(0, 0, 0, 0.1);
                }

                [data-theme="light"] .doz-lang-option {
                    color: #1a1a2e;
                }

                [data-theme="light"] .doz-lang-option:hover {
                    background: rgba(0, 0, 0, 0.05);
                }

                /* RTL adjustments */
                [dir="rtl"] .doz-lang-dropdown {
                    right: auto;
                    left: 0;
                }

                [dir="rtl"] .doz-lang-btn {
                    flex-direction: row-reverse;
                }

                /* Scrollbar for dropdown */
                .doz-lang-dropdown::-webkit-scrollbar {
                    width: 6px;
                }

                .doz-lang-dropdown::-webkit-scrollbar-track {
                    background: transparent;
                }

                .doz-lang-dropdown::-webkit-scrollbar-thumb {
                    background: rgba(255, 255, 255, 0.2);
                    border-radius: 3px;
                }
            `;
            document.head.appendChild(styles);
        }

        // Find a good place to insert the selector
        const headerRight = document.querySelector('.header-right, .header-actions, .nav-right, header .actions');
        const themeToggle = document.querySelector('.theme-toggle');

        if (headerRight) {
            headerRight.insertBefore(selector, headerRight.firstChild);
        } else if (themeToggle) {
            themeToggle.parentNode.insertBefore(selector, themeToggle);
        } else {
            // Create fixed position selector
            selector.style.cssText = 'position: fixed; top: 20px; right: 20px;';
            document.body.appendChild(selector);
        }

        // Close dropdown when clicking outside
        document.addEventListener('click', (e) => {
            if (!selector.contains(e.target)) {
                selector.classList.remove('open');
            }
        });
    }

    /**
     * Toggle the language selector dropdown
     */
    function toggleSelector() {
        const selector = document.getElementById('doz-language-selector');
        if (selector) {
            selector.classList.toggle('open');
        }
    }

    /**
     * Set the current language
     * @param {string} lang - Language code (e.g., 'es', 'zh')
     */
    async function setLanguage(lang) {
        if (!SUPPORTED_LANGUAGES[lang]) {
            console.error(`[i18n] Invalid language: ${lang}`);
            return false;
        }

        // Save preference
        localStorage.setItem(PREFERENCE_KEY, lang);
        currentLang = lang;

        // Load translations
        const loaded = await loadTranslations(lang);
        if (!loaded) {
            return false;
        }

        // Translate page
        translatePage();

        // Update selector UI
        updateSelectorUI();

        // Close dropdown
        const selector = document.getElementById('doz-language-selector');
        if (selector) {
            selector.classList.remove('open');
        }

        console.log(`[i18n] Language changed to: ${lang}`);
        return true;
    }

    /**
     * Update the language selector UI to reflect current language
     */
    function updateSelectorUI() {
        const langInfo = SUPPORTED_LANGUAGES[currentLang];
        if (!langInfo) return;

        // Update button
        const btn = document.querySelector('.doz-lang-btn');
        if (btn) {
            btn.querySelector('.doz-lang-flag').textContent = langInfo.flag;
            btn.querySelector('.doz-lang-name').textContent = langInfo.nativeName;
        }

        // Update dropdown options
        document.querySelectorAll('.doz-lang-option').forEach(option => {
            const isActive = option.dataset.lang === currentLang;
            option.classList.toggle('active', isActive);

            // Add/remove check mark
            const existingCheck = option.querySelector('.doz-lang-check');
            if (isActive && !existingCheck) {
                const check = document.createElement('svg');
                check.className = 'doz-lang-check';
                check.setAttribute('width', '16');
                check.setAttribute('height', '16');
                check.setAttribute('viewBox', '0 0 24 24');
                check.setAttribute('fill', 'none');
                check.setAttribute('stroke', 'currentColor');
                check.setAttribute('stroke-width', '2');
                check.innerHTML = '<polyline points="20 6 9 17 4 12"></polyline>';
                option.appendChild(check);
            } else if (!isActive && existingCheck) {
                existingCheck.remove();
            }
        });
    }

    /**
     * Clear translation cache
     * @param {string} lang - Specific language to clear, or all if not specified
     */
    function clearCache(lang = null) {
        if (lang) {
            localStorage.removeItem(CACHE_KEY_PREFIX + lang);
            console.log(`[i18n] Cleared cache for ${lang}`);
        } else {
            Object.keys(SUPPORTED_LANGUAGES).forEach(l => {
                localStorage.removeItem(CACHE_KEY_PREFIX + l);
            });
            console.log('[i18n] Cleared all language caches');
        }
    }

    /**
     * Initialize the i18n system
     */
    async function init() {
        if (isInitialized) {
            console.log('[i18n] Already initialized');
            return;
        }

        console.log('[i18n] Initializing...');

        // Detect language
        currentLang = detectLanguage();
        console.log(`[i18n] Detected language: ${currentLang}`);

        // Load translations
        await loadTranslations(currentLang);

        // Translate page
        translatePage();

        // Create language selector
        createLanguageSelector();

        isInitialized = true;
        console.log('[i18n] Initialization complete');
    }

    /**
     * Get list of supported languages
     */
    function getSupportedLanguages() {
        return { ...SUPPORTED_LANGUAGES };
    }

    /**
     * Get current language code
     */
    function getCurrentLanguage() {
        return currentLang;
    }

    /**
     * Get current language info
     */
    function getCurrentLanguageInfo() {
        return SUPPORTED_LANGUAGES[currentLang];
    }

    // Public API
    return {
        init,
        t,
        setLanguage,
        getCurrentLanguage,
        getCurrentLanguageInfo,
        getSupportedLanguages,
        translatePage,
        toggleSelector,
        clearCache
    };
})();

// Auto-initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        DOZi18n.init();
    });
} else {
    DOZi18n.init();
}
