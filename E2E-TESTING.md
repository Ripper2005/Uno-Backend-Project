# E2E Testing Instructions

## Overview
The `e2e-test.js` script performs a comprehensive end-to-end test of the UNO backend by simulating multiple players playing a complete game.

## Setup

1. **Install test dependencies:**
   ```bash
   npm install
   ```

2. **Start the UNO server in one terminal:**
   ```bash
   npm start
   # or
   node server.js
   ```

3. **Run the E2E test in another terminal:**
   ```bash
   npm test
   # or
   npm run test:e2e
   # or
   node e2e-test.js
   ```

## What the Test Does

### Phase 1: Game Setup
- ✅ Creates a room via HTTP API
- ✅ Additional players join via HTTP API  
- ✅ All players connect via WebSocket
- ✅ Players join the WebSocket room
- ✅ Host starts the game

### Phase 2: Automated Gameplay
- 🤖 Simulates intelligent bot players
- 🎴 Automatically plays valid cards
- 📥 Draws cards when no valid plays available
- 🃏 Handles wild cards with color selection
- 🏆 Plays until someone wins

## Test Output

The script provides detailed logging including:
- Connection status for each player
- Game state updates
- Card plays and draws
- Move-by-move progress
- Final results and gap analysis

## Success Criteria

✅ **PASS:** Game completes with a winner declared
❌ **FAIL:** Any errors, timeouts, or incomplete games

## Gap Analysis

The test automatically identifies backend issues:
- API endpoint problems
- WebSocket connection issues
- Game logic errors
- Card validation problems
- Win condition detection

## Customization

Edit the CONFIG object in `e2e-test.js`:
```javascript
const CONFIG = {
    SERVER_URL: 'http://localhost:3001',
    NUM_PLAYERS: 2,
    PLAYER_IDS: ['bot1', 'bot2'],
    TIMEOUT_MS: 30000,
    MOVE_DELAY_MS: 1000
};
```

## Troubleshooting

- **Connection failed:** Ensure server is running on port 3001
- **Test timeout:** Increase `TIMEOUT_MS` in config
- **Too many moves:** Check for infinite loops in game logic
- **API errors:** Verify HTTP endpoints are working with curl/Postman
