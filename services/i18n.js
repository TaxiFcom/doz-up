/**
 * DOZ UP - Internationalization (i18n) Service
 * Server-side translation management and AI translation
 */

const fs = require('fs');
const path = require('path');

// Data directory for translations
const I18N_DIR = path.join(__dirname, '..', 'data', 'i18n');

// Supported languages
const SUPPORTED_LANGUAGES = {
    en: { name: 'English', nativeName: 'English', dir: 'ltr' },
    zh: { name: 'Chinese', nativeName: '中文', dir: 'ltr' },
    hi: { name: 'Hindi', nativeName: 'हिन्दी', dir: 'ltr' },
    es: { name: 'Spanish', nativeName: 'Español', dir: 'ltr' },
    fr: { name: 'French', nativeName: 'Français', dir: 'ltr' },
    ar: { name: 'Arabic', nativeName: 'العربية', dir: 'rtl' },
    bn: { name: 'Bengali', nativeName: 'বাংলা', dir: 'ltr' },
    pt: { name: 'Portuguese', nativeName: 'Português', dir: 'ltr' },
    ru: { name: 'Russian', nativeName: 'Русский', dir: 'ltr' },
    ja: { name: 'Japanese', nativeName: '日本語', dir: 'ltr' },
    de: { name: 'German', nativeName: 'Deutsch', dir: 'ltr' },
    ko: { name: 'Korean', nativeName: '한국어', dir: 'ltr' },
    it: { name: 'Italian', nativeName: 'Italiano', dir: 'ltr' }
};

// Translation cache (in-memory)
const translationCache = {};

// Ensure i18n directory exists
function ensureI18nDir() {
    if (!fs.existsSync(I18N_DIR)) {
        fs.mkdirSync(I18N_DIR, { recursive: true });
        console.log('[i18n] Created i18n directory:', I18N_DIR);
    }
}

/**
 * Get translations for a specific language
 * @param {string} lang - Language code (e.g., 'es', 'zh')
 * @returns {object} Translation dictionary
 */
function getTranslations(lang) {
    // Validate language
    if (!SUPPORTED_LANGUAGES[lang]) {
        console.warn(`[i18n] Unsupported language: ${lang}`);
        lang = 'en';
    }

    // Check cache first
    if (translationCache[lang]) {
        return translationCache[lang];
    }

    ensureI18nDir();

    const filePath = path.join(I18N_DIR, `${lang}.json`);

    try {
        if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, 'utf-8');
            const translations = JSON.parse(content);
            translationCache[lang] = translations;
            console.log(`[i18n] Loaded ${lang} translations (${Object.keys(translations).length} strings)`);
            return translations;
        }
    } catch (error) {
        console.error(`[i18n] Error loading ${lang}:`, error.message);
    }

    // If translation file doesn't exist, return English as fallback
    if (lang !== 'en') {
        console.log(`[i18n] Translation file not found for ${lang}, using English`);
        return getTranslations('en');
    }

    // Return empty object if no translations found
    return {};
}

/**
 * Save translations for a language
 * @param {string} lang - Language code
 * @param {object} translations - Translation dictionary
 */
function saveTranslations(lang, translations) {
    if (!SUPPORTED_LANGUAGES[lang]) {
        throw new Error(`Unsupported language: ${lang}`);
    }

    ensureI18nDir();

    const filePath = path.join(I18N_DIR, `${lang}.json`);

    try {
        fs.writeFileSync(filePath, JSON.stringify(translations, null, 2), 'utf-8');
        translationCache[lang] = translations;
        console.log(`[i18n] Saved ${lang} translations (${Object.keys(translations).length} strings)`);
        return true;
    } catch (error) {
        console.error(`[i18n] Error saving ${lang}:`, error.message);
        return false;
    }
}

/**
 * AI Translation using built-in translation logic
 * Falls back to simple dictionary-based translation for common terms
 * @param {string} text - Text to translate
 * @param {string} targetLang - Target language code
 * @param {string} sourceLang - Source language code (default: 'en')
 * @returns {Promise<string>} Translated text
 */
async function translateText(text, targetLang, sourceLang = 'en') {
    // For now, return the original text
    // In production, this would connect to a translation API
    // (Google Translate, DeepL, Azure Translator, or AI model)

    // Simple placeholder - actual implementation would use API
    console.log(`[i18n] Translation requested: "${text.substring(0, 50)}..." to ${targetLang}`);
    return text;
}

/**
 * Batch translate multiple strings
 * @param {object} strings - Dictionary of key: text pairs
 * @param {string} targetLang - Target language code
 * @returns {Promise<object>} Translated dictionary
 */
async function batchTranslate(strings, targetLang) {
    const result = {};

    // In production, this would batch translate via API
    // For now, return original strings
    for (const [key, value] of Object.entries(strings)) {
        result[key] = await translateText(value, targetLang);
    }

    return result;
}

/**
 * Detect language from text
 * @param {string} text - Text to analyze
 * @returns {string} Detected language code
 */
function detectLanguage(text) {
    // Simple detection based on character patterns
    // In production, use a proper language detection API

    // Check for CJK characters (Chinese, Japanese, Korean)
    if (/[\u4e00-\u9fff]/.test(text)) return 'zh';
    if (/[\u3040-\u309f\u30a0-\u30ff]/.test(text)) return 'ja';
    if (/[\uac00-\ud7af]/.test(text)) return 'ko';

    // Check for Arabic
    if (/[\u0600-\u06ff]/.test(text)) return 'ar';

    // Check for Devanagari (Hindi)
    if (/[\u0900-\u097f]/.test(text)) return 'hi';

    // Check for Bengali
    if (/[\u0980-\u09ff]/.test(text)) return 'bn';

    // Check for Cyrillic (Russian)
    if (/[\u0400-\u04ff]/.test(text)) return 'ru';

    // Default to English
    return 'en';
}

/**
 * Detect language from HTTP request
 * @param {object} req - Express request object
 * @returns {string} Detected language code
 */
function detectLanguageFromRequest(req) {
    // Check Accept-Language header
    const acceptLang = req.headers['accept-language'];

    if (acceptLang) {
        // Parse Accept-Language header (e.g., "en-US,en;q=0.9,es;q=0.8")
        const languages = acceptLang.split(',').map(part => {
            const [lang, q] = part.trim().split(';q=');
            return {
                code: lang.split('-')[0].toLowerCase(),
                quality: q ? parseFloat(q) : 1.0
            };
        });

        // Sort by quality and find first supported language
        languages.sort((a, b) => b.quality - a.quality);

        for (const lang of languages) {
            if (SUPPORTED_LANGUAGES[lang.code]) {
                return lang.code;
            }
        }
    }

    // Default to English
    return 'en';
}

/**
 * Get list of supported languages with metadata
 * @returns {object} Supported languages dictionary
 */
function getSupportedLanguages() {
    return { ...SUPPORTED_LANGUAGES };
}

/**
 * Check if a language is supported
 * @param {string} lang - Language code
 * @returns {boolean}
 */
function isSupported(lang) {
    return !!SUPPORTED_LANGUAGES[lang];
}

/**
 * Get translation coverage for a language (percentage of keys translated)
 * @param {string} lang - Language code
 * @returns {object} Coverage info
 */
function getTranslationCoverage(lang) {
    const enTranslations = getTranslations('en');
    const langTranslations = getTranslations(lang);

    const totalKeys = Object.keys(enTranslations).length;
    const translatedKeys = Object.keys(langTranslations).length;

    return {
        language: lang,
        totalKeys,
        translatedKeys,
        missingKeys: totalKeys - translatedKeys,
        coverage: totalKeys > 0 ? Math.round((translatedKeys / totalKeys) * 100) : 0
    };
}

/**
 * Clear translation cache
 * @param {string} lang - Optional specific language to clear
 */
function clearCache(lang = null) {
    if (lang) {
        delete translationCache[lang];
        console.log(`[i18n] Cleared cache for ${lang}`);
    } else {
        Object.keys(translationCache).forEach(key => {
            delete translationCache[key];
        });
        console.log('[i18n] Cleared all translation caches');
    }
}

// Export service functions
module.exports = {
    getTranslations,
    saveTranslations,
    translateText,
    batchTranslate,
    detectLanguage,
    detectLanguageFromRequest,
    getSupportedLanguages,
    isSupported,
    getTranslationCoverage,
    clearCache,
    SUPPORTED_LANGUAGES,
    I18N_DIR
};
