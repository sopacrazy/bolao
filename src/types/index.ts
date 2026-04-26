
export interface Match {
  id: string;
  home: string;
  away: string;
  homeName: string;
  awayName: string;
  homeLogo: string;
  awayLogo: string;
  homeScore: string;
  awayScore: string;
  date: string;
  status: string;
  clock: string;
  league?: "bra.1" | "bra.3";
}

export interface RodadaData {
  matches: Match[];
  roundNumber: number | string;
}

export const LEAGUES = {
  "bra.1": { label: "Série A", short: "A", color: "#22C55E" },
  "bra.3": { label: "Série C", short: "C", color: "#F59E0B" },
};

export type League = keyof typeof LEAGUES;

export interface User {
  id: string;
  nome: string;
  apelido: string;
  pontos: number;
  jogos: number;
  is_admin: boolean;
  status: string;
}
