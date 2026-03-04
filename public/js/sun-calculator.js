/**
 * DOZ UP - Sun Position Calculator
 * Calculates sun/moon positions for compass display
 */

(function() {
    'use strict';

    // ============ CONSTANTS ============
    const DEG_TO_RAD = Math.PI / 180;
    const RAD_TO_DEG = 180 / Math.PI;

    // ============ UTILITY FUNCTIONS ============

    /**
     * Get Julian Day Number from Date
     */
    function getJulianDay(date) {
        const time = date.getTime();
        return (time / 86400000) + 2440587.5;
    }

    /**
     * Get Julian Century from Julian Day
     */
    function getJulianCentury(jd) {
        return (jd - 2451545.0) / 36525.0;
    }

    /**
     * Normalize angle to 0-360 range
     */
    function normalizeAngle(angle) {
        angle = angle % 360;
        return angle < 0 ? angle + 360 : angle;
    }

    /**
     * Normalize angle to -180 to 180 range
     */
    function normalizeAngle180(angle) {
        angle = normalizeAngle(angle);
        return angle > 180 ? angle - 360 : angle;
    }

    // ============ SOLAR CALCULATIONS ============

    /**
     * Calculate the geometric mean longitude of the sun
     */
    function sunMeanLongitude(jc) {
        return normalizeAngle(280.46646 + jc * (36000.76983 + 0.0003032 * jc));
    }

    /**
     * Calculate the geometric mean anomaly of the sun
     */
    function sunMeanAnomaly(jc) {
        return 357.52911 + jc * (35999.05029 - 0.0001537 * jc);
    }

    /**
     * Calculate the eccentricity of Earth's orbit
     */
    function earthOrbitEccentricity(jc) {
        return 0.016708634 - jc * (0.000042037 + 0.0000001267 * jc);
    }

    /**
     * Calculate the equation of center for the sun
     */
    function sunEquationOfCenter(jc) {
        const m = sunMeanAnomaly(jc);
        const mRad = m * DEG_TO_RAD;
        return Math.sin(mRad) * (1.914602 - jc * (0.004817 + 0.000014 * jc)) +
               Math.sin(2 * mRad) * (0.019993 - 0.000101 * jc) +
               Math.sin(3 * mRad) * 0.000289;
    }

    /**
     * Calculate the sun's true longitude
     */
    function sunTrueLongitude(jc) {
        return sunMeanLongitude(jc) + sunEquationOfCenter(jc);
    }

    /**
     * Calculate the sun's apparent longitude
     */
    function sunApparentLongitude(jc) {
        const omega = 125.04 - 1934.136 * jc;
        return sunTrueLongitude(jc) - 0.00569 - 0.00478 * Math.sin(omega * DEG_TO_RAD);
    }

    /**
     * Calculate the mean obliquity of the ecliptic
     */
    function meanObliquityOfEcliptic(jc) {
        const seconds = 21.448 - jc * (46.8150 + jc * (0.00059 - jc * 0.001813));
        return 23.0 + (26.0 + seconds / 60.0) / 60.0;
    }

    /**
     * Calculate the corrected obliquity of the ecliptic
     */
    function obliquityCorrection(jc) {
        const omega = 125.04 - 1934.136 * jc;
        return meanObliquityOfEcliptic(jc) + 0.00256 * Math.cos(omega * DEG_TO_RAD);
    }

    /**
     * Calculate the sun's declination
     */
    function sunDeclination(jc) {
        const e = obliquityCorrection(jc) * DEG_TO_RAD;
        const lambda = sunApparentLongitude(jc) * DEG_TO_RAD;
        return Math.asin(Math.sin(e) * Math.sin(lambda)) * RAD_TO_DEG;
    }

    /**
     * Calculate the equation of time (in minutes)
     */
    function equationOfTime(jc) {
        const e = earthOrbitEccentricity(jc);
        const m = sunMeanAnomaly(jc) * DEG_TO_RAD;
        const l0 = sunMeanLongitude(jc) * DEG_TO_RAD;
        const y = Math.tan(obliquityCorrection(jc) * DEG_TO_RAD / 2);
        const y2 = y * y;

        const sin2l0 = Math.sin(2 * l0);
        const cos2l0 = Math.cos(2 * l0);
        const sin4l0 = Math.sin(4 * l0);
        const sinm = Math.sin(m);
        const sin2m = Math.sin(2 * m);

        const Etime = y2 * sin2l0 - 2 * e * sinm + 4 * e * y2 * sinm * cos2l0 -
                      0.5 * y2 * y2 * sin4l0 - 1.25 * e * e * sin2m;

        return Etime * RAD_TO_DEG * 4; // Convert to minutes
    }

    /**
     * Calculate hour angle for sunrise/sunset
     */
    function hourAngleSunrise(lat, declination, zenith = 90.833) {
        const latRad = lat * DEG_TO_RAD;
        const decRad = declination * DEG_TO_RAD;
        const zenithRad = zenith * DEG_TO_RAD;

        const cosHA = (Math.cos(zenithRad) / (Math.cos(latRad) * Math.cos(decRad))) -
                      Math.tan(latRad) * Math.tan(decRad);

        if (cosHA > 1) return null; // No sunrise (polar night)
        if (cosHA < -1) return null; // No sunset (midnight sun)

        return Math.acos(cosHA) * RAD_TO_DEG;
    }

    /**
     * Calculate solar noon time
     */
    function solarNoon(jd, longitude, timezone) {
        const jc = getJulianCentury(jd);
        const eqTime = equationOfTime(jc);
        const noonOffset = 720 - (longitude * 4) - eqTime;
        return noonOffset + timezone * 60;
    }

    /**
     * Calculate sun position (altitude and azimuth)
     */
    function calculateSunPosition(date, latitude, longitude) {
        const jd = getJulianDay(date);
        const jc = getJulianCentury(jd);

        const declination = sunDeclination(jc);
        const eqTime = equationOfTime(jc);

        // Calculate hour angle
        const hours = date.getHours() + date.getMinutes() / 60 + date.getSeconds() / 3600;
        const timezone = -date.getTimezoneOffset() / 60;
        const trueSolarTime = hours * 60 + eqTime + longitude * 4 - timezone * 60;
        let hourAngle = (trueSolarTime / 4) - 180;

        // Calculate altitude
        const latRad = latitude * DEG_TO_RAD;
        const decRad = declination * DEG_TO_RAD;
        const haRad = hourAngle * DEG_TO_RAD;

        const sinAlt = Math.sin(latRad) * Math.sin(decRad) +
                       Math.cos(latRad) * Math.cos(decRad) * Math.cos(haRad);
        const altitude = Math.asin(sinAlt) * RAD_TO_DEG;

        // Calculate azimuth
        const cosAz = (Math.sin(decRad) - Math.sin(latRad) * sinAlt) /
                      (Math.cos(latRad) * Math.cos(Math.asin(sinAlt)));
        let azimuth = Math.acos(Math.max(-1, Math.min(1, cosAz))) * RAD_TO_DEG;

        if (hourAngle > 0) {
            azimuth = 360 - azimuth;
        }

        return {
            altitude: altitude,
            azimuth: azimuth
        };
    }

    /**
     * Calculate sunrise and sunset times
     */
    function calculateSunTimes(date, latitude, longitude) {
        const jd = getJulianDay(date) - 0.5 + 0.5; // Start of day
        const jc = getJulianCentury(jd);
        const timezone = -date.getTimezoneOffset() / 60;

        const declination = sunDeclination(jc);
        const eqTime = equationOfTime(jc);
        const ha = hourAngleSunrise(latitude, declination);

        if (ha === null) {
            // Polar day or night
            const sunPos = calculateSunPosition(new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0), latitude, longitude);
            return {
                sunrise: null,
                sunset: null,
                solarNoon: null,
                dayLength: sunPos.altitude > 0 ? 24 : 0,
                polarDay: sunPos.altitude > 0,
                polarNight: sunPos.altitude <= 0
            };
        }

        // Calculate times in minutes from midnight
        const noonMinutes = 720 - (longitude * 4) - eqTime + (timezone * 60);
        const sunriseMinutes = noonMinutes - (ha * 4);
        const sunsetMinutes = noonMinutes + (ha * 4);

        // Convert to Date objects
        const baseDate = new Date(date.getFullYear(), date.getMonth(), date.getDate());

        const sunrise = new Date(baseDate.getTime() + sunriseMinutes * 60000);
        const sunset = new Date(baseDate.getTime() + sunsetMinutes * 60000);
        const noon = new Date(baseDate.getTime() + noonMinutes * 60000);

        const dayLength = (sunsetMinutes - sunriseMinutes) / 60;

        return {
            sunrise: sunrise,
            sunset: sunset,
            solarNoon: noon,
            dayLength: dayLength,
            polarDay: false,
            polarNight: false
        };
    }

    /**
     * Get sun phase name based on altitude
     */
    function getSunPhase(altitude) {
        if (altitude > 6) return 'daylight';
        if (altitude > 0) return 'golden-hour';
        if (altitude > -6) return 'civil-twilight';
        if (altitude > -12) return 'nautical-twilight';
        if (altitude > -18) return 'astronomical-twilight';
        return 'night';
    }

    // ============ MOON CALCULATIONS ============

    /**
     * Calculate moon phase
     */
    function getMoonPhase(date) {
        const year = date.getFullYear();
        const month = date.getMonth() + 1;
        const day = date.getDate();

        let c, e, jd, b;

        if (month < 3) {
            c = year - 1;
            e = month + 12;
        } else {
            c = year;
            e = month;
        }

        jd = Math.floor(365.25 * c) + Math.floor(30.6001 * (e + 1)) + day - 694039.09;
        jd /= 29.53058867;
        b = Math.floor(jd);
        jd -= b;
        const phase = Math.round(jd * 8);

        const phaseNames = [
            'New Moon',
            'Waxing Crescent',
            'First Quarter',
            'Waxing Gibbous',
            'Full Moon',
            'Waning Gibbous',
            'Last Quarter',
            'Waning Crescent'
        ];

        const phaseIcons = ['🌑', '🌒', '🌓', '🌔', '🌕', '🌖', '🌗', '🌘'];

        const illumination = (1 - Math.cos(jd * 2 * Math.PI)) / 2;

        return {
            phase: phase % 8,
            name: phaseNames[phase % 8],
            icon: phaseIcons[phase % 8],
            illumination: Math.round(illumination * 100)
        };
    }

    /**
     * Get compass direction from azimuth
     */
    function getCompassDirection(azimuth) {
        const directions = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
                           'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
        const index = Math.round(azimuth / 22.5) % 16;
        return directions[index];
    }

    /**
     * Get compass direction simple (8 directions)
     */
    function getCompassDirectionSimple(azimuth) {
        const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
        const index = Math.round(azimuth / 45) % 8;
        return directions[index];
    }

    // ============ MAIN API ============

    /**
     * Get complete sun data for a location and time
     */
    function getSunData(date, latitude, longitude) {
        const position = calculateSunPosition(date, latitude, longitude);
        const times = calculateSunTimes(date, latitude, longitude);
        const phase = getSunPhase(position.altitude);
        const moon = getMoonPhase(date);

        return {
            position: {
                altitude: Math.round(position.altitude * 100) / 100,
                azimuth: Math.round(position.azimuth * 100) / 100,
                direction: getCompassDirection(position.azimuth),
                directionSimple: getCompassDirectionSimple(position.azimuth)
            },
            times: {
                sunrise: times.sunrise,
                sunset: times.sunset,
                solarNoon: times.solarNoon,
                dayLength: Math.round(times.dayLength * 100) / 100,
                polarDay: times.polarDay,
                polarNight: times.polarNight
            },
            phase: phase,
            isDay: position.altitude > 0,
            isGoldenHour: position.altitude > 0 && position.altitude < 6,
            isTwilight: position.altitude <= 0 && position.altitude > -18,
            moon: moon
        };
    }

    // ============ EXPORT ============

    window.DOZSunCalculator = {
        getSunData: getSunData,
        calculateSunPosition: calculateSunPosition,
        calculateSunTimes: calculateSunTimes,
        getSunPhase: getSunPhase,
        getMoonPhase: getMoonPhase,
        getCompassDirection: getCompassDirection
    };

    console.log('[DOZ Sun Calculator] Initialized');

})();
