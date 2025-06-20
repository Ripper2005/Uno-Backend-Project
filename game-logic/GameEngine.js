/**
 * UNO Game Engine
 * 
 * A complete, self-contained game engine for UNO card game that handles
 * all game rules, state management, and validations according to official UNO rules.
 * 
 * This module is completely independent and can be used with any server framework.
 * It exports three main functions:
 * - createGameState(): Initialize a new game
 * - playCard(): Process a card play move
 * - drawCard(): Process a card draw move
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
 * @param {Object} gameState - Current game state
 * @param {Object} card - The card that was played
 * @param {string} chosenColor - Color chosen for wild cards
 * @returns {Object} Updated game state
 */
function applyCardEffect(gameState, card, chosenColor = null) {
    const newState = { ...gameState };
    
    switch (card.value) {
        case 'skip':
            // Skip next player
            newState.currentPlayerIndex = getNextPlayerIndex(newState, 1);
            break;
            
        case 'reverse':
            // Reverse direction and skip current player's next turn
            newState.directionOfPlay *= -1;
            if (newState.players.length === 2) {
                // In 2-player game, reverse acts like skip
                newState.currentPlayerIndex = getNextPlayerIndex(newState, 1);
            }
            break;
            
        case 'draw2':
            // Next player draws 2 cards and loses turn
            const nextPlayerIndex = getNextPlayerIndex(newState, 1);
            const drawnCards = newState.drawPile.splice(0, 2);
            newState.players[nextPlayerIndex].hand.push(...drawnCards);
            newState.currentPlayerIndex = getNextPlayerIndex(newState, 1);
            break;
            
        case 'wild':
            // Set the chosen color
            newState.currentColor = chosenColor;
            break;
            
        case 'wild_draw4':
            // Next player draws 4 cards, loses turn, and set chosen color
            const nextPlayerForDraw4 = getNextPlayerIndex(newState, 1);
            const drawnCards4 = newState.drawPile.splice(0, 4);
            newState.players[nextPlayerForDraw4].hand.push(...drawnCards4);
            newState.currentColor = chosenColor;
            newState.currentPlayerIndex = getNextPlayerIndex(newState, 1);
            break;
            
        default:
            // Regular number card, just update color
            newState.currentColor = card.color;
            break;
    }
    
    return newState;
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
    
    // Ensure first card is not a wild card
    let firstCard = discardPile[0];
    while (firstCard.type === 'wild') {
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
 * This function validates the move, applies card effects, checks for game end,
 * and manages turn progression. It's the core function for processing player moves.
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
    if (currentPlayer.id !== playerId) {
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
        return { error: 'Invalid move' };
    }
    
    // Validate wild card has chosen color
    if (cardToPlay.type === 'wild' && !chosenColor) {
        return { error: 'Must choose a color for wild card' };
    }
    
    if (cardToPlay.type === 'wild' && !COLORS.includes(chosenColor)) {
        return { error: 'Invalid color choice' };
    }
    
    // Create new game state
    const newState = { ...gameState };
    newState.players = gameState.players.map(player => ({
        ...player,
        hand: [...player.hand]
    }));
    
    // Remove card from player's hand
    newState.players[newState.currentPlayerIndex].hand.splice(cardIndex, 1);
    
    // Add card to discard pile
    newState.discardPile = [...gameState.discardPile, cardToPlay];
    
    // Check for winner
    if (checkWinner(newState.players[newState.currentPlayerIndex])) {
        newState.isGameOver = true;
        newState.winner = playerId;
        return newState;
    }
    
    // Apply card effect
    const stateAfterEffect = applyCardEffect(newState, cardToPlay, chosenColor);
    
    // Advance to next player (if not already advanced by card effect)
    if (cardToPlay.value !== 'skip' && cardToPlay.value !== 'reverse' && 
        cardToPlay.value !== 'draw2' && cardToPlay.value !== 'wild_draw4') {
        stateAfterEffect.currentPlayerIndex = getNextPlayerIndex(stateAfterEffect, 1);
    }
    
    return stateAfterEffect;
}

/**
 * Handles a player drawing a card
 * This function allows the current player to draw a card from the draw pile.
 * If the draw pile is empty, it automatically reshuffles the discard pile.
 * After drawing, the turn advances to the next player.
 * 
 * @param {Object} gameState - Current game state
 * @param {string} playerId - ID of player drawing the card
 * @returns {Object} Updated game state with drawn card or error object
 */
function drawCard(gameState, playerId) {
    // Validate game is not over
    if (gameState.isGameOver) {
        return { error: 'Game is already over' };
    }
    
    // Validate it's the player's turn
    const currentPlayer = gameState.players[gameState.currentPlayerIndex];
    if (currentPlayer.id !== playerId) {
        return { error: 'Not your turn' };
    }
    
    // Create new game state
    let newState = { ...gameState };
    newState.players = gameState.players.map(player => ({
        ...player,
        hand: [...player.hand]
    }));
    newState.drawPile = [...gameState.drawPile];
    newState.discardPile = [...gameState.discardPile];
    
    // Reshuffle if draw pile is empty
    if (newState.drawPile.length === 0) {
        newState = reshuffleDiscardPile(newState);
    }
    
    // If still no cards available, return error
    if (newState.drawPile.length === 0) {
        return { error: 'No cards available to draw' };
    }
    
    // Draw card
    const drawnCard = newState.drawPile.shift();
    newState.players[newState.currentPlayerIndex].hand.push(drawnCard);
    
    // Advance to next player
    newState.currentPlayerIndex = getNextPlayerIndex(newState, 1);
    
    return newState;
}

// Export the game engine functions
module.exports = {
    createGameState,
    playCard,
    drawCard
};
