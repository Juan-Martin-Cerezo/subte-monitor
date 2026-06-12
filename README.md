# BA SUBTE - Monitor de Red en Tiempo Real

Este proyecto es un sistema interactivo e inmersivo para la telemetría y monitoreo en tiempo real de la red de subterráneos de la Ciudad de Buenos Aires (SBASE).

## 🚀 Características Principales

*   **Mapa Interactivo Leaflet**: Visualización en vivo de la posición geográfica estimada de las formaciones en la red.
*   **Seguimiento Dinámico de Trenes**: Opción de "pinear" o seguir un tren específico, centrando la cámara de forma automática sin interferir con el nivel de zoom elegido por el usuario.
*   **Planificador de Rutas**: Motor integrado para calcular rutas óptimas y trasbordos inteligentes, filtrando accesos sin barreras para personas con movilidad reducida.
*   **Historial de Congestión**: Análisis y gráficos visuales del flujo y volumen de pasajeros por hora y estación.
*   **Reportes de Plataforma**: Sistema colaborativo que permite a los usuarios reportar incidentes (demoras, congestión, climatización, seguridad) en vivo.
*   **Soporte Multi-Línea e Interfaces**: Vistas personalizadas por cada línea (A, B, C, D, E, H) y opción unificada de "Todas las Líneas".
*   **Fallback Inteligente**: Simulación determinista en tiempo real que se activa si la API del Gobierno de la Ciudad de Buenos Aires (GCBA) no está disponible.

## 🛠️ Stack Tecnológico

*   **Framework**: Next.js 16 (Turbopack) con App Router.
*   **Base de Datos**: PostgreSQL gestionado con Prisma ORM.
*   **Estilos**: Tailwind CSS con diseño de paneles translúcidos.
*   **Mapas**: Leaflet.js integrado de manera responsiva.

---

## 📖 Arquitectura Detallada

Para una explicación técnica exhaustiva sobre los algoritmos centrales (como la asignación de ranuras de vía fijas y hashing estable stateless para la telemetría), consulta el archivo de arquitectura detallado:

👉 **[Explicación de Arquitectura Completa (ARCHITECTURE.md)](file:///home/juan/Escritorio/Programacion/subte-monitor/ARCHITECTURE.md)**

---

## 💻 Comandos de Desarrollo

```bash
# Instalar dependencias
npm install

# Correr en desarrollo
npm run dev

# Generar cliente Prisma
npx prisma generate

# Aplicar migraciones y semillas a la Base de Datos
npx prisma db push
npx prisma db seed

# Compilar para producción
npm run build
```
