# UNO Online Backend

A complete real-time multiplayer UNO card game backend built with Node.js, Express, and Socket.io. This server provides both REST API endpoints for room management and WebSocket connections for real-time gameplay.

## Features

- **Complete UNO Game Logic**: Full implementation of official UNO rules with 108-card deck
- **Real-time Multiplayer**: WebSocket-based gameplay supporting 2-10 players per room
- **Room Management**: Create and join game rooms with manual game initialization
- **Player Disconnect Handling**: Robust disconnect/reconnect logic with game state preservation
- **RESTful API**: HTTP endpoints for room creation and status checking
- **Scalable Architecture**: Modular design with separate game engine and server logic

## Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd uno-backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Start the server**
   ```bash
   npm start
   ```

The server will start on port 3001 by default.

## Project Structure

```
uno-backend/
├── package.json          # Project dependencies and scripts
├── server.js             # Main server file with HTTP API and WebSocket handlers
├── game-logic/
│   └── GameEngine.js     # Complete UNO game logic engine
└── README.md            # This documentation file
```

## API Documentation

### HTTP Endpoints

#### GET /api/status
Health check endpoint to verify server is running.

**Response:**
```json
{
  "status": "Server is running",
  "timestamp": "2025-06-20T10:30:00.000Z"
}
```

#### POST /api/rooms/create
Creates a new game room.

**Request Body:**
```json
{
  "playerId": "player1"
}
```

**Response:**
```json
{
  "roomId": "ABC123"
}
```

#### POST /api/rooms/:roomId/join
Joins an existing game room.

**Request Body:**
```json
{
  "playerId": "player2"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Player joined successfully",
  "gameStarted": false,
  "canStart": true
}
```

#### GET /api/rooms/:roomId
Gets current room information and game state.

**Response (Waiting for players):**
```json
{
  "roomId": "ABC123",
  "status": "waiting",
  "host": "player1",
  "players": [
    {
      "id": "player1"
    },
    {
      "id": "player2" 
    }
  ],
  "playerCount": 2,
  "maxPlayers": 10,
  "canStart": true
}
```

**Response (Game in progress):**
```json
{
  "roomId": "ABC123",
  "status": "playing",
  "host": "player1",
  "players": [
    {
      "id": "player1",
      "handSize": 6
    },
    {
      "id": "player2",
      "handSize": 7
    }
  ],
  "currentPlayerIndex": 0,
  "currentPlayer": "player1",
  "directionOfPlay": 1,
  "currentColor": "red",
  "topCard": {
    "color": "red",
    "value": "5",
    "type": "number"
  },
  "drawPileSize": 85,
  "isGameOver": false,
  "winner": null
}
```

### WebSocket Events

Connect to the WebSocket server at `ws://localhost:3001` using Socket.io client.

#### Client → Server Events

##### `joinRoom`
Join a specific room for real-time updates.

**Payload:**
```json
{
  "roomId": "room_abc123",
  "playerId": "player_def456"
}
```

##### `startGame`
Start the game manually (host only). This event initializes the game, deals cards to all players, and begins gameplay.

**Payload:**
```json
{
  "roomId": "room_abc123"
}
```

**Requirements:**
- Only the room host can start the game
- Room must be in "waiting" status
- At least 2 players must have joined the room
```

##### `playCard`
Play a card from your hand.

**Payload:**
```json
{
  "roomId": "room_abc123",
  "playerId": "player_def456",
  "card": {
    "color": "red",
    "value": "5",
    "type": "number"
  },
  "chosenColor": "blue"  // Required only for wild cards
}
```

##### `drawCard`
Draw a card from the deck.

**Payload:**
```json
{
  "roomId": "room_abc123",
  "playerId": "player_def456"
}
```

#### Server → Client Events

##### `gameUpdate`
**Primary event for frontend synchronization.** Sent whenever the game state changes (game start, card played, card drawn, turn changes). This is the main event your frontend should listen to for real-time game updates.

**Payload:**
```json
{
  "roomId": "room_abc123",
  "status": "playing",
  "host": "player_def456",
  "players": [
    {
      "id": "player_def456",
      "handSize": 7,
      "isActive": true
    },
    {
      "id": "player_ghi789", 
      "handSize": 6,
      "isActive": true
    }
  ],
  "currentPlayerIndex": 0,
  "currentPlayer": "player_def456",
  "directionOfPlay": 1,
  "currentColor": "red",
  "topCard": {
    "color": "red",
    "value": "5", 
    "type": "number"
  },
  "drawPileSize": 85,
  "isGameOver": false,
  "winner": null
}
```

##### `gameStarted`
Sent when the game officially begins after host triggers startGame.

**Payload:**
```json
{
  "message": "Game has started! Cards have been dealt.",
  "currentPlayer": "player_def456",
  "topCard": {
    "color": "red",
    "value": "7",
    "type": "number"
  }
}
```

##### `gameOver`
Sent when a player wins the game or game ends due to disconnections.

**Payload:**
```json
{
  "winnerId": "player_def456",
  "message": "player_def456 wins the game!",
  "reason": "normal"
}
```
```

##### `error`
Sent when an invalid action is attempted.

**Payload:**
```json
{
  "message": "Not your turn"
}
```

##### `playerConnected`
Sent when a player joins the WebSocket room.

**Payload:**
```json
{
  "playerId": "player_ghi789"
}
```

##### `playerDisconnected`
Sent when a player disconnects from the game.

**Payload:**
```json
{
  "playerId": "player_ghi789",
  "message": "player_ghi789 has disconnected and will be skipped"
}
```

## Game Setup Flow

This section explains the complete sequence for setting up and starting a UNO game using both HTTP API and WebSocket events.

### Frontend Implementation Steps

1. **Create Room (HTTP API)**
   ```javascript
   const response = await fetch('http://localhost:3001/api/rooms/create', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ playerId: 'player1' })
   });
   const { roomId } = await response.json();
   // roomId: "ABC123"
   ```

2. **Other Players Join Room (HTTP API)**
   ```javascript
   const response = await fetch(`http://localhost:3001/api/rooms/${roomId}/join`, {
     method: 'POST', 
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ playerId: 'player2' })
   });
   const result = await response.json();
   // result: { success: true, message: "Player joined successfully", canStart: true }
   ```

3. **All Players Connect to WebSocket**
   ```javascript
   const socket = io('http://localhost:3001');
   
   // Each player joins the WebSocket room
   socket.emit('joinRoom', { 
     roomId: 'ABC123', 
     playerId: 'player1' // or player2, etc.
   });
   ```

4. **Listen for Game Updates (All Players)**
   ```javascript
   // Primary event - listen for all game state changes
   socket.on('gameUpdate', (gameState) => {
     console.log('Game state updated:', gameState);
     // Update your UI with current game state
     updateGameUI(gameState);
   });
   
   // Game start notification
   socket.on('gameStarted', (data) => {
     console.log('Game started!', data.message);
     console.log('First player:', data.currentPlayer);
   });
   ```

5. **Host Starts the Game (Host Only)**
   ```javascript
   // Only the room host can start the game
   socket.emit('startGame', { roomId: 'ABC123' });
   ```

6. **Game Begins**
   - All players receive `gameStarted` event
   - All players receive `gameUpdate` event with initial game state
   - Cards are dealt (7 per player)
   - First player can begin making moves

### Complete Integration Example

```javascript
// Frontend game setup example
class UnoGame {
  constructor() {
    this.socket = io('http://localhost:3001');
    this.setupSocketListeners();
  }
  
  async createRoom(playerId) {
    const response = await fetch('http://localhost:3001/api/rooms/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId })
    });
    const { roomId } = await response.json();
    
    // Join WebSocket room
    this.socket.emit('joinRoom', { roomId, playerId });
    return roomId;
  }
  
  async joinRoom(roomId, playerId) {
    const response = await fetch(`http://localhost:3001/api/rooms/${roomId}/join`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId })
    });
    
    // Join WebSocket room
    this.socket.emit('joinRoom', { roomId, playerId });
  }
  
  startGame(roomId) {
    this.socket.emit('startGame', { roomId });
  }
  
  setupSocketListeners() {
    this.socket.on('gameUpdate', (gameState) => {
      this.updateUI(gameState);
    });
    
    this.socket.on('gameStarted', (data) => {
      console.log('Game started:', data.message);
    });
    
    this.socket.on('error', (error) => {
      console.error('Game error:', error.message);
    });
  }
}
```
```

## Game Rules

This implementation follows official UNO rules:

### Deck Composition (108 cards)
- **Number Cards**: 0-9 in four colors (red, yellow, green, blue)
  - One 0 card per color (4 total)
  - Two 1-9 cards per color (72 total)
- **Action Cards**: Skip, Reverse, Draw Two in four colors (24 total)
- **Wild Cards**: Wild and Wild Draw Four (8 total)

### Game Flow
1. Each player starts with 7 cards
2. First card is placed on discard pile (reshuffled if wild)
3. Players take turns matching color, number, or symbol
4. Wild cards can be played anytime
5. First player to empty their hand wins

### Card Effects
- **Skip**: Next player loses their turn
- **Reverse**: Direction of play reverses
- **Draw Two**: Next player draws 2 cards and loses turn
- **Wild**: Player chooses new color
- **Wild Draw Four**: Next player draws 4 cards, loses turn, player chooses color

### Special Rules
- In 2-player games, Reverse acts like Skip
- When draw pile is empty, discard pile is reshuffled (except top card)
- Wild cards reset to no color when reshuffled

## Development

### Running in Development Mode
```bash
npm run dev  # If you have nodemon installed
# OR
node server.js
```

### Testing the API
```bash
# Test server status
curl http://localhost:3001/api/status

# Create a room
curl -X POST http://localhost:3001/api/rooms/create \
  -H "Content-Type: application/json" \
  -d '{"playerId": "TestPlayer"}'

# Join a room  
curl -X POST http://localhost:3001/api/rooms/ROOM_ID/join \
  -H "Content-Type: application/json" \
  -d '{"playerId": "Player2"}'
```

### WebSocket Testing
You can test WebSocket functionality using the Socket.io client:

```javascript
const io = require('socket.io-client');
const socket = io('http://localhost:3001');

// Join a room (after joining via HTTP API)
socket.emit('joinRoom', { roomId: 'ABC123', playerId: 'player1' });

// Listen for game updates (main event)
socket.on('gameUpdate', (gameState) => {
  console.log('Game state updated:', gameState);
});

// Listen for game start
socket.on('gameStarted', (data) => {
  console.log('Game started:', data.message);
});

// Start a game (host only)
socket.emit('startGame', { roomId: 'ABC123' });
});

// Start a game (host only)
socket.emit('startGame', { roomId: 'ABC123' });
```

## Architecture

### Game Engine (`game-logic/GameEngine.js`)
- **Pure Functions**: All game logic functions are pure and stateless
- **Immutable State**: Game state is never mutated directly
- **Complete Validation**: All moves are validated before applying
- **Error Handling**: Returns error objects for invalid moves

### Server (`server.js`)
- **Express HTTP API**: RESTful endpoints for room management
- **Socket.io WebSockets**: Real-time gameplay communication
- **Room Management**: In-memory storage of rooms and game states
- **Disconnect Handling**: Graceful handling of player disconnections

### Key Design Decisions
- **Separation of Concerns**: Game logic is completely separate from server logic
- **Real-time First**: Primary gameplay uses WebSockets for immediate feedback
- **RESTful Fallback**: HTTP endpoints available for room management
- **Memory Storage**: Suitable for demonstration; can be extended with database

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License.

## Troubleshooting

### Common Issues

**Port 3001 already in use**
```bash
# Find process using port 3001
netstat -ano | findstr :3001
# Kill the process (Windows)
taskkill /PID <process_id> /F
```

**WebSocket connection failed**
- Ensure server is running on correct port
- Check firewall settings
- Verify Socket.io client version compatibility

**Game state not updating**
- Check that players are properly connected to WebSocket
- Verify room ID and player ID are correct
- Ensure player is joining room via WebSocket after HTTP room creation

For additional support, please create an issue in the repository.
