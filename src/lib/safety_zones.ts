import type { LineId } from '@/components/dashboard/lines';

export type RiskLevel = 'ALTO' | 'CRITICO' | 'MEDIO-ALTO';

export interface SafetyZone {
  id: string;
  name: string;
  corridor: string; // Calles / manzanas delimitadas
  lines: LineId[];
  center: [number, number]; // [lat, lng]
  polygon: [number, number][]; // Coordenadas del polígono del corredor/cuadras
  riskLevel: RiskLevel;
  primaryRisk: string; // Riesgo principal
  modalities: string[]; // Modalidades habituales de robo
  tips: string[]; // Recomendaciones de prevención
  hotTimes?: string; // Horarios pico
}

export const SAFETY_ZONES: SafetyZone[] = [
  {
    id: 'nodo-obelisco',
    name: 'Nodo Obelisco & Galería Subterránea',
    corridor: 'Av. Corrientes e/ Cerrito y Suipacha · Diagonal Norte y 9 de Julio',
    lines: ['LineaB', 'LineaC', 'LineaD'],
    center: [-34.6039, -58.3803],
    polygon: [
      [-34.6026, -58.3816],
      [-34.6042, -58.3828],
      [-34.6053, -58.3792],
      [-34.6035, -58.3780],
    ],
    riskLevel: 'CRITICO',
    primaryRisk: 'Arrebato de celulares en puertas de vagón y punguismo en túneles',
    modalities: [
      'Tirón de teléfono desde el andén justo antes del arranque del tren',
      'Punguismo en pasillos estrechos de combinación (Galería Obelisco)',
      'Apertura silenciosa de mochilas y bolsillos en vagones repletos',
    ],
    tips: [
      'No usar el celular pegado a las puertas de la formación al partir',
      'Llevar la mochila hacia adelante en los túneles de combinación B-C-D',
    ],
    hotTimes: '07:30 - 10:30 y 16:30 - 20:30',
  },
  {
    id: 'once-miserere',
    name: 'Polo Once - Plaza Miserere & FFCC',
    corridor: 'Av. Rivadavia e/ Pueyrredón y Boulogne Sur Mer · Plaza Miserere',
    lines: ['LineaA', 'LineaH'],
    center: [-34.6092, -58.4064],
    polygon: [
      [-34.6078, -58.4082],
      [-34.6105, -58.4086],
      [-34.6110, -58.4045],
      [-34.6080, -58.4042],
    ],
    riskLevel: 'CRITICO',
    primaryRisk: 'Robo express, arrebato en molinetes y punguismo masivo',
    modalities: [
      'Arrebato de teléfonos y cadenas en bocas de acceso a la plaza y molinetes',
      'Punguistas en grupos durante el "apretón" en el ingreso al vagón',
      'Robos al paso en la combinación entre Línea A, Línea H y FFCC Sarmiento',
    ],
    tips: [
      'Guardar el celular en bolsillos internos con cierre antes de ingresar',
      'Evitar quedar pegado a la multitud en el borde del andén',
      'Atención en transbordos y escaleras de conexión',
    ],
    hotTimes: 'Todo el día, crítico en horas pico y noche',
  },
  {
    id: 'constitucion',
    name: 'Cabecera Constitución & Hall Roca',
    corridor: 'Lima e/ Brasil y Pavón · Hall central y molinetes FFCC Roca',
    lines: ['LineaC'],
    center: [-34.6276, -58.3814],
    polygon: [
      [-34.6260, -58.3830],
      [-34.6292, -58.3835],
      [-34.6295, -58.3795],
      [-34.6263, -58.3792],
    ],
    riskLevel: 'CRITICO',
    primaryRisk: 'Arrebatos violentos, punguismo y despojo en salidas',
    modalities: [
      'Arrebato en zona de molinetes y hall de transbordo hacia el tren',
      'Sustracción por empujón masivo en andenes de cabecera',
      'Arrebatos en escaleras de acceso sobre calles Lima y Brasil',
    ],
    tips: [
      'Guardar dispositivos y pertenencias antes de arribar a la cabecera',
      'Cruzar molinetes con bolsos y mochilas al frente',
      'No circular con auriculares llamativos en el hall de transbordo',
    ],
    hotTimes: '06:30 - 09:30 y 16:00 - 21:00',
  },
  {
    id: 'retiro',
    name: 'Nodo Retiro & Plaza San Martín',
    corridor: 'Av. Ramos Mejía e/ Av. del Libertador y Antártida Argentina',
    lines: ['LineaC', 'LineaE'],
    center: [-34.5916, -58.3745],
    polygon: [
      [-34.5902, -58.3765],
      [-34.5932, -58.3768],
      [-34.5935, -58.3725],
      [-34.5905, -58.3722],
    ],
    riskLevel: 'CRITICO',
    primaryRisk: 'Arrebatos en andenes, bocas de salida y transbordo ferroviario',
    modalities: [
      'Arrebato en bocas de acceso hacia Plaza San Martín y Estación Mitre',
      'Punguismo en formaciones paradas esperando horario de salida',
      'Sustracción al paso en escaleras de transbordo C-E',
    ],
    tips: [
      'No exhibir teléfonos ni objetos de valor en andenes ni salidas',
      'Prestar atención al sentarse cerca de puertas o ventanillas',
    ],
    hotTimes: '07:00 - 10:00 y 16:30 - 21:30',
  },
  {
    id: 'plaza-de-mayo',
    name: 'Plaza de Mayo / Catedral / Bolívar',
    corridor: 'Av. de Mayo e/ Bolívar y Perú · Rivadavia y San Martín',
    lines: ['LineaA', 'LineaD', 'LineaE'],
    center: [-34.6086, -58.3725],
    polygon: [
      [-34.6072, -58.3742],
      [-34.6099, -58.3745],
      [-34.6102, -58.3708],
      [-34.6075, -58.3705],
    ],
    riskLevel: 'ALTO',
    primaryRisk: 'Arrebato en andenes y punguismo en escaleras',
    modalities: [
      'Arrebato de celular al sonar el timbre de cierre de puertas',
      'Punguismo en accesos peatonales y combinación subterránea',
      'Distracciones orquestadas en escaleras mecánicas',
    ],
    tips: [
      'No manipular el teléfono cerca de las puertas del vagón',
      'Llevar mochila o bolso adelante en horarios pico',
    ],
    hotTimes: 'Lunes a Viernes 08:00 - 10:30 y 17:00 - 19:30',
  },
  {
    id: 'pueyrredon-corrientes',
    name: 'Corredor Pueyrredón & Corrientes',
    corridor: 'Av. Pueyrredón e/ Sarmiento y Lavalle · Av. Corrientes',
    lines: ['LineaB', 'LineaH'],
    center: [-34.6045, -58.4054],
    polygon: [
      [-34.6033, -58.4072],
      [-34.6058, -58.4075],
      [-34.6060, -58.4035],
      [-34.6035, -58.4032],
    ],
    riskLevel: 'ALTO',
    primaryRisk: 'Punguismo en transbordo B-H y arrebatos en accesos',
    modalities: [
      'Arrebato en escaleras mecánicas hacia Av. Pueyrredón',
      'Punguismo durante el transbordo entre líneas B y H',
    ],
    tips: [
      'No usar el celular en escaleras mecánicas o cerca de las salidas',
      'Mantener bolsos cruzados hacia el frente',
    ],
    hotTimes: '12:00 - 14:00 y 17:00 - 20:00',
  },
  {
    id: 'pueyrredon-santafe',
    name: 'Corredor Santa Fe & Pueyrredón',
    corridor: 'Av. Santa Fe e/ Pueyrredón y Ecuador · Pasillo D-H',
    lines: ['LineaD', 'LineaH'],
    center: [-34.5944, -58.4023],
    polygon: [
      [-34.5932, -58.4042],
      [-34.5958, -58.4045],
      [-34.5960, -58.4005],
      [-34.5935, -58.4002],
    ],
    riskLevel: 'ALTO',
    primaryRisk: 'Arrebato de celulares y punguismo en combinación',
    modalities: [
      'Sustracción de teléfonos en el túnel de combinación D-H',
      'Arrebatos rápidos hacia las salidas de Av. Santa Fe',
    ],
    tips: [
      'Prestar especial atención en pasillos de transbordo',
      'No llevar teléfonos en bolsillos traseros',
    ],
    hotTimes: '08:00 - 10:00 y 17:30 - 20:00',
  },
  {
    id: 'juramento',
    name: 'Centro Comercial Belgrano (Juramento)',
    corridor: 'Av. Cabildo e/ Juramento y Echeverría',
    lines: ['LineaD'],
    center: [-34.5623, -58.4565],
    polygon: [
      [-34.5610, -58.4582],
      [-34.5638, -58.4585],
      [-34.5640, -58.4548],
      [-34.5612, -58.4545],
    ],
    riskLevel: 'ALTO',
    primaryRisk: 'Arrebato de celulares y escape hacia Metrobus',
    modalities: [
      'Arrebato rápido en bocas sobre Av. Cabildo y escape hacia el metrobus',
      'Punguismo en andenes abarrotados durante la tarde/noche',
    ],
    tips: [
      'Evitar responder mensajes o llamadas en escaleras de salida',
      'Cerrar mochilas y bolsos antes de descender',
    ],
    hotTimes: '16:00 - 20:30',
  },
  {
    id: 'independencia',
    name: 'Transbordo Independencia & 9 de Julio',
    corridor: 'Bernardo de Irigoyen / Lima e/ Independencia y Estados Unidos',
    lines: ['LineaC', 'LineaE'],
    center: [-34.6180, -58.3810],
    polygon: [
      [-34.6168, -58.3828],
      [-34.6193, -58.3831],
      [-34.6195, -58.3792],
      [-34.6170, -58.3789],
    ],
    riskLevel: 'ALTO',
    primaryRisk: 'Punguismo en combinación C-E y arrebatos en accesos',
    modalities: [
      'Arrebato en escaleras de salida hacia Av. 9 de Julio / Independencia',
      'Punguismo en túnel de combinación entre Líneas C y E',
    ],
    tips: [
      'Atención en escaleras y pasillos de conexión',
      'Mantener pertenencias aseguradas al pecho',
    ],
    hotTimes: '08:00 - 10:00 y 17:00 - 19:30',
  },
  {
    id: 'hospitales',
    name: 'Cabecera Hospitales (Parque Patricios)',
    corridor: 'Av. Almafuerte e/ Uspallata y Cachi',
    lines: ['LineaH'],
    center: [-34.6413, -58.4124],
    polygon: [
      [-34.6400, -58.4142],
      [-34.6428, -58.4145],
      [-34.6430, -58.4105],
      [-34.6402, -58.4102],
    ],
    riskLevel: 'ALTO',
    primaryRisk: 'Arrebatos en bocas de acceso y andenes desolados',
    modalities: [
      'Arrebato al salir a la superficie hacia Av. Almafuerte / Uspallata',
      'Robo de pertenencias en horarios valle con baja frecuencia',
    ],
    tips: [
      'No esperar en esquinas con poca iluminación al salir del subte',
      'Guardar pertenencias antes de subir a la superficie',
    ],
    hotTimes: 'Noche y fines de semana',
  },
];

/**
 * Encuentra zonas de riesgo asociadas a una estación por coincidencia de nombre o proximidad geográfica.
 */
export function getSafetyZonesForStation(stationName: string): SafetyZone[] {
  const norm = stationName.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  return SAFETY_ZONES.filter(z => {
    const normZone = z.name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
    const normCorridor = z.corridor.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
    return normZone.includes(norm) || norm.includes(normZone) || normCorridor.includes(norm);
  });
}
