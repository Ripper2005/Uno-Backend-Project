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
 * Counts the number of active players in the game
 * @param {Object} gameState - Current game state
 * @returns {number} Number of active players
 */
function countActivePlayers(gameState) {
    return gameState.players.filter(player => player.isActive !== false).length;
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
            gameState.currentColor = card.color; // FIX: Set color for skip cards
            gameState.currentPlayerIndex = getNextPlayerIndex(gameState, 2);
            break;
            
        case 'reverse':
            // Reverse direction
            gameState.currentColor = card.color; // FIX: Set color for reverse cards
            gameState.directionOfPlay *= -1;
            const activePlayerCount = countActivePlayers(gameState);
            if (activePlayerCount === 2) {
                // In 2-active-player game, reverse acts like skip
                gameState.currentPlayerIndex = getNextPlayerIndex(gameState, 2);
            } else {
                // In games with 3+ active players, just reverse direction, normal turn advance
                gameState.currentPlayerIndex = getNextPlayerIndex(gameState, 1);
            }
            break;
            
        case 'draw2':
            // Next player draws 2 cards and loses turn
            gameState.currentColor = card.color; // FIX: Set color for draw2 cards
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
            // Advance turn for wild cards
            gameState.currentPlayerIndex = getNextPlayerIndex(gameState, 1);
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
            // Turn advancement for number cards is handled by the calling function
            break;
    }
    
    return gameState;
}

/**
 * Gets the index of the next player based on direction of play, skipping inactive players
 * @param {Object} gameState - Current game state
 * @param {number} steps - Number of steps to advance (default 1)
 * @returns {number} Index of next active player
 */
function getNextPlayerIndex(gameState, steps = 1) {
    const { currentPlayerIndex, directionOfPlay, players } = gameState;
    const totalPlayers = players.length;
    
    let nextIndex = currentPlayerIndex;
    let stepsRemaining = steps;
    let attempts = 0;
    
    // Advance the specified number of steps, skipping inactive players
    while (stepsRemaining > 0 && attempts < totalPlayers * 2) {
        nextIndex = nextIndex + directionOfPlay;
        
        // Handle wraparound
        if (nextIndex < 0) {
            nextIndex = totalPlayers - 1;
        } else if (nextIndex >= totalPlayers) {
            nextIndex = 0;
        }
        
        // Only count this step if the player is active (or if isActive is not set - backwards compatibility)
        if (players[nextIndex].isActive !== false) {
            stepsRemaining--;
        }
        
        attempts++;
    }
    
    // Fallback: if all players are inactive, return current index
    if (attempts >= totalPlayers * 2) {
        return currentPlayerIndex;
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
    
    // CRITICAL BUG FIX: Prevent playing cards from hand while in limbo state
    // This prevents the "Ghost Card" bug where playableDrawnCard state persists incorrectly
    if (gameState.playableDrawnCard) {
        return { error: 'You must first play or keep the card you just drew. You cannot play other cards from your hand at this time.' };
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
    
    // UNO State Detection: Check if player now has exactly one card
    const playerWhoPlayed = newState.players.find(p => p.id === playerId);
    if (playerWhoPlayed && playerWhoPlayed.hand.length === 1) {
        // This player is now on UNO!
        newState.unoPlayerId = playerId;
    } else if (newState.unoPlayerId === playerId) {
        // This player was on UNO but now has 0 cards (won) or > 1 cards (safe)
        newState.unoPlayerId = null;
    }
    
    // Check for winner BEFORE applying card effects (check the player who just played)
    const playerWhoJustPlayed = newState.players[newState.currentPlayerIndex];
    if (checkWinner(playerWhoJustPlayed)) {
        newState.isGameOver = true;
        newState.winner = playerId;
        // Still apply card effects for consistency, but game is over
        const stateAfterEffect = applyCardEffect(newState, cardToPlay, chosenColor);
        return stateAfterEffect;
    }
    
    // Apply card effect (this handles turn advancement based on card type)
    const stateAfterEffect = applyCardEffect(newState, cardToPlay, chosenColor);
    
    // Only advance turn for number cards
    // Action cards and wild cards handle turn advancement internally in applyCardEffect
    if (cardToPlay.type === 'number') {
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
        
        // Clear UNO flag if this player was on UNO and just drew a card
        if (newState.unoPlayerId === playerId) {
            newState.unoPlayerId = null;
        }
        
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
    
    // UNO State Detection: Check if player now has exactly one card
    // Note: When playing a drawn card, the player's hand size doesn't change
    // but we need to check if they would have 1 card after this action
    const playerWhoPlayed = newState.players.find(p => p.id === playerId);
    if (playerWhoPlayed && playerWhoPlayed.hand.length === 1) {
        // This player is now on UNO!
        newState.unoPlayerId = playerId;
    } else if (newState.unoPlayerId === playerId) {
        // This player was on UNO but now has 0 cards (won) or > 1 cards (safe)
        newState.unoPlayerId = null;
    }
    
    // Check for winner BEFORE applying card effects (check the player who just played)
    const playerWhoJustPlayed = newState.players[newState.currentPlayerIndex];
    if (checkWinner(playerWhoJustPlayed)) {
        newState.isGameOver = true;
        newState.winner = playerId;
        // Still apply card effects for consistency, but game is over
        const stateAfterEffect = applyCardEffect(newState, cardToPlay, chosenColor);
        return stateAfterEffect;
    }
    
    // Apply card effect (this handles turn advancement based on card type)
    const stateAfterEffect = applyCardEffect(newState, cardToPlay, chosenColor);
    
    // Only advance turn for number cards
    // Action cards and wild cards handle turn advancement internally in applyCardEffect
    if (cardToPlay.type === 'number') {
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
    
    // Clear UNO flag if this player was on UNO and just added a card to their hand
    if (newState.unoPlayerId === playerId) {
        newState.unoPlayerId = null;
    }
    
    // Clear the playableDrawnCard (exit limbo state)
    newState.playableDrawnCard = null;
    
    // End the current player's turn by advancing to the next player
    newState.currentPlayerIndex = getNextPlayerIndex(newState, 1);
    
    return newState;
}

/**
 * Applies a penalty to a player who was caught not calling UNO
 * Includes race condition protection - only valid if player is still vulnerable
 * @param {Object} gameState - Current game state
 * @param {string} targetPlayerId - ID of the player to penalize
 * @param {string} callerPlayerId - ID of the player calling UNO (for logging/validation)
 * @returns {Object} Updated game state with penalty applied, or error if invalid
 */
function callUnoPenalty(gameState, targetPlayerId, callerPlayerId = null) {
    // Validation: Check if the call is valid
    if (gameState.unoPlayerId !== targetPlayerId) {
        // Player is already safe or someone else was called out
        return { 
            error: 'UNO call invalid - player is no longer vulnerable',
            success: false 
        };
    }
    
    // Find the target player
    const targetPlayer = gameState.players.find(player => player.id === targetPlayerId);
    if (!targetPlayer) {
        return { 
            error: 'Player not found',
            success: false 
        };
    }
    
    // Double-check player actually has 1 card (race condition protection)
    if (targetPlayer.hand.length !== 1) {
        return { 
            error: 'UNO call invalid - player does not have exactly 1 card',
            success: false 
        };
    }
    
    // Create a new state object to avoid mutating the original
    const newState = {
        ...gameState,
        players: gameState.players.map(player => ({
            ...player,
            hand: [...player.hand]
        })),
        drawPile: [...gameState.drawPile],
        discardPile: [...gameState.discardPile]
    };
    
    // Find the target player in the new state
    const newTargetPlayer = newState.players.find(player => player.id === targetPlayerId);
    
    // Apply penalty: Add two cards to the target player's hand
    for (let i = 0; i < 2; i++) {
        // Check if we need to reshuffle the deck
        if (newState.drawPile.length === 0) {
            const reshuffledState = reshuffleDiscardPile(newState);
            newState.drawPile = [...reshuffledState.drawPile];
            newState.discardPile = [...reshuffledState.discardPile];
        }
        
        // Draw a card from the draw pile
        if (newState.drawPile.length > 0) {
            const penaltyCard = newState.drawPile.pop();
            newTargetPlayer.hand.push(penaltyCard);
        }
    }
    
    // Clear the UNO flag since the player is no longer vulnerable
    newState.unoPlayerId = null;
    
    // Return success with metadata
    return {
        ...newState,
        success: true,
        penaltyApplied: {
            targetPlayer: targetPlayerId,
            callerPlayer: callerPlayerId,
            cardsAdded: 2
        }
    };
}

/**
 * Allows a player to call UNO on themselves to avoid penalty
 * @param {Object} gameState - Current game state
 * @param {string} playerId - ID of the player calling UNO on themselves
 * @returns {Object} Updated game state with UNO status cleared if valid
 */
function callUnoSelf(gameState, playerId) {
    // Validation: Check if the player is actually vulnerable to UNO call
    if (gameState.unoPlayerId !== playerId) {
        // Player is not in UNO state or someone else is
        return { error: 'You are not in UNO state' };
    }
    
    // Find the player
    const player = gameState.players.find(p => p.id === playerId);
    if (!player || player.hand.length !== 1) {
        // Player doesn't exist or doesn't have exactly 1 card
        return { error: 'Invalid UNO self-call' };
    }
    
    // Create a new state object to avoid mutating the original
    const newState = {
        ...gameState,
        players: gameState.players.map(player => ({
            ...player,
            hand: [...player.hand]
        })),
        drawPile: [...gameState.drawPile],
        discardPile: [...gameState.discardPile]
    };
    
    // Clear the UNO flag - player is now safe from penalty
    newState.unoPlayerId = null;
    
    return newState;
}

// Export the game engine functions
module.exports = {
    createGameState,
    playCard,
    drawCard,
    playDrawnCard,
    passDrawnCard,
    callUnoPenalty,
    callUnoSelf
};
