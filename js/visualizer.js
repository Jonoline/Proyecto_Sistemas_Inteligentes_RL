/**
 * Visualizer — Renderizado Canvas 2D de la autopista, gráfico de métricas,
 * efectos visuales de acciones y panel de estado del agente RL.
 *
 * @module visualizer
 */

// ---------------------------------------------------------------------------
// Constantes visuales
// ---------------------------------------------------------------------------

const BODY_COLORS = {
  blue:   '#4A90D9',
  green:  '#4CAF50',
  gray:   '#888888',
  red:    '#E74C3C',
};

const BRAKING_COLOR     = '#E67E22';
const STOPPED_COLOR     = '#C0392B';
const ASPHALT_COLOR     = '#3D3D3D';
const LANE_LINE_COLOR   = 'rgba(255, 255, 255, 0.25)';
const BORDER_COLOR      = '#555';

const CHART_WIDTH       = 480;
const CHART_HEIGHT      = 160;
const CHART_MAX_POINTS  = 200;
const CHART_BG          = '#1E1E2E';
const CHART_GRID        = 'rgba(255,255,255,0.08)';
const SPEED_COLOR       = '#4FC3F7';
const FLOW_COLOR        = '#81C784';

/** Duración del overlay de acción en ticks (≈1.3s a 60fps). */
const OVERLAY_DURATION = 80;

/** Duración del destello de grúa en ticks. */
const CLEAR_FLASH_DURATION = 50;

// ---------------------------------------------------------------------------
// Clase Visualizer
// ---------------------------------------------------------------------------

export class Visualizer {
  /**
   * @param {HTMLCanvasElement} highwayCanvas
   * @param {HTMLCanvasElement} chartCanvas
   * @param {Object} panelEls - Referencias a elementos del panel DOM.
   * @param {HTMLElement} panelEls.stateEl
   * @param {HTMLElement} panelEls.actionEl
   * @param {HTMLElement} panelEls.rewardEl
   * @param {HTMLElement} panelEls.epsilonEl
   * @param {HTMLElement} panelEls.policyEl
   * @param {HTMLElement} panelEls.historyEl
   */
  constructor(highwayCanvas, chartCanvas, panelEls) {
    this.highwayCanvas = highwayCanvas;
    this.highwayCtx    = highwayCanvas.getContext('2d');
    this.chartCanvas   = chartCanvas;
    this.chartCtx      = chartCanvas.getContext('2d');
    this.panel         = panelEls;

    this.speedHistory  = [];
    this.flowHistory   = [];
    this._blinkTick    = 0;

    // Overlay de acción
    this._overlay = { active: false, action: -1, timer: 0 };

    // Efecto de grúa (CLEAR)
    this._clearFlash = { active: false, timer: 0, x: 0, y: 0 };

    // Barrera de desvío (DIVERT)
    this._divertBarrier = false;
  }

  // -----------------------------------------------------------------------
  // Efectos visuales — activación desde main.js
  // -----------------------------------------------------------------------

  /** Muestra el overlay de acción en el centro del canvas. */
  showActionOverlay(action) {
    this._overlay = { active: true, action, timer: OVERLAY_DURATION };
  }

  /** Activa el destello verde de grúa en la posición del incidente. */
  triggerClearFlash(x, y) {
    this._clearFlash = { active: true, timer: CLEAR_FLASH_DURATION, x, y };
  }

  /** Muestra/oculta la barrera naranja de desvío. */
  setDivertBarrier(active) {
    this._divertBarrier = active;
  }

  // -----------------------------------------------------------------------
  // Renderizado de autopista
  // -----------------------------------------------------------------------

  _drawAsphalt() {
    const ctx = this.highwayCtx;
    ctx.fillStyle = ASPHALT_COLOR;
    ctx.fillRect(0, 0, this.highwayCanvas.width, this.highwayCanvas.height);
  }

  _drawLaneLines(laneCount) {
    const ctx = this.highwayCtx;
    const w   = this.highwayCanvas.width;
    const h   = this.highwayCanvas.height;
    const laneH = h / laneCount;

    ctx.strokeStyle = LANE_LINE_COLOR;
    ctx.lineWidth   = 2;
    ctx.setLineDash([20, 15]);
    for (let i = 1; i < laneCount; i++) {
      ctx.beginPath();
      ctx.moveTo(0, i * laneH);
      ctx.lineTo(w, i * laneH);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = BORDER_COLOR;
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, w, h);
  }

  _drawVehicles(vehicles, incident) {
    const ctx = this.highwayCtx;
    this._blinkTick++;
    const blinkOn = Math.floor(this._blinkTick / 15) % 2 === 0;

    for (const v of vehicles) {
      let color;
      if (v.isIncident || v.emergencyLights) {
        color = BODY_COLORS[v.type] || BODY_COLORS.blue;
      } else if (v.color === 'braking') {
        color = BRAKING_COLOR;
      } else if (v.color === 'stopped') {
        color = STOPPED_COLOR;
      } else {
        color = BODY_COLORS[v.type] || BODY_COLORS.blue;
      }

      ctx.fillStyle = color;
      ctx.fillRect(v.x, v.y, v.width, v.height);

      if ((v.isIncident || v.emergencyLights) && blinkOn) {
        ctx.fillStyle = 'rgba(255, 193, 7, 0.6)';
        ctx.fillRect(v.x, v.y, v.width, v.height);
        ctx.fillStyle = '#FFC107';
        ctx.fillRect(v.x + 2, v.y + 2, 6, 4);
        ctx.fillRect(v.x + v.width - 8, v.y + 2, 6, 4);
      }

      ctx.strokeStyle = 'rgba(0,0,0,0.3)';
      ctx.lineWidth = 1;
      ctx.strokeRect(v.x, v.y, v.width, v.height);
    }

    if (incident && incident.active && incident.vehicle && blinkOn) {
      const v = incident.vehicle;
      ctx.fillStyle = '#FF1744';
      ctx.font = 'bold 16px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('⚠', v.x + v.width / 2, v.y - 6);
    }
  }

  // -----------------------------------------------------------------------
  // Efecto: barrera de desvío (DIVERT)
  // -----------------------------------------------------------------------

  _drawDivertBarrier() {
    if (!this._divertBarrier) return;

    const ctx = this.highwayCtx;
    const h   = this.highwayCanvas.height;

    // Patrón de barrera a rayas naranjas en el borde izquierdo
    const barW = 18;
    const stripeH = 14;
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, barW, h);
    ctx.clip();

    for (let y = 0; y < h; y += stripeH) {
      ctx.fillStyle = (Math.floor(y / stripeH) % 2 === 0)
        ? '#FF6F00' : '#3D3D3D';
      ctx.fillRect(0, y, barW, stripeH);
    }
    ctx.restore();

    // Borde
    ctx.strokeStyle = '#FF8F00';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, barW, h);

    // Texto "DESVÍO"
    ctx.save();
    ctx.fillStyle = '#FFF';
    ctx.font = 'bold 10px monospace';
    ctx.textAlign = 'center';
    ctx.translate(barW / 2, h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('REDUCCIÓN ENTRADA', 0, 0);
    ctx.restore();
  }

  // -----------------------------------------------------------------------
  // Efecto: destello de grúa (CLEAR)
  // -----------------------------------------------------------------------

  _drawClearEffect() {
    if (!this._clearFlash.active) return;

    const ctx = this.highwayCtx;
    const w   = this.highwayCanvas.width;
    const h   = this.highwayCanvas.height;

    // Pulso verde decreciente
    const progress = this._clearFlash.timer / CLEAR_FLASH_DURATION;
    const alpha = progress * 0.35;
    ctx.fillStyle = `rgba(76, 175, 80, ${alpha})`;
    ctx.fillRect(0, 0, w, h);

    // Círculo expansivo desde el incidente
    const radius = (1 - progress) * 120 + 20;
    ctx.beginPath();
    ctx.arc(this._clearFlash.x, this._clearFlash.y, radius, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(129, 199, 132, ${progress * 0.6})`;
    ctx.lineWidth = 3;
    ctx.stroke();

    // Icono de grúa
    const flashX = this._clearFlash.x;
    const flashY = this._clearFlash.y - 30;
    ctx.fillStyle = `rgba(255, 255, 255, ${progress})`;
    ctx.font = 'bold 24px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('🚛', flashX, flashY);
  }

  // -----------------------------------------------------------------------
  // Efecto: overlay de acción (banner central)
  // -----------------------------------------------------------------------

  _drawActionOverlay() {
    if (!this._overlay.active) return;

    const ctx = this.highwayCtx;
    const w   = this.highwayCanvas.width;
    const h   = this.highwayCanvas.height;

    const progress = this._overlay.timer / OVERLAY_DURATION;
    const alpha    = Math.min(progress * 2, 1);

    // Fondos según acción
    const colors = {
      0: 'rgba(100, 100, 100, ',   // MAINTAIN: gris neutro
      1: 'rgba(255, 111, 0, ',      // DIVERT: naranja
      2: 'rgba(76, 175, 80, ',      // CLEAR: verde
    };

    const labels = [
      { icon: '⏸️', text: 'MANTENER FLUJO' },
      { icon: '🔄', text: 'DESVÍO ACTIVADO' },
      { icon: '🚛', text: 'GRÚA DESPACHADA' },
    ];

    const l = labels[this._overlay.action] || labels[0];
    const c = colors[this._overlay.action] || colors[0];

    // Banner semitransparente en la parte superior
    const bw = 300;
    const bh = 44;
    const bx = (w - bw) / 2;
    const by = 10;

    ctx.fillStyle = '#000000';
    ctx.fillStyle = c + (alpha * 0.85) + ')';
    this._roundRect(ctx, bx, by, bw, bh, 10);
    ctx.fill();

    // Borde
    ctx.strokeStyle = c + (alpha * 0.9) + ')';
    ctx.lineWidth = 2;
    this._roundRect(ctx, bx, by, bw, bh, 10);
    ctx.stroke();

    // Texto
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
    ctx.font = 'bold 14px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${l.icon}  ${l.text}`, w / 2, by + bh / 2);

    ctx.textBaseline = 'alphabetic';
  }

  /** Utilidad: rectángulo con esquinas redondeadas. */
  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  /** Tick interno para contar tiempo de overlays. */
  _tickOverlays() {
    if (this._overlay.active) {
      this._overlay.timer--;
      if (this._overlay.timer <= 0) {
        this._overlay.active = false;
      }
    }
    if (this._clearFlash.active) {
      this._clearFlash.timer--;
      if (this._clearFlash.timer <= 0) {
        this._clearFlash.active = false;
      }
    }
  }

  // -----------------------------------------------------------------------
  // Indicador de pausa
  // -----------------------------------------------------------------------

  /** Dibuja un indicador si la simulación está pausada. */
  drawPauseOverlay(paused) {
    if (!paused) return;
    const ctx = this.highwayCtx;
    const w   = this.highwayCanvas.width;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(0, 0, w, this.highwayCanvas.height);

    ctx.fillStyle = '#FFF';
    ctx.font = 'bold 22px monospace';
    ctx.textAlign = 'center';
    ctx.fillText('⏸  PAUSADO', w / 2, this.highwayCanvas.height / 2);
  }

  // -----------------------------------------------------------------------
  // Renderizado principal
  // -----------------------------------------------------------------------

  /**
   * Renderiza todo el canvas de la autopista.
   * @param {Object} sim - Instancia de Simulation.
   * @param {boolean} paused - Si la simulación está pausada.
   */
  render(sim, paused = false) {
    this._tickOverlays();

    this._drawAsphalt();
    this._drawLaneLines(sim.laneCount);
    this._drawDivertBarrier();
    this._drawVehicles(sim.vehicles, sim.incident);
    this._drawClearEffect();
    this._drawActionOverlay();
    this.drawPauseOverlay(paused);
  }

  // -----------------------------------------------------------------------
  // Gráfico de métricas
  // -----------------------------------------------------------------------

  pushMetrics(avgSpeed, flowPerMinute) {
    this.speedHistory.push(avgSpeed);
    this.flowHistory.push(flowPerMinute);
    if (this.speedHistory.length > CHART_MAX_POINTS) this.speedHistory.shift();
    if (this.flowHistory.length  > CHART_MAX_POINTS) this.flowHistory.shift();
  }

  renderChart() {
    const ctx  = this.chartCtx;
    const w    = CHART_WIDTH;
    const h    = CHART_HEIGHT;
    const pad  = { top: 18, right: 16, bottom: 22, left: 36 };
    const pw   = w - pad.left - pad.right;
    const ph   = h - pad.top - pad.bottom;

    ctx.fillStyle = CHART_BG;
    ctx.fillRect(0, 0, w, h);

    ctx.strokeStyle = CHART_GRID;
    ctx.lineWidth   = 1;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (ph / 4) * i;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
    }

    ctx.strokeStyle = '#666';
    ctx.lineWidth   = 1.5;
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top);
    ctx.lineTo(pad.left, h - pad.bottom);
    ctx.lineTo(w - pad.right, h - pad.bottom);
    ctx.stroke();

    ctx.fillStyle = '#AAA';
    ctx.font = '10px monospace';
    ctx.textAlign = 'right';
    const speedMax = 3;
    for (let i = 0; i <= 4; i++) {
      const val = (speedMax / 4) * (4 - i);
      const y   = pad.top + (ph / 4) * i;
      ctx.fillText(val.toFixed(1), pad.left - 6, y + 4);
    }

    ctx.save();
    ctx.translate(10, h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = SPEED_COLOR;
    ctx.fillText('vel (px/f)', 0, 0);
    ctx.fillStyle = FLOW_COLOR;
    ctx.fillText(' / flujo', 0, 14);
    ctx.restore();

    ctx.fillStyle = '#AAA';
    ctx.textAlign = 'center';
    ctx.fillText('tiempo (ticks)', w / 2, h - 4);

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
   * Renderiza el historial de decisiones en el elemento DOM.
   * @param {Array<{tick: number, stateKey: string, action: number, reward: number}>} history
   */
  renderHistory(history) {
    if (!this.panel.historyEl) return;

    const actionLabels = ['MANTENER', 'DIVERT', 'CLEAR'];
    const actionClasses = ['hist-maintain', 'hist-divert', 'hist-clear'];

    if (history.length === 0) {
      this.panel.historyEl.innerHTML = '<span class="history-empty">Sin decisiones aún</span>';
      return;
    }

    const rows = [...history].reverse().map(h => {
      const cls = actionClasses[h.action] || '';
      const sign = h.reward >= 0 ? '+' : '';
      return `<tr class="${cls}">
        <td>${h.tick}</td>
        <td>${h.stateKey}</td>
        <td>${actionLabels[h.action]}</td>
        <td class="${h.reward >= 0 ? 'rew-pos' : 'rew-neg'}">${sign}${h.reward}</td>
      </tr>`;
    }).join('');

    this.panel.historyEl.innerHTML = `
      <table>
        <thead><tr><th>Tick</th><th>Estado</th><th>Acción</th><th>Rec.</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  resetChart() {
    this.speedHistory = [];
    this.flowHistory  = [];
  }
}
