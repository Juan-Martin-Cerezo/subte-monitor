# Guía Técnica y Arquitectura de `subte-monitor`

Esta documentación explica en detalle el funcionamiento, la estructura de código y los algoritmos centrales de la aplicación **subte-monitor**, un sistema de telemetría y visualización en tiempo real de la red de subterráneos de Buenos Aires.

---

## 1. Arquitectura General y Stack Tecnológico

La aplicación está construida utilizando un enfoque moderno y robusto de grado de producción:

*   **Framework**: [Next.js 15+ (App Router)](file:///home/juan/Programación/subte-monitor/src/app) con renderizado híbrido. El punto de entrada inicial es del lado del servidor (SSR) para cargar los datos de estaciones estáticas desde la base de datos, y luego pasa el control al cliente para la telemetría en tiempo real.
*   **Base de Datos y ORM**: **PostgreSQL** administrado a través de **Prisma ORM (v6)**. Almacena las estaciones de la red, las secuencias de parada de cada línea (GTFS) y los reportes de los usuarios.
*   **Diseño Visual**: **Tailwind CSS v4** con un diseño inmersivo y de alta fidelidad, basado en paneles translúcidos flotantes (glassmorphic panels) sobre una malla de fondo oscura (mesh grid).
*   **Telemetría y Tiempo Real**: Consumo periódico de la API oficial de Tránsito del GCBA (formato GTFS Realtime) cada 3 segundos, con caché de 4 segundos en servidor.
*   **Líneas soportadas**: Subte A, B, C, D, E, H + **Premetro** (ramales Cívico y Savio).

---

## 2. Estructura de Archivos del Proyecto

El proyecto está organizado de la siguiente manera:

```text
subte-monitor/
├── prisma/
│   ├── schema.prisma       # Definición de modelos de base de datos (PostgreSQL)
│   └── seed.ts             # Script de parsing del GTFS oficial y precarga de estaciones
├── src/
│   ├── app/
│   │   ├── api/
│   │   │   ├── historical/  # Endpoint para estadísticas y flujo histórico de pasajeros
│   │   │   ├── reports/     # API para leer y crear reportes de congestión/estado
│   │   │   └── telemetry/   # API principal de telemetría ( GCBA Live / Mock Simulation)
│   │   ├── globals.css      # Estilos globales de Tailwind CSS v4
│   │   ├── layout.tsx       # Estructura del documento HTML e inyección de tipografías
│   │   └── page.tsx         # SSR Entry Point: Carga estaciones y secuencias de parada
│   ├── components/
│   │   └── SubteDashboard.tsx # Componente de mapas e interacciones en tiempo real
│   └── lib/
│       ├── db.ts            # Cliente Singleton de Prisma
│       ├── telemetry.ts     # Algoritmo Fixed Track-Slot, Stable Hashing y Holding at the Signal
│       └── shapes.ts        # Coordenadas GTFS de formas de vía para interpolación geoespacial
├── gtfs.zip                 # Archivo zip con la especificación GTFS oficial de la red
└── package.json             # Dependencias del proyecto
```

---

## 3. Algoritmos Centrales y Lógica de Telemetría

El mayor desafío técnico del Subte de Buenos Aires es que la API oficial de tránsito **no provee un identificador único persistente para las formaciones físicas en circulación**. En su lugar, provee un mapa plano de arribos estimados por andén (ej. "el próximo tren a Catedral llegará a la estación Agüero en 180 segundos").

Para resolver esto sin base de datos en memoria o sesiones complejas, se implementaron dos algoritmos clave en [`src/lib/telemetry.ts`](file:///home/juan/Programación/subte-monitor/src/lib/telemetry.ts):

### A. Algoritmo de Ranuras de Vía Fijas (Fixed Track-Slot)
Este algoritmo agrupa los arribos estimados en el espacio-tiempo. 
1. Para cada línea y dirección, se leen todas las predicciones de arribos.
2. Cada predicción indica que un tren llegará a la estación $S$ en el tiempo absoluto $T_{arribo} = T_{actual} + ETA$.
3. Se proyecta hacia atrás en el tiempo cuándo partió ese tren de la terminal de origen ($T_{inicio\_viaje}$), restándole el tiempo nominal acumulado de viaje desde la terminal hasta la estación $S$.
4. Se agrupan estas estimaciones de partida ($T_{inicio\_viaje}$) utilizando un algoritmo de **Clustering 1D (similar a DBSCAN 1D)**. Si dos predicciones de andén distintas apuntan a un tiempo de inicio de viaje con una diferencia menor a 3 minutos, se asume que se refieren a **la misma formación física**.
5. Las estimaciones agrupadas forman un "tren aislado" virtual con sus respectivas paradas y horarios programados de arribo a lo largo de la línea.

### B. Hashing Estable (Stable Hashing)
Para asignar un identificador persistente (ej. `A-4EF2`) a cada grupo (tren virtual) de manera stateless (sin estado):
1. Se calcula el promedio de los tiempos proyectados de inicio de viaje ($T_{inicio\_viaje}$) de las predicciones del clúster.
2. Se redondea este tiempo en cubos de **150 segundos** ($T_{redondeado}$). Esto evita fluctuaciones leves de estimación en la API entre consultas consecutivas.
3. Se genera un hash MD5 combinando:
   $$\text{Hash} = \text{MD5}(\text{routeId} + \text{directionId} + T_{redondeado})$$
4. Se toman los primeros 4 caracteres hex del hash para componer el ID final: `[Línea]-[4-HEX-CHARS]`. Este ID se mantendrá estable durante todo el recorrido del tren por la línea y cambiará únicamente cuando inicie una nueva vuelta (trip).

### C. Holding at the Signal (Confirmación Estricta de Eventos)
Esta arquitectura resuelve el problema de **teletransportación de formaciones** cuando la API del GCBA sufre latencia.

El problema: cuando la API se congela por N segundos, el reloj local (`nowUnix`) sigue avanzando. Las condiciones matemáticas del filtrado eliminaban estaciones del array y el tren "saltaba" a la siguiente sin confirmación real.

**Las 3 Reglas de Oro:**
1. **`etaEnPaquete`**: Cada parada almacena su ETA relativa al timestamp del paquete de la API (`arr.arrivalTime - feedTimestamp`). Si la API se congela, este valor se congela con ella.
2. **Selección inmutable del `activeStop`**: Se evalúa contra `etaEnPaquete >= -40` en vez de contra `nowUnix`. La estación objetivo solo cambia cuando la API envía un paquete confirmando que ya pasó.
3. **Techo de cristal en 0.95**: El reloj local solo se usa para interpolar el progreso visual, pero se limita a `Math.min(0.95, ...)`. Si el reloj llega al final del tramo pero la API no confirma, el tren se queda clavado al 95% ("esperando en la señal").

**Dead Reckoning**: Para trenes temporalmente ausentes del feed (hasta 40s), se fuerza `IN_TRANSIT` con techo 0.95. Nunca se confirma arribo a andén sin datos frescos.

---

## 4. Visualización en Mapa e Interpolación Geoespacial

El mapa interactivo full-screen está renderizado en SVG puro dentro de [`src/components/SubteDashboard.tsx`](file:///home/juan/Programación/subte-monitor/src/components/SubteDashboard.tsx).

### A. Proyección de Coordenadas
Las coordenadas geográficas (latitud, longitud) se proyectan linealmente a coordenadas SVG ($1000 \times 720$) utilizando los extremos geográficos de la red:
```typescript
const projectX = (lon: number) => {
  return ((lon - finalMinLon) / (finalMaxLon - finalMinLon)) * svgWidth;
};

const projectY = (lat: number) => {
  return (1 - (lat - finalMinLat) / (finalMaxLat - finalMinLat)) * svgHeight;
};
```

### B. Interpolación de Posición
Si un tren se encuentra en tránsito entre la estación anterior ($S_{prev}$) y la estación siguiente ($S_{next}$):
1. Se calcula la duración nominal del tramo en segundos.
2. Se calcula el progreso lineal del tren:
   $$\text{progreso} = \frac{\text{duración nominal} - \text{ETA a } S_{next}}{\text{duración nominal}}$$
3. Se interpola la latitud y longitud del marcador:
   $$\text{lat}_{tren} = \text{lat}_{prev} + \text{progreso} \times (\text{lat}_{next} - \text{lat}_{prev})$$
   $$\text{lon}_{tren} = \text{lon}_{prev} + \text{progreso} \times (\text{lon}_{next} - \text{lon}_{prev})$$

---

## 5. Sistema de Seguimiento Direccional y Pineo

Las últimas mejoras introducidas mejoran radicalmente la experiencia de usuario resolviendo las necesidades de dirección, tracking y limpieza:

### A. Indicador de Rumbo del Tren (Heading Vector)
Para indicar hacia dónde se dirige el tren sin depender únicamente de la dirección binaria (Id 0 o 1):
1. Se calcula el vector en pantalla desde la posición previa del tren (o posición actual si está arrancando) hacia la próxima estación ($S_{next}$).
2. Se calcula el ángulo matemático en grados usando arcotangente 2 (`Math.atan2`):
   $$\theta = \text{atan2}(\Delta Y_{svg}, \Delta X_{svg}) \times \frac{180}{\pi}$$
3. Este ángulo se inyecta en una etiqueta SVG de rotación `<g transform="rotate(theta)">`.
4. El marcador del tren dibuja una **punta/nariz triangular** fuera del círculo y un **chevron de dirección interno** orientados exactamente a lo largo de las vías en la dirección de la marcha.

### B. Sistema de Seguimiento y Foco (Pinning Mode)
Al hacer clic en un tren y seleccionar **"Seguir Formación"**:
1. Se guarda el ID del tren en el estado `pinnedTrainId`.
2. El cálculo de los límites del mapa (`finalMinLat`, `finalMaxLat`, etc.) se reajusta para encerrar un cuadrante de tamaño fijo (zoom de ~1.3km) centrado exactamente en la posición del tren.
3. Cada vez que llega un reporte de telemetría (cada 10 segundos) y el tren se mueve, el mapa se desplaza automáticamente manteniéndolo en el centro absoluto (`500, 360` del SVG).
4. El tren seguido se destaca visualmente con un **anillo de tracking rotativo segmentado** (`strokeDasharray` animado) para denotar que el rastreo GPS está activo.
5. Se muestra un banner inmersivo superior con la opción de *"Liberar"* para volver a la visualización de red completa.

---

## 6. Comandos Útiles de Desarrollo

Para trabajar con el código y levantar el entorno local:

```bash
# Instalar dependencias
npm install

# Iniciar servidor de desarrollo local
npm run dev

# Generar cliente de Prisma
npx prisma generate

# Crear base de datos y correr migraciones
npx prisma db push

# Correr el script GTFS seed para precargar estaciones y secuencias
npx prisma db seed

# Construir para producción
npm run build
```
