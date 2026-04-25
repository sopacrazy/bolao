import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Trophy,
  Target,
  Info,
  Share2,
  LogIn,
  AlertCircle,
  Crown,
  Medal,
  Award,
  Users,
  TrendingUp,
  ChevronRight,
  ChevronLeft,
  Star,
  Flame,
  Shield,
  Swords,
  Sun,
  Moon,
  LogOut,
  RefreshCw,
  Wifi,
  WifiOff,
  Send,
  X,
  List,
  Plus,
  ChevronDown,
  Trash2,
  AlertTriangle,
  Settings,
  LayoutDashboard,
  CheckCircle2,
  Clock,
  Gamepad2,
  Sparkles,
  Bot,
  Flag,
  Zap,
} from "lucide-react";
import { supabase } from "./lib/supabase";
import { domToPng } from "modern-screenshot";
import { SplashScreen } from "@capacitor/splash-screen";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Match {
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

interface RodadaData {
  matches: Match[];
  roundNumber: number | string;
}

// ─── ESPN API ─────────────────────────────────────────────────────────────────

const LEAGUES = {
  "bra.1": { label: "Série A", short: "A", color: "#22C55E" },
  "bra.3": { label: "Série C", short: "C", color: "#F59E0B" },
};

type League = keyof typeof LEAGUES;

const espnBase = (lg: League) =>
  `https://site.api.espn.com/apis/site/v2/sports/soccer/${lg}/scoreboard`;
const espnSummary = (lg: League) =>
  `https://site.api.espn.com/apis/site/v2/sports/soccer/${lg}/summary`;
const CACHE_KEY = "bolao_espn_v4";
const CACHE_TTL = 90 * 1000; // 90s

// Formata Date → "YYYYMMDD"
function ymd(d: Date) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

function parseMatches(events: any[]): Match[] {
  return events.map((ev) => {
    const comp = ev.competitions?.[0] ?? {};
    const comps = comp.competitors ?? [];
    const home =
      comps.find((c: any) => c.homeAway === "home") ?? comps[0] ?? {};
    const away =
      comps.find((c: any) => c.homeAway === "away") ?? comps[1] ?? {};
    return {
      id: ev.id,
      home: home.team?.abbreviation ?? "?",
      away: away.team?.abbreviation ?? "?",
      homeName: home.team?.shortDisplayName ?? home.team?.displayName ?? "?",
      awayName: away.team?.shortDisplayName ?? away.team?.displayName ?? "?",
      homeLogo: home.team?.logo ? `https://images.weserv.nl/?url=${encodeURIComponent(home.team.logo)}&w=100` : "",
      awayLogo: away.team?.logo ? `https://images.weserv.nl/?url=${encodeURIComponent(away.team.logo)}&w=100` : "",
      homeScore: home.score ?? "-",
      awayScore: away.score ?? "-",
      date: ev.date ?? "",
      status: ev.status?.type?.name ?? "STATUS_SCHEDULED",
      clock: ev.status?.displayClock ?? "",
    };
  });
}

// Extrai número da rodada de um único evento ESPN
function eventRound(ev: any): number | null {
  const notes: any[] = ev.competitions?.[0]?.notes ?? [];
  for (const n of notes) {
    const m = String(n.headline ?? n.value ?? "").match(/\d+/);
    if (m) return parseInt(m[0]);
  }
  const rn = ev.competitions?.[0]?.series?.roundNumber;
  if (rn) return Number(rn);
  return null;
}

// Dado um array de eventos ESPN, retorna somente os da próxima rodada ativa.
// Estratégia: agrupa por número de rodada do ESPN; se não disponível, agrupa
// por clusters de data (jogos num janela de 5 dias formam uma rodada).
// Se TODOS os jogos já finalizaram, aguarda 24h antes de liberar nova rodada.
// Para histórico (onlyFirst=false), retorna todos sem filtrar.
function filterNextRound(events: any[], onlyFirst: boolean): { events: any[]; roundNumber: number | string } {
  if (!events.length) return { events: [], roundNumber: "?" };

  if (!onlyFirst) {
    const rn = eventRound(events[0]) ?? "?";
    return { events, roundNumber: rn };
  }

  // ── Tentativa 1: agrupar por número de rodada ESPN ──
  const groups = new Map<number, any[]>();
  for (const ev of events) {
    const rn = eventRound(ev);
    if (rn !== null) {
      if (!groups.has(rn)) groups.set(rn, []);
      groups.get(rn)!.push(ev);
    }
  }

  // ── Tentativa 2 (fallback): agrupar por cluster de datas ──
  // Ordena por data e agrupa eventos que estão dentro de 5 dias do primeiro
  if (groups.size < 2) {
    const sorted = [...events].sort(
      (a, b) => new Date(a.date ?? 0).getTime() - new Date(b.date ?? 0).getTime(),
    );
    groups.clear();
    let groupId = 0;
    let windowStart = -Infinity;
    const WINDOW = 5 * 24 * 60 * 60 * 1000; // 5 dias
    for (const ev of sorted) {
      const t = new Date(ev.date ?? 0).getTime();
      if (t - windowStart > WINDOW) {
        groupId++;
        windowStart = t;
      }
      if (!groups.has(groupId)) groups.set(groupId, []);
      groups.get(groupId)!.push(ev);
    }
  }

  const sortedKeys = [...groups.keys()].sort((a, b) => a - b);

  // Encontra o primeiro grupo com ao menos 1 jogo não finalizado
  for (const key of sortedKeys) {
    const evs = groups.get(key)!;
    const allFinished = evs.every((ev) => {
      const st = ev.status?.type?.name ?? "";
      return st === "STATUS_FINAL" || st === "STATUS_CANCELED";
    });

    if (!allFinished) {
      const rn = eventRound(evs[0]) ?? key;
      return { events: evs, roundNumber: rn };
    }

    // Se todos terminados, verifica se o último terminou há menos de 24h
    const latestTs = Math.max(
      ...evs.map((ev) => new Date(ev.date ?? 0).getTime()),
    );
    const ONE_DAY = 24 * 60 * 60 * 1000;
    if (Date.now() - latestTs < ONE_DAY) {
      const rn = eventRound(evs[0]) ?? key;
      return { events: evs, roundNumber: rn };
    }
  }

  // Todos os grupos encerrados — regra de 24h antes de mostrar próxima rodada
  const lastKey = sortedKeys[sortedKeys.length - 1];
  const lastEvs = groups.get(lastKey)!;
  const latestTs = Math.max(...lastEvs.map((ev) => new Date(ev.date ?? 0).getTime()));
  const ONE_DAY = 24 * 60 * 60 * 1000;
  if (Date.now() - latestTs < ONE_DAY) {
    // Dentro da janela de espera: continua mostrando a rodada encerrada
    const rn = eventRound(lastEvs[0]) ?? lastKey;
    return { events: lastEvs, roundNumber: rn };
  }

  // Passou 1 dia: exibe vazio (admin libera nova rodada)
  return { events: [], roundNumber: "?" };
}

async function espnDateRange(
  start: Date,
  end: Date,
  lg: League = "bra.1",
  onlyNextRound = false,
): Promise<RodadaData> {
  const res = await fetch(`${espnBase(lg)}?dates=${ymd(start)}-${ymd(end)}`);
  if (!res.ok) throw new Error();
  const json = await res.json();
  const { events, roundNumber } = filterNextRound(json.events ?? [], onlyNextRound);
  return { matches: parseMatches(events), roundNumber };
}

function isLive(status: string) {
  return (
    status === "STATUS_IN_PROGRESS" ||
    status === "STATUS_FIRST_HALF" ||
    status === "STATUS_SECOND_HALF" ||
    status === "STATUS_HALFTIME" ||
    status === "STATUS_EXTRA_TIME" ||
    status === "STATUS_OVERTIME"
  );
}

function todayMidnight() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// anchorTs: timestamp do "centro" da janela de busca
function useRodada(anchorTs: number, league: League = "bra.1") {
  const [data, setData] = useState<RodadaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = async (force = false, silent = false) => {
    if (!silent) setLoading(true);
    setError(false);
    const cacheKey = `${CACHE_KEY}_${league}_${anchorTs}`;

    if (!force) {
      try {
        const raw = localStorage.getItem(cacheKey);
        if (raw) {
          const { payload, ts } = JSON.parse(raw);
          const now = Date.now();
          const needsFastPoll = (payload as RodadaData)?.matches?.some(
            (m: Match) =>
              isLive(m.status) ||
              (m.status === "STATUS_SCHEDULED" && new Date(m.date).getTime() < now)
          );
          if (now - ts < (needsFastPoll ? CACHE_TTL : 30 * 60 * 1000)) {
            setData(payload);
            setLoading(false);
            return;
          }
        }
      } catch {}
    }

    try {
      const anchor = new Date(anchorTs);
      const isCurrent = anchorTs >= todayMidnight() - 86400000;
      let result: RodadaData;

      if (isCurrent) {
        // Endpoint ao vivo primeiro — sempre tem placares atualizados
        const res = await fetch(espnBase(league));
        const json = await res.json();
        const { events, roundNumber } = filterNextRound(json.events ?? [], true);
        result = { matches: parseMatches(events), roundNumber };

        // Fallback ao range de datas (para rodadas futuras ainda não no scoreboard ao vivo)
        if (result.matches.length === 0) {
          const future = new Date(anchor.getTime() + 30 * 86400000);
          result = await espnDateRange(anchor, future, league, true);
        }
      } else {
        // Histórico: janela de 8 dias centrada no anchor
        const start = new Date(anchor.getTime() - 3 * 86400000);
        const end = new Date(anchor.getTime() + 5 * 86400000);
        result = await espnDateRange(start, end, league);
      }

      localStorage.setItem(
        cacheKey,
        JSON.stringify({ payload: result, ts: Date.now() }),
      );
      setData(result);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [anchorTs, league]);

  // Auto-poll enquanto houver jogo ao vivo ou já iniciado mas ainda como agendado no cache
  useEffect(() => {
    const now = Date.now();
    const needsPoll = data?.matches.some(
      (m) =>
        isLive(m.status) ||
        (m.status === "STATUS_SCHEDULED" && new Date(m.date).getTime() < now)
    );
    if (!needsPoll) return;
    const id = setInterval(() => load(true), CACHE_TTL);
    return () => clearInterval(id);
  }, [data]);

  return { data, loading, error, refetch: () => load(true), silentRefetch: () => load(true, true) };
}

// ─── TheSportsDB — Série C ───────────────────────────────────────────────────

const TSDB_BASE = "https://www.thesportsdb.com/api/v1/json/123";
const TSDB_LEAGUE = "4625";
const TSDB_CACHE = "bolao_seriesc_v2";
const TSDB_FINISHED_CACHE = "bolao_seriesc_finished_v1";
const TSDB_TTL = 30 * 60 * 1000; // 30 min (idle)
const TSDB_TTL_LIVE = 90 * 1000;  // 90s when any game is live
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const TSDB_STATUS: Record<string, string> = {
  NS: "STATUS_SCHEDULED",
  "1H": "STATUS_IN_PROGRESS",
  HT: "STATUS_HALFTIME",
  "2H": "STATUS_IN_PROGRESS",
  ET: "STATUS_IN_PROGRESS",
  FT: "STATUS_FINAL",
  AET: "STATUS_FINAL",
  PEN: "STATUS_FINAL",
  CANC: "STATUS_CANCELED",
  PPD: "STATUS_POSTPONED",
};

function parseTsdbEvents(events: any[]): Match[] {
  return events.map((ev: any) => {
    const dateStr =
      ev.dateEvent && ev.strTime
        ? `${ev.dateEvent}T${ev.strTime}Z`
        : (ev.dateEvent ?? "");
    const homeScore = ev.intHomeScore != null ? String(ev.intHomeScore) : "-";
    const awayScore = ev.intAwayScore != null ? String(ev.intAwayScore) : "-";
    const rawStatus = TSDB_STATUS[ev.strStatus ?? "NS"] ?? "STATUS_SCHEDULED";
    // TSDB frequentemente não atualiza o status — se passou 2h30 do início e ainda mostra
    // ao vivo OU agendado, força encerrado
    const startMs = dateStr ? new Date(dateStr).getTime() : 0;
    const isOverdue = startMs > 0 && Date.now() - startMs > 150 * 60 * 1000;
    const status =
      isOverdue && (isLive(rawStatus) || rawStatus === "STATUS_SCHEDULED")
        ? "STATUS_FINAL"
        : rawStatus;
    return {
      id: String(ev.idEvent),
      home: (ev.strHomeTeam ?? "?").substring(0, 3).toUpperCase(),
      away: (ev.strAwayTeam ?? "?").substring(0, 3).toUpperCase(),
      homeName: ev.strHomeTeam ?? "?",
      awayName: ev.strAwayTeam ?? "?",
      homeLogo: (ev.strHomeTeamBadge ?? ev.strTeamHomeBadge) ? `https://images.weserv.nl/?url=${encodeURIComponent(ev.strHomeTeamBadge ?? ev.strTeamHomeBadge)}&w=100` : "",
      awayLogo: (ev.strAwayTeamBadge ?? ev.strTeamAwayBadge) ? `https://images.weserv.nl/?url=${encodeURIComponent(ev.strAwayTeamBadge ?? ev.strTeamAwayBadge)}&w=100` : "",
      homeScore,
      awayScore,
      date: dateStr,
      status,
      clock: ev.strProgress ?? "",
    };
  });
}

function useSerieCRodada(showPast: boolean) {
  const [data, setData] = useState<RodadaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = async (force = false, silent = false) => {
    if (!silent) setLoading(true);
    setError(false);
    const cacheKey = `${TSDB_CACHE}_${showPast ? "past" : "next"}_v2`;

    if (!force) {
      try {
        const raw = localStorage.getItem(cacheKey);
        if (raw) {
          const { payload, ts } = JSON.parse(raw);
          const _now = Date.now();
          const hasLive = (payload as RodadaData)?.matches?.some(
            (m: Match) =>
              isLive(m.status) ||
              (m.status === "STATUS_SCHEDULED" && new Date(m.date).getTime() < _now)
          );
          const ttl = hasLive ? TSDB_TTL_LIVE : TSDB_TTL;
          if (_now - ts < ttl) {
            setData(payload);
            setLoading(false);
            return;
          }
        }
      } catch {}
    }

    try {
      const endpoint = showPast ? "eventspastleague" : "eventsnextleague";
      const res = await fetch(`${TSDB_BASE}/${endpoint}.php?id=${TSDB_LEAGUE}`);
      if (!res.ok) throw new Error();
      const json = await res.json();
      const peekEvents: any[] = json.events ?? [];
      if (!peekEvents.length) {
        setData({ matches: [], roundNumber: "?" });
        setLoading(false);
        return;
      }

      // eventsnextleague returns only 5 events across multiple rounds.
      // Fetch the full round using eventsround.php once we know the round #.
      const roundNumber: string | number = peekEvents[0]?.intRound ?? "?";
      const season = new Date().getFullYear();
      const roundRes = await fetch(
        `${TSDB_BASE}/eventsround.php?id=${TSDB_LEAGUE}&r=${roundNumber}&s=${season}`,
      );
      let allEvents = peekEvents;
      if (roundRes.ok) {
        const roundJson = await roundRes.json();
        if (roundJson.events?.length) allEvents = roundJson.events;
      }

      let matches = parseTsdbEvents(allEvents);

      // Se há jogos sem placar que já deveriam ter encerrado, tenta recuperar via eventspastleague
      const hasMissingScores = matches.some(
        m => m.status === "STATUS_FINAL" && m.homeScore === "-"
      );
      if (hasMissingScores) {
        try {
          const pastRes = await fetch(`${TSDB_BASE}/eventspastleague.php?id=${TSDB_LEAGUE}`);
          if (pastRes.ok) {
            const pastJson = await pastRes.json();
            const pastMatches = parseTsdbEvents(pastJson.events ?? []);
            matches = matches.map(m => {
              if (m.homeScore !== "-") return m;
              const past = pastMatches.find(p => p.id === m.id);
              if (past && past.homeScore !== "-") return { ...m, homeScore: past.homeScore, awayScore: past.awayScore, status: "STATUS_FINAL" };
              return m;
            });
          }
        } catch {}
      }

      const result: RodadaData = { matches, roundNumber };

      // Se todos os jogos encerraram, salva como "rodada finalizada" para exibir por 24h
      const allDone = matches.length > 0 && matches.every(m => m.status === "STATUS_FINAL");
      if (allDone) {
        const latestTs = Math.max(...matches.map(m => new Date(m.date).getTime()));
        localStorage.setItem(TSDB_FINISHED_CACHE, JSON.stringify({ payload: result, latestMatchTs: latestTs }));
      }

      // Se o TSDB avançou para a próxima rodada mas a anterior terminou < 24h, continua mostrando a anterior
      try {
        const finRaw = localStorage.getItem(TSDB_FINISHED_CACHE);
        if (finRaw) {
          const { payload: finPayload, latestMatchTs } = JSON.parse(finRaw);
          const sameRound = String(finPayload.roundNumber) === String(roundNumber);
          if (!sameRound && Date.now() - latestMatchTs < ONE_DAY_MS) {
            localStorage.setItem(cacheKey, JSON.stringify({ payload: finPayload, ts: Date.now() }));
            setData(finPayload);
            setLoading(false);
            return;
          }
        }
      } catch {}

      localStorage.setItem(
        cacheKey,
        JSON.stringify({ payload: result, ts: Date.now() }),
      );
      setData(result);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [showPast]);

  // Auto-poll enquanto houver jogo ao vivo ou já iniciado da Série C
  useEffect(() => {
    const now = Date.now();
    const needsPoll = data?.matches.some(
      (m) =>
        isLive(m.status) ||
        (m.status === "STATUS_SCHEDULED" && new Date(m.date).getTime() < now)
    );
    if (!needsPoll) return;
    const id = setInterval(() => load(true), TSDB_TTL_LIVE);
    return () => clearInterval(id);
  }, [data]);

  return { data, loading, error, refetch: () => load(true), silentRefetch: () => load(true, true) };
}

// ─── Static ranking + finance (unchanged) ────────────────────────────────────

const mockRanking = Array.from({ length: 59 }, (_, i) => ({
  id: i + 1,
  name: `Participante ${i + 1}`,
  points: Math.floor(Math.random() * 200) + 50,
}))
  .sort((a, b) => b.points - a.points)
  .map((p, i) => ({ ...p, position: i + 1 }));
mockRanking[0].name = "Marcos";

const finance = { participants: 0, ticketPrice: 0 };
const gross = finance.participants * finance.ticketPrice;
const expenses = { work: gross * 0.15, commission: gross * 0.1 };
const net = gross - expenses.work - expenses.commission;
const prizes = { first: net * 0.7, second: net * 0.3 };
const fmt = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

// ─── Theme helpers ────────────────────────────────────────────────────────────

const T = {
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

// ─── Status badge helper ──────────────────────────────────────────────────────

function StatusBadge({
  status,
  clock,
  closed,
}: {
  status: string;
  clock: string;
  closed?: boolean;
}) {
  if (isLive(status)) {
    return (
      <div
        className="flex items-center gap-1.5 px-2 py-0.5 rounded-full"
        style={{
          background: "rgba(34,197,94,0.1)",
          border: "1px solid rgba(34,197,94,0.25)",
        }}
      >
        <motion.div
          className="w-1.5 h-1.5 rounded-full bg-emerald-400"
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 1.2, repeat: Infinity }}
        />
        <span className="text-[10px] font-bold text-emerald-400">
          {status === "STATUS_HALFTIME" ? "Intervalo" : clock || "Ao Vivo"}
        </span>
      </div>
    );
  }
  if (status === "STATUS_FINAL" || closed) {
    return (
      <span
        className="text-[10px] font-bold px-2 py-0.5 rounded-full"
        style={{
          background: "rgba(34,197,94,0.1)",
          color: "#22C55E",
          border: "1px solid rgba(34,197,94,0.2)",
        }}
      >
        Concluído
      </span>
    );
  }
  return (
    <span
      className="text-[10px] font-bold px-2 py-0.5 rounded-full"
      style={{
        background: "rgba(251,191,36,0.1)",
        color: "#FBBF24",
        border: "1px solid rgba(251,191,36,0.2)",
      }}
    >
      Agendado
    </span>
  );
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

type BetResult = { pts: number; label: string; color: string; bg: string };

function calcScorePoints(
  bet: { home: string; away: string },
  match: Match,
): BetResult {
  const nothing: BetResult = { pts: 0, label: "", color: "", bg: "" };
  if (match.status !== "STATUS_FINAL" || match.homeScore === "-")
    return nothing;
  const bh = parseInt(bet.home),
    ba = parseInt(bet.away);
  const ah = parseInt(match.homeScore),
    aa = parseInt(match.awayScore);
  if (isNaN(bh) || isNaN(ba) || isNaN(ah) || isNaN(aa)) return nothing;
  if (bh === ah && ba === aa)
    return {
      pts: 25,
      label: "Placar exato",
      color: "#22C55E",
      bg: "rgba(34,197,94,0.08)",
    };
  return { pts: 0, label: "Placar errado", color: "#F87171", bg: "" };
}

// Resultado é derivado automaticamente do placar palpitado
function calcResultPoints(
  bet: { home: string; away: string },
  match: Match,
): BetResult {
  const nothing: BetResult = { pts: 0, label: "", color: "", bg: "" };
  if (match.status !== "STATUS_FINAL" || match.homeScore === "-")
    return nothing;
  const bh = parseInt(bet.home),
    ba = parseInt(bet.away);
  const ah = parseInt(match.homeScore),
    aa = parseInt(match.awayScore);
  if (isNaN(bh) || isNaN(ba) || isNaN(ah) || isNaN(aa)) return nothing;
  const betRes: "H" | "D" | "A" = bh > ba ? "H" : bh < ba ? "A" : "D";
  const actRes: "H" | "D" | "A" = ah > aa ? "H" : ah < aa ? "A" : "D";
  if (betRes === actRes)
    return {
      pts: 10,
      label: "Resultado certo",
      color: "#F59E0B",
      bg: "rgba(245,158,11,0.08)",
    };
  return { pts: 0, label: "Resultado errado", color: "#F87171", bg: "" };
}

// Mutually exclusive: exact score (25pts) OR correct result (10pts), never both
function calcPoints(
  bet: { home: string; away: string },
  match: Match,
): BetResult {
  const sR = calcScorePoints(bet, match);
  if (sR.pts > 0) return sR;
  return calcResultPoints(bet, match);
}

// ─── Match date formatter ─────────────────────────────────────────────────────

function fmtDate(iso: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return (
    d.toLocaleDateString("pt-BR", {
      weekday: "short",
      day: "2-digit",
      month: "short",
    }) +
    " • " +
    d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
  );
}

function TeamLogo({
  src,
  abbr,
  isDark,
}: {
  src: string;
  abbr: string;
  isDark: boolean;
}) {
  const [err, setErr] = useState(false);
  return (
    <div
      className="w-12 h-12 rounded-2xl flex items-center justify-center font-black text-sm overflow-hidden"
      style={{
        background: T.avatarBg(isDark),
        border: `1px solid ${T.border(isDark)}`,
        color: T.text(isDark),
      }}
    >
      {src && !err ? (
        <img
          src={src}
          alt={abbr}
          className="w-8 h-8 object-contain"
          crossOrigin="anonymous"
          onError={() => setErr(true)}
        />
      ) : (
        abbr
      )}
    </div>
  );
}

// ─── Standings ────────────────────────────────────────────────────────────────

interface StandingEntry {
  pos: number;
  teamAbbr: string;
  teamName: string;
  teamLogo: string;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  gf: number;
  ga: number;
  gd: number;
  points: number;
}

const STANDINGS_CACHE_KEY = "bolao_standings_v4";
const STANDINGS_TTL = 30 * 60 * 1000;

function useStandings() {
  const [data, setData] = useState<StandingEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    setData(null);
    setError(false);
    setLoading(true);
    
    const league = "bra.1";
    const cacheKey = `${STANDINGS_CACHE_KEY}_${league}`;
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        const { payload, ts } = JSON.parse(raw);
        if (Date.now() - ts < STANDINGS_TTL) {
          setData(payload);
          setLoading(false);
          return;
        }
      }
    } catch {}

    const tryFetch = (url: string) =>
      fetch(url).then((r) => {
        if (!r.ok) throw new Error(r.status.toString());
        return r.json();
      });
    
    const yr = new Date().getFullYear();
    const urls = [
      `https://site.api.espn.com/apis/v2/sports/soccer/${league}/standings?season=${yr}&seasontype=2`,
      `https://site.api.espn.com/apis/v2/sports/soccer/${league}/standings?season=${yr - 1}&seasontype=2`,
      `https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/standings`,
    ];

    (async () => {
      let success = false;
      for (const url of urls) {
        try {
          const json = await tryFetch(url);
          let rawEntries: any[] = [];
          
          const collectEntries = (o: any, d = 0) => {
            if (!o || d > 6) return;
            if (Array.isArray(o.entries) && o.entries.length > 0) {
              rawEntries.push(...o.entries);
            }
            if (o.children && Array.isArray(o.children)) {
              o.children.forEach((c: any) => collectEntries(c, d + 1));
            }
            if (o.standings && typeof o.standings === "object") {
              collectEntries(o.standings, d + 1);
            }
          };
          
          collectEntries(json);

          if (rawEntries.length > 0) {
            const getStat = (stats: any[], ...names: string[]) => {
              for (const name of names) {
                const s = stats.find(
                  (x: any) => x.name === name || x.abbreviation === name,
                );
                if (s != null) return parseFloat(s.value) || 0;
              }
              return 0;
            };

            const parsed: StandingEntry[] = rawEntries
              .map((e: any) => {
                const stats: any[] = e.stats ?? [];
                const rawLogo = e.team?.logos?.[0]?.href ?? e.team?.logo ?? "";
                const logo = rawLogo ? `https://images.weserv.nl/?url=${encodeURIComponent(rawLogo)}&w=100` : "";
                return {
                  pos: 0,
                  teamAbbr: e.team?.abbreviation ?? "?",
                  teamName: e.team?.shortDisplayName ?? e.team?.displayName ?? "?",
                  teamLogo: logo,
                  played: getStat(stats, "gamesPlayed", "GP", "P"),
                  wins: getStat(stats, "wins", "W"),
                  draws: getStat(stats, "ties", "draws", "D"),
                  losses: getStat(stats, "losses", "L"),
                  gf: getStat(stats, "pointsFor", "GF", "goalsFor"),
                  ga: getStat(stats, "pointsAgainst", "GA", "goalsAgainst"),
                  gd: getStat(stats, "pointDifferential", "GD", "goalDifferential"),
                  points: getStat(stats, "points", "PTS", "pts"),
                };
              })
              .filter((v, i, a) => a.findIndex(t => t.teamAbbr === v.teamAbbr) === i)
              .sort((a, b) => {
                if (b.points !== a.points) return b.points - a.points;
                if (b.wins !== a.wins) return b.wins - a.wins;
                if (b.gd !== a.gd) return b.gd - a.gd;
                return b.gf - a.gf;
              })
              .map((item, idx) => ({ ...item, pos: idx + 1 }));

            if (parsed.length > 0) {
              localStorage.setItem(cacheKey, JSON.stringify({ payload: parsed, ts: Date.now() }));
              setData(parsed);
              success = true;
              break; 
            }
          }
        } catch (e) {
          continue;
        }
      }
      if (!success) setError(true);
      setLoading(false);
    })();
  }, []);

  return { data, loading, error };
}

function StandingsModal({
  isDark,
  onClose,
}: {
  isDark: boolean;
  onClose: () => void;
}) {
  const d = isDark;
  const { data, loading, error } = useStandings();

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[100] flex flex-col justify-end"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <div
          className="absolute inset-0 bg-black/50 backdrop-blur-sm"
          onClick={onClose}
        />

        <motion.div
          className="relative z-10 rounded-t-3xl overflow-hidden flex flex-col w-full max-w-lg mx-auto"
          style={{ background: T.bg(d), maxHeight: "92dvh" }}
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 30, stiffness: 320 }}
        >
          <div className="flex justify-center pt-3 pb-1 shrink-0">
            <div
              className="w-10 h-1 rounded-full"
              style={{ background: T.border(d) }}
            />
          </div>

          <div
            className="px-5 pt-2 pb-4 shrink-0"
            style={{ borderBottom: `1px solid ${T.border(d)}` }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1.5">
                <Trophy size={14} className="text-amber-400" />
                <p
                  className="text-xs font-bold uppercase tracking-wider"
                  style={{ color: T.textMuted(d) }}
                >
                  Classificação Série A
                </p>
              </div>
              <button
                onClick={onClose}
                className="w-7 h-7 rounded-full flex items-center justify-center"
                style={{
                  background: T.surface(d),
                  border: `1px solid ${T.border(d)}`,
                }}
              >
                <X size={13} style={{ color: T.textMuted(d) }} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-4 py-4 min-h-[300px]">
            {loading && !data && (
              <div className="flex flex-col items-center justify-center py-24 gap-3">
                <motion.div
                  className="w-9 h-9 rounded-full border-2 border-amber-400/20 border-t-amber-400"
                  animate={{ rotate: 360 }}
                  transition={{
                    duration: 0.8,
                    repeat: Infinity,
                    ease: "linear",
                  }}
                />
                <p className="text-xs" style={{ color: T.textMuted(d) }}>
                  Buscando classificação...
                </p>
              </div>
            )}

            {error && !data && (
              <div className="text-center py-24 space-y-3">
                <div className="w-16 h-16 rounded-full bg-slate-500/5 flex items-center justify-center mx-auto">
                  <WifiOff size={32} className="text-slate-400" />
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-bold" style={{ color: T.text(d) }}>
                    Classificação indisponível
                  </p>
                  <p className="text-xs px-8" style={{ color: T.textMuted(d) }}>
                    Não conseguimos carregar os dados da Série A no momento.
                  </p>
                </div>
                <button 
                  onClick={() => window.location.reload()}
                  className="mt-4 px-6 py-2 rounded-xl text-xs font-bold bg-amber-400 text-slate-900"
                >
                  Tentar novamente
                </button>
              </div>
            )}

            {data && data.length > 0 && (
              <div>
                <div
                  className="flex items-center px-2 pb-2 text-[9px] font-bold uppercase tracking-wider"
                  style={{ color: T.textMuted(d) }}
                >
                  <span className="w-6 shrink-0">#</span>
                  <span className="flex-1">Clube</span>
                  <span className="w-6 text-center shrink-0">J</span>
                  <span className="w-6 text-center shrink-0">V</span>
                  <span className="w-6 text-center shrink-0">E</span>
                  <span className="w-6 text-center shrink-0">D</span>
                  <span className="w-8 text-center shrink-0">SG</span>
                  <span className="w-8 text-right shrink-0 font-black text-[10px]">
                    Pts
                  </span>
                </div>

                <div className="space-y-1">
                  {data.map((entry, i) => {
                    const isLibertadores = entry.pos <= 4;
                    const isSulAmericana = entry.pos >= 5 && entry.pos <= 6;
                    const isRelegation = entry.pos >= data.length - 3;
                    
                    const rowBg = isLibertadores
                      ? d ? "rgba(34,197,94,0.06)" : "rgba(34,197,94,0.05)"
                      : isRelegation
                        ? d ? "rgba(248,113,113,0.06)" : "rgba(248,113,113,0.05)"
                        : T.rankItem(d);

                    const posColor = isLibertadores
                      ? "#22C55E"
                      : isSulAmericana
                        ? "#6366F1"
                        : isRelegation
                          ? "#F87171"
                          : T.textMuted(d);

                    return (
                      <motion.div
                        key={`bra.1_${entry.teamAbbr}`}
                        initial={{ opacity: 0, x: -8 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.02 }}
                        className="flex items-center px-2 py-2 rounded-xl"
                        style={{
                          background: rowBg,
                          border: `1px solid ${T.rankBdr(d)}`,
                        }}
                      >
                        <div
                          className="w-1 self-stretch rounded-full mr-2 shrink-0"
                          style={{
                            background: posColor === T.textMuted(d) ? "transparent" : posColor,
                          }}
                        />

                        <span
                          className="w-5 text-xs font-black shrink-0"
                          style={{ color: posColor }}
                        >
                          {entry.pos}
                        </span>

                        <div className="flex-1 flex items-center gap-1.5 min-w-0">
                          {entry.teamLogo ? (
                            <img
                              src={entry.teamLogo}
                              alt={entry.teamAbbr}
                              className="w-5 h-5 object-contain shrink-0"
                            />
                          ) : (
                            <div
                              className="w-5 h-5 rounded flex items-center justify-center text-[8px] font-black shrink-0"
                              style={{
                                background: T.avatarBg(d),
                                color: T.text(d),
                              }}
                            >
                              {entry.teamAbbr.substring(0, 2)}
                            </div>
                          )}
                          <span
                            className="text-xs font-semibold truncate"
                            style={{ color: T.text(d) }}
                          >
                            {entry.teamName}
                          </span>
                        </div>

                        <span className="w-6 text-center text-[11px]" style={{ color: T.textMuted(d) }}>{entry.played}</span>
                        <span className="w-6 text-center text-[11px] font-bold" style={{ color: T.text(d) }}>{entry.wins}</span>
                        <span className="w-6 text-center text-[11px]" style={{ color: T.textMuted(d) }}>{entry.draws}</span>
                        <span className="w-6 text-center text-[11px]" style={{ color: T.textMuted(d) }}>{entry.losses}</span>
                        <span className="w-8 text-center text-[11px] font-bold" style={{ color: entry.gd > 0 ? "#22C55E" : entry.gd < 0 ? "#F87171" : T.textMuted(d) }}>
                          {entry.gd > 0 ? "+" : ""}{entry.gd}
                        </span>
                        <span className="w-8 text-right text-sm font-black" style={{ color: T.text(d) }}>{entry.points}</span>
                      </motion.div>
                    );
                  })}
                </div>

                {/* Legend */}
                <div className="flex flex-wrap gap-x-4 gap-y-1.5 pt-4 pb-2">
                  {[
                    { color: "#22C55E", label: "Libertadores (1–4)" },
                    { color: "#6366F1", label: "Sul-Americana (5–6)" },
                    { color: "#F87171", label: "Rebaixamento (17–20)" },
                  ].map(({ color, label }) => (
                    <div key={label} className="flex items-center gap-1.5">
                      <div
                        className="w-2 h-2 rounded-full"
                        style={{ background: color }}
                      />
                      <span
                        className="text-[10px]"
                        style={{ color: T.textMuted(d) }}
                      >
                        {label}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

const analysisCache: Record<string, any> = {};

function AIAnalysisModal({
  match,
  onClose,
  isDark,
}: {
  match: Match;
  onClose: () => void;
  isDark: boolean;
}) {
  const [data, setData] = useState<any | null>(analysisCache[match.id] || null);
  const [loading, setLoading] = useState(!analysisCache[match.id]);
  const d = isDark;

  useEffect(() => {
    async function getAnalysis() {
      if (analysisCache[match.id]) {
        setData(analysisCache[match.id]);
        setLoading(false);
        return;
      }

      if (!process.env.OPENAI_API_KEY) {
        setData({ error: "Chave da OpenAI não configurada." });
        setLoading(false);
        return;
      }

      setLoading(true);
      setData(null); // Limpa para evitar mostrar a análise anterior
      try {
        // 1. Pegar classificação via ESPN para dar contexto real à IA
        let standingsInfo = "";
        try {
          const res = await fetch("https://site.api.espn.com/apis/v2/sports/soccer/bra.1/standings");
          const standingsData = await res.json();
          const list = standingsData.children[0].standings.entries;
          const homePos = list.find((e: any) => e.team.displayName.includes(match.homeName))?.stats.find((s: any) => s.name === "rank")?.value;
          const awayPos = list.find((e: any) => e.team.displayName.includes(match.awayName))?.stats.find((s: any) => s.name === "rank")?.value;
          if (homePos && awayPos) {
            standingsInfo = `Classificação Atual: ${match.homeName} (${homePos}º) vs ${match.awayName} (${awayPos}º)`;
          }
        } catch (e) { /* ignore */ }

        const prompt = `Você é o Analista Pro do Bolão dos Clássicos, a inteligência mais avançada em estatísticas de futebol brasileiro. Forneça uma análise técnica e profunda para o confronto: ${match.homeName} vs ${match.awayName}.

CONTEXTO:
- ${standingsInfo || "Considere a força histórica e o momento atual das equipes no Brasileirão/Série C."}
- Analise taticamente o estilo de jogo das equipes em 2024/2025.

REGRAS DE OURO:
1. NÃO use probabilidades genéricas. Se houver favoritismo, a porcentagem deve ser alta (ex: 60-80%).
2. Seja preciso no mercado de gols e escanteios baseado na agressividade tática das equipes.
3. Varie os placares exatos (não use sempre 2x1). Use 1x0, 0x0, 3x1, 2x2, etc.
4. Dica de Ouro: Forneça um padrão real ou curiosidade histórica única deste confronto.

Sua resposta deve ser APENAS o JSON puro:
{
  "resumo": "Uma resenha ácida e técnica de alto nível (max 140 chars)",
  "probabilidades": {"casa": VALOR_INT, "empate": VALOR_INT, "fora": VALOR_INT},
  "gols": {"over15": VALOR_INT, "over25": VALOR_INT, "ambosMarcam": "Sim/Não"},
  "escanteios": {"probabilidade": VALOR_INT, "label": "+8.5 ou +9.5 ou +10.5"},
  "palpite": "PLACAR_EXATO",
  "dica": "CURIOSIDADE OU PADRÃO HISTÓRICO ÚNICO (Frase impactante)"
}
Soma das probabilidades = 100.`;

        const response = await fetch(
          "https://api.openai.com/v1/chat/completions",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
            },
            body: JSON.stringify({
              model: "gpt-4o",
              messages: [{ role: "user", content: prompt }],
              temperature: 0.7,
            }),
          },
        );

        if (!response.ok) throw new Error("API Error");
        const resData = await response.json();
        const content = resData.choices[0].message.content.replace(/```json|```/g, "").trim();
        const parsed = JSON.parse(content);
        analysisCache[match.id] = parsed;
        setData(parsed);
      } catch (err) {
        console.error(err);
        setData({ error: "Erro ao gerar análise técnica." });
      } finally {
        setLoading(false);
      }
    }
    getAnalysis();
  }, [match.id]);

  const StatBar = ({ label, value, color }: any) => (
    <div className="space-y-1.5">
      <div className="flex justify-between text-[10px] font-black uppercase tracking-wider opacity-60">
        <span>{label}</span>
        <span>{value}%</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-white/5 overflow-hidden">
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${value}%` }}
          className="h-full rounded-full"
          style={{ background: color }}
        />
      </div>
    </div>
  );

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[200] flex flex-col justify-end"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
      >
        <div
          className="absolute inset-0 bg-slate-950/70 backdrop-blur-md"
          onClick={onClose}
        />
        <motion.div
          className="relative z-10 w-full max-w-lg mx-auto rounded-t-[2.5rem] overflow-hidden flex flex-col"
          style={{ background: T.bg(d), maxHeight: "90dvh" }}
          initial={{ y: "100%" }}
          animate={{ y: 0 }}
          exit={{ y: "100%" }}
          transition={{ type: "spring", damping: 32, stiffness: 350 }}
        >
          <div className="p-1.5 flex justify-center shrink-0">
             <div className="w-10 h-1.5 rounded-full mt-2" style={{ background: T.border(d) }} />
          </div>

          <div className="p-6 pb-2 shrink-0">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-4">
                <div className="flex -space-x-4 shrink-0">
                   <img src={match.homeLogo} className="w-14 h-14 object-contain relative z-10 bg-white rounded-full p-2 border-2 border-white shadow-md" alt="" />
                   <img src={match.awayLogo} className="w-14 h-14 object-contain relative z-0 bg-white rounded-full p-2 border-2 border-white shadow-md" alt="" />
                </div>
                <h3 className="font-black text-xl tracking-tight" style={{ color: T.text(d) }}>Analista Pro</h3>
              </div>
              <button
                onClick={onClose}
                className="w-10 h-10 rounded-2xl flex items-center justify-center"
                style={{ background: T.surface(d), border: `1px solid ${T.border(d)}` }}
              >
                <X size={20} style={{ color: T.text(d) }} />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto px-6 pb-8 space-y-6 custom-scrollbar">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-24 gap-6">
                <div className="relative">
                  <motion.div
                    className="w-20 h-20 rounded-full border-[3px] border-amber-400/10 border-t-amber-400"
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  />
                  <Bot size={32} className="absolute inset-0 m-auto text-amber-400 animate-pulse" />
                </div>
                <p className="text-sm font-black animate-pulse" style={{ color: T.text(d) }}>Cruzando Big Data...</p>
              </div>
            ) : data?.error ? (
               <div className="text-center py-20 space-y-4">
                 <AlertCircle size={40} className="mx-auto text-red-400 opacity-20" />
                 <p className="text-sm font-bold opacity-60" style={{ color: T.text(d) }}>{data.error}</p>
               </div>
            ) : (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-700">
                
                {/* Resumo */}
                <div className="p-4 rounded-2xl border bg-white/5" style={{ borderColor: T.border(d) }}>
                  <p className="text-sm font-semibold italic leading-relaxed" style={{ color: T.text(d) }}>
                    "{data.resumo}"
                  </p>
                </div>

                {/* Probabilidades de Vitória */}
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <TrendingUp size={14} className="text-amber-400" />
                    <h4 className="text-[10px] font-black uppercase tracking-widest opacity-40" style={{ color: T.text(d) }}>Chance de Vitória</h4>
                  </div>
                  <div className="grid grid-cols-1 gap-4">
                    <StatBar label={`Vitória ${match.homeName}`} value={data.probabilidades.casa} color="#FBBF24" />
                    <StatBar label="Empate" value={data.probabilidades.empate} color="#94A3B8" />
                    <StatBar label={`Vitória ${match.awayName}`} value={data.probabilidades.fora} color="#F59E0B" />
                  </div>
                </div>

                {/* Grid Gols e Escanteios */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-4 rounded-2xl border space-y-3" style={{ borderColor: T.border(d), background: T.surface(d) }}>
                    <div className="flex items-center gap-2 opacity-40">
                      <Target size={14} style={{ color: T.text(d) }} />
                      <span className="text-[9px] font-black uppercase tracking-wider">Mercado de Gols</span>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold" style={{ color: T.textMuted(d) }}>+1.5 Gols</span>
                        <span className="text-[10px] font-black text-emerald-400">{data.gols.over15}%</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-bold" style={{ color: T.textMuted(d) }}>Ambos Marcam</span>
                        <span className="text-[10px] font-black text-amber-400">{data.gols.ambosMarcam}</span>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 rounded-2xl border space-y-3" style={{ borderColor: T.border(d), background: T.surface(d) }}>
                    <div className="flex items-center gap-2 opacity-40">
                      <Flag size={14} style={{ color: T.text(d) }} />
                      <span className="text-[9px] font-black uppercase tracking-wider">Escanteios</span>
                    </div>
                    <div className="space-y-2">
                       <div className="flex items-center justify-between">
                         <span className="text-[10px] font-bold" style={{ color: T.textMuted(d) }}>{data.escanteios.label}</span>
                         <span className="text-[10px] font-black text-amber-400">{data.escanteios.probabilidade}%</span>
                       </div>
                       <div className="h-1 w-full rounded-full bg-white/5 overflow-hidden">
                         <motion.div
                           initial={{ width: 0 }}
                           animate={{ width: `${data.escanteios.probabilidade}%` }}
                           className="h-full bg-amber-400 rounded-full"
                         />
                       </div>
                    </div>
                  </div>
                </div>

                {/* Palpite e Dica */}
                <div className="p-5 rounded-3xl border relative overflow-hidden" style={{ borderColor: T.border(d), background: 'linear-gradient(135deg, rgba(251,191,36,0.1) 0%, transparent 100%)' }}>
                   <div className="absolute top-0 right-0 p-4 opacity-5">
                      <Trophy size={80} />
                   </div>
                   <div className="relative z-10 space-y-4">
                     <div className="flex items-center justify-between">
                        <div>
                           <p className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-1" style={{ color: T.text(d) }}>Palpite do Especialista</p>
                           <div className="flex items-center gap-3">
                              <span className="text-3xl font-black text-amber-400 tracking-tighter">{data.palpite}</span>
                              <div className="px-2 py-1 rounded-md bg-amber-400 text-slate-900 text-[10px] font-black italic">PRO</div>
                           </div>
                        </div>
                     </div>
                     <div className="flex items-start gap-3 pt-3 border-t" style={{ borderColor: T.border(d) }}>
                        <Zap size={16} className="text-amber-400 shrink-0 mt-0.5" />
                        <p className="text-xs font-bold leading-relaxed" style={{ color: T.text(d) }}>
                          <span className="opacity-40 uppercase text-[9px] block mb-1">Dica de Ouro</span>
                          {data.dica}
                        </p>
                     </div>
                   </div>
                </div>
              </div>
            )}
          </div>

          <div className="p-6 pt-2 shrink-0 border-t" style={{ borderColor: T.border(d), background: T.surface(d) }}>
            <button
              onClick={onClose}
              className="w-full py-4 rounded-2xl font-black text-sm tracking-widest uppercase transition-all active:scale-95 shadow-lg shadow-amber-400/10"
              style={{ background: "linear-gradient(135deg,#FBBF24 0%,#F59E0B 100%)", color: "#0C1120" }}
            >
              Copiar Palpite
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}

// ─── Login ────────────────────────────────────────────────────────────────────

function Login({
  onLogin,
  isDark,
  toggleTheme,
}: {
  onLogin: () => void;
  isDark: boolean;
  toggleTheme: () => void;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [nome, setNome] = useState("");
  const [sobrenome, setSobrenome] = useState("");
  const [apelido, setApelido] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [rememberMe, setRememberMe] = useState(true);

  const d = isDark;

  useEffect(() => {
    const remembered = localStorage.getItem("bolao_remembered_user");
    if (remembered) {
      setUser(remembered);
    }
  }, []);


  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nome || !sobrenome || !apelido || !email || !pass) {
      setError(true);
      return;
    }
    setLoading(true);
    try {
      const { data, error: regError } = await supabase
        .from("usuarios")
        .insert([
          {
            nome,
            sobrenome,
            apelido,
            email,
            senha: pass,
            cargo: "usuario",
            status: "pendente",
          },
        ])
        .select()
        .single();

      if (regError) throw regError;

      setSuccess(true);
      setTimeout(() => {
        setMode("login");
        setUser(email);
        setSuccess(false);
      }, 2000);
    } catch (err: any) {
      setError(true);
      if (err.code === "23505") {
        if (err.message?.includes("apelido")) {
          setErrorMessage("Este apelido já está em uso.");
        } else if (err.message?.includes("email")) {
          setErrorMessage("Este e-mail já está em uso.");
        } else {
          setErrorMessage("Usuário ou e-mail já cadastrado.");
        }
      } else {
        setErrorMessage("Erro ao cadastrar. Tente novamente.");
      }
      setTimeout(() => {
        setError(false);
        setErrorMessage("");
      }, 4000);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === "register") return handleRegister(e);

    setLoading(true);
    try {
      const { data, error } = await supabase
        .from("usuarios")
        .select("*")
        .or(`email.eq.${user},apelido.eq.${user}`)
        .eq("senha", pass)
        .single();

      if (error || !data) throw new Error("Invalid credentials");

      if (data.status !== "aprovado") {
        setError(true);
        setErrorMessage(
          data.status === "pendente"
            ? "Sua conta está aguardando aprovação."
            : "Sua conta foi recusada pelo administrador.",
        );
        setTimeout(() => setError(false), 5000);
        return;
      }

      if (rememberMe) {
        localStorage.setItem("bolao_remembered_user", user);
      } else {
        localStorage.removeItem("bolao_remembered_user");
      }

      localStorage.setItem("bolao_user", JSON.stringify(data));

      onLogin();
    } catch (err) {
      setError(true);
      setTimeout(() => setError(false), 3000);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-[100dvh] grid grid-cols-1 md:grid-cols-2 transition-colors duration-300"
      style={{
        background: d
          ? "linear-gradient(160deg,#060B14 0%,#0A1428 50%,#060B14 100%)"
          : "linear-gradient(160deg,#E8EDF5 0%,#F0F4F8 50%,#E8EDF5 100%)",
      }}
    >
      {/* ── Coluna esquerda: Branding (só desktop) ── */}
      <div
        className="hidden md:flex flex-col items-center justify-center p-16 relative overflow-hidden"
        style={{
          background: "linear-gradient(160deg,#060B14 0%,#0A1428 60%,#080E1C 100%)",
        }}
      >
        {/* Decorative glows */}
        <div className="absolute top-0 left-0 w-80 h-80 rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle,rgba(251,191,36,0.18) 0%,transparent 70%)", transform: "translate(-30%,-30%)" }} />
        <div className="absolute bottom-0 right-0 w-80 h-80 rounded-full pointer-events-none"
          style={{ background: "radial-gradient(circle,rgba(99,102,241,0.18) 0%,transparent 70%)", transform: "translate(30%,30%)" }} />
        <div className="absolute inset-0 pointer-events-none"
          style={{
            opacity: 0.04,
            backgroundImage: "linear-gradient(rgba(255,255,255,0.5) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.5) 1px,transparent 1px)",
            backgroundSize: "40px 40px",
          }} />

        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          className="relative z-10 flex flex-col items-center text-center gap-8 max-w-sm"
        >
          {/* Logo */}
          <div
            className="w-28 h-28 rounded-[32px] flex items-center justify-center shadow-2xl"
            style={{
              background: "linear-gradient(135deg,#FBBF24 0%,#F59E0B 100%)",
              boxShadow: "0 0 60px rgba(251,191,36,0.4), 0 20px 40px rgba(0,0,0,0.4)",
            }}
          >
            <Swords size={56} className="text-slate-950" />
          </div>

          {/* Title */}
          <div className="space-y-3">
            <p className="text-amber-400 text-xs font-bold tracking-[0.3em] uppercase">
              Temporada 2025
            </p>
            <h1 className="text-5xl font-black leading-tight tracking-tight text-white">
              Bolão dos<br />
              <span style={{ background: "linear-gradient(90deg,#FBBF24,#FDE68A)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>
                Clássicos
              </span>
            </h1>
            <p className="text-white/50 text-sm font-medium leading-relaxed">
              Palpite nos jogos do Campeonato<br />Brasileiro e dispute grandes prêmios
            </p>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-3 gap-4 w-full">
            {[
              { label: "Participantes", value: String(finance.participants), icon: "👥" },
              { label: "1º Lugar", value: `R$${Math.round(prizes.first)}`, icon: "🥇" },
              { label: "2º Lugar", value: `R$${Math.round(prizes.second)}`, icon: "🥈" },
            ].map(({ label, value, icon }) => (
              <div
                key={label}
                className="rounded-2xl p-4 text-center"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(251,191,36,0.15)" }}
              >
                <p className="text-xl mb-1">{icon}</p>
                <p className="text-white font-black text-sm">{value}</p>
                <p className="text-white/40 text-[10px] font-medium mt-0.5">{label}</p>
              </div>
            ))}
          </div>

          {/* Developer */}
          <div className="flex items-center gap-2">
            <p className="text-white/30 text-xs">Desenvolvido por</p>
            <p className="text-white/60 text-xs font-bold">Adriano Martins</p>
            <a href="https://wa.me/5591984497134" target="_blank" rel="noopener noreferrer"
              className="w-6 h-6 rounded-full flex items-center justify-center"
              style={{ background: "rgba(37,211,102,0.2)", border: "1px solid rgba(37,211,102,0.3)" }}>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="#25D366">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
              </svg>
            </a>
          </div>
        </motion.div>
      </div>

      {/* ── Coluna direita: Formulário ── */}
      <div className="flex flex-col items-center justify-center px-6 md:px-12 py-10 relative overflow-hidden">
        {/* Decorative (mobile only) */}
        <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full pointer-events-none md:hidden"
          style={{ background: `radial-gradient(circle,${d ? "rgba(251,191,36,0.12)" : "rgba(251,191,36,0.15)"} 0%,transparent 70%)` }} />
        <div className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full pointer-events-none md:hidden"
          style={{ background: `radial-gradient(circle,${d ? "rgba(99,102,241,0.10)" : "rgba(99,102,241,0.08)"} 0%,transparent 70%)` }} />

      <motion.div
        initial={{ opacity: 0, y: 32 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="relative z-10 w-full max-w-sm space-y-8"
      >
        {/* Header (mobile only — desktop tem a coluna esquerda) */}
        <div className="text-center space-y-4 md:hidden">
          <div
            className="mx-auto w-20 h-20 rounded-[20px] flex items-center justify-center"
            style={{
              background: "linear-gradient(135deg,#FBBF24 0%,#F59E0B 100%)",
              boxShadow: d ? "0 0 40px rgba(251,191,36,0.35), 0 8px 24px rgba(0,0,0,0.3)" : "none",
            }}
          >
            <Swords size={36} className="text-slate-950" />
          </div>
          <div>
            <p className="text-amber-400 text-xs font-bold tracking-[0.25em] uppercase mb-1">
              {mode === "login" ? "Bem-vindo ao" : "Crie sua conta"}
            </p>
            <h1 className="text-3xl font-black leading-tight tracking-tight" style={{ color: T.text(d) }}>
              Bolão dos<br />
              <span style={d ? { background: "linear-gradient(90deg,#FBBF24,#FDE68A)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" } : { color: "#F59E0B" }}>
                Clássicos
              </span>
            </h1>
          </div>
        </div>

        {/* Desktop: título reduzido no lado do form */}
        <div className="hidden md:block">
          <p className="text-amber-400 text-xs font-bold tracking-[0.25em] uppercase mb-1">
            {mode === "login" ? "Acesse sua conta" : "Criar nova conta"}
          </p>
          <h2 className="text-2xl font-black" style={{ color: T.text(d) }}>
            {mode === "login" ? "Bem-vindo de volta" : "Junte-se ao bolão"}
          </h2>
          <p className="text-sm mt-1" style={{ color: T.textMuted(d) }}>
            {mode === "login" ? "Entre com seu e-mail ou apelido" : "Preencha seus dados para participar"}
          </p>
        </div>

        <div
          className="rounded-2xl p-6 space-y-4 border transition-colors duration-300"
          style={{
            background: T.surface(d),
            backdropFilter: "blur(20px)",
            borderColor: T.border(d),
          }}
        >
          <div className="space-y-3">
            {mode === "register" ? (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <div className="relative">
                    <span
                      className="absolute left-4 top-1/2 -translate-y-1/2"
                      style={{ color: T.textMuted(d) }}
                    >
                      <Users size={16} />
                    </span>
                    <input
                      type="text"
                      placeholder="Nome"
                      value={nome}
                      onChange={(e) => setNome(e.target.value)}
                      className="w-full pl-10 pr-4 py-3.5 rounded-xl font-medium outline-none transition-all text-sm"
                      style={{
                        background: T.inputBg(d),
                        border: `1.5px solid ${T.inputBdr(d)}`,
                        color: T.text(d),
                      }}
                    />
                  </div>
                  <div className="relative">
                    <input
                      type="text"
                      placeholder="Sobrenome"
                      value={sobrenome}
                      onChange={(e) => setSobrenome(e.target.value)}
                      className="w-full px-4 py-3.5 rounded-xl font-medium outline-none transition-all text-sm"
                      style={{
                        background: T.inputBg(d),
                        border: `1.5px solid ${T.inputBdr(d)}`,
                        color: T.text(d),
                      }}
                    />
                  </div>
                </div>
                <div className="relative">
                  <span
                    className="absolute left-4 top-1/2 -translate-y-1/2"
                    style={{ color: T.textMuted(d) }}
                  >
                    <Award size={16} />
                  </span>
                  <input
                    type="text"
                    placeholder="Apelido no App"
                    value={apelido}
                    onChange={(e) => setApelido(e.target.value)}
                    className="w-full pl-10 pr-4 py-3.5 rounded-xl font-medium outline-none transition-all text-sm"
                    style={{
                      background: T.inputBg(d),
                      border: `1.5px solid ${T.inputBdr(d)}`,
                      color: T.text(d),
                    }}
                  />
                </div>
                <div className="relative">
                  <span
                    className="absolute left-4 top-1/2 -translate-y-1/2"
                    style={{ color: T.textMuted(d) }}
                  >
                    <LogIn size={16} />
                  </span>
                  <input
                    type="email"
                    placeholder="E-mail"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full pl-10 pr-4 py-3.5 rounded-xl font-medium outline-none transition-all text-sm"
                    style={{
                      background: T.inputBg(d),
                      border: `1.5px solid ${T.inputBdr(d)}`,
                      color: T.text(d),
                    }}
                  />
                </div>
                <div className="relative">
                  <span
                    className="absolute left-4 top-1/2 -translate-y-1/2"
                    style={{ color: T.textMuted(d) }}
                  >
                    <Shield size={16} />
                  </span>
                  <input
                    type="password"
                    placeholder="Senha"
                    value={pass}
                    onChange={(e) => setPass(e.target.value)}
                    className="w-full pl-10 pr-4 py-3.5 rounded-xl font-medium outline-none transition-all text-sm"
                    style={{
                      background: T.inputBg(d),
                      border: `1.5px solid ${T.inputBdr(d)}`,
                      color: T.text(d),
                    }}
                  />
                </div>
              </>
            ) : (
              <>
                <div className="relative">
                  <span
                    className="absolute left-4 top-1/2 -translate-y-1/2"
                    style={{ color: T.textMuted(d) }}
                  >
                    <Users size={16} />
                  </span>
                  <input
                    type="text"
                    placeholder="E-mail ou Apelido"
                    value={user}
                    onChange={(e) => setUser(e.target.value)}
                    className="w-full pl-10 pr-4 py-3.5 rounded-xl font-medium outline-none transition-all text-sm"
                    style={{
                      background: T.inputBg(d),
                      border: `1.5px solid ${T.inputBdr(d)}`,
                      color: T.text(d),
                    }}
                  />
                </div>
                <div className="relative">
                  <span
                    className="absolute left-4 top-1/2 -translate-y-1/2"
                    style={{ color: T.textMuted(d) }}
                  >
                    <Shield size={16} />
                  </span>
                  <input
                    type="password"
                    placeholder="Senha"
                    value={pass}
                    onChange={(e) => setPass(e.target.value)}
                    className="w-full pl-10 pr-4 py-3.5 rounded-xl font-medium outline-none transition-all text-sm"
                    style={{
                      background: T.inputBg(d),
                      border: `1.5px solid ${T.inputBdr(d)}`,
                      color: T.text(d),
                    }}
                  />
                </div>
                <div className="flex items-center gap-2 px-1">
                  <input
                    type="checkbox"
                    id="remember"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-4 h-4 rounded border-gray-300 text-amber-400 focus:ring-amber-400 accent-amber-400"
                  />
                  <label
                    htmlFor="remember"
                    className="text-xs font-medium cursor-pointer select-none"
                    style={{ color: T.textMuted(d) }}
                  >
                    Lembrar meu usuário
                  </label>
                </div>
              </>
            )}

          </div>

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="flex items-center gap-2 text-red-400 bg-red-500/10 border border-red-500/20 p-3 rounded-xl text-xs font-medium">
                  <AlertCircle size={14} />
                  <span>
                    {errorMessage ||
                      (mode === "login"
                        ? "Credenciais inválidas"
                        : "Erro ao cadastrar. Verifique os dados.")}
                  </span>
                </div>
              </motion.div>
            )}
            {success && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="flex items-center gap-2 text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 p-3 rounded-xl text-xs font-medium">
                  <Star size={14} fill="currentColor" />
                  <span>Conta criada! Redirecionando...</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <button
            onClick={handleSubmit as any}
            disabled={loading || success}
            className="w-full py-3.5 rounded-xl font-black text-slate-950 text-sm tracking-wide flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-70"
            style={{
              background: "linear-gradient(135deg,#FBBF24 0%,#F59E0B 100%)",
              boxShadow: "0 4px 20px rgba(251,191,36,0.25)",
            }}
          >
            {loading ? (
              <motion.div
                className="w-5 h-5 rounded-full border-2 border-slate-950/30 border-t-slate-950"
                animate={{ rotate: 360 }}
                transition={{ duration: 0.7, repeat: Infinity, ease: "linear" }}
              />
            ) : (
              <>
                <span>{mode === "login" ? "Entrar" : "Cadastrar"}</span>
                <LogIn size={16} />
              </>
            )}
          </button>

          <button
            onClick={() => {
              setMode(mode === "login" ? "register" : "login");
              setError(false);
            }}
            className="w-full text-xs font-bold transition-all active:scale-95"
            style={{ color: T.textMuted(d) }}
          >
            {mode === "login" ? (
              <>
                Não tem conta?{" "}
                <span className="text-amber-400">Cadastre-se</span>
              </>
            ) : (
              <>
                Já tem conta? <span className="text-amber-400">Faça login</span>
              </>
            )}
          </button>
        </div>

        {/* Rodapé do desenvolvedor (mobile only) */}
        <div className="flex items-center justify-center gap-2 md:hidden">
          <p className="text-[11px]" style={{ color: T.textMuted(d) }}>
            Desenvolvido por{" "}
            <span className="font-bold" style={{ color: T.text(d) }}>
              Adriano Martins
            </span>
          </p>
          <a
            href="https://wa.me/5591984497134"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center w-7 h-7 rounded-full transition-all active:scale-90"
            style={{ background: "rgba(37,211,102,0.15)", border: "1px solid rgba(37,211,102,0.3)" }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="#25D366">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
            </svg>
          </a>
        </div>
      </motion.div>
      </div>{/* fim coluna direita */}
    </div>
  );
}

// ─── Apostar ──────────────────────────────────────────────────────────────────

function Apostar({
  isDark,
  onRoundLoad,
  onPointsChange,
  user,
}: {
  isDark: boolean;
  onRoundLoad: (n: number | string) => void;
  onPointsChange: (pts: number) => void;
  user: any;
}) {
  const d = isDark;
  const [loadingBets, setLoadingBets] = useState(false);

  const [anchorTs, setAnchorTs] = useState(() => todayMidnight());
  const espn = useRodada(anchorTs, "bra.1");
  const seriec = useSerieCRodada(false);

  const loading = espn.loading || seriec.loading;
  const error = espn.error && seriec.error;
  const refetch = () => { espn.refetch(); seriec.refetch(); };

  // ── Pull-to-refresh ──
  const [pullY, setPullY] = useState(0);
  const [ptrRefreshing, setPtrRefreshing] = useState(false);
  const ptrRef = useRef({ startY: 0, active: false });
  const PTR_THRESHOLD = 65;

  const onTouchStart = (e: React.TouchEvent) => {
    const main = (e.currentTarget as HTMLElement).closest("main");
    if (!main || main.scrollTop > 2) return;
    ptrRef.current = { startY: e.touches[0].clientY, active: true };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    if (!ptrRef.current.active) return;
    const main = (e.currentTarget as HTMLElement).closest("main");
    if (main && main.scrollTop > 2) { ptrRef.current.active = false; setPullY(0); return; }
    const delta = e.touches[0].clientY - ptrRef.current.startY;
    setPullY(delta > 0 ? Math.min(delta * 0.42, 90) : 0);
  };
  const onTouchEnd = async () => {
    ptrRef.current.active = false;
    if (pullY >= PTR_THRESHOLD && !ptrRefreshing) {
      setPtrRefreshing(true);
      espn.silentRefetch();
      seriec.silentRefetch();
      setTimeout(() => setPtrRefreshing(false), 1200);
    }
    setPullY(0);
  };

  const isCurrentRound = anchorTs >= todayMidnight() - 86400000;

  const [liberatedIds, setLiberatedIds] = useState<string[]>([]);
  const [liberatedLoading, setLiberatedLoading] = useState(true);
  type ScoreMap = Record<string, { home: string; away: string }>;
  const [scores, setScores] = useState<ScoreMap>({});
  const [showSuccess, setShowSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [isLocked, setIsLocked] = useState(false);
  const [sharedFile, setSharedFile] = useState<File | null>(null);
  const [sharingPending, setSharingPending] = useState(false);
  const shareRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (espn.data?.roundNumber) onRoundLoad(espn.data.roundNumber);
    fetchLiberated();
  }, [espn.data?.roundNumber, anchorTs]);

  const fetchLiberated = async () => {
    setLiberatedLoading(true);
    const { data: libData } = await supabase
      .from("jogos_selecionados")
      .select("match_id")
      .eq("liberado", true);
    if (libData) setLiberatedIds(libData.map((x: any) => x.match_id));
    setLiberatedLoading(false);
  };

  useEffect(() => {
    if (espn.data?.matches || seriec.data?.matches) fetchUserBets();
  }, [espn.data?.matches, seriec.data?.matches, anchorTs, user?.id]);

  const fetchUserBets = async () => {
    if (!user) return;
    setLoadingBets(true);
    const { data: bets } = await supabase
      .from("palpites")
      .select("*")
      .eq("usuario_id", user.id);

    if (bets && bets.length > 0) {
      const betMap: ScoreMap = {};
      bets.forEach((b: any) => {
        betMap[b.match_id] = {
          home: String(b.gols_home),
          away: String(b.gols_away),
        };
      });
      setScores(betMap);
      setIsLocked(true);
    } else {
      setScores({});
      setIsLocked(false);
    }
    setLoadingBets(false);
  };

  const goBack = () => {
    const espnMatches = espn.data?.matches ?? [];
    const earliest = espnMatches.length
      ? espnMatches.reduce(
          (m, x) => Math.min(m, new Date(x.date).getTime()),
          Infinity,
        )
      : anchorTs;
    const next = new Date(earliest - 10 * 86400000);
    next.setHours(0, 0, 0, 0);
    setAnchorTs(next.getTime());
  };

  const goForward = () => {
    if (isCurrentRound) return;
    const espnMatches = espn.data?.matches ?? [];
    const latest = espnMatches.length
      ? espnMatches.reduce(
          (m, x) => Math.max(m, new Date(x.date).getTime()),
          -Infinity,
        )
      : anchorTs;
    const next = new Date(latest + 3 * 86400000);
    next.setHours(0, 0, 0, 0);
    setAnchorTs(Math.min(next.getTime(), todayMidnight()));
  };

  const rawMatches: Match[] = [
    ...(espn.data?.matches ?? []).map((m) => ({ ...m, league: "bra.1" as const })),
    ...(isCurrentRound ? (seriec.data?.matches ?? []).map((m) => ({ ...m, league: "bra.3" as const })) : []),
  ];
  const matches = rawMatches.filter(
    (m) => liberatedIds.includes(m.id) || !isCurrentRound,
  );

  // ── MOCK TEST ── remova este bloco quando quiser voltar ao normal ──────────
  const MOCK_TEST = false;
  const mockMatches: Match[] = MOCK_TEST
    ? [
        {
          id: "m1",
          home: "FLA",
          away: "PAL",
          homeName: "Flamengo",
          awayName: "Palmeiras",
          homeLogo: "https://a.espncdn.com/i/teamlogos/soccer/500/133.png",
          awayLogo: "https://a.espncdn.com/i/teamlogos/soccer/500/131.png",
          homeScore: "2",
          awayScore: "1",
          date: new Date().toISOString(),
          status: "STATUS_FINAL",
          clock: "",
        },
        {
          id: "m2",
          home: "COR",
          away: "SAO",
          homeName: "Corinthians",
          awayName: "São Paulo",
          homeLogo: "https://a.espncdn.com/i/teamlogos/soccer/500/132.png",
          awayLogo: "https://a.espncdn.com/i/teamlogos/soccer/500/130.png",
          homeScore: "1",
          awayScore: "1",
          date: new Date().toISOString(),
          status: "STATUS_FINAL",
          clock: "",
        },
        {
          id: "m3",
          home: "INT",
          away: "GRE",
          homeName: "Internacional",
          awayName: "Grêmio",
          homeLogo: "https://a.espncdn.com/i/teamlogos/soccer/500/119.png",
          awayLogo: "https://a.espncdn.com/i/teamlogos/soccer/500/118.png",
          homeScore: "0",
          awayScore: "3",
          date: new Date().toISOString(),
          status: "STATUS_FINAL",
          clock: "",
        },
        {
          id: "m4",
          home: "BOT",
          away: "VAS",
          homeName: "Botafogo",
          awayName: "Vasco",
          homeLogo: "https://a.espncdn.com/i/teamlogos/soccer/500/1966.png",
          awayLogo: "https://a.espncdn.com/i/teamlogos/soccer/500/1967.png",
          homeScore: "1",
          awayScore: "0",
          date: new Date().toISOString(),
          status: "STATUS_IN_PROGRESS",
          clock: "67'",
        },
        {
          id: "m5",
          home: "ATH",
          away: "BAH",
          homeName: "Athletico-PR",
          awayName: "Bahia",
          homeLogo: "https://a.espncdn.com/i/teamlogos/soccer/500/136.png",
          awayLogo: "https://a.espncdn.com/i/teamlogos/soccer/500/2863.png",
          homeScore: "2",
          awayScore: "2",
          date: new Date().toISOString(),
          status: "STATUS_HALFTIME",
          clock: "HT",
        },
        {
          id: "m6",
          home: "FLU",
          away: "CRU",
          homeName: "Fluminense",
          awayName: "Cruzeiro",
          homeLogo: "https://a.espncdn.com/i/teamlogos/soccer/500/129.png",
          awayLogo: "https://a.espncdn.com/i/teamlogos/soccer/500/127.png",
          homeScore: "-",
          awayScore: "-",
          date: new Date(Date.now() + 3600000).toISOString(),
          status: "STATUS_SCHEDULED",
          clock: "",
        },
        {
          id: "m7",
          home: "FOR",
          away: "MIR",
          homeName: "Fortaleza",
          awayName: "Mirassol",
          homeLogo: "https://a.espncdn.com/i/teamlogos/soccer/500/3936.png",
          awayLogo: "https://a.espncdn.com/i/teamlogos/soccer/500/5594.png",
          homeScore: "-",
          awayScore: "-",
          date: new Date(Date.now() + 7200000).toISOString(),
          status: "STATUS_SCHEDULED",
          clock: "",
        },
      ]
    : [];
  const mockScores: Record<string, { home: string; away: string }> = MOCK_TEST
    ? {
        m1: { home: "2", away: "1" }, // placar exato + vitória casa ✓ (35pts)
        m2: { home: "2", away: "2" }, // apostou empate (2×2), saiu 1×1 → resultado certo (+10pts)
        m3: { home: "1", away: "3" }, // placar errado, resultado certo Fora (10pts)
        m4: { home: "1", away: "0" }, // ao vivo
        m5: { home: "2", away: "2" }, // intervalo
        m6: { home: "1", away: "0" }, // agendado
        m7: { home: "0", away: "1" }, // agendado
      }
    : {};

  const activeMatches = MOCK_TEST ? mockMatches : matches;
  const activeScores = MOCK_TEST ? mockScores : scores;
  // Bloqueia envio assim que qualquer jogo da rodada sair de "Agendado"
  const roundStarted = isCurrentRound && activeMatches.some(
    (m) => m.status !== "STATUS_SCHEDULED"
  );
  const activeIsLocked = MOCK_TEST ? true : (isLocked || roundStarted);
  // ── fim MOCK TEST ──────────────────────────────────────────────────────────

  // Salva pontos no banco quando jogos finalizam (roda a cada refresh do ESPN ~90s)
  useEffect(() => {
    if (!isLocked || !user || !matches.length) return;
    const finalWithBet = matches.filter(
      (m) =>
        m.status === "STATUS_FINAL" &&
        m.homeScore !== "-" &&
        scores[m.id],
    );
    if (!finalWithBet.length) return;
    finalWithBet.forEach(async (m) => {
      const pts = calcPoints(scores[m.id], m).pts;
      await supabase
        .from("palpites")
        .update({ pontos: pts })
        .eq("usuario_id", user.id)
        .eq("match_id", m.id)
        .is("pontos", null); // só salva se ainda não foi computado
    });
  }, [matches, isLocked]);

  // Pré-gera a imagem para contornar a exigência de "User Gesture" no mobile
  useEffect(() => {
    if (isLocked && matches.length > 0 && !sharedFile) {
      const timer = setTimeout(async () => {
        if (!shareRef.current) return;
        try {
          const dataUrl = await domToPng(shareRef.current, {
            backgroundColor: isDark ? "#0C1120" : "#FFFFFF",
            scale: 2,
            quality: 1,
          });
          const res = await fetch(dataUrl);
          const blob = await res.blob();
          setSharedFile(
            new File([blob], "meus-palpites.png", { type: "image/png" }),
          );
        } catch (e) {
          console.error("[Bolão] Falha na pré-geração:", e);
        }
      }, 2000); // 2s delay to ensure all logos (especially TSDB) are loaded
      return () => clearTimeout(timer);
    }
  }, [isLocked, matches.length, isDark]);

  const doShare = async (file: File) => {
    try {
      if (
        navigator.share &&
        navigator.canShare &&
        navigator.canShare({ files: [file] })
      ) {
        await navigator.share({
          files: [file],
          title: "Meus Palpites - Bolão dos Clássicos",
          text: `Confira meus palpites para a rodada! 🏆\n@${user?.apelido ?? user?.nome ?? ""}`,
        });
      } else {
        const link = document.createElement("a");
        link.download = "meus-palpites.png";
        link.href = URL.createObjectURL(file);
        link.click();
      }
    } catch (err) {
      console.error("[Bolão] Erro ao compartilhar:", err);
    }
  };

  // Dispara o share assim que a imagem fica pronta (quando clicou antes de estar pronta)
  useEffect(() => {
    if (sharingPending && sharedFile) {
      setSharingPending(false);
      doShare(sharedFile);
    }
  }, [sharingPending, sharedFile]);

  const handleShareImage = async () => {
    if (!sharedFile) {
      setSharingPending(true); // entra em loading, dispara quando pronta
      return;
    }
    await doShare(sharedFile);
  };

  const setScore = (id: string, side: "home" | "away", val: string, index: number) => {
    const cleanVal = val.replace(/\D/g, "").slice(0, 2);
    setScores((s) => ({
      ...s,
      [id]: {
        ...(s[id] ?? { home: "", away: "" }),
        [side]: cleanVal,
      },
    }));

    // Pula para o próximo campo automaticamente
    if (cleanVal.length >= 1) {
      if (side === "home") {
        setTimeout(() => {
          document.getElementById(`score-${id}-away`)?.focus();
        }, 10);
      } else {
        const nextMatch = activeMatches[index + 1];
        if (nextMatch) {
          setTimeout(() => {
            document.getElementById(`score-${nextMatch.id}-home`)?.focus();
          }, 10);
        }
      }
    }
  };

  const openMatches = activeMatches.filter((m) => m.status !== "STATUS_FINAL");
  const filledCount = openMatches.filter((m) => {
    const s = activeScores[m.id];
    return (
      s?.home !== "" && s?.home != null && s?.away !== "" && s?.away != null
    );
  }).length;
  const canSubmit =
    openMatches.length > 0 && filledCount === openMatches.length;
  const totalPoints = activeMatches
    .filter((m) => m.status === "STATUS_FINAL" && activeScores[m.id])
    .reduce((sum, m) => sum + calcPoints(activeScores[m.id], m).pts, 0);

  useEffect(() => {
    onPointsChange(totalPoints);
  }, [totalPoints]);

  // ── Loading skeleton ──
  if (loading || liberatedLoading)
    return (
      <div className="pb-4 space-y-3">
        <div
          className="rounded-xl p-4 flex items-center justify-between border animate-pulse"
          style={{ background: T.surface(d), borderColor: T.border(d) }}
        >
          <div className="space-y-2">
            <div
              className="h-4 w-32 rounded-lg"
              style={{ background: T.elevated(d) }}
            />
            <div
              className="h-3 w-20 rounded-lg"
              style={{ background: T.elevated(d) }}
            />
          </div>
          <div
            className="w-12 h-12 rounded-full"
            style={{ background: T.elevated(d) }}
          />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl p-4 border animate-pulse h-24"
            style={{ background: T.surface(d), borderColor: T.border(d) }}
          />
        ))}
      </div>
    );

  // ── Error state ──
  if (error)
    return (
      <div className="pb-4 space-y-4">
        <div className="flex flex-col items-center justify-center py-16 gap-5">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{
              background: "rgba(248,113,113,0.1)",
              border: "1px solid rgba(248,113,113,0.2)",
            }}
          >
            <WifiOff size={28} className="text-red-400" />
          </div>
          <div className="text-center">
            <p className="font-bold text-base" style={{ color: T.text(d) }}>
              Sem conexão com a API
            </p>
            <p className="text-sm mt-1" style={{ color: T.textMuted(d) }}>
              Não foi possível carregar os jogos
            </p>
          </div>
          <button
            onClick={refetch}
            className="flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-sm transition-all active:scale-95"
            style={{
              background: "linear-gradient(135deg,#FBBF24 0%,#F59E0B 100%)",
              color: "#0C1120",
            }}
          >
            <RefreshCw size={15} /> Tentar novamente
          </button>
        </div>
      </div>
    );

  // ── Empty state ──
  if (matches.length === 0)
    return (
      <div className="pb-4 space-y-4">
        <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
          <div
            className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{
              background: T.surface(d),
              border: `1px solid ${T.border(d)}`,
            }}
          >
            <Trophy size={28} className="text-amber-400" />
          </div>
          <p className="font-bold" style={{ color: T.text(d) }}>
            Nenhum jogo encontrado
          </p>
          <p className="text-sm" style={{ color: T.textMuted(d) }}>
            A rodada ainda não foi divulgada
          </p>
          <button
            onClick={refetch}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs active:scale-95"
            style={{
              background: T.surface(d),
              border: `1px solid ${T.border(d)}`,
              color: T.textMuted(d),
            }}
          >
            <RefreshCw size={13} /> Atualizar
          </button>
        </div>
      </div>
    );

  return (
    <div
      className="pb-4 space-y-3 flex flex-col"
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
    >
      {/* Pull-to-refresh indicator */}
      <div
        style={{
          overflow: "hidden",
          height: ptrRefreshing ? 44 : Math.min(pullY, 44),
          transition: pullY === 0 ? "height 0.25s ease" : "none",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          opacity: ptrRefreshing ? 1 : Math.min(pullY / PTR_THRESHOLD, 1),
          transform: `scale(${ptrRefreshing ? 1 : Math.min(0.6 + (pullY / PTR_THRESHOLD) * 0.4, 1)})`,
          transition: pullY === 0 ? "opacity 0.2s, transform 0.2s" : "none",
        }}>
          <RefreshCw
            size={16}
            className={ptrRefreshing ? "animate-spin" : ""}
            style={{ color: "#FBBF24", transform: ptrRefreshing ? undefined : `rotate(${pullY * 3}deg)` }}
          />
          <span style={{ fontSize: 11, fontWeight: 700, color: "#FBBF24" }}>
            {ptrRefreshing ? "Atualizando…" : pullY >= PTR_THRESHOLD ? "Solte para atualizar" : "Puxe para atualizar"}
          </span>
        </div>
      </div>

      {/* ── Navegação de rodadas ── */}
      <div
        className="flex items-center justify-between rounded-xl px-3 py-2.5 border"
        style={{ background: T.surface(d), borderColor: T.border(d) }}
      >
        <button
          onClick={goBack}
          className="w-8 h-8 rounded-lg flex items-center justify-center transition-all active:scale-90 disabled:opacity-30"
          style={{ background: T.elevated(d) }}
          disabled={loading}
        >
          <ChevronLeft size={16} style={{ color: T.text(d) }} />
        </button>
        <div className="text-center">
          <p className="font-black text-sm" style={{ color: T.text(d) }}>
            {loading
              ? "Carregando..."
              : espn.data?.roundNumber !== "?"
                ? `Rodada ${espn.data?.roundNumber}`
                : "Rodada atual"}
          </p>
          {!isCurrentRound ? (
            <button
              onClick={() => setAnchorTs(todayMidnight())}
              className="text-[10px] font-bold text-amber-400 underline underline-offset-2"
            >
              Ir para atual
            </button>
          ) : (
            <p className="text-[10px]" style={{ color: T.textMuted(d) }}>
              Rodada atual
            </p>
          )}
        </div>
        <button
          onClick={goForward}
          className="w-8 h-8 rounded-lg flex items-center justify-center transition-all active:scale-90 disabled:opacity-30"
          style={{ background: T.elevated(d) }}
          disabled={loading || isCurrentRound}
        >
          <ChevronRight size={16} style={{ color: T.text(d) }} />
        </button>
      </div>

      {/* Banner */}
      {isCurrentRound && (
        <div
          className="relative h-44 rounded-2xl overflow-hidden border shadow-sm"
          style={{
            backgroundImage: "url('/assets/flyer.webp')",
            backgroundSize: "cover",
            backgroundPosition: "top center",
            backgroundRepeat: "no-repeat",
            borderColor: T.border(d),
          }}
        />
      )}{" "}
      {/* fim !isHistorico */}
      {/* Banner histórico */}
      {!isCurrentRound && (
        <div
          className="rounded-xl px-4 py-3 flex items-center gap-2 border"
          style={{
            background: "rgba(99,102,241,0.08)",
            borderColor: "rgba(99,102,241,0.2)",
          }}
        >
          <Trophy size={13} className="text-indigo-400 shrink-0" />
          <p className="text-xs text-indigo-300">
            {espn.data?.roundNumber !== "?"
              ? `Resultados da rodada ${espn.data?.roundNumber}`
              : "Resultados da rodada"}
          </p>
        </div>
      )}
      {/* Match cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {activeMatches.map((match, idx) => {
        const sh = activeScores[match.id]?.home ?? "";
        const sa = activeScores[match.id]?.away ?? "";
        // Em modo histórico, trata todos como encerrados visualmente
        const closed = match.status === "STATUS_FINAL" || !isCurrentRound;
        const live = isCurrentRound && isLive(match.status);

        // Cor da borda baseada no resultado
        const bet = activeScores[match.id];
        const cardColor = (() => {
          if (!closed || !bet || match.homeScore === "-") return null;
          const sR = calcScorePoints(bet, match);
          const rR = calcResultPoints(bet, match);
          if (sR.pts > 0) return "#22C55E";
          if (rR.pts > 0) return "#F59E0B";
          if (match.status === "STATUS_FINAL") return "#F87171";
          return null;
        })();
        const cardBorderColor = cardColor
          ? cardColor + "55"
          : live
            ? "rgba(34,197,94,0.3)"
            : T.border(d);
        const cardBg =
          cardColor === "#22C55E"
            ? "rgba(34,197,94,0.04)"
            : cardColor === "#F59E0B"
              ? "rgba(245,158,11,0.04)"
              : cardColor === "#F87171"
                ? "rgba(248,113,113,0.04)"
                : T.surface(d);

        return (
          <motion.div
            key={match.id}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.04 }}
            className="rounded-2xl overflow-hidden border relative"
            style={{ background: cardBg, borderColor: cardBorderColor }}
          >
            <div className="px-4 pt-3 pb-1 flex items-center justify-between">
              <span
                className="text-[10px] font-medium"
                style={{ color: T.textMuted(d) }}
              >
                {fmtDate(match.date)}
              </span>
              <div className="flex items-center gap-1.5">
                <StatusBadge
                  status={match.status}
                  clock={match.clock}
                  closed={closed}
                />
              </div>
            </div>

            <div className="flex items-center px-4 pb-4 pt-2 gap-3">
              {/* Home */}
              <div className="flex flex-col items-center gap-1 flex-1 min-w-0">
                <TeamLogo
                  src={match.homeLogo}
                  abbr={match.home}
                  isDark={isDark}
                />
                <span
                  className="text-[10px] font-bold truncate w-full text-center"
                  style={{ color: T.text(d) }}
                >
                  {match.homeName}
                </span>
              </div>

              {/* Center: score */}
              <div className="flex items-center gap-2 shrink-0">
                {closed || live ? (
                  <>
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-black"
                      style={{ background: T.elevated(d), color: T.text(d) }}
                    >
                      {match.homeScore}
                    </div>
                    <div className="flex flex-col items-center gap-0.5">
                      <div
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ background: T.textMuted(d) }}
                      />
                      <div
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ background: T.textMuted(d) }}
                      />
                    </div>
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center text-lg font-black"
                      style={{ background: T.elevated(d), color: T.text(d) }}
                    >
                      {match.awayScore}
                    </div>
                  </>
                ) : (
                  <>
                    <input
                      id={`score-${match.id}-home`}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={sh}
                      placeholder=""
                      disabled={activeIsLocked}
                      onChange={(e) =>
                        setScore(match.id, "home", e.target.value, idx)
                      }
                      className="w-10 h-10 rounded-xl text-center text-lg font-black outline-none transition-all disabled:opacity-80"
                      style={{
                        background: sh ? "rgba(251,191,36,0.12)" : T.inputBg(d),
                        border: `1.5px solid ${sh ? "rgba(251,191,36,0.4)" : T.inputBdr(d)}`,
                        color: T.text(d),
                      }}
                    />
                    <div className="flex flex-col items-center gap-0.5">
                      <div
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ background: T.textMuted(d) }}
                      />
                      <div
                        className="w-1.5 h-1.5 rounded-full"
                        style={{ background: T.textMuted(d) }}
                      />
                    </div>
                    <input
                      id={`score-${match.id}-away`}
                      type="text"
                      inputMode="numeric"
                      pattern="[0-9]*"
                      value={sa}
                      placeholder=""
                      disabled={activeIsLocked}
                      onChange={(e) =>
                        setScore(match.id, "away", e.target.value, idx)
                      }
                      className="w-10 h-10 rounded-xl text-center text-lg font-black outline-none transition-all disabled:opacity-80"
                      style={{
                        background: sa ? "rgba(251,191,36,0.12)" : T.inputBg(d),
                        border: `1.5px solid ${sa ? "rgba(251,191,36,0.4)" : T.inputBdr(d)}`,
                        color: T.text(d),
                      }}
                    />
                  </>
                )}
              </div>

              {/* Away */}
              <div className="flex flex-col items-center gap-1 flex-1 min-w-0">
                <TeamLogo
                  src={match.awayLogo}
                  abbr={match.away}
                  isDark={isDark}
                />
                <span
                  className="text-[10px] font-bold truncate w-full text-center"
                  style={{ color: T.text(d) }}
                >
                  {match.awayName}
                </span>
              </div>
            </div>

            {/* Palpite + resultado após o jogo */}
            {closed &&
              activeScores[match.id]?.home != null &&
              (() => {
                const b = activeScores[match.id];
                const finished =
                  match.status === "STATUS_FINAL" && match.homeScore !== "-";
                const result = finished ? calcPoints(b, match) : null;
                const totalPts = result?.pts ?? 0;
                const errou = finished && totalPts === 0;
                const acertouPlacar = result?.label === "Placar exato";
                const acertouResultado = result?.label === "Resultado certo";
                const betResLabel = (() => {
                  const bh = parseInt(b.home),
                    ba = parseInt(b.away);
                  if (isNaN(bh) || isNaN(ba)) return "—";
                  return bh > ba ? "Casa" : bh < ba ? "Fora" : "Empate";
                })();

                return (
                  <div
                    style={{
                      borderTop: `1px solid ${T.border(d)}`,
                      padding: "10px 16px 14px",
                    }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      {/* Esquerda: palpite */}
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl shrink-0"
                          style={{
                            background: T.elevated(d),
                            border: `1px solid ${T.border(d)}`,
                          }}
                        >
                          <span
                            className="text-xs font-black"
                            style={{ color: T.text(d) }}
                          >
                            {b.home}
                          </span>
                          <span
                            className="text-[9px] font-bold"
                            style={{ color: T.textMuted(d) }}
                          >
                            ×
                          </span>
                          <span
                            className="text-xs font-black"
                            style={{ color: T.text(d) }}
                          >
                            {b.away}
                          </span>
                          <span
                            className="text-[9px] ml-0.5"
                            style={{ color: T.textMuted(d) }}
                          >
                            {betResLabel}
                          </span>
                        </div>

                        {/* Tags de acerto */}
                        {finished && (
                          <div className="flex flex-col gap-0.5 min-w-0">
                            {acertouPlacar && (
                              <span className="text-[9px] font-bold text-emerald-400 flex items-center gap-0.5">
                                <span>✓</span> Placar exato
                              </span>
                            )}
                            {acertouResultado && (
                              <span className="text-[9px] font-bold text-amber-400 flex items-center gap-0.5">
                                <span>✓</span> Resultado certo
                              </span>
                            )}
                            {errou && (
                              <span className="text-[9px] font-bold text-red-400 flex items-center gap-0.5">
                                <span>✗</span> Errou
                              </span>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Direita: pts badge ou aguardando */}
                      {finished ? (
                        <div
                          className="shrink-0 px-3 py-1.5 rounded-xl text-center"
                          style={{
                            background:
                              totalPts > 0
                                ? acertouPlacar
                                  ? "rgba(34,197,94,0.12)"
                                  : "rgba(245,158,11,0.12)"
                                : T.elevated(d),
                            border: `1px solid ${totalPts > 0 ? (acertouPlacar ? "rgba(34,197,94,0.25)" : "rgba(245,158,11,0.25)") : T.border(d)}`,
                          }}
                        >
                          <p
                            className="text-base font-black leading-none"
                            style={{
                              color:
                                totalPts > 0
                                  ? acertouPlacar
                                    ? "#22C55E"
                                    : "#F59E0B"
                                  : "#F87171",
                            }}
                          >
                            {totalPts > 0 ? `+${totalPts}` : "0"}
                          </p>
                          <p
                            className="text-[9px] font-bold mt-0.5"
                            style={{ color: T.textMuted(d) }}
                          >
                            pts
                          </p>
                        </div>
                      ) : (
                        <span
                          className="text-[10px] shrink-0"
                          style={{ color: T.textMuted(d) }}
                        >
                          Aguardando...
                        </span>
                      )}
                    </div>
                  </div>
                );
              })()}
          </motion.div>
        );
      })}
      </div>{/* end grid match cards */}
      {/* Submit — só na rodada atual */}
      {isCurrentRound && openMatches.length > 0 ? (
        <div className="pt-2">
          <AnimatePresence mode="wait">
            {isLocked ? (
              <div className="space-y-2">
                <motion.div
                  key="locked"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="w-full py-4 rounded-xl flex items-center justify-center gap-2 font-bold text-emerald-400 text-sm border shadow-lg"
                  style={{
                    background: "rgba(34,197,94,0.08)",
                    borderColor: "rgba(34,197,94,0.3)",
                  }}
                >
                  <Shield size={16} fill="currentColor" /> Palpites Confirmados
                </motion.div>

                <button
                  onClick={handleShareImage}
                  disabled={!sharedFile}
                  className="w-full py-3.5 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all active:scale-95 border disabled:opacity-50"
                  style={{
                    background: T.surface(d),
                    borderColor: T.border(d),
                    color: T.text(d),
                  }}
                >
                  <Share2
                    size={14}
                    className={sharedFile ? "text-amber-400" : "animate-pulse"}
                  />
                  {sharedFile
                    ? "Compartilhar imagem dos palpites"
                    : "Preparando imagem..."}
                </button>
              </div>
            ) : roundStarted ? (
              <motion.div
                key="closed"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="w-full py-4 rounded-xl flex items-center justify-center gap-2 font-bold text-sm border"
                style={{
                  background: d ? "rgba(248,113,113,0.07)" : "rgba(239,68,68,0.07)",
                  borderColor: "rgba(248,113,113,0.25)",
                  color: "#F87171",
                }}
              >
                <Shield size={16} /> Prazo encerrado — rodada em andamento
              </motion.div>
            ) : (
              <button
                key="btn"
                onClick={async () => {
                  if (!canSubmit || submitting) return;
                  setSubmitting(true);
                  try {
                    const betsToInsert = openMatches.map((m) => ({
                      usuario_id: user.id,
                      match_id: m.id,
                      gols_home: parseInt(scores[m.id].home),
                      gols_away: parseInt(scores[m.id].away),
                      league: m.league ?? "bra.1",
                    }));

                    const { error: upsertError } = await supabase
                      .from("palpites")
                      .upsert(betsToInsert, {
                        onConflict: "usuario_id,match_id",
                      });

                    if (upsertError) throw upsertError;
                    setIsLocked(true);
                    setShowSuccess(true);
                  } catch (err) {
                    alert("Erro ao salvar palpites. Tente novamente.");
                  } finally {
                    setSubmitting(false);
                  }
                }}
                className="w-full py-4 rounded-xl font-black text-sm tracking-wide transition-all active:scale-95 flex items-center justify-center gap-2"
                style={{
                  background: canSubmit
                    ? "linear-gradient(135deg,#FBBF24 0%,#F59E0B 100%)"
                    : T.elevated(d),
                  color: canSubmit ? "#0C1120" : T.textMuted(d),
                  border: canSubmit ? "none" : `1px solid ${T.border(d)}`,
                  boxShadow: canSubmit
                    ? "0 4px 24px rgba(251,191,36,0.25)"
                    : "none",
                  cursor: canSubmit && !submitting ? "pointer" : "not-allowed",
                  opacity: submitting ? 0.7 : 1,
                }}
              >
                {submitting ? (
                  <motion.div
                    className="w-5 h-5 rounded-full border-2 border-slate-950/30 border-t-slate-950"
                    animate={{ rotate: 360 }}
                    transition={{
                      duration: 0.7,
                      repeat: Infinity,
                      ease: "linear",
                    }}
                  />
                ) : canSubmit ? (
                  <>
                    <Send size={16} /> Enviar Palpites
                  </>
                ) : (
                  `Faltam ${openMatches.length - filledCount} palpites`
                )}
              </button>
            )}
          </AnimatePresence>
        </div>
      ) : isCurrentRound && openMatches.length === 0 ? (
        <div
          className="py-8 text-center rounded-2xl border border-dashed"
          style={{ borderColor: T.border(d) }}
        >
          <p className="text-sm font-bold" style={{ color: T.text(d) }}>
            Nenhum jogo disponível para apostar no momento.
          </p>
          <p className="text-xs mt-1" style={{ color: T.textMuted(d) }}>
            Aguarde a próxima rodada!
          </p>
        </div>
      ) : null}
      {/* Success Overlay */}
      <AnimatePresence>
        {showSuccess && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center px-6 bg-slate-950/80 backdrop-blur-sm"
            onClick={() => setShowSuccess(false)}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="w-full max-w-sm rounded-[32px] p-8 text-center border overflow-hidden relative"
              style={{ background: T.surface(d), borderColor: T.border(d) }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-emerald-500" />

              <div className="w-20 h-20 rounded-3xl bg-emerald-500/10 flex items-center justify-center mx-auto mb-6">
                <Star
                  size={40}
                  className="text-emerald-400"
                  fill="currentColor"
                />
              </div>

              <h2
                className="text-2xl font-black mb-2"
                style={{ color: T.text(d) }}
              >
                Palpites Enviados!
              </h2>
              <p
                className="text-sm leading-relaxed mb-8"
                style={{ color: T.textMuted(d) }}
              >
                Seus palpites foram registrados e bloqueados para sua segurança.
                Boa sorte na rodada! 🍀
              </p>

              <button
                onClick={handleShareImage}
                disabled={sharingPending}
                className="w-full py-4 rounded-2xl font-black text-sm bg-emerald-500 text-slate-950 transition-all active:scale-95 shadow-lg shadow-emerald-500/20 flex items-center justify-center gap-2 mb-3 disabled:opacity-80"
              >
                {sharingPending ? (
                  <>
                    <svg
                      className="animate-spin"
                      width={18}
                      height={18}
                      viewBox="0 0 24 24"
                      fill="none"
                    >
                      <circle
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeOpacity=".3"
                      />
                      <path
                        d="M12 2a10 10 0 0 1 10 10"
                        stroke="currentColor"
                        strokeWidth="3"
                        strokeLinecap="round"
                      />
                    </svg>
                    Preparando imagem...
                  </>
                ) : (
                  <>
                    <Share2 size={18} /> Compartilhar Palpites
                  </>
                )}
              </button>

              <button
                onClick={() => setShowSuccess(false)}
                className="w-full py-3 rounded-2xl font-bold text-xs transition-all active:scale-95"
                style={{ color: T.textMuted(d) }}
              >
                Voltar
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
      {/* Hidden Share Card */}
      <div style={{ position: "absolute", left: "-9999px", top: 0 }}>
        <div
          ref={shareRef}
          className="p-8 w-[400px]"
          style={{ background: T.bg(d), color: T.text(d) }}
        >
          <div className="text-center mb-8">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-40 mb-1">
              Bolão dos Clássicos
            </p>
            <h2 className="text-2xl font-black tracking-tight">
              Meus Palpites
            </h2>
            {user?.apelido && (
              <p className="text-amber-400 font-bold text-sm mt-1">
                @{user.apelido}
              </p>
            )}
          </div>

          <div className="space-y-4">
            {activeMatches.map((m) => {
              const bet = activeScores[m.id];
              if (!bet) return null;
              return (
                <div
                  key={m.id}
                  className="p-4 rounded-2xl border"
                  style={{ background: T.surface(d), borderColor: T.border(d) }}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex-1 flex items-center gap-3">
                      <div 
                        className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 overflow-hidden border"
                        style={{ background: T.avatarBg(d), borderColor: T.border(d) }}
                      >
                        {m.homeLogo ? (
                          <img
                            src={m.homeLogo}
                            className="w-7 h-7 object-contain"
                            crossOrigin="anonymous"
                            alt=""
                          />
                        ) : (
                          <span className="text-[10px] font-black opacity-30" style={{ color: T.text(d) }}>
                            {m.home}
                          </span>
                        )}
                      </div>
                      <span className="text-sm font-bold" style={{ color: T.text(d) }}>{m.home}</span>
                    </div>

                    <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-amber-400/10 text-amber-400 border border-amber-400/20">
                      <span className="font-black text-base">{bet.home}</span>
                      <span className="text-xs opacity-40">×</span>
                      <span className="font-black text-base">{bet.away}</span>
                    </div>

                    <div className="flex-1 flex items-center gap-3 justify-end">
                      <span className="text-sm font-bold" style={{ color: T.text(d) }}>{m.away}</span>
                      <div 
                        className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0 overflow-hidden border"
                        style={{ background: T.avatarBg(d), borderColor: T.border(d) }}
                      >
                        {m.awayLogo ? (
                          <img
                            src={m.awayLogo}
                            className="w-7 h-7 object-contain"
                            crossOrigin="anonymous"
                            alt=""
                          />
                        ) : (
                          <span className="text-[10px] font-black opacity-30" style={{ color: T.text(d) }}>
                            {m.away}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div
            className="mt-8 pt-6 border-t text-center opacity-30"
            style={{ borderColor: T.border(d) }}
          >
            <p className="text-[10px] font-bold">
              Gerado em bolao-dos-classicos.vercel.app
            </p>
          </div>
        </div>
      </div>

    </div>
  );
}

// ─── Ranking ──────────────────────────────────────────────────────────────────

const podiumCfg = [
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

function Ranking({ isDark, user }: { isDark: boolean; user: any }) {
  const d = isDark;
  type RankUser = {
    id: number;
    name: string;
    points: number;
    position: number;
  };
  const [rankList, setRankList] = useState<RankUser[]>([]);
  const [loadingRank, setLoadingRank] = useState(true);
  const shareRef = React.useRef<HTMLDivElement>(null);
  const [sharing, setSharing] = useState(false);

  const handleShareRanking = async () => {
    if (!shareRef.current || sharing) return;
    setSharing(true);
    try {
      const dataUrl = await domToPng(shareRef.current, {
        scale: 2,
        backgroundColor: d ? "#0F172A" : "#FFFFFF",
      });
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const file = new File([blob], "ranking.png", { type: "image/png" });

      if (navigator.share) {
        await navigator.share({
          files: [file],
          title: "Ranking - Bolão dos Clássicos",
          text: `🏆 Confira o Top 10 do Bolão dos Clássicos!\n\n1º ${rankList[0]?.name} - ${rankList[0]?.points} pts\n2º ${rankList[1]?.name} - ${rankList[1]?.points} pts\n3º ${rankList[2]?.name} - ${rankList[2]?.points} pts`,
        });
      } else {
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSharing(false);
    }
  };

  useEffect(() => {
    (async () => {
      setLoadingRank(true);
      const [{ data: users }, { data: bets }] = await Promise.all([
        supabase
          .from("usuarios")
          .select("id, nome, apelido")
          .eq("status", "aprovado"),
        supabase.from("palpites").select("usuario_id, pontos").eq("pago", true),
      ]);
      if (!users) {
        setLoadingRank(false);
        return;
      }
      // Soma pontos por usuário (ignora null = jogo ainda não finalizado)
      const ptsByUser: Record<string, number> = {};
      const userIdsWithBets = new Set();
      
      bets?.forEach((b: any) => {
        userIdsWithBets.add(b.usuario_id);
        if (b.pontos != null)
          ptsByUser[b.usuario_id] = (ptsByUser[b.usuario_id] ?? 0) + b.pontos;
      });

      const ranked = users
        .filter((u: any) => userIdsWithBets.has(u.id))
        .map((u: any) => ({
          id: u.id,
          name: u.apelido ?? u.nome,
          points: ptsByUser[u.id] ?? 0,
        }))
        .sort((a: any, b: any) => b.points - a.points)
        .map((u: any, i: number) => ({ ...u, position: i + 1 }));
      setRankList(ranked);
      setLoadingRank(false);
    })();
  }, []);

  const podium = [];
  if (rankList.length >= 2) podium.push(rankList[1]); // 2nd
  if (rankList.length >= 1) podium.push(rankList[0]); // 1st
  if (rankList.length >= 3) podium.push(rankList[2]); // 3rd

  const rest = rankList.slice(3);
  const me = rankList.find((p) => p.id === user?.id);

  if (loadingRank)
    return (
      <div className="pb-4 space-y-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl p-4 h-14 animate-pulse border"
            style={{ background: T.surface(d), borderColor: T.border(d) }}
          />
        ))}
      </div>
    );

  return (
    <div className="pb-4 space-y-6">
      {/* Premium Podium */}
      {podium.length > 0 && (
        <div 
          className="rounded-[32px] p-6 mb-4 relative overflow-hidden border"
          style={{ 
            background: T.surface(d), 
            borderColor: T.border(d),
            boxShadow: d ? "none" : "0 10px 40px -10px rgba(0,0,0,0.05)"
          }}
        >
          <div className="flex items-end justify-center gap-2 sm:gap-4 pt-4">
            {podium.map((p) => {
              const pos = p.position; // 1, 2, or 3
              const config = podiumCfg[pos - 1];
              const isFirst = pos === 1;
              const isMe = p.id === user?.id;

              return (
                <motion.div
                  key={p.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: pos * 0.1 }}
                  className="flex flex-col items-center flex-1 min-w-0"
                >
                  <div className="relative mb-3">
                    {/* Avatar Container */}
                    <div 
                      className={`rounded-full flex items-center justify-center font-black relative z-10 overflow-hidden border-2
                        ${isFirst ? "w-20 h-20 text-base" : "w-14 h-14 text-xs"}
                      `}
                      style={{ 
                        background: isMe ? "rgba(251,191,36,0.1)" : T.avatarBg(d),
                        borderColor: isFirst ? "#FBBF24" : isMe ? "rgba(251,191,36,0.4)" : T.border(d),
                        color: isMe ? "#FBBF24" : T.text(d)
                      }}
                    >
                      {p.name.substring(0, 2).toUpperCase()}
                    </div>
                    
                    {/* Rank Badge */}
                    <div 
                      className="absolute -bottom-1 left-1/2 -translate-x-1/2 z-20 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black border shadow-sm"
                      style={{ 
                        background: config.color,
                        borderColor: "white",
                        color: "#000"
                      }}
                    >
                      {pos}
                    </div>
                  </div>

                  <div className="text-center w-full">
                    <p 
                      className={`font-black truncate px-1 ${isFirst ? "text-sm" : "text-[11px]"}`}
                      style={{ color: T.text(d) }}
                    >
                      {p.name}
                    </p>
                    <div className="flex items-center justify-center gap-1 mt-0.5">
                      <span 
                        className={`font-black ${isFirst ? "text-base" : "text-sm"}`}
                        style={{ color: isFirst ? "#FBBF24" : T.text(d) }}
                      >
                        {p.points}
                      </span>
                      <Flame size={isFirst ? 12 : 10} className="text-amber-500" />
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      )}

      {/* Your Position Highlight */}
      {me && me.position > 3 && (
        <div
          className="rounded-2xl p-4 flex items-center gap-4 border"
          style={{
            background: "rgba(251,191,36,0.07)",
            borderColor: "rgba(251,191,36,0.2)",
          }}
        >
          <div 
            className="w-10 h-10 rounded-full bg-amber-400/20 flex items-center justify-center text-amber-500 font-black text-sm"
          >
            {me.position}º
          </div>
          <div className="flex-1">
            <p className="text-amber-500 text-[10px] font-black uppercase tracking-widest">Sua posição</p>
            <p className="font-bold text-sm" style={{ color: T.text(d) }}>
              Você está em {me.position}º lugar
            </p>
          </div>
          <div className="text-right">
            <p className="font-black text-lg text-amber-500">{me.points}</p>
            <p className="text-[9px] font-bold opacity-40 uppercase" style={{ color: T.text(d) }}>Pontos</p>
          </div>
        </div>
      )}

      {/* List Content */}
      <div 
        className="rounded-[32px] overflow-hidden border"
        style={{ background: T.surface(d), borderColor: T.border(d) }}
      >
        {rest.map((p, i) => {
          const isMe = p.id === user?.id;
          return (
            <motion.div
              key={p.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.1 + i * 0.03 }}
              className="flex items-center gap-4 px-6 py-4 relative"
              style={{ 
                borderBottom: i === rest.length - 1 ? "none" : `1px solid ${T.border(d)}`,
                background: isMe ? "rgba(251,191,36,0.03)" : "transparent"
              }}
            >
              <span 
                className="text-xs font-black w-6 opacity-40"
                style={{ color: T.text(d) }}
              >
                {p.position}
              </span>
              
              <div 
                className="w-10 h-10 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 border"
                style={{ 
                  background: isMe ? "rgba(251,191,36,0.1)" : T.avatarBg(d),
                  color: isMe ? "#FBBF24" : T.avatarText(d),
                  borderColor: isMe ? "rgba(251,191,36,0.3)" : T.border(d)
                }}
              >
                {p.name.substring(0, 2).toUpperCase()}
              </div>

              <span 
                className="flex-1 text-sm font-bold truncate"
                style={{ color: T.text(d) }}
              >
                {p.name}
                {isMe && <span className="ml-2 text-[10px] text-amber-500 opacity-60">(Você)</span>}
              </span>

              <div className="flex items-center gap-1.5">
                <span className="font-black text-sm" style={{ color: T.text(d) }}>
                  {p.points}
                </span>
                <Flame size={12} className="text-amber-500 opacity-40" />
              </div>
            </motion.div>
          );
        })}
      </div>

      <div
        className="rounded-[32px] p-6 space-y-4 border"
        style={{ background: T.surface(d), borderColor: T.border(d) }}
      >
        <p
          className="text-xs font-bold uppercase tracking-wider flex items-center gap-2"
          style={{ color: T.textMuted(d) }}
        >
          <Star size={12} /> Regras de pontuação
        </p>
        <div className="space-y-2.5">
          {[
            {
              dot: "#FBBF24",
              label: "Placar exato",
              pts: "25 pts",
              color: "#FBBF24",
            },
            {
              dot: "#22C55E",
              label: "Vencedor / Empate",
              pts: "10 pts",
              color: "#22C55E",
            },
          ].map(({ dot, label, pts, color }) => (
            <div key={label} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ background: dot }}
                />
                <span className="text-sm" style={{ color: T.textMuted(d) }}>
                  {label}
                </span>
              </div>
              <span className="font-black text-sm" style={{ color }}>
                {pts}
              </span>
            </div>
          ))}
      </div>
    </div>

      <button
        onClick={handleShareRanking}
        disabled={sharing || rankList.length === 0}
        className="w-full py-4 rounded-xl font-black text-sm text-white flex items-center justify-center gap-2.5 transition-all active:scale-95 disabled:opacity-50 mt-2"
        style={{
          background: "linear-gradient(135deg,#6366F1 0%,#4F46E5 100%)",
          boxShadow: "0 4px 20px rgba(99,102,241,0.25)",
        }}
      >
        {sharing ? (
          <RefreshCw size={16} className="animate-spin" />
        ) : (
          <Share2 size={16} />
        )}
        {sharing ? "Gerando imagem..." : "Compartilhar Ranking (Top 10)"}
      </button>

      <div style={{ position: "absolute", left: "-9999px", top: 0 }}>
        <div
          ref={shareRef}
          className="p-8 w-[400px]"
          style={{ background: d ? "#0F172A" : "#FFFFFF", color: T.text(d) }}
        >
          <div className="text-center mb-10">
            <p className="text-[10px] font-black uppercase tracking-[0.3em] opacity-40 mb-2">
              Bolão dos Clássicos
            </p>
            <h2 className="text-3xl font-black tracking-tight">Ranking Geral</h2>
            <p className="text-amber-400 font-bold text-sm mt-1">Liderança da Rodada</p>
          </div>

          {/* Podium for Share */}
          {podium.length > 0 && (
            <div className="flex items-end justify-center gap-4 mb-10 px-2">
              {podium.map((p) => {
                const pos = p.position;
                const isFirst = pos === 1;
                return (
                  <div key={p.id} className="flex flex-col items-center flex-1">
                    <div className="relative mb-3">
                      <div 
                        className={`rounded-full border-2 flex items-center justify-center font-black overflow-hidden
                          ${isFirst ? "w-20 h-20 text-base" : "w-14 h-14 text-xs"}
                        `}
                        style={{ 
                          background: T.avatarBg(d),
                          borderColor: isFirst ? "#FBBF24" : T.border(d),
                          color: T.text(d)
                        }}
                      >
                        {p.name.substring(0, 2).toUpperCase()}
                      </div>
                      <div 
                        className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black border"
                        style={{ background: podiumCfg[pos-1].color, color: "#000", borderColor: "#FFF" }}
                      >
                        {pos}
                      </div>
                    </div>
                    <p className={`font-black truncate w-full text-center ${isFirst ? "text-sm" : "text-[11px]"}`}>{p.name}</p>
                    <p className="text-amber-400 font-black text-sm">{p.points} <span className="text-[8px] opacity-40">PTS</span></p>
                  </div>
                );
              })}
            </div>
          )}

          {/* List for Share */}
          <div className="space-y-2">
            {rest.slice(0, 7).map((p) => (
              <div
                key={p.id}
                className="flex items-center gap-4 px-5 py-3.5 rounded-2xl border"
                style={{
                  background: T.surface(d),
                  borderColor: T.border(d),
                }}
              >
                <span className="text-xs font-black w-6 opacity-30">{p.position}</span>
                <div
                  className="w-9 h-9 rounded-full flex items-center justify-center text-[10px] font-black shrink-0 border"
                  style={{ background: T.avatarBg(d), color: T.avatarText(d), borderColor: T.border(d) }}
                >
                  {p.name.substring(0, 2).toUpperCase()}
                </div>
                <span className="flex-1 font-bold text-sm truncate">{p.name}</span>
                <span className="font-black text-sm text-amber-400">
                  {p.points} <span className="text-[9px] opacity-40">PTS</span>
                </span>
              </div>
            ))}
          </div>

          <div
            className="mt-10 pt-6 border-t text-center opacity-30"
            style={{ borderColor: T.border(d) }}
          >
            <p className="text-[10px] font-bold tracking-widest">bolao-dos-classicos.vercel.app</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Informativo ──────────────────────────────────────────────────────────────

function Informativo({ isDark }: { isDark: boolean }) {
  const d = isDark;

  const handleShare = () => {
    const text = `🏆 *Bolão dos Clássicos*\n\n👥 Participantes: *${finance.participants}*\n💰 Arrecadação: *${fmt(gross)}*\n\n🎁 *Prêmios*\n🥇 1º Lugar: ${fmt(prizes.first)}\n🥈 2º Lugar: ${fmt(prizes.second)}`;
    window.open(
      `https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`,
      "_blank",
    );
  };

  const cards = [
    {
      label: "Arrecadação Bruta",
      value: fmt(gross),
      sub: `${finance.participants} × ${fmt(finance.ticketPrice)}`,
      color: "#22C55E",
      bg: "rgba(34,197,94,0.08)",
      border: "rgba(34,197,94,0.15)",
      Icon: TrendingUp,
    },
    {
      label: "Despesas",
      value: fmt(expenses.work + expenses.commission),
      sub: "15% trabalho + 10% comissão",
      color: "#F87171",
      bg: "rgba(248,113,113,0.08)",
      border: "rgba(248,113,113,0.15)",
      Icon: Users,
    },
  ];

  return (
    <div className="pb-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 items-start">
      {cards.map(({ label, value, sub, color, bg, border, Icon }, i) => (
        <motion.div
          key={label}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.08 }}
          className="rounded-2xl p-5 border"
          style={{ background: bg, borderColor: border }}
        >
          <div className="flex items-start justify-between mb-3">
            <p
              className="text-xs font-bold uppercase tracking-wider"
              style={{ color }}
            >
              {label}
            </p>
            <div
              className="p-2 rounded-xl"
              style={{ background: `${color}20` }}
            >
              <Icon size={14} style={{ color }} />
            </div>
          </div>
          <p className="font-black text-2xl" style={{ color: T.text(d) }}>
            {value}
          </p>
          <p className="text-xs mt-1" style={{ color: T.textMuted(d) }}>
            {sub}
          </p>
        </motion.div>
      ))}

      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.16 }}
        className="rounded-2xl p-5 border md:col-span-2 lg:col-span-1"
        style={{
          background: "rgba(99,102,241,0.08)",
          borderColor: "rgba(99,102,241,0.15)",
        }}
      >
        <div className="flex items-start justify-between mb-4">
          <p className="text-xs font-bold uppercase tracking-wider text-indigo-400">
            Premiação Líquida
          </p>
          <div
            className="p-2 rounded-xl"
            style={{ background: "rgba(99,102,241,0.12)" }}
          >
            <Trophy size={14} className="text-indigo-400" />
          </div>
        </div>
        <p className="font-black text-2xl mb-5" style={{ color: T.text(d) }}>
          {fmt(net)}
        </p>
        <div className="space-y-3">
          {[
            {
              pos: "1º",
              label: "Campeão",
              pct: "70%",
              val: prizes.first,
              color: "#FBBF24",
              bg: "rgba(251,191,36,0.1)",
            },
            {
              pos: "2º",
              label: "Vice",
              pct: "30%",
              val: prizes.second,
              color: "#94A3B8",
              bg: "rgba(148,163,184,0.08)",
            },
          ].map(({ pos, label, pct, val, color, bg }) => (
            <div
              key={pos}
              className="flex items-center justify-between p-3 rounded-xl"
              style={{ background: bg }}
            >
              <div className="flex items-center gap-3">
                <span
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black"
                  style={{ background: `${color}20`, color }}
                >
                  {pos}
                </span>
                <div>
                  <p
                    className="font-medium text-sm"
                    style={{ color: T.text(d) }}
                  >
                    {label}
                  </p>
                  <p className="text-xs" style={{ color: T.textMuted(d) }}>
                    {pct} do prêmio
                  </p>
                </div>
              </div>
              <p className="font-black text-base" style={{ color }}>
                {fmt(val)}
              </p>
            </div>
          ))}
        </div>
      </motion.div>

      <div
        className="rounded-xl px-4 py-3 flex items-center gap-3 border"
        style={{ background: T.surface(d), borderColor: T.border(d) }}
      >
        <Users
          size={14}
          className="shrink-0"
          style={{ color: T.textMuted(d) }}
        />
        <p className="text-sm" style={{ color: T.textMuted(d) }}>
          <span className="font-bold" style={{ color: T.text(d) }}>
            {finance.participants} participantes
          </span>{" "}
          confirmados
        </p>
      </div>

      <button
        onClick={handleShare}
        className="w-full py-4 rounded-xl font-black text-sm text-white flex items-center justify-center gap-2.5 transition-all active:scale-95"
        style={{
          background: "linear-gradient(135deg,#22C55E 0%,#16A34A 100%)",
          boxShadow: "0 4px 20px rgba(34,197,94,0.25)",
        }}
      >
        <Share2 size={16} /> Compartilhar no WhatsApp
      </button>
    </div>
  );
}

// ─── Manual Matches Admin ────────────────────────────────────────────────────

function ManualMatchesAdmin({
  league,
  isDark,
}: {
  league: League;
  isDark: boolean;
}) {
  const d = isDark;
  const [matches, setMatches] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const blank = {
    home_name: "",
    away_name: "",
    match_date: "",
    round_number: 1,
    home_score: "",
    away_score: "",
    status: "STATUS_SCHEDULED",
  };
  const [form, setForm] = useState(blank);

  const load = async () => {
    setLoading(true);
    const { data } = await supabase
      .from("partidas_manuais")
      .select("*")
      .eq("league", league)
      .order("match_date");
    setMatches(data ?? []);
    setLoading(false);
  };
  useEffect(() => {
    load();
  }, [league]);

  const save = async () => {
    if (!form.home_name || !form.away_name || !form.match_date) return;
    setSaving(true);
    const row = {
      id: editId ?? `${league}_${Date.now()}`,
      league,
      home_name: form.home_name,
      away_name: form.away_name,
      match_date: new Date(form.match_date).toISOString(),
      round_number: Number(form.round_number) || 1,
      home_score: form.home_score !== "" ? Number(form.home_score) : null,
      away_score: form.away_score !== "" ? Number(form.away_score) : null,
      status: form.home_score !== "" ? "STATUS_FINAL" : "STATUS_SCHEDULED",
    };
    await supabase.from("partidas_manuais").upsert(row);
    setForm(blank);
    setEditId(null);
    await load();
    setSaving(false);
  };

  const del = async (id: string) => {
    await supabase.from("partidas_manuais").delete().eq("id", id);
    load();
  };

  const edit = (m: any) => {
    setEditId(m.id);
    const dt = new Date(m.match_date);
    const local = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}T${String(dt.getHours()).padStart(2, "0")}:${String(dt.getMinutes()).padStart(2, "0")}`;
    setForm({
      home_name: m.home_name,
      away_name: m.away_name,
      match_date: local,
      round_number: m.round_number,
      home_score: m.home_score ?? "",
      away_score: m.away_score ?? "",
      status: m.status,
    });
  };

  const inp = (cls = "") =>
    `w-full px-3 py-2.5 rounded-xl text-xs font-medium outline-none ${cls}`;
  const inpStyle = {
    background: T.inputBg(d),
    border: `1px solid ${T.inputBdr(d)}`,
    color: T.text(d),
  };

  return (
    <div className="space-y-4">
      {/* Formulário */}
      <div
        className="p-4 rounded-2xl border space-y-3"
        style={{ background: T.surface(d), borderColor: T.border(d) }}
      >
        <p
          className="text-xs font-bold uppercase tracking-wider"
          style={{ color: T.textMuted(d) }}
        >
          {editId ? "Editar jogo" : "Adicionar jogo"}
        </p>
        <div className="grid grid-cols-2 gap-2">
          <input
            className={inp()}
            style={inpStyle}
            placeholder="Time da Casa"
            value={form.home_name}
            onChange={(e) =>
              setForm((f) => ({ ...f, home_name: e.target.value }))
            }
          />
          <input
            className={inp()}
            style={inpStyle}
            placeholder="Time Visitante"
            value={form.away_name}
            onChange={(e) =>
              setForm((f) => ({ ...f, away_name: e.target.value }))
            }
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="datetime-local"
            className={inp()}
            style={inpStyle}
            value={form.match_date}
            onChange={(e) =>
              setForm((f) => ({ ...f, match_date: e.target.value }))
            }
          />
          <input
            className={inp()}
            style={inpStyle}
            placeholder="Rodada nº"
            type="number"
            value={form.round_number}
            onChange={(e) =>
              setForm((f) => ({ ...f, round_number: Number(e.target.value) }))
            }
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input
            id="manual-home-score"
            className={inp()}
            style={inpStyle}
            placeholder="Placar Casa (opcional)"
            type="number"
            value={form.home_score}
            onChange={(e) => {
              const val = e.target.value;
              setForm((f) => ({ ...f, home_score: val }));
              if (val.length >= 1) {
                setTimeout(() => document.getElementById("manual-away-score")?.focus(), 10);
              }
            }}
          />
          <input
            id="manual-away-score"
            className={inp()}
            style={inpStyle}
            placeholder="Placar Visitante (opcional)"
            type="number"
            value={form.away_score}
            onChange={(e) =>
              setForm((f) => ({ ...f, away_score: e.target.value }))
            }
          />
        </div>
        <div className="flex gap-2">
          <button
            onClick={save}
            disabled={
              saving || !form.home_name || !form.away_name || !form.match_date
            }
            className="flex-1 py-2.5 rounded-xl text-xs font-black transition-all active:scale-95 disabled:opacity-50"
            style={{ background: LEAGUES[league].color, color: "#0C1120" }}
          >
            {saving
              ? "Salvando..."
              : editId
                ? "Salvar edição"
                : "Adicionar jogo"}
          </button>
          {editId && (
            <button
              onClick={() => {
                setForm(blank);
                setEditId(null);
              }}
              className="px-4 py-2.5 rounded-xl text-xs font-bold"
              style={{ background: T.elevated(d), color: T.textMuted(d) }}
            >
              Cancelar
            </button>
          )}
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="py-8 flex justify-center">
          <RefreshCw className="animate-spin text-amber-400" />
        </div>
      ) : matches.length === 0 ? (
        <div
          className="py-8 text-center rounded-2xl border border-dashed"
          style={{ borderColor: T.border(d) }}
        >
          <p className="text-sm" style={{ color: T.textMuted(d) }}>
            Nenhum jogo cadastrado ainda.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {matches.map((m) => (
            <div
              key={m.id}
              className="p-3 rounded-2xl border flex items-center justify-between gap-2"
              style={{ background: T.surface(d), borderColor: T.border(d) }}
            >
              <div className="flex-1 min-w-0">
                <p
                  className="text-xs font-black truncate"
                  style={{ color: T.text(d) }}
                >
                  {m.home_name} × {m.away_name}
                  {m.home_score != null && (
                    <span className="text-amber-400 ml-2">
                      {m.home_score}–{m.away_score}
                    </span>
                  )}
                </p>
                <p
                  className="text-[10px] mt-0.5"
                  style={{ color: T.textMuted(d) }}
                >
                  Rd {m.round_number} • {fmtDate(m.match_date)}
                </p>
              </div>
              <div className="flex gap-1.5 shrink-0">
                <button
                  onClick={() => edit(m)}
                  className="px-3 py-1.5 rounded-lg text-[10px] font-bold"
                  style={{ background: T.elevated(d), color: T.textMuted(d) }}
                >
                  Editar
                </button>
                <button
                  onClick={() => del(m.id)}
                  className="px-3 py-1.5 rounded-lg text-[10px] font-bold bg-red-500/10 text-red-400"
                >
                  Del
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Admin Panel ─────────────────────────────────────────────────────────────

function AdminPanel({ isDark }: { isDark: boolean }) {
  const d = isDark;
  const [admTab, setAdmTab] = useState<"dashboard" | "pending" | "bets" | "jogos" | "usuarios">(
    "dashboard",
  );
  const [pending, setPending] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [totalBets, setTotalBets] = useState(0);
  const [userTotal, setUserTotal] = useState(0);
  const [editingPasswordUser, setEditingPasswordUser] = useState<any | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState(false);

  // Controle de jogos selecionados
  const [selectedMatchIds, setSelectedMatchIds] = useState<string[]>([]);
  const [releasing, setReleasing] = useState(false);
  const [admLeague, setAdmLeague] = useState<League>("bra.1");

  // Re-usando lógica de rodada para mostrar os jogos no palpite do usuário
  const [anchorTs, setAnchorTs] = useState(() => todayMidnight());
  const { data: roundData, refetch: refetchRound } = useRodada(
    anchorTs,
    "bra.1",
  );

  // TheSportsDB para Série C no admin
  const [admShowPast, setAdmShowPast] = useState(false);
  const { data: serieCAdmData, loading: serieCAdmLoading } =
    useSerieCRodada(admShowPast);

  const admMatches =
    admLeague === "bra.3" ? serieCAdmData?.matches : roundData?.matches;

  const fetchData = async () => {
    setLoading(true);
    const { data: pendUsers } = await supabase
      .from("usuarios")
      .select("*")
      .eq("status", "pendente");
    const { data: appUsers } = await supabase
      .from("usuarios")
      .select("*")
      .eq("status", "aprovado");
    const { data: betsData } = await supabase
      .from("palpites")
      .select("usuario_id, pago");
    const { data: selMatches } = await supabase
      .from("jogos_selecionados")
      .select("match_id");

    const { data: allUsersData } = await supabase
      .from("usuarios")
      .select("id, nome, sobrenome, apelido, email, cargo, status")
      .in("status", ["aprovado", "pendente"])
      .not("cargo", "like", "dependente:%");

    const usersWithBets = new Set(
      (betsData || []).map((b: any) => b.usuario_id),
    );
    const userPaidMap: Record<string, boolean> = {};
    (betsData || []).forEach((b: any) => {
      if (b.pago) userPaidMap[b.usuario_id] = true;
    });

    setPending(pendUsers || []);
    setUsers((appUsers || [])
      .filter((u) => usersWithBets.has(u.id))
      .map(u => ({
        ...u,
        isPaid: !!userPaidMap[u.id]
      }))
    );
    setAllUsers(allUsersData || []);
    setTotalBets(betsData?.length || 0);
    setUserTotal(allUsersData?.filter((u: any) => u.status === "aprovado").length || 0);
    setSelectedMatchIds((selMatches || []).map((m) => m.match_id));
    setLoading(false);
  };

  const togglePayment = async (userId: string, currentPaid: boolean) => {
    setLoading(true);
    const { error } = await supabase
      .from("palpites")
      .update({ pago: !currentPaid })
      .eq("usuario_id", userId)
      .in("match_id", selectedMatchIds);
    
    if (error) {
      alert("Erro ao atualizar pagamento. Verifique se a coluna 'pago' existe na tabela 'palpites'.");
    }
    await fetchData();
    // Se estiver visualizando o usuário, atualiza o objeto local
    if (selectedUser && selectedUser.id === userId) {
      setSelectedUser((prev: any) => ({ ...prev, isPaid: !currentPaid }));
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, [admLeague]);

  const toggleMatchSelection = async (matchId: string) => {
    if (selectedMatchIds.includes(matchId)) {
      await supabase
        .from("jogos_selecionados")
        .delete()
        .eq("match_id", matchId)
        .eq("league", admLeague);
    } else {
      await supabase
        .from("jogos_selecionados")
        .insert({ match_id: matchId, liberado: true, league: admLeague });
    }
    fetchData();
  };

  const handleAction = async (
    id: string,
    newStatus: "aprovado" | "recusado",
  ) => {
    await supabase.from("usuarios").update({ status: newStatus }).eq("id", id);
    fetchData();
  };

  const handleDeleteBets = async () => {
    if (!confirmDelete) return;
    setDeleting(true);
    const { error, count } = await supabase
      .from("palpites")
      .delete({ count: "exact" })
      .eq("usuario_id", confirmDelete.id);
    setDeleting(false);
    if (error || count === 0) {
      alert(
        "Não foi possível excluir os palpites.\n\n" +
          "Execute no Supabase SQL Editor:\n" +
          "ALTER TABLE palpites DISABLE ROW LEVEL SECURITY;",
      );
      setConfirmDelete(null);
      return;
    }
    setConfirmDelete(null);
    setSelectedUser(null);
    fetchData();
  };

  if (loading)
    return (
      <div className="p-10 flex justify-center">
        <RefreshCw className="animate-spin text-amber-400" />
      </div>
    );

  return (
    <div className="pb-24 space-y-5">
      {admTab !== "dashboard" && (
        <button
          onClick={() => {
            setAdmTab("dashboard");
            setSelectedUser(null);
          }}
          className="flex items-center gap-2 px-5 py-3 rounded-[1.5rem] text-xs font-black transition-all active:scale-95 border shadow-sm"
          style={{
            background: T.surface(d),
            borderColor: T.border(d),
            color: T.text(d),
          }}
        >
          <ChevronLeft size={16} className="text-amber-400" />
          Voltar ao Início
        </button>
      )}

      <AnimatePresence mode="wait">
        {admTab === "dashboard" ? (
          <motion.div
            key="dashboard"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-6"
          >
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div
                className="p-5 rounded-[2rem] border"
                style={{ background: T.surface(d), borderColor: T.border(d) }}
              >
                <div className="w-10 h-10 rounded-2xl bg-amber-400/10 flex items-center justify-center mb-4">
                  <Users size={20} className="text-amber-400" />
                </div>
                <p
                  className="text-[10px] font-black uppercase tracking-wider opacity-40 mb-1"
                  style={{ color: T.text(d) }}
                >
                  Total Usuários
                </p>
                <p className="text-2xl font-black" style={{ color: T.text(d) }}>
                  {userTotal}
                </p>
              </div>

              <div
                className="p-5 rounded-[2rem] border"
                style={{ background: T.surface(d), borderColor: T.border(d) }}
              >
                <div className="w-10 h-10 rounded-2xl bg-indigo-400/10 flex items-center justify-center mb-4">
                  <Target size={20} className="text-indigo-400" />
                </div>
                <p
                  className="text-[10px] font-black uppercase tracking-wider opacity-40 mb-1"
                  style={{ color: T.text(d) }}
                >
                  Total Palpites
                </p>
                <p className="text-2xl font-black" style={{ color: T.text(d) }}>
                  {totalBets}
                </p>
              </div>
            </div>

            {/* Menu de Navegação do ADM */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {[
                {
                  key: "bets",
                  label: "Gerenciar Palpites",
                  sub: "Veja e edite palpites dos usuários",
                  icon: Target,
                  color: "text-amber-400",
                },
                {
                  key: "pending",
                  label: "Usuários Pendentes",
                  sub: `${pending.length} usuários aguardando aprovação`,
                  icon: Clock,
                  color: "text-indigo-400",
                  badge: pending.length,
                },
                {
                  key: "jogos",
                  label: "Rodada",
                  sub: `${selectedMatchIds.length} jogos selecionados`,
                  icon: Gamepad2,
                  color: "text-emerald-400",
                },
                {
                  key: "usuarios",
                  label: "Gerenciar Usuários",
                  sub: `${allUsers.length} usuários cadastrados`,
                  icon: Users,
                  color: "text-violet-400",
                },
              ].map((item) => (
                <button
                  key={item.key}
                  onClick={() => setAdmTab(item.key as any)}
                  className="flex items-center gap-4 p-4 rounded-[2rem] border transition-all active:scale-[0.98]"
                  style={{ background: T.surface(d), borderColor: T.border(d) }}
                >
                  <div
                    className={`w-12 h-12 rounded-2xl flex items-center justify-center bg-white/5 border relative`}
                    style={{ borderColor: T.border(d) }}
                  >
                    <item.icon size={20} className={item.color} />
                    {item.badge !== undefined && item.badge > 0 && (
                      <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500 text-white flex items-center justify-center text-[10px] font-black">
                        {item.badge}
                      </div>
                    )}
                  </div>
                  <div className="text-left flex-1 min-w-0">
                    <p
                      className="font-bold text-sm"
                      style={{ color: T.text(d) }}
                    >
                      {item.label}
                    </p>
                    <p
                      className="text-[10px] opacity-50 truncate"
                      style={{ color: T.text(d) }}
                    >
                      {item.sub}
                    </p>
                  </div>
                  <ChevronRight size={16} className="opacity-20" />
                </button>
              ))}
            </div>
          </motion.div>
        ) : admTab === "pending" ? (
          <motion.div
            key="pending"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
          >
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {pending.length === 0 ? (
              <div
                className="py-12 text-center rounded-2xl border border-dashed"
                style={{ borderColor: T.border(d) }}
              >
                <p className="text-sm" style={{ color: T.textMuted(d) }}>
                  Nenhuma solicitação pendente.
                </p>
              </div>
            ) : (
              pending.map((u) => (
                <motion.div
                  key={u.id}
                  className="rounded-2xl p-4 border"
                  style={{ background: T.surface(d), borderColor: T.border(d) }}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center font-black text-xs"
                        style={{ background: T.elevated(d), color: T.text(d) }}
                      >
                        {u.nome[0]}
                        {u.sobrenome[0]}
                      </div>
                      <div>
                        <p
                          className="font-bold text-sm"
                          style={{ color: T.text(d) }}
                        >
                          {u.nome} {u.sobrenome}
                        </p>
                        <p
                          className="text-xs"
                          style={{ color: T.textMuted(d) }}
                        >
                          @{u.apelido}
                        </p>
                      </div>
                    </div>
                    <div className="p-2 rounded-xl bg-amber-400/10">
                      <Users size={14} className="text-amber-400" />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleAction(u.id, "aprovado")}
                      className="flex-1 py-2.5 rounded-xl bg-emerald-500 text-slate-950 text-xs font-black active:scale-95"
                    >
                      Aprovar
                    </button>
                    <button
                      onClick={() => handleAction(u.id, "recusado")}
                      className="flex-1 py-2.5 rounded-xl bg-red-500/10 text-red-500 text-xs font-black border border-red-500/20 active:scale-95"
                    >
                      Recusar
                    </button>
                  </div>
                </motion.div>
              ))
            )}
            </div>
          </motion.div>
        ) : admTab === "bets" ? (
          <motion.div
            key="bets"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-4"
          >
            {selectedUser ? (
              <div className="space-y-4">
                <button
                  onClick={() => setSelectedUser(null)}
                  className="flex items-center gap-2 text-xs font-bold"
                  style={{ color: T.textMuted(d) }}
                >
                  <ChevronLeft size={14} /> Voltar para lista
                </button>

                <div
                  className="p-4 rounded-2xl border"
                  style={{ background: T.surface(d), borderColor: T.border(d) }}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="w-12 h-12 rounded-2xl flex items-center justify-center font-black text-sm"
                        style={{ background: T.elevated(d), color: T.text(d) }}
                      >
                        {selectedUser.nome[0]}
                        {selectedUser.sobrenome[0]}
                      </div>
                      <div>
                        <p
                          className="font-black text-base"
                          style={{ color: T.text(d) }}
                        >
                          {selectedUser.nome} {selectedUser.sobrenome}
                        </p>
                        <p
                          className="text-xs"
                          style={{ color: T.textMuted(d) }}
                        >
                          Palpites de @{selectedUser.apelido}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => togglePayment(selectedUser.id, selectedUser.isPaid)}
                        className="px-4 py-2 rounded-xl text-xs font-black transition-all active:scale-95 flex items-center gap-2"
                        style={{
                          background: selectedUser.isPaid ? "rgba(34,197,94,0.1)" : "rgba(251,191,36,0.1)",
                          color: selectedUser.isPaid ? "#22C55E" : "#FBBF24",
                          border: `1px solid ${selectedUser.isPaid ? "rgba(34,197,94,0.2)" : "rgba(251,191,36,0.2)"}`,
                        }}
                      >
                        {selectedUser.isPaid ? <CheckCircle2 size={14} /> : <Clock size={14} />}
                        {selectedUser.isPaid ? "Pago" : "Marcar Pago"}
                      </button>
                      <button
                        onClick={() => setConfirmDelete(selectedUser)}
                        className="px-3 py-2 rounded-xl text-xs font-black transition-all active:scale-95"
                        style={{
                          background: "rgba(248,113,113,0.1)",
                          color: "#F87171",
                          border: "1px solid rgba(248,113,113,0.2)",
                        }}
                      >
                        Excluir
                      </button>
                    </div>
                  </div>
                </div>

                <UserBetsList
                  userId={selectedUser.id}
                  roundMatches={[
                    ...(roundData?.matches || []),
                    ...(serieCAdmData?.matches || []),
                  ].filter((m) => selectedMatchIds.includes(m.id))}
                  isDark={d}
                  userName={selectedUser.apelido ?? selectedUser.nome}
                />
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {users.map((u) => (
                  <button
                    key={u.id}
                    onClick={() => setSelectedUser(u)}
                    className="flex items-center justify-between p-4 rounded-2xl border transition-all active:scale-[0.98]"
                    style={{
                      background: T.surface(d),
                      borderColor: T.border(d),
                    }}
                  >
                    <div className="flex items-center gap-3">
                      <div
                        className="w-10 h-10 rounded-xl flex items-center justify-center font-black text-xs"
                        style={{ background: T.elevated(d), color: T.text(d) }}
                      >
                        {u.nome[0]}
                        {u.sobrenome[0]}
                      </div>
                      <div className="text-left">
                        <p
                          className="font-bold text-sm"
                          style={{ color: T.text(d) }}
                        >
                          {u.nome} {u.sobrenome}
                        </p>
                        <p
                          className="text-xs"
                          style={{ color: T.textMuted(d) }}
                        >
                          @{u.apelido}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {u.isPaid ? (
                        <span className="px-2 py-0.5 rounded-lg bg-emerald-500/10 text-emerald-500 text-[9px] font-black uppercase border border-emerald-500/20">Pago</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-lg bg-amber-500/10 text-amber-500 text-[9px] font-black uppercase border border-amber-500/20">Pendente</span>
                      )}
                      <ChevronRight size={16} style={{ color: T.textMuted(d) }} />
                    </div>
                  </button>
                ))}
                {users.length === 0 && (
                  <p
                    className="text-center py-10 text-sm"
                    style={{ color: T.textMuted(d) }}
                  >
                    Nenhum usuário aprovado ainda.
                  </p>
                )}
              </div>
            )}
          </motion.div>
        ) : admTab === "jogos" ? (
          <motion.div
            key="jogos"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-4"
          >
            {/* Seletor de liga */}
            <div
              className="flex rounded-xl p-1 gap-1"
              style={{ background: T.surface(d), border: `1px solid ${T.border(d)}` }}
            >
              {(["bra.1", "bra.3"] as League[]).map((lg) => {
                const active = admLeague === lg;
                const cfg = LEAGUES[lg];
                return (
                  <button
                    key={lg}
                    onClick={() => setAdmLeague(lg)}
                    className="flex-1 py-2 rounded-lg text-xs font-black transition-all"
                    style={{
                      background: active ? cfg.color + "22" : "transparent",
                      border: active ? `1px solid ${cfg.color}55` : "1px solid transparent",
                      color: active ? cfg.color : T.textMuted(d),
                    }}
                  >
                    {cfg.label}
                  </button>
                );
              })}
            </div>

            <div className="p-4 rounded-2xl border bg-amber-400/5 border-amber-400/20">
              <p className="text-xs font-bold text-amber-400 uppercase mb-1">
                Curadoria de Rodada
              </p>
              <p className="text-[11px]" style={{ color: T.textMuted(d) }}>
                Fonte: {admLeague === "bra.3" ? "TheSportsDB" : "ESPN"} •{" "}
                {LEAGUES[admLeague]?.label ?? "Série ?"}
              </p>
            </div>

            {/* Lista de jogos */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {(admMatches ?? []).map((m) => {
                const isSelected = selectedMatchIds.includes(m.id);
                const leagueColor = LEAGUES[admLeague]?.color ?? "#64748B";
                return (
                  <div
                    key={m.id}
                    className="p-3 rounded-2xl border flex items-center justify-between"
                    style={{
                      background: isSelected
                        ? leagueColor + "0D"
                        : T.surface(d),
                      borderColor: isSelected
                        ? leagueColor + "4D"
                        : T.border(d),
                    }}
                  >
                    <div className="flex items-center gap-3 flex-1">
                      <div className="flex flex-col items-center gap-1">
                        {m.homeLogo ? (
                          <img src={m.homeLogo} className="w-5 h-5" alt="" />
                        ) : (
                          <div
                            className="w-5 h-5 rounded-full"
                            style={{ background: T.elevated(d) }}
                          />
                        )}
                        {m.awayLogo ? (
                          <img src={m.awayLogo} className="w-5 h-5" alt="" />
                        ) : (
                          <div
                            className="w-5 h-5 rounded-full"
                            style={{ background: T.elevated(d) }}
                          />
                        )}
                      </div>
                      <div className="min-w-0">
                        <p
                          className="text-xs font-black truncate"
                          style={{ color: T.text(d) }}
                        >
                          {m.homeName} × {m.awayName}
                        </p>
                        <p
                          className="text-[10px]"
                          style={{ color: T.textMuted(d) }}
                        >
                          {fmtDate(m.date)}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => toggleMatchSelection(m.id)}
                      className="px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
                      style={{
                        background: isSelected
                          ? leagueColor + "1A"
                          : T.elevated(d),
                        color: isSelected ? leagueColor : T.textMuted(d),
                        border: `1px solid ${isSelected ? leagueColor + "33" : T.border(d)}`,
                      }}
                    >
                      {isSelected ? "Incluído" : "Incluir"}
                    </button>
                  </div>
                );
              })}
              {(admMatches ?? []).length === 0 && (
                <p
                  className="text-center py-8 text-xs"
                  style={{ color: T.textMuted(d) }}
                >
                  Nenhum jogo encontrado.
                </p>
              )}
            </div>
          </motion.div>
        ) : admTab === "usuarios" ? (
          <motion.div
            key="usuarios"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-3"
          >
            <p className="text-[10px] font-black uppercase tracking-widest opacity-40 px-1" style={{ color: T.text(d) }}>
              {allUsers.length} usuários cadastrados
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {allUsers.map((u) => (
                <div
                  key={u.id}
                  className="p-4 rounded-[1.5rem] border flex items-center justify-between gap-3"
                  style={{ background: T.surface(d), borderColor: T.border(d) }}
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <div
                      className="w-10 h-10 rounded-xl flex items-center justify-center font-black text-xs shrink-0"
                      style={{ background: "rgba(251,191,36,0.12)", color: "#FBBF24" }}
                    >
                      {(u.apelido ?? u.nome ?? "?").substring(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <p className="font-black text-sm truncate" style={{ color: T.text(d) }}>
                        {u.apelido ?? u.nome}
                      </p>
                      <p className="text-[10px] truncate" style={{ color: T.textMuted(d) }}>
                        {u.email}
                      </p>
                      <span
                        className="text-[9px] font-black uppercase px-1.5 py-0.5 rounded-md"
                        style={{
                          background: u.status === "aprovado" ? "rgba(34,197,94,0.12)" : "rgba(251,191,36,0.12)",
                          color: u.status === "aprovado" ? "#22C55E" : "#FBBF24",
                        }}
                      >
                        {u.status}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={() => { setEditingPasswordUser(u); setNewPassword(""); setPasswordSuccess(false); }}
                    className="px-3 py-2 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all shrink-0"
                    style={{ background: T.elevated(d), color: T.textMuted(d), border: `1px solid ${T.border(d)}` }}
                  >
                    Senha
                  </button>
                </div>
              ))}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Modal: alterar senha */}
      <AnimatePresence>
        {editingPasswordUser && (
          <motion.div
            className="fixed inset-0 z-[200] flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setEditingPasswordUser(null)} />
            <motion.div
              className="relative z-10 w-full max-w-sm rounded-3xl p-6 space-y-5"
              style={{ background: T.surface(d), border: `1px solid ${T.border(d)}` }}
              initial={{ scale: 0.95, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.95, y: 20 }}
              transition={{ type: "spring", damping: 28, stiffness: 320 }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest opacity-40 mb-0.5" style={{ color: T.text(d) }}>Alterar senha</p>
                  <p className="font-black text-lg" style={{ color: T.text(d) }}>
                    {editingPasswordUser.apelido ?? editingPasswordUser.nome}
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: T.textMuted(d) }}>{editingPasswordUser.email}</p>
                </div>
                <button
                  onClick={() => setEditingPasswordUser(null)}
                  className="w-9 h-9 rounded-xl flex items-center justify-center"
                  style={{ background: T.elevated(d), border: `1px solid ${T.border(d)}` }}
                >
                  <X size={16} style={{ color: T.textMuted(d) }} />
                </button>
              </div>

              {passwordSuccess ? (
                <div className="flex flex-col items-center gap-3 py-4 text-center">
                  <div className="w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center">
                    <CheckCircle2 size={28} className="text-emerald-400" />
                  </div>
                  <p className="font-black text-sm text-emerald-400">Senha alterada!</p>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: T.textMuted(d) }}>
                      <Shield size={16} />
                    </span>
                    <input
                      type="password"
                      placeholder="Nova senha"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      className="w-full pl-10 pr-4 py-3.5 rounded-xl font-medium outline-none transition-all text-sm"
                      style={{ background: T.inputBg(d), border: `1.5px solid ${T.inputBdr(d)}`, color: T.text(d) }}
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setEditingPasswordUser(null)}
                      className="flex-1 py-3 rounded-xl font-bold text-sm"
                      style={{ background: T.elevated(d), color: T.textMuted(d), border: `1px solid ${T.border(d)}` }}
                    >
                      Cancelar
                    </button>
                    <button
                      disabled={!newPassword.trim() || savingPassword}
                      onClick={async () => {
                        if (!newPassword.trim()) return;
                        setSavingPassword(true);
                        const { error } = await supabase
                          .from("usuarios")
                          .update({ senha: newPassword.trim() })
                          .eq("id", editingPasswordUser.id);
                        setSavingPassword(false);
                        if (!error) {
                          setPasswordSuccess(true);
                          setTimeout(() => setEditingPasswordUser(null), 1500);
                        }
                      }}
                      className="flex-1 py-3 rounded-xl font-black text-sm transition-all active:scale-95 disabled:opacity-40"
                      style={{ background: "linear-gradient(135deg,#FBBF24 0%,#F59E0B 100%)", color: "#0C1120" }}
                    >
                      {savingPassword ? "Salvando..." : "Salvar"}
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Confirmation dialog — excluir palpites */}
      <AnimatePresence>
        {confirmDelete && (
          <motion.div
            className="fixed inset-0 z-[200] flex items-end justify-center pb-6 px-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
              onClick={() => setConfirmDelete(null)}
            />
            <motion.div
              className="relative z-10 w-full max-w-sm rounded-3xl p-6 space-y-5"
              style={{
                background: T.surface(d),
                border: `1px solid ${T.border(d)}`,
              }}
              initial={{ y: 60, scale: 0.95 }}
              animate={{ y: 0, scale: 1 }}
              exit={{ y: 60, scale: 0.95 }}
              transition={{ type: "spring", damping: 30, stiffness: 320 }}
            >
              <div className="flex flex-col items-center gap-3 text-center">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center"
                  style={{
                    background: "rgba(248,113,113,0.1)",
                    border: "1px solid rgba(248,113,113,0.2)",
                  }}
                >
                  <span className="text-2xl">🗑️</span>
                </div>
                <div>
                  <p
                    className="font-black text-base"
                    style={{ color: T.text(d) }}
                  >
                    Excluir palpites?
                  </p>
                  <p className="text-sm mt-1" style={{ color: T.textMuted(d) }}>
                    Todos os palpites de{" "}
                    <span className="font-bold" style={{ color: T.text(d) }}>
                      {confirmDelete.nome}
                    </span>{" "}
                    serão removidos permanentemente.
                  </p>
                </div>
              </div>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmDelete(null)}
                  disabled={deleting}
                  className="flex-1 py-3 rounded-2xl font-black text-sm transition-all active:scale-95"
                  style={{
                    background: T.elevated(d),
                    color: T.textMuted(d),
                    border: `1px solid ${T.border(d)}`,
                  }}
                >
                  Cancelar
                </button>
                <button
                  onClick={handleDeleteBets}
                  disabled={deleting}
                  className="flex-1 py-3 rounded-2xl font-black text-sm transition-all active:scale-95 flex items-center justify-center gap-2"
                  style={{
                    background: "linear-gradient(135deg,#F87171,#EF4444)",
                    color: "#fff",
                  }}
                >
                  {deleting ? (
                    <RefreshCw size={14} className="animate-spin" />
                  ) : null}
                  {deleting ? "Excluindo..." : "Excluir"}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function UserBetsList({
  userId,
  roundMatches,
  isDark,
  userName,
}: {
  userId: string;
  roundMatches: Match[];
  isDark: boolean;
  userName?: string;
}) {
  const d = isDark;
  const [bets, setBets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sharing, setSharing] = useState(false);
  const shareRef = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fetchBets = async () => {
      const { data } = await supabase
        .from("palpites")
        .select("*")
        .eq("usuario_id", userId);
      setBets(data || []);
      setLoading(false);
    };
    fetchBets();
  }, [userId]);

  const handleShare = async () => {
    if (!shareRef.current || sharing) return;
    setSharing(true);
    try {
      const dataUrl = await domToPng(shareRef.current, {
        backgroundColor: d ? "#0C1120" : "#F0F4F8",
        scale: 2,
        quality: 1,
      });
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const file = new File([blob], `palpites-${userName ?? "usuario"}.png`, { type: "image/png" });

      if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({
          files: [file],
          title: `Palpites de ${userName ?? "usuário"}`,
          text: `🏆 Palpites do Bolão dos Clássicos — ${userName ?? ""}`,
        });
      } else {
        const link = document.createElement("a");
        link.download = `palpites-${userName ?? "usuario"}.png`;
        link.href = URL.createObjectURL(blob);
        link.click();
        setTimeout(() => window.open("https://web.whatsapp.com/", "_blank"), 400);
      }
    } catch (err) {
      console.error("Erro ao compartilhar:", err);
    } finally {
      setSharing(false);
    }
  };

  if (loading)
    return (
      <div className="py-10 flex justify-center">
        <RefreshCw className="animate-spin text-amber-400" />
      </div>
    );

  return (
    <div className="space-y-4">
      {/* WhatsApp share button */}
      <div className="flex items-center justify-between">
        <p
          className="text-[10px] font-bold uppercase tracking-widest px-1"
          style={{ color: T.textMuted(d) }}
        >
          Palpites Registrados
        </p>
        <button
          onClick={handleShare}
          disabled={sharing}
          className="flex items-center gap-2 px-3 py-2 rounded-xl text-[11px] font-bold transition-all active:scale-95 disabled:opacity-50"
          style={{ background: "rgba(37,211,102,0.15)", color: "#25D366", border: "1px solid rgba(37,211,102,0.3)" }}
        >
          {sharing ? (
            <RefreshCw size={13} className="animate-spin" />
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
            </svg>
          )}
          {sharing ? "Gerando…" : "WhatsApp"}
        </button>
      </div>

      {/* Hidden share card — captured by domToPng */}
      <div
        ref={shareRef}
        style={{
          position: "absolute",
          left: "-9999px",
          top: 0,
          width: 420,
          background: d ? "#0C1120" : "#F0F4F8",
          padding: 24,
          borderRadius: 20,
          fontFamily: "system-ui, sans-serif",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 14,
            background: "linear-gradient(135deg,#FBBF24,#F59E0B)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 22,
          }}>⚽</div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 900, color: d ? "#F8FAFC" : "#0F172A" }}>
              {userName ?? "Palpiteiro"}
            </div>
            <div style={{ fontSize: 10, fontWeight: 700, color: "#FBBF24", textTransform: "uppercase", letterSpacing: 2 }}>
              Bolão dos Clássicos
            </div>
          </div>
        </div>

        {/* Match cards */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {roundMatches.map((m) => {
            const bet = bets.find((b: any) => b.match_id === m.id);
            const hasBet = !!bet;
            return (
              <div key={m.id} style={{
                background: d ? "rgba(255,255,255,0.05)" : "#FFFFFF",
                borderRadius: 14,
                border: `1.5px solid ${hasBet ? "rgba(251,191,36,0.35)" : "rgba(128,128,128,0.15)"}`,
                padding: "10px 14px",
                display: "flex",
                alignItems: "center",
                gap: 10,
              }}>
                {/* Home */}
                <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  {m.homeLogo ? (
                    <img src={m.homeLogo} style={{ width: 32, height: 32, objectFit: "contain" }} alt="" />
                  ) : (
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(128,128,128,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 900, color: d ? "#F8FAFC" : "#0F172A" }}>{m.home}</div>
                  )}
                  <span style={{ fontSize: 9, fontWeight: 700, color: d ? "#CBD5E1" : "#475569", textAlign: "center" }}>{m.homeName}</span>
                </div>

                {/* Score */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: 10,
                    background: hasBet ? "rgba(251,191,36,0.15)" : (d ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)"),
                    border: `1.5px solid ${hasBet ? "rgba(251,191,36,0.4)" : "rgba(128,128,128,0.2)"}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 18, fontWeight: 900,
                    color: hasBet ? "#FBBF24" : (d ? "#475569" : "#94A3B8"),
                  }}>{hasBet ? bet.gols_home : "—"}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                    <div style={{ width: 4, height: 4, borderRadius: 2, background: d ? "#475569" : "#CBD5E1" }} />
                    <div style={{ width: 4, height: 4, borderRadius: 2, background: d ? "#475569" : "#CBD5E1" }} />
                  </div>
                  <div style={{
                    width: 36, height: 36, borderRadius: 10,
                    background: hasBet ? "rgba(251,191,36,0.15)" : (d ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.05)"),
                    border: `1.5px solid ${hasBet ? "rgba(251,191,36,0.4)" : "rgba(128,128,128,0.2)"}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 18, fontWeight: 900,
                    color: hasBet ? "#FBBF24" : (d ? "#475569" : "#94A3B8"),
                  }}>{hasBet ? bet.gols_away : "—"}</div>
                </div>

                {/* Away */}
                <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
                  {m.awayLogo ? (
                    <img src={m.awayLogo} style={{ width: 32, height: 32, objectFit: "contain" }} alt="" />
                  ) : (
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: "rgba(128,128,128,0.2)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, fontWeight: 900, color: d ? "#F8FAFC" : "#0F172A" }}>{m.away}</div>
                  )}
                  <span style={{ fontSize: 9, fontWeight: 700, color: d ? "#CBD5E1" : "#475569", textAlign: "center" }}>{m.awayName}</span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div style={{ marginTop: 18, paddingTop: 14, borderTop: `1px solid ${d ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)"}`, textAlign: "center" }}>
          <span style={{ fontSize: 9, fontWeight: 700, color: "#FBBF24", textTransform: "uppercase", letterSpacing: 2 }}>
            🏆 Bolão dos Clássicos
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {roundMatches.map((m) => {
        const bet = bets.find((b: any) => b.match_id === m.id);
        const hasBet = !!bet;
        return (
          <div
            key={m.id}
            className="rounded-2xl border overflow-hidden"
            style={{
              background: T.surface(d),
              borderColor: hasBet ? "rgba(251,191,36,0.25)" : T.border(d),
            }}
          >
            <div className="px-4 pt-3 pb-1">
              <span className="text-[10px]" style={{ color: T.textMuted(d) }}>{fmtDate(m.date)}</span>
            </div>
            <div className="flex items-center px-4 pb-4 pt-2 gap-3">
              {/* Home */}
              <div className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
                <div
                  className="w-12 h-12 rounded-2xl flex items-center justify-center overflow-hidden"
                  style={{ background: T.avatarBg(d), border: `1px solid ${T.border(d)}` }}
                >
                  {m.homeLogo ? (
                    <img src={m.homeLogo} className="w-8 h-8 object-contain" alt="" />
                  ) : (
                    <span className="text-xs font-black" style={{ color: T.text(d) }}>{m.home}</span>
                  )}
                </div>
                <span className="text-[10px] font-bold truncate w-full text-center" style={{ color: T.text(d) }}>
                  {m.homeName}
                </span>
              </div>

              {/* Score */}
              <div className="flex items-center gap-2 shrink-0">
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center text-xl font-black"
                  style={{
                    background: hasBet ? "rgba(251,191,36,0.1)" : T.elevated(d),
                    border: `1.5px solid ${hasBet ? "rgba(251,191,36,0.3)" : T.inputBdr(d)}`,
                    color: hasBet ? "#FBBF24" : T.textMuted(d),
                  }}
                >
                  {hasBet ? bet.gols_home : "—"}
                </div>
                <div className="flex flex-col gap-0.5">
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: T.textMuted(d) }} />
                  <div className="w-1.5 h-1.5 rounded-full" style={{ background: T.textMuted(d) }} />
                </div>
                <div
                  className="w-11 h-11 rounded-xl flex items-center justify-center text-xl font-black"
                  style={{
                    background: hasBet ? "rgba(251,191,36,0.1)" : T.elevated(d),
                    border: `1.5px solid ${hasBet ? "rgba(251,191,36,0.3)" : T.inputBdr(d)}`,
                    color: hasBet ? "#FBBF24" : T.textMuted(d),
                  }}
                >
                  {hasBet ? bet.gols_away : "—"}
                </div>
              </div>

              {/* Away */}
              <div className="flex flex-col items-center gap-1.5 flex-1 min-w-0">
                <div
                  className="w-12 h-12 rounded-2xl flex items-center justify-center overflow-hidden"
                  style={{ background: T.avatarBg(d), border: `1px solid ${T.border(d)}` }}
                >
                  {m.awayLogo ? (
                    <img src={m.awayLogo} className="w-8 h-8 object-contain" alt="" />
                  ) : (
                    <span className="text-xs font-black" style={{ color: T.text(d) }}>{m.away}</span>
                  )}
                </div>
                <span className="text-[10px] font-bold truncate w-full text-center" style={{ color: T.text(d) }}>
                  {m.awayName}
                </span>
              </div>
            </div>

            {!hasBet && (
              <div className="px-4 pb-3">
                <p className="text-[10px] text-center" style={{ color: T.textMuted(d) }}>Sem palpite</p>
              </div>
            )}
          </div>
        );
      })}
      </div>
    </div>
  );
}

// ─── Analista IA View ────────────────────────────────────────────────────────
function AnalistaView({ 
  isDark, 
  onAnalyze 
}: { 
  isDark: boolean; 
  onAnalyze: (m: Match) => void 
}) {
  const d = isDark;
  const [anchorTs] = useState(() => todayMidnight());
  const espn = useRodada(anchorTs, "bra.1");
  const seriec = useSerieCRodada(false);
  
  const [liberatedIds, setLiberatedIds] = useState<string[]>([]);
  const [liberatedLoading, setLiberatedLoading] = useState(true);

  useEffect(() => {
    const fetchLiberated = async () => {
      const { data } = await supabase
        .from("jogos_selecionados")
        .select("match_id")
        .eq("liberado", true);
      if (data) setLiberatedIds(data.map((x: any) => x.match_id));
      setLiberatedLoading(false);
    };
    fetchLiberated();
  }, []);

  const loading = espn.loading || seriec.loading || liberatedLoading;
  const matches = [
    ...(espn.data?.matches ?? []).map(m => ({ ...m, league: "bra.1" as const })),
    ...(seriec.data?.matches ?? []).map(m => ({ ...m, league: "bra.3" as const }))
  ].filter(m => liberatedIds.includes(m.id) && m.status !== "STATUS_FINAL");

  if (loading) return (
    <div className="py-10 flex flex-col items-center gap-3 opacity-40">
      <RefreshCw size={24} className="animate-spin text-amber-400" />
      <span className="text-[10px] font-black uppercase tracking-widest">Escaneando Rodada...</span>
    </div>
  );

  if (matches.length === 0) return (
    <div className="py-16 text-center space-y-4">
      <div className="w-16 h-16 rounded-3xl bg-white/5 border border-white/5 flex items-center justify-center mx-auto">
        <Bot size={28} className="text-amber-400 opacity-20" />
      </div>
      <p className="text-sm font-bold opacity-30" style={{ color: T.text(d) }}>Nenhum jogo disponível para análise no momento.</p>
    </div>
  );

  return (
    <div className="space-y-3 pb-20">
      <div className="p-4 rounded-2xl bg-amber-400/5 border border-amber-400/10 mb-4">
        <p className="text-[10px] font-black text-amber-400 uppercase tracking-widest mb-1">Dica do Analista</p>
        <p className="text-xs opacity-60 leading-relaxed" style={{ color: T.text(d) }}>
          Escolha um confronto abaixo para receber uma análise técnica profunda baseada no momento atual das equipes.
        </p>
      </div>

      {matches.map((match, idx) => (
        <motion.div
          key={match.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: idx * 0.05 }}
          className="p-4 rounded-2xl border flex items-center justify-between gap-4 transition-all active:scale-[0.98]"
          style={{ background: T.surface(d), borderColor: T.border(d) }}
        >
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="flex -space-x-2 shrink-0">
               <img src={match.homeLogo} className="w-8 h-8 object-contain relative z-10 bg-white rounded-full p-1 border border-white/10 shadow-sm" alt="" />
               <img src={match.awayLogo} className="w-8 h-8 object-contain relative z-0 bg-white rounded-full p-1 border border-white/5 shadow-sm" alt="" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-black truncate" style={{ color: T.text(d) }}>{match.homeName} × {match.awayName}</p>
              <p className="text-[9px] font-bold opacity-40 uppercase" style={{ color: T.text(d) }}>{fmtDate(match.date)}</p>
            </div>
          </div>
          
          <button
            onClick={() => onAnalyze(match)}
            className="px-4 py-2 rounded-xl bg-amber-400 text-slate-950 text-[10px] font-black uppercase tracking-wider shadow-lg shadow-amber-400/10 active:scale-90 transition-all"
          >
            Analisar
          </button>
        </motion.div>
      ))}
    </div>
  );
}


// ─── App ──────────────────────────────────────────────────────────────────────

const tabs = [
  { key: "apostar", label: "Palpites", Icon: Target },
  { key: "ranking", label: "Ranking", Icon: Trophy },
  // { key: "analista", label: "Analista IA", Icon: Bot },
  { key: "admin", label: "Painel", Icon: Shield, adminOnly: true },
] as const;

type Tab = "apostar" | "ranking" | "analista" | "admin";

const headerContent: Record<Tab, { title: string; sub: string }> = {
  apostar: { title: "", sub: "Faça seus palpites" },
  ranking: { title: "Ranking Geral", sub: "Classificação ao vivo" },
  analista: { title: "Analista Pro", sub: "Inteligência de Dados" },
  admin: { title: "Administrador", sub: "Gerenciar rodadas" },
};

export default function App() {
  const [tab, setTab] = useState<Tab>("apostar");
  const [auth, setAuth] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [isDark, setIsDark] = useState(false);
  const [roundNumber, setRoundNumber] = useState<number | string>("...");
  const [totalUserPoints, setTotalUserPoints] = useState(0);
  const [aiMatch, setAiMatch] = useState<Match | null>(null);

  const [profiles, setProfiles] = useState<any[]>([]);
  const [activeProfile, setActiveProfile] = useState<any>(null);
  const [profilesWithBets, setProfilesWithBets] = useState<Set<string>>(new Set());
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showAddProfile, setShowAddProfile] = useState(false);
  const [newProfileName, setNewProfileName] = useState("");
  const [addingProfile, setAddingProfile] = useState(false);
  const [customAlert, setCustomAlert] = useState<{ title: string; message: string; type: 'error' | 'success' } | null>(null);
  const [profileToDelete, setProfileToDelete] = useState<any>(null);
  const [deletingProfile, setDeletingProfile] = useState(false);
  const [showUserSettings, setShowUserSettings] = useState(false);

  const fetchProfileBetStatus = async (pIds: string[]) => {
    try {
      const { data: sel } = await supabase.from("jogos_selecionados").select("match_id");
      const matchIds = (sel || []).map(m => m.match_id);
      
      if (matchIds.length > 0) {
        const { data: bets } = await supabase
          .from("palpites")
          .select("usuario_id")
          .in("usuario_id", pIds)
          .in("match_id", matchIds);
        
        setProfilesWithBets(new Set(bets?.map(b => b.usuario_id)));
      }
    } catch (err) {
      console.error("Error fetching profile bet status:", err);
    }
  };

  useEffect(() => {
    const savedUser = localStorage.getItem("bolao_user");
    if (savedUser) {
      const u = JSON.parse(savedUser);
      setUser(u);
      setActiveProfile(u);
      setAuth(true);
      setIsDark(u.dark_mode === true);

      supabase
        .from("usuarios")
        .select("*")
        .eq("cargo", `dependente:${u.id}`)
        .eq("status", "aprovado")
        .then(({ data }) => {
          const allProfiles = [u, ...(data || [])];
          setProfiles(allProfiles);
          fetchProfileBetStatus(allProfiles.map(p => p.id));
        });
    }
    // Esconde a splash screen nativa assim que o app carregar
    SplashScreen.hide();
  }, []);

  const toggleTheme = async () => {
    const next = !isDark;
    setIsDark(next);
    if (user?.id) {
      const updated = { ...user, dark_mode: next };
      localStorage.setItem("bolao_user", JSON.stringify(updated));
      setUser(updated);
      await supabase
        .from("usuarios")
        .update({ dark_mode: next })
        .eq("id", user.id);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("bolao_user");
    setAuth(false);
    setUser(null);
  };
  const [showStandings, setShowStandings] = useState(false);
  const d = isDark;

  if (!auth)
    return (
      <Login
        onLogin={() => {
          const savedUser = localStorage.getItem("bolao_user");
          if (savedUser) {
            const u = JSON.parse(savedUser);
            setUser(u);
            setActiveProfile(u);
            setIsDark(u.dark_mode === true);
            supabase
              .from("usuarios")
              .select("*")
              .eq("cargo", `dependente:${u.id}`)
              .eq("status", "aprovado")
              .then(({ data }) => {
                const allProfiles = [u, ...(data || [])];
                setProfiles(allProfiles);
                fetchProfileBetStatus(allProfiles.map((p: any) => p.id));
              });
          }
          setAuth(true);
        }}
        isDark={isDark}
        toggleTheme={toggleTheme}
      />
    );

  const title =
    tab === "apostar"
      ? roundNumber === "?" || roundNumber === "..."
        ? "Rodada"
        : `Rodada ${roundNumber}`
      : headerContent[tab].title;
  const sub = headerContent[tab].sub;

  const isAdmin = user?.cargo?.toLowerCase() === "adm";

  return (
    <div
      className="h-[100dvh] flex flex-col md:flex-row font-sans transition-colors duration-300"
      style={{ background: T.bg(d) }}
      onClick={() => { if (showProfileMenu) setShowProfileMenu(false); }}
    >
      {/* ── Sidebar desktop ── */}
      <aside
        className="hidden md:flex flex-col shrink-0 w-56 h-full z-20 transition-colors duration-300"
        style={{
          background: T.headerBg(d),
          borderRight: `1px solid ${T.border(d)}`,
        }}
      >
        {/* Logo */}
        <div className="px-5 py-6 flex items-center gap-3 shrink-0">
          <div
            className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: "linear-gradient(135deg,#FBBF24 0%,#F59E0B 100%)" }}
          >
            <Swords size={18} className="text-slate-950" />
          </div>
          <div className="min-w-0">
            <p className="font-black text-[13px] leading-tight truncate" style={{ color: T.text(d) }}>
              Bolão dos
            </p>
            <p className="font-black text-[13px] leading-tight text-amber-400 truncate">
              Clássicos
            </p>
          </div>
        </div>

        {/* User card — clickable, opens profile menu */}
        <div className="mx-3 mb-5 relative">
          <button
            onClick={() => setShowProfileMenu(!showProfileMenu)}
            className="w-full p-3 rounded-2xl flex items-center gap-2.5 transition-all"
            style={{ background: T.surface(d), border: `1px solid ${T.border(d)}` }}
          >
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center font-black text-xs shrink-0"
              style={{ background: "rgba(251,191,36,0.15)", color: "#FBBF24" }}
            >
              {(activeProfile?.apelido ?? activeProfile?.nome ?? "U").substring(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1 text-left">
              <p className="font-black text-xs truncate" style={{ color: T.text(d) }}>
                {activeProfile?.apelido ?? activeProfile?.nome ?? "Jogador"}
              </p>
              <span
                className="text-[10px] font-black px-1.5 py-0.5 rounded-md"
                style={{
                  background: totalUserPoints > 0 ? "rgba(251,191,36,0.15)" : d ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.07)",
                  color: totalUserPoints > 0 ? "#FBBF24" : T.textMuted(d),
                }}
              >
                {totalUserPoints} pts
              </span>
            </div>
            <ChevronDown size={14} style={{ color: T.textMuted(d), flexShrink: 0, transform: showProfileMenu ? "rotate(180deg)" : "rotate(0deg)", transition: "transform 0.2s" }} />
          </button>

          {/* Profile dropdown — abre para direita da sidebar */}
          <AnimatePresence>
            {showProfileMenu && (
              <motion.div
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -8 }}
                className="absolute top-0 left-[calc(100%+8px)] w-56 rounded-2xl p-2 shadow-2xl z-50 border"
                style={{ background: T.surface(d), borderColor: T.border(d) }}
              >
                <p className="text-[9px] font-black uppercase tracking-widest px-3 py-1.5 opacity-40" style={{ color: T.text(d) }}>
                  Perfis
                </p>
                {profiles.map((p) => (
                  <button
                    key={p.id}
                    onClick={() => { setActiveProfile(p); setShowProfileMenu(false); }}
                    className="w-full flex items-center justify-between p-3 rounded-xl transition-colors hover:bg-black/5"
                    style={{ background: activeProfile?.id === p.id ? (d ? "rgba(251,191,36,0.08)" : "rgba(251,191,36,0.06)") : "transparent" }}
                  >
                    <span className="font-bold text-sm" style={{ color: T.text(d) }}>
                      {p.apelido ?? p.nome}
                    </span>
                    <div className="flex items-center gap-2">
                      {profilesWithBets.has(p.id) && <Target size={13} className="text-amber-500/50" />}
                      {activeProfile?.id === p.id && <CheckCircle2 size={15} className="text-amber-500" />}
                    </div>
                  </button>
                ))}
                <div className="my-1 border-t" style={{ borderColor: T.border(d) }} />
                <button
                  onClick={() => { setShowProfileMenu(false); setShowAddProfile(true); }}
                  className="w-full flex items-center gap-2 p-3 rounded-xl transition-colors hover:bg-black/5"
                >
                  <Plus size={15} className="text-emerald-500" />
                  <span className="font-bold text-sm text-emerald-500">Novo Palpiteiro</span>
                </button>
                <button
                  onClick={() => { setShowProfileMenu(false); setShowUserSettings(true); }}
                  className="w-full flex items-center gap-2 p-3 rounded-xl transition-colors hover:bg-black/5"
                >
                  <Settings size={15} style={{ color: T.textMuted(d) }} />
                  <span className="font-bold text-sm" style={{ color: T.text(d) }}>Configurações</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Nav items */}
        <nav className="flex-1 px-3 space-y-1 overflow-y-auto">
          {tabs.map(({ key, label, Icon, adminOnly }: any) => {
            if (adminOnly && !isAdmin) return null;
            const active = tab === key;
            return (
              <button
                key={key}
                onClick={() => setTab(key as Tab)}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all text-left"
                style={{
                  background: active ? (d ? "rgba(251,191,36,0.12)" : "rgba(251,191,36,0.1)") : "transparent",
                  border: active ? `1px solid rgba(251,191,36,0.25)` : "1px solid transparent",
                  color: active ? "#FBBF24" : T.textMuted(d),
                }}
              >
                <Icon size={17} strokeWidth={active ? 2.5 : 1.8} />
                <span className="font-bold text-sm">{label}</span>
              </button>
            );
          })}
        </nav>

        {/* Bottom actions */}
        <div className="px-3 pb-6 pt-3 space-y-1 border-t shrink-0" style={{ borderColor: T.border(d) }}>
          <button
            onClick={() => setShowStandings(true)}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all"
            style={{ color: T.textMuted(d) }}
          >
            <List size={17} strokeWidth={1.8} />
            <span className="font-bold text-sm">Classificação</span>
          </button>
          <button
            onClick={toggleTheme}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all"
            style={{ color: T.textMuted(d) }}
          >
            {d ? <Sun size={17} strokeWidth={1.8} /> : <Moon size={17} strokeWidth={1.8} />}
            <span className="font-bold text-sm">{d ? "Tema claro" : "Tema escuro"}</span>
          </button>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all"
            style={{ color: T.textMuted(d) }}
          >
            <LogOut size={17} strokeWidth={1.8} />
            <span className="font-bold text-sm">Sair</span>
          </button>
        </div>
      </aside>

      {/* ── Content column (header + main + nav) ── */}
      <div className="flex-1 flex flex-col min-w-0">

      {/* Header — mobile only */}
      <header
        className="md:hidden shrink-0 px-5 pt-10 pb-4 z-10 transition-colors duration-300"
        style={{
          background: T.headerBg(d),
          backdropFilter: "blur(20px)",
          borderBottom: `1px solid ${T.border(d)}`,
        }}
      >
        <div className={`flex items-center justify-between ${tab === 'admin' ? 'max-w-6xl' : 'max-w-4xl'} mx-auto transition-all duration-300`}>
          <div className="flex-1 min-w-0">
            <AnimatePresence mode="wait">
              <motion.div
                key={tab + roundNumber}
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.18 }}
              >
                {tab === "apostar" ? (
                  <>
                    <p
                      className="text-xs font-bold uppercase tracking-widest mb-0.5"
                      style={{ color: T.textMuted(d) }}
                    >
                      Olá,
                    </p>
                    <div className="flex items-center gap-2 relative">
                      <button
                        onClick={() => setShowProfileMenu(!showProfileMenu)}
                        className="flex items-center gap-1.5 focus:outline-none"
                      >
                        <h1
                          className="font-black text-2xl tracking-tight"
                          style={{ color: T.text(d) }}
                        >
                          {activeProfile?.apelido ?? activeProfile?.nome ?? "Jogador"}
                        </h1>
                        <ChevronDown size={20} style={{ color: T.textMuted(d) }} />
                      </button>

                      <AnimatePresence>
                        {showProfileMenu && (
                          <motion.div
                            initial={{ opacity: 0, y: -10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            className="absolute top-full mt-2 w-56 rounded-2xl p-2 shadow-2xl z-50 border"
                            style={{
                              background: T.surface(d),
                              borderColor: T.border(d),
                            }}
                          >
                            {profiles.map((p) => (
                              <button
                                key={p.id}
                                onClick={() => {
                                  setActiveProfile(p);
                                  setShowProfileMenu(false);
                                }}
                                className="w-full flex items-center justify-between p-3 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                              >
                                <span className="font-bold text-sm" style={{ color: T.text(d) }}>
                                  {p.apelido ?? p.nome}
                                </span>
                                  <div className="flex items-center gap-2">
                                    {profilesWithBets.has(p.id) && (
                                      <Target size={14} className="text-amber-500/50" />
                                    )}
                                    {activeProfile?.id === p.id && (
                                      <CheckCircle2 size={16} className="text-amber-500" />
                                    )}
                                  </div>
                                </button>
                            ))}
                            <div className="my-1 border-t" style={{ borderColor: T.border(d) }} />
                            <button
                              onClick={() => {
                                setShowProfileMenu(false);
                                setShowAddProfile(true);
                              }}
                              className="w-full flex items-center gap-2 p-3 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                            >
                              <Plus size={16} className="text-emerald-500" />
                              <span className="font-bold text-sm text-emerald-500">
                                Novo Palpiteiro
                              </span>
                            </button>
                            <button
                              onClick={() => {
                                setShowProfileMenu(false);
                                setShowUserSettings(true);
                              }}
                              className="w-full flex items-center gap-2 p-3 rounded-xl hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                            >
                              <Settings size={16} style={{ color: T.textMuted(d) }} />
                              <span className="font-bold text-sm" style={{ color: T.text(d) }}>
                                Configurações
                              </span>
                            </button>
                          </motion.div>
                        )}
                      </AnimatePresence>
                      <span
                        className="px-2 py-0.5 rounded-lg text-xs font-black"
                        style={{
                          background:
                            totalUserPoints > 0
                              ? "rgba(251,191,36,0.15)"
                              : d
                                ? "rgba(255,255,255,0.07)"
                                : "rgba(0,0,0,0.07)",
                          border: `1px solid ${totalUserPoints > 0 ? "rgba(251,191,36,0.35)" : d ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.1)"}`,
                          color: totalUserPoints > 0 ? "#FBBF24" : T.textMuted(d),
                        }}
                      >
                        {totalUserPoints} pts
                      </span>
                    </div>
                    <p
                      className="text-xs mt-0.5"
                      style={{ color: T.textMuted(d) }}
                    >
                      Faça seus palpites
                    </p>
                  </>
                ) : (
                  <>
                    <p
                      className="text-xs font-bold uppercase tracking-widest mb-0.5"
                      style={{ color: T.textMuted(d) }}
                    >
                      {activeProfile?.apelido
                        ? `Ola, ${activeProfile.apelido}`
                        : "Bolão dos Clássicos"}
                    </p>
                    <h1
                      className="font-black text-2xl tracking-tight"
                      style={{ color: T.text(d) }}
                    >
                      {title}
                    </h1>
                    <p
                      className="text-xs mt-0.5"
                      style={{ color: T.textMuted(d) }}
                    >
                      {sub}
                    </p>
                  </>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="flex items-center gap-2 ml-3 shrink-0">
            <button
              onClick={() => setShowStandings(true)}
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-90"
              style={{
                background: T.surface(d),
                border: `1px solid ${T.border(d)}`,
              }}
              title="Classificação Brasileirão"
            >
              <List size={15} style={{ color: T.textMuted(d) }} />
            </button>
            <button
              onClick={toggleTheme}
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-90"
              style={{
                background: T.surface(d),
                border: `1px solid ${T.border(d)}`,
              }}
            >
              {d ? (
                <Sun size={15} className="text-amber-400" />
              ) : (
                <Moon size={15} className="text-slate-500" />
              )}
            </button>
            <button
              onClick={handleLogout}
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-90"
              style={{
                background: T.surface(d),
                border: `1px solid ${T.border(d)}`,
              }}
            >
              <LogOut size={15} style={{ color: T.textMuted(d) }} />
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <div className={`px-4 pt-4 pb-2 ${tab === 'admin' ? 'max-w-6xl' : 'max-w-4xl'} mx-auto transition-all duration-300`}>
          <AnimatePresence mode="wait">
            {tab === "apostar" && (
              <motion.div
                key="apostar"
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12 }}
                transition={{ duration: 0.2 }}
              >
                <Apostar
                  user={activeProfile}
                  isDark={isDark}
                  onRoundLoad={setRoundNumber}
                  onPointsChange={setTotalUserPoints}
                />
              </motion.div>
            )}
            {tab === "ranking" && (
              <motion.div
                key="ranking"
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12 }}
                transition={{ duration: 0.2 }}
              >
                <Ranking isDark={isDark} user={activeProfile} />
              </motion.div>
            )}
            {tab === "analista" && (
              <motion.div
                key="analista"
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12 }}
                transition={{ duration: 0.2 }}
              >
                <AnalistaView 
                  isDark={isDark} 
                  onAnalyze={(m) => setAiMatch(m)}
                />
              </motion.div>
            )}
            {tab === "admin" && (
              <motion.div
                key="admin"
                initial={{ opacity: 0, x: -12 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 12 }}
                transition={{ duration: 0.2 }}
              >
                <AdminPanel isDark={isDark} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Bottom nav — mobile only */}
      <nav
        className="md:hidden shrink-0 z-50 transition-colors duration-300"
        style={{
          background: T.navBg(d),
          backdropFilter: "blur(20px)",
          borderTop: `1px solid ${T.border(d)}`,
        }}
      >
        <div className="flex justify-around items-center pt-2 pb-6 px-4 max-w-lg mx-auto">
          {tabs.map(({ key, label, Icon, adminOnly }: any) => {
            if (adminOnly && user?.cargo?.toLowerCase() !== "adm") return null;
            const active = tab === key;
            return (
              <button
                key={key}
                onClick={() => setTab(key as Tab)}
                className="flex flex-col items-center gap-1 px-5 py-2 rounded-xl transition-all relative"
                style={{ minWidth: 72 }}
              >
                {active && (
                  <motion.div
                    layoutId="tabBg"
                    className="absolute inset-0 rounded-xl"
                    style={{
                      background: d
                        ? "rgba(251,191,36,0.1)"
                        : "rgba(251,191,36,0.12)",
                    }}
                    transition={{ type: "spring", bounce: 0.2, duration: 0.4 }}
                  />
                )}
                <Icon
                  size={20}
                  strokeWidth={active ? 2.5 : 1.8}
                  style={{
                    color: active ? "#FBBF24" : T.textMuted(d),
                    position: "relative",
                  }}
                />
                <span
                  className="text-[10px] font-bold tracking-wide relative"
                  style={{ color: active ? "#FBBF24" : T.textMuted(d) }}
                >
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      </div>{/* end content column */}

      {/* Classificação Brasileirão */}
      {showStandings && (
        <StandingsModal
          isDark={isDark}
          onClose={() => setShowStandings(false)}
        />
      )}

      {/* Modal de Análise IA */}
      {aiMatch && (
        <AIAnalysisModal
          match={aiMatch}
          onClose={() => setAiMatch(null)}
          isDark={isDark}
        />
      )}

      {/* Add Profile Modal */}
      {showAddProfile && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-full max-w-sm rounded-3xl p-6 shadow-2xl"
            style={{ background: T.surface(d), border: `1px solid ${T.border(d)}` }}
          >
            <h3 className="font-black text-xl mb-2" style={{ color: T.text(d) }}>
              Novo Perfil de Palpite
            </h3>
            <p className="text-sm mb-4" style={{ color: T.textMuted(d) }}>
              Crie um novo apelido para registrar palpites independentes nesta conta.
            </p>
            <input
              type="text"
              placeholder="Digite o apelido"
              value={newProfileName}
              onChange={(e) => setNewProfileName(e.target.value)}
              className="w-full px-4 py-3 rounded-xl font-medium outline-none transition-all mb-4"
              style={{
                background: T.inputBg(d),
                border: `1px solid ${T.inputBdr(d)}`,
                color: T.text(d),
              }}
            />
            <div className="flex gap-2">
              <button
                onClick={() => setShowAddProfile(false)}
                className="flex-1 py-3 rounded-xl font-bold text-sm"
                style={{ background: T.inputBg(d), color: T.text(d) }}
              >
                Cancelar
              </button>
              <button
                onClick={async () => {
                  if (!newProfileName.trim() || addingProfile) return;
                  setAddingProfile(true);
                  const newProfile = {
                    nome: user.nome,
                    sobrenome: user.sobrenome,
                    apelido: newProfileName.trim(),
                    email: `${user.id}+${Date.now()}@dependent.local`,
                    senha: user.senha,
                    cargo: `dependente:${user.id}`,
                    status: "aprovado"
                  };
                  const { data, error } = await supabase.from("usuarios").insert([newProfile]).select().single();
                  setAddingProfile(false);
                  if (!error && data) {
                    setProfiles([...profiles, data]);
                    setActiveProfile(data);
                    setShowAddProfile(false);
                    setNewProfileName("");
                  } else {
                    if (error?.code === "23505") {
                      setCustomAlert({ title: "Apelido em Uso", message: "Este apelido já está em uso por outro jogador. Por favor, escolha outro.", type: 'error' });
                    } else {
                      setCustomAlert({ title: "Erro", message: "Ocorreu um erro ao criar o perfil. Tente novamente.", type: 'error' });
                    }
                  }
                }}
                disabled={!newProfileName.trim() || addingProfile}
                className="flex-1 py-3 rounded-xl font-bold text-sm bg-amber-500 text-black shadow-lg shadow-amber-500/20"
                style={{ opacity: !newProfileName.trim() || addingProfile ? 0.5 : 1 }}
              >
                {addingProfile ? "Criando..." : "Criar Perfil"}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Delete Profile Modal */}
      <AnimatePresence>
        {profileToDelete && (
          <div className="fixed inset-0 z-[250] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="w-full max-w-sm rounded-3xl p-6 shadow-2xl"
              style={{ background: T.surface(d), border: `1px solid ${T.border(d)}` }}
            >
              <div className="w-12 h-12 rounded-full flex items-center justify-center bg-red-500/10 text-red-500 mb-4 mx-auto">
                <Trash2 size={24} />
              </div>
              <h3 className="font-black text-xl mb-2 text-center" style={{ color: T.text(d) }}>
                Excluir Perfil?
              </h3>
              <p className="text-sm mb-6 text-center" style={{ color: T.textMuted(d) }}>
                Tem certeza que deseja excluir o perfil <strong>{profileToDelete.apelido}</strong>? Todos os palpites associados a este perfil também serão apagados.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => setProfileToDelete(null)}
                  disabled={deletingProfile}
                  className="flex-1 py-3 rounded-xl font-bold text-sm transition-all active:scale-95"
                  style={{ background: T.inputBg(d), color: T.text(d) }}
                >
                  Cancelar
                </button>
                <button
                  onClick={async () => {
                    setDeletingProfile(true);
                    // Inativa o usuário para sumir do sistema
                    const { error } = await supabase.from("usuarios").update({ status: "inativo" }).eq("id", profileToDelete.id);
                    // Deleta os palpites vinculados para não somar no contador total do admin
                    await supabase.from("palpites").delete().eq("usuario_id", profileToDelete.id);
                    setDeletingProfile(false);
                    if (error) {
                      setCustomAlert({ title: "Erro na Exclusão", message: "Ocorreu um erro ao excluir o perfil. Tente novamente.", type: 'error' });
                    } else {
                      setProfiles(profiles.filter(p => p.id !== profileToDelete.id));
                      if (activeProfile?.id === profileToDelete.id) {
                        setActiveProfile(user);
                      }
                      setProfileToDelete(null);
                      setCustomAlert({ title: "Perfil Excluído", message: "O perfil foi removido com sucesso.", type: 'success' });
                    }
                  }}
                  disabled={deletingProfile}
                  className="flex-1 py-3 rounded-xl font-bold text-sm bg-red-500 text-white shadow-lg shadow-red-500/20 flex justify-center items-center gap-2 transition-all active:scale-95"
                  style={{ opacity: deletingProfile ? 0.5 : 1 }}
                >
                  {deletingProfile ? (
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  ) : "Sim, Excluir"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Custom Alert Modal */}
      <AnimatePresence>
        {customAlert && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 10 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 10 }}
              className="w-full max-w-sm rounded-3xl p-6 shadow-2xl flex flex-col items-center text-center"
              style={{ background: T.surface(d), border: `1px solid ${T.border(d)}` }}
            >
              {customAlert.type === 'error' ? (
                <div className="w-16 h-16 rounded-full flex items-center justify-center bg-red-500/10 text-red-500 mb-4">
                  <AlertTriangle size={32} />
                </div>
              ) : (
                <div className="w-16 h-16 rounded-full flex items-center justify-center bg-emerald-500/10 text-emerald-500 mb-4">
                  <CheckCircle2 size={32} />
                </div>
              )}
              <h3 className="font-black text-xl mb-2" style={{ color: T.text(d) }}>
                {customAlert.title}
              </h3>
              <p className="text-sm mb-6" style={{ color: T.textMuted(d) }}>
                {customAlert.message}
              </p>
              <button
                onClick={() => setCustomAlert(null)}
                className="w-full py-3 rounded-xl font-bold text-sm transition-all active:scale-95 shadow-lg"
                style={{
                  background: customAlert.type === 'error' ? '#EF4444' : '#10B981',
                  color: '#FFFFFF',
                  boxShadow: customAlert.type === 'error' ? '0 10px 15px -3px rgba(239, 68, 68, 0.2)' : '0 10px 15px -3px rgba(16, 185, 129, 0.2)'
                }}
              >
                Entendi
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* User Settings Modal */}
      <AnimatePresence>
        {showUserSettings && (
          <div className="fixed inset-0 z-[200] flex flex-col bg-black/60 backdrop-blur-md">
            <motion.div
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="mt-auto w-full max-w-lg mx-auto rounded-t-[40px] p-8 pb-12 shadow-2xl"
              style={{ background: T.bg(d) }}
            >
              <div className="flex justify-between items-center mb-8">
                <h2 className="font-black text-3xl tracking-tight" style={{ color: T.text(d) }}>
                  Configurações
                </h2>
                <button
                  onClick={() => setShowUserSettings(false)}
                  className="w-10 h-10 rounded-full flex items-center justify-center bg-black/5 dark:bg-white/5"
                  style={{ color: T.text(d) }}
                >
                  <X size={24} />
                </button>
              </div>

              <div className="space-y-6">
                <div>
                  <h3 className="text-xs font-black uppercase tracking-widest mb-4" style={{ color: T.textMuted(d) }}>
                    Gerenciar Perfis
                  </h3>
                  <div className="space-y-3">
                    {profiles.map((p) => (
                      <div
                        key={p.id}
                        className="p-4 rounded-2xl border flex items-center justify-between"
                        style={{ background: T.surface(d), borderColor: T.border(d) }}
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-500 flex items-center justify-center font-black">
                            {p.apelido?.[0]?.toUpperCase() ?? p.nome?.[0]?.toUpperCase()}
                          </div>
                          <div>
                            <p className="font-bold text-sm" style={{ color: T.text(d) }}>
                              {p.apelido ?? p.nome}
                            </p>
                            <p className="text-[10px] uppercase font-black tracking-wider" style={{ color: T.textMuted(d) }}>
                              {p.id === user.id ? "Perfil Principal" : "Perfil Adicional"}
                            </p>
                          </div>
                        </div>

                        {p.id !== user.id && (
                          <button
                            onClick={() => {
                              setProfileToDelete(p);
                            }}
                            className="p-3 text-red-500 hover:bg-red-500/10 rounded-xl transition-colors"
                          >
                            <Trash2 size={18} />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="pt-4 border-t" style={{ borderColor: T.border(d) }}>
                  <button
                    onClick={() => {
                      localStorage.removeItem("bolao_user");
                      window.location.reload();
                    }}
                    className="w-full py-4 rounded-2xl font-black text-sm bg-red-500/10 text-red-500 hover:bg-red-500/20 transition-colors"
                  >
                    Sair da Conta
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
