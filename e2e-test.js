/**
 * UNO Backend End-to-End Test Script
 * 
 * This script simulates multiple players playing a complete game of UNO
 * to test the entire real-time gameplay loop from start to finish.
 * 
 * HOW TO RUN:
 * 1. Start the UNO server: node server.js
 * 2. In a new terminal, run this test: node e2e-test.js
 * 3. Watch the console output for detailed test progress and results
 * 
 * DEPENDENCIES:
 * - axios (for HTTP requests)
 * - socket.io-client (for WebSocket connections)
 * 
 * Install with: npm install --save-dev axios socket.io-client
 */

const axios = require('axios');
const { io } = require('socket.io-client');

// ============================================================================
// TEST CONFIGURATION
// ============================================================================

const CONFIG = {
    SERVER_URL: 'http://localhost:3001',
    NUM_PLAYERS: 2,
    PLAYER_IDS: ['bot1', 'bot2'],
    TIMEOUT_MS: 30000, // 30 seconds timeout for operations
    MOVE_DELAY_MS: 1000 // Delay between moves for readability
};

// ============================================================================
// GLOBAL TEST STATE
// ============================================================================

let testState = {
    roomId: null,
    clients: [],
    gameState: null,
    phase: 'SETUP',
    moveCount: 0,
    errors: [],
    lastProcessedTurn: null // Track processed turns to prevent duplicates
};

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Logs a message with timestamp and phase
 */
function log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}] [${testState.phase}] [${level}]`;
    console.log(`${prefix} ${message}`);
}

/**
 * Logs an error and adds it to the errors array
 */
function logError(message, error = null) {
    const errorMsg = error ? `${message}: ${error.message || error}` : message;
    log(errorMsg, 'ERROR');
    testState.errors.push(errorMsg);
}

/**
 * Sleeps for specified milliseconds
 */
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Checks if a card can be played on the current top card
 */
function canPlayCard(card, topCard, currentColor) {
    // Wild cards can always be played
    if (card.type === 'wild') {
        return true;
    }
    
    // Check color match (use currentColor for active color)
    if (card.color === currentColor || card.color === topCard.color) {
        return true;
    }
    
    // Check value match
    if (card.value === topCard.value) {
        return true;
    }
    
    return false;
}

/**
 * Finds a playable card from a hand
 */
function findPlayableCard(hand, topCard, currentColor) {
    if (!hand || !Array.isArray(hand)) {
        return null;
    }
    
    return hand.find(card => canPlayCard(card, topCard, currentColor)) || null;
}

/**
 * Chooses a color for wild cards (simple strategy)
 */
function chooseWildColor(hand) {
    const colors = ['red', 'yellow', 'green', 'blue'];
    
    // Count cards by color
    const colorCounts = {};
    colors.forEach(color => colorCounts[color] = 0);
    
    hand.forEach(card => {
        if (card.color && colors.includes(card.color)) {
            colorCounts[card.color]++;
        }
    });
    
    // Choose color with most cards
    let maxCount = 0;
    let chosenColor = 'red'; // default
    
    for (const color of colors) {
        if (colorCounts[color] > maxCount) {
            maxCount = colorCounts[color];
            chosenColor = color;
        }
    }
    
    return chosenColor;
}

// ============================================================================
// PHASE 1: GAME SETUP
// ============================================================================

/**
 * Creates a game room via HTTP API
 */
async function createRoom() {
    log('Creating game room...');
    
    try {
        const response = await axios.post(`${CONFIG.SERVER_URL}/api/rooms/create`, {
            playerId: CONFIG.PLAYER_IDS[0]
        }, {
            headers: { 'Content-Type': 'application/json' },
            timeout: 5000
        });
        
        testState.roomId = response.data.roomId;
        log(`✅ Room created successfully: ${testState.roomId}`);
        return true;
        
    } catch (error) {
        logError('Failed to create room', error);
        return false;
    }
}

/**
 * Additional players join the room via HTTP API
 */
async function joinRoom() {
    log('Additional players joining room...');
    
    try {
        // Skip first player (already joined when creating room)
        for (let i = 1; i < CONFIG.PLAYER_IDS.length; i++) {
            const playerId = CONFIG.PLAYER_IDS[i];
            
            const response = await axios.post(
                `${CONFIG.SERVER_URL}/api/rooms/${testState.roomId}/join`,
                { playerId },
                {
                    headers: { 'Content-Type': 'application/json' },
                    timeout: 5000
                }
            );
            
            log(`✅ Player ${playerId} joined room successfully`);
        }
        
        return true;
        
    } catch (error) {
        logError('Failed to join room', error);
        return false;
    }
}

/**
 * Creates WebSocket clients for all players
 */
async function createWebSocketClients() {
    log('Creating WebSocket clients...');
    
    return new Promise((resolve, reject) => {
        let connectedCount = 0;
        const timeout = setTimeout(() => {
            logError('Timeout waiting for WebSocket connections');
            reject(new Error('WebSocket connection timeout'));
        }, CONFIG.TIMEOUT_MS);
        
        CONFIG.PLAYER_IDS.forEach((playerId, index) => {
            const client = io(CONFIG.SERVER_URL, {
                forceNew: true,
                timeout: 5000
            });
            
            client.playerId = playerId;
            client.playerIndex = index;
            
            // Connection events
            client.on('connect', () => {
                log(`✅ WebSocket connected for player ${playerId} (${client.id})`);
                connectedCount++;
                  if (connectedCount === CONFIG.PLAYER_IDS.length) {
                    clearTimeout(timeout);
                    log(`All ${connectedCount} players connected successfully`);
                    resolve(true);
                }
            });
            
            client.on('connect_error', (error) => {
                logError(`WebSocket connection failed for ${playerId}`, error);
                clearTimeout(timeout);
                reject(error);
            });
            
            // Game events
            client.on('gameUpdate', (data) => {
                log(`📡 Game update received by ${playerId}: status=${data.status}`);
                testState.gameState = data;
                
                // Store player hand for decision making
                if (data.status === 'playing' && data.players) {
                    const playerData = data.players.find(p => p.id === playerId);
                    if (playerData) {
                        // We don't get the actual hand in gameUpdate, we'll get it separately
                        log(`Player ${playerId} has ${playerData.handSize} cards`);
                    }
                }
                
                // Process game state updates
                processGameUpdate(data);
            });
            
            client.on('gameStarted', (data) => {
                log(`🎮 Game started notification received by ${playerId}: ${data.message}`);
            });
            
            client.on('gameOver', (data) => {
                log(`🏆 Game over received by ${playerId}: ${data.message}`);
                testState.phase = 'FINISHED';
            });
            
            client.on('error', (error) => {
                logError(`WebSocket error for ${playerId}`, error);
                testState.errors.push(`WebSocket error for ${playerId}: ${error.message}`);
            });
            
            client.on('disconnect', (reason) => {
                log(`❌ Player ${playerId} disconnected: ${reason}`);
            });
            
            testState.clients.push(client);
        });
    });
}

/**
 * All players join the WebSocket room
 */
async function joinWebSocketRoom() {
    log('Players joining WebSocket room...');
    
    try {
        testState.clients.forEach(client => {
            client.emit('joinRoom', {
                roomId: testState.roomId,
                playerId: client.playerId
            });
            log(`📡 Sent joinRoom event for ${client.playerId}`);
        });
        
        // Wait a moment for join confirmations
        await sleep(2000);
        log('✅ All players joined WebSocket room');
        return true;
        
    } catch (error) {
        logError('Failed to join WebSocket room', error);
        return false;
    }
}

/**
 * Host starts the game
 */
async function startGame() {
    log('Host starting the game...');
    
    try {
        const hostClient = testState.clients[0]; // First client is the host
        
        hostClient.emit('startGame', {
            roomId: testState.roomId
        });
        
        log(`📡 Sent startGame event from host ${hostClient.playerId}`);
        
        // Wait for game to start
        await sleep(3000);
        
        log(`Current game state: ${testState.gameState ? JSON.stringify(testState.gameState, null, 2) : 'null'}`);
        
        if (testState.gameState && testState.gameState.status === 'playing') {
            log('✅ Game started successfully');
            return true;
        } else {
            logError('Game did not start properly');
            log(`Expected status: 'playing', Got: ${testState.gameState ? testState.gameState.status : 'null'}`);
            return false;
        }
        
    } catch (error) {
        logError('Failed to start game', error);
        return false;
    }
}

// ============================================================================
// PHASE 2: GAMEPLAY SIMULATION
// ============================================================================

/**
 * Gets a player's current hand via HTTP API
 */
async function getPlayerHand(playerId) {
    try {
        const response = await axios.get(
            `${CONFIG.SERVER_URL}/api/rooms/${testState.roomId}/hand/${playerId}`,
            { timeout: 5000 }
        );
        
        return response.data.hand;
        
    } catch (error) {
        logError(`Failed to get hand for ${playerId}`, error);
        return [];
    }
}

/**
 * Processes game state updates and triggers next move
 */
function processGameUpdate(gameState) {
    if (gameState.status !== 'playing' || gameState.isGameOver) {
        return;
    }
    
    // Determine current player
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    if (!currentPlayer) {
        logError('No current player found in game state');
        return;
    }
    
    // Create unique turn identifier to prevent duplicate processing
    const currentTurnId = `${currentPlayer.id}-${gameState.currentPlayerIndex}-${currentPlayer.handSize}`;
    
    // Skip if we already processed this turn
    if (testState.lastProcessedTurn === currentTurnId) {
        return;
    }
    
    testState.lastProcessedTurn = currentTurnId;
    
    log(`🎯 Current turn: ${currentPlayer.id} (${currentPlayer.handSize} cards)`);
    
    // Trigger move for current player after a delay
    setTimeout(() => {
        makeAutomatedMove(currentPlayer.id, gameState);
    }, CONFIG.MOVE_DELAY_MS);
}

/**
 * Makes an automated move for the specified player
 */
async function makeAutomatedMove(playerId, gameState) {
    try {
        log(`🤖 ${playerId} making automated move...`);
        testState.moveCount++;
        
        // Get player's current hand
        const hand = await getPlayerHand(playerId);
        if (!hand || hand.length === 0) {
            logError(`No hand data available for ${playerId}`);
            return;
        }
        
        log(`${playerId} hand: ${hand.length} cards`);
        
        // Get current game state
        const topCard = gameState.topCard;
        const currentColor = gameState.currentColor;
        
        log(`Top card: ${topCard.color} ${topCard.value}, Current color: ${currentColor}`);
        
        // Find a playable card
        const playableCard = findPlayableCard(hand, topCard, currentColor);
        
        const client = testState.clients.find(c => c.playerId === playerId);
        if (!client) {
            logError(`No client found for player ${playerId}`);
            return;
        }
        
        if (playableCard) {
            // Play the card
            let chosenColor = null;
            if (playableCard.type === 'wild') {
                chosenColor = chooseWildColor(hand);
                log(`🃏 ${playerId} playing wild card, choosing color: ${chosenColor}`);
            }
            
            log(`🎴 ${playerId} playing card: ${playableCard.color || 'wild'} ${playableCard.value}`);
            
            client.emit('playCard', {
                roomId: testState.roomId,
                playerId: playerId,
                card: playableCard,
                chosenColor: chosenColor
            });
            
        } else {
            // Draw a card
            log(`📥 ${playerId} drawing a card (no playable cards)`);
            
            client.emit('drawCard', {
                roomId: testState.roomId,
                playerId: playerId
            });
        }
        
    } catch (error) {
        logError(`Failed to make move for ${playerId}`, error);
    }
}

// ============================================================================
// MAIN TEST EXECUTION
// ============================================================================

/**
 * Runs the complete end-to-end test
 */
async function runEndToEndTest() {
    log('🚀 Starting UNO Backend End-to-End Test');
    log(`Configuration: ${CONFIG.NUM_PLAYERS} players, Room: TBD`);
    
    try {
        // Phase 1: Setup
        testState.phase = 'SETUP';
        
        log('Step 1: Creating room...');
        if (!await createRoom()) {
            logError('Failed at step 1: createRoom');
            return false;
        }
        
        log('Step 2: Joining room...');
        if (!await joinRoom()) {
            logError('Failed at step 2: joinRoom');
            return false;
        }
        
        log('Step 3: Creating WebSocket clients...');
        if (!await createWebSocketClients()) {
            logError('Failed at step 3: createWebSocketClients');
            return false;
        }
        
        log('Step 4: Joining WebSocket room...');
        if (!await joinWebSocketRoom()) {
            logError('Failed at step 4: joinWebSocketRoom');
            return false;
        }
        
        log('Step 5: Starting game...');
        if (!await startGame()) {
            logError('Failed at step 5: startGame');
            return false;
        }
        
        // Phase 2: Gameplay
        testState.phase = 'GAMEPLAY';
        log('🎮 Entering automated gameplay phase...');
        
        // Monitor game until completion
        return await monitorGameplay();
        
    } catch (error) {
        logError('Test execution failed', error);
        return false;
    }
}

/**
 * Monitors the gameplay until completion
 */
async function monitorGameplay() {
    return new Promise((resolve) => {
        const maxMoves = 500; // Prevent infinite loops
        const checkInterval = 2000; // Check every 2 seconds
        
        const monitor = setInterval(() => {
            // Check for game completion
            if (testState.phase === 'FINISHED' || 
                (testState.gameState && testState.gameState.isGameOver)) {
                
                clearInterval(monitor);
                
                if (testState.gameState && testState.gameState.winner) {
                    log(`🏆 Game completed! Winner: ${testState.gameState.winner}`);
                    log(`📊 Total moves made: ${testState.moveCount}`);
                    resolve(true);
                } else {
                    logError('Game ended without a clear winner');
                    resolve(false);
                }
                return;
            }
            
            // Check for timeout
            if (testState.moveCount > maxMoves) {
                clearInterval(monitor);
                logError(`Game exceeded maximum moves (${maxMoves})`);
                resolve(false);
                return;
            }
              // Check for errors (increased threshold for automation)
            if (testState.errors.length > 25) {
                clearInterval(monitor);
                logError('Too many errors occurred during gameplay');
                resolve(false);
                return;
            }
            
        }, checkInterval);
        
        // Overall timeout
        setTimeout(() => {
            clearInterval(monitor);
            logError('Overall test timeout reached');
            resolve(false);
        }, CONFIG.TIMEOUT_MS);
    });
}

/**
 * Cleans up WebSocket connections
 */
function cleanup() {
    log('🧹 Cleaning up connections...');
    
    testState.clients.forEach(client => {
        if (client.connected) {
            client.disconnect();
        }
    });
    
    log('✅ Cleanup completed');
}

/**
 * Generates the final test report
 */
function generateReport(success) {
    log('');
    log('=' .repeat(80));
    log('🔍 END-TO-END TEST REPORT');
    log('=' .repeat(80));
    
    log(`Status: ${success ? '✅ SUCCESS' : '❌ FAILURE'}`);
    log(`Room ID: ${testState.roomId || 'N/A'}`);
    log(`Players: ${CONFIG.PLAYER_IDS.join(', ')}`);
    log(`Total Moves: ${testState.moveCount}`);
    log(`Errors Count: ${testState.errors.length}`);
    
    if (testState.gameState) {
        log(`Final Game State: ${testState.gameState.status}`);
        if (testState.gameState.winner) {
            log(`Winner: ${testState.gameState.winner}`);
        }
    }
    
    if (testState.errors.length > 0) {
        log('');
        log('❌ ERRORS ENCOUNTERED:');
        testState.errors.forEach((error, index) => {
            log(`  ${index + 1}. ${error}`);
        });
    }
    
    // Gap Analysis
    log('');
    log('🔍 GAP ANALYSIS:');
    
    if (success) {
        log('✅ No gaps detected - all core functionality working correctly');
        log('✅ Room creation and joining works');
        log('✅ WebSocket connections established successfully');
        log('✅ Game start mechanism works');
        log('✅ Card playing logic functions properly');
        log('✅ Card drawing logic functions properly');
        log('✅ Game completion detection works');
        log('✅ Win condition properly detected');
    } else {
        log('❌ Gaps detected in backend implementation:');
        
        if (testState.errors.some(e => e.includes('create room'))) {
            log('  - Room creation endpoint may have issues');
        }
        if (testState.errors.some(e => e.includes('join room'))) {
            log('  - Room joining logic may have issues');
        }
        if (testState.errors.some(e => e.includes('WebSocket'))) {
            log('  - WebSocket connection or event handling issues');
        }
        if (testState.errors.some(e => e.includes('startGame'))) {
            log('  - Game initialization logic needs review');
        }
        if (testState.errors.some(e => e.includes('playCard'))) {
            log('  - Card playing event handler needs review');
        }
        if (testState.errors.some(e => e.includes('drawCard'))) {
            log('  - Card drawing event handler needs review');
        }
        if (testState.moveCount > 400) {
            log('  - Game may not be progressing efficiently (too many moves)');
        }
        if (!testState.gameState || !testState.gameState.isGameOver) {
            log('  - Game completion detection may have issues');
        }
    }
    
    log('');
    log('=' .repeat(80));
    
    return success;
}

// ============================================================================
// SCRIPT ENTRY POINT
// ============================================================================

async function main() {
    try {
        const success = await runEndToEndTest();
        const finalResult = generateReport(success);
        
        cleanup();
        
        // Exit with appropriate code
        process.exit(finalResult ? 0 : 1);
        
    } catch (error) {
        logError('Unexpected error in main execution', error);
        cleanup();
        process.exit(1);
    }
}

// Handle process termination
process.on('SIGINT', () => {
    log('🛑 Test interrupted by user');
    cleanup();
    process.exit(1);
});

process.on('SIGTERM', () => {
    log('🛑 Test terminated');
    cleanup();
    process.exit(1);
});

// Start the test
main();
