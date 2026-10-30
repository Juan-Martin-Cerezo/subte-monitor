// Reusable SVG icon set. All icons are 24x24, stroke-based, currentColor.
import type { FC, SVGProps } from "react";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "ref"> {
  size?: number;
}

const baseProps: Omit<SVGProps<SVGSVGElement>, "ref"> = {
  width: 24,
  height: 24,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round",
  strokeLinejoin: "round",
};

function withSize(props: IconProps) {
  const { size = 24, ...rest } = props;
  return { ...baseProps, ...rest, width: size, height: size };
}

function make(paths: React.ReactNode): FC<IconProps> {
  return function IconComponent(props: IconProps) {
    const p = withSize(props);
    return <svg {...p}>{paths}</svg>;
  };
}

export const Icon = {
  Subway: make(
    <path d="M5 17h14M5 17a2 2 0 0 1-2-2V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v8a2 2 0 0 1-2 2M5 17v3M19 17v3M9 9h6" />
  ),
  Map: make(<path d="M9 3 3 6v15l6-3 6 3 6-3V3l-6 3zM9 3v15M15 6v15" />),
  Route: make(
    <>
      <circle cx="6" cy="19" r="3" />
      <path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15" />
      <circle cx="18" cy="5" r="3" />
    </>
  ),
  Pin: make(
    <>
      <path d="M12 22s7-7.5 7-12a7 7 0 0 0-14 0c0 4.5 7 12 7 12z" />
      <circle cx="12" cy="10" r="2.5" />
    </>
  ),
  Alert: make(
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0zM12 9v4M12 17h.01" />
  ),
  Clock: make(
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  Search: make(
    <>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  Swap: make(<path d="M7 16V4M7 4 3 8M7 4l4 4M17 8v12M17 20l4-4M17 20l-4-4" />),
  Arrow: make(<path d="M5 12h14M13 5l7 7-7 7" />),
  Refresh: make(<path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5" />),
  Bell: make(<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />),
  Settings: make(
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9 1.65 1.65 0 0 0 4.27 7.18l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </>
  ),
  Menu: make(<path d="M3 6h18M3 12h18M3 18h18" />),
  X: make(<path d="M18 6 6 18M6 6l12 12" />),
  Accessibility: make(
    <>
      <circle cx="16" cy="4" r="1" />
      <path d="m18 19 1-7-6 1M5 8h3l2 9 2-9h3" />
    </>
  ),
  Transfer: make(<path d="M3 7h13l-3-3M21 17H8l3 3M3 12h18" />),
  Caret: make(<path d="m6 9 6 6 6-6" />),
  Plus: make(<path d="M12 5v14M5 12h14" />),
  Check: make(<path d="m20 6-11 11-5-5" />),
  Wifi: make(
    <path d="M5 12.55a11 11 0 0 1 14 0M1.42 9a16 16 0 0 1 21.16 0M8.53 16.11a6 6 0 0 1 6.95 0M12 20h.01" />
  ),
  Train: make(
    <path d="M9 3h6a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3H9a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3zM3 11h18M3 18h18M8 21l-1 2M16 21l1 2M7 7h10" />
  ),
  Eye: make(
    <>
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  Compass: make(
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="m16 8-4 4-4 4 8-2z" />
    </>
  ),
  Filter: make(<path d="M3 4h18l-7 9v6l-4 2v-8z" />),
  Heart: make(
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  ),
  Shield: make(<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />),
  Bus: make(
    <>
      <path d="M8 6v6M16 6v6M2 12h20M6 18h12M4 18v2M20 18v2M6 10h12a2 2 0 0 1 2 2v6H4v-6a2 2 0 0 1 2-2z" />
      <circle cx="7" cy="15" r="1" />
      <circle cx="17" cy="15" r="1" />
    </>
  ),
  Bike: make(
    <>
      <circle cx="5.5" cy="17.5" r="3.5" />
      <circle cx="18.5" cy="17.5" r="3.5" />
      <path d="M15 6a1 1 0 100-2 1 1 0 000 2zM9.5 17.5l3-7M12 7.5l-2.5 4h5M12 7.5l3 4" />
    </>
  ),
};

export type IconName = keyof typeof Icon;
