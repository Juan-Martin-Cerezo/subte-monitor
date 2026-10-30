export interface Station {
  stopId: string;
  stopName: string;
  latitude: number;
  longitude: number;
}

export interface RouteSequence {
  id: string;
  routeId: string;
  directionId: number;
  stopSequence: number;
  stopId: string;
}

export interface Bootstrap {
  stations: Station[];
  sequences: RouteSequence[];
  error?: string;
}

export interface Train {
  id: string;
  routeId: string;
  directionId: number;
  status: 'STOPPED' | 'IN_TRANSIT';
  progress: number;
  latitude: number;
  longitude: number;
  nextStopId: string;
  nextStopName: string;
  prevStopId: string;
  prevStopName: string;
  etaSeconds: number;
  delaySeconds: number;
  updatedAt: number;
}

export interface Alert {
  id: string;
  routeId: string;
  headerText: string;
  descriptionText: string;
  cause: string;
  effect: string;
}

export interface Prediction {
  routeId: string;
  directionId: number;
  stopId: string;
  stationName: string;
  destinationName: string;
  etaSeconds: number;
  delay: number;
}

export interface Telemetry {
  trains: Train[];
  alerts: Alert[];
  predictions: Prediction[];
  stale: boolean;
}
