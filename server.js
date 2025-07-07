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
const cors = require('cors'); // <-- Import
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

/**
 * In-memory storage for registered users
 * Structure: {
 *   username: {
 *     username: string,
 *     name: string,
 *     password: string,
 *     avatar: string,
 *     registeredAt: Date
 *   }
 * }
 */
let registeredUsers = {};

// Server configuration
const PORT = 3001;

app.use(cors());
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

// ============================================================================
// AUTHENTICATION ENDPOINTS
// ============================================================================

/**
 * POST /api/auth/register
 * Registers a new user account
 * Body: { name: string, username: string, password: string, avatar: string }
 * Returns: { success: boolean, message: string }
 */
app.post('/api/auth/register', (req, res) => {
    try {
        const { name, username, password, avatar } = req.body;
        
        // Validate required fields
        if (!name || !username || !password || !avatar) {
            return res.status(400).json({
                error: 'All fields are required: name, username, password, avatar'
            });
        }
        
        // Check if fields are not empty strings
        if (typeof name !== 'string' || name.trim() === '' ||
            typeof username !== 'string' || username.trim() === '' ||
            typeof password !== 'string' || password.trim() === '' ||
            typeof avatar !== 'string' || avatar.trim() === '') {
            return res.status(400).json({
                error: 'All fields must be non-empty strings'
            });
        }
        
        // Check if username already exists
        if (registeredUsers[username.trim()]) {
            return res.status(400).json({
                error: 'Username already exists'
            });
        }
        
        // Create new user (simulate password hashing with simple suffix)
        const newUser = {
            username: username.trim(),
            name: name.trim(),
            password: password + '_secret', // Simple password "hashing" simulation
            avatar: avatar.trim(),
            registeredAt: new Date()
        };
        
        // Store user in our "database"
        registeredUsers[username.trim()] = newUser;
        
        console.log(`New user registered: ${username}`);
        
        res.status(201).json({
            success: true,
            message: 'User registered successfully'
        });
        
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({
            error: 'Internal server error during registration'
        });
    }
});

/**
 * POST /api/auth/login
 * Authenticates a user and returns their profile data
 * Body: { username: string, password: string }
 * Returns: { success: boolean, user: object } or { error: string }
 */
app.post('/api/auth/login', (req, res) => {
    try {
        const { username, password } = req.body;
        
        // Validate required fields
        if (!username || !password) {
            return res.status(400).json({
                error: 'Username and password are required'
            });
        }
        
        // Check if fields are not empty strings
        if (typeof username !== 'string' || username.trim() === '' ||
            typeof password !== 'string' || password.trim() === '') {
            return res.status(400).json({
                error: 'Username and password must be non-empty strings'
            });
        }
        
        // Find user in our "database"
        const user = registeredUsers[username.trim()];
        
        if (!user) {
            return res.status(401).json({
                error: 'Invalid username or password'
            });
        }
        
        // Verify password (simulate password verification)
        const expectedPassword = password + '_secret';
        if (user.password !== expectedPassword) {
            return res.status(401).json({
                error: 'Invalid username or password'
            });
        }
        
        // Login successful - return user data without password
        const userData = {
            username: user.username,
            name: user.name,
            avatar: user.avatar
        };
        
        console.log(`User logged in: ${username}`);
        
        res.status(200).json({
            success: true,
            user: userData
        });
        
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({
            error: 'Internal server error during login'
        });
    }
});

// ============================================================================
// ROOM MANAGEMENT ENDPOINTS
// ============================================================================

/**
 * POST /api/rooms/create
 * Creates a new game room with the requesting player as host
 * Body: { playerId: string }
 * Returns: { roomId: string }
 */
app.post('/api/rooms/create', (req, res) => {
    try {
        const { playerId, maxPlayers } = req.body;
        
        // Validate request body
        if (!playerId || typeof playerId !== 'string' || playerId.trim() === '') {
            return res.status(400).json({
                error: 'Invalid or missing playerId'
            });
        }
        
        // Validate maxPlayers parameter
        const playerLimit = maxPlayers || 4; // Default to 4 if not specified
        if (typeof playerLimit !== 'number' || playerLimit < 2 || playerLimit > 10) {
            return res.status(400).json({
                error: 'maxPlayers must be a number between 2 and 10'
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
            maxPlayers: playerLimit, // Use the requested player limit
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
        
        // Check room capacity using the room's maxPlayers property
        if (room.players.length >= room.maxPlayers) {
            return res.status(400).json({
                error: `Room is full (maximum ${room.maxPlayers} players)`
            });
        }
          // Add player to the room
        room.players.push({
            id: playerId.trim(),
            hand: []
        });
        
        // Broadcast updated room state to all connected clients in the room
        io.to(roomId).emit('gameUpdate', getRoomStateForClient(room));
        
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
 * Returns the current state of a specific game room with enriched player data
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
        
        // Use the same enriched function as WebSocket events
        const roomState = getRoomStateForClient(room);
        res.json(roomState);
        
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
                maxPlayers: room.maxPlayers,
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
    
    // Handle playing a drawn card (from limbo state)
    socket.on('playDrawnCard', ({ roomId, playerId, chosenColor }) => {
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
            
            // Use GameEngine to process playing the drawn card
            const result = GameEngine.playDrawnCard(room.gameState, playerId, chosenColor);
            
            if (result.error) {
                socket.emit('error', { message: result.error });
                return;
            }
            
            // Update the game state
            room.gameState = result;
            
            console.log(`Player ${playerId} played their drawn card`);
            
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
            console.error('Error playing drawn card:', error);
            socket.emit('error', { message: 'Failed to play drawn card' });
        }
    });
    
    // Handle passing on a drawn card (from limbo state)
    socket.on('passDrawnCard', ({ roomId, playerId }) => {
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
            
            // Use GameEngine to process passing the drawn card
            const result = GameEngine.passDrawnCard(room.gameState, playerId);
            
            if (result.error) {
                socket.emit('error', { message: result.error });
                return;
            }
            
            // Update the game state
            room.gameState = result;
            
            console.log(`Player ${playerId} passed on their drawn card`);
            
            // Broadcast updated game state to all players
            const roomState = getRoomStateForClient(room);
            io.to(roomId).emit('gameUpdate', roomState);
            
        } catch (error) {
            console.error('Error passing drawn card:', error);
            socket.emit('error', { message: 'Failed to pass drawn card' });
        }
    });
    
    // Handle intentional player leaving
    socket.on('leaveRoom', ({ roomId, playerId, reason }) => {
        try {
            console.log(`Player ${playerId} intentionally leaving room ${roomId} (reason: ${reason})`);
            
            // Validate player
            if (playerId !== socket.playerId || roomId !== socket.roomId) {
                socket.emit('error', { message: 'Invalid leave request' });
                return;
            }
            
            // Use the same disconnect handling logic
            handlePlayerDisconnect(roomId, playerId, socket, 'intentional_leave');
            
            // Remove socket from room
            socket.leave(roomId);
            socket.roomId = null;
            socket.playerId = null;
            
        } catch (error) {
            console.error('Error handling leave room:', error);
            socket.emit('error', { message: 'Failed to leave room' });
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
 * @param {string} reason - The reason for disconnection ('disconnect' or 'intentional_leave')
 */
function handlePlayerDisconnect(roomId, playerId, socket, reason = 'disconnect') {
    try {
        const room = activeGames[roomId];
        if (!room) {
            console.log(`Room ${roomId} not found during disconnect`);
            return;
        }

        const isIntentionalLeave = reason === 'intentional_leave';
        console.log(`Player ${playerId} ${isIntentionalLeave ? 'left' : 'disconnected from'} room ${roomId}`);
        
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
                message: isIntentionalLeave ? `${playerId} has left the room` : `${playerId} has disconnected`
            });
            
        } else if (room.status === 'playing' && room.gameState) {
            // Game is in progress - mark player as inactive
            const playerIndex = room.gameState.players.findIndex(p => p.id === playerId);
            
            if (playerIndex !== -1) {
                // Mark player as inactive
                room.gameState.players[playerIndex].isActive = false;
                
                // Clear any limbo state if disconnected player was in limbo
                if (room.gameState.playableDrawnCard && room.gameState.playableDrawnCard.playerId === playerId) {
                    room.gameState.playableDrawnCard = null;
                }
                
                // If it was the disconnected player's turn, advance to next active player
                const wasCurrentPlayer = room.gameState.currentPlayerIndex === playerIndex;
                if (wasCurrentPlayer) {
                    const nextPlayerIndex = getNextActivePlayerIndex(room.gameState);
                    room.gameState.currentPlayerIndex = nextPlayerIndex;
                    
                    // Broadcast turn change to inform all players
                    socket.to(roomId).emit('turnChanged', {
                        currentPlayerIndex: nextPlayerIndex,
                        currentPlayerId: room.gameState.players[nextPlayerIndex]?.id,
                        reason: 'Player disconnected'
                    });
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
                        reason: isIntentionalLeave ? 'Player forfeited' : 'Other players disconnected',
                        message: room.gameState.winner ? 
                            `🎉 ${room.gameState.winner} wins by default!` : 
                            'Game ended - all players have left'
                    });
                }
                
                // Broadcast updated game state
                const roomState = getRoomStateForClient(room);
                socket.to(roomId).emit('gameUpdate', roomState);
                socket.to(roomId).emit('playerDisconnected', { 
                    playerId,
                    message: isIntentionalLeave ? 
                        `${playerId} has forfeited the game and will be skipped` : 
                        `${playerId} has disconnected and will be skipped`
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
 * Converts room data to client-safe format with enriched player data
 * Looks up player display information from registeredUsers database
 * @param {Object} room - Room object from activeGames
 * @returns {Object} Client-safe room state with full player info
 */
function getRoomStateForClient(room) {
    /**
     * Helper function to enrich player data with name and avatar
     * @param {Object} player - Player object with at least an id
     * @returns {Object} Enriched player object with { id, name, avatar, handSize?, isActive? }
     */
    function enrichPlayerData(player) {
        const userData = registeredUsers[player.id];
        return {
            id: player.id,
            name: userData ? userData.name : player.id, // Fallback to id if user not found
            avatar: userData ? userData.avatar : 'public/assets/images/avatar/a1.jpg', // Default avatar
            ...(player.handSize !== undefined && { handSize: player.handSize }),
            ...(player.isActive !== undefined && { isActive: player.isActive })
        };
    }

    if (room.status === 'waiting') {
        return {
            roomId: room.roomId,
            status: 'waiting',
            host: room.host,
            players: room.players.map(player => enrichPlayerData({ id: player.id })),
            playerCount: room.players.length,
            maxPlayers: room.maxPlayers,
            canStart: room.players.length >= 2
        };
    } else if (room.status === 'playing' && room.gameState) {
        const gameState = room.gameState;
        return {
            roomId: room.roomId,
            status: 'playing',
            host: room.host,
            players: gameState.players.map(player => enrichPlayerData({
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
            winner: gameState.winner,
            playableDrawnCard: gameState.playableDrawnCard || null
        };
    } else {
        return {
            roomId: room.roomId,
            status: room.status,
            host: room.host,
            players: room.players.map(player => enrichPlayerData({ id: player.id })),
            playerCount: room.players.length
        };
    }
}

// Start the server, making it listen on the defined port
httpServer.listen(PORT, () => {    console.log(`UNO Backend server is running on port ${PORT}`);
    console.log(`Server URL: http://localhost:${PORT}`);
    console.log(`WebSocket endpoint: ws://localhost:${PORT}`);
    console.log('\nAvailable API endpoints:');
    console.log(`  GET  /api/status                    - Server status`);
    console.log(`  POST /api/auth/register             - Register new user account`);
    console.log(`  POST /api/auth/login                - Login user account`);
    console.log(`  GET  /api/rooms                     - List all active rooms`);
    console.log(`  POST /api/rooms/create              - Create new game room`);
    console.log(`  POST /api/rooms/:roomId/join        - Join existing room`);
    console.log(`  GET  /api/rooms/:roomId             - Get room state`);
    console.log('\nWebSocket events:');
    console.log(`  joinRoom     - Join a game room`);
    console.log(`  startGame    - Start the game (host only)`);
    console.log(`  playCard     - Play a card`);
    console.log(`  drawCard       - Draw a card`);
    console.log(`  playDrawnCard  - Play a card that was just drawn`);
    console.log(`  passDrawnCard  - Pass on a card that was just drawn`);
    console.log('\nUser accounts and game rooms will be stored in memory and reset on server restart.');
});
