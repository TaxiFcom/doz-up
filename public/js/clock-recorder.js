/**
 * DOZ UP - Clock Recorder
 * Video, screen, and meeting recording functionality
 */

(function() {
    'use strict';

    // ============ CONFIGURATION ============
    const RECORDING_OPTIONS = {
        video: {
            mimeType: 'video/webm;codecs=vp9,opus',
            audioBitsPerSecond: 128000,
            videoBitsPerSecond: 2500000
        },
        screen: {
            mimeType: 'video/webm;codecs=vp9,opus',
            audioBitsPerSecond: 128000,
            videoBitsPerSecond: 4000000
        }
    };

    // ============ STATE ============
    let videoRecorder = null;
    let screenRecorder = null;
    let videoStream = null;
    let screenStream = null;
    let recordedChunks = [];
    let recordingStartTime = null;
    let recordingType = null;
    let durationInterval = null;

    // ============ RECORDING STATE CALLBACKS ============
    let onStateChange = null;
    let onDurationUpdate = null;

    // ============ UTILITY FUNCTIONS ============

    /**
     * Format duration in mm:ss
     */
    function formatDuration(ms) {
        const seconds = Math.floor(ms / 1000);
        const mins = Math.floor(seconds / 60);
        const secs = seconds % 60;
        return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
    }

    /**
     * Get supported MIME type
     */
    function getSupportedMimeType() {
        const types = [
            'video/webm;codecs=vp9,opus',
            'video/webm;codecs=vp8,opus',
            'video/webm',
            'video/mp4'
        ];
        return types.find(type => MediaRecorder.isTypeSupported(type)) || '';
    }

    /**
     * Generate filename with timestamp
     */
    function generateFilename(type) {
        const now = new Date();
        const timestamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
        return `DOZ-${type}-${timestamp}.webm`;
    }

    // ============ VIDEO RECORDING ============

    /**
     * Check if camera is available
     */
    async function hasCameraAccess() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            return devices.some(device => device.kind === 'videoinput');
        } catch {
            return false;
        }
    }

    /**
     * Start video recording (webcam)
     */
    async function startVideoRecording(options = {}) {
        if (videoRecorder && videoRecorder.state === 'recording') {
            console.log('[Recorder] Already recording video');
            return { success: false, error: 'Already recording' };
        }

        try {
            const constraints = {
                video: {
                    width: { ideal: options.width || 1280 },
                    height: { ideal: options.height || 720 },
                    facingMode: options.facingMode || 'user'
                },
                audio: options.audio !== false
            };

            videoStream = await navigator.mediaDevices.getUserMedia(constraints);

            const mimeType = getSupportedMimeType();
            const recorderOptions = {
                ...RECORDING_OPTIONS.video,
                mimeType: mimeType
            };

            recordedChunks = [];
            videoRecorder = new MediaRecorder(videoStream, recorderOptions);

            videoRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    recordedChunks.push(event.data);
                }
            };

            videoRecorder.onstop = () => {
                stopDurationTimer();
                if (onStateChange) onStateChange('stopped', 'video');
            };

            videoRecorder.onerror = (error) => {
                console.error('[Recorder] Video recording error:', error);
                stopDurationTimer();
                if (onStateChange) onStateChange('error', 'video', error);
            };

            videoRecorder.start(1000); // Capture in 1 second chunks
            recordingStartTime = Date.now();
            recordingType = 'video';

            startDurationTimer();

            if (onStateChange) onStateChange('recording', 'video');

            console.log('[Recorder] Video recording started');
            return { success: true, stream: videoStream };

        } catch (error) {
            console.error('[Recorder] Failed to start video recording:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Stop video recording and return blob
     */
    async function stopVideoRecording() {
        if (!videoRecorder || videoRecorder.state !== 'recording') {
            return { success: false, error: 'Not recording' };
        }

        return new Promise((resolve) => {
            videoRecorder.onstop = () => {
                stopDurationTimer();

                // Stop all tracks
                if (videoStream) {
                    videoStream.getTracks().forEach(track => track.stop());
                    videoStream = null;
                }

                // Create blob
                const blob = new Blob(recordedChunks, { type: 'video/webm' });
                const duration = Date.now() - recordingStartTime;

                videoRecorder = null;
                recordingType = null;

                if (onStateChange) onStateChange('stopped', 'video');

                console.log('[Recorder] Video recording stopped, size:', Math.round(blob.size / 1024), 'KB');

                resolve({
                    success: true,
                    blob: blob,
                    duration: duration,
                    filename: generateFilename('Video')
                });
            };

            videoRecorder.stop();
        });
    }

    // ============ VIDEO SNAP (PHOTO CAPTURE) ============

    /**
     * Capture a single frame from webcam
     */
    async function captureVideoSnap(options = {}) {
        try {
            const constraints = {
                video: {
                    width: { ideal: options.width || 1920 },
                    height: { ideal: options.height || 1080 },
                    facingMode: options.facingMode || 'user'
                }
            };

            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            const track = stream.getVideoTracks()[0];

            // Create video element to capture frame
            const video = document.createElement('video');
            video.srcObject = stream;
            video.autoplay = true;

            await new Promise(resolve => video.onloadedmetadata = resolve);
            await video.play();

            // Wait a moment for camera to adjust
            await new Promise(resolve => setTimeout(resolve, 500));

            // Capture frame to canvas
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');

            // Mirror if using front camera
            if (options.facingMode !== 'environment') {
                ctx.translate(canvas.width, 0);
                ctx.scale(-1, 1);
            }

            ctx.drawImage(video, 0, 0);

            // Stop stream
            stream.getTracks().forEach(t => t.stop());

            // Convert to blob
            const blob = await new Promise(resolve => {
                canvas.toBlob(resolve, 'image/png', 1.0);
            });

            console.log('[Recorder] Video snap captured, size:', Math.round(blob.size / 1024), 'KB');

            return {
                success: true,
                blob: blob,
                width: canvas.width,
                height: canvas.height,
                filename: generateFilename('Snap').replace('.webm', '.png')
            };

        } catch (error) {
            console.error('[Recorder] Failed to capture snap:', error);
            return { success: false, error: error.message };
        }
    }

    // ============ SCREEN RECORDING ============

    /**
     * Check if screen capture is supported
     */
    function hasScreenCaptureSupport() {
        return !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia);
    }

    /**
     * Start screen recording
     */
    async function startScreenRecording(options = {}) {
        if (screenRecorder && screenRecorder.state === 'recording') {
            console.log('[Recorder] Already recording screen');
            return { success: false, error: 'Already recording' };
        }

        if (!hasScreenCaptureSupport()) {
            return { success: false, error: 'Screen capture not supported' };
        }

        try {
            const displayOptions = {
                video: {
                    cursor: options.cursor !== false ? 'always' : 'never',
                    displaySurface: options.displaySurface || 'monitor'
                },
                audio: options.audio !== false
            };

            screenStream = await navigator.mediaDevices.getDisplayMedia(displayOptions);

            // Add system audio if requested and supported
            if (options.systemAudio) {
                try {
                    const audioStream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    audioStream.getAudioTracks().forEach(track => {
                        screenStream.addTrack(track);
                    });
                } catch (e) {
                    console.log('[Recorder] Could not add microphone audio:', e);
                }
            }

            const mimeType = getSupportedMimeType();
            const recorderOptions = {
                ...RECORDING_OPTIONS.screen,
                mimeType: mimeType
            };

            recordedChunks = [];
            screenRecorder = new MediaRecorder(screenStream, recorderOptions);

            screenRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    recordedChunks.push(event.data);
                }
            };

            screenRecorder.onstop = () => {
                stopDurationTimer();
                if (onStateChange) onStateChange('stopped', 'screen');
            };

            screenRecorder.onerror = (error) => {
                console.error('[Recorder] Screen recording error:', error);
                stopDurationTimer();
                if (onStateChange) onStateChange('error', 'screen', error);
            };

            // Handle user stopping share via browser UI
            screenStream.getVideoTracks()[0].onended = () => {
                if (screenRecorder && screenRecorder.state === 'recording') {
                    stopScreenRecording();
                }
            };

            screenRecorder.start(1000);
            recordingStartTime = Date.now();
            recordingType = 'screen';

            startDurationTimer();

            if (onStateChange) onStateChange('recording', 'screen');

            console.log('[Recorder] Screen recording started');
            return { success: true, stream: screenStream };

        } catch (error) {
            console.error('[Recorder] Failed to start screen recording:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Stop screen recording and return blob
     */
    async function stopScreenRecording() {
        if (!screenRecorder || screenRecorder.state !== 'recording') {
            return { success: false, error: 'Not recording' };
        }

        return new Promise((resolve) => {
            screenRecorder.onstop = () => {
                stopDurationTimer();

                // Stop all tracks
                if (screenStream) {
                    screenStream.getTracks().forEach(track => track.stop());
                    screenStream = null;
                }

                // Create blob
                const blob = new Blob(recordedChunks, { type: 'video/webm' });
                const duration = Date.now() - recordingStartTime;

                screenRecorder = null;
                recordingType = null;

                if (onStateChange) onStateChange('stopped', 'screen');

                console.log('[Recorder] Screen recording stopped, size:', Math.round(blob.size / 1024), 'KB');

                resolve({
                    success: true,
                    blob: blob,
                    duration: duration,
                    filename: generateFilename('Screen')
                });
            };

            screenRecorder.stop();
        });
    }

    // ============ DURATION TIMER ============

    function startDurationTimer() {
        stopDurationTimer();
        durationInterval = setInterval(() => {
            if (recordingStartTime && onDurationUpdate) {
                const duration = Date.now() - recordingStartTime;
                onDurationUpdate(duration, formatDuration(duration));
            }
        }, 1000);
    }

    function stopDurationTimer() {
        if (durationInterval) {
            clearInterval(durationInterval);
            durationInterval = null;
        }
    }

    // ============ GENERAL CONTROLS ============

    /**
     * Stop any active recording
     */
    async function stopRecording() {
        if (videoRecorder && videoRecorder.state === 'recording') {
            return await stopVideoRecording();
        }
        if (screenRecorder && screenRecorder.state === 'recording') {
            return await stopScreenRecording();
        }
        return { success: false, error: 'No active recording' };
    }

    /**
     * Get current recording status
     */
    function getRecordingStatus() {
        const isVideoRecording = videoRecorder && videoRecorder.state === 'recording';
        const isScreenRecording = screenRecorder && screenRecorder.state === 'recording';

        return {
            isRecording: isVideoRecording || isScreenRecording,
            type: recordingType,
            duration: recordingStartTime ? Date.now() - recordingStartTime : 0,
            formattedDuration: recordingStartTime ? formatDuration(Date.now() - recordingStartTime) : '00:00'
        };
    }

    // ============ DOWNLOAD & UPLOAD ============

    /**
     * Download recording as file
     */
    function downloadRecording(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    /**
     * Upload recording to DOZ UP cloud
     */
    async function uploadRecording(blob, filename) {
        const formData = new FormData();
        formData.append('file', blob, filename);
        formData.append('type', 'recording');

        try {
            const response = await fetch('/upload', {
                method: 'POST',
                body: formData
            });

            if (!response.ok) {
                throw new Error(`Upload failed: ${response.status}`);
            }

            const result = await response.json();
            console.log('[Recorder] Upload complete:', result.url);
            return { success: true, ...result };

        } catch (error) {
            console.error('[Recorder] Upload failed:', error);
            return { success: false, error: error.message };
        }
    }

    // ============ EXPORT ============

    window.DOZClockRecorder = {
        // Video recording
        startVideoRecording: startVideoRecording,
        stopVideoRecording: stopVideoRecording,
        captureVideoSnap: captureVideoSnap,
        hasCameraAccess: hasCameraAccess,

        // Screen recording
        startScreenRecording: startScreenRecording,
        stopScreenRecording: stopScreenRecording,
        hasScreenCaptureSupport: hasScreenCaptureSupport,

        // General controls
        stopRecording: stopRecording,
        getRecordingStatus: getRecordingStatus,

        // File handling
        downloadRecording: downloadRecording,
        uploadRecording: uploadRecording,

        // Callbacks
        setOnStateChange: (callback) => { onStateChange = callback; },
        setOnDurationUpdate: (callback) => { onDurationUpdate = callback; },

        // Utilities
        formatDuration: formatDuration,
        getSupportedMimeType: getSupportedMimeType
    };

    console.log('[DOZ Clock Recorder] Initialized');

})();
