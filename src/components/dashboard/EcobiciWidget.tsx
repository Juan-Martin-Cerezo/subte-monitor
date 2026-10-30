"use client";

import { useState, useEffect } from "react";
import type { EcobiciStation } from "@/lib/ecobici";
import { Icon } from "./Icon";

interface Props {
  stations: EcobiciStation[];
}

function haversineDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

export function EcobiciWidget({ stations }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => {
          /* silent */
        },
        { enableHighAccuracy: false, timeout: 5000 }
      );
    }
  }, []);

  if (stations.length === 0) return null;

  const refLat = userLocation?.lat ?? -34.6037;
  const refLng = userLocation?.lng ?? -58.3816;

  const nearest = stations
    .map((s) => ({ ...s, distance: haversineDistance(refLat, refLng, s.lat, s.lng) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, expanded ? 8 : 4);

  const withBikes = nearest.filter((s) => s.bikesAvailable > 0);
  const withoutBikes = nearest.filter((s) => s.bikesAvailable === 0);

  return (
    <div className="absolute bottom-16 left-2 right-2 md:left-auto md:right-4 md:bottom-4 z-30 md:max-w-[280px]">
      <div className="glass-panel rounded-lg p-2.5 md:p-3 space-y-1.5 md:space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 md:gap-2">
            <Icon.Bike size={14} className="text-green-400 shrink-0" />
            <span className="text-label-caps text-outline text-[10px] tracking-widest">
              Ecobici
            </span>
            <span className="text-[9px] text-green-400/70 font-mono">
              {withBikes.length > 0 ? `${withBikes.length} con bicis` : "sin bicis cerca"}
            </span>
          </div>
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-outline hover:text-on-surface transition p-1.5 -m-1.5 min-w-[32px] min-h-[32px] flex items-center justify-center"
          >
            <Icon.Caret size={12} className={expanded ? "rotate-180" : ""} />
          </button>
        </div>

        <div className="space-y-1">
          {withBikes.map((s) => (
            <div key={s.id} className="flex items-center gap-2">
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${s.bikesAvailable > 5 ? "bg-green-400" : "bg-amber-400"}`}
              />
              <span className="text-on-surface truncate flex-1 text-[11px]">{s.name}</span>
              <span className="text-outline text-[10px] shrink-0">{s.distance}m</span>
              <span
                className={`text-[10px] font-mono font-bold ${s.bikesAvailable > 5 ? "text-green-400" : "text-amber-400"}`}
              >
                {s.bikesAvailable}
              </span>
            </div>
          ))}

          {!expanded && withoutBikes.length > 0 && (
            <p className="text-[9px] text-outline/60 text-center pt-1">
              +{withoutBikes.length} estaciones cercanas sin bicis
            </p>
          )}

          {expanded && withoutBikes.length > 0 && (
            <>
              <div className="border-t border-outline-variant/10 pt-1 mt-1">
                <p className="text-[9px] text-outline/50 mb-1">Sin bicis disponibles:</p>
              </div>
              {withoutBikes.map((s) => (
                <div key={s.id} className="flex items-center gap-2 opacity-60">
                  <span className="w-2 h-2 rounded-full shrink-0 bg-red-400/50" />
                  <span className="text-on-surface truncate flex-1 text-[11px]">{s.name}</span>
                  <span className="text-outline text-[10px] shrink-0">{s.distance}m</span>
                  <span className="text-[10px] font-mono text-red-400/70">0</span>
                </div>
              ))}
            </>
          )}
        </div>

        <p className="text-[9px] text-outline text-right">
          {stations.length} estaciones activas · en vivo
        </p>
      </div>
    </div>
  );
}
