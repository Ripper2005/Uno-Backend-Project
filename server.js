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
require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
const cors = require('cors'); // <-- Import
const { Server } = require('socket.io');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');

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

// Create MySQL connection pool
const dbPool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || 'root',
  database: process.env.DB_NAME || 'uno',
  ssl: {
    rejectUnauthorized: false                 // Required for Aiven SSL connection
  },
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// In-memory cache for active games (in_progress status)
// This provides fast access during gameplay while maintaining database persistence
let activeGames = {};

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
 * @returns {string} Unique room ID (e.g., "ABC123")
 */
function generateRoomId() {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = '';
    for (let i = 0; i < 6; i++) {
        result += characters.charAt(Math.floor(Math.random() * characters.length));
    }
    return result;
}

/**
 * Load active games from database into cache on server startup
 */
async function loadActiveGamesIntoCache() {
    try {
        const [gameRows] = await dbPool.execute(
            'SELECT room_code, game_state FROM games WHERE status = ?',
            ['in_progress']
        );
        
        for (const gameData of gameRows) {
            const gameState = gameData.game_state;
            // Only load if it's a proper game state (not lobby state)
            if (gameState.players && gameState.currentPlayerIndex !== undefined) {
                activeGames[gameData.room_code] = gameState;
                console.log(`Loaded game ${gameData.room_code} into cache`);
            }
        }
        
        console.log(`Loaded ${Object.keys(activeGames).length} active games into cache`);
    } catch (error) {
        console.error('Error loading active games into cache:', error);
    }
}

/**
 * Gets the numeric user ID for a username
 * @param {string} username - The username to look up
 * @returns {number|null} The user ID or null if not found
 */
async function getUserId(username) {
    try {
        const [userRows] = await dbPool.execute(
            'SELECT id FROM users WHERE username = ?',
            [username]
        );
        return userRows.length > 0 ? userRows[0].id : null;
    } catch (error) {
        console.error('Error fetching user ID:', error);
        return null;
    }
}

// ============================================================================
// HTTP API ENDPOINTS
// ============================================================================

/**
 * GET /api/status
 * Returns server status and basic statistics
 */
app.get('/api/status', async (req, res) => {
    try {
        // Count active games from database
        const [gameRows] = await dbPool.execute(
            'SELECT COUNT(*) as count FROM games WHERE status IN (?, ?)',
            ['waiting', 'in_progress']
        );
        
        res.json({
            status: 'ok',
            message: 'Server is running',
            activeRooms: gameRows[0].count
        });
    } catch (error) {
        console.error('Error getting server status:', error);
        res.json({
            status: 'ok',
            message: 'Server is running',
            activeRooms: 0
        });
    }
});

// ============================================================================
// AUTHENTICATION ENDPOINTS
// ============================================================================

/**
 * POST /api/auth/register
 * Registers a new user account
 * Body: { full_name: string, username: string, password: string, avatar_url: string }
 * Returns: { success: boolean, message: string }
 */
app.post('/api/auth/register', async (req, res) => {
    try {
        const { full_name, username, password, avatar_url } = req.body;
        
        // Validate required fields
        if (!full_name || !username || !password || !avatar_url) {
            return res.status(400).json({
                error: 'All fields are required: full_name, username, password, avatar_url'
            });
        }
        
        // Check if fields are not empty strings
        if (typeof full_name !== 'string' || full_name.trim() === '' ||
            typeof username !== 'string' || username.trim() === '' ||
            typeof password !== 'string' || password.trim() === '' ||
            typeof avatar_url !== 'string' || avatar_url.trim() === '') {
            return res.status(400).json({
                error: 'All fields must be non-empty strings'
            });
        }

        // Hash the password
        const saltRounds = 10;
        const password_hash = await bcrypt.hash(password, saltRounds);

        // Insert new user into database
        const insertQuery = `
            INSERT INTO users (username, password_hash, full_name, avatar_url, games_played, games_won, registered_at)
            VALUES (?, ?, ?, ?, 0, 0, NOW())
        `;
        
        await dbPool.execute(insertQuery, [
            username.trim(),
            password_hash,
            full_name.trim(),
            avatar_url.trim()
        ]);

        console.log(`New user registered: ${username}`);
        
        res.status(201).json({
            success: true,
            message: 'User registered successfully'
        });
        
    } catch (error) {
        console.error('Registration error:', error);
        
        // Handle duplicate username error
        if (error.code === 'ER_DUP_ENTRY') {
            return res.status(400).json({
                error: 'Username already exists'
            });
        }
        
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
app.post('/api/auth/login', async (req, res) => {
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
        
        // Find user in database
        const selectQuery = `
            SELECT id, username, password_hash, full_name, avatar_url, games_played, games_won, registered_at
            FROM users
            WHERE username = ?
        `;
        
        const [rows] = await dbPool.execute(selectQuery, [username.trim()]);
        
        if (rows.length === 0) {
            return res.status(401).json({
                error: 'Invalid username or password'
            });
        }
        
        const user = rows[0];
        
        // Verify password
        const passwordMatch = await bcrypt.compare(password, user.password_hash);
        
        if (!passwordMatch) {
            return res.status(401).json({
                error: 'Invalid username or password'
            });
        }
        
        // Login successful - return user data without password
        const userData = {
            id: user.id,
            username: user.username,
            name: user.full_name,
            avatar: user.avatar_url,
            games_played: user.games_played,
            games_won: user.games_won,
            registered_at: user.registered_at
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

/**
 * POST /api/auth/update-avatar
 * Updates a user's avatar
 * Body: { username: string, avatar: string }
 * Returns: { success: boolean, user: object } or { error: string }
 */
app.post('/api/auth/update-avatar', async (req, res) => {
    try {
        const { username, avatar } = req.body;
        
        // Validate required fields
        if (!username || !avatar) {
            return res.status(400).json({
                error: 'Username and avatar are required'
            });
        }
        
        // Check if fields are not empty strings
        if (typeof username !== 'string' || username.trim() === '' ||
            typeof avatar !== 'string' || avatar.trim() === '') {
            return res.status(400).json({
                error: 'Username and avatar must be non-empty strings'
            });
        }
        
        // Update avatar in database
        const updateQuery = `
            UPDATE users 
            SET avatar_url = ?
            WHERE username = ?
        `;
        
        const [result] = await dbPool.execute(updateQuery, [avatar.trim(), username.trim()]);
        
        if (result.affectedRows === 0) {
            return res.status(404).json({
                error: 'User not found'
            });
        }
        
        // Get updated user data
        const selectQuery = `
            SELECT id, username, full_name, avatar_url, games_played, games_won, registered_at
            FROM users
            WHERE username = ?
        `;
        
        const [rows] = await dbPool.execute(selectQuery, [username.trim()]);
        const user = rows[0];
        
        // Return updated user data
        const userData = {
            id: user.id,
            username: user.username,
            name: user.full_name,
            avatar: user.avatar_url,
            games_played: user.games_played,
            games_won: user.games_won,
            registered_at: user.registered_at
        };
        
        console.log(`Avatar updated for user: ${username}`);
        
        res.status(200).json({
            success: true,
            user: userData
        });
        
    } catch (error) {
        console.error('Avatar update error:', error);
        res.status(500).json({
            error: 'Internal server error during avatar update'
        });
    }
});

// ============================================================================
// ROOM MANAGEMENT ENDPOINTS
// ============================================================================

/**
 * POST /api/rooms/create
 * Creates a new game room with the requesting player as host
 * Body: { playerId: string, maxPlayers: number }
 * Returns: { roomId: string }
 */
app.post('/api/rooms/create', async (req, res) => {
    let connection;
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
        
        // Start database transaction
        connection = await dbPool.getConnection();
        await connection.beginTransaction();
        
        // Fetch user ID from database
        const [userRows] = await connection.execute(
            'SELECT id, username, full_name, avatar_url FROM users WHERE username = ?',
            [playerId.trim()]
        );
        
        if (userRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                error: 'Player not found'
            });
        }
        
        const userData = userRows[0];
        const hostUserId = userData.id;
        
        // Generate unique room code
        let roomCode;
        let isUnique = false;
        let attempts = 0;
        
        while (!isUnique && attempts < 10) {
            roomCode = generateRoomId();
            const [existingRooms] = await connection.execute(
                'SELECT id FROM games WHERE room_code = ?',
                [roomCode]
            );
            if (existingRooms.length === 0) {
                isUnique = true;
            }
            attempts++;
        }
        
        if (!isUnique) {
            await connection.rollback();
            return res.status(500).json({
                error: 'Failed to generate unique room code'
            });
        }
        
        // Create initial game state for waiting room
        const initialGameState = {
            status: 'waiting',
            host: playerId.trim(),
            players: [{
                id: playerId.trim(),
                name: userData.full_name,
                avatar: userData.avatar_url,
                hand: []
            }],
            maxPlayers: playerLimit,
            createdAt: new Date().toISOString()
        };
        
        // Insert into games table
        const [gameResult] = await connection.execute(
            `INSERT INTO games (room_code, host_id, status, game_state, created_at) 
             VALUES (?, ?, ?, ?, NOW())`,
            [roomCode, hostUserId, 'waiting', JSON.stringify(initialGameState)]
        );
        
        const newGameId = gameResult.insertId;
        
        // Insert host as first participant
        await connection.execute(
            'INSERT INTO game_participants (game_id, user_id, joined_at) VALUES (?, ?, NOW())',
            [newGameId, hostUserId]
        );
        
        // Commit transaction
        await connection.commit();
        
        console.log(`New room created: ${roomCode} by player: ${playerId}`);
        
        res.status(201).json({
            roomId: roomCode
        });
        
    } catch (error) {
        if (connection) {
            await connection.rollback();
        }
        console.error('Error creating room:', error);
        res.status(500).json({
            error: 'Failed to create room'
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
});

/**
 * POST /api/rooms/:roomId/join
 * Adds a player to an existing room
 * Params: roomId (string) - the room_code
 * Body: { playerId: string }
 * Returns: { success: boolean, message: string, gameStarted: boolean }
 */
app.post('/api/rooms/:roomId/join', async (req, res) => {
    let connection;
    try {
        const { roomId } = req.params; // This is the room_code
        const { playerId } = req.body;
        
        // Validate request body
        if (!playerId || typeof playerId !== 'string' || playerId.trim() === '') {
            return res.status(400).json({
                error: 'Invalid or missing playerId'
            });
        }
        
        // Start database transaction
        connection = await dbPool.getConnection();
        await connection.beginTransaction();
        
        // Fetch game data
        const [gameRows] = await connection.execute(
            'SELECT id, room_code, host_id, status, game_state FROM games WHERE room_code = ?',
            [roomId]
        );
        
        if (gameRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                error: 'Room not found'
            });
        }
        
        const gameData = gameRows[0];
        const gameState = gameData.game_state; // MySQL automatically parses JSON columns
        
        // Check if game has already finished
        if (gameData.status === 'completed') {
            await connection.rollback();
            return res.status(400).json({
                error: 'Game is already completed'
            });
        }
        
        // Fetch joining player's data
        const [userRows] = await connection.execute(
            'SELECT id, username, full_name, avatar_url FROM users WHERE username = ?',
            [playerId.trim()]
        );
        
        if (userRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                error: 'Player not found'
            });
        }
        
        const userData = userRows[0];
        const joiningUserId = userData.id;
        
        // Check if player is already in the game (check both database and game state)
        const [participantRows] = await connection.execute(
            'SELECT user_id FROM game_participants WHERE game_id = ? AND user_id = ?',
            [gameData.id, joiningUserId]
        );
        
        const isInDatabase = participantRows.length > 0;
        const isInGameState = gameState.players.some(player => player.id === playerId.trim());
        
        // If player is in game state but not in database, clean up the game state
        if (isInGameState && !isInDatabase) {
            console.log(`Cleaning up orphaned player ${playerId} from game state`);
            gameState.players = gameState.players.filter(player => player.id !== playerId.trim());
            await connection.execute(
                'UPDATE games SET game_state = ? WHERE id = ?',
                [JSON.stringify(gameState), gameData.id]
            );
        }
        
        // If player is in database but not in game state, clean up the database
        if (!isInGameState && isInDatabase) {
            console.log(`Cleaning up orphaned player ${playerId} from database`);
            await connection.execute(
                'DELETE FROM game_participants WHERE game_id = ? AND user_id = ?',
                [gameData.id, joiningUserId]
            );
        }
        
        // If player is in both, they're actually already in the room
        if (isInDatabase && isInGameState) {
            await connection.rollback();
            return res.status(400).json({
                error: 'Player already in this room'
            });
        }
        
        // Check room capacity (use both database count and game state length for accuracy)
        const [participantCountRows] = await connection.execute(
            'SELECT COUNT(*) as count FROM game_participants WHERE game_id = ?',
            [gameData.id]
        );
        
        const databasePlayerCount = participantCountRows[0].count;
        const gameStatePlayerCount = gameState.players.length;
        
        // Use the maximum of both counts to be safe
        const currentPlayerCount = Math.max(databasePlayerCount, gameStatePlayerCount);
        
        if (currentPlayerCount >= gameState.maxPlayers) {
            await connection.rollback();
            return res.status(400).json({
                error: `Room is full (maximum ${gameState.maxPlayers} players)`
            });
        }
        
        // Add player to game_participants
        await connection.execute(
            'INSERT INTO game_participants (game_id, user_id, joined_at) VALUES (?, ?, NOW())',
            [gameData.id, joiningUserId]
        );
        
        // Update game state to include new player
        gameState.players.push({
            id: playerId.trim(),
            name: userData.full_name,
            avatar: userData.avatar_url,
            hand: []
        });
        
        // Update game state in database
        await connection.execute(
            'UPDATE games SET game_state = ? WHERE id = ?',
            [JSON.stringify(gameState), gameData.id]
        );
        
        // Commit transaction
        await connection.commit();
        
        // Broadcast updated room state to all connected clients in the room
        io.to(roomId).emit('gameUpdate', getRoomStateForClient(gameState, roomId));
        
        console.log(`Player ${playerId} joined room: ${roomId} (${gameState.players.length} players total)`);
        
        res.json({
            success: true,
            message: 'Player joined successfully',
            gameStarted: false,
            canStart: gameState.players.length >= 2
        });
        
    } catch (error) {
        if (connection) {
            await connection.rollback();
        }
        console.error('Error joining room:', error);
        res.status(500).json({
            error: 'Failed to join room'
        });
    } finally {
        if (connection) {
            connection.release();
        }
    }
});

/**
 * GET /api/rooms/:roomId
 * Returns the current state of a specific game room with enriched player data
 * Params: roomId (string) - the room_code
 * Returns: Room state object with player info, game status, etc.
 */
app.get('/api/rooms/:roomId', async (req, res) => {
    try {
        const { roomId } = req.params; // This is the room_code
        
        // First check if game is in cache (for active games)
        if (activeGames[roomId]) {
            const roomState = getRoomStateForClient(activeGames[roomId], roomId);
            res.json(roomState);
            return;
        }
        
        // If not in cache, fetch from database
        const [gameRows] = await dbPool.execute(
            'SELECT room_code, status, game_state FROM games WHERE room_code = ?',
            [roomId]
        );
        
        if (gameRows.length === 0) {
            return res.status(404).json({
                error: 'Room not found'
            });
        }
        
        const gameData = gameRows[0];
        const gameState = gameData.game_state; // MySQL automatically parses JSON columns
        
        // Use the enriched function to format for client
        const roomState = getRoomStateForClient(gameState, roomId);
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
app.get('/api/rooms', async (req, res) => {
    try {
        // Get rooms from cache (active games)
        const cachedRooms = Object.entries(activeGames).map(([roomId, gameState]) => ({
            roomId: roomId,
            status: 'in_progress',
            playerCount: gameState.players ? gameState.players.length : 0,
            currentPlayer: gameState.players ? gameState.players[gameState.currentPlayerIndex]?.id : null,
            isGameOver: gameState.isGameOver || false
        }));
        
        // Fetch waiting/lobby games from database
        const [gameRows] = await dbPool.execute(
            'SELECT room_code, status, game_state FROM games WHERE status IN (?, ?)',
            ['waiting', 'completed']
        );
        
        const dbRooms = gameRows.map(gameData => {
            const gameState = gameData.game_state; // MySQL automatically parses JSON columns
            return {
                roomId: gameData.room_code,
                status: gameData.status,
                playerCount: gameState.players ? gameState.players.length : 0,
                maxPlayers: gameState.maxPlayers || 4,
                host: gameState.host,
                currentPlayer: null,
                isGameOver: gameData.status === 'completed'
            };
        });
        
        // Combine cached and database rooms
        const allRooms = [...cachedRooms, ...dbRooms];
        
        res.json({
            totalRooms: allRooms.length,
            rooms: allRooms
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
 * Params: roomId (string) - room_code, playerId (string)
 * Returns: { playerId: string, hand: Array<Card> }
 */
app.get('/api/rooms/:roomId/hand/:playerId', async (req, res) => {
    try {
        const { roomId, playerId } = req.params; // roomId is room_code
        
        // First check if game is in cache (for active games)
        if (activeGames[roomId]) {
            const gameState = activeGames[roomId];
            
            // Find the player
            const player = gameState.players.find(p => p.id === playerId);
            if (!player) {
                return res.status(404).json({
                    error: 'Player not found in this room'
                });
            }
            
            res.json({
                playerId: playerId,
                hand: player.hand
            });
            return;
        }
        
        // If not in cache, fetch from database
        const [gameRows] = await dbPool.execute(
            'SELECT status, game_state FROM games WHERE room_code = ?',
            [roomId]
        );
        
        if (gameRows.length === 0) {
            return res.status(404).json({
                error: 'Room not found'
            });
        }
        
        const gameData = gameRows[0];
        const gameState = gameData.game_state; // MySQL automatically parses JSON columns
        
        // Check if game is playing
        if (gameData.status !== 'in_progress') {
            return res.status(400).json({
                error: 'Game is not in progress'
            });
        }
        
        // Find the player
        const player = gameState.players ? gameState.players.find(p => p.id === playerId) : null;
        if (!player) {
            return res.status(404).json({
                error: 'Player not found in this room'
            });
        }
        
        res.json({
            playerId: playerId,
            hand: player.hand || []
        });
        
    } catch (error) {
        console.error('Error getting player hand:', error);
        res.status(500).json({
            error: 'Failed to get player hand'
        });
    }
});

// ============================================================================
// DBMS COURSE — NEW API ENDPOINTS (Leaderboard, Stats, History, Dashboard)
// ============================================================================

/**
 * GET /api/leaderboard
 * Returns ranked player standings using the v_leaderboard view
 * Query params: limit (default 10)
 * DBMS Concepts: Views, RANK() window function, computed columns
 */
app.get('/api/leaderboard', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const [rows] = await dbPool.execute(
            'SELECT * FROM v_leaderboard LIMIT ?',
            [limit.toString()]
        );
        res.json({
            success: true,
            count: rows.length,
            leaderboard: rows
        });
    } catch (error) {
        console.error('Error fetching leaderboard:', error);
        res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
});

/**
 * GET /api/users/:username/stats
 * Returns detailed player statistics using the v_player_stats view
 * DBMS Concepts: Views, LEFT JOIN, GROUP BY, COALESCE, aggregation functions
 */
app.get('/api/users/:username/stats', async (req, res) => {
    try {
        const { username } = req.params;
        const [rows] = await dbPool.execute(
            'SELECT * FROM v_player_stats WHERE username = ?',
            [username]
        );
        if (rows.length === 0) {
            return res.status(404).json({ error: 'Player not found' });
        }
        res.json({
            success: true,
            stats: rows[0]
        });
    } catch (error) {
        console.error('Error fetching player stats:', error);
        res.status(500).json({ error: 'Failed to fetch player stats' });
    }
});

/**
 * GET /api/users/:username/history
 * Returns paginated match history using the v_match_history view
 * Query params: page (default 1), limit (default 10)
 * DBMS Concepts: Views, GROUP_CONCAT, LEFT JOIN, LIMIT/OFFSET pagination
 */
app.get('/api/users/:username/history', async (req, res) => {
    try {
        const { username } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const offset = (page - 1) * limit;

        const [rows] = await dbPool.execute(
            `SELECT * FROM v_match_history 
             WHERE player_names LIKE CONCAT('%', ?, '%') 
             ORDER BY completed_at DESC 
             LIMIT ? OFFSET ?`,
            [username, limit.toString(), offset.toString()]
        );

        // Get total count for pagination
        const [countRows] = await dbPool.execute(
            `SELECT COUNT(*) AS total FROM v_match_history 
             WHERE player_names LIKE CONCAT('%', ?, '%')`,
            [username]
        );

        res.json({
            success: true,
            page,
            limit,
            totalMatches: countRows[0].total,
            totalPages: Math.ceil(countRows[0].total / limit),
            matches: rows
        });
    } catch (error) {
        console.error('Error fetching match history:', error);
        res.status(500).json({ error: 'Failed to fetch match history' });
    }
});

/**
 * GET /api/users/:username/dashboard
 * Returns full player dashboard using the sp_get_player_dashboard stored procedure
 * DBMS Concepts: Stored procedures, multiple result sets, CASE, ROW_NUMBER(),
 *               correlated subqueries, multi-table JOINs
 */
app.get('/api/users/:username/dashboard', async (req, res) => {
    let connection;
    try {
        const { username } = req.params;
        connection = await dbPool.getConnection();

        // Call stored procedure — returns multiple result sets
        const [results] = await connection.query(
            'CALL sp_get_player_dashboard(?)',
            [username]
        );

        // results[0] = profile, results[1] = recent matches, results[2] = rank
        const profile = results[0] && results[0].length > 0 ? results[0][0] : null;
        const recentMatches = results[1] || [];
        const rankResult = results[2] && results[2].length > 0 ? results[2][0] : null;

        if (!profile) {
            return res.status(404).json({ error: 'Player not found' });
        }

        res.json({
            success: true,
            dashboard: {
                profile,
                leaderboardRank: rankResult ? rankResult.player_rank : null,
                recentMatches
            }
        });
    } catch (error) {
        console.error('Error fetching player dashboard:', error);
        res.status(500).json({ error: 'Failed to fetch player dashboard' });
    } finally {
        if (connection) connection.release();
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
    socket.on('joinRoom', async ({ roomId, playerId }) => {
        try {
            // First check if game is in cache (for active games)
            if (activeGames[roomId]) {
                const gameState = activeGames[roomId];
                
                // Validate player is in the room
                const playerInRoom = gameState.players.find(player => player.id === playerId);
                if (!playerInRoom) {
                    socket.emit('error', { message: 'Player not in this room' });
                    return;
                }
                
                // Join the socket.io room
                socket.join(roomId);
                socket.playerId = playerId;
                socket.roomId = roomId;
                
                console.log(`Player ${playerId} joined socket room ${roomId} (from cache)`);
                
                // Send current room state to the joining player
                const roomState = getRoomStateForClient(gameState, roomId);
                socket.emit('gameUpdate', roomState);
                
                // Notify other players in the room
                socket.to(roomId).emit('playerConnected', { playerId });
                return;
            }
            
            // If not in cache, validate room exists in database
            const [gameRows] = await dbPool.execute(
                'SELECT room_code, status, game_state FROM games WHERE room_code = ?',
                [roomId]
            );
            
            if (gameRows.length === 0) {
                socket.emit('error', { message: 'Room not found' });
                return;
            }
            
            const gameData = gameRows[0];
            const gameState = gameData.game_state; // MySQL automatically parses JSON columns
            
            // Validate player is in the room
            const playerInRoom = gameState.players.find(player => player.id === playerId);
            if (!playerInRoom) {
                socket.emit('error', { message: 'Player not in this room' });
                return;
            }
            
            // Join the socket.io room
            socket.join(roomId);
            socket.playerId = playerId;
            socket.roomId = roomId;
            
            console.log(`Player ${playerId} joined socket room ${roomId} (from database)`);
            
            // Send current room state to the joining player
            const roomState = getRoomStateForClient(gameState, roomId);
            socket.emit('gameUpdate', roomState);
            
            // Notify other players in the room
            socket.to(roomId).emit('playerConnected', { playerId });
            
        } catch (error) {
            console.error('Error in joinRoom:', error);
            socket.emit('error', { message: 'Failed to join room' });
        }
    });
    
    // Update player avatar in lobby
    socket.on('updatePlayerAvatar', async ({ roomId, playerId, avatar }) => {
        let connection;
        try {
            // Start database transaction
            connection = await dbPool.getConnection();
            await connection.beginTransaction();
            
            // Fetch game from database
            const [gameRows] = await connection.execute(
                'SELECT id, room_code, status, game_state FROM games WHERE room_code = ?',
                [roomId]
            );
            
            if (gameRows.length === 0) {
                await connection.rollback();
                socket.emit('error', { message: 'Room not found' });
                return;
            }
            
            const gameData = gameRows[0];
            const gameState = gameData.game_state; // MySQL automatically parses JSON columns
            
            // Validate player is in the room
            const playerInRoom = gameState.players.find(player => player.id === playerId);
            if (!playerInRoom) {
                await connection.rollback();
                socket.emit('error', { message: 'Player not in this room' });
                return;
            }
            
            // Update the player's avatar in the game state
            playerInRoom.avatar = avatar;
            
            // Update game state in database
            await connection.execute(
                'UPDATE games SET game_state = ? WHERE id = ?',
                [JSON.stringify(gameState), gameData.id]
            );
            
            // Commit transaction
            await connection.commit();
            
            console.log(`Player ${playerId} updated avatar in room ${roomId}`);
            
            // Send updated room state to all players in the room
            const roomState = getRoomStateForClient(gameState, roomId);
            io.to(roomId).emit('gameUpdate', roomState);
            
        } catch (error) {
            if (connection) {
                await connection.rollback();
            }
            console.error('Error in updatePlayerAvatar:', error);
            socket.emit('error', { message: 'Failed to update avatar' });
        } finally {
            if (connection) {
                connection.release();
            }
        }
    });
      // Start the game (only host can do this)
    socket.on('startGame', async ({ roomId }) => {
        let connection;
        try {
            console.log(`StartGame event received for room ${roomId} from socket ${socket.id}`);
            
            // Validate input
            if (!roomId) {
                socket.emit('error', { message: 'Room ID is required' });
                return;
            }
            
            // Start database transaction
            connection = await dbPool.getConnection();
            await connection.beginTransaction();
            
            // Fetch game data from database
            const [gameRows] = await connection.execute(
                'SELECT id, room_code, status, game_state FROM games WHERE room_code = ?',
                [roomId]
            );
            
            if (gameRows.length === 0) {
                await connection.rollback();
                socket.emit('error', { message: 'Room not found' });
                return;
            }
            
            const gameData = gameRows[0];
            const lobbyState = gameData.game_state; // This contains the lobby/waiting room state
            
            // Validate that socket player is in the room
            if (!socket.playerId) {
                await connection.rollback();
                socket.emit('error', { message: 'Player not identified' });
                return;
            }
            
            // Check if player is the host
            if (lobbyState.host !== socket.playerId) {
                await connection.rollback();
                socket.emit('error', { message: 'Only the host can start the game' });
                return;
            }
            
            // Validate number of participants in database
            const [participantCountRows] = await connection.execute(
                'SELECT COUNT(*) as count FROM game_participants WHERE game_id = ?',
                [gameData.id]
            );
            
            const participantCount = participantCountRows[0].count;
            if (participantCount < 2) {
                await connection.rollback();
                socket.emit('error', { message: 'Need at least 2 players to start the game' });
                return;
            }
            
            // Check if game has already started
            if (gameData.status !== 'waiting') {
                await connection.rollback();
                socket.emit('error', { message: 'Game has already started or completed' });
                return;
            }
            
            // Extract player IDs from the lobby state
            const playerIds = lobbyState.players.map(player => player.id);
            console.log(`Starting game with players: ${playerIds.join(', ')}`);
            
            // Call GameEngine to create the official game state
            const gameState = GameEngine.createGameState(playerIds);
            
            // Store the complete game state in the cache for fast access
            activeGames[roomId] = gameState;
            
            // Update the database with the new game state and status
            await connection.execute(
                'UPDATE games SET status = ?, game_state = ? WHERE id = ?',
                ['in_progress', JSON.stringify(gameState), gameData.id]
            );
            
            // Commit transaction
            await connection.commit();
            
            console.log(`Game officially started in room ${roomId} with ${playerIds.length} players`);
            console.log(`Current player: ${gameState.players[gameState.currentPlayerIndex].id}`);
            
            // Broadcast gameUpdate to all clients in the room
            const roomStateForClients = getRoomStateForClient(gameState, roomId);
            io.to(roomId).emit('gameUpdate', roomStateForClients);
            
            // Also send a specific gameStarted event
            io.to(roomId).emit('gameStarted', { 
                message: 'Game has started! Cards have been dealt.',
                currentPlayer: gameState.players[gameState.currentPlayerIndex].id,
                topCard: gameState.discardPile[gameState.discardPile.length - 1]
            });
            
            console.log(`Game update broadcasted to all clients in room ${roomId}`);
            
        } catch (error) {
            if (connection) {
                await connection.rollback();
            }
            console.error('Error starting game:', error);
            socket.emit('error', { message: 'Failed to start game: ' + error.message });
        } finally {
            if (connection) {
                connection.release();
            }
        }
    });
    
    // Handle card play
    socket.on('playCard', async ({ roomId, playerId, card, chosenColor }) => {
        try {
            // Get current game state from cache
            const gameState = activeGames[roomId];
            
            if (!gameState) {
                socket.emit('error', { message: 'Game not found in cache' });
                return;
            }
            
            // Validate player
            if (playerId !== socket.playerId) {
                socket.emit('error', { message: 'Invalid player ID' });
                return;
            }
            
            // Use GameEngine to validate and process the move
            const result = GameEngine.playCard(gameState, playerId, card, chosenColor);
            
            if (result.error) {
                socket.emit('error', { message: result.error });
                return;
            }
            
            // Update the cache immediately
            activeGames[roomId] = result;
            
            console.log(`Player ${playerId} played card: ${card.color} ${card.value}`);
            
            // Log card_played event for audit trail
            logGameEvent(roomId, playerId, 'card_played', {
                card: card,
                chosenColor: chosenColor || null
            });
            
            // Check if game is over
            if (result.isGameOver) {
                console.log(`Game over! Winner: ${result.winner}`);
                
                // Finalize game using stored procedure (fixes double-counting bug)
                finalizeGame(roomId, result.winner, result.players).catch(error => {
                    console.error('Error finalizing game:', error);
                });
                
                // Get room info for originalHost
                let originalHost = null;
                try {
                    const connection = await dbPool.getConnection();
                    const [gameRows] = await connection.execute(
                        'SELECT host_id FROM games WHERE room_code = ?',
                        [roomId]
                    );
                    if (gameRows.length > 0) {
                        // Get the username from the host_id
                        const [hostRows] = await connection.execute(
                            'SELECT username FROM users WHERE id = ?',
                            [gameRows[0].host_id]
                        );
                        if (hostRows.length > 0) {
                            originalHost = hostRows[0].username;
                        }
                    }
                    connection.release();
                } catch (error) {
                    console.error('Error getting room info:', error);
                }
                
                // Remove from cache when game ends
                delete activeGames[roomId];
                io.to(roomId).emit('gameOver', { 
                    winnerId: result.winner,
                    message: `${result.winner} wins the game!`,
                    originalHost: originalHost
                });
            }
            
            // Broadcast updated game state to all players immediately
            const roomState = getRoomStateForClient(result, roomId);
            io.to(roomId).emit('gameUpdate', roomState);
            
            // Asynchronously update database (write-behind cache)
            updateGameStateInDB(roomId, result).catch(error => {
                console.error('Error updating database:', error);
            });
            
        } catch (error) {
            console.error('Error playing card:', error);
            socket.emit('error', { message: 'Failed to play card' });
        }
    });
    
    // Handle card draw
    socket.on('drawCard', async ({ roomId, playerId }) => {
        try {
            // Get current game state from cache
            const gameState = activeGames[roomId];
            
            if (!gameState) {
                socket.emit('error', { message: 'Game not found in cache' });
                return;
            }
            
            // Validate player
            if (playerId !== socket.playerId) {
                socket.emit('error', { message: 'Invalid player ID' });
                return;
            }
            
            // Use GameEngine to process the draw
            const result = GameEngine.drawCard(gameState, playerId);
            
            if (result.error) {
                socket.emit('error', { message: result.error });
                return;
            }
            
            // Update the cache immediately
            activeGames[roomId] = result;
            
            console.log(`Player ${playerId} drew a card`);
            
            // Broadcast updated game state to all players immediately
            const roomState = getRoomStateForClient(result, roomId);
            io.to(roomId).emit('gameUpdate', roomState);
            
            // Asynchronously update database (write-behind cache)
            updateGameStateInDB(roomId, result).catch(error => {
                console.error('Error updating database:', error);
            });
            
        } catch (error) {
            console.error('Error drawing card:', error);
            socket.emit('error', { message: 'Failed to draw card' });
        }
    });
    
    // Handle playing a drawn card (from limbo state)
    socket.on('playDrawnCard', async ({ roomId, playerId, chosenColor }) => {
        try {
            // Get current game state from cache
            const gameState = activeGames[roomId];
            
            if (!gameState) {
                socket.emit('error', { message: 'Game not found in cache' });
                return;
            }
            
            // Validate player
            if (playerId !== socket.playerId) {
                socket.emit('error', { message: 'Invalid player ID' });
                return;
            }
            
            // Use GameEngine to process playing the drawn card
            const result = GameEngine.playDrawnCard(gameState, playerId, chosenColor);
            
            if (result.error) {
                socket.emit('error', { message: result.error });
                return;
            }
            
            // Update the cache immediately
            activeGames[roomId] = result;
            
            console.log(`Player ${playerId} played their drawn card`);
            
            // Log drawn_card_played event for audit trail
            logGameEvent(roomId, playerId, 'drawn_card_played', {
                chosenColor: chosenColor || null
            });
            
            // Check if game is over
            if (result.isGameOver) {
                console.log(`Game over! Winner: ${result.winner}`);
                
                // Finalize game using stored procedure (fixes double-counting bug)
                finalizeGame(roomId, result.winner, result.players).catch(error => {
                    console.error('Error finalizing game:', error);
                });
                
                // Get room info for originalHost
                let originalHost = null;
                try {
                    const connection = await dbPool.getConnection();
                    const [gameRows] = await connection.execute(
                        'SELECT host_id FROM games WHERE room_code = ?',
                        [roomId]
                    );
                    if (gameRows.length > 0) {
                        // Get the username from the host_id
                        const [hostRows] = await connection.execute(
                            'SELECT username FROM users WHERE id = ?',
                            [gameRows[0].host_id]
                        );
                        if (hostRows.length > 0) {
                            originalHost = hostRows[0].username;
                        }
                    }
                    connection.release();
                } catch (error) {
                    console.error('Error getting room info:', error);
                }
                
                // Remove from cache when game ends
                delete activeGames[roomId];
                io.to(roomId).emit('gameOver', { 
                    winnerId: result.winner,
                    message: `${result.winner} wins the game!`,
                    originalHost: originalHost
                });
            }
            
            // Broadcast updated game state to all players immediately
            const roomState = getRoomStateForClient(result, roomId);
            io.to(roomId).emit('gameUpdate', roomState);
            
            // Asynchronously update database (write-behind cache)
            updateGameStateInDB(roomId, result).catch(error => {
                console.error('Error updating database:', error);
            });
            
        } catch (error) {
            console.error('Error playing drawn card:', error);
            socket.emit('error', { message: 'Failed to play drawn card' });
        }
    });
    
    // Handle passing on a drawn card (from limbo state)
    socket.on('passDrawnCard', async ({ roomId, playerId }) => {
        try {
            // Get current game state from cache
            const gameState = activeGames[roomId];
            
            if (!gameState) {
                socket.emit('error', { message: 'Game not found in cache' });
                return;
            }
            
            // Validate player
            if (playerId !== socket.playerId) {
                socket.emit('error', { message: 'Invalid player ID' });
                return;
            }
            
            // Use GameEngine to process passing the drawn card
            const result = GameEngine.passDrawnCard(gameState, playerId);
            
            if (result.error) {
                socket.emit('error', { message: result.error });
                return;
            }
            
            // Update the cache immediately
            activeGames[roomId] = result;
            
            console.log(`Player ${playerId} passed on their drawn card`);
            
            // Broadcast updated game state to all players immediately
            const roomState = getRoomStateForClient(result, roomId);
            io.to(roomId).emit('gameUpdate', roomState);
            
            // Asynchronously update database (write-behind cache)
            updateGameStateInDB(roomId, result).catch(error => {
                console.error('Error updating database:', error);
            });
            
        } catch (error) {
            console.error('Error passing drawn card:', error);
            socket.emit('error', { message: 'Failed to pass drawn card' });
        }
    });
    
    // Handle UNO call penalty (calling UNO on another player)
    socket.on('player:callUno', async ({ roomId, targetPlayerId }) => {
        try {
            // Get current game state from cache
            const gameState = activeGames[roomId];
            
            if (!gameState) {
                socket.emit('error', { message: 'Game not found in cache' });
                return;
            }
            
            // Validate that the caller is in the game
            if (!socket.playerId) {
                socket.emit('error', { message: 'Player not identified' });
                return;
            }
            
            // Validate that the target player exists in the game
            const targetPlayer = gameState.players.find(p => p.id === targetPlayerId);
            if (!targetPlayer) {
                socket.emit('error', { message: 'Target player not found in game' });
                return;
            }
            
            // Use GameEngine to apply the UNO penalty with race condition protection
            const result = GameEngine.callUnoPenalty(gameState, targetPlayerId, socket.playerId);
            
            // Check if the call was successful
            if (result.error || result.success === false) {
                // Call was invalid - send feedback but don't update state
                socket.emit('unoCallResult', {
                    caller: socket.playerId,
                    target: targetPlayerId,
                    success: false,
                    message: result.error || 'UNO call was invalid'
                });
                return;
            }
            
            // Update the cache immediately
            activeGames[roomId] = result;
            
            console.log(`Player ${socket.playerId} successfully called UNO on ${targetPlayerId}`);
            
            // Broadcast updated game state to all players immediately
            const roomState = getRoomStateForClient(result, roomId);
            io.to(roomId).emit('gameUpdate', roomState);
            
            // Send success feedback to all players
            io.to(roomId).emit('unoCallResult', {
                caller: socket.playerId,
                target: targetPlayerId,
                success: true,
                message: `${socket.playerId} called UNO on ${targetPlayerId}! ${targetPlayerId} draws 2 penalty cards.`
            });
            
            // Asynchronously update database (write-behind cache)
            updateGameStateInDB(roomId, result).catch(error => {
                console.error('Error updating database:', error);
            });
            
        } catch (error) {
            console.error('Error handling UNO call:', error);
            socket.emit('error', { message: 'Failed to process UNO call' });
        }
    });
    
    // Handle self-UNO declaration (player calling UNO on themselves)
    socket.on('player:callUnoSelf', async ({ roomId }) => {
        try {
            // Get current game state from cache
            const gameState = activeGames[roomId];
            
            if (!gameState) {
                socket.emit('error', { message: 'Game not found in cache' });
                return;
            }
            
            // Validate that the caller is in the game
            if (!socket.playerId) {
                socket.emit('error', { message: 'Player not identified' });
                return;
            }
            
            // Use GameEngine to handle self-UNO call
            const result = GameEngine.callUnoSelf(gameState, socket.playerId);
            
            // Check if the call was successful
            if (result.error) {
                // Call was invalid
                socket.emit('unoSelfResult', {
                    player: socket.playerId,
                    success: false,
                    message: result.error
                });
                return;
            }
            
            // Update the cache immediately
            activeGames[roomId] = result;
            
            console.log(`Player ${socket.playerId} called UNO on themselves (self-declaration)`);
            
            // Broadcast updated game state to all players immediately
            const roomState = getRoomStateForClient(result, roomId);
            io.to(roomId).emit('gameUpdate', roomState);
            
            // Send success feedback to all players
            io.to(roomId).emit('unoSelfResult', {
                player: socket.playerId,
                success: true,
                message: `${socket.playerId} called UNO! They are now safe from penalty.`
            });
            
            // Asynchronously update database (write-behind cache)
            updateGameStateInDB(roomId, result).catch(error => {
                console.error('Error updating database:', error);
            });
            
        } catch (error) {
            console.error('Error handling self-UNO call:', error);
            socket.emit('error', { message: 'Failed to process self-UNO call' });
        }
    });
    
    // Handle intentional player leaving
    socket.on('leaveRoom', ({ roomId, playerId, reason }) => {
        try {
            console.log(`Player ${playerId} attempting to leave room ${roomId} (reason: ${reason})`);
            
            // More resilient validation - don't error if socket context is missing
            if (!socket.roomId || !socket.playerId) {
                console.log(`Socket ${socket.id} attempted leave but has no context - probably already left`);
                
                // Just clean up any remaining state
                socket.leave(roomId);
                socket.roomId = null;
                socket.playerId = null;
                return;
            }
            
            // Validate player matches socket context
            if (playerId !== socket.playerId || roomId !== socket.roomId) {
                socket.emit('error', { code: 'INVALID_LEAVE', message: 'Invalid leave request' });
                return;
            }
            
            // Remove socket from room first
            socket.leave(roomId);
            console.log(`Socket ${socket.id} left room ${roomId} (intentional leave)`);
            
            // Clear socket room/player tracking
            const oldRoomId = socket.roomId;
            const oldPlayerId = socket.playerId;
            socket.roomId = null;
            socket.playerId = null;
            
            // Use the same disconnect handling logic
            handlePlayerDisconnect(oldRoomId, oldPlayerId, socket, 'intentional_leave');
            
        } catch (error) {
            console.error('Error handling leave room:', error);
            socket.emit('error', { code: 'LEAVE_ERROR', message: 'Failed to leave room' });
        }
    });
    
    // Handle player disconnect
    socket.on('disconnect', () => {
        console.log(`Socket disconnected: ${socket.id}, Player: ${socket.playerId}, Room: ${socket.roomId}`);
        
        if (socket.roomId && socket.playerId) {
            // Leave the socket room before processing disconnect
            socket.leave(socket.roomId);
            console.log(`Socket ${socket.id} left room ${socket.roomId}`);
            
            // Process the disconnect
            handlePlayerDisconnect(socket.roomId, socket.playerId, socket);
        }
    });
    
    // Handle game restart (only host can do this)
    socket.on('restartGame', async ({ roomId }) => {
        let connection;
        try {
            console.log(`Restart game request received for room ${roomId} from socket ${socket.id}`);
            
            // Validate input
            if (!roomId) {
                socket.emit('error', { message: 'Room ID is required' });
                return;
            }
            
            // Validate that the caller is in the game
            if (!socket.playerId) {
                socket.emit('error', { message: 'Player not identified' });
                return;
            }
            
            // Start database transaction
            connection = await dbPool.getConnection();
            await connection.beginTransaction();
            
            // Fetch game data from database
            const [gameRows] = await connection.execute(
                'SELECT id, room_code, host_id, status, game_state FROM games WHERE room_code = ?',
                [roomId]
            );
            
            if (gameRows.length === 0) {
                await connection.rollback();
                socket.emit('error', { message: 'Room not found' });
                return;
            }
            
            const gameData = gameRows[0];
            const currentGameState = gameData.game_state;
            
            // Check if the requesting player is the original host
            const [hostRows] = await connection.execute(
                'SELECT username FROM users WHERE id = ?',
                [gameData.host_id]
            );
            
            if (hostRows.length === 0) {
                await connection.rollback();
                socket.emit('error', { message: 'Original host not found' });
                return;
            }
            
            const originalHost = hostRows[0].username;
            
            if (originalHost !== socket.playerId) {
                await connection.rollback();
                socket.emit('error', { message: 'Only the original room host can restart the game' });
                return;
            }
            
            // Check if game is actually over
            if (gameData.status !== 'completed' && !currentGameState.isGameOver) {
                await connection.rollback();
                socket.emit('error', { message: 'Can only restart completed games' });
                return;
            }
            
            // Get all players who were in the game (from game_participants table)
            const [participantRows] = await connection.execute(
                `SELECT u.username, u.full_name, u.avatar_url 
                 FROM game_participants gp 
                 JOIN users u ON gp.user_id = u.id 
                 WHERE gp.game_id = ? 
                 ORDER BY gp.joined_at`,
                [gameData.id]
            );
            
            if (participantRows.length < 2) {
                await connection.rollback();
                socket.emit('error', { message: 'Need at least 2 original players to restart' });
                return;
            }
            
            // Create new lobby state with NO players initially (host must also choose)
            const newLobbyState = {
                status: 'waiting',
                host: originalHost,
                players: [], // 👈 host is not auto-added
                playerCount: 0,
                maxPlayers: currentGameState.maxPlayers || 4,
                canStart: false,
                createdAt: new Date().toISOString(),
                originalHost: originalHost, // Track who can restart
                restartData: {
                    originalPlayers: participantRows.map(row => ({
                        id: row.username,
                        name: row.full_name,
                        avatar: row.avatar_url
                    })),
                    awaitingResponse: participantRows.map(row => row.username) // 👈 host included here
                }
            };
            
            // Update the game record to reset to waiting status
            await connection.execute(
                'UPDATE games SET status = ?, game_state = ?, winner_id = NULL WHERE id = ?',
                ['waiting', JSON.stringify(newLobbyState), gameData.id]
            );
            
            // Remove from active games cache if it was there
            if (activeGames[roomId]) {
                delete activeGames[roomId];
            }
            
            // Commit transaction
            await connection.commit();
            
            console.log(`Game ${roomId} restarted successfully by ${originalHost}`);
            
            // Get all sockets in the room to verify who will receive the broadcast
            const socketsInRoom = await io.in(roomId).fetchSockets();
            console.log(`Sockets in room ${roomId}:`, socketsInRoom.map(s => s.playerId || 'unknown'));
            
            // Send restart notification to ALL players (including host) for choice dialog
            const roomStateForClients = getRoomStateForClient(newLobbyState, roomId);
            io.to(roomId).emit('gameRestarted', {
                message: `${originalHost} has restarted the game! Choose to join or leave:`,
                newGameState: roomStateForClients
            });
            
            console.log(`Restart broadcasted to all clients in room ${roomId}`);
            console.log(`New lobby state:`, JSON.stringify(roomStateForClients, null, 2));
            
        } catch (error) {
            if (connection) {
                await connection.rollback();
            }
            console.error('Error restarting game:', error);
            socket.emit('error', { message: 'Failed to restart game: ' + error.message });
        } finally {
            if (connection) {
                connection.release();
            }
        }
    });
    
    // Unified handler for restart responses (replaces acceptRestart and declineRestart)
    socket.on('respondToRestart', async ({ roomId, didAccept }) => {
        let connection;
        try {
            console.log(`Player ${socket.playerId} responded to restart for room ${roomId}: ${didAccept ? 'ACCEPTED' : 'DECLINED'}`);
            
            if (!roomId || !socket.playerId) {
                socket.emit('error', { code: 'INVALID_REQUEST', message: 'Invalid restart response request' });
                return;
            }
            
            // Get current game state from database
            connection = await dbPool.getConnection();
            await connection.beginTransaction();
            
            const [gameRows] = await connection.execute(
                'SELECT id, game_state FROM games WHERE room_code = ? AND status = ?',
                [roomId, 'waiting']
            );
            
            if (gameRows.length === 0) {
                await connection.rollback();
                connection.release();
                console.log(`Room ${roomId} not found or not in waiting state - player ${socket.playerId} leaving normally`);
                
                // Just remove from socket room and clear state
                socket.leave(roomId);
                socket.roomId = null;
                socket.playerId = null;
                
                return;
            }
            
            const gameData = gameRows[0];
            const gameState = gameData.game_state; // MySQL automatically parses JSON columns
            
            // Validate player is in the original players list
            const originalPlayer = gameState.restartData?.originalPlayers?.find(p => p.id === socket.playerId);
            if (!originalPlayer) {
                await connection.rollback();
                connection.release();
                socket.emit('error', { code: 'INVALID_PLAYER', message: 'You are not part of this restart' });
                return;
            }
            
            // Remove player from awaiting response regardless of choice
            if (gameState.restartData.awaitingResponse) {
                gameState.restartData.awaitingResponse = gameState.restartData.awaitingResponse.filter(
                    playerId => playerId !== socket.playerId
                );
            }
            
            if (didAccept) {
                // ✅ PLAYER ACCEPTED - Add to lobby
                console.log(`Adding ${socket.playerId} to lobby`);
                
                // Add player to the lobby
                gameState.players.push({
                    id: originalPlayer.id,
                    name: originalPlayer.name,
                    avatar: originalPlayer.avatar,
                    hand: []
                });
                
                gameState.playerCount = gameState.players.length;
                gameState.canStart = gameState.playerCount >= 2;
                
                // Update database
                await connection.execute(
                    'UPDATE games SET game_state = ? WHERE id = ?',
                    [JSON.stringify(gameState), gameData.id]
                );
                
                await connection.commit();
                connection.release();
                
                // Broadcast that player joined
                const roomStateForClients = getRoomStateForClient(gameState, roomId);
                io.to(roomId).emit('playerJoinedLobby', {
                    playerId: socket.playerId,
                    playerName: originalPlayer.name,
                    message: `${originalPlayer.name} joined the lobby!`
                });
                
                // Send updated game state to all players
                io.to(roomId).emit('gameUpdate', roomStateForClients);
                
                console.log(`Player ${socket.playerId} successfully joined restart lobby for room ${roomId}`);
                
            } else {
                // ❌ PLAYER DECLINED - Remove from game
                console.log(`Removing ${socket.playerId} from game`);
                
                // Adjust maxPlayers if needed
                if (gameState.playerCount < gameState.maxPlayers) {
                    gameState.maxPlayers = Math.max(2, gameState.players.length);
                }
                
                // Update canStart status
                gameState.canStart = gameState.players.length >= 2;
                
                // Remove player from game_participants table
                const [userRows] = await connection.execute(
                    'SELECT id FROM users WHERE username = ?',
                    [socket.playerId]
                );
                
                if (userRows.length > 0) {
                    await connection.execute(
                        'DELETE FROM game_participants WHERE game_id = ? AND user_id = ?',
                        [gameData.id, userRows[0].id]
                    );
                }
                
                // Update game state in database
                await connection.execute(
                    'UPDATE games SET game_state = ? WHERE id = ?',
                    [JSON.stringify(gameState), gameData.id]
                );
                
                await connection.commit();
                connection.release();
                
                // Remove player from socket room and clear state
                socket.leave(roomId);
                socket.roomId = null;
                socket.playerId = null;
                
                // Broadcast that player left
                io.to(roomId).emit('playerLeftLobby', {
                    playerId: socket.playerId,
                    message: `${originalPlayer.name} declined the restart and left the room`,
                    newMaxPlayers: gameState.maxPlayers
                });
                
                // Send updated room state to remaining players
                if (gameState.players.length > 0) {
                    const roomStateForClients = getRoomStateForClient(gameState, roomId);
                    io.to(roomId).emit('gameUpdate', roomStateForClients);
                }
                
                console.log(`Player ${socket.playerId} declined restart and was removed from room ${roomId}`);
                console.log(`Room ${roomId} now has ${gameState.playerCount} players (max: ${gameState.maxPlayers})`);
            }
            
        } catch (error) {
            if (connection) {
                await connection.rollback();
                connection.release();
            }
            console.error('Error handling restart response:', error);
            socket.emit('error', { code: 'RESTART_ERROR', message: 'Failed to process restart response: ' + error.message });
        }
    });
    
    // ...existing code...
});

// ============================================================================
// GAME MANAGEMENT UTILITY FUNCTIONS
// ============================================================================

/**
 * Asynchronously updates the game state in the database (write-behind cache)
 * @param {string} roomId - The room ID (room_code)
 * @param {Object} gameState - The current game state from cache
 */
async function updateGameStateInDB(roomId, gameState) {
    let connection;
    try {
        connection = await dbPool.getConnection();
        
        const status = gameState.isGameOver ? 'completed' : 'in_progress';
        
        // If game is over, get winner's user ID and set completion timestamps
        let winnerId = null;
        if (gameState.isGameOver && gameState.winner) {
            winnerId = await getUserId(gameState.winner);
            
            // Set completed_at and duration_seconds for completed games
            await connection.execute(
                `UPDATE games SET status = ?, game_state = ?, winner_id = ?, 
                 completed_at = NOW(), 
                 duration_seconds = TIMESTAMPDIFF(SECOND, created_at, NOW()) 
                 WHERE room_code = ?`,
                [status, JSON.stringify(gameState), winnerId, roomId]
            );
        } else {
            await connection.execute(
                'UPDATE games SET status = ?, game_state = ?, winner_id = ? WHERE room_code = ?',
                [status, JSON.stringify(gameState), winnerId, roomId]
            );
        }
        
        console.log(`Database updated for room ${roomId} (status: ${status}${winnerId ? `, winner: ${gameState.winner}` : ''})`);
        
    } catch (error) {
        console.error(`Error updating database for room ${roomId}:`, error);
    } finally {
        if (connection) {
            connection.release();
        }
    }
}

/**
 * Handles player disconnection with comprehensive game state management
 * - Removes players from waiting rooms
 * - Marks players as inactive in active games
 * - Handles host transfers and room cleanup
 * - Ends games when insufficient active players remain
 * 
 * @param {string} roomId - The room ID (room_code) the player was in
 * @param {string} playerId - The ID of the disconnected player
 * @param {Object} socket - The socket object for broadcasting
 * @param {string} reason - The reason for disconnection ('disconnect' or 'intentional_leave')
 */
async function handlePlayerDisconnect(roomId, playerId, socket, reason = 'disconnect') {
    let connection;
    try {
        // Start database transaction
        connection = await dbPool.getConnection();
        await connection.beginTransaction();
        
        // Fetch game from database
        const [gameRows] = await connection.execute(
            'SELECT id, room_code, status, game_state FROM games WHERE room_code = ?',
            [roomId]
        );
        
        if (gameRows.length === 0) {
            await connection.rollback();
            console.log(`Room ${roomId} not found during disconnect`);
            return;
        }
        
        const gameData = gameRows[0];
        const gameState = gameData.game_state; // MySQL automatically parses JSON columns
        
        const isIntentionalLeave = reason === 'intentional_leave';
        console.log(`Player ${playerId} ${isIntentionalLeave ? 'left' : 'disconnected from'} room ${roomId}`);
        
        if (gameData.status === 'waiting') {
            // Game hasn't started - remove player from waiting room
            console.log(`Processing disconnect from waiting room. Current players: ${gameState.players.map(p => p.id).join(', ')}`);
            
            // Check if player is actually in the room
            const playerExists = gameState.players.find(player => player.id === playerId);
            if (!playerExists) {
                // Player not in game state, but let's still check database and clean up if needed
                const [userRows] = await connection.execute(
                    'SELECT id FROM users WHERE username = ?',
                    [playerId]
                );
                
                if (userRows.length > 0) {
                    const userId = userRows[0].id;
                    const [deleteResult] = await connection.execute(
                        'DELETE FROM game_participants WHERE game_id = ? AND user_id = ?',
                        [gameData.id, userId]
                    );
                    
                    if (deleteResult.affectedRows > 0) {
                        console.log(`Cleaned up orphaned database entry for player ${playerId} during disconnect`);
                        await connection.commit();
                    } else {
                        await connection.rollback();
                    }
                } else {
                    await connection.rollback();
                }
                
                console.log(`Player ${playerId} not found in room ${roomId} during disconnect`);
                return;
            }
            
            // Remove player from game state
            const originalPlayerCount = gameState.players.length;
            gameState.players = gameState.players.filter(player => player.id !== playerId);
            const newPlayerCount = gameState.players.length;
            
            // Verify player was actually removed
            if (originalPlayerCount === newPlayerCount) {
                await connection.rollback();
                console.error(`Failed to remove player ${playerId} from room ${roomId} game state`);
                return;
            }
            
            console.log(`Removed player ${playerId} from room ${roomId}. Players remaining: ${gameState.players.map(p => p.id).join(', ')}`);
            
            // Remove from game_participants table in database
            const [userRows] = await connection.execute(
                'SELECT id FROM users WHERE username = ?',
                [playerId]
            );
            
            if (userRows.length === 0) {
                console.error(`User ${playerId} not found in database during disconnect`);
                await connection.rollback();
                return;
            }
            
            const userId = userRows[0].id;
            const [deleteResult] = await connection.execute(
                'DELETE FROM game_participants WHERE game_id = ? AND user_id = ?',
                [gameData.id, userId]
            );
            
            if (deleteResult.affectedRows === 0) {
                console.warn(`Player ${playerId} was not in game_participants table for game ${gameData.id}`);
            } else {
                console.log(`Removed player ${playerId} (user_id: ${userId}) from game_participants table`);
            }
            
            // Handle host reassignment if needed
            let newHost = null;
            if (gameState.host === playerId && gameState.players.length > 0) {
                newHost = gameState.players[0].id;
                gameState.host = newHost;
                console.log(`Host ${playerId} disconnected. New host assigned: ${newHost}`);
            }
            
            // If no players left, delete the entire room
            if (gameState.players.length === 0) {
                // Delete all related data
                await connection.execute('DELETE FROM game_participants WHERE game_id = ?', [gameData.id]);
                await connection.execute('DELETE FROM games WHERE id = ?', [gameData.id]);
                await connection.commit();
                console.log(`Room ${roomId} completely deleted - no players remaining`);
                return;
            }
            
            // Update game state in database
            await connection.execute(
                'UPDATE games SET game_state = ? WHERE id = ?',
                [JSON.stringify(gameState), gameData.id]
            );
            
            // Commit all database changes
            await connection.commit();
            console.log(`Database updated for room ${roomId} after player ${playerId} disconnect`);
            
            // Broadcast updated room state to ALL players in the room (including the disconnecting player)
            const roomState = getRoomStateForClient(gameState, roomId);
            io.to(roomId).emit('gameUpdate', roomState);
            
            // Broadcast player disconnection message
            const disconnectMessage = isIntentionalLeave ? 
                `${playerId} has left the room` : 
                `${playerId} has disconnected`;
            
            io.to(roomId).emit('playerDisconnected', { 
                playerId,
                message: disconnectMessage,
                remainingPlayers: gameState.players.length
            });
            
            // If host changed, notify all players
            if (newHost) {
                io.to(roomId).emit('hostChanged', { 
                    newHost: newHost,
                    message: `${newHost} is now the host`
                });
            }
            
            console.log(`Successfully processed disconnect for player ${playerId} from waiting room ${roomId}`);
            
        } else if (gameData.status === 'in_progress' && activeGames[roomId]) {
            // Game is in progress - get from cache and mark player as inactive
            const gameState = activeGames[roomId];
            const playerIndex = gameState.players.findIndex(p => p.id === playerId);
            
            if (playerIndex !== -1) {
                // Mark player as inactive
                gameState.players[playerIndex].isActive = false;
                
                // Clear any limbo state if disconnected player was in limbo
                if (gameState.playableDrawnCard && gameState.playableDrawnCard.playerId === playerId) {
                    gameState.playableDrawnCard = null;
                }
                
                // If it was the disconnected player's turn, advance to next active player
                const wasCurrentPlayer = gameState.currentPlayerIndex === playerIndex;
                if (wasCurrentPlayer) {
                    const nextPlayerIndex = getNextActivePlayerIndex(gameState);
                    gameState.currentPlayerIndex = nextPlayerIndex;
                    
                    // Broadcast turn change to inform all players
                    socket.to(roomId).emit('turnChanged', {
                        currentPlayerIndex: nextPlayerIndex,
                        currentPlayerId: gameState.players[nextPlayerIndex]?.id,
                        reason: 'Player disconnected'
                    });
                }
                
                // Check if only one active player remains
                const activePlayers = gameState.players.filter(p => p.isActive !== false);
                if (activePlayers.length <= 1) {
                    // End the game - last active player wins
                    gameState.isGameOver = true;
                    gameState.winner = activePlayers.length === 1 ? activePlayers[0].id : null;
                    
                    // Remove from cache and update database with completed status
                    delete activeGames[roomId];
                    
                    // Get winner's user ID for database update
                    const winnerId = gameState.winner ? await getUserId(gameState.winner) : null;
                    
                    await connection.execute(
                        'UPDATE games SET status = ?, game_state = ?, winner_id = ?, completed_at = NOW(), duration_seconds = TIMESTAMPDIFF(SECOND, created_at, NOW()) WHERE id = ?',
                        ['completed', JSON.stringify(gameState), winnerId, gameData.id]
                    );
                    
                    // Finalize game using stored procedure (fixes double-counting bug)
                    finalizeGame(roomId, gameState.winner, gameState.players).catch(error => {
                        console.error('Error finalizing game after disconnect:', error);
                    });
                    
                    // Log disconnect event
                    logGameEvent(roomId, playerId, 'player_disconnected', {
                        gameEnded: true,
                        winner: gameState.winner
                    });
                    
                    socket.to(roomId).emit('gameOver', {
                        winnerId: gameState.winner,
                        reason: isIntentionalLeave ? 'Player forfeited' : 'Other players disconnected',
                        message: gameState.winner ? 
                            `🎉 ${gameState.winner} wins by default!` : 
                            'Game ended - all players have left',
                        originalHost: gameData.original_host
                    });
                } else {
                    // Update cache and asynchronously update database
                    activeGames[roomId] = gameState;
                    updateGameStateInDB(roomId, gameState).catch(error => {
                        console.error('Error updating database after disconnect:', error);
                    });
                }
                
                // Commit transaction
                await connection.commit();
                
                // Broadcast updated game state
                const roomState = getRoomStateForClient(gameState, roomId);
                socket.to(roomId).emit('gameUpdate', roomState);
                socket.to(roomId).emit('playerDisconnected', { 
                    playerId,
                    message: isIntentionalLeave ? 
                        `${playerId} has forfeited the game and will be skipped` : 
                        `${playerId} has disconnected and will be skipped`
                });
            } else {
                await connection.rollback();
            }
        } else {
            await connection.rollback();
        }
        
    } catch (error) {
        if (connection) {
            await connection.rollback();
        }
        console.error('Error handling player disconnect:', error);
    } finally {
        if (connection) {
            connection.release();
        }
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
 * @param {Object} gameState - Game state object (either lobby state or active game state)
 * @param {string} roomId - Room ID (room_code)
 * @returns {Object} Client-safe room state with basic player info
 */
function getRoomStateForClient(gameState, roomId) {
    /**
     * Helper function to enrich player data with basic info
     * @param {Object} player - Player object with at least an id
     * @returns {Object} Basic player object with { id, name, avatar, handSize?, isActive? }
     */
    function enrichPlayerData(player) {
        return {
            id: player.id,
            name: player.name || player.id, // Use player.name if available, fallback to id (username)
            avatar: player.avatar || 'public/assets/images/avatar/exported avatar/ava-1.svg', // Use player.avatar if available, fallback to default
            ...(player.hand !== undefined && { handSize: player.hand.length }),
            ...(player.isActive !== undefined && { isActive: player.isActive })
        };
    }
    // Check if this is a lobby/waiting state (has status property)
    if (gameState.status === 'waiting') {
        return {
            roomId: roomId,
            status: 'waiting',
            host: gameState.host,
            players: gameState.players.map(player => enrichPlayerData(player)),
            playerCount: gameState.players.length,
            maxPlayers: gameState.maxPlayers,
            canStart: gameState.players.length >= 2
        };
    }
    
    // Check if this is an active game state (has players, currentPlayerIndex, etc.)
    if (gameState.players && gameState.currentPlayerIndex !== undefined) {
        return {
            roomId: roomId,
            status: 'playing',
            players: gameState.players.map(player => enrichPlayerData(player)),
            currentPlayerIndex: gameState.currentPlayerIndex,
            currentPlayer: gameState.players[gameState.currentPlayerIndex]?.id,
            directionOfPlay: gameState.directionOfPlay,
            currentColor: gameState.currentColor,
            topCard: gameState.discardPile[gameState.discardPile.length - 1],
            drawPileSize: gameState.drawPile.length,
            isGameOver: gameState.isGameOver,
            winner: gameState.winner,
            playableDrawnCard: gameState.playableDrawnCard || null,
            unoPlayerId: gameState.unoPlayerId || null
        };
    }
    
    // Fallback for other states
    return {
        roomId: roomId,
        status: gameState.status || 'unknown',
        players: gameState.players ? gameState.players.map(player => enrichPlayerData(player)) : [],
        playerCount: gameState.players ? gameState.players.length : 0
    };
}

/**
 * [DEPRECATED — replaced by finalizeGame() which calls sp_finalize_game stored procedure]
 * The original updatePlayerStats() had a double-counting bug:
 * It incremented games_played for the winner TWICE — once in the winner UPDATE
 * and again in the bulk UPDATE for all players.
 *
 * The fix is in sp_finalize_game: it updates the winner's stats first,
 * then updates all OTHER participants (excluding the winner).
 */

/**
 * Finalizes a completed game by calling the sp_finalize_game stored procedure.
 * This atomically: updates game status, sets winner, timestamps, and player stats.
 * Fixes the double-counting bug from the old updatePlayerStats() function.
 * 
 * @param {string} roomCode - The room code of the game
 * @param {string} winnerUsername - The username of the winning player
 * @param {Array} players - Array of player objects from game state
 */
async function finalizeGame(roomCode, winnerUsername, players) {
    let connection;
    try {
        connection = await dbPool.getConnection();
        
        // Call stored procedure for atomic game finalization
        await connection.query(
            'CALL sp_finalize_game(?, ?)',
            [roomCode, winnerUsername || '']
        );
        
        console.log(`Game finalized via stored procedure for room ${roomCode} (winner: ${winnerUsername})`);
        
        // Populate match_results for per-player game stats
        await populateMatchResults(connection, roomCode, winnerUsername, players);
        
    } catch (error) {
        console.error('Error finalizing game:', error);
    } finally {
        if (connection) {
            connection.release();
        }
    }
}

/**
 * Populates the match_results table with per-player statistics for a completed game.
 * This is the denormalized summary table for fast leaderboard/history queries.
 * 
 * @param {Object} connection - Active database connection
 * @param {string} roomCode - The room code of the game
 * @param {string} winnerUsername - The username of the winning player
 * @param {Array} players - Array of player objects from game state
 */
async function populateMatchResults(connection, roomCode, winnerUsername, players) {
    try {
        // Get game ID from room code
        const [gameRows] = await connection.execute(
            'SELECT id FROM games WHERE room_code = ?',
            [roomCode]
        );
        
        if (gameRows.length === 0) return;
        
        const gameId = gameRows[0].id;
        
        // Insert match results for each player
        for (let i = 0; i < players.length; i++) {
            const player = players[i];
            const userId = await getUserId(player.id);
            if (!userId) continue;
            
            await connection.execute(
                `INSERT IGNORE INTO match_results 
                 (game_id, user_id, is_winner, final_hand_size, finish_position) 
                 VALUES (?, ?, ?, ?, ?)`,
                [
                    gameId,
                    userId,
                    player.id === winnerUsername ? 1 : 0,
                    player.hand ? player.hand.length : 0,
                    player.id === winnerUsername ? 1 : i + 1
                ]
            );
        }
        
        console.log(`Match results populated for room ${roomCode} (${players.length} players)`);
        
    } catch (error) {
        console.error('Error populating match results:', error);
    }
}

/**
 * Logs a game event to the game_events audit log table.
 * Fire-and-forget: errors are logged but do not interrupt gameplay.
 * 
 * @param {string} roomCode - The room code of the game
 * @param {string} username - The username of the player who performed the action
 * @param {string} eventType - The type of event (must match ENUM in game_events table)
 * @param {Object} eventData - Additional event data (stored as JSON)
 */
async function logGameEvent(roomCode, username, eventType, eventData = null) {
    try {
        // Get game ID and user ID
        const [gameRows] = await dbPool.execute(
            'SELECT id FROM games WHERE room_code = ? LIMIT 1',
            [roomCode]
        );
        
        if (gameRows.length === 0) return;
        
        const gameId = gameRows[0].id;
        const userId = username ? await getUserId(username) : null;
        
        await dbPool.execute(
            'INSERT INTO game_events (game_id, user_id, event_type, event_data) VALUES (?, ?, ?, ?)',
            [gameId, userId, eventType, eventData ? JSON.stringify(eventData) : null]
        );
        
    } catch (error) {
        // Fire-and-forget: don't interrupt gameplay for audit failures
        console.error(`Error logging game event (${eventType}):`, error.message);
    }
}

// Load active games into cache on server startup
loadActiveGamesIntoCache();

// Start the HTTP server
httpServer.listen(PORT, () => {
    console.log('='.repeat(80));
    console.log('🎮 UNO Backend server is running on port', PORT);
    console.log('📡 Server URL: http://localhost:' + PORT);
    console.log('🔌 WebSocket endpoint: ws://localhost:' + PORT);
    console.log('');
    console.log('🛠️  Available API endpoints:');
    console.log('  GET  /api/status                    - Server status');
    console.log('  POST /api/auth/register             - Register new user account');
    console.log('  POST /api/auth/login                - Login user account');
    console.log('  GET  /api/rooms                     - List all active rooms');
    console.log('  POST /api/rooms/create              - Create new game room');
    console.log('  POST /api/rooms/:roomId/join        - Join existing room');
    console.log('  GET  /api/rooms/:roomId             - Get room state');
    console.log('  GET  /api/rooms/:roomId/hand/:playerId - Get player hand');
    console.log('  GET  /api/leaderboard               - Player leaderboard (v_leaderboard view)');
    console.log('  GET  /api/users/:username/stats     - Player statistics (v_player_stats view)');
    console.log('  GET  /api/users/:username/history   - Match history (v_match_history view)');
    console.log('  GET  /api/users/:username/dashboard - Player dashboard (sp_get_player_dashboard)');
    console.log('');
    console.log('🎯 WebSocket events:');
    console.log('  joinRoom         - Join a game room');
    console.log('  startGame        - Start the game (host only)');
    console.log('  playCard         - Play a card');
    console.log('  drawCard         - Draw a card');
    console.log('  playDrawnCard    - Play a card that was just drawn');
    console.log('  passDrawnCard    - Pass on a card that was just drawn');
    console.log('  player:callUno   - Call UNO on a player (penalty)');
    console.log('  player:callUnoSelf - Call UNO on yourself (self-declaration)');
    console.log('  restartGame      - Restart completed game (host only)');
    console.log('');
    console.log('💾 User accounts and game rooms are stored persistently in MySQL database.');
    console.log('⚡ Active games are cached in memory for optimal performance.');
    console.log('='.repeat(80));
});