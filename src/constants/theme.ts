import { Crown, Medal, Award } from "lucide-react";

export const LEAGUES = {
  "bra.1": { label: "Série A", short: "A", color: "#22C55E" },
  "bra.3": { label: "Série C", short: "C", color: "#F59E0B" },
};

export type League = keyof typeof LEAGUES;

export const T = {
  bg: (d: boolean) => (d ? "#060B14" : "#F0F4F8"),
  surface: (d: boolean) =>
    d ? "rgba(13,21,37,0.95)" : "rgba(255,255,255,0.95)",
  elevated: (d: boolean) => (d ? "rgba(19,30,48,0.95)" : "rgba(248,250,252,1)"),
  border: (d: boolean) => (d ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.08)"),
  borderSoft: (d: boolean) =>
    d ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.05)",
  text: (d: boolean) => (d ? "#F1F5F9" : "#0F172A"),
  textMuted: (d: boolean) => (d ? "#64748B" : "#64748B"),
  headerBg: (d: boolean) =>
    d ? "rgba(6,11,20,0.85)" : "rgba(240,244,248,0.85)",
  navBg: (d: boolean) => (d ? "rgba(9,14,24,0.95)" : "rgba(255,255,255,0.97)"),
  inputBg: (d: boolean) => (d ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.04)"),
  inputBdr: (d: boolean) => (d ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.1)"),
  rankItem: (d: boolean) =>
    d ? "rgba(255,255,255,0.03)" : "rgba(255,255,255,0.8)",
  rankBdr: (d: boolean) => (d ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.06)"),
  avatarBg: (d: boolean) => "#FFFFFF",
  avatarText: (d: boolean) => (d ? "#94A3B8" : "#64748B"),
};

export const podiumCfg = [
  {
    icon: Crown,
    color: "#FBBF24",
    bg: "rgba(251,191,36,0.12)",
    border: "rgba(251,191,36,0.25)",
  },
  {
    icon: Medal,
    color: "#94A3B8",
    bg: "rgba(148,163,184,0.12)",
    border: "rgba(148,163,184,0.25)",
  },
  {
    icon: Award,
    color: "#CD7F32",
    bg: "rgba(205,127,50,0.12)",
    border: "rgba(205,127,50,0.25)",
  },
];
