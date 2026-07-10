# Simulador de Trafico Inteligente — Q-Learning

Simulador interactivo de una autopista de 4 carriles donde un agente de **Q-Learning** aprende a distinguir entre congestion normal y accidentes (vehiculo detenido en un carril), tomando acciones correctivas para evitar el colapso del trafico.

**Ver en vivo:** [jonoline.github.io/Proyecto_Sistemas_Inteligentes_RL](https://jonoline.github.io/Proyecto_Sistemas_Inteligentes_RL/)

## Requisitos

- Navegador web moderno con soporte para **ES6 Modules** y **Canvas 2D**.
- **Python 3** (para servir los archivos localmente).

## Instalacion y ejecucion

```bash
# 1. Clonar el repositorio
git clone git@github.com:Jonoline/Proyecto_Sistemas_Inteligentes_RL.git
cd Proyecto

# 2. Servir los archivos con un servidor local (necesario para modulos ES6)
python3 -m http.server 8000

# 3. Abrir en el navegador
#    http://localhost:8000
```

## Estructura del proyecto

```
Proyecto/
├── index.html              # HTML con 3 pestañas (Teoria RL, Simulacion, Resultados)
├── css/
│   └── styles.css          # Tema oscuro, layout de 3 columnas, tarjetas flip
├── js/
│   ├── simulation.js       # Motor de simulacion (4 carriles, 3 tipos de vehiculo)
│   ├── rl-agent.js         # Agente Q-Learning con MDP de 4 dimensiones
│   ├── visualizer.js       # Canvas 2D, grafico de metricas, efectos visuales
│   └── main.js             # Loop principal, integracion y controles
└── README.md
```

## Como funciona

### El problema

El agente observa una autopista de 4 carriles con trafico fluyendo de izquierda a derecha. Debe decidir si:

- El trafico lento es **normal** (todos los carriles avanzan aunque despacio).
- Hay un **accidente** (un vehiculo detenido por completo en un carril, bloqueandolo).

### Modelo MDP

| Elemento | Descripcion |
|----------|-------------|
| **Estados** | 4 dimensiones: `densidad` (baja/media/alta) × `velocidad` (cero/baja/media/alta) × `carril del accidente` (null/0/1/2/3) × `estado de grua` (lista/enfriamiento) → ~120 estados |
| **Acciones** | Mantener flujo · Activar desvio · Despejar con grua |
| **Recompensas** | `+20` resolver accidente · `+5` mitigar con desvio · `+2` desvio suboptimo · `+1` trafico normal · `−5` grua no disponible · `−10` falso positivo · `−30` ignorar accidente |

### Cooldown de grua

Tras usar la grua, entra en enfriamiento durante 5 segundos. Durante ese tiempo el agente debe usar el desvio para mitigar la congestion mientras espera.

### Arco de aprendizaje

1. **Inicio** — Q-Table en ceros. El agente ignora los accidentes → la autopista colapsa (recompensa muy negativa).
2. **Entrenamiento** — Por ensayo y error (epsilon-greedy, ε=1.0 → 0.01), descubre que despejar accidentes da recompensa positiva y que durante el cooldown conviene desviar.
3. **Convergencia** — Aprende la politica optima: mantener flujo normal, despejar accidentes con grua, desviar durante enfriamiento.

## Pestañas de la interfaz

### Teoria RL (pagina de inicio)
Explicacion generica de aprendizaje por refuerzo con anotaciones conectando al simulador:
- Diagrama animado agente-entorno con flechas de accion, estado y recompensa
- Ecuacion de Bellman (Q-Learning) con glosario de terminos
- 9 tarjetas interactivas con efecto flip 3D (Agente, Entorno, Estado, Accion, Recompensa, Politica, ε-greedy, Q-Table, Factor γ)

### Simulacion en Vivo
Layout de 3 columnas:

| Columna | Contenido |
|---------|-----------|
| **Izquierda** | Autopista (canvas 2D) + Grafico velocidad/recompensa |
| **Central** | Centro de control: estado, accion, recompensa, estado de grua, cuenta regresiva, historial narrativo, mapa de calor Q-Table |
| **Derecha** | Controles: botones, slider de velocidad, pausa, tabla de recompensas |

### Resultados
Analisis del entrenamiento, conclusiones del desarrollo y limitaciones del aprendizaje por refuerzo:
- Grafico velocidad/recompensa y evolucion de la Q-Table con capturas
- 5 conclusiones del proceso de desarrollo
- 6 limitaciones genericas del RL con soluciones propuestas (DQN, Policy Gradients, etc.)
- Referencias academicas

## Controles

| Control | Funcion |
|---------|---------|
| **Choque** | Genera un accidente aleatorio |
| **Grua** | Despeja manualmente el accidente activo |
| **Auto-Accidentes** | Genera accidentes automaticos cada 2-8s para entrenamiento |
| **Slider de velocidad** | 0.5x a 20x con escala exponencial y ajuste a valores clave |
| **Pausar** | Congela toda la simulacion |
| **Agente: ACTIVADO/DESACTIVADO** | Pausa solo las decisiones del agente |
| **Reiniciar Todo** | Resetea simulacion, Q-Table y recompensa acumulada |

## Efectos visuales

- **Vehiculos**: 3 tipos (auto, camion, bus) con colores variados, faros, luces de freno y sombras
- **Accidentes**: borde rojo pulsante, zona de peligro sombreada en el carril, humo gris, luces de emergencia
- **Acciones**: banner superior, barrera naranja de desvio por carril, destello verde de grua
- **Carretera**: lineas discontinuas con efecto parallax

## Grafico de metricas

- Eje izquierdo: velocidad promedio en px/frame (azul)
- Eje derecho: recompensa en puntos (dorado)
- Lineas punteadas verticales en cada decision del agente
- Triangulos rojos al ocurrir un accidente
- Tooltip al pasar el mouse con valores exactos

## Persistencia

La Q-Table se guarda automaticamente en `localStorage` cada 5 segundos y al cerrar la pestaña. Al recargar la pagina, el agente retoma el entrenamiento donde lo dejo.

## Tecnologias

- **JavaScript ES6** vanilla (sin frameworks ni dependencias)
- **Canvas 2D API** para renderizado y graficos
- **Q-Learning** clasico con epsilon-greedy y decaimiento exponencial
- **CSS Grid + Flexbox** para layout responsive
