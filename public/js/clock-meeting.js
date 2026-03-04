/**
 * DOZ UP - Clock Meeting Client
 * WebRTC-based multi-user video meetings
 */

(function() {
    'use strict';

    // ============ CONFIGURATION ============
    const ICE_SERVERS = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ];

    const SIGNALING_PATH = '/ws/meeting';

    // ============ STATE ============
    let socket = null;
    let localStream = null;
    let screenStream = null;
    let peers = new Map(); // peerId -> { connection, stream, video }
    let roomId = null;
    let participantId = null;
    let participantName = null;
    let isHost = false;
    let isMuted = false;
    let isVideoOff = false;
    let isScreenSharing = false;

    // ============ CALLBACKS ============
    let onParticipantJoined = null;
    let onParticipantLeft = null;
    let onStreamReceived = null;
    let onScreenShareStarted = null;
    let onScreenShareStopped = null;
    let onConnectionStateChange = null;
    let onError = null;

    // ============ WEBSOCKET SIGNALING ============

    /**
     * Connect to signaling server
     */
    function connectSignaling() {
        return new Promise((resolve, reject) => {
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}${SIGNALING_PATH}`;

            socket = new WebSocket(wsUrl);

            socket.onopen = () => {
                console.log('[Meeting] Signaling connected');
                resolve();
            };

            socket.onerror = (error) => {
                console.error('[Meeting] Signaling error:', error);
                reject(error);
            };

            socket.onclose = () => {
                console.log('[Meeting] Signaling disconnected');
                cleanup();
            };

            socket.onmessage = handleSignalingMessage;
        });
    }

    /**
     * Handle incoming signaling messages
     */
    async function handleSignalingMessage(event) {
        const message = JSON.parse(event.data);

        switch (message.type) {
            case 'room-joined':
                handleRoomJoined(message);
                break;

            case 'participant-joined':
                await handleParticipantJoined(message);
                break;

            case 'participant-left':
                handleParticipantLeft(message);
                break;

            case 'offer':
                await handleOffer(message);
                break;

            case 'answer':
                await handleAnswer(message);
                break;

            case 'ice-candidate':
                await handleIceCandidate(message);
                break;

            case 'screen-share-started':
                if (onScreenShareStarted) onScreenShareStarted(message.participantId);
                break;

            case 'screen-share-stopped':
                if (onScreenShareStopped) onScreenShareStopped(message.participantId);
                break;

            case 'error':
                console.error('[Meeting] Server error:', message.error);
                if (onError) onError(message.error);
                break;
        }
    }

    /**
     * Send signaling message
     */
    function sendSignaling(type, data) {
        if (socket && socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type, ...data }));
        }
    }

    // ============ ROOM MANAGEMENT ============

    /**
     * Create a new meeting room
     */
    async function createRoom(options = {}) {
        try {
            await connectSignaling();

            participantName = options.name || 'Host';
            isHost = true;

            sendSignaling('create-room', {
                name: participantName,
                roomName: options.roomName || 'DOZ Meeting'
            });

            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Create room timeout')), 10000);

                const originalHandler = socket.onmessage;
                socket.onmessage = (event) => {
                    const message = JSON.parse(event.data);
                    if (message.type === 'room-created') {
                        clearTimeout(timeout);
                        roomId = message.roomId;
                        participantId = message.participantId;
                        socket.onmessage = originalHandler;
                        console.log('[Meeting] Room created:', roomId);
                        resolve({
                            success: true,
                            roomId: roomId,
                            roomCode: message.roomCode,
                            joinUrl: `${window.location.origin}/meet/${message.roomCode}`
                        });
                    } else if (message.type === 'error') {
                        clearTimeout(timeout);
                        socket.onmessage = originalHandler;
                        reject(new Error(message.error));
                    } else {
                        originalHandler(event);
                    }
                };
            });

        } catch (error) {
            console.error('[Meeting] Failed to create room:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Join an existing meeting room
     */
    async function joinRoom(roomCode, options = {}) {
        try {
            await connectSignaling();

            participantName = options.name || 'Participant';
            isHost = false;

            sendSignaling('join-room', {
                roomCode: roomCode,
                name: participantName
            });

            return new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Join room timeout')), 10000);

                const originalHandler = socket.onmessage;
                socket.onmessage = (event) => {
                    const message = JSON.parse(event.data);
                    if (message.type === 'room-joined') {
                        clearTimeout(timeout);
                        roomId = message.roomId;
                        participantId = message.participantId;
                        socket.onmessage = originalHandler;
                        handleRoomJoined(message);
                        console.log('[Meeting] Joined room:', roomId);
                        resolve({
                            success: true,
                            roomId: roomId,
                            participants: message.participants
                        });
                    } else if (message.type === 'error') {
                        clearTimeout(timeout);
                        socket.onmessage = originalHandler;
                        reject(new Error(message.error));
                    } else {
                        originalHandler(event);
                    }
                };
            });

        } catch (error) {
            console.error('[Meeting] Failed to join room:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Leave the current room
     */
    function leaveRoom() {
        sendSignaling('leave-room', { roomId, participantId });
        cleanup();
    }

    /**
     * Handle room joined - connect to existing participants
     */
    async function handleRoomJoined(message) {
        // Start local media
        await startLocalMedia();

        // Connect to existing participants
        if (message.participants) {
            for (const participant of message.participants) {
                if (participant.id !== participantId) {
                    await createPeerConnection(participant.id, true);
                }
            }
        }

        if (onConnectionStateChange) onConnectionStateChange('connected');
    }

    /**
     * Handle new participant joined
     */
    async function handleParticipantJoined(message) {
        console.log('[Meeting] Participant joined:', message.participantId);

        // They will initiate the connection to us
        if (onParticipantJoined) {
            onParticipantJoined({
                id: message.participantId,
                name: message.name
            });
        }
    }

    /**
     * Handle participant left
     */
    function handleParticipantLeft(message) {
        console.log('[Meeting] Participant left:', message.participantId);

        const peer = peers.get(message.participantId);
        if (peer) {
            if (peer.connection) {
                peer.connection.close();
            }
            peers.delete(message.participantId);
        }

        if (onParticipantLeft) {
            onParticipantLeft({ id: message.participantId });
        }
    }

    // ============ WEBRTC CONNECTIONS ============

    /**
     * Create peer connection for a participant
     */
    async function createPeerConnection(peerId, initiator = false) {
        const connection = new RTCPeerConnection({ iceServers: ICE_SERVERS });

        const peer = {
            id: peerId,
            connection: connection,
            stream: null
        };
        peers.set(peerId, peer);

        // Add local tracks
        if (localStream) {
            localStream.getTracks().forEach(track => {
                connection.addTrack(track, localStream);
            });
        }

        // Handle ICE candidates
        connection.onicecandidate = (event) => {
            if (event.candidate) {
                sendSignaling('ice-candidate', {
                    roomId: roomId,
                    targetId: peerId,
                    candidate: event.candidate
                });
            }
        };

        // Handle incoming tracks
        connection.ontrack = (event) => {
            console.log('[Meeting] Received track from:', peerId);
            peer.stream = event.streams[0];

            if (onStreamReceived) {
                onStreamReceived(peerId, event.streams[0]);
            }
        };

        // Handle connection state changes
        connection.onconnectionstatechange = () => {
            console.log('[Meeting] Connection state:', connection.connectionState);
        };

        // If initiator, create and send offer
        if (initiator) {
            const offer = await connection.createOffer();
            await connection.setLocalDescription(offer);

            sendSignaling('offer', {
                roomId: roomId,
                targetId: peerId,
                sdp: connection.localDescription
            });
        }

        return connection;
    }

    /**
     * Handle incoming offer
     */
    async function handleOffer(message) {
        const peerId = message.fromId;

        let peer = peers.get(peerId);
        if (!peer) {
            await createPeerConnection(peerId, false);
            peer = peers.get(peerId);
        }

        const connection = peer.connection;

        await connection.setRemoteDescription(new RTCSessionDescription(message.sdp));
        const answer = await connection.createAnswer();
        await connection.setLocalDescription(answer);

        sendSignaling('answer', {
            roomId: roomId,
            targetId: peerId,
            sdp: connection.localDescription
        });
    }

    /**
     * Handle incoming answer
     */
    async function handleAnswer(message) {
        const peer = peers.get(message.fromId);
        if (peer && peer.connection) {
            await peer.connection.setRemoteDescription(new RTCSessionDescription(message.sdp));
        }
    }

    /**
     * Handle incoming ICE candidate
     */
    async function handleIceCandidate(message) {
        const peer = peers.get(message.fromId);
        if (peer && peer.connection) {
            await peer.connection.addIceCandidate(new RTCIceCandidate(message.candidate));
        }
    }

    // ============ MEDIA CONTROLS ============

    /**
     * Start local media (camera + microphone)
     */
    async function startLocalMedia(options = {}) {
        try {
            localStream = await navigator.mediaDevices.getUserMedia({
                video: options.video !== false,
                audio: options.audio !== false
            });

            console.log('[Meeting] Local media started');
            return { success: true, stream: localStream };

        } catch (error) {
            console.error('[Meeting] Failed to get media:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Get local stream
     */
    function getLocalStream() {
        return localStream;
    }

    /**
     * Toggle microphone mute
     */
    function toggleMute() {
        if (localStream) {
            const audioTrack = localStream.getAudioTracks()[0];
            if (audioTrack) {
                audioTrack.enabled = !audioTrack.enabled;
                isMuted = !audioTrack.enabled;
                console.log('[Meeting] Muted:', isMuted);
                return isMuted;
            }
        }
        return false;
    }

    /**
     * Toggle video on/off
     */
    function toggleVideo() {
        if (localStream) {
            const videoTrack = localStream.getVideoTracks()[0];
            if (videoTrack) {
                videoTrack.enabled = !videoTrack.enabled;
                isVideoOff = !videoTrack.enabled;
                console.log('[Meeting] Video off:', isVideoOff);
                return isVideoOff;
            }
        }
        return false;
    }

    /**
     * Start screen sharing
     */
    async function startScreenShare() {
        try {
            screenStream = await navigator.mediaDevices.getDisplayMedia({
                video: { cursor: 'always' },
                audio: false
            });

            const videoTrack = screenStream.getVideoTracks()[0];

            // Replace video track in all peer connections
            peers.forEach((peer) => {
                const sender = peer.connection.getSenders().find(s => s.track?.kind === 'video');
                if (sender) {
                    sender.replaceTrack(videoTrack);
                }
            });

            // Handle user stopping share
            videoTrack.onended = () => {
                stopScreenShare();
            };

            isScreenSharing = true;
            sendSignaling('screen-share-started', { roomId, participantId });

            console.log('[Meeting] Screen share started');
            return { success: true, stream: screenStream };

        } catch (error) {
            console.error('[Meeting] Screen share failed:', error);
            return { success: false, error: error.message };
        }
    }

    /**
     * Stop screen sharing
     */
    function stopScreenShare() {
        if (screenStream) {
            screenStream.getTracks().forEach(track => track.stop());
            screenStream = null;
        }

        // Restore camera video
        if (localStream) {
            const videoTrack = localStream.getVideoTracks()[0];
            if (videoTrack) {
                peers.forEach((peer) => {
                    const sender = peer.connection.getSenders().find(s => s.track?.kind === 'video');
                    if (sender) {
                        sender.replaceTrack(videoTrack);
                    }
                });
            }
        }

        isScreenSharing = false;
        sendSignaling('screen-share-stopped', { roomId, participantId });

        console.log('[Meeting] Screen share stopped');
    }

    // ============ RECORDING ============

    let meetingRecorder = null;
    let recordedChunks = [];

    /**
     * Start recording all meeting streams
     */
    async function startRecording() {
        // Create canvas to composite all streams
        const canvas = document.createElement('canvas');
        canvas.width = 1920;
        canvas.height = 1080;
        const ctx = canvas.getContext('2d');

        // Create audio mixer
        const audioContext = new AudioContext();
        const destination = audioContext.createMediaStreamDestination();

        // Add local audio
        if (localStream) {
            const source = audioContext.createMediaStreamSource(localStream);
            source.connect(destination);
        }

        // Add remote audio
        peers.forEach((peer) => {
            if (peer.stream) {
                const source = audioContext.createMediaStreamSource(peer.stream);
                source.connect(destination);
            }
        });

        // Create combined stream
        const canvasStream = canvas.captureStream(30);
        const combinedStream = new MediaStream([
            ...canvasStream.getVideoTracks(),
            ...destination.stream.getAudioTracks()
        ]);

        // Start recording
        recordedChunks = [];
        meetingRecorder = new MediaRecorder(combinedStream, {
            mimeType: 'video/webm;codecs=vp9,opus'
        });

        meetingRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };

        // Start rendering loop
        const renderFrame = () => {
            if (!meetingRecorder || meetingRecorder.state !== 'recording') return;

            ctx.fillStyle = '#1a1a2e';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Draw all video streams in grid
            const streams = [localStream, ...Array.from(peers.values()).map(p => p.stream)].filter(Boolean);
            const cols = Math.ceil(Math.sqrt(streams.length));
            const rows = Math.ceil(streams.length / cols);
            const cellWidth = canvas.width / cols;
            const cellHeight = canvas.height / rows;

            streams.forEach((stream, i) => {
                const video = document.querySelector(`video[data-stream-id="${stream.id}"]`);
                if (video && video.readyState >= 2) {
                    const x = (i % cols) * cellWidth;
                    const y = Math.floor(i / cols) * cellHeight;
                    ctx.drawImage(video, x, y, cellWidth, cellHeight);
                }
            });

            requestAnimationFrame(renderFrame);
        };

        meetingRecorder.start(1000);
        renderFrame();

        console.log('[Meeting] Recording started');
        return { success: true };
    }

    /**
     * Stop meeting recording
     */
    async function stopRecording() {
        if (!meetingRecorder || meetingRecorder.state !== 'recording') {
            return { success: false, error: 'Not recording' };
        }

        return new Promise((resolve) => {
            meetingRecorder.onstop = () => {
                const blob = new Blob(recordedChunks, { type: 'video/webm' });
                meetingRecorder = null;

                console.log('[Meeting] Recording stopped, size:', Math.round(blob.size / 1024), 'KB');

                resolve({
                    success: true,
                    blob: blob,
                    filename: `DOZ-Meeting-${new Date().toISOString().slice(0, 19).replace(/[:.]/g, '-')}.webm`
                });
            };

            meetingRecorder.stop();
        });
    }

    // ============ CLEANUP ============

    /**
     * Clean up all resources
     */
    function cleanup() {
        // Stop local media
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
            localStream = null;
        }

        if (screenStream) {
            screenStream.getTracks().forEach(track => track.stop());
            screenStream = null;
        }

        // Close all peer connections
        peers.forEach((peer) => {
            if (peer.connection) {
                peer.connection.close();
            }
        });
        peers.clear();

        // Close WebSocket
        if (socket) {
            socket.close();
            socket = null;
        }

        // Stop recording
        if (meetingRecorder && meetingRecorder.state === 'recording') {
            meetingRecorder.stop();
        }

        roomId = null;
        participantId = null;
        isHost = false;

        if (onConnectionStateChange) onConnectionStateChange('disconnected');

        console.log('[Meeting] Cleaned up');
    }

    // ============ STATUS ============

    /**
     * Get current meeting status
     */
    function getStatus() {
        return {
            inMeeting: !!roomId,
            roomId: roomId,
            participantId: participantId,
            isHost: isHost,
            isMuted: isMuted,
            isVideoOff: isVideoOff,
            isScreenSharing: isScreenSharing,
            isRecording: meetingRecorder && meetingRecorder.state === 'recording',
            participantCount: peers.size + 1
        };
    }

    // ============ EXPORT ============

    window.DOZClockMeeting = {
        // Room management
        createRoom: createRoom,
        joinRoom: joinRoom,
        leaveRoom: leaveRoom,

        // Media controls
        startLocalMedia: startLocalMedia,
        getLocalStream: getLocalStream,
        toggleMute: toggleMute,
        toggleVideo: toggleVideo,
        startScreenShare: startScreenShare,
        stopScreenShare: stopScreenShare,

        // Recording
        startRecording: startRecording,
        stopRecording: stopRecording,

        // Status
        getStatus: getStatus,
        getPeers: () => peers,

        // Callbacks
        setOnParticipantJoined: (cb) => { onParticipantJoined = cb; },
        setOnParticipantLeft: (cb) => { onParticipantLeft = cb; },
        setOnStreamReceived: (cb) => { onStreamReceived = cb; },
        setOnScreenShareStarted: (cb) => { onScreenShareStarted = cb; },
        setOnScreenShareStopped: (cb) => { onScreenShareStopped = cb; },
        setOnConnectionStateChange: (cb) => { onConnectionStateChange = cb; },
        setOnError: (cb) => { onError = cb; },

        // Cleanup
        cleanup: cleanup
    };

    console.log('[DOZ Clock Meeting] Initialized');

})();
