/**
 * Simulation — Motor de simulación de tráfico para autopista de 4 carriles.
 *
 * Responsabilidades:
 *  - Gestión de vehículos (spawn, movimiento, eliminación)
 *  - Evasión de colisiones por carril (modelo de seguimiento de vehículo líder)
 *  - Gestión de incidentes (parada forzada, bloqueo de carril, reanudación)
 *  - Cálculo de métricas agregadas (velocidad media, flujo, densidad)
 *  - Discretización del estado para RL (Q-Learning)
 *
 * @module simulation
 */

// ---------------------------------------------------------------------------
// Constantes de configuración interna
// ---------------------------------------------------------------------------

/** Velocidad máxima teórica (px/frame) usada como referencia para discretización. */
const MAX_SPEED_REF = 3;

/** Distancia de seguridad base entre vehículos del mismo carril (px). */
const SAFE_DISTANCE_BASE = 40;

/** Factor de distancia de seguridad proporcional a la velocidad. */
const SAFE_DISTANCE_SPEED_FACTOR = 10;

/** Probabilidad base de spawn cuando spawnRate = 1.0. */
const SPAWN_BASE_PROBABILITY = 0.10;

/** Dimensiones visuales de un vehículo normal (ancho x alto en px). */
const VEHICLE_WIDTH = 34;
const VEHICLE_HEIGHT = 16;

/** Velocidad mínima y máxima de spawn para vehículos normales (px/frame). */
const SPAWN_SPEED_MIN = 0.7;
const SPAWN_SPEED_MAX = 2.0;

/** Decaimiento de frenado (reducción de velocidad por frame cuando frena). */
const BRAKE_DECAY = 0.15;

/** Incremento de aceleración al reanudar la marcha. */
const ACCEL_STEP = 0.12;

/** Ventana de ticks para calcular el flujo por minuto (asumiendo 60 fps). */
const FLOW_WINDOW = 60;

/** Tipos de vehículo base (color de carrocería). */
const VEHICLE_TYPES = ['blue', 'green', 'gray'];

/** Probabilidad de que un vehículo sea de tipo "especial" (rojo). */
const SPECIAL_PROB = 0.08;

// ---------------------------------------------------------------------------
// Clase principal
// ---------------------------------------------------------------------------

export class Simulation {
  /**
   * @param {Object} config - Configuración de la simulación.
   * @param {number} config.canvasWidth  - Ancho del área de renderizado (px).
   * @param {number} config.canvasHeight - Alto del área de renderizado (px).
   * @param {number} [config.laneCount=4]    - Número de carriles.
   * @param {number} [config.maxVehicles=40] - Máximo de vehículos simultáneos.
   * @param {number} [config.spawnRate=0.5]  - Tasa de spawn inicial (0–1).
   */
  constructor({
    canvasWidth,
    canvasHeight,
    laneCount = 4,
    maxVehicles = 40,
    spawnRate = 0.5,
  }) {
    /** @type {number} Ancho del canvas (px). */
    this.canvasWidth = canvasWidth;

    /** @type {number} Alto del canvas (px). */
    this.canvasHeight = canvasHeight;

    /** @type {number} Número de carriles. */
    this.laneCount = laneCount;

    /** @type {number} Máximo número de vehículos simultáneos. */
    this.maxVehicles = maxVehicles;

    /** @type {number} Tasa de spawn actual (0–1, controlada por RL). */
    this.spawnRate = spawnRate;

    /** @type {Array<Object>} Carriles [{ y, vehicles[], blocked }]. */
    this.lanes = [];

    /** @type {Array<Object>} Array plano de todos los vehículos. */
    this.vehicles = [];

    /**
     * Estado del incidente activo.
     * @type {{ active: boolean, vehicle: Object|null, lane: number, tickCount: number }}
     */
    this.incident = {
      active: false,
      vehicle: null,
      lane: -1,
      tickCount: 0,
    };

    /**
     * Métricas agregadas.
     * @type {{ avgSpeed: number, flowPerMinute: number, vehicleCount: number, density: number }}
     */
    this.metrics = {
      avgSpeed: 0,
      flowPerMinute: 0,
      vehicleCount: 0,
      density: 0,
    };

    /** @type {number} Contador de ticks transcurridos. */
    this.tick = 0;

    /**
     * Historial de salidas (cuántos vehículos salieron en cada tick) para
     * calcular el flujo por minuto sobre una ventana deslizante.
     * @type {number[]}
     */
    this._exitHistory = new Array(FLOW_WINDOW).fill(0);

    /** Índice corriente en el buffer circular de salidas. */
    this._exitIndex = 0;
  }

  // -----------------------------------------------------------------------
  // Inicialización
  // -----------------------------------------------------------------------

  /**
   * Inicializa los carriles y puebla los vehículos iniciales.
   *
   * Calcula las posiciones Y de cada carril espaciadas uniformemente a lo
   * largo del canvas y crea un conjunto inicial de vehículos distribuidos.
   */
  init() {
    const laneHeight = this.canvasHeight / this.laneCount;
    const laneMidOffset = laneHeight / 2;

    this.lanes = [];
    for (let i = 0; i < this.laneCount; i++) {
      this.lanes.push({
        y: i * laneHeight + laneMidOffset,
        vehicles: [],
        blocked: false,
      });
    }

    // Poblar con ≈ 40 % de la capacidad máxima como estado inicial
    const initialCount = Math.floor(this.maxVehicles * 0.4);
    for (let i = 0; i < initialCount; i++) {
      this.spawnVehicle();
    }
  }

  // -----------------------------------------------------------------------
  // Gestión de vehículos
  // -----------------------------------------------------------------------

  /**
   * Crea un nuevo vehículo en x=0 en un carril aleatorio.
   *
   * Se asigna una velocidad aleatoria dentro del rango definido y un tipo
   * de vehículo (color de carrocería). La mayoría son azul/verde/gris; un
   * pequeño porcentaje recibe el tipo especial "red".
   *
   * @returns {Object|null} El vehículo creado, o null si no hay hueco.
   */
  spawnVehicle() {
    if (this.vehicles.length >= this.maxVehicles) return null;

    // Elegir un carril aleatorio que no tenga un vehículo muy cerca de x=0
    const laneIdx = Math.floor(Math.random() * this.laneCount);

    // Verificar que el carril esté libre cerca del punto de spawn
    const laneVehicles = this.lanes[laneIdx].vehicles;
    const tooClose = laneVehicles.some((v) => v.x < VEHICLE_WIDTH + 10);
    if (tooClose) return null;

    const speed =
      SPAWN_SPEED_MIN +
      Math.random() * (SPAWN_SPEED_MAX - SPAWN_SPEED_MIN);

    const type = Math.random() < SPECIAL_PROB
      ? 'red'
      : VEHICLE_TYPES[Math.floor(Math.random() * VEHICLE_TYPES.length)];

    const vehicle = {
      x: 0,
      y: this.lanes[laneIdx].y - VEHICLE_HEIGHT / 2,
      speed,
      targetSpeed: speed,
      width: VEHICLE_WIDTH,
      height: VEHICLE_HEIGHT,
      type,
      color: 'normal', // estado visual: normal | braking | stopped | hazard
      lane: laneIdx,
      isIncident: false,
      emergencyLights: false,
      stopped: false,
    };

    this.lanes[laneIdx].vehicles.push(vehicle);
    this.vehicles.push(vehicle);
    return vehicle;
  }

  /**
   * Elimina un vehículo del sistema.
   * @param {Object} vehicle - Vehículo a eliminar.
   */
  removeVehicle(vehicle) {
    const lane = this.lanes[vehicle.lane];
    lane.vehicles = lane.vehicles.filter((v) => v !== vehicle);
    this.vehicles = this.vehicles.filter((v) => v !== vehicle);
  }

  // -----------------------------------------------------------------------
  // Lógica de colisión / frenado
  // -----------------------------------------------------------------------

  /**
   * Busca el vehículo inmediatamente por delante en el mismo carril.
   *
   * Los vehículos de cada carril se mantienen ordenados por posición X
   * para que la búsqueda sea eficiente. Devuelve el vehículo líder más
   * cercano situado por delante del vehículo dado.
   *
   * @param {Object} vehicle - Vehículo de referencia.
   * @returns {Object|null} Vehículo líder o null si no hay ninguno delante.
   */
  getVehicleAhead(vehicle) {
    const laneVehicles = this.lanes[vehicle.lane].vehicles;

    // Ordenar el carril por posición X (ascendente)
    // Se hace en cada consulta; para >40 vehículos es aceptable.
    laneVehicles.sort((a, b) => a.x - b.x);

    const idx = laneVehicles.indexOf(vehicle);
    if (idx === -1 || idx === laneVehicles.length - 1) return null;
    return laneVehicles[idx + 1];
  }

  /**
   * Calcula la distancia de seguridad dinámica para un vehículo.
   *
   * @param {Object} vehicle - Vehículo para el que calcular la distancia.
   * @returns {number} Distancia de seguridad en píxeles.
   */
  safeDistanceFor(vehicle) {
    return SAFE_DISTANCE_BASE + vehicle.speed * SAFE_DISTANCE_SPEED_FACTOR;
  }

  /**
   * Aplica lógica de evitación de colisiones al vehículo.
   *
   * Si hay un vehículo por delante en el mismo carril demasiado cerca,
   * reduce la velocidad del vehículo actual gradualmente. Si el vehículo
   * líder está completamente parado, el vehículo actual frena hasta
   * detenerse manteniendo la distancia de seguridad.
   *
   * @param {Object} vehicle - Vehículo a procesar.
   */
  applyCollisionAvoidance(vehicle) {
    const ahead = this.getVehicleAhead(vehicle);
    if (!ahead) {
      // Sin vehículo delante: acelerar hacia targetSpeed
      if (vehicle.speed < vehicle.targetSpeed) {
        vehicle.speed = Math.min(
          vehicle.speed + ACCEL_STEP,
          vehicle.targetSpeed
        );
      }
      vehicle.stopped = false;
      vehicle.color = 'normal';
      return;
    }

    const gap = ahead.x - vehicle.x - vehicle.width;
    const safeDist = this.safeDistanceFor(vehicle);

    if (gap < safeDist) {
      // Demasiado cerca: frenar
      vehicle.speed = Math.max(vehicle.speed - BRAKE_DECAY, 0);
      vehicle.color = ahead.speed < 0.1 ? 'stopped' : 'braking';

      if (vehicle.speed < 0.1) {
        vehicle.stopped = true;
        vehicle.color = 'stopped';
      }
    } else if (vehicle.speed < vehicle.targetSpeed) {
      // Distancia segura: acelerar si es posible
      vehicle.speed = Math.min(
        vehicle.speed + ACCEL_STEP,
        vehicle.targetSpeed
      );
      vehicle.stopped = false;
      vehicle.color = 'normal';
    }
  }

  // -----------------------------------------------------------------------
  // Bucle principal
  // -----------------------------------------------------------------------

  /**
   * Tick principal de simulación. Se llama una vez por frame (60 fps
   * esperados). Ejecuta en orden:
   *
   * 1. Mover vehículos y registrar salidas.
   * 2. Aplicar evitación de colisiones.
   * 3. Gestionar vehículos que salen del canvas.
   * 4. Generar nuevos vehículos (spawn probabilístico).
   * 5. Actualizar métricas.
   * 6. Incrementar contador de incidente si procede.
   */
  update() {
    this.tick++;

    let exitedThisTick = 0;

    // 1. Mover todos los vehículos
    for (const v of this.vehicles) {
      v.x += v.speed;
    }

    // 2. Reordenar carriles + aplicar colisiones
    for (const lane of this.lanes) {
      lane.vehicles.sort((a, b) => a.x - b.x);
    }
    for (const v of this.vehicles) {
      // Los vehículos de incidente nunca aceleran; se mantienen parados
      if (v.isIncident) {
        v.speed = 0;
        v.stopped = true;
        v.color = 'hazard';
        continue;
      }

      // Si el vehículo no es incidente pero tiene luces de emergencia
      // activadas por estar detenido tras un incidente, gestionamos el color
      if (v.emergencyLights) {
        v.color = 'hazard';
      }

      this.applyCollisionAvoidance(v);
    }

    // 3. Eliminar vehículos que han salido del canvas por la derecha
    for (let i = this.vehicles.length - 1; i >= 0; i--) {
      const v = this.vehicles[i];
      if (v.x > this.canvasWidth + v.width) {
        // Si este vehículo era el incidente, limpiamos el estado
        if (v.isIncident) {
          this._resetIncidentState();
        }
        this.removeVehicle(v);
        exitedThisTick++;
      }
    }

    // 4. Spawn probabilístico
    if (
      this.vehicles.length < this.maxVehicles &&
      Math.random() < this.spawnRate * SPAWN_BASE_PROBABILITY
    ) {
      this.spawnVehicle();
    }

    // 5. Actualizar métricas
    this._updateMetrics(exitedThisTick);

    // 6. Contador de incidente
    if (this.incident.active) {
      this.incident.tickCount++;
    }
  }

  // -----------------------------------------------------------------------
  // Incidentes
  // -----------------------------------------------------------------------

  /**
   * Dispara un incidente: detiene al vehículo más avanzado del carril
   * indicado, activa sus luces de emergencia y bloquea el carril.
   *
   * @param {number} lane - Índice del carril donde ocurre el incidente (0‑based).
   * @returns {boolean} true si se pudo generar el incidente, false si no había vehículos.
   */
  triggerIncident(lane) {
    if (lane < 0 || lane >= this.laneCount) return false;

    const laneVehicles = this.lanes[lane].vehicles;
    if (laneVehicles.length === 0) return false;

    // Buscar el vehículo más avanzado (mayor X)
    const frontVehicle = laneVehicles.reduce((max, v) =>
      v.x > max.x ? v : max
    );

    frontVehicle.speed = 0;
    frontVehicle.targetSpeed = 0;
    frontVehicle.isIncident = true;
    frontVehicle.emergencyLights = true;
    frontVehicle.stopped = true;
    frontVehicle.color = 'hazard';

    this.incident = {
      active: true,
      vehicle: frontVehicle,
      lane,
      tickCount: 0,
    };

    this.lanes[lane].blocked = true;

    return true;
  }

  /**
   * Resuelve el incidente activo: elimina el vehículo incidentado y
   * desbloquea el carril. Los vehículos detenidos detrás reanudan la
   * marcha gradualmente por el sistema de evitación de colisiones.
   */
  clearIncident() {
    if (!this.incident.active || !this.incident.vehicle) return;

    const incidentVehicle = this.incident.vehicle;
    const lane = this.incident.lane;

    // Eliminar el vehículo incidentado
    this.removeVehicle(incidentVehicle);

    // Desmarcar emergencyLights de los vehículos que estaban parados detrás
    // (algo redundante porque collision avoidance ya maneja la aceleración)
    for (const v of this.lanes[lane].vehicles) {
      v.emergencyLights = false;
      v.targetSpeed =
        SPAWN_SPEED_MIN +
        Math.random() * (SPAWN_SPEED_MAX - SPAWN_SPEED_MIN);
    }

    this._resetIncidentState();
  }

  /**
   * Restablece el estado del incidente a inactivo.
   * @private
   */
  _resetIncidentState() {
    if (this.incident.lane >= 0) {
      this.lanes[this.incident.lane].blocked = false;
    }
    this.incident = {
      active: false,
      vehicle: null,
      lane: -1,
      tickCount: 0,
    };
  }

  // -----------------------------------------------------------------------
  // Métricas
  // -----------------------------------------------------------------------

  /**
   * Recalcula las métricas agregadas y actualiza `this.metrics`.
   *
   * - avgSpeed: media de velocidad de todos los vehículos.
   * - flowPerMinute: vehículos que han salido en los últimos 60 ticks.
   * - density: proporción de vehículos actuales respecto al máximo.
   * - vehicleCount: número actual de vehículos.
   *
   * @param {number} exitedThisTick - Vehículos que salieron en este tick.
   * @private
   */
  _updateMetrics(exitedThisTick) {
    // Registrar salidas en el buffer circular
    this._exitHistory[this._exitIndex] = exitedThisTick;
    this._exitIndex = (this._exitIndex + 1) % FLOW_WINDOW;

    const vehicleCount = this.vehicles.length;
    const avgSpeed =
      vehicleCount > 0
        ? this.vehicles.reduce((sum, v) => sum + v.speed, 0) / vehicleCount
        : 0;

    const flowPerMinute = this._exitHistory.reduce((a, b) => a + b, 0);
    const density = vehicleCount / this.maxVehicles;

    this.metrics = { avgSpeed, flowPerMinute, vehicleCount, density };
  }

  // -----------------------------------------------------------------------
  // Estado para RL
  // -----------------------------------------------------------------------

  /**
   * Devuelve el estado discretizado para el agente RL.
   *
   * Las categorías se calculan así:
   *
   * **Densidad** (proporción de vehículos respecto a maxVehicles):
   *   - low:    < 30 %
   *   - medium: 30–60 %
   *   - high:   > 60 %
   *
   * **Velocidad** (proporción de velocidad media respecto a MAX_SPEED_REF):
   *   - high:   > 70 %
   *   - medium: 30–70 %
   *   - low:    1–29 %
   *   - zero:   < 1 %
   *
   * **Carril del incidente**: número de carril (0‑3) o null si no hay
   * incidente activo.
   *
   * @returns {{ density: string, speed: string, incidentLane: number|null }}
   */
  getState() {
    const densityRatio = this.metrics.density;
    const speedRatio =
      MAX_SPEED_REF > 0 ? this.metrics.avgSpeed / MAX_SPEED_REF : 0;

    let density;
    if (densityRatio < 0.3) {
      density = 'low';
    } else if (densityRatio <= 0.6) {
      density = 'medium';
    } else {
      density = 'high';
    }

    let speed;
    if (speedRatio > 0.7) {
      speed = 'high';
    } else if (speedRatio >= 0.3) {
      speed = 'medium';
    } else if (speedRatio >= 0.01) {
      speed = 'low';
    } else {
      speed = 'zero';
    }

    const incidentLane = this.incident.active ? this.incident.lane : null;

    return { density, speed, incidentLane };
  }

  /**
   * Devuelve una clave de estado en formato string para lookup en Q‑Table.
   *
   * Formato: `"{density}_{speed}_{incidentLane}"`
   *
   * Ejemplos: `"medium_high_null"`, `"high_zero_2"`, `"low_medium_null"`.
   *
   * @returns {string} Clave de estado.
   */
  getStateKey() {
    const state = this.getState();
    const laneStr =
      state.incidentLane !== null ? String(state.incidentLane) : 'null';
    return `${state.density}_${state.speed}_${laneStr}`;
  }

  // -----------------------------------------------------------------------
  // Control de spawn
  // -----------------------------------------------------------------------

  /**
   * Ajusta la tasa de spawn. El agente RL usa este método para reducir
   * o aumentar la entrada de vehículos a la autopista.
   *
   * @param {number} rate - Probabilidad de spawn por intento (0.0 a 1.0).
   */
  setSpawnRate(rate) {
    this.spawnRate = Math.max(0, Math.min(1, rate));
  }
}
