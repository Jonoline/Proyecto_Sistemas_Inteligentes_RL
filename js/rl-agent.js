/**
 * RLAgent — Q-Learning agent for highway traffic anomaly detection.
 *
 * Models the highway as a Markov Decision Process (MDP) where:
 *   - State  = discretized (density, speed, incidentLane)
 *   - Action = { MAINTAIN(0), DIVERT(1), CLEAR(2) }
 *   - Reward = depends on whether the agent correctly identifies incidents
 *
 * States are created lazily in the Q-Table (initially empty).
 * The agent uses epsilon-greedy exploration with exponential decay.
 *
 * @module rl-agent
 */

/** @enum {number} Action space */
export const ACTIONS = Object.freeze({
  MAINTAIN: 0, // Do nothing — let traffic flow naturally
  DIVERT:   1, // Activate detour / reduce highway entry
  CLEAR:    2, // Dispatch tow truck / emergency alert
});

/** Human-readable labels for actions (index → label). */
const ACTION_LABELS = ['MAINTAIN', 'DIVERT', 'CLEAR'];

// ---------------------------------------------------------------------------
// State discretisation thresholds
// ---------------------------------------------------------------------------

const DENSITY_THRESHOLDS = Object.freeze([
  { key: 'low',    min: 0.00, max: 0.33 },
  { key: 'medium', min: 0.33, max: 0.66 },
  { key: 'high',   min: 0.66, max: 1.00 },
]);

const SPEED_THRESHOLDS = Object.freeze([
  { key: 'zero',  min: 0.00, max: 0.01 },
  { key: 'low',   min: 0.01, max: 0.33 },
  { key: 'medium', min: 0.33, max: 0.66 },
  { key: 'high',  min: 0.66, max: 1.00 },
]);

// ---------------------------------------------------------------------------
// RLAgent
// ---------------------------------------------------------------------------

export class RLAgent {
  // Static action constants for external consumers
  static ACTIONS = ACTIONS;

  /**
   * Create a Q-Learning agent.
   *
   * @param {Object} [opts]
   * @param {number} [opts.learningRate=0.1]      Alpha - learning rate
   * @param {number} [opts.discountFactor=0.9]    Gamma - future reward discount
   * @param {number} [opts.epsilon=1.0]           Initial exploration probability
   * @param {number} [opts.epsilonDecay=0.995]    Multiplicative decay per episode
   * @param {number} [opts.minEpsilon=0.01]       Floor for epsilon
   */
  constructor({
    learningRate   = 0.1,
    discountFactor = 0.9,
    epsilon        = 1.0,
    epsilonDecay   = 0.995,
    minEpsilon     = 0.01,
  } = {}) {
    /** @type {number} Learning rate (alpha). */
    this.alpha = learningRate;

    /** @type {number} Discount factor (gamma). */
    this.gamma = discountFactor;

    /** @type {number} Exploration probability. */
    this.epsilon = epsilon;

    /** @type {number} Epsilon decay multiplier. */
    this.epsilonDecay = epsilonDecay;

    /** @type {number} Minimum allowed epsilon. */
    this.minEpsilon = minEpsilon;

    /** @type {Object<string, number[]>} Q-Table: stateKey → [q0, q1, q2]. */
    this.qTable = {};
  }

  // -----------------------------------------------------------------------
  // State helpers (static — usable without an instance)
  // -----------------------------------------------------------------------

  /**
   * Discretise a continuous density value (0–1) into a bucket key.
   *
   * @param {number} value - Normalised density [0, 1]
   * @returns {string} 'low' | 'medium' | 'high'
   */
  static discretiseDensity(value) {
    for (const t of DENSITY_THRESHOLDS) {
      if (value >= t.min && value < t.max) return t.key;
    }
    return 'high'; // exactly 1.0 falls here
  }

  /**
   * Discretise a continuous speed value (0–1, fraction of max speed) into a bucket key.
   *
   * @param {number} value - Normalised speed [0, 1]
   * @returns {string} 'zero' | 'low' | 'medium' | 'high'
   */
  static discretiseSpeed(value) {
    for (const t of SPEED_THRESHOLDS) {
      if (value >= t.min && value < t.max) return t.key;
    }
    return 'high'; // exactly 1.0 falls here
  }

  /**
   * Build a canonical state key from discretised components.
   *
   * @param {string} density      - 'low' | 'medium' | 'high'
   * @param {string} speed        - 'zero' | 'low' | 'medium' | 'high'
   * @param {(number|null)} lane  - Incident lane index (0-3) or null
   * @returns {string} e.g. "low_high_null", "high_zero_2"
   */
  static buildStateKey(density, speed, lane) {
    const laneStr = lane === null ? 'null' : String(lane);
    return `${density}_${speed}_${laneStr}`;
  }

  /**
   * Parse a state key back into its components.
   *
   * @param {string} stateKey
   * @returns {{density: string, speed: string, incidentLane: (number|null)}}
   */
  static parseStateKey(stateKey) {
    const [density, speed, laneStr] = stateKey.split('_');
    return {
      density,
      speed,
      incidentLane: laneStr === 'null' ? null : Number(laneStr),
    };
  }

  // -----------------------------------------------------------------------
  // Q-Table management
  // -----------------------------------------------------------------------

  /**
   * (Re-)initialise the Q-Table to an empty object.
   * All state entries are created lazily on first access.
   */
  initQTable() {
    this.qTable = {};
  }

  /**
   * Retrieve Q-values for a given state key.
   * If the state has never been visited, initialise with [0, 0, 0].
   *
   * @param {string} stateKey
   * @returns {number[]} Array of three Q-values [q0, q1, q2]
   */
  getQValues(stateKey) {
    if (!this.qTable[stateKey]) {
      this.qTable[stateKey] = [0, 0, 0];
    }
    return this.qTable[stateKey];
  }

  // -----------------------------------------------------------------------
  // Action selection (epsilon-greedy)
  // -----------------------------------------------------------------------

  /**
   * Select an action for the given state using epsilon-greedy policy.
   *
   * - With probability epsilon → random action (exploration).
   * - Otherwise → pick the action with the highest Q-value (exploitation).
   *   If multiple actions tie for the maximum, choose randomly among them.
   *
   * @param {string} stateKey
   * @returns {number} 0 (MAINTAIN), 1 (DIVERT), or 2 (CLEAR)
   */
  selectAction(stateKey) {
    // Exploration: uniform random over all actions
    if (Math.random() < this.epsilon) {
      return Math.floor(Math.random() * 3);
    }

    // Exploitation: pick best action (break ties randomly)
    const qValues = this.getQValues(stateKey);
    const maxQ = Math.max(...qValues);

    // Collect all indices that share the maximum value
    const bestActions = [];
    for (let i = 0; i < qValues.length; i++) {
      if (qValues[i] === maxQ) {
        bestActions.push(i);
      }
    }

    return bestActions[Math.floor(Math.random() * bestActions.length)];
  }

  // -----------------------------------------------------------------------
  // Q-Learning update
  // -----------------------------------------------------------------------

  /**
   * Perform a single Q-Learning update step.
   *
   * Formula:
   *   Q(s,a) ← Q(s,a) + α · [ r + γ · max_a' Q(s',a') − Q(s,a) ]
   *
   * @param {string} stateKey     - Current state key before action
   * @param {number} action       - Action taken (0, 1, or 2)
   * @param {number} reward       - Immediate reward received
   * @param {string} nextStateKey - Resulting state key after action
   */
  update(stateKey, action, reward, nextStateKey) {
    const qValues      = this.getQValues(stateKey);
    const nextQValues  = this.getQValues(nextStateKey);
    const maxNextQ     = Math.max(...nextQValues);

    // Classic Q-Learning temporal-difference update
    qValues[action] = qValues[action]
      + this.alpha * (reward + this.gamma * maxNextQ - qValues[action]);
  }

  // -----------------------------------------------------------------------
  // Reward function
  // -----------------------------------------------------------------------

  /**
   * Calculate the immediate reward for taking an action in a given state.
   *
   * Priority-ordered rules:
   *   1. +20 — Incident correctly cleared  (incidentLane != null  && action = CLEAR)
   *   2. −30 — Incident ignored            (incidentLane != null  && action = MAINTAIN)
   *   3. −10 — False positive intervention (incidentLane == null  && action ∈ {DIVERT, CLEAR})
   *   4. +10 — Normal traffic, no incident (incidentLane == null  && speed ≠ "zero")
   *   5.   0 — All other cases (e.g. incident + DIVERT, or stalled flow with no lane flagged)
   *
   * @param {{density: string, speed: string, incidentLane: (number|null)}} state
   * @param {number} action - Action taken (0, 1, or 2)
   * @returns {number} Scalar reward
   */
  calculateReward(state, action) {
    const hasIncident = state.incidentLane !== null;

    // Rule 1 — correct detection & clearance
    if (hasIncident && action === ACTIONS.CLEAR) {
      return 20;
    }

    // Rule 2 — false negative: incident exists but agent did nothing
    if (hasIncident && action === ACTIONS.MAINTAIN) {
      return -30;
    }

    // Rule 3 — false positive: no incident but agent intervened
    if (!hasIncident && (action === ACTIONS.DIVERT || action === ACTIONS.CLEAR)) {
      return -10;
    }

    // Rule 4 — everything is normal: no incident, flow is not stalled
    if (!hasIncident && state.speed !== 'zero') {
      return 10;
    }

    // Rule 5 — neutral fallback
    return 0;
  }

  // -----------------------------------------------------------------------
  // Exploration decay
  // -----------------------------------------------------------------------

  /**
   * Decay epsilon by multiplying with epsilonDecay and clamping to minEpsilon.
   * Call this once per episode (or per decision cycle, depending on design).
   *
   * @returns {number} New epsilon value
   */
  decayEpsilon() {
    this.epsilon = Math.max(this.epsilon * this.epsilonDecay, this.minEpsilon);
    return this.epsilon;
  }

  // -----------------------------------------------------------------------
  // Statistics & diagnostics
  // -----------------------------------------------------------------------

  /**
   * Return a lightweight stats snapshot useful for live monitoring.
   *
   * @returns {{tableSize: number, epsilon: number}}
   */
  getStats() {
    return {
      tableSize: Object.keys(this.qTable).length,
      epsilon:   this.epsilon,
    };
  }

  /**
   * Return the full Q-Table as a plain object (shallow copy for safety).
   *
   * @returns {Object<string, number[]>}
   */
  exportQTable() {
    return { ...this.qTable };
  }

  /**
   * Get a human-readable summary of the best action per known state.
   *
   * @returns {Array<{state: string, bestAction: string, qValues: number[]}>}
   */
  getPolicySummary() {
    return Object.entries(this.qTable).map(([state, qValues]) => {
      const maxQ       = Math.max(...qValues);
      const bestIdx    = qValues.indexOf(maxQ);
      return {
        state,
        bestAction: ACTION_LABELS[bestIdx],
        qValues:    [...qValues],
      };
    });
  }

  // -----------------------------------------------------------------------
  // Serialisation (localStorage-friendly)
  // -----------------------------------------------------------------------

  /**
   * Serialise agent state to a plain object.
   *
   * Saved fields: qTable, epsilon, alpha, gamma, epsilonDecay, minEpsilon.
   *
   * @returns {Object}
   */
  toJSON() {
    return {
      qTable:       { ...this.qTable },
      epsilon:      this.epsilon,
      alpha:        this.alpha,
      gamma:        this.gamma,
      epsilonDecay: this.epsilonDecay,
      minEpsilon:   this.minEpsilon,
    };
  }

  /**
   * Restore agent state from a previously serialised JSON object.
   *
   * @param {Object} data - Result of a previous toJSON() call
   */
  fromJSON(data) {
    this.qTable       = data.qTable ? { ...data.qTable } : {};
    this.epsilon      = data.epsilon      ?? 1.0;
    this.alpha        = data.alpha        ?? 0.1;
    this.gamma        = data.gamma        ?? 0.9;
    this.epsilonDecay = data.epsilonDecay ?? 0.995;
    this.minEpsilon   = data.minEpsilon   ?? 0.01;
  }
}
