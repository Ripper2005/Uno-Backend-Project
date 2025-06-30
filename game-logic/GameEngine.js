/**
 * UNO Game Engine
 * 
 * A complete, self-contained game engine for UNO card game that handles
 * all game rules, state management, and validations according to official UNO rules.
 * 
 * This module is completely independent and can be used with any server framework.
 * It exports five main functions:
 * - createGameState(): Initialize a new game
 * - playCard(): Process a card play move
 * - drawCard(): Process a card draw move
 * - playDrawnCard(): Play a card that was just drawn
 * - passDrawnCard(): Pass on a card that was just drawn
 * 
 * @author UNO Online Backend Team
 * @version 1.0.0
 */

// ============================================================================
// GAME CONSTANTS
// ============================================================================

// Standard UNO card colors
const COLORS = ['red', 'yellow', 'green', 'blue'];

// Card type definitions (not directly used but helpful for reference)
const NUMBER_CARDS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
const ACTION_CARDS = ['skip', 'reverse', 'draw2'];
const WILD_CARDS = ['wild', 'wild_draw4'];

// ============================================================================
// DECK MANAGEMENT FUNCTIONS
// ============================================================================

/**
 * Creates a complete UNO deck (108 cards)
 * @returns {Array} Array of card objects
 */
function createDeck() {
    const deck = [];
    
    // Add colored cards (0-9, Skip, Reverse, Draw Two)
    COLORS.forEach(color => {
        // Add number cards (0 has 1 card, 1-9 have 2 cards each)
        deck.push({ color, value: '0', type: 'number' });
        
        for (let i = 1; i <= 9; i++) {
            deck.push({ color, value: i.toString(), type: 'number' });
            deck.push({ color, value: i.toString(), type: 'number' });
        }
        
        // Add action cards (2 of each per color)
        ACTION_CARDS.forEach(action => {
            deck.push({ color, value: action, type: 'action' });
            deck.push({ color, value: action, type: 'action' });
        });
    });
    
    // Add wild cards (4 Wild + 4 Wild Draw Four)
    for (let i = 0; i < 4; i++) {
        deck.push({ color: null, value: 'wild', type: 'wild' });
        deck.push({ color: null, value: 'wild_draw4', type: 'wild' });
    }
      return deck;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Shuffles an array using Fisher-Yates algorithm
 * @param {Array} array - Array to shuffle
 * @returns {Array} Shuffled array
 */
function shuffleDeck(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

/**
 * Deals specified number of cards to each player
 * @param {Array} deck - The deck to deal from
 * @param {Array} playerIds - Array of player IDs
 * @param {number} cardsPerPlayer - Number of cards to deal to each player
 * @returns {Object} Object containing players array and remaining deck
 */
function dealCards(deck, playerIds, cardsPerPlayer = 7) {
    const players = [];
    let currentDeck = [...deck];
    
    playerIds.forEach(playerId => {
        const hand = currentDeck.splice(0, cardsPerPlayer);
        players.push({
            id: playerId,
            hand: hand
        });
    });
    
    return { players, deck: currentDeck };
}

// ============================================================================
// GAME LOGIC VALIDATION FUNCTIONS
// ============================================================================

/**
 * Validates if a card can be played on the current discard pile top card
 * Implements core UNO matching rules: color, number, or symbol match
 * Wild cards can always be played
 * 
 * @param {Object} cardToPlay - The card being played
 * @param {Object} topCard - The top card of discard pile
 * @param {string} currentColor - Current active color (for wild cards)
 * @returns {boolean} True if move is valid
 */
function isMoveValid(cardToPlay, topCard, currentColor) {
    // Wild cards can always be played
    if (cardToPlay.type === 'wild') {
        return true;
    }
    
    // Check color match
    if (cardToPlay.color === currentColor || cardToPlay.color === topCard.color) {
        return true;
    }
    
    // Check value match
    if (cardToPlay.value === topCard.value) {
        return true;
    }
    
    return false;
}



/**
 * Applies the effect of a played card to the game state
 * @param {Object} gameState - Current game state (with deep copies already made)
 * @param {Object} card - The card that was played
 * @param {string} chosenColor - Color chosen for wild cards
 * @returns {Object} Updated game state
 */
function applyCardEffect(gameState, card, chosenColor = null) {
    // gameState already has deep copies from playCard, work directly with it
    switch (card.value) {
        case 'skip':
            // Skip next player (advance turn by 2 to skip the next player)
            gameState.currentPlayerIndex = getNextPlayerIndex(gameState, 2);
            break;
            
        case 'reverse':
            // Reverse direction
            gameState.directionOfPlay *= -1;
            if (gameState.players.length === 2) {
                // In 2-player game, reverse acts like skip
                gameState.currentPlayerIndex = getNextPlayerIndex(gameState, 2);
            } else {
                // In games with 3+ players, just reverse direction, normal turn advance
                gameState.currentPlayerIndex = getNextPlayerIndex(gameState, 1);
            }
            break;
            
        case 'draw2':
            // Next player draws 2 cards and loses turn
            const nextPlayerIndex = getNextPlayerIndex(gameState, 1);
            
            // Ensure we have enough cards, reshuffle if needed
            if (gameState.drawPile.length < 2) {
                const reshuffledState = reshuffleDiscardPile(gameState);
                gameState.drawPile = [...reshuffledState.drawPile];
                gameState.discardPile = [...reshuffledState.discardPile];
            }
            
            // Draw 2 cards (or whatever is available)
            const cardsToDraw = Math.min(2, gameState.drawPile.length);
            if (cardsToDraw > 0) {
                for (let i = 0; i < cardsToDraw; i++) {
                    const drawnCard = gameState.drawPile.shift();
                    gameState.players[nextPlayerIndex].hand.push(drawnCard);
                }
            }
            
            // Skip the next player's turn
            gameState.currentPlayerIndex = getNextPlayerIndex(gameState, 2);
            break;
            
        case 'wild':
            // Set the chosen color
            gameState.currentColor = chosenColor;
            // Regular turn advance (handled in playCard function)
            break;
            
        case 'wild_draw4':
            // Next player draws 4 cards, loses turn, and set chosen color
            const nextPlayerForDraw4 = getNextPlayerIndex(gameState, 1);
            
            // Ensure we have enough cards, reshuffle if needed
            if (gameState.drawPile.length < 4) {
                const reshuffledState = reshuffleDiscardPile(gameState);
                gameState.drawPile = [...reshuffledState.drawPile];
                gameState.discardPile = [...reshuffledState.discardPile];
            }
            
            // Draw 4 cards (or whatever is available)
            const cardsToDraw4 = Math.min(4, gameState.drawPile.length);
            if (cardsToDraw4 > 0) {
                for (let i = 0; i < cardsToDraw4; i++) {
                    const drawnCard = gameState.drawPile.shift();
                    gameState.players[nextPlayerForDraw4].hand.push(drawnCard);
                }
            }
            
            // Set the chosen color
            gameState.currentColor = chosenColor;
            // Skip the next player's turn
            gameState.currentPlayerIndex = getNextPlayerIndex(gameState, 2);
            break;
            
        default:
            // Regular number card, just update color
            gameState.currentColor = card.color;
            // Regular turn advance (handled in playCard function)
            break;
    }
    
    return gameState;
}

/**
 * Gets the index of the next player based on direction of play
 * @param {Object} gameState - Current game state
 * @param {number} steps - Number of steps to advance (default 1)
 * @returns {number} Index of next player
 */
function getNextPlayerIndex(gameState, steps = 1) {
    const { currentPlayerIndex, directionOfPlay, players } = gameState;
    const totalPlayers = players.length;
    
    let nextIndex = currentPlayerIndex + (steps * directionOfPlay);
    
    // Handle wraparound
    while (nextIndex < 0) {
        nextIndex += totalPlayers;
    }
    while (nextIndex >= totalPlayers) {
        nextIndex -= totalPlayers;
    }
    
    return nextIndex;
}

/**
 * Reshuffles discard pile back into draw pile when draw pile is empty
 * @param {Object} gameState - Current game state
 * @returns {Object} Updated game state with reshuffled deck
 */
function reshuffleDiscardPile(gameState) {
    if (gameState.drawPile.length > 0) {
        return gameState;
    }
    
    const newState = { ...gameState };
    newState.drawPile = [...gameState.drawPile];
    newState.discardPile = [...gameState.discardPile];
    
    // Need at least 2 cards in discard pile to reshuffle (keep top card)
    if (newState.discardPile.length < 2) {
        // Cannot reshuffle, return as is
        return newState;
    }
    
    // Keep the top card of discard pile
    const topCard = newState.discardPile[newState.discardPile.length - 1];
    const cardsToShuffle = newState.discardPile.slice(0, -1);
    
    // Reset wild cards color when reshuffling
    const resetCards = cardsToShuffle.map(card => {
        if (card.type === 'wild') {
            return { ...card, color: null };
        }
        return card;
    });
    
    newState.drawPile = shuffleDeck(resetCards);
    newState.discardPile = [topCard];
    
    return newState;
}

/**
 * Checks if a player has won the game
 * @param {Object} player - Player object to check
 * @returns {boolean} True if player has won
 */
function checkWinner(player) {
    return player.hand.length === 0;
}

// ============================================================================
// PUBLIC API FUNCTIONS (EXPORTED)
// ============================================================================

/**
 * Creates initial game state with shuffled deck and dealt cards
 * This is the main function to start a new UNO game with the specified players.
 * Sets up the initial deck, deals 7 cards to each player, places the first card,
 * and initializes all game state variables.
 * @param {Array} playerIds - Array of player IDs
 * @returns {Object} Complete initial game state
 */
function createGameState(playerIds) {
    if (!playerIds || playerIds.length < 2 || playerIds.length > 10) {
        throw new Error('Game requires 2-10 players');
    }
    
    // Create and shuffle deck
    const deck = shuffleDeck(createDeck());
    
    // Deal cards to players
    const { players, deck: remainingDeck } = dealCards(deck, playerIds, 7);
    
    // Place first card on discard pile
    const discardPile = [remainingDeck.shift()];
    const drawPile = remainingDeck;
    
    // Ensure first card is not a wild card or action card
    let firstCard = discardPile[0];
    while (firstCard.type === 'wild' || firstCard.type === 'action') {
        drawPile.push(firstCard);
        shuffleDeck(drawPile);
        firstCard = drawPile.shift();
        discardPile[0] = firstCard;
    }
    
    // Initialize game state
    const gameState = {
        players,
        drawPile,
        discardPile,
        currentPlayerIndex: 0,
        directionOfPlay: 1, // 1 for clockwise, -1 for counter-clockwise
        currentColor: firstCard.color,
        isGameOver: false,
        winner: null
    };
    
    // Apply first card effect if it's an action card
    if (firstCard.type === 'action') {
        return applyCardEffect(gameState, firstCard);
    }
    
    return gameState;
}

/**
 * Handles a player playing a card
 * This function validates the move, applies card effects, and checks for game end.
 * Turn advancement is handled by the card's effect, not by this function directly.
 * 
 * @param {Object} gameState - Current game state
 * @param {string} playerId - ID of player making the move
 * @param {Object} cardToPlay - Card being played
 * @param {string} chosenColor - Color chosen for wild cards (required for wild cards)
 * @returns {Object} Updated game state or error object with error message
 */
function playCard(gameState, playerId, cardToPlay, chosenColor = null) {
    // Validate game is not over
    if (gameState.isGameOver) {
        return { error: 'Game is already over' };
    }
    
    // Validate it's the player's turn
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    if (!currentPlayer || currentPlayer.id !== playerId) {
        return { error: 'Not your turn' };
    }
    
    // Validate player has the card
    const cardIndex = currentPlayer.hand.findIndex(card => 
        card.color === cardToPlay.color && 
        card.value === cardToPlay.value && 
        card.type === cardToPlay.type
    );
    
    if (cardIndex === -1) {
        return { error: 'Card not in hand' };
    }
    
    // Validate the move is legal
    const topCard = gameState.discardPile[gameState.discardPile.length - 1];
    if (!isMoveValid(cardToPlay, topCard, gameState.currentColor)) {
        return { error: 'Invalid move - card does not match color, number, or symbol' };
    }
    
    // Validate wild card has chosen color
    if (cardToPlay.type === 'wild' && !chosenColor) {
        return { error: 'Must choose a color for wild card' };
    }
    
    if (cardToPlay.type === 'wild' && !COLORS.includes(chosenColor)) {
        return { error: 'Invalid color choice' };
    }
    
    // Create new game state with deep copies
    const newState = { ...gameState };
    newState.players = gameState.players.map(player => ({
        ...player,
        hand: [...player.hand]
    }));
    newState.drawPile = [...gameState.drawPile];
    newState.discardPile = [...gameState.discardPile];
    
    // Remove card from player's hand
    newState.players[newState.currentPlayerIndex].hand.splice(cardIndex, 1);
    
    // Add card to discard pile
    newState.discardPile.push(cardToPlay);
    
    // Apply card effect first (this handles turn advancement based on card type)
    const stateAfterEffect = applyCardEffect(newState, cardToPlay, chosenColor);
    
    // Check for winner after applying effects (check the player who just played)
    if (checkWinner(newState.players[newState.currentPlayerIndex])) {
        stateAfterEffect.isGameOver = true;
        stateAfterEffect.winner = playerId;
    }
    
    // Only advance turn for cards that don't handle their own turn logic
    // Action cards (skip, reverse, draw2, wild_draw4) handle turn advancement internally
    if (cardToPlay.type === 'number' || 
        (cardToPlay.type === 'wild' && cardToPlay.value === 'wild')) {
        stateAfterEffect.currentPlayerIndex = getNextPlayerIndex(stateAfterEffect, 1);
    }
    
    return stateAfterEffect;
}

/**
 * Handles a player drawing a card
 * This function implements the official UNO rule where a player can play a drawn card immediately if valid.
 * If the drawn card is playable, it enters a "limbo state" where the player can choose to play or pass.
 * 
 * @param {Object} gameState - Current game state
 * @param {string} playerId - ID of player drawing the card
 * @returns {Object} Updated game state with either playableDrawnCard or card added to hand
 */
function drawCard(gameState, playerId) {
    // Validate game is not over
    if (gameState.isGameOver) {
        return { error: 'Game is already over' };
    }
    
    // Validate it's the player's turn
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    if (!currentPlayer || currentPlayer.id !== playerId) {
        return { error: 'Not your turn' };
    }
    
    // Create new game state with deep copies
    let newState = { ...gameState };
    newState.players = gameState.players.map(player => ({
        ...player,
        hand: [...player.hand]
    }));
    newState.drawPile = [...gameState.drawPile];
    newState.discardPile = [...gameState.discardPile];
    
    // Handle empty draw pile by reshuffling discard pile
    if (newState.drawPile.length === 0) {
        newState = reshuffleDiscardPile(newState);
    }
    
    // If still no cards available after reshuffling, return error
    if (newState.drawPile.length === 0) {
        return { error: 'No cards available to draw' };
    }
    
    // Draw exactly one card from the draw pile
    const drawnCard = newState.drawPile.shift();
    
    // Check if the drawn card can be played
    const topCard = newState.discardPile[newState.discardPile.length - 1];
    const isPlayable = isMoveValid(drawnCard, topCard, newState.currentColor);
    
    if (isPlayable) {
        // Enter "limbo state" - card is playable, let player choose
        newState.playableDrawnCard = {
            card: { ...drawnCard },
            playerId: playerId
        };
        // Don't add to hand, don't end turn
        return newState;
    } else {
        // Card is not playable - add to hand and end turn
        newState.players[newState.currentPlayerIndex].hand.push(drawnCard);
        newState.currentPlayerIndex = getNextPlayerIndex(newState, 1);
        newState.playableDrawnCard = null;
        return newState;
    }
}

/**
 * Handles a player choosing to play their drawn card
 * This function is called when a player decides to play the card they just drew.
 * 
 * @param {Object} gameState - Current game state (must contain playableDrawnCard)
 * @param {string} playerId - ID of player playing the drawn card
 * @param {string} chosenColor - Color chosen for wild cards (required for wild cards)
 * @returns {Object} Updated game state with card played and limbo state cleared
 */
function playDrawnCard(gameState, playerId, chosenColor = null) {
    // Validate game is not over
    if (gameState.isGameOver) {
        return { error: 'Game is already over' };
    }
    
    // Validate it's the player's turn
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    if (!currentPlayer || currentPlayer.id !== playerId) {
        return { error: 'Not your turn' };
    }
    
    // Validate player is in limbo state
    if (!gameState.playableDrawnCard || gameState.playableDrawnCard.playerId !== playerId) {
        return { error: 'No drawn card available to play' };
    }
    
    const cardToPlay = gameState.playableDrawnCard.card;
    
    // Validate the move is legal
    const topCard = gameState.discardPile[gameState.discardPile.length - 1];
    if (!isMoveValid(cardToPlay, topCard, gameState.currentColor)) {
        return { error: 'Invalid move - card does not match color, number, or symbol' };
    }
    
    // Validate wild card has chosen color
    if (cardToPlay.type === 'wild' && !chosenColor) {
        return { error: 'Must choose a color for wild card' };
    }
    
    if (cardToPlay.type === 'wild' && !COLORS.includes(chosenColor)) {
        return { error: 'Invalid color choice' };
    }
    
    // Create new game state with deep copies
    const newState = { ...gameState };
    newState.players = gameState.players.map(player => ({
        ...player,
        hand: [...player.hand]
    }));
    newState.drawPile = [...gameState.drawPile];
    newState.discardPile = [...gameState.discardPile];
    
    // Add card to discard pile
    newState.discardPile.push(cardToPlay);
    
    // Clear the playableDrawnCard (exit limbo state)
    newState.playableDrawnCard = null;
    
    // Apply card effect (this handles turn advancement based on card type)
    const stateAfterEffect = applyCardEffect(newState, cardToPlay, chosenColor);
    
    // Check for winner after applying effects (check the player who just played)
    if (checkWinner(newState.players[newState.currentPlayerIndex])) {
        stateAfterEffect.isGameOver = true;
        stateAfterEffect.winner = playerId;
    }
    
    // Only advance turn for cards that don't handle their own turn logic
    // Action cards (skip, reverse, draw2, wild_draw4) handle turn advancement internally
    if (cardToPlay.type === 'number' || 
        (cardToPlay.type === 'wild' && cardToPlay.value === 'wild')) {
        stateAfterEffect.currentPlayerIndex = getNextPlayerIndex(stateAfterEffect, 1);
    }
    
    return stateAfterEffect;
}

/**
 * Handles a player choosing to pass on their drawn card
 * This function is called when a player decides not to play the card they just drew.
 * 
 * @param {Object} gameState - Current game state (must contain playableDrawnCard)
 * @param {string} playerId - ID of player passing on the drawn card
 * @returns {Object} Updated game state with card added to hand and turn ended
 */
function passDrawnCard(gameState, playerId) {
    // Validate game is not over
    if (gameState.isGameOver) {
        return { error: 'Game is already over' };
    }
    
    // Validate it's the player's turn
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    if (!currentPlayer || currentPlayer.id !== playerId) {
        return { error: 'Not your turn' };
    }
    
    // Validate playableDrawnCard exists and belongs to this player
    if (!gameState.playableDrawnCard || gameState.playableDrawnCard.playerId !== playerId) {
        return { error: 'No drawn card available to pass' };
    }
    
    // Create new game state with deep copies
    const newState = { ...gameState };
    newState.players = gameState.players.map(player => ({
        ...player,
        hand: [...player.hand]
    }));
    newState.drawPile = [...gameState.drawPile];
    newState.discardPile = [...gameState.discardPile];
    
    // Add the drawn card to the current player's hand
    const drawnCard = gameState.playableDrawnCard.card;
    newState.players[newState.currentPlayerIndex].hand.push(drawnCard);
    
    // Clear the playableDrawnCard (exit limbo state)
    newState.playableDrawnCard = null;
    
    // End the current player's turn by advancing to the next player
    newState.currentPlayerIndex = getNextPlayerIndex(newState, 1);
    
    return newState;
}

// Export the game engine functions
module.exports = {
    createGameState,
    playCard,
    drawCard,
    playDrawnCard,
    passDrawnCard
};
