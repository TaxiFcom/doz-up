/**
 * DOZ UP - Meeting Service
 * Server-side room management and WebRTC signaling
 */

const crypto = require('crypto');
const WebSocket = require('ws');

// ============ STATE ============
const rooms = new Map(); // roomId -> { code, name, host, participants, createdAt }
const participants = new Map(); // participantId -> { ws, roomId, name }

// ============ UTILITY FUNCTIONS ============

/**
 * Generate unique room ID
 */
function generateRoomId() {
    return 'room-' + crypto.randomBytes(8).toString('hex');
}

/**
 * Generate short room code for sharing
 */
function generateRoomCode() {
    return crypto.randomBytes(3).toString('hex').toUpperCase();
}

/**
 * Generate participant ID
 */
function generateParticipantId() {
    return 'user-' + crypto.randomBytes(6).toString('hex');
}

// ============ ROOM MANAGEMENT ============

/**
 * Create a new meeting room
 */
function createRoom(hostWs, hostName, roomName = 'DOZ Meeting') {
    const roomId = generateRoomId();
    const roomCode = generateRoomCode();
    const participantId = generateParticipantId();

    const room = {
        id: roomId,
        code: roomCode,
        name: roomName,
        hostId: participantId,
        participants: new Map(),
        createdAt: new Date(),
        maxParticipants: 50 // Unlimited for DOZ UP users
    };

    // Add host as first participant
    room.participants.set(participantId, {
        id: participantId,
        name: hostName,
        ws: hostWs,
        isHost: true,
        joinedAt: new Date()
    });

    rooms.set(roomId, room);
    participants.set(participantId, { ws: hostWs, roomId, name: hostName });

    console.log(`[Meetings] Room created: ${roomCode} (${roomId})`);

    return {
        roomId,
        roomCode,
        participantId,
        room
    };
}

/**
 * Join an existing room
 */
function joinRoom(roomCode, ws, name) {
    // Find room by code
    let targetRoom = null;
    for (const [id, room] of rooms) {
        if (room.code === roomCode) {
            targetRoom = room;
            break;
        }
    }

    if (!targetRoom) {
        return { success: false, error: 'Room not found' };
    }

    // Check capacity (unlimited for now)
    if (targetRoom.participants.size >= targetRoom.maxParticipants) {
        return { success: false, error: 'Room is full' };
    }

    const participantId = generateParticipantId();

    // Add participant to room
    targetRoom.participants.set(participantId, {
        id: participantId,
        name: name,
        ws: ws,
        isHost: false,
        joinedAt: new Date()
    });

    participants.set(participantId, { ws, roomId: targetRoom.id, name });

    console.log(`[Meetings] ${name} joined room: ${roomCode}`);

    // Notify existing participants
    broadcastToRoom(targetRoom.id, {
        type: 'participant-joined',
        participantId: participantId,
        name: name
    }, participantId);

    // Get list of existing participants
    const existingParticipants = [];
    targetRoom.participants.forEach((p, id) => {
        if (id !== participantId) {
            existingParticipants.push({
                id: id,
                name: p.name,
                isHost: p.isHost
            });
        }
    });

    return {
        success: true,
        roomId: targetRoom.id,
        participantId: participantId,
        participants: existingParticipants
    };
}

/**
 * Leave a room
 */
function leaveRoom(participantId) {
    const participant = participants.get(participantId);
    if (!participant) return;

    const room = rooms.get(participant.roomId);
    if (room) {
        room.participants.delete(participantId);

        // Notify others
        broadcastToRoom(room.id, {
            type: 'participant-left',
            participantId: participantId
        });

        // If room is empty, delete it
        if (room.participants.size === 0) {
            rooms.delete(room.id);
            console.log(`[Meetings] Room deleted: ${room.code}`);
        }
        // If host left, assign new host
        else if (room.hostId === participantId) {
            const newHost = room.participants.values().next().value;
            if (newHost) {
                room.hostId = newHost.id;
                newHost.isHost = true;
                sendToParticipant(newHost.id, { type: 'promoted-to-host' });
            }
        }
    }

    participants.delete(participantId);
    console.log(`[Meetings] Participant left: ${participantId}`);
}

// ============ SIGNALING ============

/**
 * Forward SDP offer to target participant
 */
function forwardOffer(fromId, targetId, sdp) {
    sendToParticipant(targetId, {
        type: 'offer',
        fromId: fromId,
        sdp: sdp
    });
}

/**
 * Forward SDP answer to target participant
 */
function forwardAnswer(fromId, targetId, sdp) {
    sendToParticipant(targetId, {
        type: 'answer',
        fromId: fromId,
        sdp: sdp
    });
}

/**
 * Forward ICE candidate to target participant
 */
function forwardIceCandidate(fromId, targetId, candidate) {
    sendToParticipant(targetId, {
        type: 'ice-candidate',
        fromId: fromId,
        candidate: candidate
    });
}

// ============ MESSAGING ============

/**
 * Send message to specific participant
 */
function sendToParticipant(participantId, message) {
    const participant = participants.get(participantId);
    if (participant && participant.ws && participant.ws.readyState === WebSocket.OPEN) {
        participant.ws.send(JSON.stringify(message));
    }
}

/**
 * Broadcast message to all participants in a room
 */
function broadcastToRoom(roomId, message, excludeId = null) {
    const room = rooms.get(roomId);
    if (!room) return;

    room.participants.forEach((participant, id) => {
        if (id !== excludeId && participant.ws && participant.ws.readyState === WebSocket.OPEN) {
            participant.ws.send(JSON.stringify(message));
        }
    });
}

// ============ WEBSOCKET HANDLER ============

/**
 * Handle incoming WebSocket message
 */
function handleMessage(ws, message) {
    try {
        const data = JSON.parse(message);

        switch (data.type) {
            case 'create-room': {
                const result = createRoom(ws, data.name, data.roomName);
                ws.send(JSON.stringify({
                    type: 'room-created',
                    roomId: result.roomId,
                    roomCode: result.roomCode,
                    participantId: result.participantId
                }));
                break;
            }

            case 'join-room': {
                const result = joinRoom(data.roomCode, ws, data.name);
                if (result.success) {
                    ws.send(JSON.stringify({
                        type: 'room-joined',
                        roomId: result.roomId,
                        participantId: result.participantId,
                        participants: result.participants
                    }));
                } else {
                    ws.send(JSON.stringify({
                        type: 'error',
                        error: result.error
                    }));
                }
                break;
            }

            case 'leave-room': {
                leaveRoom(data.participantId);
                break;
            }

            case 'offer': {
                forwardOffer(data.participantId || getParticipantIdByWs(ws), data.targetId, data.sdp);
                break;
            }

            case 'answer': {
                forwardAnswer(data.participantId || getParticipantIdByWs(ws), data.targetId, data.sdp);
                break;
            }

            case 'ice-candidate': {
                forwardIceCandidate(data.participantId || getParticipantIdByWs(ws), data.targetId, data.candidate);
                break;
            }

            case 'screen-share-started':
            case 'screen-share-stopped': {
                const participant = participants.get(data.participantId);
                if (participant) {
                    broadcastToRoom(participant.roomId, {
                        type: data.type,
                        participantId: data.participantId
                    }, data.participantId);
                }
                break;
            }

            default:
                console.log('[Meetings] Unknown message type:', data.type);
        }
    } catch (error) {
        console.error('[Meetings] Message handling error:', error);
        ws.send(JSON.stringify({ type: 'error', error: 'Invalid message format' }));
    }
}

/**
 * Get participant ID by WebSocket connection
 */
function getParticipantIdByWs(ws) {
    for (const [id, participant] of participants) {
        if (participant.ws === ws) {
            return id;
        }
    }
    return null;
}

/**
 * Handle WebSocket disconnect
 */
function handleDisconnect(ws) {
    const participantId = getParticipantIdByWs(ws);
    if (participantId) {
        leaveRoom(participantId);
    }
}

// ============ WEBSOCKET SERVER SETUP ============

/**
 * Initialize WebSocket server for meetings
 */
function initWebSocketServer(server) {
    const wss = new WebSocket.Server({ server, path: '/ws/meeting' });

    wss.on('connection', (ws) => {
        console.log('[Meetings] Client connected');

        ws.on('message', (message) => {
            handleMessage(ws, message.toString());
        });

        ws.on('close', () => {
            console.log('[Meetings] Client disconnected');
            handleDisconnect(ws);
        });

        ws.on('error', (error) => {
            console.error('[Meetings] WebSocket error:', error);
        });
    });

    console.log('[Meetings] WebSocket server initialized at /ws/meeting');

    return wss;
}

// ============ API FUNCTIONS ============

/**
 * Get room info (for REST API)
 */
function getRoomInfo(roomCode) {
    for (const [id, room] of rooms) {
        if (room.code === roomCode) {
            return {
                id: room.id,
                code: room.code,
                name: room.name,
                participantCount: room.participants.size,
                createdAt: room.createdAt
            };
        }
    }
    return null;
}

/**
 * Get all active rooms (for admin)
 */
function getAllRooms() {
    const result = [];
    rooms.forEach((room) => {
        result.push({
            id: room.id,
            code: room.code,
            name: room.name,
            participantCount: room.participants.size,
            createdAt: room.createdAt
        });
    });
    return result;
}

/**
 * Get statistics
 */
function getStats() {
    return {
        activeRooms: rooms.size,
        totalParticipants: participants.size
    };
}

// ============ EXPORT ============

module.exports = {
    initWebSocketServer,
    getRoomInfo,
    getAllRooms,
    getStats,
    createRoom,
    joinRoom,
    leaveRoom
};
