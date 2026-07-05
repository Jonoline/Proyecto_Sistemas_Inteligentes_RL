/**
 * main — Loop principal del simulador de tráfico inteligente.
 *
 * Orquesta la interacción entre Simulation, RLAgent y Visualizer.
 * Gestiona el ciclo de decisión, la ejecución de acciones y los
 * controles de interfaz de usuario.
 *
 * @module main
 */

import { Simulation } from './simulation.js';
import { RLAgent, ACTIONS }    from './rl-agent.js';
import { Visualizer }          from './visualizer.js';

// ---------------------------------------------------------------------------
// Referencias al DOM
// ---------------------------------------------------------------------------

const highwayCanvas = document.getElementById('highway-canvas');
const chartCanvas   = document.getElementById('chart-canvas');
const panelEls = {
  stateEl:   document.getElementById('agent-state'),
  actionEl:  document.getElementById('agent-action'),
  rewardEl:  document.getElementById('agent-reward'),
  epsilonEl: document.getElementById('agent-epsilon'),
  policyEl:  document.getElementById('agent-policy'),
  historyEl: document.getElementById('agent-history'),
};

// Controles
const btnTrigger   = document.getElementById('btn-trigger');
const btnClear     = document.getElementById('btn-clear');
const btnReset     = document.getElementById('btn-reset');
const btnAutoInc   = document.getElementById('btn-auto-incident');
const btnPause     = document.getElementById('btn-pause');
const btnPauseAgent = document.getElementById('btn-pause-agent');
const speedSelect  = document.getElementById('speed-select');
const rewTotalEl   = document.getElementById('reward-total');

// Configuración del canvas de autopista
highwayCanvas.width  = 900;
highwayCanvas.height = 280;
chartCanvas.width    = 480;
chartCanvas.height   = 160;

// ---------------------------------------------------------------------------
// Instancias
// ---------------------------------------------------------------------------

const sim = new Simulation({
  canvasWidth:  highwayCanvas.width,
  canvasHeight: highwayCanvas.height,
  laneCount: 4,
  maxVehicles: 40,
  spawnRate: 0.5,
});

const agent = new RLAgent({
  learningRate:   0.1,
  discountFactor: 0.9,
  epsilon:        1.0,
  epsilonDecay:   0.997,
  minEpsilon:     0.02,
});

const viz = new Visualizer(highwayCanvas, chartCanvas, panelEls);

// ---------------------------------------------------------------------------
// Estado del loop
// ---------------------------------------------------------------------------

/** Contador de ticks desde el inicio. */
let tick = 0;

/** Cada cuántos ticks el agente toma una decisión. */
const DECISION_INTERVAL = 45;

/** Recompensa acumulada total. */
let cumulativeReward = 0;

/** Velocidad de simulación (múltiplo de ticks por frame). */
let simSpeed = parseFloat(speedSelect.value);

/** Simulación pausada. */
let paused = false;

/** Agente pausado (simulación sigue corriendo sin decisiones RL). */
let agentPaused = false;

/** Historial de las últimas 10 decisiones. */
const decisionHistory = [];
const MAX_HISTORY = 10;

/** Modo automático de incidentes (se generan solos). */
let autoIncidentMode = false;

/** Contador para generar incidentes automáticos. */
let autoIncidentTimer = 0;
const AUTO_INCIDENT_INTERVAL = 300; // ~5 segundos a 60fps

/** Si hay una acción DIVERT activa (spawn rate reducido). */
let divertActive = false;
let divertTimer  = 0;
const DIVERT_DURATION = 120; // ticks que dura el desvío
const DIVERT_SPAWN_RATE = 0.15; // spawn rate durante desvío

// ---------------------------------------------------------------------------
// Ciclo de decisión del agente
// ---------------------------------------------------------------------------

/**
 * Ejecuta un paso de decisión RL: observar → actuar → recompensa → actualizar.
 */
function agentDecision() {
  const currentStateKey = sim.getStateKey();
  const currentState    = sim.getState();

  // Seleccionar acción
  const action = agent.selectAction(currentStateKey);

  // Ejecutar acción en la simulación
  executeAction(action);

  // Observar nuevo estado tras la acción
  const nextStateKey = sim.getStateKey();

  // Calcular recompensa
  const reward = agent.calculateReward(currentState, action);

  // Actualizar Q-Table
  agent.update(currentStateKey, action, reward, nextStateKey);

  // Acumular
  cumulativeReward += reward;

  // --- Efectos visuales según la acción ---
  viz.showActionOverlay(action);

  if (action === ACTIONS.CLEAR && sim.incident.vehicle) {
    viz.triggerClearFlash(
      sim.incident.vehicle.x + sim.incident.vehicle.width / 2,
      sim.incident.vehicle.y + sim.incident.vehicle.height / 2
    );
  }

  if (action === ACTIONS.DIVERT && divertActive) {
    viz.setDivertBarrier(true);
  }

  // --- Historial de decisiones ---
  decisionHistory.push({
    tick,
    stateKey: currentStateKey,
    action,
    reward,
  });
  if (decisionHistory.length > MAX_HISTORY) {
    decisionHistory.shift();
  }
  viz.renderHistory(decisionHistory);

  // Actualizar panel del agente
  const stats         = agent.getStats();
  const policySummary = agent.getPolicySummary();
  viz.updateAgentPanel(currentState, action, reward, cumulativeReward, stats, policySummary);
  rewTotalEl.textContent = cumulativeReward.toFixed(0);

  // Decaer epsilon cada cierto número de decisiones
  if (tick % (DECISION_INTERVAL * 3) === 0) {
    agent.decayEpsilon();
  }
}

/**
 * Ejecuta la acción seleccionada por el agente en el entorno.
 * @param {number} action - 0 (MAINTAIN), 1 (DIVERT), 2 (CLEAR)
 */
function executeAction(action) {
  switch (action) {
    case ACTIONS.MAINTAIN:
      // No hacer nada; si había desvío activo no lo interrumpe
      break;

    case ACTIONS.DIVERT:
      // Activar desvío: reducir spawn rate
      if (!divertActive) {
        sim.setSpawnRate(DIVERT_SPAWN_RATE);
        divertActive = true;
        divertTimer  = DIVERT_DURATION;
      }
      break;

    case ACTIONS.CLEAR:
      // Despejar incidente con grúa
      if (sim.incident.active) {
        sim.clearIncident();
      }
      break;
  }
}

// ---------------------------------------------------------------------------
// Bucle principal
// ---------------------------------------------------------------------------

/**
 * Loop principal. Se ejecuta vía requestAnimationFrame.
 */
function mainLoop() {
  if (!paused) {
    // Ejecutar N ticks de simulación según la velocidad
    for (let i = 0; i < simSpeed; i++) {
      sim.update();
      tick++;

      // Gestionar temporizador de desvío
      if (divertActive) {
        divertTimer--;
        if (divertTimer <= 0) {
          sim.setSpawnRate(0.5);
          divertActive = false;
          viz.setDivertBarrier(false);
        }
      }

      // Generar incidentes automáticos
      if (autoIncidentMode) {
        autoIncidentTimer++;
        if (autoIncidentTimer >= AUTO_INCIDENT_INTERVAL && !sim.incident.active) {
          autoIncidentTimer = 0;
          const randomLane = Math.floor(Math.random() * sim.laneCount);
          sim.triggerIncident(randomLane);
        }
      }

      // El agente decide cada DECISION_INTERVAL ticks (si no está pausado)
      if (!agentPaused && tick % DECISION_INTERVAL === 0) {
        agentDecision();
      }
    }
  }

  // Renderizar (siempre, incluso en pausa)
  viz.render(sim, paused);

  // Actualizar gráfico de métricas (solo si no está pausado)
  if (!paused && tick % 3 === 0) {
    viz.pushMetrics(sim.metrics.avgSpeed, sim.metrics.flowPerMinute);
    viz.renderChart();
  }

  requestAnimationFrame(mainLoop);
}

// ---------------------------------------------------------------------------
// Controles de UI
// ---------------------------------------------------------------------------

btnTrigger.addEventListener('click', () => {
  if (!sim.incident.active) {
    const lane = Math.floor(Math.random() * sim.laneCount);
    sim.triggerIncident(lane);
  }
});

btnClear.addEventListener('click', () => {
  if (sim.incident.active) {
    sim.clearIncident();
  }
});

btnReset.addEventListener('click', () => {
  tick = 0;
  cumulativeReward = 0;
  divertActive = false;
  divertTimer = 0;
  paused = false;
  agentPaused = false;
  btnPause.textContent = '⏸ Pausar';
  btnPause.classList.remove('active');
  btnPauseAgent.textContent = '🧠 Agente: ON';
  btnPauseAgent.classList.remove('active');
  decisionHistory.length = 0;
  sim.init();
  agent.initQTable();
  agent.epsilon = 1.0;
  viz.setDivertBarrier(false);
  viz.resetChart();
  viz.renderHistory([]);
  rewTotalEl.textContent = '0';
  viz.updateAgentPanel(
    { density: 'low', speed: 'high', incidentLane: null },
    0, 0, 0,
    { tableSize: 0, epsilon: 1.0 },
    []
  );
});

btnAutoInc.addEventListener('click', () => {
  autoIncidentMode = !autoIncidentMode;
  autoIncidentTimer = 0;
  btnAutoInc.textContent = autoIncidentMode ? 'Auto-Incidentes: ON' : 'Auto-Incidentes: OFF';
  btnAutoInc.classList.toggle('active', autoIncidentMode);
});

speedSelect.addEventListener('change', () => {
  simSpeed = parseFloat(speedSelect.value);
});

btnPause.addEventListener('click', () => {
  paused = !paused;
  btnPause.textContent = paused ? '▶ Continuar' : '⏸ Pausar';
  btnPause.classList.toggle('active', paused);
});

btnPauseAgent.addEventListener('click', () => {
  agentPaused = !agentPaused;
  btnPauseAgent.textContent = agentPaused ? '🧠 Agente: OFF' : '🧠 Agente: ON';
  btnPauseAgent.classList.toggle('active', agentPaused);
});

// ---------------------------------------------------------------------------
// Persistencia de Q-Table en localStorage
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'traffic-rl-qtable';

function saveQTable() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(agent.toJSON()));
  } catch (_) { /* storage full or unavailable */ }
}

function loadQTable() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      agent.fromJSON(JSON.parse(raw));
    }
  } catch (_) { /* ignore */ }
}

// Guardar periódicamente
setInterval(saveQTable, 5000);

// Guardar antes de cerrar
window.addEventListener('beforeunload', saveQTable);

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------

sim.init();
loadQTable();
cumulativeReward = 0;

// Actualizar panel inicial
viz.updateAgentPanel(
  { density: 'low', speed: 'high', incidentLane: null },
  0, 0, 0,
  agent.getStats(),
  agent.getPolicySummary()
);

// Iniciar loop
requestAnimationFrame(mainLoop);
