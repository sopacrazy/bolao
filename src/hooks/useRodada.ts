
import { useState, useEffect, useMemo } from "react";
import { Match, RodadaData, League } from "../types";
import { ymd, todayMidnight } from "../utils/format";
import { supabase } from "../lib/supabase";


const CACHE_KEY = "bolao_espn_v4";
const CACHE_TTL = 90 * 1000; // 90s

const espnBase = (lg: League) =>
  `https://site.api.espn.com/apis/site/v2/sports/soccer/${lg}/scoreboard`;

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

function filterNextRound(events: any[], onlyFirst: boolean): { events: any[]; roundNumber: number | string } {
  if (!events.length) return { events: [], roundNumber: "?" };

  if (!onlyFirst) {
    const rn = eventRound(events[0]) ?? "?";
    return { events, roundNumber: rn };
  }

  const groups = new Map<number, any[]>();
  for (const ev of events) {
    const rn = eventRound(ev);
    if (rn !== null) {
      if (!groups.has(rn)) groups.set(rn, []);
      groups.get(rn)!.push(ev);
    }
  }

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

    const latestTs = Math.max(
      ...evs.map((ev) => new Date(ev.date ?? 0).getTime()),
    );
    const ONE_DAY = 24 * 60 * 60 * 1000;
    if (Date.now() - latestTs < ONE_DAY) {
      const rn = eventRound(evs[0]) ?? key;
      return { events: evs, roundNumber: rn };
    }
  }

  const lastKey = sortedKeys[sortedKeys.length - 1];
  const lastEvs = groups.get(lastKey)!;
  const latestTs = Math.max(...lastEvs.map((ev) => new Date(ev.date ?? 0).getTime()));
  const ONE_DAY = 24 * 60 * 60 * 1000;
  if (Date.now() - latestTs < ONE_DAY) {
    const rn = eventRound(lastEvs[0]) ?? lastKey;
    return { events: lastEvs, roundNumber: rn };
  }

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

export function useRodada(anchorTs: number, league: League = "bra.1") {
  const [data, setData] = useState<RodadaData | null>(null);
  const [dbResults, setDbResults] = useState<Record<string, { homeScore: string; awayScore: string }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const fetchDbResults = () => {
      supabase
        .from("resultados_rodada")
        .select("match_id, home_score, away_score")
        .then(({ data, error }) => {
          if (error || !data?.length) return;
          const map: Record<string, { homeScore: string; awayScore: string }> = {};
          data.forEach((r: any) => {
            if (r.home_score != null && r.away_score != null) {
              map[r.match_id] = { homeScore: String(r.home_score), awayScore: String(r.away_score) };
            }
          });
          setDbResults(map);
        });


    };
    fetchDbResults();
    const id = setInterval(fetchDbResults, 30000);
    return () => clearInterval(id);
  }, []);


  const load = async (force = false) => {
    setLoading(true);
    setError(false);
    const cacheKey = `${CACHE_KEY}_${league}_${anchorTs}`;

    if (!force) {
      try {
        const raw = localStorage.getItem(cacheKey);
        if (raw) {
          const { payload, ts } = JSON.parse(raw);
          if (Date.now() - ts < CACHE_TTL) {
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
        const future = new Date(anchor.getTime() + 30 * 86400000);
        result = await espnDateRange(anchor, future, league, true);

        if (result.matches.length === 0) {
          const res = await fetch(espnBase(league));
          const json = await res.json();
          const { events, roundNumber } = filterNextRound(json.events ?? [], true);
          result = { matches: parseMatches(events), roundNumber };
        }
      } else {
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
  const enrichedData = useMemo(() => {
    if (!data) return null;
    return {
      ...data,
      matches: data.matches.map(m => {
        const db = dbResults[m.id];
        if (db) {
          return { ...m, homeScore: db.homeScore, awayScore: db.awayScore, status: "STATUS_FINAL" };
        }
        return m;
      })

    };
  }, [data, dbResults]);

  return { data: enrichedData, loading, error, refetch: () => load(true) };
}

const TSDB_BASE = "https://www.thesportsdb.com/api/v1/json/123";
const TSDB_LEAGUE = "4625";
const TSDB_CACHE = "bolao_seriesc_v2";
const TSDB_TTL = 30 * 60 * 1000; // 30 min

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
      status: TSDB_STATUS[ev.strStatus ?? "NS"] ?? "STATUS_SCHEDULED",
      clock: ev.strProgress ?? "",
    };
  });
}

export function useSerieCRodada(showPast: boolean) {
  const [data, setData] = useState<RodadaData | null>(null);
  const [dbResults, setDbResults] = useState<Record<string, { homeScore: string; awayScore: string }>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    const fetchDbResults = () => {
      supabase
        .from("resultados_rodada")
        .select("match_id, home_score, away_score")
        .then(({ data, error }) => {
          if (error || !data?.length) return;
          const map: Record<string, { homeScore: string; awayScore: string }> = {};
          data.forEach((r: any) => {
            if (r.home_score != null && r.away_score != null) {
              map[r.match_id] = { homeScore: String(r.home_score), awayScore: String(r.away_score) };
            }
          });
          setDbResults(map);
        });


    };
    fetchDbResults();
    const id = setInterval(fetchDbResults, 30000);
    return () => clearInterval(id);
  }, []);


  const load = async (force = false) => {
    setLoading(true);
    setError(false);
    const cacheKey = `${TSDB_CACHE}_${showPast ? "past" : "next"}_v2`;

    if (!force) {
      try {
        const raw = localStorage.getItem(cacheKey);
        if (raw) {
          const { payload, ts } = JSON.parse(raw);
          if (Date.now() - ts < TSDB_TTL) {
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

      const matches = parseTsdbEvents(allEvents);
      const result: RodadaData = { matches, roundNumber };
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
  const enrichedData = useMemo(() => {
    if (!data) return null;
    return {
      ...data,
      matches: data.matches.map(m => {
        const db = dbResults[m.id];
        if (db) {
          return { ...m, homeScore: db.homeScore, awayScore: db.awayScore, status: "STATUS_FINAL" };
        }
        return m;
      })

    };
  }, [data, dbResults]);

  return { data: enrichedData, loading, error, refetch: () => load(true) };
}
