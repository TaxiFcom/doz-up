/**
 * DOZ UP - Weather Service
 * Integrates with OpenWeatherMap API for weather data
 */

(function() {
    'use strict';

    // ============ CONFIGURATION ============
    const CACHE_DURATION = 30 * 60 * 1000; // 30 minutes
    const API_ENDPOINT = '/api/weather'; // Server proxy to hide API key

    // ============ STATE ============
    let cachedWeather = null;
    let cacheTimestamp = 0;
    let currentLocation = null;
    let locationPermissionDenied = false;

    // ============ WEATHER ICONS ============
    const WEATHER_ICONS = {
        '01d': { icon: '☀️', name: 'Clear', class: 'sunny' },
        '01n': { icon: '🌙', name: 'Clear Night', class: 'clear-night' },
        '02d': { icon: '⛅', name: 'Few Clouds', class: 'partly-cloudy' },
        '02n': { icon: '☁️', name: 'Few Clouds Night', class: 'cloudy-night' },
        '03d': { icon: '☁️', name: 'Scattered Clouds', class: 'cloudy' },
        '03n': { icon: '☁️', name: 'Scattered Clouds', class: 'cloudy' },
        '04d': { icon: '☁️', name: 'Overcast', class: 'overcast' },
        '04n': { icon: '☁️', name: 'Overcast', class: 'overcast' },
        '09d': { icon: '🌧️', name: 'Showers', class: 'rainy' },
        '09n': { icon: '🌧️', name: 'Showers', class: 'rainy' },
        '10d': { icon: '🌦️', name: 'Rain', class: 'rainy' },
        '10n': { icon: '🌧️', name: 'Rain Night', class: 'rainy' },
        '11d': { icon: '⛈️', name: 'Thunderstorm', class: 'stormy' },
        '11n': { icon: '⛈️', name: 'Thunderstorm', class: 'stormy' },
        '13d': { icon: '❄️', name: 'Snow', class: 'snowy' },
        '13n': { icon: '❄️', name: 'Snow', class: 'snowy' },
        '50d': { icon: '🌫️', name: 'Mist', class: 'misty' },
        '50n': { icon: '🌫️', name: 'Mist', class: 'misty' }
    };

    // ============ THEME MODIFIERS ============
    // HSL adjustments based on weather conditions
    const WEATHER_THEME_MODIFIERS = {
        'sunny': { h: 0, s: 10, l: 3 },           // Brighter, warmer
        'partly-cloudy': { h: 0, s: 0, l: 0 },    // No change
        'cloudy': { h: 0, s: -15, l: -2 },        // Muted, grayer
        'overcast': { h: 0, s: -20, l: -5 },      // More muted
        'rainy': { h: 20, s: -10, l: -3 },        // Cool blues
        'stormy': { h: 30, s: -15, l: -8 },       // Darker
        'snowy': { h: -10, s: -10, l: 5 },        // White/silver
        'misty': { h: 0, s: -20, l: -3 },         // Muted, soft
        'clear-night': { h: 40, s: 5, l: -5 },    // Deep purples
        'cloudy-night': { h: 40, s: -10, l: -8 }  // Darker
    };

    // ============ LOCATION FUNCTIONS ============

    /**
     * Get user's location via browser geolocation
     */
    function getBrowserLocation() {
        return new Promise((resolve, reject) => {
            if (!navigator.geolocation) {
                reject(new Error('Geolocation not supported'));
                return;
            }

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    resolve({
                        lat: position.coords.latitude,
                        lon: position.coords.longitude,
                        source: 'browser'
                    });
                },
                (error) => {
                    locationPermissionDenied = error.code === error.PERMISSION_DENIED;
                    reject(error);
                },
                {
                    timeout: 10000,
                    maximumAge: 5 * 60 * 1000 // 5 minutes
                }
            );
        });
    }

    /**
     * Get location via IP (fallback)
     */
    async function getIPLocation() {
        try {
            const response = await fetch('https://ipapi.co/json/');
            const data = await response.json();
            return {
                lat: data.latitude,
                lon: data.longitude,
                city: data.city,
                country: data.country_name,
                source: 'ip'
            };
        } catch (error) {
            console.error('[Weather] IP location failed:', error);
            return null;
        }
    }

    /**
     * Get current location (browser first, then IP fallback)
     */
    async function getLocation() {
        if (currentLocation && (Date.now() - currentLocation.timestamp) < CACHE_DURATION) {
            return currentLocation;
        }

        try {
            const location = await getBrowserLocation();
            currentLocation = { ...location, timestamp: Date.now() };
            return currentLocation;
        } catch (error) {
            console.log('[Weather] Browser location failed, trying IP fallback');
            const ipLocation = await getIPLocation();
            if (ipLocation) {
                currentLocation = { ...ipLocation, timestamp: Date.now() };
                return currentLocation;
            }
            return null;
        }
    }

    // ============ WEATHER API ============

    /**
     * Fetch weather data from server proxy
     */
    async function fetchWeather(lat, lon) {
        try {
            const response = await fetch(`${API_ENDPOINT}?lat=${lat}&lon=${lon}`);
            if (!response.ok) {
                throw new Error(`Weather API error: ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            console.error('[Weather] API fetch failed:', error);
            return null;
        }
    }

    /**
     * Parse weather response into clean format
     */
    function parseWeatherData(data) {
        if (!data || !data.weather || !data.weather[0]) {
            return null;
        }

        const iconCode = data.weather[0].icon;
        const iconData = WEATHER_ICONS[iconCode] || WEATHER_ICONS['03d'];

        return {
            temp: Math.round(data.main.temp),
            feelsLike: Math.round(data.main.feels_like),
            humidity: data.main.humidity,
            condition: data.weather[0].main,
            description: data.weather[0].description,
            icon: iconData.icon,
            iconClass: iconData.class,
            iconName: iconData.name,
            wind: {
                speed: Math.round(data.wind.speed),
                direction: data.wind.deg
            },
            clouds: data.clouds.all,
            visibility: data.visibility / 1000, // km
            sunrise: new Date(data.sys.sunrise * 1000),
            sunset: new Date(data.sys.sunset * 1000),
            city: data.name,
            country: data.sys.country,
            timestamp: Date.now()
        };
    }

    /**
     * Get current weather (with caching)
     */
    async function getCurrentWeather(forceRefresh = false) {
        // Return cached data if still valid
        if (!forceRefresh && cachedWeather && (Date.now() - cacheTimestamp) < CACHE_DURATION) {
            return cachedWeather;
        }

        // Get location
        const location = await getLocation();
        if (!location) {
            console.log('[Weather] No location available');
            return cachedWeather; // Return stale cache if available
        }

        // Fetch weather
        const data = await fetchWeather(location.lat, location.lon);
        if (!data) {
            return cachedWeather;
        }

        // Parse and cache
        cachedWeather = parseWeatherData(data);
        cacheTimestamp = Date.now();

        console.log('[Weather] Updated:', cachedWeather?.city, cachedWeather?.temp + '°F');

        return cachedWeather;
    }

    // ============ THEME INTEGRATION ============

    /**
     * Get theme modifier based on weather condition
     */
    function getWeatherThemeModifier(weather) {
        if (!weather || !weather.iconClass) {
            return { h: 0, s: 0, l: 0 };
        }

        return WEATHER_THEME_MODIFIERS[weather.iconClass] || { h: 0, s: 0, l: 0 };
    }

    /**
     * Apply weather modifier to HSL color
     */
    function applyWeatherModifier(hsl, modifier) {
        return {
            h: Math.max(0, Math.min(360, hsl.h + modifier.h)),
            s: Math.max(0, Math.min(100, hsl.s + modifier.s)),
            l: Math.max(0, Math.min(100, hsl.l + modifier.l))
        };
    }

    /**
     * Check if weather affects theme (not disabled by user)
     */
    function shouldAffectTheme() {
        try {
            const prefs = JSON.parse(localStorage.getItem('dozWeatherPrefs') || '{}');
            return prefs.affectTheme !== false;
        } catch {
            return true;
        }
    }

    /**
     * Set weather theme preference
     */
    function setThemePreference(affectTheme) {
        try {
            const prefs = JSON.parse(localStorage.getItem('dozWeatherPrefs') || '{}');
            prefs.affectTheme = affectTheme;
            localStorage.setItem('dozWeatherPrefs', JSON.stringify(prefs));
        } catch (e) {
            console.error('[Weather] Failed to save preference:', e);
        }
    }

    // ============ AUTO-UPDATE ============
    let updateInterval = null;

    /**
     * Start automatic weather updates
     */
    function startAutoUpdate(callback, intervalMs = CACHE_DURATION) {
        stopAutoUpdate();

        // Initial fetch
        getCurrentWeather().then(weather => {
            if (callback) callback(weather);
        });

        // Set up interval
        updateInterval = setInterval(async () => {
            const weather = await getCurrentWeather(true);
            if (callback) callback(weather);
        }, intervalMs);
    }

    /**
     * Stop automatic updates
     */
    function stopAutoUpdate() {
        if (updateInterval) {
            clearInterval(updateInterval);
            updateInterval = null;
        }
    }

    // ============ EXPORT ============

    window.DOZWeatherService = {
        // Core functions
        getCurrentWeather: getCurrentWeather,
        getLocation: getLocation,

        // Theme integration
        getWeatherThemeModifier: getWeatherThemeModifier,
        applyWeatherModifier: applyWeatherModifier,
        shouldAffectTheme: shouldAffectTheme,
        setThemePreference: setThemePreference,

        // Auto-update
        startAutoUpdate: startAutoUpdate,
        stopAutoUpdate: stopAutoUpdate,

        // Data
        WEATHER_ICONS: WEATHER_ICONS,
        WEATHER_THEME_MODIFIERS: WEATHER_THEME_MODIFIERS,

        // Cache access
        getCachedWeather: () => cachedWeather,
        isLocationDenied: () => locationPermissionDenied
    };

    console.log('[DOZ Weather Service] Initialized');

})();
