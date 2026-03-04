/**
 * DOZ UP - Performance Guard (DISABLED)
 * Replaced by AI Error Interceptor + Smart Error Handler.
 * This file exists only to override any old cached active version.
 * The old version created a "Performance issue detected - Running in safe mode" banner.
 */
(function() {
    'use strict';

    // Kill any safe-mode banner or overlay from old cached version
    window.DOZ_PERF_GUARD = {
        getStatus: function() { return { status: 'disabled', freezeCount: 0 }; },
        reset: function() {},
        enableSafeMode: function() {},
        showBanner: function() {},
        disable: function() {}
    };

    // Remove any existing banner immediately
    function removeSafeModeBanner() {
        var els = document.querySelectorAll('div, section, aside, header');
        for (var i = 0; i < els.length; i++) {
            var t = (els[i].textContent || '').toLowerCase();
            var s = els[i].style;
            if ((t.includes('safe mode') || t.includes('performance issue')) &&
                (t.includes('reload') || t.includes('detected')) &&
                (s.position === 'fixed' || s.position === 'sticky' || s.position === 'absolute')) {
                els[i].remove();
            }
        }
    }

    // Run on load and periodically
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', removeSafeModeBanner);
    } else {
        removeSafeModeBanner();
    }
    setTimeout(removeSafeModeBanner, 500);
    setTimeout(removeSafeModeBanner, 2000);
    setTimeout(removeSafeModeBanner, 5000);
})();
