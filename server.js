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
//require('dotenv').config();
const express = require('express');
const { createServer } = require('http');
const cors = require('cors'); // <-- Import
const { Server } = require('socket.io');
const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const path = require('path');

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
const PORT = process.env.PORT || 3001;

app.use(cors());
// Middleware to parse JSON requests from HTTP API calls
app.use(express.json());

// Serve frontend static assets (so /src/... and /public/... work)
app.use(express.static(path.join(__dirname, 'uno-frontend')));

// Root route - serve the frontend entry point
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'uno-frontend', 'index.html'));
});

// =========================================================================
// UTILITY FUNCTIONS
// =========================================================================

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

// =========================================================================
// HTTP API ENDPOINTS
// =========================================================================

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

// =========================================================================
// AUTHENTICATION ENDPOINTS
// =========================================================================

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

/**
 * NOTE: The remainder of this file is unchanged.
 * This commit only adds static hosting for the uno-frontend and a root '/' route.
 */
