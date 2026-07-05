# Simulador de Tráfico Inteligente — Q-Learning

Simulador interactivo de una autopista de 4 carriles donde un agente de **Q-Learning** aprende a distinguir entre congestión normal (hora punta) e incidentes (vehículo detenido en un carril), tomando acciones correctivas para evitar el colapso del tráfico.

## Requisitos

- Navegador web moderno con soporte para **ES6 Modules** y **Canvas 2D**.
- **Python 3** (para servir los archivos localmente).

> También funciona con Node.js (`npx serve .`), PHP (`php -S localhost:8000`) o cualquier servidor HTTP estático. No se requieren dependencias externas.

## Instalación y ejecución

```bash
# 1. Clonar el repositorio
git clone <url-del-repo>
cd Proyecto

# 2. Servir los archivos con un servidor local (necesario para módulos ES6)
python3 -m http.server 8000

# 3. Abrir en el navegador
#    http://localhost:8000
```

## Estructura del proyecto

```
Proyecto/
├── index.html              # Estructura HTML (3 paneles + barra de controles)
├── css/
│   └── styles.css          # Tema oscuro, badges de estado, layout responsive
├── js/
│   ├── simulation.js       # Motor de simulación de tráfico
│   ├── rl-agent.js         # Agente Q-Learning (MDP)
│   ├── visualizer.js       # Renderizado Canvas 2D + gráfico de métricas
│   └── main.js             # Loop principal e integración de módulos
└── README.md
```

## Cómo funciona

### El problema

El agente observa una autopista de 4 carriles con tráfico fluyendo de izquierda a derecha. Debe decidir si:

- El tráfico lento es **normal** (hora punta: todos los carriles avanzan aunque despacio).
- Hay una **anomalía** (un vehículo detenido por completo en un carril, bloqueándolo).

### Modelo MDP

| Elemento | Descripción |
|----------|-------------|
| **Estados** | 3 dimensiones discretizadas: `densidad` (low/medium/high) × `velocidad` (zero/low/medium/high) × `carril del incidente` (null/0/1/2/3) → 60 estados teóricos |
| **Acciones** | `0` Mantener flujo · `1` Activar desvío · `2` Despejar con grúa |
| **Recompensas** | `+20` detectar y despejar incidente · `+10` tráfico normal fluyendo · `−10` falso positivo · `−30` falso negativo |

### Arco de aprendizaje

1. **Inicio** — Q-Table en ceros. El agente ignora los incidentes → la autopista colapsa (recompensa muy negativa).
2. **Entrenamiento** — Por ensayo y error (epsilon-greedy), descubre que despejar incidentes da recompensa positiva.
3. **Convergencia** — Aprende la política óptima: ignorar hora punta normal, despejar incidentes reales inmediatamente.

## Controles

| Botón | Función |
|-------|---------|
| **Choque** | Genera un incidente aleatorio en un carril |
| **Grúa** | Despeja manualmente el incidente activo |
| **Auto-Incidentes** | Activa/desactiva la generación automática de incidentes para entrenamiento |
| **Velocidad − / +** | Ajusta la velocidad de simulación (1x – 20x) |
| **Reiniciar Todo** | Resetea simulación, Q-Table y recompensa acumulada |

## Paneles de la interfaz

- **Autopista** — Canvas 2D con 4 carriles, vehículos coloreados, luces de emergencia parpadeantes en incidentes.
- **Métricas de Tráfico** — Gráfico en tiempo real de velocidad media (azul) y flujo de vehículos por minuto (verde).
- **Centro de Control** — Estado observado, acción tomada, recompensa, épsilon actual y resumen de política aprendida.

## Persistencia

La Q-Table se guarda automáticamente en `localStorage` cada 5 segundos y al cerrar la pestaña. Al recargar la página, el agente retoma el entrenamiento donde lo dejó.

## Tecnologías

- **JavaScript ES6** vanilla (sin frameworks ni dependencias)
- **Canvas 2D API** para renderizado
- **Q-Learning** clásico con epsilon-greedy y decaimiento exponencial
- **CSS Grid + Flexbox** para layout responsive
