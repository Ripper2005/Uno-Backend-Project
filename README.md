# UNO Online Backend

A complete real-time multiplayer UNO card game backend built with Node.js, Express, and Socket.io. This server provides both REST API endpoints for room management and WebSocket connections for real-time gameplay.

## Features

- **Complete UNO Game Logic**: Full implementation of official UNO rules with 108-card deck
- **Real-time Multiplayer**: WebSocket-based gameplay supporting 2-10 players per room
- **Room Management**: Create and join game rooms with automatic game initialization
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
  "playerName": "Player1"
}
```

**Response:**
```json
{
  "roomId": "room_abc123",
  "playerId": "player_def456",
  "message": "Room created successfully"
}
```

#### POST /api/rooms/:roomId/join
Joins an existing game room.

**Request Body:**
```json
{
  "playerName": "Player2"
}
```

**Response:**
```json
{
  "playerId": "player_ghi789",
  "message": "Joined room successfully"
}
```

#### GET /api/rooms/:roomId
Gets current room information and game state.

**Response:**
```json
{
  "room": {
    "id": "room_abc123",
    "players": [
      {
        "id": "player_def456",
        "name": "Player1",
        "connected": true
      }
    ],
    "state": "waiting",
    "gameState": null
  }
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
Start the game (only available when room has 2+ players).

**Payload:**
```json
{
  "roomId": "room_abc123",
  "playerId": "player_def456"
}
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
Sent when game state changes (card played, card drawn, turn changes).

**Payload:**
```json
{
  "gameState": {
    "players": [...],
    "currentPlayerIndex": 0,
    "currentColor": "red",
    "discardPile": [...],
    "drawPileCount": 85,
    "directionOfPlay": 1,
    "isGameOver": false,
    "winner": null
  },
  "lastAction": {
    "type": "cardPlayed",
    "playerId": "player_def456",
    "card": {...}
  }
}
```

##### `gameOver`
Sent when a player wins the game.

**Payload:**
```json
{
  "winner": {
    "id": "player_def456",
    "name": "Player1"
  },
  "gameState": {...}
}
```

##### `error`
Sent when an invalid action is attempted.

**Payload:**
```json
{
  "message": "Not your turn"
}
```

##### `playerJoined`
Sent when a new player joins the room.

**Payload:**
```json
{
  "player": {
    "id": "player_ghi789",
    "name": "Player2"
  },
  "room": {...}
}
```

##### `playerLeft`
Sent when a player disconnects.

**Payload:**
```json
{
  "playerId": "player_ghi789",
  "room": {...}
}
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
  -d '{"playerName": "TestPlayer"}'

# Join a room
curl -X POST http://localhost:3001/api/rooms/ROOM_ID/join \
  -H "Content-Type: application/json" \
  -d '{"playerName": "Player2"}'
```

### WebSocket Testing
You can test WebSocket functionality using the Socket.io client:

```javascript
const io = require('socket.io-client');
const socket = io('http://localhost:3001');

// Join a room
socket.emit('joinRoom', { roomId: 'room_abc123', playerId: 'player_def456' });

// Listen for game updates
socket.on('gameUpdate', (data) => {
  console.log('Game updated:', data);
});

// Start a game
socket.emit('startGame', { roomId: 'room_abc123', playerId: 'player_def456' });
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
