/**
 * DOZ UP - Dynamic Time-Based Theme Engine
 * Smooth 24-hour color transitions with natural, sunny light mode colors
 */

(function() {
    'use strict';

    // ============ TIME-BASED COLOR CONFIGURATION ============
    // Colors defined in HSL for smooth interpolation
    const TIME_COLOR_STOPS = [
        // Night (0:00 - 5:00) - Peaceful cool blue
        { hour: 0, bg: { h: 220, s: 30, l: 97 }, accent: { h: 230, s: 60, l: 65 }, name: 'night' },

        // Dawn (5:00 - 7:00) - Soft rose-gold awakening
        { hour: 5, bg: { h: 20, s: 50, l: 97 }, accent: { h: 15, s: 85, l: 70 }, name: 'dawn' },

        // Morning (7:00 - 10:00) - Warm cream, energetic gold
        { hour: 7, bg: { h: 45, s: 60, l: 98 }, accent: { h: 35, s: 100, l: 65 }, name: 'morning' },

        // Late Morning (10:00 - 12:00) - Bright and vibrant
        { hour: 10, bg: { h: 50, s: 40, l: 99 }, accent: { h: 45, s: 95, l: 60 }, name: 'late-morning' },

        // Noon (12:00 - 14:00) - Bright white, sky blue accent
        { hour: 12, bg: { h: 55, s: 30, l: 99 }, accent: { h: 195, s: 90, l: 60 }, name: 'noon' },

        // Afternoon (14:00 - 17:00) - Soft peach, warm orange
        { hour: 14, bg: { h: 30, s: 50, l: 98 }, accent: { h: 35, s: 100, l: 60 }, name: 'afternoon' },

        // Late Afternoon (17:00 - 18:00) - Golden hour
        { hour: 17, bg: { h: 25, s: 55, l: 97 }, accent: { h: 30, s: 100, l: 58 }, name: 'golden-hour' },

        // Sunset (18:00 - 20:00) - Rose blush, pink coral
        { hour: 18, bg: { h: 340, s: 45, l: 97 }, accent: { h: 0, s: 80, l: 75 }, name: 'sunset' },

        // Evening (20:00 - 22:00) - Lavender mist, calm purple
        { hour: 20, bg: { h: 270, s: 35, l: 98 }, accent: { h: 270, s: 70, l: 75 }, name: 'evening' },

        // Night (22:00 - 24:00) - Cool blue, peaceful indigo
        { hour: 22, bg: { h: 220, s: 30, l: 97 }, accent: { h: 230, s: 60, l: 65 }, name: 'night' }
    ];

    // ============ SOUND CONFIGURATION ============
    const SOUND_LIBRARY = {
        'church-bell': { name: 'Classic Church Bell', frequencies: [293.66, 329.63, 392.00], type: 'bell' },
        'westminster': { name: 'Westminster Chimes', frequencies: [329.63, 293.66, 349.23, 261.63], type: 'chime' },
        'zen-temple': { name: 'Zen Temple Bell', frequencies: [174.61], type: 'gong' },
        'grandfather': { name: 'Grandfather Clock', frequencies: [261.63, 329.63], type: 'clock' },
        'ship-bell': { name: "Ship's Bell", frequencies: [523.25, 659.25], type: 'bell' },
        'wind-chimes': { name: 'Wind Chimes', frequencies: [523.25, 587.33, 659.25, 783.99], type: 'chime' },
        'cathedral': { name: 'Cathedral Organ', frequencies: [130.81, 164.81, 196.00], type: 'organ' },
        'birds-dawn': { name: 'Dawn Birds', frequencies: [1046.50, 1318.51, 1567.98], type: 'nature' }
    };

    const DEFAULT_PREFS = {
        bellEnabled: true,
        selectedSound: 'church-bell',
        enabledHours: [8, 12, 18],
        volume: 0.5,
        askToContinue: true,
        hasAskedToday: false,
        lastAskDate: null,
        // Luxury clock preferences
        voiceEnabled: true,
        clockStyle: 'roman', // 'roman' or 'arabic'
        illuminationIntensity: 80, // 0-100
        minuteCompletionSound: true,
        hourCompletionAnimation: true
    };

    // ============ VOICE ANNOUNCEMENT SYSTEM ============
    const voiceAnnouncement = {
        enabled: true,
        isSpeaking: false,

        speak(text) {
            if (!this.enabled || !preferences.voiceEnabled) return;
            if (!('speechSynthesis' in window)) {
                console.warn('[DOZ Voice] Speech synthesis not supported');
                return;
            }

            // Cancel any ongoing speech
            speechSynthesis.cancel();

            const utterance = new SpeechSynthesisUtterance(text);
            utterance.rate = 0.9;
            utterance.pitch = 1;
            utterance.volume = preferences.volume;

            // Try to use a nice voice
            const voices = speechSynthesis.getVoices();
            const preferredVoice = voices.find(v =>
                v.lang.startsWith('en') && (v.name.includes('Female') || v.name.includes('Samantha') || v.name.includes('Google'))
            ) || voices.find(v => v.lang.startsWith('en'));

            if (preferredVoice) {
                utterance.voice = preferredVoice;
            }

            utterance.onstart = () => {
                this.isSpeaking = true;
                document.dispatchEvent(new CustomEvent('doz-voice-start'));
            };
            utterance.onend = () => {
                this.isSpeaking = false;
                document.dispatchEvent(new CustomEvent('doz-voice-end'));
            };
            utterance.onerror = () => {
                this.isSpeaking = false;
            };

            speechSynthesis.speak(utterance);
        },

        getGreeting(hour) {
            if (hour >= 5 && hour < 12) return "Good morning";
            if (hour >= 12 && hour < 17) return "Good afternoon";
            if (hour >= 17 && hour < 21) return "Good evening";
            return "Good night";
        },

        formatTime(hour, minute) {
            let period = hour >= 12 ? 'PM' : 'AM';
            let displayHour = hour % 12 || 12;
            if (minute === 0) {
                return `${displayHour} ${period}`;
            }
            return `${displayHour}:${minute.toString().padStart(2, '0')} ${period}`;
        },

        announceTime() {
            const now = new Date();
            const hour = now.getHours();
            const minute = now.getMinutes();
            const greeting = this.getGreeting(hour);
            const timeStr = this.formatTime(hour, minute);
            this.speak(`${greeting}, it's ${timeStr}`);
        },

        toggle() {
            this.enabled = !this.enabled;
            preferences.voiceEnabled = this.enabled;
            savePreferences();
            return this.enabled;
        }
    };

    // ============ COMPLETION ANIMATION SYSTEM ============
    let lastSecond = -1;
    let lastMinute = -1;
    let lastHour = -1;

    function checkCompletions() {
        const now = new Date();
        const second = now.getSeconds();
        const minute = now.getMinutes();
        const hour = now.getHours();

        // Minute completion (when seconds hit 0)
        if (second === 0 && lastSecond === 59) {
            onMinuteComplete();
        }

        // Hour completion (when minutes hit 0 and seconds hit 0)
        if (minute === 0 && second === 0 && lastMinute === 59) {
            onHourComplete(hour);
        }

        lastSecond = second;
        lastMinute = minute;
        lastHour = hour;
    }

    function onMinuteComplete() {
        if (!preferences.minuteCompletionSound) return;

        // Dispatch event for visual effects
        document.dispatchEvent(new CustomEvent('doz-minute-complete'));

        // Play subtle tick sound
        playTickSound();
    }

    function onHourComplete(hour) {
        // Dispatch event for visual effects
        document.dispatchEvent(new CustomEvent('doz-hour-complete', { detail: { hour } }));

        // Play bell if enabled
        if (preferences.bellEnabled && preferences.enabledHours.includes(hour)) {
            playBellSound(preferences.selectedSound, 3);
        }

        // Announce time if voice enabled
        if (preferences.voiceEnabled && voiceAnnouncement.enabled) {
            // Delay voice slightly after bell
            setTimeout(() => {
                voiceAnnouncement.announceTime();
            }, preferences.bellEnabled ? 5000 : 500);
        }

        // Trigger hour shimmer animation
        if (preferences.hourCompletionAnimation) {
            triggerHourShimmer();
        }
    }

    function playTickSound() {
        if (!audioContext) return;
        const ctx = initAudio();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, ctx.currentTime);

        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(preferences.volume * 0.1, ctx.currentTime + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.1);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.15);
    }

    function triggerHourShimmer() {
        const clockFace = document.querySelector('.luxury-clock-face, .modal-clock-face, .mini-clock-face');
        if (clockFace) {
            clockFace.classList.add('hour-shimmer-active');
            setTimeout(() => {
                clockFace.classList.remove('hour-shimmer-active');
            }, 2000);
        }
    }

    // ============ STATE ============
    let audioContext = null;
    let currentTimeColors = null;
    let updateInterval = null;
    let bellCheckInterval = null;
    let preferences = { ...DEFAULT_PREFS };
    let weatherModifier = null; // HSL adjustments from weather

    // ============ UTILITY FUNCTIONS ============

    function hslToHex(h, s, l) {
        s /= 100;
        l /= 100;
        const a = s * Math.min(l, 1 - l);
        const f = n => {
            const k = (n + h / 30) % 12;
            const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
            return Math.round(255 * color).toString(16).padStart(2, '0');
        };
        return `#${f(0)}${f(8)}${f(4)}`;
    }

    function hslToRgba(h, s, l, a = 1) {
        s /= 100;
        l /= 100;
        const c = s * Math.min(l, 1 - l);
        const f = n => {
            const k = (n + h / 30) % 12;
            const color = l - c * Math.max(Math.min(k - 3, 9 - k, 1), -1);
            return Math.round(255 * color);
        };
        return `rgba(${f(0)}, ${f(8)}, ${f(4)}, ${a})`;
    }

    function lerp(a, b, t) {
        return a + (b - a) * t;
    }

    function lerpHSL(hsl1, hsl2, t) {
        // Handle hue wrapping (e.g., from 350 to 10 degrees)
        let h1 = hsl1.h, h2 = hsl2.h;
        if (Math.abs(h2 - h1) > 180) {
            if (h1 < h2) h1 += 360;
            else h2 += 360;
        }
        return {
            h: ((lerp(h1, h2, t) % 360) + 360) % 360,
            s: lerp(hsl1.s, hsl2.s, t),
            l: lerp(hsl1.l, hsl2.l, t)
        };
    }

    // ============ TIME CALCULATIONS ============

    function getCurrentTimeProgress() {
        const now = new Date();
        const hours = now.getHours();
        const minutes = now.getMinutes();
        const seconds = now.getSeconds();
        return hours + minutes / 60 + seconds / 3600;
    }

    function getTimeColors() {
        const currentHour = getCurrentTimeProgress();

        // Find the two color stops to interpolate between
        let prevStop = TIME_COLOR_STOPS[TIME_COLOR_STOPS.length - 1];
        let nextStop = TIME_COLOR_STOPS[0];

        for (let i = 0; i < TIME_COLOR_STOPS.length; i++) {
            if (TIME_COLOR_STOPS[i].hour <= currentHour) {
                prevStop = TIME_COLOR_STOPS[i];
                nextStop = TIME_COLOR_STOPS[(i + 1) % TIME_COLOR_STOPS.length];
            }
        }

        // Handle wraparound at midnight
        let prevHour = prevStop.hour;
        let nextHour = nextStop.hour;
        if (nextHour <= prevHour) nextHour += 24;

        let adjustedCurrent = currentHour;
        if (currentHour < prevHour) adjustedCurrent += 24;

        // Calculate interpolation factor
        const range = nextHour - prevHour;
        const progress = range > 0 ? (adjustedCurrent - prevHour) / range : 0;
        const t = Math.max(0, Math.min(1, progress));

        // Interpolate colors
        let bg = lerpHSL(prevStop.bg, nextStop.bg, t);
        let accent = lerpHSL(prevStop.accent, nextStop.accent, t);

        // Apply weather modifier if set
        if (weatherModifier) {
            bg = applyModifier(bg, weatherModifier);
            accent = applyModifier(accent, weatherModifier);
        }

        return {
            name: prevStop.name,
            bg: bg,
            accent: accent,
            bgHex: hslToHex(bg.h, bg.s, bg.l),
            accentHex: hslToHex(accent.h, accent.s, accent.l),
            bgRgba: (a) => hslToRgba(bg.h, bg.s, bg.l, a),
            accentRgba: (a) => hslToRgba(accent.h, accent.s, accent.l, a),
            glowColor: hslToRgba(accent.h, accent.s, accent.l, 0.3)
        };
    }

    function applyModifier(hsl, modifier) {
        return {
            h: ((hsl.h + (modifier.h || 0)) % 360 + 360) % 360,
            s: Math.max(0, Math.min(100, hsl.s + (modifier.s || 0))),
            l: Math.max(0, Math.min(100, hsl.l + (modifier.l || 0)))
        };
    }

    function getTimePeriodName() {
        const hour = new Date().getHours();
        if (hour >= 22 || hour < 5) return 'Night';
        if (hour >= 5 && hour < 7) return 'Dawn';
        if (hour >= 7 && hour < 10) return 'Morning';
        if (hour >= 10 && hour < 12) return 'Late Morning';
        if (hour >= 12 && hour < 14) return 'Noon';
        if (hour >= 14 && hour < 17) return 'Afternoon';
        if (hour >= 17 && hour < 18) return 'Golden Hour';
        if (hour >= 18 && hour < 20) return 'Sunset';
        return 'Evening';
    }

    // ============ CSS VARIABLE UPDATES ============

    function updateCSSVariables(colors) {
        const root = document.documentElement;
        const theme = root.getAttribute('data-theme');

        // Only apply time-based colors in light mode
        if (theme !== 'light') return;

        // Update dynamic CSS variables
        root.style.setProperty('--time-bg', colors.bgHex);
        root.style.setProperty('--time-accent', colors.accentHex);
        root.style.setProperty('--time-glow', colors.glowColor);
        root.style.setProperty('--time-bg-rgb', colors.bgRgba(1).replace('rgba(', '').replace(', 1)', ''));

        // Update light mode variables
        root.style.setProperty('--bg-dark', colors.bgHex);
        root.style.setProperty('--bg-card', colors.bgRgba(0.95));
        root.style.setProperty('--bg-card-hover', colors.bgRgba(0.9));
        root.style.setProperty('--primary', colors.accentHex);
        root.style.setProperty('--primary-light', colors.accentRgba(0.7));

        // Body background gradient
        document.body.style.background = `linear-gradient(135deg, ${colors.bgHex} 0%, ${colors.bgRgba(0.95)} 50%, ${colors.bgHex} 100%)`;
    }

    // ============ SOUND SYSTEM ============

    function initAudio() {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        return audioContext;
    }

    function playBellSound(soundId, times = 3) {
        if (!preferences.bellEnabled) return;

        const ctx = initAudio();
        const sound = SOUND_LIBRARY[soundId] || SOUND_LIBRARY['church-bell'];
        const volume = preferences.volume;

        for (let i = 0; i < times; i++) {
            setTimeout(() => {
                playChime(ctx, sound, volume);
            }, i * 1500); // 1.5 second interval between bells
        }
    }

    function playChime(ctx, sound, volume) {
        const now = ctx.currentTime;

        sound.frequencies.forEach((freq, index) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            const filter = ctx.createBiquadFilter();

            // Configure oscillator based on sound type
            switch (sound.type) {
                case 'bell':
                    osc.type = 'sine';
                    filter.type = 'lowpass';
                    filter.frequency.value = 2000;
                    break;
                case 'chime':
                    osc.type = 'triangle';
                    filter.type = 'bandpass';
                    filter.frequency.value = freq;
                    filter.Q.value = 5;
                    break;
                case 'gong':
                    osc.type = 'sine';
                    filter.type = 'lowpass';
                    filter.frequency.value = 500;
                    break;
                case 'organ':
                    osc.type = 'sawtooth';
                    filter.type = 'lowpass';
                    filter.frequency.value = 1500;
                    break;
                default:
                    osc.type = 'sine';
            }

            osc.frequency.setValueAtTime(freq, now);

            // Natural bell envelope
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(volume * 0.4, now + 0.02);
            gain.gain.exponentialRampToValueAtTime(volume * 0.2, now + 0.3);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 2);

            osc.connect(filter);
            filter.connect(gain);
            gain.connect(ctx.destination);

            osc.start(now + index * 0.05);
            osc.stop(now + 2.5);
        });
    }

    function checkBellSchedule() {
        const now = new Date();
        const hour = now.getHours();
        const minute = now.getMinutes();

        // Only trigger at the top of the hour
        if (minute !== 0) return;

        // Check if this hour is in the enabled list
        if (!preferences.enabledHours.includes(hour)) return;

        // Check if we've already asked today
        const today = now.toDateString();
        if (preferences.askToContinue && preferences.hasAskedToday && preferences.lastAskDate === today) {
            return;
        }

        // Play the bell
        playBellSound(preferences.selectedSound, 3);

        // Show continue prompt if enabled
        if (preferences.askToContinue && !preferences.hasAskedToday) {
            setTimeout(() => {
                showBellPrompt();
            }, 5000);
        }
    }

    function showBellPrompt() {
        const modal = document.createElement('div');
        modal.className = 'doz-bell-prompt';
        modal.innerHTML = `
            <div class="bell-prompt-content">
                <div class="bell-icon">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                        <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                    </svg>
                </div>
                <h3>Time Bell</h3>
                <p>Would you like to continue hearing hourly bells?</p>
                <div class="bell-prompt-buttons">
                    <button class="bell-btn bell-btn-yes" onclick="window.DOZTimeTheme.acceptBells()">Yes, Continue</button>
                    <button class="bell-btn bell-btn-no" onclick="window.DOZTimeTheme.declineBells()">No Thanks</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // Mark as asked today
        preferences.hasAskedToday = true;
        preferences.lastAskDate = new Date().toDateString();
        savePreferences();
    }

    function acceptBells() {
        const modal = document.querySelector('.doz-bell-prompt');
        if (modal) modal.remove();
        preferences.bellEnabled = true;
        savePreferences();
    }

    function declineBells() {
        const modal = document.querySelector('.doz-bell-prompt');
        if (modal) modal.remove();
        preferences.bellEnabled = false;
        savePreferences();
    }

    // ============ HOURLY BUTTON DISPLAY ============

    function showTimeOnButton() {
        const now = new Date();
        const hour = now.getHours();
        const minute = now.getMinutes();

        // Only show at top of hour for 3 minutes
        if (minute > 3) return;

        const themeToggle = document.querySelector('.theme-toggle, #themeToggle');
        if (!themeToggle) return;

        const timeDisplay = document.createElement('div');
        timeDisplay.className = 'theme-toggle-time';
        timeDisplay.textContent = `${hour.toString().padStart(2, '0')}:00`;

        // Remove existing time display
        const existing = themeToggle.querySelector('.theme-toggle-time');
        if (existing) existing.remove();

        themeToggle.appendChild(timeDisplay);
        themeToggle.classList.add('showing-time');

        // Remove after 3 minutes
        setTimeout(() => {
            timeDisplay.remove();
            themeToggle.classList.remove('showing-time');
        }, 3 * 60 * 1000);
    }

    // ============ PREFERENCES ============

    function loadPreferences() {
        try {
            const saved = localStorage.getItem('dozTimePrefs');
            if (saved) {
                preferences = { ...DEFAULT_PREFS, ...JSON.parse(saved) };
            }
        } catch (e) {
            console.warn('Could not load time preferences:', e);
        }
    }

    function savePreferences() {
        try {
            localStorage.setItem('dozTimePrefs', JSON.stringify(preferences));
        } catch (e) {
            console.warn('Could not save time preferences:', e);
        }
    }

    // ============ INITIALIZATION ============

    function init() {
        loadPreferences();

        // Sync voice announcement with preferences
        voiceAnnouncement.enabled = preferences.voiceEnabled;

        // Initial color update
        currentTimeColors = getTimeColors();
        updateCSSVariables(currentTimeColors);

        // Update colors every minute
        updateInterval = setInterval(() => {
            currentTimeColors = getTimeColors();
            updateCSSVariables(currentTimeColors);
        }, 60000);

        // Check bell schedule every minute
        bellCheckInterval = setInterval(checkBellSchedule, 60000);

        // Check hourly button display
        setInterval(showTimeOnButton, 60000);
        showTimeOnButton(); // Initial check

        // Check completions every second (for minute/hour animations)
        setInterval(checkCompletions, 1000);

        // Initialize speech synthesis voices (they load async)
        if ('speechSynthesis' in window) {
            speechSynthesis.getVoices();
            speechSynthesis.onvoiceschanged = () => speechSynthesis.getVoices();
        }

        // Listen for theme changes
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.attributeName === 'data-theme') {
                    currentTimeColors = getTimeColors();
                    updateCSSVariables(currentTimeColors);
                }
            });
        });

        observer.observe(document.documentElement, { attributes: true });

        console.log('[DOZ Time Theme] Initialized - Current period:', getTimePeriodName());
        console.log('[DOZ Time Theme] Voice enabled:', preferences.voiceEnabled);
        console.log('[DOZ Time Theme] Bell enabled:', preferences.bellEnabled);
    }

    // ============ PUBLIC API ============

    window.DOZTimeTheme = {
        init,
        getTimeColors,
        getTimePeriodName,
        getCurrentTimeProgress,
        playBellSound,
        acceptBells,
        declineBells,
        getSoundLibrary: () => SOUND_LIBRARY,
        getPreferences: () => ({ ...preferences }),
        setPreferences: (newPrefs) => {
            preferences = { ...preferences, ...newPrefs };
            // Sync voice announcement state
            if (newPrefs.voiceEnabled !== undefined) {
                voiceAnnouncement.enabled = newPrefs.voiceEnabled;
            }
            savePreferences();
        },
        updateColors: () => {
            currentTimeColors = getTimeColors();
            updateCSSVariables(currentTimeColors);
        },
        setWeatherModifier: (modifier) => {
            weatherModifier = modifier;
            currentTimeColors = getTimeColors();
            updateCSSVariables(currentTimeColors);
            console.log('[DOZ Time Theme] Weather modifier applied:', modifier);
        },
        getWeatherModifier: () => weatherModifier,

        // Voice announcement API
        voice: {
            announce: () => voiceAnnouncement.announceTime(),
            speak: (text) => voiceAnnouncement.speak(text),
            toggle: () => voiceAnnouncement.toggle(),
            isEnabled: () => voiceAnnouncement.enabled,
            isSpeaking: () => voiceAnnouncement.isSpeaking,
            getGreeting: () => voiceAnnouncement.getGreeting(new Date().getHours())
        },

        // Bell control API
        bell: {
            toggle: () => {
                preferences.bellEnabled = !preferences.bellEnabled;
                savePreferences();
                return preferences.bellEnabled;
            },
            isEnabled: () => preferences.bellEnabled,
            play: (soundId, times) => playBellSound(soundId || preferences.selectedSound, times || 1),
            setSound: (soundId) => {
                if (SOUND_LIBRARY[soundId]) {
                    preferences.selectedSound = soundId;
                    savePreferences();
                }
            }
        },

        // Clock style API
        clock: {
            getStyle: () => preferences.clockStyle,
            setStyle: (style) => {
                if (style === 'roman' || style === 'arabic') {
                    preferences.clockStyle = style;
                    savePreferences();
                    document.dispatchEvent(new CustomEvent('doz-clock-style-change', { detail: { style } }));
                }
            },
            getIllumination: () => preferences.illuminationIntensity,
            setIllumination: (value) => {
                preferences.illuminationIntensity = Math.max(0, Math.min(100, value));
                savePreferences();
                document.documentElement.style.setProperty('--clock-illumination', preferences.illuminationIntensity / 100);
            }
        },

        // Trigger animations manually (for testing)
        triggerMinuteComplete: () => onMinuteComplete(),
        triggerHourComplete: () => onHourComplete(new Date().getHours())
    };

    // Auto-initialize when DOM is ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
