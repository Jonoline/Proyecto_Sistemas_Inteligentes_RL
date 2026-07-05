/**
 * Visualizer — Renderizado Canvas 2D de la autopista, gráfico de métricas
 * y panel de estado del agente RL.
 *
 * Responsabilidades:
 *  - Dibujar carriles, vehículos y efectos visuales (luces de emergencia).
 *  - Renderizar un gráfico en tiempo real de velocidad media y flujo.
 *  - Actualizar un panel DOM con el estado discreto, acción y recompensa.
 *
 * @module visualizer
 */

// ---------------------------------------------------------------------------
// Constantes visuales
// ---------------------------------------------------------------------------

/** Colores de carrocería según tipo de vehículo. */
const BODY_COLORS = {
  blue:   '#4A90D9',
  green:  '#4CAF50',
  gray:   '#888888',
  red:    '#E74C3C',
  hazard: '#FFC107',
};

/** Color de los vehículos cuando frenan. */
const BRAKING_COLOR = '#E67E22';

/** Color de los vehículos detenidos (no incidente). */
const STOPPED_COLOR = '#C0392B';

/** Color del asfalto. */
const ASPHALT_COLOR = '#3D3D3D';

/** Color de las líneas de carril. */
const LANE_LINE_COLOR = 'rgba(255, 255, 255, 0.25)';

/** Color del borde del canvas. */
const BORDER_COLOR = '#555';

/** Dimensiones del gráfico de métricas. */
const CHART_WIDTH  = 480;
const CHART_HEIGHT = 160;
const CHART_MAX_POINTS = 200;

/** Colores del gráfico. */
const CHART_BG      = '#1E1E2E';
const CHART_GRID    = 'rgba(255,255,255,0.08)';
const SPEED_COLOR   = '#4FC3F7';
const FLOW_COLOR    = '#81C784';

// ---------------------------------------------------------------------------
// Clase Visualizer
// ---------------------------------------------------------------------------

export class Visualizer {
  /**
   * @param {HTMLCanvasElement} highwayCanvas - Canvas donde se dibuja la autopista.
   * @param {HTMLCanvasElement} chartCanvas   - Canvas donde se dibuja el gráfico.
   * @param {Object}           panelEls       - Referencias a elementos del panel.
   * @param {HTMLElement}      panelEls.stateEl     - Muestra el estado discreto.
   * @param {HTMLElement}      panelEls.actionEl    - Muestra la acción tomada.
   * @param {HTMLElement}      panelEls.rewardEl    - Muestra la recompensa acumulada.
   * @param {HTMLElement}      panelEls.epsilonEl   - Muestra el epsilon actual.
   * @param {HTMLElement}      panelEls.policyEl    - Muestra resumen de política.
   */
  constructor(highwayCanvas, chartCanvas, panelEls) {
    this.highwayCanvas = highwayCanvas;
    this.highwayCtx    = highwayCanvas.getContext('2d');
    this.chartCanvas   = chartCanvas;
    this.chartCtx      = chartCanvas.getContext('2d');
    this.panel         = panelEls;

    // Historial de métricas para el gráfico
    this.speedHistory  = [];
    this.flowHistory   = [];

    // Temporizador de parpadeo para luces de emergencia
    this._blinkTick = 0;
  }

  // -----------------------------------------------------------------------
  // Renderizado de autopista
  // -----------------------------------------------------------------------

  /**
   * Dibuja el asfalto de fondo.
   */
  _drawAsphalt() {
    const ctx = this.highwayCtx;
    const w   = this.highwayCanvas.width;
    const h   = this.highwayCanvas.height;
    ctx.fillStyle = ASPHALT_COLOR;
    ctx.fillRect(0, 0, w, h);
  }

  /**
   * Dibuja las líneas divisorias de carril (discontinuas).
   * @param {number} laneCount
   */
  _drawLaneLines(laneCount) {
    const ctx = this.highwayCtx;
    const w   = this.highwayCanvas.width;
    const h   = this.highwayCanvas.height;
    const laneH = h / laneCount;

    ctx.strokeStyle = LANE_LINE_COLOR;
    ctx.lineWidth   = 2;
    ctx.setLineDash([20, 15]);

    for (let i = 1; i < laneCount; i++) {
      const y = i * laneH;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    // Borde superior e inferior
    ctx.setLineDash([]);
    ctx.strokeStyle = BORDER_COLOR;
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, w, h);
  }

  /**
   * Dibuja todos los vehículos en el canvas.
   * @param {Array<Object>} vehicles
   * @param {Object|null}   incident - Estado de incidente actual.
   */
  _drawVehicles(vehicles, incident) {
    const ctx = this.highwayCtx;

    // Modo parpadeo: cambia cada 30 ticks
    this._blinkTick++;
    const blinkOn = Math.floor(this._blinkTick / 15) % 2 === 0;

    for (const v of vehicles) {
      let color;

      // Color según estado del vehículo
      if (v.isIncident || v.emergencyLights) {
        // Incidente: carrocería normal + overlay amarillo parpadeante
        color = BODY_COLORS[v.type] || BODY_COLORS.blue;
      } else if (v.color === 'braking') {
        color = BRAKING_COLOR;
      } else if (v.color === 'stopped') {
        color = STOPPED_COLOR;
      } else {
        color = BODY_COLORS[v.type] || BODY_COLORS.blue;
      }

      // Dibujar carrocería
      ctx.fillStyle = color;
      ctx.fillRect(v.x, v.y, v.width, v.height);

      // Luces de emergencia (parpadeo amarillo)
      if ((v.isIncident || v.emergencyLights) && blinkOn) {
        // Parpadeo: fondo amarillo semi-transparente
        ctx.fillStyle = 'rgba(255, 193, 7, 0.6)';
        ctx.fillRect(v.x, v.y, v.width, v.height);

        // Pequeños indicadores de luz en las esquinas
        ctx.fillStyle = '#FFC107';
        ctx.fillRect(v.x + 2, v.y + 2, 6, 4);
        ctx.fillRect(v.x + v.width - 8, v.y + 2, 6, 4);
      }

      // Borde del vehículo
      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(v.x, v.y, v.width, v.height);
    }

    // Si hay incidente activo, dibujar icono de peligro sobre el vehículo
    if (incident && incident.active && incident.vehicle && blinkOn) {
      const v = incident.vehicle;
      ctx.fillStyle = '#FF1744';
      ctx.font = 'bold 14px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('⚠', v.x + v.width / 2, v.y - 4);
    }
  }

  /**
   * Renderiza todo el canvas de la autopista.
   * @param {Object} sim - Instancia de Simulation.
   */
  render(sim) {
    this._drawAsphalt();
    this._drawLaneLines(sim.laneCount);
    this._drawVehicles(sim.vehicles, sim.incident);
  }

  // -----------------------------------------------------------------------
  // Gráfico de métricas
  // -----------------------------------------------------------------------

  /**
   * Añade un punto de datos al historial del gráfico.
   * @param {number} avgSpeed
   * @param {number} flowPerMinute
   */
  pushMetrics(avgSpeed, flowPerMinute) {
    this.speedHistory.push(avgSpeed);
    this.flowHistory.push(flowPerMinute);

    // Mantener ventana deslizante
    if (this.speedHistory.length > CHART_MAX_POINTS) {
      this.speedHistory.shift();
    }
    if (this.flowHistory.length > CHART_MAX_POINTS) {
      this.flowHistory.shift();
    }
  }

  /**
   * Dibuja el gráfico de métricas en el canvas correspondiente.
   */
  renderChart() {
    const ctx  = this.chartCtx;
    const w    = CHART_WIDTH;
    const h    = CHART_HEIGHT;
    const pad  = { top: 18, right: 16, bottom: 22, left: 36 };
    const pw   = w - pad.left - pad.right;
    const ph   = h - pad.top - pad.bottom;

    // Fondo
    ctx.fillStyle = CHART_BG;
    ctx.fillRect(0, 0, w, h);

    // Líneas de grid horizontal
    ctx.strokeStyle = CHART_GRID;
    ctx.lineWidth   = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (ph / 4) * i;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
    }

    // Ejes
    ctx.strokeStyle = '#666';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top);
    ctx.lineTo(pad.left, h - pad.bottom);
    ctx.lineTo(w - pad.right, h - pad.bottom);
    ctx.stroke();

    // Etiquetas del eje Y
    ctx.fillStyle = '#AAA';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    const speedMax = 5;
    for (let i = 0; i <= 4; i++) {
      const val = (speedMax / 4) * (4 - i);
      const y   = pad.top + (ph / 4) * i;
      ctx.fillText(val.toFixed(1), pad.left - 6, y + 4);
    }

    // Etiqueta del eje Y
    ctx.save();
    ctx.translate(10, h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = SPEED_COLOR;
    ctx.fillText('vel (px/f)', 0, 0);
    ctx.fillStyle = FLOW_COLOR;
    ctx.fillText(' / flujo', 0, 14);
    ctx.restore();

    // Etiqueta del eje X
    ctx.fillStyle = '#AAA';
    ctx.textAlign = 'center';
    ctx.fillText('tiempo (ticks)', w / 2, h - 4);

    // Datos: velocidad media
    if (this.speedHistory.length > 1) {
      ctx.strokeStyle = SPEED_COLOR;
      ctx.lineWidth   = 1.8;
      ctx.beginPath();
      for (let i = 0; i < this.speedHistory.length; i++) {
        const x = pad.left + (i / (CHART_MAX_POINTS - 1)) * pw;
        const y = pad.top + ph - (this.speedHistory[i] / speedMax) * ph;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Datos: flujo (escalado para que quepa en el mismo gráfico)
    if (this.flowHistory.length > 1) {
      const flowMax = Math.max(10, ...this.flowHistory);
      ctx.strokeStyle = FLOW_COLOR;
      ctx.lineWidth   = 1.8;
      ctx.beginPath();
      for (let i = 0; i < this.flowHistory.length; i++) {
        const x = pad.left + (i / (CHART_MAX_POINTS - 1)) * pw;
        const y = pad.top + ph - (this.flowHistory[i] / flowMax) * ph;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Leyenda
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = SPEED_COLOR;
    ctx.fillText('— velocidad', pad.left, 14);
    ctx.fillStyle = FLOW_COLOR;
    ctx.fillText('— flujo', pad.left + 110, 14);
  }

  // -----------------------------------------------------------------------
  // Panel del agente
  // -----------------------------------------------------------------------

  /**
   * Actualiza el panel de estado del agente RL.
   *
   * @param {Object} state  - { density, speed, incidentLane }
   * @param {number} action - Acción tomada
   * @param {number} reward - Recompensa obtenida
   * @param {number} cumulativeReward - Recompensa acumulada total
   * @param {Object} stats  - { tableSize, epsilon }
   * @param {Array}  policySummary - Resumen de política
   */
  updateAgentPanel(state, action, reward, cumulativeReward, stats, policySummary) {
    const actionLabels = ['Mantener flujo', 'Activar desvío', 'Despejar con grúa'];
    const actionIcons = ['⏸️', '🔄', '🚛'];

    if (this.panel.stateEl) {
      const incStr = state.incidentLane !== null
        ? `Carril ${state.incidentLane}`
        : 'Ninguno';
      this.panel.stateEl.innerHTML = `
        <span class="state-badge density-${state.density}">Densidad: ${state.density.toUpperCase()}</span>
        <span class="state-badge speed-${state.speed}">Velocidad: ${state.speed.toUpperCase()}</span>
        <span class="state-badge ${state.incidentLane !== null ? 'incident-active' : ''}">Incidente: ${incStr}</span>
      `;
    }

    if (this.panel.actionEl) {
      this.panel.actionEl.innerHTML = `
        ${actionIcons[action]} <strong>${actionLabels[action]}</strong>
      `;
    }

    if (this.panel.rewardEl) {
      const sign = reward >= 0 ? '+' : '';
      this.panel.rewardEl.innerHTML = `
        <span class="reward ${reward >= 0 ? 'positive' : 'negative'}">${sign}${reward}</span>
        <span class="cumulative"> | Acumulado: ${cumulativeReward.toFixed(0)}</span>
      `;
    }

    if (this.panel.epsilonEl) {
      this.panel.epsilonEl.textContent = `ε: ${stats.epsilon.toFixed(3)} | Estados conocidos: ${stats.tableSize}`;
    }

    if (this.panel.policyEl && policySummary.length > 0) {
      const rows = policySummary.slice(0, 8).map(p =>
        `<tr>
          <td class="policy-state">${p.state}</td>
          <td class="policy-action action-${p.bestAction.toLowerCase()}">${p.bestAction}</td>
          <td class="policy-q">[${p.qValues.map(v => v.toFixed(0)).join(', ')}]</td>
        </tr>`
      ).join('');
      this.panel.policyEl.innerHTML = `
        <table>
          <thead><tr><th>Estado</th><th>Mejor acción</th><th>Q-values</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      `;
    }
  }

  /**
   * Resetea los historiales del gráfico.
   */
  resetChart() {
    this.speedHistory = [];
    this.flowHistory  = [];
  }
}
