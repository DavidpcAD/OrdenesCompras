// Inline SVG icons (no emoji — avoids bundler issues with astral characters)
import React from "react";

type P = { size?: number } & React.SVGProps<SVGSVGElement>;
const base = (size: number) => ({
  width: size, height: size, viewBox: "0 0 24 24", fill: "none",
  stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
});

export const IconWrench = ({ size = 22, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M14.7 6.3a4 4 0 0 0-5.4 5.2L4 16.8 7.2 20l5.3-5.3a4 4 0 0 0 5.2-5.4l-2.4 2.4-2.3-2.3 2.4-2.4z" /></svg>
);

export const IconBox = ({ size = 22, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M21 8 12 3 3 8v8l9 5 9-5V8z" /><path d="M3 8l9 5 9-5" /><path d="M12 13v8" /></svg>
);

export const IconReceipt = ({ size = 22, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M6 2h12v20l-2-1.5L14 22l-2-1.5L10 22l-2-1.5L6 22V2z" /><path d="M9 7h6M9 11h6M9 15h4" /></svg>
);

export const IconTrash = ({ size = 18, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /><path d="M10 11v6M14 11v6" /></svg>
);

export const IconWarning = ({ size = 20, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M12 3 2 20h20L12 3z" /><path d="M12 10v4M12 17h.01" /></svg>
);

export const IconClose = ({ size = 18, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M6 6l12 12M18 6 6 18" /></svg>
);

export const IconCheck = ({ size = 18, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M20 6 9 17l-5-5" /></svg>
);

export const IconEye = ({ size = 16, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M1.5 12S5 5 12 5s10.5 7 10.5 7-3.5 7-10.5 7S1.5 12 1.5 12z" /><circle cx="12" cy="12" r="3" /></svg>
);
