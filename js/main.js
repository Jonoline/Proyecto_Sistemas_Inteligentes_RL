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
const speedSlider  = document.getElementById('speed-slider');
const speedLabel   = document.getElementById('speed-label');
const rewTotalEl   = document.getElementById('reward-total');
const cooldownEl   = document.getElementById('agent-cooldown');
const decisionEl  = document.getElementById('decision-progress');

// Configuración del canvas de autopista
highwayCanvas.width  = 900;
highwayCanvas.height = 260;
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
  epsilonDecay:   0.99,
  minEpsilon:     0.02,
});

const viz = new Visualizer(highwayCanvas, chartCanvas, panelEls);

// ---------------------------------------------------------------------------
// Estado del loop
// ---------------------------------------------------------------------------

/** Contador de ticks desde el inicio. */
let tick = 0;

/** Cada cuantos ticks el agente toma una decision. */
const DECISION_INTERVAL = 120; // ~2 segundos a 60fps

/** Recompensa acumulada total. */
let cumulativeReward = 0;

/** Velocidad de simulacion (multiplicador de ticks por frame). */
let simSpeed = 1; // se actualiza al cargar con el slider

function sliderToSpeed(pos) {
  const t = pos / 100;
  return 0.5 + 19.5 * t * t;
}

function speedToSlider(spd) {
  return Math.round(Math.sqrt((spd - 0.5) / 19.5) * 100);
}

/** Simulacion pausada. */
let paused = false;

/** Agente pausado (simulación sigue corriendo sin decisiones RL). */
let agentPaused = false;

/** Historial de las ultimas 10 decisiones. */
const decisionHistory = [];
const MAX_HISTORY = 6;

/** Ultima recompensa obtenida (para el grafico). */
let lastReward = 0;

/** Flags para marcadores del grafico. */
let decisionFlag = false;
let incidentFlag = false;

/** Modo automatico de incidentes (se generan solos). */
let autoIncidentMode = true;

/** Contador para actualizar el grafico a ritmo constante. */
let chartTimer = 0;

/** Contador para generar accidentes automaticos. */
let autoIncidentTimer = 0;
/** Intervalo actual para el proximo accidente (se sortea entre 2-8s). */
let autoIncidentInterval = randomIncidentInterval();

function randomIncidentInterval() {
  return 320 + Math.floor(Math.random() * 281); // 320-600 ticks = 5.3-10s
}

/** Si hay una acción DIVERT activa (spawn rate reducido). */
let divertActive = false;
let divertTimer  = 0;
const DIVERT_DURATION = 180; // ticks que dura el desvio
const DIVERT_SPAWN_RATE = 0.15; // spawn rate durante desvio

/** Tiempo de enfriamiento de la grua (ticks). */
const CLEAR_COOLDOWN = 300;

/** Contador de enfriamiento de la grúa (0 = disponible). */
let clearCooldown = 0;

// ---------------------------------------------------------------------------
// Ciclo de decisión del agente
// ---------------------------------------------------------------------------

/**
 * Ejecuta un paso de decisión RL: observar → actuar → recompensa → actualizar.
 */
function agentDecision() {
  const baseKey = sim.getStateKey();
  const gruaStatus = clearCooldown > 0 ? '_cooldown' : '_lista';
  const currentStateKey = baseKey + gruaStatus;
  const currentState    = sim.getState();

  // Seleccionar accion
  let action = agent.selectAction(currentStateKey);
  const selectedAction = action; // accion original del agente
  let executedAction = action;   // accion que realmente se ejecuta

  // Si el agente pide CLEAR pero esta en enfriamiento, se anula
  let reward;
  if (action === ACTIONS.CLEAR && clearCooldown > 0) {
    // Grua no disponible: ejecutar MAINTAIN, penalizar CLEAR
    executedAction = ACTIONS.MAINTAIN;
    executeAction(executedAction);
    reward = -5;
  } else {
    // Ejecutar accion normalmente
    executeAction(action);
    reward = agent.calculateReward(currentState, action);
  }

  // Ajuste: DIVERT con grua lista da menos recompensa que con cooldown
  if (executedAction === ACTIONS.DIVERT && currentState.incidentLane !== null) {
    if (clearCooldown === 0) {
      reward = 2;  // grua disponible: DIVERT es suboptimo
    }
    // si clearCooldown > 0, se mantiene el +5 original
  }

  // Observar nuevo estado tras la accion
  const nextBaseKey = sim.getStateKey();
  const nextGruaStatus = clearCooldown > 0 ? '_cooldown' : '_lista';
  const nextStateKey = nextBaseKey + nextGruaStatus;

  // Actualizar Q-Table con la accion original seleccionada
  agent.update(currentStateKey, selectedAction, reward, nextStateKey);

  // Acumular
  cumulativeReward += reward;
  lastReward = reward;
  decisionFlag = true;

  // --- Efectos visuales segun la accion ejecutada ---
  viz.showActionOverlay(executedAction);

  if (executedAction === ACTIONS.CLEAR && sim.incident.vehicle) {
    viz.triggerClearFlash(
      sim.incident.vehicle.x + sim.incident.vehicle.width / 2,
      sim.incident.vehicle.y + sim.incident.vehicle.height / 2
    );
  }

  if (executedAction === ACTIONS.DIVERT && divertActive) {
    viz.setDivertBarrier(true, sim.incident.lane);
  }

  // --- Historial de decisiones ---
  decisionHistory.push({
    tick,
    stateKey: baseKey,
    action: selectedAction,
    reward,
  });
  if (decisionHistory.length > MAX_HISTORY) {
    decisionHistory.shift();
  }
  viz.renderHistory(decisionHistory);

  // Actualizar panel del agente
  const stats         = agent.getStats();
  const policySummary = agent.getPolicySummary();
  viz.updateAgentPanel(currentState, executedAction, reward, cumulativeReward, stats, policySummary);
  rewTotalEl.textContent = cumulativeReward.toFixed(0);

  // Decaer epsilon en cada decision
  agent.decayEpsilon();
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
      // Despejar incidente con grúa (solo si no está en enfriamiento)
      if (sim.incident.active) {
        sim.clearIncident();
        autoIncidentTimer = 0;
        autoIncidentInterval = randomIncidentInterval();
        clearCooldown = CLEAR_COOLDOWN;
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

      // Enfriamiento de la grúa
      if (clearCooldown > 0) {
        clearCooldown--;
      }

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
        if (autoIncidentTimer >= autoIncidentInterval && !sim.incident.active) {
          autoIncidentTimer = 0;
          autoIncidentInterval = randomIncidentInterval();
          const randomLane = Math.floor(Math.random() * sim.laneCount);
          sim.triggerIncident(randomLane);
          incidentFlag = true;
        }
      }

      // El agente decide cada DECISION_INTERVAL ticks (si no está pausado)
      if (!agentPaused && tick % DECISION_INTERVAL === 0) {
        agentDecision();
      }
    }
  }

  // Renderizar (siempre, incluso en pausa)
  viz.render(sim, paused, simSpeed);

  // Actualizar grafico de metricas a ritmo constante
  chartTimer += simSpeed;
  if (!paused && chartTimer >= 3) {
    chartTimer = 0;
    viz.pushMetrics(sim.metrics.avgSpeed, lastReward, decisionFlag, incidentFlag);
    decisionFlag = false;
    incidentFlag = false;
    viz.renderChart();
  }

  // Actualizar indicador de cooldown
  if (clearCooldown > 0) {
    const secs = (clearCooldown / 60).toFixed(1);
    cooldownEl.innerHTML = `<span class="cooldown-active">Enfriamiento: ${secs}s</span>`;
  } else {
    cooldownEl.innerHTML = '<span class="cooldown-ready">Lista</span>';
  }

  // Cuenta regresiva hacia la proxima decision
  const nextDecision = DECISION_INTERVAL - (tick % DECISION_INTERVAL);
  const secs = (nextDecision / 60).toFixed(1);
  decisionEl.innerHTML = `<span class="decision-countdown">${secs}s</span>`;

  requestAnimationFrame(mainLoop);
}

// ---------------------------------------------------------------------------
// Controles de UI
// ---------------------------------------------------------------------------

btnTrigger.addEventListener('click', () => {
  if (!sim.incident.active) {
    const lane = Math.floor(Math.random() * sim.laneCount);
    sim.triggerIncident(lane);
    incidentFlag = true;
  }
});

btnClear.addEventListener('click', () => {
  if (sim.incident.active) {
    sim.clearIncident();
    autoIncidentTimer = 0;
    autoIncidentInterval = randomIncidentInterval();
  }
});

btnReset.addEventListener('click', () => {
  tick = 0;
  cumulativeReward = 0;
  divertActive = false;
  divertTimer = 0;
  clearCooldown = 0;
  lastReward = 0;
  chartTimer = 0;
  decisionFlag = false;
  incidentFlag = false;
  autoIncidentTimer = 0;
  autoIncidentInterval = randomIncidentInterval();
  paused = false;
  agentPaused = false;
  btnPause.textContent = 'Pausar';
  btnPause.classList.remove('active');
  btnPauseAgent.textContent = 'Agente: ACTIVADO';
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
  autoIncidentInterval = randomIncidentInterval();
  btnAutoInc.textContent = autoIncidentMode ? 'Auto-Accidentes: ACTIVADO' : 'Auto-Accidentes: DESACTIVADO';
  btnAutoInc.classList.toggle('active', autoIncidentMode);
});

speedSlider.addEventListener('input', () => {
  let pos = parseFloat(speedSlider.value);
  let val = sliderToSpeed(pos);
  // Ajustar a valores clave si esta cerca
  for (const snap of [1, 5, 10, 20]) {
    if (Math.abs(val - snap) < 0.35) { val = snap; speedSlider.value = speedToSlider(snap); break; }
  }
  simSpeed = val;
  speedLabel.textContent = (val % 1 === 0 ? val.toFixed(0) : val.toFixed(1)) + 'x';
});

btnPause.addEventListener('click', () => {
  paused = !paused;
  btnPause.textContent = paused ? 'Continuar' : 'Pausar';
  btnPause.classList.toggle('active', paused);
});

btnPauseAgent.addEventListener('click', () => {
  agentPaused = !agentPaused;
  btnPauseAgent.textContent = agentPaused ? 'Agente: DESACTIVADO' : 'Agente: ACTIVADO';
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

// Tamaños iniciales fijos
highwayCanvas.width  = 700;
highwayCanvas.height = 260;
sim.canvasWidth  = 700;
sim.canvasHeight = 260;
chartCanvas.width  = 680;
chartCanvas.height = 160;

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

// Activar auto-accidentes por defecto
btnAutoInc.textContent = 'Auto-Accidentes: ACTIVADO';
btnAutoInc.classList.add('active');

// Iniciar loop
requestAnimationFrame(mainLoop);

// ---------------------------------------------------------------------------
// Navegacion: highlight del enlace activo al hacer scroll
// ---------------------------------------------------------------------------

const navLinks = document.querySelectorAll('.nav-link');
const sections = document.querySelectorAll('section[id], div[id="conceptos"]');

window.addEventListener('scroll', () => {
  let current = '';
  sections.forEach(section => {
    const top = section.offsetTop - 100;
    if (window.scrollY >= top) current = section.getAttribute('id');
  });
  navLinks.forEach(link => {
    link.classList.toggle('active', link.getAttribute('href') === '#' + current);
  });
});
