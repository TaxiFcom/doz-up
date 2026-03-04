/**
 * DOZ UP - Floating Time Widget v2
 * Compact mini clock with expandable modal, weather, sun compass, and recording features
 */

(function() {
    'use strict';

    // ============ STATE ============
    let isExpanded = false;
    let isPinned = false;
    let isDragging = false;
    let dragOffset = { x: 0, y: 0 };
    let modalPosition = { x: null, y: null };
    let clockInterval = null;
    let weatherData = null;
    let sunData = null;
    let userLocation = null;
    let settingsExpanded = false;

    // ============ MINI CLOCK HTML (52px) - Luxury Version ============
    const MINI_CLOCK_HTML = `
        <div class="doz-mini-clock" id="dozMiniClock">
            <div class="luxury-clock-bezel">
                <svg viewBox="0 0 100 100" class="mini-clock-face">
                    <defs>
                        <linearGradient id="miniClockGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" style="stop-color:var(--luxury-ivory, #FFFFF0);stop-opacity:0.95"/>
                            <stop offset="100%" style="stop-color:var(--luxury-ivory, #FFFFF0);stop-opacity:0.85"/>
                        </linearGradient>
                        <linearGradient id="miniBezelGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" style="stop-color:var(--luxury-gold, #D4AF37)"/>
                            <stop offset="50%" style="stop-color:var(--luxury-rose-gold, #B76E79)"/>
                            <stop offset="100%" style="stop-color:var(--luxury-gold, #D4AF37)"/>
                        </linearGradient>
                        <filter id="miniGlow">
                            <feGaussianBlur stdDeviation="1.5" result="glow"/>
                            <feMerge><feMergeNode in="glow"/><feMergeNode in="SourceGraphic"/></feMerge>
                        </filter>
                    </defs>
                    <!-- Outer bezel ring -->
                    <circle cx="50" cy="50" r="49" fill="none" stroke="url(#miniBezelGrad)" stroke-width="3"/>
                    <!-- Clock face -->
                    <circle cx="50" cy="50" r="45" fill="url(#miniClockGrad)"/>
                    <circle cx="50" cy="50" r="42" fill="none" stroke="var(--luxury-gold, #D4AF37)" stroke-width="0.5" opacity="0.5"/>
                    <!-- Roman numeral markers (XII, III, VI, IX) -->
                    <text x="50" y="16" text-anchor="middle" font-size="8" fill="var(--luxury-gold, #D4AF37)" font-family="Georgia, serif" font-weight="bold" class="clock-numeral">XII</text>
                    <text x="88" y="53" text-anchor="middle" font-size="8" fill="var(--luxury-gold, #D4AF37)" font-family="Georgia, serif" font-weight="bold" class="clock-numeral">III</text>
                    <text x="50" y="92" text-anchor="middle" font-size="8" fill="var(--luxury-gold, #D4AF37)" font-family="Georgia, serif" font-weight="bold" class="clock-numeral">VI</text>
                    <text x="12" y="53" text-anchor="middle" font-size="8" fill="var(--luxury-gold, #D4AF37)" font-family="Georgia, serif" font-weight="bold" class="clock-numeral">IX</text>
                    <!-- Diamond minute markers -->
                    <polygon points="50,8 51,10 50,12 49,10" fill="var(--luxury-gold, #D4AF37)" opacity="0.6"/>
                    <polygon points="92,50 90,51 88,50 90,49" fill="var(--luxury-gold, #D4AF37)" opacity="0.6"/>
                    <polygon points="50,92 51,90 50,88 49,90" fill="var(--luxury-gold, #D4AF37)" opacity="0.6"/>
                    <polygon points="12,50 10,51 8,50 10,49" fill="var(--luxury-gold, #D4AF37)" opacity="0.6"/>
                    <!-- Clock hands with illumination classes -->
                    <line id="miniHourHand" class="mini-clock-hour clock-hand-hour" x1="50" y1="50" x2="50" y2="28" stroke="var(--luxury-gold, #D4AF37)" stroke-width="3" stroke-linecap="round" filter="url(#miniGlow)"/>
                    <line id="miniMinuteHand" class="mini-clock-minute clock-hand-minute" x1="50" y1="50" x2="50" y2="18" stroke="var(--text-primary, #1a1a2e)" stroke-width="2" stroke-linecap="round"/>
                    <line id="miniSecondHand" class="mini-clock-second clock-hand-second" x1="50" y1="50" x2="50" y2="14" stroke="var(--glow-red, #ef4444)" stroke-width="1" stroke-linecap="round"/>
                    <!-- Jewel center pivot -->
                    <circle cx="50" cy="50" r="5" fill="url(#miniBezelGrad)"/>
                    <circle cx="50" cy="50" r="3" fill="var(--luxury-platinum, #E5E4E2)"/>
                    <circle cx="50" cy="50" r="1.5" fill="var(--luxury-gold, #D4AF37)"/>
                    <!-- Minute completion ripple (hidden by default) -->
                    <circle cx="50" cy="50" r="5" class="minute-ripple" fill="none" stroke="var(--luxury-gold, #D4AF37)" stroke-width="2" opacity="0"/>
                </svg>
            </div>
            <!-- Hover controls -->
            <button class="mini-control-btn bell-btn" onclick="window.DOZFloatingWidget.toggleBell(event)" title="Toggle Bell">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                    <path d="M13.73 21a2 2 0 0 1-3.46 0"/>
                </svg>
            </button>
            <button class="mini-control-btn voice-btn" onclick="window.DOZFloatingWidget.toggleVoice(event)" title="Toggle Voice">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                    <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
                    <path d="M15.54 8.46a5 5 0 0 1 0 7.07"/>
                </svg>
            </button>
            <button class="mini-control-btn settings-btn" onclick="window.DOZFloatingWidget.toggleSettings(event)" title="Settings">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
            </button>
            <div class="mini-weather-icon" id="miniWeatherIcon"></div>
        </div>
    `;

    // ============ MODAL HTML ============
    const MODAL_HTML = `
        <div class="doz-clock-modal" id="dozClockModal">
            <div class="modal-header">
                <div class="modal-drag-handle">
                    <svg width="16" height="8" viewBox="0 0 16 8" fill="currentColor" opacity="0.5">
                        <rect x="0" y="0" width="16" height="2" rx="1"/>
                        <rect x="0" y="6" width="16" height="2" rx="1"/>
                    </svg>
                </div>
                <span class="modal-title">DOZ Time</span>
                <div class="modal-controls">
                    <button class="modal-pin-btn" onclick="window.DOZFloatingWidget.togglePin()" title="Pin">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M12 2L12 12"/>
                            <circle cx="12" cy="17" r="5"/>
                        </svg>
                    </button>
                    <button class="modal-close-btn" onclick="window.DOZFloatingWidget.collapse()">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M18 6L6 18M6 6l12 12"/>
                        </svg>
                    </button>
                </div>
            </div>

            <div class="modal-content">
                <!-- Clock with Sun Compass - Luxury Version -->
                <div class="modal-clock-section">
                    <div class="clock-compass-container">
                        <div class="luxury-clock-bezel modal-bezel">
                            <svg viewBox="0 0 220 220" class="modal-clock-face luxury-clock-face" id="modalClockSvg">
                                <defs>
                                    <linearGradient id="modalClockGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                                        <stop offset="0%" style="stop-color:var(--luxury-ivory, #FFFFF0);stop-opacity:0.95"/>
                                        <stop offset="100%" style="stop-color:var(--luxury-ivory, #FFFFF0);stop-opacity:0.85"/>
                                    </linearGradient>
                                    <linearGradient id="modalBezelGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                                        <stop offset="0%" style="stop-color:var(--luxury-gold, #D4AF37)"/>
                                        <stop offset="50%" style="stop-color:var(--luxury-rose-gold, #B76E79)"/>
                                        <stop offset="100%" style="stop-color:var(--luxury-gold, #D4AF37)"/>
                                    </linearGradient>
                                    <filter id="glowFilter">
                                        <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
                                        <feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge>
                                    </filter>
                                    <filter id="handGlow">
                                        <feGaussianBlur stdDeviation="2.5" result="glow"/>
                                        <feMerge><feMergeNode in="glow"/><feMergeNode in="SourceGraphic"/></feMerge>
                                    </filter>
                                    <!-- Hour shimmer gradient for completion animation -->
                                    <linearGradient id="shimmerGrad" x1="-200%" y1="0%" x2="200%" y2="0%">
                                        <stop offset="0%" style="stop-color:transparent"/>
                                        <stop offset="50%" style="stop-color:var(--luxury-gold, #D4AF37);stop-opacity:0.6"/>
                                        <stop offset="100%" style="stop-color:transparent"/>
                                    </linearGradient>
                                </defs>

                                <!-- Outer bezel ring -->
                                <circle cx="110" cy="110" r="108" fill="none" stroke="url(#modalBezelGrad)" stroke-width="5"/>

                                <!-- Sun path arc (outer ring) -->
                                <circle cx="110" cy="110" r="102" fill="none" stroke="var(--luxury-gold, #D4AF37)" stroke-width="1" opacity="0.3"/>

                                <!-- Compass directions -->
                                <text x="110" y="18" text-anchor="middle" font-size="10" fill="var(--luxury-gold, #D4AF37)" font-weight="500">N</text>
                                <text x="202" y="114" text-anchor="middle" font-size="10" fill="var(--luxury-gold, #D4AF37)" font-weight="500">E</text>
                                <text x="110" y="212" text-anchor="middle" font-size="10" fill="var(--luxury-gold, #D4AF37)" font-weight="500">S</text>
                                <text x="18" y="114" text-anchor="middle" font-size="10" fill="var(--luxury-gold, #D4AF37)" font-weight="500">W</text>

                                <!-- Sun position indicator -->
                                <g id="sunIndicator" filter="url(#glowFilter)">
                                    <circle cx="110" cy="20" r="8" fill="#fbbf24"/>
                                    <text x="110" y="24" text-anchor="middle" font-size="10">☀️</text>
                                </g>

                                <!-- Clock face -->
                                <circle cx="110" cy="110" r="85" fill="url(#modalClockGrad)"/>
                                <circle cx="110" cy="110" r="82" fill="none" stroke="var(--luxury-gold, #D4AF37)" stroke-width="2"/>
                                <circle cx="110" cy="110" r="75" fill="none" stroke="var(--luxury-gold, #D4AF37)" stroke-width="0.5" opacity="0.5"/>

                                <!-- Hour shimmer overlay (for completion animation) -->
                                <circle cx="110" cy="110" r="80" class="hour-shimmer-overlay" fill="url(#shimmerGrad)" opacity="0"/>

                                <!-- Roman numeral markers -->
                                <text x="110" y="42" text-anchor="middle" font-size="14" fill="var(--luxury-gold, #D4AF37)" font-family="Georgia, serif" font-weight="bold" class="clock-numeral">XII</text>
                                <text x="148" y="56" text-anchor="middle" font-size="11" fill="var(--luxury-gold, #D4AF37)" font-family="Georgia, serif" class="clock-numeral">I</text>
                                <text x="173" y="79" text-anchor="middle" font-size="11" fill="var(--luxury-gold, #D4AF37)" font-family="Georgia, serif" class="clock-numeral">II</text>
                                <text x="183" y="114" text-anchor="middle" font-size="14" fill="var(--luxury-gold, #D4AF37)" font-family="Georgia, serif" font-weight="bold" class="clock-numeral">III</text>
                                <text x="173" y="149" text-anchor="middle" font-size="11" fill="var(--luxury-gold, #D4AF37)" font-family="Georgia, serif" class="clock-numeral">IV</text>
                                <text x="148" y="172" text-anchor="middle" font-size="11" fill="var(--luxury-gold, #D4AF37)" font-family="Georgia, serif" class="clock-numeral">V</text>
                                <text x="110" y="186" text-anchor="middle" font-size="14" fill="var(--luxury-gold, #D4AF37)" font-family="Georgia, serif" font-weight="bold" class="clock-numeral">VI</text>
                                <text x="72" y="172" text-anchor="middle" font-size="11" fill="var(--luxury-gold, #D4AF37)" font-family="Georgia, serif" class="clock-numeral">VII</text>
                                <text x="47" y="149" text-anchor="middle" font-size="11" fill="var(--luxury-gold, #D4AF37)" font-family="Georgia, serif" class="clock-numeral">VIII</text>
                                <text x="37" y="114" text-anchor="middle" font-size="14" fill="var(--luxury-gold, #D4AF37)" font-family="Georgia, serif" font-weight="bold" class="clock-numeral">IX</text>
                                <text x="47" y="79" text-anchor="middle" font-size="11" fill="var(--luxury-gold, #D4AF37)" font-family="Georgia, serif" class="clock-numeral">X</text>
                                <text x="72" y="56" text-anchor="middle" font-size="11" fill="var(--luxury-gold, #D4AF37)" font-family="Georgia, serif" class="clock-numeral">XI</text>

                                <!-- Diamond minute markers -->
                                <g class="minute-markers" opacity="0.6">
                                    ${Array.from({length: 60}, (_, i) => {
                                        if (i % 5 === 0) return ''; // Skip hour positions
                                        const angle = (i * 6 - 90) * Math.PI / 180;
                                        const r = 78;
                                        const x = 110 + r * Math.cos(angle);
                                        const y = 110 + r * Math.sin(angle);
                                        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="1" fill="var(--luxury-gold, #D4AF37)"/>`;
                                    }).join('')}
                                </g>

                                <!-- Clock hands with illumination -->
                                <line id="modalHourHand" class="clock-hand-hour" x1="110" y1="110" x2="110" y2="60" stroke="var(--luxury-gold, #D4AF37)" stroke-width="5" stroke-linecap="round" filter="url(#handGlow)"/>
                                <line id="modalMinuteHand" class="clock-hand-minute" x1="110" y1="110" x2="110" y2="40" stroke="var(--text-primary, #1a1a2e)" stroke-width="3.5" stroke-linecap="round"/>
                                <line id="modalSecondHand" class="clock-hand-second" x1="110" y1="110" x2="110" y2="35" stroke="var(--glow-red, #ef4444)" stroke-width="1.5" stroke-linecap="round"/>

                                <!-- Jewel center pivot -->
                                <circle cx="110" cy="110" r="10" fill="url(#modalBezelGrad)"/>
                                <circle cx="110" cy="110" r="6" fill="var(--luxury-platinum, #E5E4E2)"/>
                                <circle cx="110" cy="110" r="3" fill="var(--luxury-gold, #D4AF37)"/>

                                <!-- Minute completion ripple -->
                                <circle cx="110" cy="110" r="10" class="minute-ripple" fill="none" stroke="var(--luxury-gold, #D4AF37)" stroke-width="3" opacity="0"/>
                            </svg>
                        </div>
                    </div>

                    <div class="time-info">
                        <div class="digital-time-large" id="modalDigitalTime">00:00:00</div>
                        <div class="date-display" id="modalDate">Saturday, Jan 25</div>
                        <div class="time-period-badge" id="modalTimePeriod">
                            <span class="period-icon" id="periodIcon">☀️</span>
                            <span class="period-name" id="periodName">Afternoon</span>
                        </div>
                    </div>
                </div>

                <!-- Weather Panel -->
                <div class="modal-weather-panel" id="weatherPanel">
                    <div class="weather-main">
                        <span class="weather-icon" id="modalWeatherIcon">☀️</span>
                        <span class="weather-temp" id="modalTemp">--°</span>
                        <span class="weather-condition" id="modalCondition">Loading...</span>
                    </div>
                    <div class="weather-toggle">
                        <label class="toggle-label">
                            <input type="checkbox" id="weatherThemeToggle" checked onchange="window.DOZFloatingWidget.toggleWeatherTheme(this.checked)">
                            <span>Affects theme colors</span>
                        </label>
                    </div>
                </div>

                <!-- Recording Buttons -->
                <div class="modal-recording-panel">
                    <div class="recording-buttons">
                        <button class="record-btn" id="videoCaptureBtn" onclick="window.DOZFloatingWidget.startVideoCapture()">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polygon points="23 7 16 12 23 17 23 7"/>
                                <rect x="1" y="5" width="15" height="14" rx="2"/>
                            </svg>
                            <span>Video</span>
                        </button>
                        <button class="record-btn" onclick="window.DOZFloatingWidget.captureSnap()">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="3" y="3" width="18" height="18" rx="2"/>
                                <circle cx="12" cy="12" r="3"/>
                            </svg>
                            <span>Snap</span>
                        </button>
                        <button class="record-btn" id="screenCaptureBtn" onclick="window.DOZFloatingWidget.startScreenCapture()">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="2" y="3" width="20" height="14" rx="2"/>
                                <line x1="8" y1="21" x2="16" y2="21"/>
                                <line x1="12" y1="17" x2="12" y2="21"/>
                            </svg>
                            <span>Screen</span>
                        </button>
                        <button class="record-btn" onclick="window.DOZFloatingWidget.openMeeting()">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/>
                                <circle cx="9" cy="7" r="4"/>
                                <path d="M23 21v-2a4 4 0 00-3-3.87"/>
                                <path d="M16 3.13a4 4 0 010 7.75"/>
                            </svg>
                            <span>Meet</span>
                        </button>
                    </div>
                    <div class="recording-status" id="recordingStatus" style="display: none;">
                        <span class="recording-indicator"></span>
                        <span class="recording-time" id="recordingTime">00:00</span>
                        <button class="stop-recording-btn" onclick="window.DOZFloatingWidget.stopRecording()">Stop</button>
                    </div>
                </div>

                <!-- Install Promotion -->
                <div class="modal-promo-panel" id="promoPanel">
                    <div class="promo-badge">FREE Limited Time!</div>
                    <div class="promo-content">
                        <span class="promo-icon">🎁</span>
                        <div class="promo-text">
                            <strong>Download DOZ UP App</strong>
                            <span>Screen capture, recording & more</span>
                        </div>
                    </div>
                    <button class="promo-install-btn" onclick="window.location.href='/download'">Install Now</button>
                    <button class="promo-dismiss" onclick="window.DOZFloatingWidget.dismissPromo()">×</button>
                </div>

                <!-- Account Section -->
                <div class="modal-account-panel" id="accountPanel">
                    <div class="account-status" id="accountStatus">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/>
                            <circle cx="12" cy="7" r="4"/>
                        </svg>
                        <span>Sign in for premium features</span>
                    </div>
                    <div class="account-buttons">
                        <button class="account-btn" onclick="window.location.href='/login'">Login</button>
                        <button class="account-btn secondary" onclick="window.location.href='/login'">Create Account</button>
                    </div>
                </div>

                <!-- Settings (Collapsed) -->
                <div class="modal-settings-toggle" onclick="window.DOZFloatingWidget.toggleSettingsPanel()">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="3"/>
                        <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/>
                    </svg>
                    <span>Settings</span>
                    <svg class="chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M6 9l6 6 6-6"/>
                    </svg>
                </div>

                <div class="modal-settings-panel" id="settingsPanel" style="display: none;">
                    <!-- Sound Controls Section -->
                    <div class="settings-section">
                        <div class="settings-section-title">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                                <path d="M19.07 4.93a10 10 0 0 1 0 14.14"/>
                            </svg>
                            Sound & Voice
                        </div>

                        <!-- Voice Toggle -->
                        <div class="setting-row">
                            <span class="setting-label">Voice Announcements</span>
                            <label class="luxury-toggle">
                                <input type="checkbox" id="voiceToggle" checked onchange="window.DOZFloatingWidget.setVoice(this.checked)">
                                <span class="toggle-slider"></span>
                            </label>
                        </div>

                        <!-- Bell Toggle -->
                        <div class="setting-row">
                            <span class="setting-label">Hourly Bell</span>
                            <label class="luxury-toggle">
                                <input type="checkbox" id="bellToggle" checked onchange="window.DOZFloatingWidget.setBell(this.checked)">
                                <span class="toggle-slider"></span>
                            </label>
                        </div>

                        <!-- Bell Sound -->
                        <div class="setting-row">
                            <span class="setting-label">Bell Sound</span>
                            <select class="sound-select" id="bellSoundSelect" onchange="window.DOZFloatingWidget.changeSound(this.value)">
                                <option value="church-bell">Church Bell</option>
                                <option value="westminster">Westminster</option>
                                <option value="zen-temple">Zen Temple</option>
                                <option value="grandfather">Grandfather Clock</option>
                                <option value="ship-bell">Ship's Bell</option>
                                <option value="wind-chimes">Wind Chimes</option>
                                <option value="cathedral">Cathedral Organ</option>
                                <option value="birds-dawn">Dawn Birds</option>
                            </select>
                            <button class="test-sound-btn" onclick="window.DOZFloatingWidget.testSound()">▶</button>
                        </div>

                        <!-- Volume Slider -->
                        <div class="setting-row">
                            <span class="setting-label">Volume</span>
                            <input type="range" class="luxury-slider" id="volumeSlider" min="0" max="100" value="50" onchange="window.DOZFloatingWidget.setVolume(this.value)">
                            <span class="volume-value" id="volumeValue">50%</span>
                        </div>

                        <!-- Bell Schedule -->
                        <div class="setting-row">
                            <span class="setting-label">Ring at</span>
                            <div class="bell-hours">
                                <label><input type="checkbox" value="8" checked onchange="window.DOZFloatingWidget.toggleBellHour(8)"><span>8AM</span></label>
                                <label><input type="checkbox" value="12" checked onchange="window.DOZFloatingWidget.toggleBellHour(12)"><span>12PM</span></label>
                                <label><input type="checkbox" value="18" checked onchange="window.DOZFloatingWidget.toggleBellHour(18)"><span>6PM</span></label>
                            </div>
                        </div>
                    </div>

                    <!-- Clock Style Section -->
                    <div class="settings-section">
                        <div class="settings-section-title">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <circle cx="12" cy="12" r="10"/>
                                <polyline points="12 6 12 12 16 14"/>
                            </svg>
                            Clock Style
                        </div>

                        <!-- Clock Style -->
                        <div class="setting-row">
                            <span class="setting-label">Numerals</span>
                            <div class="style-buttons">
                                <button class="style-btn active" data-style="roman" onclick="window.DOZFloatingWidget.setClockStyle('roman')">Roman</button>
                                <button class="style-btn" data-style="arabic" onclick="window.DOZFloatingWidget.setClockStyle('arabic')">Arabic</button>
                            </div>
                        </div>

                        <!-- Illumination Slider -->
                        <div class="setting-row">
                            <span class="setting-label">Glow Intensity</span>
                            <input type="range" class="luxury-slider" id="illuminationSlider" min="0" max="100" value="80" onchange="window.DOZFloatingWidget.setIllumination(this.value)">
                            <span class="illumination-value" id="illuminationValue">80%</span>
                        </div>
                    </div>

                    <!-- Theme auto-follows system preference -->

                    <!-- Test Buttons -->
                    <div class="settings-section">
                        <div class="settings-section-title">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polygon points="5 3 19 12 5 21 5 3"/>
                            </svg>
                            Test Features
                        </div>
                        <div class="test-buttons">
                            <button class="test-btn" onclick="window.DOZFloatingWidget.testVoice()">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/>
                                </svg>
                                Test Voice
                            </button>
                            <button class="test-btn" onclick="window.DOZFloatingWidget.testMinuteComplete()">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <circle cx="12" cy="12" r="10"/>
                                </svg>
                                Minute Animation
                            </button>
                            <button class="test-btn" onclick="window.DOZFloatingWidget.testHourComplete()">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/>
                                </svg>
                                Hour Animation
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    // ============ CLOCK FUNCTIONS ============

    function updateClock() {
        const now = new Date();
        const hours = now.getHours();
        const minutes = now.getMinutes();
        const seconds = now.getSeconds();
        const milliseconds = now.getMilliseconds();

        const secondDegrees = ((seconds + milliseconds / 1000) / 60) * 360;
        const minuteDegrees = ((minutes + seconds / 60) / 60) * 360;
        const hourDegrees = ((hours % 12 + minutes / 60) / 12) * 360;

        // Update mini clock
        updateHandRotation('miniSecondHand', secondDegrees, 50, 50);
        updateHandRotation('miniMinuteHand', minuteDegrees, 50, 50);
        updateHandRotation('miniHourHand', hourDegrees, 50, 50);

        // Update modal clock if expanded
        if (isExpanded) {
            updateHandRotation('modalSecondHand', secondDegrees, 110, 110);
            updateHandRotation('modalMinuteHand', minuteDegrees, 110, 110);
            updateHandRotation('modalHourHand', hourDegrees, 110, 110);

            // Update digital display
            const digitalTime = document.getElementById('modalDigitalTime');
            const dateDisplay = document.getElementById('modalDate');
            const periodName = document.getElementById('periodName');
            const periodIcon = document.getElementById('periodIcon');

            if (digitalTime) {
                digitalTime.textContent = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
            }
            if (dateDisplay) {
                dateDisplay.textContent = now.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
            }
            if (periodName && window.DOZTimeTheme) {
                periodName.textContent = window.DOZTimeTheme.getTimePeriodName();
            }

            // Update sun position
            updateSunPosition();
        }
    }

    function updateHandRotation(id, degrees, cx, cy) {
        const hand = document.getElementById(id);
        if (hand) {
            hand.setAttribute('transform', `rotate(${degrees}, ${cx}, ${cy})`);
        }
    }

    // ============ SUN POSITION ============

    function updateSunPosition() {
        if (!sunData || !sunData.position) return;

        const sunIndicator = document.getElementById('sunIndicator');
        if (!sunIndicator) return;

        // Convert azimuth to position on circle (0 = North = top)
        const azimuth = sunData.position.azimuth;
        const radius = 95;
        const cx = 110;
        const cy = 110;

        // Adjust azimuth so North is at top (subtract 90 degrees)
        const angle = (azimuth - 90) * (Math.PI / 180);
        const x = cx + radius * Math.cos(angle);
        const y = cy + radius * Math.sin(angle);

        // Update position
        sunIndicator.querySelector('circle').setAttribute('cx', x);
        sunIndicator.querySelector('circle').setAttribute('cy', y);
        sunIndicator.querySelector('text').setAttribute('x', x);
        sunIndicator.querySelector('text').setAttribute('y', y + 4);

        // Update icon based on day/night
        const icon = sunData.isDay ? '☀️' : (sunData.moon ? sunData.moon.icon : '🌙');
        sunIndicator.querySelector('text').textContent = icon;

        // Update period icon
        const periodIcon = document.getElementById('periodIcon');
        if (periodIcon) {
            periodIcon.textContent = sunData.isDay ? '☀️' : '🌙';
        }
    }

    async function fetchSunData() {
        if (!window.DOZSunCalculator) return;

        try {
            // Get location
            if (!userLocation && window.DOZWeatherService) {
                userLocation = await window.DOZWeatherService.getLocation();
            }

            if (userLocation) {
                sunData = window.DOZSunCalculator.getSunData(new Date(), userLocation.lat, userLocation.lon);
            }
        } catch (e) {
            console.log('[Widget] Could not get sun data:', e);
        }
    }

    // ============ WEATHER ============

    async function updateWeather() {
        if (!window.DOZWeatherService) return;

        try {
            weatherData = await window.DOZWeatherService.getCurrentWeather();

            if (weatherData) {
                // Update mini clock weather icon
                const miniIcon = document.getElementById('miniWeatherIcon');
                if (miniIcon) {
                    miniIcon.textContent = weatherData.icon;
                    miniIcon.style.display = 'flex';
                }

                // Update modal weather if expanded
                if (isExpanded) {
                    const modalIcon = document.getElementById('modalWeatherIcon');
                    const modalTemp = document.getElementById('modalTemp');
                    const modalCondition = document.getElementById('modalCondition');

                    if (modalIcon) modalIcon.textContent = weatherData.icon;
                    if (modalTemp) modalTemp.textContent = weatherData.temp + '°F';
                    if (modalCondition) modalCondition.textContent = weatherData.description;
                }

                // Apply weather theme modifier if enabled
                if (window.DOZWeatherService.shouldAffectTheme() && window.DOZTimeTheme) {
                    window.DOZTimeTheme.setWeatherModifier(window.DOZWeatherService.getWeatherThemeModifier(weatherData));
                }
            }
        } catch (e) {
            console.log('[Widget] Weather update failed:', e);
        }
    }

    function toggleWeatherTheme(enabled) {
        if (window.DOZWeatherService) {
            window.DOZWeatherService.setThemePreference(enabled);
            if (!enabled && window.DOZTimeTheme) {
                window.DOZTimeTheme.setWeatherModifier(null);
            } else {
                updateWeather();
            }
        }
    }

    // ============ MODAL FUNCTIONS ============

    function expand() {
        if (isExpanded) return;

        const modal = document.getElementById('dozClockModal');
        if (modal) {
            modal.classList.add('active');
            isExpanded = true;

            // Apply pinned position if exists
            if (isPinned && modalPosition.x !== null) {
                modal.style.left = modalPosition.x + 'px';
                modal.style.top = modalPosition.y + 'px';
            }

            // Update displays
            updateClock();
            updateWeather();
            fetchSunData();
        }
    }

    function collapse() {
        const modal = document.getElementById('dozClockModal');
        if (modal) {
            modal.classList.remove('active');
            isExpanded = false;
        }
    }

    function togglePin() {
        isPinned = !isPinned;
        const pinBtn = document.querySelector('.modal-pin-btn');
        if (pinBtn) {
            pinBtn.classList.toggle('pinned', isPinned);
        }
        saveState();
    }

    function toggleSettingsPanel() {
        settingsExpanded = !settingsExpanded;
        const panel = document.getElementById('settingsPanel');
        const toggle = document.querySelector('.modal-settings-toggle');
        if (panel) {
            panel.style.display = settingsExpanded ? 'block' : 'none';
        }
        if (toggle) {
            toggle.classList.toggle('expanded', settingsExpanded);
        }
    }

    function toggleSettings(e) {
        e.stopPropagation();
        expand();
        setTimeout(() => {
            settingsExpanded = true;
            const panel = document.getElementById('settingsPanel');
            if (panel) panel.style.display = 'block';
        }, 100);
    }

    // ============ DRAG FUNCTIONALITY ============

    function initModalDrag() {
        const modal = document.getElementById('dozClockModal');
        const handle = modal.querySelector('.modal-drag-handle');

        handle.addEventListener('mousedown', startDrag);
        handle.addEventListener('touchstart', startDrag, { passive: false });

        document.addEventListener('mousemove', drag);
        document.addEventListener('touchmove', drag, { passive: false });

        document.addEventListener('mouseup', stopDrag);
        document.addEventListener('touchend', stopDrag);
    }

    function startDrag(e) {
        e.preventDefault();
        isDragging = true;

        const modal = document.getElementById('dozClockModal');
        const rect = modal.getBoundingClientRect();

        const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
        const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;

        dragOffset.x = clientX - rect.left;
        dragOffset.y = clientY - rect.top;

        modal.classList.add('dragging');
    }

    function drag(e) {
        if (!isDragging) return;
        e.preventDefault();

        const clientX = e.type.includes('touch') ? e.touches[0].clientX : e.clientX;
        const clientY = e.type.includes('touch') ? e.touches[0].clientY : e.clientY;

        const modal = document.getElementById('dozClockModal');

        let x = clientX - dragOffset.x;
        let y = clientY - dragOffset.y;

        const maxX = window.innerWidth - modal.offsetWidth;
        const maxY = window.innerHeight - modal.offsetHeight;

        x = Math.max(0, Math.min(x, maxX));
        y = Math.max(0, Math.min(y, maxY));

        modal.style.left = x + 'px';
        modal.style.top = y + 'px';

        modalPosition = { x, y };
    }

    function stopDrag() {
        if (isDragging) {
            isDragging = false;
            const modal = document.getElementById('dozClockModal');
            modal.classList.remove('dragging');
            saveState();
        }
    }

    // ============ RECORDING FUNCTIONS ============

    async function startVideoCapture() {
        if (!window.DOZClockRecorder) {
            alert('Recording not available');
            return;
        }

        const result = await window.DOZClockRecorder.startVideoRecording();
        if (result.success) {
            showRecordingStatus('video');
        } else {
            alert('Could not start recording: ' + result.error);
        }
    }

    async function startScreenCapture() {
        if (!window.DOZClockRecorder) {
            alert('Recording not available');
            return;
        }

        const result = await window.DOZClockRecorder.startScreenRecording();
        if (result.success) {
            showRecordingStatus('screen');
        } else {
            alert('Could not start recording: ' + result.error);
        }
    }

    async function captureSnap() {
        if (!window.DOZClockRecorder) {
            alert('Recording not available');
            return;
        }

        const result = await window.DOZClockRecorder.captureVideoSnap();
        if (result.success) {
            window.DOZClockRecorder.downloadRecording(result.blob, result.filename);
        } else {
            alert('Could not capture: ' + result.error);
        }
    }

    async function stopRecording() {
        if (!window.DOZClockRecorder) return;

        const result = await window.DOZClockRecorder.stopRecording();
        if (result.success) {
            hideRecordingStatus();
            window.DOZClockRecorder.downloadRecording(result.blob, result.filename);
        }
    }

    function showRecordingStatus(type) {
        const status = document.getElementById('recordingStatus');
        if (status) {
            status.style.display = 'flex';
        }

        if (window.DOZClockRecorder) {
            window.DOZClockRecorder.setOnDurationUpdate((ms, formatted) => {
                const timeEl = document.getElementById('recordingTime');
                if (timeEl) timeEl.textContent = formatted;
            });
        }
    }

    function hideRecordingStatus() {
        const status = document.getElementById('recordingStatus');
        if (status) {
            status.style.display = 'none';
        }
    }

    function openMeeting() {
        // Open meeting modal or page
        if (window.DOZClockMeeting) {
            // Show meeting UI
            alert('Meeting feature - Coming soon!\nCreate or join video meetings with unlimited participants.');
        } else {
            window.location.href = '/hub.html';
        }
    }

    // ============ PROMOTION ============

    function dismissPromo() {
        const panel = document.getElementById('promoPanel');
        if (panel) {
            panel.style.display = 'none';
        }
        localStorage.setItem('dozPromoDissmised', Date.now().toString());
    }

    function checkPromoVisibility() {
        const dismissed = localStorage.getItem('dozPromoDissmised');
        if (dismissed) {
            // Show again after 7 days
            const daysSince = (Date.now() - parseInt(dismissed)) / (1000 * 60 * 60 * 24);
            if (daysSince < 7) {
                const panel = document.getElementById('promoPanel');
                if (panel) panel.style.display = 'none';
            }
        }
    }

    // ============ VOICE & BELL CONTROLS ============

    function toggleBell(e) {
        e.stopPropagation();
        if (window.DOZTimeTheme && window.DOZTimeTheme.bell) {
            const isEnabled = window.DOZTimeTheme.bell.toggle();
            updateControlStates();
            showToast(isEnabled ? 'Bell enabled' : 'Bell muted');
        }
    }

    function toggleVoice(e) {
        e.stopPropagation();
        if (window.DOZTimeTheme && window.DOZTimeTheme.voice) {
            const isEnabled = window.DOZTimeTheme.voice.toggle();
            updateControlStates();
            showToast(isEnabled ? 'Voice enabled' : 'Voice muted');
        }
    }

    function setVoice(enabled) {
        if (window.DOZTimeTheme) {
            window.DOZTimeTheme.setPreferences({ voiceEnabled: enabled });
            updateControlStates();
        }
    }

    function setBell(enabled) {
        if (window.DOZTimeTheme) {
            window.DOZTimeTheme.setPreferences({ bellEnabled: enabled });
            updateControlStates();
        }
    }

    function setVolume(value) {
        if (window.DOZTimeTheme) {
            window.DOZTimeTheme.setPreferences({ volume: value / 100 });
            const volumeLabel = document.getElementById('volumeValue');
            if (volumeLabel) volumeLabel.textContent = value + '%';
        }
    }

    function setClockStyle(style) {
        if (window.DOZTimeTheme && window.DOZTimeTheme.clock) {
            window.DOZTimeTheme.clock.setStyle(style);
            document.querySelectorAll('.style-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.style === style);
            });
        }
    }

    function setIllumination(value) {
        if (window.DOZTimeTheme && window.DOZTimeTheme.clock) {
            window.DOZTimeTheme.clock.setIllumination(value);
            const illuminationLabel = document.getElementById('illuminationValue');
            if (illuminationLabel) illuminationLabel.textContent = value + '%';
        }
    }

    function testVoice() {
        if (window.DOZTimeTheme && window.DOZTimeTheme.voice) {
            window.DOZTimeTheme.voice.announce();
        }
    }

    function testMinuteComplete() {
        if (window.DOZTimeTheme) {
            window.DOZTimeTheme.triggerMinuteComplete();
        }
        // Also trigger local animation
        triggerMinuteAnimation();
    }

    function testHourComplete() {
        if (window.DOZTimeTheme) {
            window.DOZTimeTheme.triggerHourComplete();
        }
        // Also trigger local animation
        triggerHourAnimation();
    }

    function triggerMinuteAnimation() {
        const ripples = document.querySelectorAll('.minute-ripple');
        ripples.forEach(ripple => {
            ripple.style.animation = 'none';
            ripple.offsetHeight; // Force reflow
            ripple.style.animation = 'minute-complete-ripple 1s ease-out forwards';
        });
    }

    function triggerHourAnimation() {
        const clockFaces = document.querySelectorAll('.luxury-clock-face, .mini-clock-face');
        clockFaces.forEach(face => {
            face.classList.add('hour-shimmer-active');
            setTimeout(() => {
                face.classList.remove('hour-shimmer-active');
            }, 2000);
        });

        // Also animate the shimmer overlay
        const overlays = document.querySelectorAll('.hour-shimmer-overlay');
        overlays.forEach(overlay => {
            overlay.style.animation = 'hour-shimmer-sweep 2s ease-out forwards';
            setTimeout(() => {
                overlay.style.animation = 'none';
            }, 2000);
        });
    }

    function updateControlStates() {
        if (!window.DOZTimeTheme) return;

        const prefs = window.DOZTimeTheme.getPreferences();

        // Update bell button
        const bellBtn = document.querySelector('.mini-control-btn.bell-btn');
        if (bellBtn) {
            bellBtn.classList.toggle('active', prefs.bellEnabled);
        }

        // Update voice button
        const voiceBtn = document.querySelector('.mini-control-btn.voice-btn');
        if (voiceBtn) {
            voiceBtn.classList.toggle('active', prefs.voiceEnabled);
        }

        // Update settings panel toggles
        const voiceToggle = document.getElementById('voiceToggle');
        if (voiceToggle) voiceToggle.checked = prefs.voiceEnabled;

        const bellToggle = document.getElementById('bellToggle');
        if (bellToggle) bellToggle.checked = prefs.bellEnabled;

        // Update volume slider
        const volumeSlider = document.getElementById('volumeSlider');
        if (volumeSlider) {
            volumeSlider.value = prefs.volume * 100;
            const volumeLabel = document.getElementById('volumeValue');
            if (volumeLabel) volumeLabel.textContent = Math.round(prefs.volume * 100) + '%';
        }

        // Update illumination slider
        const illuminationSlider = document.getElementById('illuminationSlider');
        if (illuminationSlider) {
            illuminationSlider.value = prefs.illuminationIntensity;
            const illuminationLabel = document.getElementById('illuminationValue');
            if (illuminationLabel) illuminationLabel.textContent = prefs.illuminationIntensity + '%';
        }

        // Update style buttons
        document.querySelectorAll('.style-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.style === prefs.clockStyle);
        });
    }

    function showToast(message) {
        // Remove existing toast
        const existingToast = document.querySelector('.doz-toast');
        if (existingToast) existingToast.remove();

        const toast = document.createElement('div');
        toast.className = 'doz-toast';
        toast.textContent = message;
        toast.style.cssText = `
            position: fixed;
            bottom: 80px;
            left: 50%;
            transform: translateX(-50%);
            background: var(--luxury-gold, #D4AF37);
            color: #1a1a2e;
            padding: 8px 16px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 600;
            z-index: 100001;
            animation: toastFade 2s ease-out forwards;
        `;
        document.body.appendChild(toast);

        setTimeout(() => toast.remove(), 2000);
    }

    // ============ THEME & SETTINGS ============

    function setTheme(theme) {
        const effectiveTheme = theme === 'auto'
            ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
            : theme;

        document.documentElement.setAttribute('data-theme', effectiveTheme);

        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === theme);
        });

        if (window.DOZTimeTheme) {
            window.DOZTimeTheme.updateColors();
        }

        localStorage.setItem('doz_theme', theme);
    }

    function changeSound(soundId) {
        if (window.DOZTimeTheme) {
            const prefs = window.DOZTimeTheme.getPreferences();
            prefs.selectedSound = soundId;
            window.DOZTimeTheme.setPreferences(prefs);
        }
    }

    function testSound() {
        const select = document.getElementById('bellSoundSelect');
        if (window.DOZTimeTheme && select) {
            window.DOZTimeTheme.playBellSound(select.value, 1);
        }
    }

    function toggleBellHour(hour) {
        if (window.DOZTimeTheme) {
            const prefs = window.DOZTimeTheme.getPreferences();
            const index = prefs.enabledHours.indexOf(hour);
            if (index > -1) {
                prefs.enabledHours.splice(index, 1);
            } else {
                prefs.enabledHours.push(hour);
                prefs.enabledHours.sort((a, b) => a - b);
            }
            window.DOZTimeTheme.setPreferences(prefs);
        }
    }

    // ============ STATE PERSISTENCE ============

    function saveState() {
        try {
            localStorage.setItem('dozWidgetState', JSON.stringify({
                pinned: isPinned,
                position: modalPosition
            }));
        } catch (e) {}
    }

    function loadState() {
        try {
            const saved = localStorage.getItem('dozWidgetState');
            if (saved) {
                const state = JSON.parse(saved);
                isPinned = state.pinned || false;
                modalPosition = state.position || { x: null, y: null };
            }
        } catch (e) {}
    }

    function loadPreferences() {
        if (window.DOZTimeTheme) {
            const prefs = window.DOZTimeTheme.getPreferences();
            const soundSelect = document.getElementById('bellSoundSelect');
            if (soundSelect) soundSelect.value = prefs.selectedSound;

            document.querySelectorAll('.bell-hours input').forEach(cb => {
                cb.checked = prefs.enabledHours.includes(parseInt(cb.value));
            });
        }

        const theme = localStorage.getItem('doz_theme') || 'dark';
        document.querySelectorAll('.theme-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.theme === theme);
        });

        // Weather theme toggle
        if (window.DOZWeatherService) {
            const toggle = document.getElementById('weatherThemeToggle');
            if (toggle) toggle.checked = window.DOZWeatherService.shouldAffectTheme();
        }
    }

    // ============ INITIALIZATION ============

    function init() {
        if (document.getElementById('dozMiniClock')) return;

        // Inject mini clock
        const miniContainer = document.createElement('div');
        miniContainer.innerHTML = MINI_CLOCK_HTML;
        document.body.appendChild(miniContainer.firstElementChild);

        // Inject modal
        const modalContainer = document.createElement('div');
        modalContainer.innerHTML = MODAL_HTML;
        document.body.appendChild(modalContainer.firstElementChild);

        // Click on mini clock to expand
        document.getElementById('dozMiniClock').addEventListener('click', (e) => {
            if (!e.target.closest('.mini-settings-gear')) {
                expand();
            }
        });

        // Initialize drag
        initModalDrag();

        // Load state
        loadState();
        loadPreferences();
        checkPromoVisibility();

        // Start clock (1 second interval - no need for faster updates)
        updateClock();
        clockInterval = setInterval(updateClock, 1000);

        // Fetch data
        fetchSunData();
        updateWeather();

        // Auto-refresh weather every 30 minutes
        setInterval(updateWeather, 30 * 60 * 1000);

        // Refresh sun data every minute
        setInterval(fetchSunData, 60 * 1000);

        // Listen for completion events from time-theme.js
        document.addEventListener('doz-minute-complete', triggerMinuteAnimation);
        document.addEventListener('doz-hour-complete', triggerHourAnimation);

        // Listen for voice events to show speaking indicator
        document.addEventListener('doz-voice-start', () => {
            const voiceBtn = document.querySelector('.mini-control-btn.voice-btn');
            if (voiceBtn) voiceBtn.classList.add('speaking');
        });
        document.addEventListener('doz-voice-end', () => {
            const voiceBtn = document.querySelector('.mini-control-btn.voice-btn');
            if (voiceBtn) voiceBtn.classList.remove('speaking');
        });

        // Update control states after a short delay (wait for DOZTimeTheme to load)
        setTimeout(updateControlStates, 500);

        console.log('[DOZ Floating Widget v2] Initialized with luxury clock');
    }

    function destroy() {
        const miniClock = document.getElementById('dozMiniClock');
        const modal = document.getElementById('dozClockModal');
        if (miniClock) miniClock.remove();
        if (modal) modal.remove();
        if (clockInterval) clearInterval(clockInterval);
    }

    // ============ PUBLIC API ============

    window.DOZFloatingWidget = {
        init,
        destroy,
        expand,
        collapse,
        togglePin,
        toggleSettings,
        toggleSettingsPanel,
        setTheme,
        changeSound,
        testSound,
        toggleBellHour,
        toggleWeatherTheme,
        startVideoCapture,
        startScreenCapture,
        captureSnap,
        stopRecording,
        openMeeting,
        dismissPromo,
        // Luxury clock controls
        toggleBell,
        toggleVoice,
        setVoice,
        setBell,
        setVolume,
        setClockStyle,
        setIllumination,
        testVoice,
        testMinuteComplete,
        testHourComplete,
        updateControlStates
    };

    // Auto-initialize
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        setTimeout(init, 100);
    }

})();
