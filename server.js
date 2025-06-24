/**
 * UNO Online - Backend Server
 * 
 * A real-time multiplayer UNO card game backend built with Node.js, Express, and Socket.io.
 * Provides both REST API endpoints for room management and WebSocket connections for 
 * real-time gameplay.
 * 
 * Key Features:
 * - Room creation and player management
 * - Real-time card game with full UNO rules
 * - Player disconnect handling with game continuation
 * - Complete game state synchronization
 */

// Import required libraries
const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');

// Import the Game Engine - handles all UNO game logic
const GameEngine = require('./game-logic/GameEngine');

// Create Express app and HTTP server for Socket.io integration
const app = express();
const httpServer = createServer(app);

// Create Socket.IO server with CORS configuration for cross-origin requests
const io = new Server(httpServer, {
    cors: {
        origin: "*", // In production, specify exact origins for security
        methods: ["GET", "POST"]
    }
});

/**
 * In-memory storage for active games
 * Structure: {
 *   roomId: {
 *     roomId: string,
 *     host: string (playerId),
 *     players: Array<{id: string, hand: Array<Card>}>,
 *     status: 'waiting' | 'playing' | 'finished',
 *     gameState: GameState | null,
 *     createdAt: Date
 *   }
 * }
 */
let activeGames = {};

// Server configuration
const PORT = 3001;

// Middleware to parse JSON requests from HTTP API calls
app.use(express.json());

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Generates a unique 6-character room ID using alphanumeric characters
 * Recursively generates new IDs if collision occurs (though very unlikely)
 * @returns {string} Unique room ID (e.g., "ABC123")
 */
function generateRoomId() {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    // Ensure uniqueness by checking against existing rooms
    if (activeGames[result]) {
        return generateRoomId(); // Recursive call if ID already exists
    }
    return result;
}

// ============================================================================
// HTTP API ENDPOINTS
// ============================================================================

/**
 * GET /api/status
 * Returns server status and basic statistics
 */
app.get('/api/status', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Server is running',
        activeRooms: Object.keys(activeGames).length
    });
});

/**
 * POST /api/rooms/create
 * Creates a new game room with the requesting player as host
 * Body: { playerId: string }
 * Returns: { roomId: string }
 */
app.post('/api/rooms/create', (req, res) => {
    try {
        const { playerId } = req.body;
        
        // Validate request body
        if (!playerId || typeof playerId !== 'string' || playerId.trim() === '') {
            return res.status(400).json({
                error: 'Invalid or missing playerId'
            });
        }
        
        // Generate unique room ID
        const roomId = generateRoomId();
        
        // Create initial room state (waiting for players)
        const roomState = {
            roomId: roomId,
            host: playerId.trim(),
            players: [{ id: playerId.trim(), hand: [] }],
            status: 'waiting', // 'waiting', 'playing', 'finished'
            gameState: null, // Will be created when game starts
            createdAt: new Date()
        };
        
        // Store the room state
        activeGames[roomId] = roomState;
        
        console.log(`New room created: ${roomId} by player: ${playerId}`);
        
        res.status(201).json({
            roomId: roomId
        });
        
    } catch (error) {
        console.error('Error creating room:', error);
        res.status(500).json({
            error: 'Failed to create room'
        });
    }
});

/**
 * POST /api/rooms/:roomId/join
 * Adds a player to an existing room and starts game if 2+ players
 * Params: roomId (string)
 * Body: { playerId: string }
 * Returns: { success: boolean, message: string, gameStarted: boolean }
 */
app.post('/api/rooms/:roomId/join', (req, res) => {
    try {
        const { roomId } = req.params;
        const { playerId } = req.body;
        
        // Validate request body
        if (!playerId || typeof playerId !== 'string' || playerId.trim() === '') {
            return res.status(400).json({
                error: 'Invalid or missing playerId'
            });
        }
        
        // Find the room
        const room = activeGames[roomId];
        if (!room) {
            return res.status(404).json({
                error: 'Room not found'
            });
        }
        
        // Check if game has already finished
        if (room.status === 'finished') {
            return res.status(400).json({
                error: 'Game is already finished'
            });
        }
        
        // Check if player is already in the room
        const existingPlayer = room.players.find(player => player.id === playerId.trim());
        if (existingPlayer) {
            return res.status(400).json({
                error: 'Player already in this room'
            });
        }
        
        // Check room capacity (max 10 players for UNO)
        if (room.players.length >= 10) {
            return res.status(400).json({
                error: 'Room is full (maximum 10 players)'
            });
        }
          // Add player to the room
        room.players.push({
            id: playerId.trim(),
            hand: []
        });
        
        // Note: Game will be started via WebSocket 'startGame' event
        // Auto-start removed to allow manual game initiation
        
        console.log(`Player ${playerId} joined room: ${roomId} (${room.players.length} players total)`);
          res.json({
            success: true,
            message: 'Player joined successfully',
            gameStarted: false,
            canStart: room.players.length >= 2
        });
        
    } catch (error) {
        console.error('Error joining room:', error);
        res.status(500).json({
            error: 'Failed to join room'
        });
    }
});

/**
 * GET /api/rooms/:roomId
 * Returns the current state of a specific game room
 * Params: roomId (string)
 * Returns: Room state object with player info, game status, etc.
 */
app.get('/api/rooms/:roomId', (req, res) => {
    try {
        const { roomId } = req.params;
        
        // Find the room
        const room = activeGames[roomId];
        if (!room) {
            return res.status(404).json({
                error: 'Room not found'
            });
        }
        
        // Return different data based on room status
        if (room.status === 'waiting') {
            // Room is waiting for players
            res.json({
                roomId: roomId,
                status: 'waiting',
                host: room.host,
                players: room.players.map(player => ({
                    id: player.id
                })),
                playerCount: room.players.length,
                maxPlayers: 10,
                canStart: room.players.length >= 2
            });
        } else if (room.status === 'playing' && room.gameState) {
            // Game is in progress
            const gameState = room.gameState;
            res.json({
                roomId: roomId,
                status: 'playing',
                host: room.host,
                players: gameState.players.map(player => ({
                    id: player.id,
                    handSize: player.hand.length
                })),
                currentPlayerIndex: gameState.currentPlayerIndex,
                currentPlayer: gameState.players[gameState.currentPlayerIndex]?.id,
                directionOfPlay: gameState.directionOfPlay,
                currentColor: gameState.currentColor,
                topCard: gameState.discardPile[gameState.discardPile.length - 1],
                drawPileSize: gameState.drawPile.length,
                isGameOver: gameState.isGameOver,
                winner: gameState.winner
            });
        } else {
            // Game finished or unknown state
            res.json({
                roomId: roomId,
                status: room.status,
                host: room.host,
                players: room.players.map(player => ({
                    id: player.id
                })),
                playerCount: room.players.length
            });
        }
        
    } catch (error) {
        console.error('Error getting room state:', error);
        res.status(500).json({
            error: 'Failed to get room state'
        });
    }
});

/**
 * GET /api/rooms
 * Returns a list of all active game rooms with basic info
 * Useful for debugging and admin purposes
 * Returns: { totalRooms: number, rooms: Array<RoomSummary> }
 */
app.get('/api/rooms', (req, res) => {
    try {
        const rooms = Object.keys(activeGames).map(roomId => {
            const room = activeGames[roomId];
            return {
                roomId: roomId,
                status: room.status,
                host: room.host,
                playerCount: room.players.length,
                maxPlayers: 10,
                currentPlayer: room.gameState ? room.gameState.players[room.gameState.currentPlayerIndex]?.id : null,
                isGameOver: room.gameState ? room.gameState.isGameOver : false
            };
        });
        
        res.json({
            totalRooms: rooms.length,
            rooms: rooms
        });
        
    } catch (error) {
        console.error('Error getting rooms list:', error);
        res.status(500).json({
            error: 'Failed to get rooms list'
        });
    }
});

/**
 * GET /api/rooms/:roomId/hand/:playerId
 * Returns a specific player's hand in a game room
 * Params: roomId (string), playerId (string)
 * Returns: { playerId: string, hand: Array<Card> }
 */
app.get('/api/rooms/:roomId/hand/:playerId', (req, res) => {
    try {
        const { roomId, playerId } = req.params;
        
        // Find the room
        const room = activeGames[roomId];
        if (!room) {
            return res.status(404).json({
                error: 'Room not found'
            });
        }
        
        // Check if game is playing
        if (room.status !== 'playing' || !room.gameState) {
            return res.status(400).json({
                error: 'Game is not in progress'
            });
        }
        
        // Find the player
        const player = room.gameState.players.find(p => p.id === playerId);
        if (!player) {
            return res.status(404).json({
                error: 'Player not found in this room'
            });
        }
        
        res.json({
            playerId: playerId,
            hand: player.hand
        });
        
    } catch (error) {
        console.error('Error getting player hand:', error);
        res.status(500).json({
            error: 'Failed to get player hand'
        });
    }
});

// ============================================================================
// WEBSOCKET EVENT HANDLERS
// ============================================================================

/**
 * Main WebSocket connection handler
 * Manages real-time communication between server and clients for gameplay
 * 
 * Events handled:
 * - joinRoom: Player joins a game room
 * - startGame: Host starts the game
 * - playCard: Player plays a card
 * - drawCard: Player draws a card
 * - disconnect: Player disconnects
 */
io.on('connection', (socket) => {
    console.log(`Socket connected: ${socket.id}`);
    
    // Join a specific room
    socket.on('joinRoom', ({ roomId, playerId }) => {
        try {
            // Validate room exists
            const room = activeGames[roomId];
            if (!room) {
                socket.emit('error', { message: 'Room not found' });
                return;
            }
            
            // Validate player is in the room
            const playerInRoom = room.players.find(player => player.id === playerId);
            if (!playerInRoom) {
                socket.emit('error', { message: 'Player not in this room' });
                return;
            }
            
            // Join the socket.io room
            socket.join(roomId);
            socket.playerId = playerId;
            socket.roomId = roomId;
            
            console.log(`Player ${playerId} joined socket room ${roomId}`);
            
            // Send current room state to the joining player
            const roomState = getRoomStateForClient(room);
            socket.emit('gameUpdate', roomState);
            
            // Notify other players in the room
            socket.to(roomId).emit('playerConnected', { playerId });
            
        } catch (error) {
            console.error('Error in joinRoom:', error);
            socket.emit('error', { message: 'Failed to join room' });
        }
    });
      // Start the game (only host can do this)
    socket.on('startGame', ({ roomId }) => {
        try {
            console.log(`StartGame event received for room ${roomId} from socket ${socket.id}`);
            
            // Validate input
            if (!roomId) {
                socket.emit('error', { message: 'Room ID is required' });
                return;
            }
            
            // Look up the game state in activeGames
            const room = activeGames[roomId];
            if (!room) {
                socket.emit('error', { message: 'Room not found' });
                return;
            }
            
            // Validate that socket player is in the room
            if (!socket.playerId) {
                socket.emit('error', { message: 'Player not identified' });
                return;
            }
            
            // Check if player is the host
            if (room.host !== socket.playerId) {
                socket.emit('error', { message: 'Only the host can start the game' });
                return;
            }
            
            // Ensure there are at least 2 players
            if (room.players.length < 2) {
                socket.emit('error', { message: 'Need at least 2 players to start the game' });
                return;
            }
            
            // Check if game has already started
            if (room.status !== 'waiting') {
                socket.emit('error', { message: 'Game has already started or finished' });
                return;
            }
            
            // Extract player IDs from the room
            const playerIds = room.players.map(player => player.id);
            console.log(`Starting game with players: ${playerIds.join(', ')}`);
            
            // Call GameEngine to create the official game state
            const initialGameState = GameEngine.createGameState(playerIds);
            
            // Update the room with the complete game state
            room.gameState = initialGameState;
            room.status = 'playing';
            
            console.log(`Game officially started in room ${roomId} with ${playerIds.length} players`);
            console.log(`Current player: ${initialGameState.players[initialGameState.currentPlayerIndex].id}`);
            
            // Broadcast gameUpdate to all clients in the room
            const roomStateForClients = getRoomStateForClient(room);
            io.to(roomId).emit('gameUpdate', roomStateForClients);
            
            // Also send a specific gameStarted event
            io.to(roomId).emit('gameStarted', { 
                message: 'Game has started! Cards have been dealt.',
                currentPlayer: initialGameState.players[initialGameState.currentPlayerIndex].id,
                topCard: initialGameState.discardPile[initialGameState.discardPile.length - 1]
            });
            
            console.log(`Game update broadcasted to all clients in room ${roomId}`);
            
        } catch (error) {
            console.error('Error starting game:', error);
            socket.emit('error', { message: 'Failed to start game: ' + error.message });
        }
    });
    
    // Handle card play
    socket.on('playCard', ({ roomId, playerId, card, chosenColor }) => {
        try {
            const room = activeGames[roomId];
            if (!room || !room.gameState) {
                socket.emit('error', { message: 'Game not found or not started' });
                return;
            }
            
            // Validate player
            if (playerId !== socket.playerId) {
                socket.emit('error', { message: 'Invalid player ID' });
                return;
            }
            
            // Use GameEngine to validate and process the move
            const result = GameEngine.playCard(room.gameState, playerId, card, chosenColor);
            
            if (result.error) {
                socket.emit('error', { message: result.error });
                return;
            }
            
            // Update the game state
            room.gameState = result;
            
            console.log(`Player ${playerId} played card: ${card.color} ${card.value}`);
            
            // Check if game is over
            if (result.isGameOver) {
                room.status = 'finished';
                console.log(`Game over! Winner: ${result.winner}`);
                io.to(roomId).emit('gameOver', { 
                    winnerId: result.winner,
                    message: `${result.winner} wins the game!`
                });
            }
            
            // Broadcast updated game state to all players
            const roomState = getRoomStateForClient(room);
            io.to(roomId).emit('gameUpdate', roomState);
            
        } catch (error) {
            console.error('Error playing card:', error);
            socket.emit('error', { message: 'Failed to play card' });
        }
    });
    
    // Handle card draw
    socket.on('drawCard', ({ roomId, playerId }) => {
        try {
            const room = activeGames[roomId];
            if (!room || !room.gameState) {
                socket.emit('error', { message: 'Game not found or not started' });
                return;
            }
            
            // Validate player
            if (playerId !== socket.playerId) {
                socket.emit('error', { message: 'Invalid player ID' });
                return;
            }
            
            // Use GameEngine to process the draw
            const result = GameEngine.drawCard(room.gameState, playerId);
            
            if (result.error) {
                socket.emit('error', { message: result.error });
                return;
            }
            
            // Update the game state
            room.gameState = result;
            
            console.log(`Player ${playerId} drew a card`);
            
            // Broadcast updated game state to all players
            const roomState = getRoomStateForClient(room);
            io.to(roomId).emit('gameUpdate', roomState);
            
        } catch (error) {
            console.error('Error drawing card:', error);
            socket.emit('error', { message: 'Failed to draw card' });
        }
    });
      // Handle player disconnect
    socket.on('disconnect', () => {
        console.log(`Socket disconnected: ${socket.id}`);
        
        if (socket.roomId && socket.playerId) {
            handlePlayerDisconnect(socket.roomId, socket.playerId, socket);
        }
    });
});

// ============================================================================
// GAME MANAGEMENT UTILITY FUNCTIONS
// ============================================================================

/**
 * Handles player disconnection with comprehensive game state management
 * - Removes players from waiting rooms
 * - Marks players as inactive in active games
 * - Handles host transfers and room cleanup
 * - Ends games when insufficient active players remain
 * 
 * @param {string} roomId - The room ID the player was in
 * @param {string} playerId - The ID of the disconnected player
 * @param {Object} socket - The socket object for broadcasting
 */
function handlePlayerDisconnect(roomId, playerId, socket) {
    try {
        const room = activeGames[roomId];
        if (!room) {
            console.log(`Room ${roomId} not found during disconnect`);
            return;
        }

        console.log(`Player ${playerId} disconnected from room ${roomId}`);
        
        if (room.status === 'waiting') {
            // Game hasn't started - remove player from room
            room.players = room.players.filter(player => player.id !== playerId);
            
            // If host disconnected, make first remaining player the host
            if (room.host === playerId && room.players.length > 0) {
                room.host = room.players[0].id;
                console.log(`New host assigned: ${room.host}`);
                socket.to(roomId).emit('hostChanged', { newHost: room.host });
            }
            
            // If no players left, delete the room
            if (room.players.length === 0) {
                delete activeGames[roomId];
                console.log(`Room ${roomId} deleted - no players remaining`);
                return;
            }
            
            // Broadcast updated room state
            const roomState = getRoomStateForClient(room);
            socket.to(roomId).emit('gameUpdate', roomState);
            socket.to(roomId).emit('playerDisconnected', { 
                playerId,
                message: `${playerId} has left the room`
            });
            
        } else if (room.status === 'playing' && room.gameState) {
            // Game is in progress - mark player as inactive
            const playerIndex = room.gameState.players.findIndex(p => p.id === playerId);
            
            if (playerIndex !== -1) {
                // Mark player as inactive
                room.gameState.players[playerIndex].isActive = false;
                
                // If it was the disconnected player's turn, advance to next active player
                if (room.gameState.currentPlayerIndex === playerIndex) {
                    room.gameState.currentPlayerIndex = getNextActivePlayerIndex(room.gameState);
                }
                
                // Check if only one active player remains
                const activePlayers = room.gameState.players.filter(p => p.isActive !== false);
                if (activePlayers.length <= 1) {
                    // End the game - last active player wins
                    room.gameState.isGameOver = true;
                    room.gameState.winner = activePlayers.length === 1 ? activePlayers[0].id : null;
                    room.status = 'finished';
                    
                    socket.to(roomId).emit('gameOver', {
                        winnerId: room.gameState.winner,
                        reason: 'Other players disconnected',
                        message: room.gameState.winner ? 
                            `${room.gameState.winner} wins by default!` : 
                            'Game ended - all players disconnected'
                    });
                }
                
                // Broadcast updated game state
                const roomState = getRoomStateForClient(room);
                socket.to(roomId).emit('gameUpdate', roomState);
                socket.to(roomId).emit('playerDisconnected', { 
                    playerId,
                    message: `${playerId} has disconnected and will be skipped`
                });
            }
        }
        
    } catch (error) {
        console.error('Error handling player disconnect:', error);
    }
}

/**
 * Gets the next active player index, skipping inactive players
 * @param {Object} gameState - Current game state
 * @returns {number} Index of next active player
 */
function getNextActivePlayerIndex(gameState) {
    const { currentPlayerIndex, directionOfPlay, players } = gameState;
    const totalPlayers = players.length;
    let nextIndex = currentPlayerIndex;
    let attempts = 0;
    
    do {
        nextIndex = (nextIndex + directionOfPlay + totalPlayers) % totalPlayers;
        attempts++;
        
        // Prevent infinite loop if all players are inactive
        if (attempts >= totalPlayers) {
            return currentPlayerIndex;
        }
    } while (players[nextIndex].isActive === false);
    
    return nextIndex;
}

/**
 * Converts room data to client-safe format
 * @param {Object} room - Room object from activeGames
 * @returns {Object} Client-safe room state
 */
function getRoomStateForClient(room) {
    if (room.status === 'waiting') {
        return {
            roomId: room.roomId,
            status: 'waiting',
            host: room.host,
            players: room.players.map(player => ({
                id: player.id
            })),
            playerCount: room.players.length,
            maxPlayers: 10,
            canStart: room.players.length >= 2
        };    } else if (room.status === 'playing' && room.gameState) {
        const gameState = room.gameState;
        return {
            roomId: room.roomId,
            status: 'playing',
            host: room.host,
            players: gameState.players.map(player => ({
                id: player.id,
                handSize: player.hand.length,
                isActive: player.isActive !== false // Default to true if not set
            })),
            currentPlayerIndex: gameState.currentPlayerIndex,
            currentPlayer: gameState.players[gameState.currentPlayerIndex]?.id,
            directionOfPlay: gameState.directionOfPlay,
            currentColor: gameState.currentColor,
            topCard: gameState.discardPile[gameState.discardPile.length - 1],
            drawPileSize: gameState.drawPile.length,
            isGameOver: gameState.isGameOver,
            winner: gameState.winner
        };
    } else {
        return {
            roomId: room.roomId,
            status: room.status,
            host: room.host,
            players: room.players.map(player => ({
                id: player.id
            })),
            playerCount: room.players.length
        };
    }
}

// Start the server, making it listen on the defined port
httpServer.listen(PORT, () => {
    console.log(`UNO Backend server is running on port ${PORT}`);
    console.log(`Server URL: http://localhost:${PORT}`);
    console.log(`WebSocket endpoint: ws://localhost:${PORT}`);
    console.log('\nAvailable API endpoints:');
    console.log(`  GET  /api/status                    - Server status`);
    console.log(`  GET  /api/rooms                     - List all active rooms`);
    console.log(`  POST /api/rooms/create              - Create new game room`);
    console.log(`  POST /api/rooms/:roomId/join        - Join existing room`);
    console.log(`  GET  /api/rooms/:roomId             - Get room state`);
    console.log('\nWebSocket events:');
    console.log(`  joinRoom     - Join a game room`);
    console.log(`  startGame    - Start the game (host only)`);
    console.log(`  playCard     - Play a card`);
    console.log(`  drawCard     - Draw a card`);
    console.log('\nGame rooms will be stored in memory and reset on server restart.');
});
