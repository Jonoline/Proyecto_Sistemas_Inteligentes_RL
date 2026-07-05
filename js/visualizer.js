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
    this.rewardHistory  = [];
    this._blinkTick    = 0;

    // Overlay de acción
    this._overlay = { active: false, action: -1, timer: 0 };

    // Efecto de grúa (CLEAR)
    this._clearFlash = { active: false, timer: 0, x: 0, y: 0 };

    // Barrera de desvío (DIVERT)
    this._divertBarrier = { active: false, lane: 0 };
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

  /** Muestra/oculta la barrera naranja de desvío en un carril. */
  setDivertBarrier(active, lane = 0) {
    this._divertBarrier = { active, lane };
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
  // Efecto: borde rojo pulsante ante incidente
  // -----------------------------------------------------------------------

  _drawAlertBorder(incident, laneCount) {
    if (!incident || !incident.active) return;

    const ctx = this.highwayCtx;
    const w   = this.highwayCanvas.width;
    const h   = this.highwayCanvas.height;

    // Pulso: intensidad varia con el parpadeo
    const blinkPhase = Math.sin(this._blinkTick * 0.08);
    const alpha = 0.6 + blinkPhase * 0.4;
    const thickness = 3 + (1 - Math.abs(blinkPhase)) * 2;

    ctx.strokeStyle = `rgba(244, 67, 54, ${alpha})`;
    ctx.lineWidth = thickness;
    ctx.setLineDash([]);
    ctx.strokeRect(1, 1, w - 2, h - 2);

    // Segunda linea fina exterior
    ctx.strokeStyle = `rgba(244, 67, 54, ${alpha * 0.3})`;
    ctx.lineWidth = 1;
    ctx.strokeRect(5, 5, w - 10, h - 10);
  }

  // -----------------------------------------------------------------------
  // Efecto: zona de peligro tras el incidente
  // -----------------------------------------------------------------------

  _drawDangerZone(incident, laneCount) {
    if (!incident || !incident.active || !incident.vehicle) return;

    const ctx   = this.highwayCtx;
    const h     = this.highwayCanvas.height;
    const laneH = h / laneCount;
    const v     = incident.vehicle;
    const laneIdx = incident.lane;
    const laneY = laneIdx * laneH;

    // Todo el carril en rojo semitransparente
    ctx.fillStyle = 'rgba(244, 67, 54, 0.18)';
    ctx.fillRect(0, laneY, this.highwayCanvas.width, laneH);

    // Borde superior e inferior del carril en rojo mas intenso
    ctx.strokeStyle = 'rgba(244, 67, 54, 0.5)';
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 4]);
    ctx.beginPath();
    ctx.moveTo(0, laneY);
    ctx.lineTo(this.highwayCanvas.width, laneY);
    ctx.moveTo(0, laneY + laneH);
    ctx.lineTo(this.highwayCanvas.width, laneY + laneH);
    ctx.stroke();
    ctx.setLineDash([]);

    // Destello mas intenso cerca del auto
    const grad = ctx.createLinearGradient(v.x, 0, Math.max(0, v.x - 300), 0);
    grad.addColorStop(0, 'rgba(244, 67, 54, 0.30)');
    grad.addColorStop(0.5, 'rgba(244, 67, 54, 0.10)');
    grad.addColorStop(1, 'rgba(244, 67, 54, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(Math.max(0, v.x - 300), laneY, Math.min(300, v.x), laneH);
  }

  _drawDivertBarrier(laneCount) {
    if (!this._divertBarrier.active) return;

    const ctx     = this.highwayCtx;
    const h       = this.highwayCanvas.height;
    const laneH   = h / laneCount;
    const laneIdx = this._divertBarrier.lane;
    const laneY   = laneIdx * laneH;

    const barW = 18;
    const stripeH = 14;

    // Barrera de rayas naranjas solo en el carril bloqueado
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, laneY, barW, laneH);
    ctx.clip();

    for (let y = laneY; y < laneY + laneH; y += stripeH) {
      ctx.fillStyle = (Math.floor(y / stripeH) % 2 === 0)
        ? '#FF6F00' : '#3D3D3D';
      ctx.fillRect(0, y, barW, stripeH);
    }
    ctx.restore();

    // Borde de la barrera
    ctx.strokeStyle = '#FF8F00';
    ctx.lineWidth = 2;
    ctx.strokeRect(0, laneY, barW, laneH);

    // Texto vertical en la barrera
    ctx.save();
    ctx.fillStyle = '#FFF';
    ctx.font = 'bold 8px monospace';
    ctx.textAlign = 'center';
    ctx.translate(barW / 2, laneY + laneH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('DESVIO', 0, 0);
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
    this._drawDangerZone(sim.incident, sim.laneCount);
    this._drawDivertBarrier(sim.laneCount);
    this._drawVehicles(sim.vehicles, sim.incident);
    this._drawAlertBorder(sim.incident, sim.laneCount);
    this._drawClearEffect();
    this._drawActionOverlay();
    this.drawPauseOverlay(paused);
  }

  // -----------------------------------------------------------------------
  // Gráfico de métricas
  // -----------------------------------------------------------------------

  pushMetrics(avgSpeed, reward) {
    this.speedHistory.push(avgSpeed);
    this.rewardHistory.push(reward);
    if (this.speedHistory.length  > CHART_MAX_POINTS) this.speedHistory.shift();
    if (this.rewardHistory.length > CHART_MAX_POINTS) this.rewardHistory.shift();
  }

  renderChart() {
    const ctx  = this.chartCtx;
    const w    = this.chartCanvas.width;
    const h    = this.chartCanvas.height;
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

    // Eje Y derecho: recompensa (-30 a +20)
    const rewardMin = -30;
    const rewardMax = 20;
    ctx.textAlign = 'left';
    for (let i = 0; i <= 4; i++) {
      const val = rewardMin + ((rewardMax - rewardMin) / 4) * i;
      const y   = pad.top + ph - (ph / 4) * i;
      ctx.fillText(val.toFixed(0), w - pad.right + 6, y + 4);
    }

    // Etiquetas de ejes
    ctx.save();
    ctx.translate(10, h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = SPEED_COLOR;
    ctx.fillText('velocidad', 0, 0);
    ctx.restore();

    ctx.save();
    ctx.translate(w - 10, h / 2);
    ctx.rotate(Math.PI / 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#FFD54F';
    ctx.fillText('recompensa', 0, 0);
    ctx.restore();

    ctx.fillStyle = '#AAA';
    ctx.textAlign = 'center';
    ctx.fillText('tiempo', w / 2, h - 4);

    // Linea de recompensa cero
    const zeroY = pad.top + ph - ((0 - rewardMin) / (rewardMax - rewardMin)) * ph;
    ctx.strokeStyle = 'rgba(255,255,255,0.12)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 6]);
    ctx.beginPath();
    ctx.moveTo(pad.left, zeroY);
    ctx.lineTo(w - pad.right, zeroY);
    ctx.stroke();
    ctx.setLineDash([]);

    // Datos: velocidad
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

    // Datos: recompensa
    if (this.rewardHistory.length > 1) {
      ctx.strokeStyle = '#FFD54F';
      ctx.lineWidth   = 2;
      ctx.beginPath();
      for (let i = 0; i < this.rewardHistory.length; i++) {
        const x = pad.left + (i / (CHART_MAX_POINTS - 1)) * pw;
        const r = this.rewardHistory[i];
        const clamped = Math.max(rewardMin, Math.min(rewardMax, r));
        const y = pad.top + ph - ((clamped - rewardMin) / (rewardMax - rewardMin)) * ph;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    // Leyenda
    ctx.font = '11px monospace';
    ctx.textAlign = 'left';
    ctx.fillStyle = SPEED_COLOR;
    ctx.fillText('velocidad', pad.left, 14);
    ctx.fillStyle = '#FFD54F';
    ctx.fillText('recompensa', pad.left + 90, 14);
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
      this.panel.policyEl.innerHTML = this._buildHeatmap(policySummary);
    } else if (this.panel.policyEl && policySummary.length === 0) {
      this.panel.policyEl.innerHTML = '<span class="history-empty">Sin datos de entrenamiento</span>';
    }
  }

  /**
   * Renderiza el historial de decisiones como frases narrativas.
   * @param {Array<{tick: number, stateKey: string, action: number, reward: number}>} history
   */
  renderHistory(history) {
    if (!this.panel.historyEl) return;

    if (history.length === 0) {
      this.panel.historyEl.innerHTML = '<span class="history-empty">Sin decisiones aun</span>';
      return;
    }

    const densityLabel = { low: 'baja', medium: 'media', high: 'alta' };
    const speedLabel   = { high: 'alta', medium: 'media', low: 'baja', zero: 'cero' };

    const items = [...history].reverse().map(h => {
      const parts  = h.stateKey.split('_');
      const dens   = densityLabel[parts[0]] || parts[0];
      const vel    = speedLabel[parts[1]]   || parts[1];
      const lane   = parts[2] !== 'null' ? parts[2] : null;

      let cls, icon, text;

      if (lane && h.action === 2 && h.reward > 0) {
        // CLEAR exitoso
        cls = 'hist-good';
        icon = '';
        text = `Despejado incidente en carril ${lane}`;
      } else if (lane && h.action === 1 && h.reward > 0) {
        // DIVERT util durante incidente
        cls = 'hist-warn';
        icon = '';
        text = `Desvio en carril ${lane} mientras espera grua`;
      } else if (lane && h.action === 2 && h.reward < 0) {
        // CLEAR en cooldown
        cls = 'hist-bad';
        icon = '';
        text = `Grua no disponible — intento fallido en carril ${lane}`;
      } else if (lane && h.action === 0) {
        // Ignoro incidente
        cls = 'hist-bad';
        icon = '';
        text = `Ignoro incidente en carril ${lane} — congestion crece`;
      } else if (!lane && (h.action === 1 || h.action === 2) && h.reward < 0) {
        // Falso positivo
        const act = h.action === 1 ? 'desvio' : 'grua';
        cls = 'hist-bad';
        icon = '';
        text = `Falso positivo: acciono ${act} sin incidente`;
      } else if (!lane && h.action === 0 && h.reward >= 0) {
        // Normal
        cls = 'hist-neutral';
        icon = '';
        text = `Trafico fluido (densidad ${dens}, vel ${vel}) — sin intervenir`;
      } else if (lane && h.action === 1 && h.reward <= 0) {
        // DIVERT sin exito
        cls = 'hist-warn';
        icon = '';
        text = `Desvio en carril ${lane}, efecto limitado`;
      } else {
        cls = 'hist-neutral';
        icon = '';
        text = `D:${dens} V:${vel} — ${['Mantener','Desviar','Grua'][h.action]}`;
      }

      const sign = h.reward >= 0 ? '+' : '';
      return `<div class="hist-entry ${cls}">
        <span class="hist-icon">${icon}</span>
        <span class="hist-text">${text}</span>
        <span class="hist-reward ${h.reward >= 0 ? 'rew-pos' : 'rew-neg'}">${sign}${h.reward}</span>
      </div>`;
    }).join('');

    this.panel.historyEl.innerHTML = items;
  }

  // -----------------------------------------------------------------------
  // Mapa de calor de la Q-Table
  // -----------------------------------------------------------------------

  /**
   * Construye un mapa de calor HTML a partir de la politica aprendida.
   * @param {Array<{state: string, bestAction: string, qValues: number[]}>} policy
   * @returns {string} HTML
   */
  _buildHeatmap(policy) {
    const densityOrder = ['low', 'medium', 'high'];
    const speedOrder   = ['high', 'medium', 'low', 'zero'];
    const densityLabels = { low: 'Baja', medium: 'Media', high: 'Alta' };
    const speedLabels   = { high: 'Alta', medium: 'Media', low: 'Baja', zero: 'Cero' };
    const actionIcons = { MAINTAIN: '', DIVERT: 'R', CLEAR: 'G' };
    const actionNames = { MAINTAIN: 'Mantener', DIVERT: 'Desviar', CLEAR: 'Grua' };

    // Indexar politica por stateKey para acceso rapido
    const policyMap = {};
    for (const p of policy) {
      policyMap[p.state] = p;
    }

    // Determinar rango de Q-values para normalizar colores
    let maxAbsQ = 1;
    for (const p of policy) {
      for (const q of p.qValues) {
        maxAbsQ = Math.max(maxAbsQ, Math.abs(q));
      }
    }

    /** Retorna color de fondo basado en el Q-value. */
    function cellColor(maxQ) {
      if (maxQ === 0) return '#252530';
      const ratio = Math.max(-1, Math.min(1, maxQ / maxAbsQ));
      if (ratio > 0.3)  return `rgba(76, 175, 80, ${0.2 + ratio * 0.5})`;
      if (ratio > 0)    return `rgba(255, 193, 7, ${0.2 + ratio * 0.4})`;
      return `rgba(244, 67, 54, ${0.15 + Math.abs(ratio) * 0.4})`;
    }

    // Construir grid: filas = densidad, columnas = velocidad (sin incidente)
    let html = '<div class="heatmap-grid">';

    // Cabecera
    html += '<div class="heatmap-cell heatmap-header">Densidad \\ Velocidad</div>';
    for (const sp of speedOrder) {
      html += `<div class="heatmap-cell heatmap-header heatmap-col-label">${speedLabels[sp]}</div>`;
    }

    // Filas de datos
    for (const dn of densityOrder) {
      html += `<div class="heatmap-cell heatmap-row-label">${densityLabels[dn]}</div>`;
      for (const sp of speedOrder) {
        const key = `${dn}_${sp}_null`;
        const entry = policyMap[key];
        if (entry) {
          const maxQ = Math.max(...entry.qValues);
          const bestIdx = entry.qValues.indexOf(maxQ);
          const bestLabel = ['Mantener', 'Desviar', 'Grua'][bestIdx];
          const bestInitial = ['M', 'D', 'G'][bestIdx];
          const bg = cellColor(maxQ);
          html += `<div class="heatmap-cell" style="background:${bg}" title="${bestLabel}: ${maxQ.toFixed(0)} (Q=[${entry.qValues.map(v=>v.toFixed(0)).join(',')}])">
            <span class="heatmap-action">${bestInitial}</span>
            <span class="heatmap-q">${maxQ.toFixed(0)}</span>
          </div>`;
        } else {
          html += `<div class="heatmap-cell heatmap-empty" title="No visitado">-</div>`;
        }
      }
    }

    html += '</div>';

    // Leyenda
    html += '<div class="heatmap-legend">';
    html += '<span class="legend-item"><span class="legend-swatch" style="background:#4CAF50"></span> Q+ alto</span>';
    html += '<span class="legend-item"><span class="legend-swatch" style="background:#FFC107"></span> Q neutro</span>';
    html += '<span class="legend-item"><span class="legend-swatch" style="background:#F44336"></span> Q- bajo</span>';
    html += '<span class="legend-item"><span class="legend-swatch" style="background:#252530;border:1px solid #444"></span> No visitado</span>';
    html += '</div>';

    // Seccion de incidentes (solo los que se han visitado)
    const incidentEntries = policy.filter(p => !p.state.endsWith('null'));
    if (incidentEntries.length > 0) {
      html += '<div class="heatmap-incidents">';
      html += '<span class="label">Con incidente en carril:</span>';
      for (const p of incidentEntries.slice(0, 4)) {
        const parts = p.state.split('_');
        const lane = parts[2];
        const maxQ = Math.max(...p.qValues);
        const bestIdx = p.qValues.indexOf(maxQ);
        const bestLabel = ['Mantener', 'Desviar', 'Grua'][bestIdx];
        html += `<span class="incident-chip" style="background:${cellColor(maxQ)}">
          Carril ${lane}: ${bestLabel} (${maxQ.toFixed(0)})
        </span>`;
      }
      html += '</div>';
    }

    return html;
  }

  resetChart() {
    this.speedHistory = [];
    this.rewardHistory = [];
  }
}
