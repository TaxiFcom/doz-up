/**
 * DOZ UP - Interactive Onboarding Tour System
 * Guides new users through the platform with step-by-step tooltips
 */

window.DOZOnboarding = (function() {
    'use strict';

    // Storage key for tracking completion
    const STORAGE_KEY = 'doz_onboarding_complete';
    const STEP_KEY = 'doz_onboarding_step';

    // Tour configuration
    let config = {
        autoStart: true,
        skipOnMobile: false,
        mobileBreakpoint: 768,
        animationDuration: 300,
        overlayColor: 'rgba(0, 0, 0, 0.75)'
    };

    // Current state
    let currentStep = 0;
    let steps = [];
    let isActive = false;
    let elements = {};

    // Default tour steps (can be customized per page)
    const defaultSteps = [
        {
            target: '.upload-zone, #uploadBox, #inlineUploadBox, .inline-magic-upload',
            title: 'onboarding.upload.title',
            content: 'onboarding.upload.desc',
            position: 'bottom',
            fallbackTitle: 'Upload Area',
            fallbackContent: 'Drag & drop images here or paste from clipboard with Ctrl+V.'
        },
        {
            target: '.nav-link[href*="gallery"], .gallery-btn, [href*="gallery"]',
            title: 'onboarding.gallery.title',
            content: 'onboarding.gallery.desc',
            position: 'bottom',
            fallbackTitle: 'Your Gallery',
            fallbackContent: 'View and manage all your uploaded images here.'
        },
        {
            target: '.nav-link[href*="studio"], .studio-btn, [href*="studio"]',
            title: 'onboarding.studio.title',
            content: 'onboarding.studio.desc',
            position: 'bottom',
            fallbackTitle: 'Edit in Studio',
            fallbackContent: 'Open any image in the Studio to annotate, crop, or add effects.'
        },
        {
            target: '.share-btn, .copy-link-btn, #copyLinkBtn',
            title: 'onboarding.share.title',
            content: 'onboarding.share.desc',
            position: 'left',
            fallbackTitle: 'Share Instantly',
            fallbackContent: 'Every upload generates a shareable link automatically copied to your clipboard.'
        },
        {
            target: '.theme-toggle, #themeToggle',
            title: 'onboarding.hotkeys.title',
            content: 'onboarding.hotkeys.desc',
            position: 'left',
            fallbackTitle: 'Keyboard Shortcuts',
            fallbackContent: 'Press Ctrl+Shift+S to capture a screenshot anytime.'
        }
    ];

    /**
     * Initialize the onboarding system
     * @param {Object} options - Configuration options
     */
    function init(options = {}) {
        // Merge options
        config = { ...config, ...options };

        // Check if already completed
        if (isCompleted() && !options.force) {
            console.log('[Onboarding] Already completed, skipping');
            return;
        }

        // Check mobile
        if (config.skipOnMobile && window.innerWidth < config.mobileBreakpoint) {
            console.log('[Onboarding] Skipping on mobile');
            return;
        }

        // Use custom steps or defaults
        steps = options.steps || filterAvailableSteps(defaultSteps);

        if (steps.length === 0) {
            console.log('[Onboarding] No valid steps found');
            return;
        }

        // Create DOM elements
        createElements();

        // Load saved step
        const savedStep = localStorage.getItem(STEP_KEY);
        if (savedStep) {
            currentStep = parseInt(savedStep, 10);
            if (currentStep >= steps.length) currentStep = 0;
        }

        // Auto-start if configured
        if (config.autoStart) {
            setTimeout(() => start(), 500);
        }

        console.log('[Onboarding] Initialized with', steps.length, 'steps');
    }

    /**
     * Filter steps to only include those with available targets
     */
    function filterAvailableSteps(stepList) {
        return stepList.filter(step => {
            const targets = step.target.split(',').map(t => t.trim());
            return targets.some(t => document.querySelector(t));
        });
    }

    /**
     * Create the DOM elements for the tour
     */
    function createElements() {
        // Overlay
        const overlay = document.createElement('div');
        overlay.className = 'onboarding-overlay';
        overlay.id = 'onboardingOverlay';

        // Spotlight
        const spotlight = document.createElement('div');
        spotlight.className = 'onboarding-spotlight';
        spotlight.id = 'onboardingSpotlight';

        // Tooltip
        const tooltip = document.createElement('div');
        tooltip.className = 'onboarding-tooltip';
        tooltip.id = 'onboardingTooltip';
        tooltip.innerHTML = `
            <button class="onboarding-close" id="onboardingClose" aria-label="Close tour">
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"></line>
                    <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
            </button>
            <h3 class="onboarding-title" id="onboardingTitle"></h3>
            <p class="onboarding-content" id="onboardingContent"></p>
            <div class="onboarding-progress" id="onboardingProgress"></div>
            <div class="onboarding-nav">
                <button class="onboarding-btn onboarding-skip" id="onboardingSkip" data-i18n="onboarding.skip">Skip Tour</button>
                <div class="onboarding-nav-right">
                    <button class="onboarding-btn onboarding-prev" id="onboardingPrev" data-i18n="onboarding.previous">Previous</button>
                    <button class="onboarding-btn onboarding-next" id="onboardingNext" data-i18n="onboarding.next">Next</button>
                </div>
            </div>
        `;

        // Append to body
        document.body.appendChild(overlay);
        document.body.appendChild(spotlight);
        document.body.appendChild(tooltip);

        // Store references
        elements.overlay = overlay;
        elements.spotlight = spotlight;
        elements.tooltip = tooltip;
        elements.title = document.getElementById('onboardingTitle');
        elements.content = document.getElementById('onboardingContent');
        elements.progress = document.getElementById('onboardingProgress');
        elements.prevBtn = document.getElementById('onboardingPrev');
        elements.nextBtn = document.getElementById('onboardingNext');
        elements.skipBtn = document.getElementById('onboardingSkip');
        elements.closeBtn = document.getElementById('onboardingClose');

        // Bind events
        elements.prevBtn.addEventListener('click', prev);
        elements.nextBtn.addEventListener('click', next);
        elements.skipBtn.addEventListener('click', skip);
        elements.closeBtn.addEventListener('click', skip);
        elements.overlay.addEventListener('click', skip);

        // Keyboard navigation
        document.addEventListener('keydown', handleKeyboard);
    }

    /**
     * Start the tour
     */
    function start() {
        if (isActive) return;
        isActive = true;

        elements.overlay.classList.add('active');
        elements.spotlight.classList.add('active');
        elements.tooltip.classList.add('active');

        showStep(currentStep);
        document.body.style.overflow = 'hidden';

        console.log('[Onboarding] Tour started');
    }

    /**
     * Show a specific step
     */
    function showStep(index) {
        if (index < 0 || index >= steps.length) return;

        const step = steps[index];
        const targets = step.target.split(',').map(t => t.trim());
        let targetElement = null;

        // Find first available target
        for (const selector of targets) {
            targetElement = document.querySelector(selector);
            if (targetElement) break;
        }

        if (!targetElement) {
            console.warn('[Onboarding] Target not found, skipping step:', step.target);
            if (index < steps.length - 1) {
                showStep(index + 1);
            } else {
                complete();
            }
            return;
        }

        currentStep = index;
        localStorage.setItem(STEP_KEY, index);

        // Get translated text
        const title = getTranslation(step.title, step.fallbackTitle);
        const content = getTranslation(step.content, step.fallbackContent);

        // Update tooltip content
        elements.title.textContent = title;
        elements.content.textContent = content;

        // Update progress dots
        updateProgress();

        // Update navigation buttons
        elements.prevBtn.style.display = index === 0 ? 'none' : 'inline-flex';

        if (index === steps.length - 1) {
            const finishText = getTranslation('onboarding.finish', 'Get Started');
            elements.nextBtn.textContent = finishText;
        } else {
            const nextText = getTranslation('onboarding.next', 'Next');
            elements.nextBtn.textContent = nextText;
        }

        // Position spotlight and tooltip
        positionElements(targetElement, step.position);

        // Scroll target into view if needed
        targetElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    /**
     * Position the spotlight and tooltip around the target
     */
    function positionElements(target, position = 'bottom') {
        const rect = target.getBoundingClientRect();
        const padding = 10;

        // Position spotlight
        elements.spotlight.style.top = `${rect.top + window.scrollY - padding}px`;
        elements.spotlight.style.left = `${rect.left - padding}px`;
        elements.spotlight.style.width = `${rect.width + padding * 2}px`;
        elements.spotlight.style.height = `${rect.height + padding * 2}px`;

        // Calculate tooltip position
        const tooltipRect = elements.tooltip.getBoundingClientRect();
        let top, left;
        const gap = 20;

        switch (position) {
            case 'top':
                top = rect.top + window.scrollY - tooltipRect.height - gap;
                left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
                break;
            case 'bottom':
                top = rect.bottom + window.scrollY + gap;
                left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
                break;
            case 'left':
                top = rect.top + window.scrollY + (rect.height / 2) - (tooltipRect.height / 2);
                left = rect.left - tooltipRect.width - gap;
                break;
            case 'right':
                top = rect.top + window.scrollY + (rect.height / 2) - (tooltipRect.height / 2);
                left = rect.right + gap;
                break;
            default:
                top = rect.bottom + window.scrollY + gap;
                left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
        }

        // Keep tooltip within viewport
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight + window.scrollY;

        if (left < 20) left = 20;
        if (left + tooltipRect.width > viewportWidth - 20) {
            left = viewportWidth - tooltipRect.width - 20;
        }
        if (top < window.scrollY + 20) {
            top = rect.bottom + window.scrollY + gap;
        }
        if (top + tooltipRect.height > viewportHeight - 20) {
            top = rect.top + window.scrollY - tooltipRect.height - gap;
        }

        elements.tooltip.style.top = `${top}px`;
        elements.tooltip.style.left = `${left}px`;

        // Set tooltip arrow position class
        elements.tooltip.className = `onboarding-tooltip active position-${position}`;
    }

    /**
     * Update progress dots
     */
    function updateProgress() {
        let dots = '';
        for (let i = 0; i < steps.length; i++) {
            const activeClass = i === currentStep ? 'active' : '';
            const completedClass = i < currentStep ? 'completed' : '';
            dots += `<span class="progress-dot ${activeClass} ${completedClass}"></span>`;
        }
        elements.progress.innerHTML = dots;
    }

    /**
     * Go to next step
     */
    function next() {
        if (currentStep < steps.length - 1) {
            showStep(currentStep + 1);
        } else {
            complete();
        }
    }

    /**
     * Go to previous step
     */
    function prev() {
        if (currentStep > 0) {
            showStep(currentStep - 1);
        }
    }

    /**
     * Skip the tour
     */
    function skip() {
        complete();
    }

    /**
     * Complete the tour
     */
    function complete() {
        isActive = false;
        localStorage.setItem(STORAGE_KEY, 'true');
        localStorage.removeItem(STEP_KEY);

        elements.overlay.classList.remove('active');
        elements.spotlight.classList.remove('active');
        elements.tooltip.classList.remove('active');

        document.body.style.overflow = '';

        console.log('[Onboarding] Tour completed');

        // Dispatch event
        window.dispatchEvent(new CustomEvent('onboarding:complete'));
    }

    /**
     * Check if tour is completed
     */
    function isCompleted() {
        return localStorage.getItem(STORAGE_KEY) === 'true';
    }

    /**
     * Reset the tour (for testing)
     */
    function reset() {
        localStorage.removeItem(STORAGE_KEY);
        localStorage.removeItem(STEP_KEY);
        currentStep = 0;
        console.log('[Onboarding] Tour reset');
    }

    /**
     * Handle keyboard navigation
     */
    function handleKeyboard(e) {
        if (!isActive) return;

        switch (e.key) {
            case 'ArrowRight':
            case 'Enter':
                next();
                break;
            case 'ArrowLeft':
                prev();
                break;
            case 'Escape':
                skip();
                break;
        }
    }

    /**
     * Get translation or fallback
     */
    function getTranslation(key, fallback) {
        if (window.DOZi18n && typeof window.DOZi18n.t === 'function') {
            const translated = window.DOZi18n.t(key);
            if (translated && translated !== key) {
                return translated;
            }
        }
        return fallback;
    }

    /**
     * Manually trigger the tour
     */
    function trigger() {
        if (!elements.overlay) {
            init({ autoStart: false, force: true });
        }
        reset();
        steps = filterAvailableSteps(defaultSteps);
        start();
    }

    // Public API
    return {
        init,
        start,
        next,
        prev,
        skip,
        complete,
        reset,
        trigger,
        isCompleted,
        isActive: () => isActive,
        getCurrentStep: () => currentStep,
        getSteps: () => steps
    };
})();

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', function() {
    // Only auto-init on specific pages
    const autoInitPages = ['/', '/index.html', '/upload.html', '/up'];
    const currentPath = window.location.pathname;

    if (autoInitPages.some(p => currentPath === p || currentPath.endsWith(p))) {
        // Wait for other initializations
        setTimeout(() => {
            DOZOnboarding.init({ autoStart: true });
        }, 1000);
    }
});
