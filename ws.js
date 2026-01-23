/**
 * WebSocket and Presence Management Module (Lanyard API)
 * Fully compliant with Lanyard API documentation
 * @see https://lanyard.eggsy.xyz/api/working-with-websockets
 */

// ==================== CONFIGURATION ====================

export const WS_CONFIG = {
    WS_URL: 'wss://api.lanyard.rest/socket',
    WS_URL_COMPRESSED: 'wss://api.lanyard.rest/socket?compression=zlib_json',
    INITIAL_DELAY: 1000,
    MAX_DELAY: 30000,
    BACKOFF_MULTIPLIER: 1.5,
    MAX_RECONNECTS: 20,
    JITTER_MAX: 500,
    MIN_HEARTBEAT: 10000,
    MAX_HEARTBEAT: 60000,
    DEFAULT_HEARTBEAT: 30000,
    MAX_MESSAGE_SIZE: 100000,
    MAX_NESTING_DEPTH: 5
};

// Lanyard WebSocket Opcodes
const OPCODES = {
    EVENT: 0,           // Receive events
    HELLO: 1,           // Receive heartbeat interval
    INITIALIZE: 2,      // Send subscription
    HEARTBEAT: 3        // Send heartbeat
};

// Lanyard Event Types
const EVENTS = {
    INIT_STATE: 'INIT_STATE',
    PRESENCE_UPDATE: 'PRESENCE_UPDATE'
};

// Lanyard Error Codes
const ERROR_CODES = {
    INVALID_OPCODE: 4004,
    REQUIRES_DATA: 4005,
    INVALID_PAYLOAD: 4006
};

// ==================== STATE MANAGEMENT ====================

let lanyardWS = null;
let heartbeatInterval = null;
let reconnectTimeout = null;
let spotifyRafId = null;

// Reconnection state
let reconnectDelay = WS_CONFIG.INITIAL_DELAY;
let reconnectAttempts = 0;
let isConnecting = false;
let isReconnecting = false;

// Data state
let lastSpotifyData = null;
let currentDiscordId = null;

// Saved parameters for reconnection
let savedConfig = {
    discordId: null,
    presenceCallback: null,
    spotifyCallback: null,
    useCompression: false,
    subscribeToAll: false
};

// Callbacks for UI updates
let presenceUpdateCallback = null;
let spotifyUpdateCallback = null;

// ==================== ERROR HANDLING ====================

/**
 * Standardized error handler with severity levels
 * @param {string} context - Error context
 * @param {Error|string} error - Error object or message
 * @param {string} severity - 'info' | 'warn' | 'error'
 */
function handleError(context, error, severity = 'warn') {
    const message = `[Lanyard:${context}] ${error instanceof Error ? error.message : String(error)}`;

    switch (severity) {
        case 'error':
            console.error(message, error instanceof Error ? error : '');
            break;
        case 'info':
            console.info(message);
            break;
        default:
            console.warn(message);
    }
}

// ==================== SPOTIFY MANAGEMENT ====================

/**
 * Updates Spotify progress bar in real-time using requestAnimationFrame
 */
function updateSpotifyProgress() {
    if (!lastSpotifyData?.timestamps) {
        if (spotifyRafId) {
            cancelAnimationFrame(spotifyRafId);
            spotifyRafId = null;
        }
        return;
    }

    const now = Date.now();
    const { start, end } = lastSpotifyData.timestamps;
    const duration = end - start;
    const elapsed = now - start;
    const progress = Math.min(Math.max(elapsed / duration, 0), 1);

    if (spotifyUpdateCallback) {
        spotifyUpdateCallback({
            ...lastSpotifyData,
            progress,
            elapsed,
            duration
        });
    }

    // Continue animation if song is still playing
    if (progress < 1) {
        spotifyRafId = requestAnimationFrame(updateSpotifyProgress);
    } else {
        spotifyRafId = null;
        lastSpotifyData = null;
    }
}

/**
 * Handles Spotify activity data from presence
 * @param {Array} activities - Array of Discord activities
 */
function handleSpotifyActivity(activities) {
    if (!Array.isArray(activities)) {
        handleError('Spotify', 'Invalid activities format', 'warn');
        return;
    }

    const spotify = activities.find(a => a?.id === 'spotify:1');

    if (spotify?.timestamps) {
        const isNewSong = !lastSpotifyData ||
            lastSpotifyData.timestamps.start !== spotify.timestamps.start;

        lastSpotifyData = spotify;

        if (isNewSong) {
            if (spotifyRafId) {
                cancelAnimationFrame(spotifyRafId);
            }
            updateSpotifyProgress();
        }
    } else {
        // Stop Spotify updates
        if (spotifyRafId) {
            cancelAnimationFrame(spotifyRafId);
            spotifyRafId = null;
        }
        lastSpotifyData = null;

        if (spotifyUpdateCallback) {
            spotifyUpdateCallback(null);
        }
    }
}

// ==================== MESSAGE VALIDATION ====================

/**
 * Validates incoming WebSocket message
 * @param {MessageEvent} event - WebSocket message event
 * @returns {Object|null} Parsed and validated data or null
 */
function validateMessage(event) {
    // Check message size
    if (typeof event.data === 'string' && event.data.length > WS_CONFIG.MAX_MESSAGE_SIZE) {
        handleError('Validation', 'Message size exceeded limit', 'error');
        lanyardWS?.close();
        return null;
    }

    // Parse JSON
    let data;
    try {
        data = JSON.parse(event.data);
    } catch (e) {
        handleError('Validation', 'Invalid JSON received', 'warn');
        return null;
    }

    // Basic structure validation
    if (!data || typeof data !== 'object') {
        handleError('Validation', 'Invalid message structure', 'warn');
        return null;
    }

    // Check nesting depth
    if (data.d && getObjectDepth(data.d) >= WS_CONFIG.MAX_NESTING_DEPTH) {
        handleError('Validation', 'Object nesting too deep', 'warn');
        return null;
    }

    return data;
}

/**
 * Calculates object nesting depth
 * @param {*} obj - Object to check
 * @param {number} depth - Current depth
 * @param {number} maxDepth - Maximum depth to check
 * @returns {number} Nesting depth
 */
function getObjectDepth(obj, depth = 0, maxDepth = WS_CONFIG.MAX_NESTING_DEPTH) {
    if (depth >= maxDepth || typeof obj !== 'object' || obj === null) {
        return depth;
    }

    let maxChildDepth = depth;
    for (const value of Object.values(obj)) {
        const childDepth = getObjectDepth(value, depth + 1, maxDepth);
        if (childDepth > maxChildDepth) {
            maxChildDepth = childDepth;
        }
        if (maxChildDepth >= maxDepth) break;
    }

    return maxChildDepth;
}

// ==================== PRESENCE HANDLING ====================

/**
 * Extracts presence data based on subscription type
 * @param {Object} data - Raw data from Lanyard
 * @param {string} eventType - Event type (INIT_STATE or PRESENCE_UPDATE)
 * @returns {Object|null} Extracted presence data
 */
function extractPresenceData(data, eventType) {
    if (!data) return null;

    // For PRESENCE_UPDATE, data is always the presence object
    if (eventType === EVENTS.PRESENCE_UPDATE) {
        return data;
    }

    // For INIT_STATE with subscribe_to_all or subscribe_to_ids (multiple)
    // data is a map: { "user_id": { ...presence } }
    if (eventType === EVENTS.INIT_STATE) {
        // If we have a specific Discord ID, extract it
        if (currentDiscordId && data[currentDiscordId]) {
            return data[currentDiscordId];
        }

        // If subscribe_to_id (single user), data is the presence object directly
        // Check if data has typical presence fields
        if (data.discord_user || data.activities || data.discord_status) {
            return data;
        }

        // Otherwise, return the entire map (for subscribe_to_all)
        return data;
    }

    return data;
}

// ==================== WEBSOCKET LIFECYCLE ====================

/**
 * Cleanup all WebSocket resources
 */
function cleanupWebSocket() {
    // Clear heartbeat
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
        heartbeatInterval = null;
    }

    // Clear Spotify animation
    if (spotifyRafId) {
        cancelAnimationFrame(spotifyRafId);
        spotifyRafId = null;
    }

    // Close WebSocket
    if (lanyardWS) {
        // Remove event listeners to prevent duplicate handlers
        lanyardWS.onopen = null;
        lanyardWS.onmessage = null;
        lanyardWS.onerror = null;
        lanyardWS.onclose = null;

        // Close connection if open
        if (lanyardWS.readyState === WebSocket.OPEN ||
            lanyardWS.readyState === WebSocket.CONNECTING) {
            lanyardWS.close(1000, 'Clean disconnect');
        }

        lanyardWS = null;
    }

    lastSpotifyData = null;
}

/**
 * Handles WebSocket HELLO opcode (Op 1)
 * @param {Object} data - Hello message data
 */
function handleHello(data) {
    if (heartbeatInterval) {
        clearInterval(heartbeatInterval);
    }

    // Extract and validate heartbeat interval
    let interval = WS_CONFIG.DEFAULT_HEARTBEAT;

    if (data?.heartbeat_interval) {
        const providedInterval = data.heartbeat_interval;

        if (typeof providedInterval === 'number' &&
            !Number.isNaN(providedInterval) &&
            providedInterval > 0) {
            interval = Math.min(
                Math.max(providedInterval, WS_CONFIG.MIN_HEARTBEAT),
                WS_CONFIG.MAX_HEARTBEAT
            );
        }
    }

    // Start heartbeat
    heartbeatInterval = setInterval(() => {
        if (lanyardWS?.readyState === WebSocket.OPEN) {
            try {
                lanyardWS.send(JSON.stringify({ op: OPCODES.HEARTBEAT }));
            } catch (error) {
                handleError('Heartbeat', `Failed to send: ${error}`, 'warn');
            }
        }
    }, interval);
}

/**
 * Handles WebSocket EVENT opcode (Op 0)
 * @param {string} eventType - Event type
 * @param {Object} data - Event data
 */
function handleEvent(eventType, data) {
    if (!eventType || !data) return;

    const presenceData = extractPresenceData(data, eventType);

    // Handle Spotify activity
    if (presenceData?.activities) {
        handleSpotifyActivity(presenceData.activities);
    }

    // Call presence callback
    if (presenceUpdateCallback) {
        try {
            presenceUpdateCallback(presenceData);
        } catch (error) {
            handleError('Callback', `Presence callback error: ${error}`, 'error');
        }
    }
}

/**
 * Handles incoming WebSocket messages
 * @param {MessageEvent} event - WebSocket message event
 */
function handleMessage(event) {
    // Validate origin (only once, not per message)
    if (!event.origin && lanyardWS?.url && !lanyardWS.url.startsWith('wss://api.lanyard.rest')) {
        handleError('Security', 'Invalid WebSocket origin', 'error');
        lanyardWS?.close();
        return;
    }

    const data = validateMessage(event);
    if (!data) return;

    const { op, t, d } = data;

    // Handle opcodes
    switch (op) {
        case OPCODES.HELLO:
            handleHello(d);
            break;

        case OPCODES.EVENT:
            if (t === EVENTS.INIT_STATE || t === EVENTS.PRESENCE_UPDATE) {
                handleEvent(t, d);
            }
            break;

        default:
            handleError('Protocol', `Unknown opcode: ${op}`, 'warn');
    }
}

/**
 * Schedules reconnection attempt with exponential backoff
 */
function scheduleReconnect() {
    // Prevent multiple reconnect timers
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }

    // Stop reconnection if hidden or max attempts reached
    if (document.hidden || reconnectAttempts >= WS_CONFIG.MAX_RECONNECTS) {
        handleError(
            'Reconnect',
            `Stopped (hidden: ${document.hidden}, attempts: ${reconnectAttempts})`,
            'info'
        );
        isReconnecting = false;
        return;
    }

    isReconnecting = true;
    reconnectAttempts++;

    // Calculate delay with exponential backoff and jitter
    reconnectDelay = Math.min(
        reconnectDelay * WS_CONFIG.BACKOFF_MULTIPLIER,
        WS_CONFIG.MAX_DELAY
    );
    const jitter = Math.random() * WS_CONFIG.JITTER_MAX;
    const totalDelay = reconnectDelay + jitter;

    reconnectTimeout = setTimeout(() => {
        reconnectTimeout = null;
        isReconnecting = false;

        // Reconnect with saved configuration
        if (savedConfig.discordId) {
            connectLanyard(
                savedConfig.discordId,
                savedConfig.presenceCallback,
                savedConfig.spotifyCallback,
                savedConfig.useCompression,
                savedConfig.subscribeToAll
            );
        }
    }, totalDelay);
}

/**
 * Handles WebSocket close event
 * @param {CloseEvent} event - Close event
 */
function handleClose(event) {
    isConnecting = false;
    cleanupWebSocket();

    // Handle Lanyard-specific error codes
    if (event.code === ERROR_CODES.INVALID_OPCODE) {
        handleError('Protocol', 'Invalid opcode sent - check your implementation', 'error');
        return; // Don't reconnect on protocol errors
    }

    if (event.code === ERROR_CODES.REQUIRES_DATA) {
        handleError('Protocol', 'Data object required in message', 'error');
        return;
    }

    if (event.code === ERROR_CODES.INVALID_PAYLOAD) {
        handleError('Protocol', 'Invalid payload format', 'error');
        return;
    }

    // Don't reconnect on any 4xxx error (client errors)
    if (event.code >= 4000 && event.code < 5000) {
        handleError('Protocol', `Client error ${event.code}, stopping reconnection`, 'error');
        return;
    }

    // Schedule reconnection for other errors
    if (!isReconnecting && !document.hidden) {
        scheduleReconnect();
    }
}

// ==================== PUBLIC API ====================

/**
 * Connects to Lanyard WebSocket API
 * 
 * @param {string} discordId - Discord User ID to monitor (required for subscribe_to_id)
 * @param {Function} onPresenceUpdate - Callback when presence data changes
 * @param {Function} [onSpotifyUpdate=null] - Callback when Spotify data changes
 * @param {boolean} [useCompression=false] - Use zlib_json compression
 * @param {boolean} [subscribeToAll=false] - Subscribe to all monitored users
 * 
 * @example
 * // Subscribe to single user
 * connectLanyard('162969778699501569', (data) => console.log(data));
 * 
 * @example
 * // Subscribe to all users
 * connectLanyard(null, (data) => console.log(data), null, false, true);
 */
export function connectLanyard(
    discordId,
    onPresenceUpdate,
    onSpotifyUpdate = null,
    useCompression = false,
    subscribeToAll = false
) {
    // Prevent multiple simultaneous connection attempts
    if (isConnecting) {
        handleError('Connect', 'Connection attempt already in progress', 'warn');
        return;
    }

    // Validate Discord ID (required unless subscribeToAll is true)
    if (!subscribeToAll) {
        if (!discordId || typeof discordId !== 'string' || !/^\d{17,19}$/.test(discordId)) {
            handleError('Connect', 'Invalid Discord ID format', 'error');
            return;
        }
    }

    // Save configuration for reconnection
    savedConfig = {
        discordId,
        presenceCallback: onPresenceUpdate,
        spotifyCallback: onSpotifyUpdate,
        useCompression,
        subscribeToAll
    };

    // Set callbacks
    presenceUpdateCallback = onPresenceUpdate;
    spotifyUpdateCallback = onSpotifyUpdate;
    currentDiscordId = discordId;

    // Check if already connected
    if (lanyardWS?.readyState === WebSocket.OPEN) {
        handleError('Connect', 'Already connected', 'info');
        return;
    }

    // Cleanup any existing connection
    cleanupWebSocket();

    isConnecting = true;

    // Select WebSocket URL
    const wsUrl = useCompression ? WS_CONFIG.WS_URL_COMPRESSED : WS_CONFIG.WS_URL;

    try {
        lanyardWS = new WebSocket(wsUrl);
    } catch (error) {
        handleError('Connect', `Failed to create WebSocket: ${error}`, 'error');
        isConnecting = false;
        scheduleReconnect();
        return;
    }

    // WebSocket opened
    lanyardWS.onopen = () => {
        isConnecting = false;

        // Reset reconnection state
        reconnectDelay = WS_CONFIG.INITIAL_DELAY;
        reconnectAttempts = 0;

        if (reconnectTimeout) {
            clearTimeout(reconnectTimeout);
            reconnectTimeout = null;
        }

        // Send INITIALIZE (Op 2) message
        const initMessage = { op: OPCODES.INITIALIZE, d: {} };

        if (subscribeToAll) {
            // Subscribe to all monitored users
            initMessage.d.subscribe_to_all = true;
        } else if (Array.isArray(discordId)) {
            // Subscribe to multiple users (as array)
            initMessage.d.subscribe_to_ids = discordId;
        } else {
            // Subscribe to single user (as string)
            initMessage.d.subscribe_to_id = discordId;
        }

        try {
            lanyardWS.send(JSON.stringify(initMessage));
        } catch (error) {
            handleError('Connect', `Failed to send initialization: ${error}`, 'error');
            lanyardWS.close();
        }
    };

    // WebSocket message received
    lanyardWS.onmessage = handleMessage;

    // WebSocket error
    lanyardWS.onerror = (error) => {
        handleError('Connection', `WebSocket error: ${error.message || 'Unknown'}`, 'warn');
    };

    // WebSocket closed
    lanyardWS.onclose = handleClose;
}

/**
 * Disconnects from Lanyard WebSocket
 */
export function disconnectLanyard() {
    // Clear reconnection state
    if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
        reconnectTimeout = null;
    }

    isReconnecting = false;
    isConnecting = false;
    reconnectAttempts = 0;
    reconnectDelay = WS_CONFIG.INITIAL_DELAY;

    // Clear saved configuration
    savedConfig = {
        discordId: null,
        presenceCallback: null,
        spotifyCallback: null,
        useCompression: false,
        subscribeToAll: false
    };

    currentDiscordId = null;
    presenceUpdateCallback = null;
    spotifyUpdateCallback = null;

    cleanupWebSocket();
}

/**
 * Gets current Spotify activity data
 * @returns {Object|null} Current Spotify data or null
 */
export function getCurrentSpotifyData() {
    return lastSpotifyData;
}

/**
 * Gets WebSocket connection status
 * @returns {string} 'connected' | 'connecting' | 'disconnected' | 'reconnecting'
 */
export function getConnectionStatus() {
    if (lanyardWS) {
        switch (lanyardWS.readyState) {
            case WebSocket.CONNECTING:
                return 'connecting';
            case WebSocket.OPEN:
                return 'connected';
            case WebSocket.CLOSING:
                return 'disconnected';
            case WebSocket.CLOSED:
                return isReconnecting ? 'reconnecting' : 'disconnected';
        }
    }
    return isReconnecting ? 'reconnecting' : 'disconnected';
}

/**
 * Gets current reconnection attempt count
 * @returns {number} Current attempt number
 */
export function getReconnectAttempts() {
    return reconnectAttempts;
}

/**
 * Manually triggers a reconnection attempt
 * @returns {boolean} True if reconnection was scheduled
 */
export function forceReconnect() {
    if (isConnecting || isReconnecting) {
        handleError('Reconnect', 'Already connecting/reconnecting', 'warn');
        return false;
    }

    if (!savedConfig.discordId && !savedConfig.subscribeToAll) {
        handleError('Reconnect', 'No saved configuration to reconnect', 'error');
        return false;
    }

    cleanupWebSocket();
    reconnectAttempts = 0;
    reconnectDelay = WS_CONFIG.INITIAL_DELAY;

    connectLanyard(
        savedConfig.discordId,
        savedConfig.presenceCallback,
        savedConfig.spotifyCallback,
        savedConfig.useCompression,
        savedConfig.subscribeToAll
    );

    return true;
}

// ==================== PAGE VISIBILITY HANDLING ====================

/**
 * Handle page visibility changes for auto-reconnection
 */
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && savedConfig.discordId && !lanyardWS) {
        forceReconnect();
    }
});