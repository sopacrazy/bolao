import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Trophy, Target, Info, Share2, LogIn, AlertCircle,
  Crown, Medal, Award, Users, TrendingUp, ChevronRight,
  Star, Flame, Shield, Swords, Sun, Moon, LogOut, RefreshCw, Wifi, WifiOff,
} from 'lucide-react';

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
}

interface RodadaData {
  matches: Match[];
  roundNumber: number | string;
}

// ─── ESPN API ─────────────────────────────────────────────────────────────────

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/bra.1/scoreboard';
const CACHE_KEY = 'bolao_espn_v3';
const CACHE_TTL = 60 * 60 * 1000; // 1h

// Formata Date → "YYYYMMDD"
function ymd(d: Date) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function parseMatches(events: any[]): Match[] {
  return events.map(ev => {
    const comp  = ev.competitions?.[0] ?? {};
    const comps = comp.competitors ?? [];
    const home  = comps.find((c: any) => c.homeAway === 'home') ?? comps[0] ?? {};
    const away  = comps.find((c: any) => c.homeAway === 'away') ?? comps[1] ?? {};
    return {
      id:        ev.id,
      home:      home.team?.abbreviation ?? '?',
      away:      away.team?.abbreviation ?? '?',
      homeName:  home.team?.shortDisplayName ?? home.team?.displayName ?? '?',
      awayName:  away.team?.shortDisplayName ?? away.team?.displayName ?? '?',
      homeLogo:  home.team?.logo ?? '',
      awayLogo:  away.team?.logo ?? '',
      homeScore: home.score ?? '-',
      awayScore: away.score ?? '-',
      date:      ev.date ?? '',
      status:    ev.status?.type?.name ?? 'STATUS_SCHEDULED',
      clock:     ev.status?.displayClock ?? '',
    };
  });
}

async function espnFetchUrl(url: string): Promise<{ matches: Match[]; roundNumber: number | string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('ESPN error');
  const json = await res.json();
  const roundNumber: number | string =
    json.week?.number ??
    json.leagues?.[0]?.season?.type?.week?.number ??
    '?';
  return { matches: parseMatches(json.events ?? []), roundNumber };
}

function useRodada() {
  const [data,    setData]    = useState<RodadaData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(false);

  const fetch_ = async (force = false) => {
    setLoading(true);
    setError(false);

    if (!force) {
      try {
        const raw = localStorage.getItem(CACHE_KEY);
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
      // Monta intervalo: hoje até +14 dias
      const today  = new Date();
      const future = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);
      const dateRange = `${ymd(today)}-${ymd(future)}`;

      // 1ª tentativa: jogos nos próximos 14 dias
      let result = await espnFetchUrl(`${ESPN_BASE}?dates=${dateRange}`);

      // 2ª tentativa: se vazio, busca padrão da ESPN (pode ter jogos ao vivo)
      if (result.matches.length === 0) {
        result = await espnFetchUrl(ESPN_BASE);
      }

      // 3ª tentativa: ainda vazio, alarga para 30 dias
      if (result.matches.length === 0) {
        const far = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);
        result = await espnFetchUrl(`${ESPN_BASE}?dates=${ymd(today)}-${ymd(far)}`);
      }

      localStorage.setItem(CACHE_KEY, JSON.stringify({ payload: result, ts: Date.now() }));
      setData(result);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetch_(); }, []);

  return { data, loading, error, refetch: () => fetch_(true) };
}

// ─── Static ranking + finance (unchanged) ────────────────────────────────────

const mockRanking = Array.from({ length: 59 }, (_, i) => ({
  id: i + 1,
  name: `Participante ${i + 1}`,
  points: Math.floor(Math.random() * 200) + 50,
}))
  .sort((a, b) => b.points - a.points)
  .map((p, i) => ({ ...p, position: i + 1 }));
mockRanking[0].name = 'Marcos';

const finance = { participants: 59, ticketPrice: 30 };
const gross    = finance.participants * finance.ticketPrice;
const expenses = { work: gross * 0.15, commission: gross * 0.1 };
const net      = gross - expenses.work - expenses.commission;
const prizes   = { first: net * 0.7, second: net * 0.3 };
const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// ─── Theme helpers ────────────────────────────────────────────────────────────

const T = {
  bg:         (d: boolean) => d ? '#060B14'                : '#F0F4F8',
  surface:    (d: boolean) => d ? 'rgba(13,21,37,0.95)'    : 'rgba(255,255,255,0.95)',
  elevated:   (d: boolean) => d ? 'rgba(19,30,48,0.95)'    : 'rgba(248,250,252,1)',
  border:     (d: boolean) => d ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.08)',
  borderSoft: (d: boolean) => d ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.05)',
  text:       (d: boolean) => d ? '#F1F5F9'                : '#0F172A',
  textMuted:  (d: boolean) => d ? '#64748B'                : '#64748B',
  headerBg:   (d: boolean) => d ? 'rgba(6,11,20,0.85)'    : 'rgba(240,244,248,0.85)',
  navBg:      (d: boolean) => d ? 'rgba(9,14,24,0.95)'    : 'rgba(255,255,255,0.97)',
  inputBg:    (d: boolean) => d ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)',
  inputBdr:   (d: boolean) => d ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.1)',
  rankItem:   (d: boolean) => d ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.8)',
  rankBdr:    (d: boolean) => d ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.06)',
  avatarBg:   (d: boolean) => d ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.06)',
  avatarText: (d: boolean) => d ? '#94A3B8'                : '#64748B',
};

// ─── Status badge helper ──────────────────────────────────────────────────────

function StatusBadge({ status, clock }: { status: string; clock: string }) {
  if (status === 'STATUS_IN_PROGRESS' || status === 'STATUS_HALFTIME') {
    return (
      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full"
        style={{ background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)' }}>
        <motion.div className="w-1.5 h-1.5 rounded-full bg-emerald-400"
          animate={{ opacity: [1, 0.3, 1] }} transition={{ duration: 1.2, repeat: Infinity }} />
        <span className="text-[10px] font-bold text-emerald-400">
          {status === 'STATUS_HALFTIME' ? 'Intervalo' : clock || 'Ao Vivo'}
        </span>
      </div>
    );
  }
  if (status === 'STATUS_FINAL') {
    return (
      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
        style={{ background: 'rgba(148,163,184,0.1)', color: '#64748B', border: '1px solid rgba(148,163,184,0.2)' }}>
        Encerrado
      </span>
    );
  }
  return (
    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
      style={{ background: 'rgba(251,191,36,0.1)', color: '#FBBF24', border: '1px solid rgba(251,191,36,0.2)' }}>
      Agendado
    </span>
  );
}

// ─── Match date formatter ─────────────────────────────────────────────────────

function fmtDate(iso: string) {
  if (!iso) return '';
  const d = new Date(iso);
  return d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' })
    + ' • '
    + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

// ─── Team Logo ────────────────────────────────────────────────────────────────

function TeamLogo({ src, abbr, isDark }: { src: string; abbr: string; isDark: boolean }) {
  const [err, setErr] = useState(false);
  return (
    <div className="w-12 h-12 rounded-2xl flex items-center justify-center font-black text-sm overflow-hidden"
      style={{ background: T.avatarBg(isDark), border: `1px solid ${T.border(isDark)}`, color: T.text(isDark) }}>
      {src && !err
        ? <img src={src} alt={abbr} className="w-8 h-8 object-contain" onError={() => setErr(true)} />
        : abbr}
    </div>
  );
}

// ─── Login ────────────────────────────────────────────────────────────────────

function Login({ onLogin, isDark, toggleTheme }: { onLogin: () => void; isDark: boolean; toggleTheme: () => void }) {
  const [user, setUser]       = useState('');
  const [pass, setPass]       = useState('');
  const [error, setError]     = useState(false);
  const [loading, setLoading] = useState(false);
  const d = isDark;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    await new Promise(r => setTimeout(r, 600));
    setLoading(false);
    if (user.toLowerCase() === 'marcos' && pass === '123') {
      onLogin();
    } else {
      setError(true);
      setTimeout(() => setError(false), 3000);
    }
  };

  return (
    <div className="min-h-[100dvh] flex flex-col items-center justify-center px-6 relative overflow-hidden transition-colors duration-300"
      style={{ background: d ? 'linear-gradient(160deg,#060B14 0%,#0A1428 50%,#060B14 100%)' : 'linear-gradient(160deg,#E8EDF5 0%,#F0F4F8 50%,#E8EDF5 100%)' }}>

      <button onClick={toggleTheme}
        className="absolute top-10 right-6 p-2.5 rounded-xl transition-all active:scale-90 z-10"
        style={{ background: T.surface(d), border: `1px solid ${T.border(d)}` }}>
        {d ? <Sun size={16} className="text-amber-400" /> : <Moon size={16} className="text-slate-500" />}
      </button>

      <div className="absolute -top-40 -left-40 w-96 h-96 rounded-full pointer-events-none"
        style={{ background: `radial-gradient(circle,${d ? 'rgba(251,191,36,0.12)' : 'rgba(251,191,36,0.15)'} 0%,transparent 70%)` }} />
      <div className="absolute -bottom-40 -right-40 w-96 h-96 rounded-full pointer-events-none"
        style={{ background: `radial-gradient(circle,${d ? 'rgba(99,102,241,0.10)' : 'rgba(99,102,241,0.08)'} 0%,transparent 70%)` }} />
      <div className="absolute inset-0 pointer-events-none"
        style={{ opacity: d ? 0.03 : 0.04, backgroundImage: 'linear-gradient(rgba(100,100,100,0.5) 1px,transparent 1px),linear-gradient(90deg,rgba(100,100,100,0.5) 1px,transparent 1px)', backgroundSize: '40px 40px' }} />

      <motion.div initial={{ opacity: 0, y: 32 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: 'easeOut' }}
        className="relative z-10 w-full max-w-sm space-y-10">

        <div className="text-center space-y-4">
          <div className="mx-auto w-20 h-20 rounded-[20px] flex items-center justify-center"
            style={{ background: 'linear-gradient(135deg,#FBBF24 0%,#F59E0B 100%)', boxShadow: '0 0 40px rgba(251,191,36,0.35),0 8px 24px rgba(0,0,0,0.3)' }}>
            <Swords size={36} className="text-slate-950" />
          </div>
          <div>
            <p className="text-amber-400 text-xs font-bold tracking-[0.25em] uppercase mb-1">Bem-vindo ao</p>
            <h1 className="text-3xl font-black leading-tight tracking-tight" style={{ color: T.text(d) }}>
              Bolão dos<br />
              <span style={{ background: 'linear-gradient(90deg,#FBBF24,#FDE68A)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
                Clássicos
              </span>
            </h1>
            <p className="text-sm mt-2" style={{ color: T.textMuted(d) }}>Palpite no Campeonato Brasileiro</p>
          </div>
        </div>

        <div className="rounded-2xl p-6 space-y-4 border transition-colors duration-300"
          style={{ background: T.surface(d), backdropFilter: 'blur(20px)', borderColor: T.border(d) }}>
          <div className="space-y-3">
            {[
              { placeholder: 'Usuário', value: user, onChange: setUser, type: 'text',     Icon: Users  },
              { placeholder: 'Senha',   value: pass, onChange: setPass, type: 'password', Icon: Shield },
            ].map(({ placeholder, value, onChange, type, Icon }) => (
              <div key={placeholder} className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: T.textMuted(d) }}>
                  <Icon size={16} />
                </span>
                <input type={type} placeholder={placeholder} value={value}
                  onChange={e => onChange(e.target.value)}
                  className="w-full pl-10 pr-4 py-3.5 rounded-xl font-medium outline-none transition-all text-sm"
                  style={{ background: T.inputBg(d), border: `1.5px solid ${T.inputBdr(d)}`, color: T.text(d), caretColor: '#FBBF24' }}
                  onFocus={e => Object.assign(e.target.style, { borderColor: '#FBBF24', background: d ? 'rgba(255,255,255,0.08)' : 'rgba(251,191,36,0.04)' })}
                  onBlur={e => Object.assign(e.target.style, { borderColor: T.inputBdr(d), background: T.inputBg(d) })}
                />
              </div>
            ))}
          </div>

          <AnimatePresence>
            {error && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                <div className="flex items-center gap-2 text-red-400 bg-red-500/10 border border-red-500/20 p-3 rounded-xl text-xs font-medium">
                  <AlertCircle size={14} />
                  <span>Credenciais inválidas — tente marcos / 123</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <button onClick={handleSubmit as any} disabled={loading}
            className="w-full py-3.5 rounded-xl font-black text-slate-950 text-sm tracking-wide flex items-center justify-center gap-2 transition-all active:scale-95 disabled:opacity-70"
            style={{ background: 'linear-gradient(135deg,#FBBF24 0%,#F59E0B 100%)', boxShadow: '0 4px 20px rgba(251,191,36,0.25)' }}>
            {loading
              ? <motion.div className="w-5 h-5 rounded-full border-2 border-slate-950/30 border-t-slate-950"
                  animate={{ rotate: 360 }} transition={{ duration: 0.7, repeat: Infinity, ease: 'linear' }} />
              : <><span>Entrar</span><LogIn size={16} /></>}
          </button>
        </div>

        <div className="flex items-center justify-center gap-6 px-6 py-3 rounded-2xl mx-auto w-fit border"
          style={{ background: T.surface(d), borderColor: T.border(d) }}>
          <div className="text-center">
            <p className="text-amber-400 font-black text-lg">25 pts</p>
            <p className="text-[10px] uppercase tracking-wider" style={{ color: T.textMuted(d) }}>Placar exato</p>
          </div>
          <div className="w-px h-8" style={{ background: T.border(d) }} />
          <div className="text-center">
            <p className="text-emerald-400 font-black text-lg">10 pts</p>
            <p className="text-[10px] uppercase tracking-wider" style={{ color: T.textMuted(d) }}>Vencedor</p>
          </div>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Apostar ──────────────────────────────────────────────────────────────────

function Apostar({ isDark, onRoundLoad }: { isDark: boolean; onRoundLoad: (n: number | string) => void }) {
  const d = isDark;
  const { data, loading, error, refetch } = useRodada();

  useEffect(() => {
    if (data?.roundNumber) onRoundLoad(data.roundNumber);
  }, [data?.roundNumber]);

  type ScoreMap = Record<string, { home: string; away: string }>;
  const [scores,    setScores]    = useState<ScoreMap>({});
  const [submitted, setSubmitted] = useState(false);

  const matches = data?.matches ?? [];

  const setScore = (id: string, side: 'home' | 'away', val: string) =>
    setScores(s => ({ ...s, [id]: { ...(s[id] ?? { home: '', away: '' }), [side]: val.replace(/\D/g, '').slice(0, 2) } }));

  const openMatches   = matches.filter(m => m.status !== 'STATUS_FINAL');
  const filledCount   = openMatches.filter(m => scores[m.id]?.home !== '' && scores[m.id]?.home != null && scores[m.id]?.away !== '' && scores[m.id]?.away != null).length;
  const canSubmit     = openMatches.length > 0 && filledCount === openMatches.length;

  // ── Loading skeleton ──
  if (loading) return (
    <div className="pb-4 space-y-3">
      <div className="rounded-xl p-4 flex items-center justify-between border animate-pulse"
        style={{ background: T.surface(d), borderColor: T.border(d) }}>
        <div className="space-y-2">
          <div className="h-4 w-32 rounded-lg" style={{ background: T.elevated(d) }} />
          <div className="h-3 w-20 rounded-lg" style={{ background: T.elevated(d) }} />
        </div>
        <div className="w-12 h-12 rounded-full" style={{ background: T.elevated(d) }} />
      </div>
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="rounded-2xl p-4 border animate-pulse h-24" style={{ background: T.surface(d), borderColor: T.border(d) }} />
      ))}
    </div>
  );

  // ── Error state ──
  if (error) return (
    <div className="flex flex-col items-center justify-center py-20 gap-5">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
        style={{ background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.2)' }}>
        <WifiOff size={28} className="text-red-400" />
      </div>
      <div className="text-center">
        <p className="font-bold text-base" style={{ color: T.text(d) }}>Sem conexão com a API</p>
        <p className="text-sm mt-1" style={{ color: T.textMuted(d) }}>Não foi possível carregar os jogos</p>
      </div>
      <button onClick={refetch}
        className="flex items-center gap-2 px-5 py-3 rounded-xl font-bold text-sm transition-all active:scale-95"
        style={{ background: 'linear-gradient(135deg,#FBBF24 0%,#F59E0B 100%)', color: '#0C1120' }}>
        <RefreshCw size={15} /> Tentar novamente
      </button>
    </div>
  );

  // ── Empty state ──
  if (matches.length === 0) return (
    <div className="flex flex-col items-center justify-center py-20 gap-4 text-center">
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
        style={{ background: T.surface(d), border: `1px solid ${T.border(d)}` }}>
        <Trophy size={28} className="text-amber-400" />
      </div>
      <p className="font-bold" style={{ color: T.text(d) }}>Nenhum jogo encontrado</p>
      <p className="text-sm" style={{ color: T.textMuted(d) }}>A rodada ainda não foi divulgada</p>
      <button onClick={refetch} className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-bold text-xs active:scale-95"
        style={{ background: T.surface(d), border: `1px solid ${T.border(d)}`, color: T.textMuted(d) }}>
        <RefreshCw size={13} /> Atualizar
      </button>
    </div>
  );

  return (
    <div className="pb-4 space-y-3">
      {/* Progress */}
      <div className="rounded-xl p-4 flex items-center justify-between border"
        style={{ background: d ? 'rgba(251,191,36,0.07)' : 'rgba(251,191,36,0.06)', borderColor: d ? 'rgba(251,191,36,0.15)' : 'rgba(251,191,36,0.2)' }}>
        <div>
          <p className="font-bold text-sm" style={{ color: T.text(d) }}>
            {filledCount} de {openMatches.length} palpites
          </p>
          <p className="text-xs mt-0.5 flex items-center gap-1.5" style={{ color: T.textMuted(d) }}>
            <Wifi size={11} className="text-emerald-400" />
            Dados ao vivo • ESPN
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={refetch}
            className="w-8 h-8 rounded-lg flex items-center justify-center transition-all active:scale-90"
            style={{ background: T.surface(d), border: `1px solid ${T.border(d)}` }}>
            <RefreshCw size={13} style={{ color: T.textMuted(d) }} />
          </button>
          {openMatches.length > 0 && (
            <div className="relative w-12 h-12">
              <svg className="w-12 h-12 -rotate-90" viewBox="0 0 44 44">
                <circle cx="22" cy="22" r="18" fill="none" stroke={d ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)'} strokeWidth="4" />
                <circle cx="22" cy="22" r="18" fill="none" stroke="#FBBF24" strokeWidth="4"
                  strokeDasharray={`${(filledCount / openMatches.length) * 113} 113`} strokeLinecap="round" />
              </svg>
              <span className="absolute inset-0 flex items-center justify-center font-black text-xs" style={{ color: T.text(d) }}>
                {Math.round((filledCount / (openMatches.length || 1)) * 100)}%
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Match cards */}
      {matches.map((match, idx) => {
        const sh     = scores[match.id]?.home ?? '';
        const sa     = scores[match.id]?.away ?? '';
        const closed = match.status === 'STATUS_FINAL';
        const live   = match.status === 'STATUS_IN_PROGRESS' || match.status === 'STATUS_HALFTIME';

        return (
          <motion.div key={match.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: idx * 0.04 }}
            className="rounded-2xl overflow-hidden border"
            style={{ background: T.surface(d), borderColor: live ? 'rgba(34,197,94,0.3)' : T.border(d) }}>

            <div className="px-4 pt-3 pb-1 flex items-center justify-between">
              <span className="text-[10px] font-medium" style={{ color: T.textMuted(d) }}>{fmtDate(match.date)}</span>
              <StatusBadge status={match.status} clock={match.clock} />
            </div>

            <div className="flex items-center px-4 pb-4 pt-2 gap-2">
              {/* Home */}
              <div className="flex-1 flex flex-col items-center gap-2">
                <TeamLogo src={match.homeLogo} abbr={match.home} isDark={isDark} />
                <span className="text-[11px] font-medium text-center leading-tight" style={{ color: T.textMuted(d) }}>{match.homeName}</span>
              </div>

              {/* Center: score input or final score */}
              <div className="flex items-center gap-2">
                {closed || live ? (
                  // Show real score
                  <div className="flex items-center gap-2">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center text-xl font-black"
                      style={{ background: T.elevated(d), color: T.text(d) }}>
                      {match.homeScore}
                    </div>
                    <div className="flex flex-col items-center gap-0.5">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: T.textMuted(d) }} />
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: T.textMuted(d) }} />
                    </div>
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center text-xl font-black"
                      style={{ background: T.elevated(d), color: T.text(d) }}>
                      {match.awayScore}
                    </div>
                  </div>
                ) : (
                  // Bet inputs
                  <>
                    <input type="number" inputMode="numeric" value={sh} placeholder="0"
                      onChange={e => setScore(match.id, 'home', e.target.value)}
                      className="w-12 h-12 rounded-xl text-center text-xl font-black outline-none transition-all placeholder:text-slate-600"
                      style={{ background: sh ? 'rgba(251,191,36,0.12)' : T.inputBg(d), border: `1.5px solid ${sh ? 'rgba(251,191,36,0.4)' : T.inputBdr(d)}`, color: T.text(d) }}
                    />
                    <div className="flex flex-col items-center gap-0.5">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: T.textMuted(d) }} />
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: T.textMuted(d) }} />
                    </div>
                    <input type="number" inputMode="numeric" value={sa} placeholder="0"
                      onChange={e => setScore(match.id, 'away', e.target.value)}
                      className="w-12 h-12 rounded-xl text-center text-xl font-black outline-none transition-all placeholder:text-slate-600"
                      style={{ background: sa ? 'rgba(251,191,36,0.12)' : T.inputBg(d), border: `1.5px solid ${sa ? 'rgba(251,191,36,0.4)' : T.inputBdr(d)}`, color: T.text(d) }}
                    />
                  </>
                )}
              </div>

              {/* Away */}
              <div className="flex-1 flex flex-col items-center gap-2">
                <TeamLogo src={match.awayLogo} abbr={match.away} isDark={isDark} />
                <span className="text-[11px] font-medium text-center leading-tight" style={{ color: T.textMuted(d) }}>{match.awayName}</span>
              </div>
            </div>

            {/* My bet hint (if submitted and match closed) */}
            {closed && scores[match.id]?.home != null && (
              <div className="px-4 pb-3 flex items-center gap-2">
                <span className="text-[10px]" style={{ color: T.textMuted(d) }}>Seu palpite:</span>
                <span className="text-[10px] font-bold text-amber-400">
                  {scores[match.id].home} × {scores[match.id].away}
                </span>
              </div>
            )}
          </motion.div>
        );
      })}

      {/* Submit */}
      {openMatches.length > 0 && (
        <div className="pt-2">
          <AnimatePresence mode="wait">
            {submitted ? (
              <motion.div key="ok" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
                className="w-full py-4 rounded-xl flex items-center justify-center gap-2 font-bold text-emerald-400 text-sm border"
                style={{ background: 'rgba(34,197,94,0.1)', borderColor: 'rgba(34,197,94,0.2)' }}>
                <Star size={16} fill="currentColor" /> Palpites enviados com sucesso!
              </motion.div>
            ) : (
              <button key="btn" onClick={() => canSubmit && setSubmitted(true)}
                className="w-full py-4 rounded-xl font-black text-sm tracking-wide transition-all active:scale-95"
                style={{
                  background: canSubmit ? 'linear-gradient(135deg,#FBBF24 0%,#F59E0B 100%)' : T.elevated(d),
                  color: canSubmit ? '#0C1120' : T.textMuted(d),
                  border: canSubmit ? 'none' : `1px solid ${T.border(d)}`,
                  boxShadow: canSubmit ? '0 4px 24px rgba(251,191,36,0.25)' : 'none',
                  cursor: canSubmit ? 'pointer' : 'not-allowed',
                }}>
                {canSubmit ? 'Enviar Palpites' : `Faltam ${openMatches.length - filledCount} palpites`}
              </button>
            )}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

// ─── Ranking ──────────────────────────────────────────────────────────────────

const podiumCfg = [
  { icon: Crown, color: '#FBBF24', bg: 'rgba(251,191,36,0.12)',  border: 'rgba(251,191,36,0.25)' },
  { icon: Medal, color: '#94A3B8', bg: 'rgba(148,163,184,0.12)', border: 'rgba(148,163,184,0.25)' },
  { icon: Award, color: '#CD7F32', bg: 'rgba(205,127,50,0.12)',  border: 'rgba(205,127,50,0.25)' },
];

function Ranking({ isDark }: { isDark: boolean }) {
  const d = isDark;
  const top3 = mockRanking.slice(0, 3);
  const rest = mockRanking.slice(3);
  const me   = mockRanking.find(p => p.name === 'Marcos');

  return (
    <div className="pb-4 space-y-4">
      <div className="grid grid-cols-3 gap-2">
        {top3.map((p, i) => {
          const { icon: Icon, color, bg, border } = podiumCfg[i];
          return (
            <motion.div key={p.id} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}
              className="rounded-2xl p-3 flex flex-col items-center text-center gap-2"
              style={{ background: bg, border: `1px solid ${border}` }}>
              <Icon size={20} style={{ color }} fill={color} />
              <div className="w-10 h-10 rounded-full flex items-center justify-center font-black text-xs"
                style={{ background: d ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)', color: T.text(d) }}>
                {p.name.substring(0, 2).toUpperCase()}
              </div>
              <div>
                <p className="font-bold text-xs leading-tight truncate w-full" style={{ color: T.text(d) }}>{p.name}</p>
                <p className="font-black text-sm mt-0.5" style={{ color }}>{p.points}</p>
                <p className="text-[9px]" style={{ color: T.textMuted(d) }}>pts</p>
              </div>
            </motion.div>
          );
        })}
      </div>

      {me && me.position > 3 && (
        <div className="rounded-xl p-4 flex items-center gap-3 border"
          style={{ background: 'rgba(251,191,36,0.07)', borderColor: 'rgba(251,191,36,0.2)' }}>
          <Flame size={16} className="text-amber-400 shrink-0" />
          <div className="flex-1">
            <p className="text-amber-400 text-xs font-bold">Sua posição</p>
            <p className="font-black text-sm" style={{ color: T.text(d) }}>{me.position}º lugar • {me.points} pts</p>
          </div>
          <ChevronRight size={16} style={{ color: T.textMuted(d) }} />
        </div>
      )}

      <div className="space-y-1.5">
        {rest.map((p, i) => {
          const isMe = p.name === 'Marcos';
          return (
            <motion.div key={p.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.24 + i * 0.02 }}
              className="flex items-center gap-3 px-4 py-3 rounded-xl"
              style={{ background: isMe ? 'rgba(251,191,36,0.08)' : T.rankItem(d), border: `1px solid ${isMe ? 'rgba(251,191,36,0.2)' : T.rankBdr(d)}` }}>
              <span className="text-xs font-black w-7 text-center shrink-0" style={{ color: isMe ? '#FBBF24' : T.textMuted(d) }}>{p.position}º</span>
              <div className="w-8 h-8 rounded-full flex items-center justify-center text-[10px] font-black shrink-0"
                style={{ background: isMe ? 'rgba(251,191,36,0.15)' : T.avatarBg(d), color: isMe ? '#FBBF24' : T.avatarText(d) }}>
                {p.name.substring(0, 2).toUpperCase()}
              </div>
              <span className="flex-1 text-sm font-medium truncate" style={{ color: isMe ? '#FBBF24' : T.text(d) }}>
                {p.name}{isMe && ' (Você)'}
              </span>
              <span className="font-black text-sm shrink-0" style={{ color: isMe ? '#FBBF24' : T.text(d) }}>
                {p.points} <span className="text-xs font-normal" style={{ color: T.textMuted(d) }}>pts</span>
              </span>
            </motion.div>
          );
        })}
      </div>

      <div className="rounded-2xl p-5 space-y-3 mt-2 border" style={{ background: T.surface(d), borderColor: T.border(d) }}>
        <p className="text-xs font-bold uppercase tracking-wider flex items-center gap-2" style={{ color: T.textMuted(d) }}>
          <Star size={12} /> Regras de pontuação
        </p>
        <div className="space-y-2.5">
          {[
            { dot: '#FBBF24', label: 'Placar exato',     pts: '25 pts', color: '#FBBF24' },
            { dot: '#22C55E', label: 'Vencedor / Empate', pts: '10 pts', color: '#22C55E' },
          ].map(({ dot, label, pts, color }) => (
            <div key={label} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ background: dot }} />
                <span className="text-sm" style={{ color: T.textMuted(d) }}>{label}</span>
              </div>
              <span className="font-black text-sm" style={{ color }}>{pts}</span>
            </div>
          ))}
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
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(text)}`, '_blank');
  };

  const cards = [
    { label: 'Arrecadação Bruta', value: fmt(gross), sub: `${finance.participants} × ${fmt(finance.ticketPrice)}`, color: '#22C55E', bg: 'rgba(34,197,94,0.08)',   border: 'rgba(34,197,94,0.15)',   Icon: TrendingUp },
    { label: 'Despesas',          value: fmt(expenses.work + expenses.commission), sub: '15% trabalho + 10% comissão', color: '#F87171', bg: 'rgba(248,113,113,0.08)', border: 'rgba(248,113,113,0.15)', Icon: Users },
  ];

  return (
    <div className="pb-4 space-y-4">
      {cards.map(({ label, value, sub, color, bg, border, Icon }, i) => (
        <motion.div key={label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 }}
          className="rounded-2xl p-5 border" style={{ background: bg, borderColor: border }}>
          <div className="flex items-start justify-between mb-3">
            <p className="text-xs font-bold uppercase tracking-wider" style={{ color }}>{label}</p>
            <div className="p-2 rounded-xl" style={{ background: `${color}20` }}><Icon size={14} style={{ color }} /></div>
          </div>
          <p className="font-black text-2xl" style={{ color: T.text(d) }}>{value}</p>
          <p className="text-xs mt-1" style={{ color: T.textMuted(d) }}>{sub}</p>
        </motion.div>
      ))}

      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.16 }}
        className="rounded-2xl p-5 border" style={{ background: 'rgba(99,102,241,0.08)', borderColor: 'rgba(99,102,241,0.15)' }}>
        <div className="flex items-start justify-between mb-4">
          <p className="text-xs font-bold uppercase tracking-wider text-indigo-400">Premiação Líquida</p>
          <div className="p-2 rounded-xl" style={{ background: 'rgba(99,102,241,0.12)' }}><Trophy size={14} className="text-indigo-400" /></div>
        </div>
        <p className="font-black text-2xl mb-5" style={{ color: T.text(d) }}>{fmt(net)}</p>
        <div className="space-y-3">
          {[
            { pos: '1º', label: 'Campeão', pct: '70%', val: prizes.first,  color: '#FBBF24', bg: 'rgba(251,191,36,0.1)' },
            { pos: '2º', label: 'Vice',    pct: '30%', val: prizes.second, color: '#94A3B8', bg: 'rgba(148,163,184,0.08)' },
          ].map(({ pos, label, pct, val, color, bg }) => (
            <div key={pos} className="flex items-center justify-between p-3 rounded-xl" style={{ background: bg }}>
              <div className="flex items-center gap-3">
                <span className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-black"
                  style={{ background: `${color}20`, color }}>{pos}</span>
                <div>
                  <p className="font-medium text-sm" style={{ color: T.text(d) }}>{label}</p>
                  <p className="text-xs" style={{ color: T.textMuted(d) }}>{pct} do prêmio</p>
                </div>
              </div>
              <p className="font-black text-base" style={{ color }}>{fmt(val)}</p>
            </div>
          ))}
        </div>
      </motion.div>

      <div className="rounded-xl px-4 py-3 flex items-center gap-3 border" style={{ background: T.surface(d), borderColor: T.border(d) }}>
        <Users size={14} className="shrink-0" style={{ color: T.textMuted(d) }} />
        <p className="text-sm" style={{ color: T.textMuted(d) }}>
          <span className="font-bold" style={{ color: T.text(d) }}>{finance.participants} participantes</span> confirmados
        </p>
      </div>

      <button onClick={handleShare}
        className="w-full py-4 rounded-xl font-black text-sm text-white flex items-center justify-center gap-2.5 transition-all active:scale-95"
        style={{ background: 'linear-gradient(135deg,#22C55E 0%,#16A34A 100%)', boxShadow: '0 4px 20px rgba(34,197,94,0.25)' }}>
        <Share2 size={16} /> Compartilhar no WhatsApp
      </button>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

const tabs = [
  { key: 'apostar', label: 'Palpites', Icon: Target },
  { key: 'ranking', label: 'Ranking',  Icon: Trophy },
  { key: 'info',    label: 'Resumo',   Icon: Info   },
] as const;

type Tab = 'apostar' | 'ranking' | 'info';

const headerContent: Record<Tab, { title: string; sub: string }> = {
  apostar: { title: '',            sub: 'Faça seus palpites'    },
  ranking: { title: 'Ranking Geral', sub: 'Classificação ao vivo' },
  info:    { title: 'Resumo',        sub: 'Financeiro do bolão'   },
};

export default function App() {
  const [tab,         setTab]         = useState<Tab>('apostar');
  const [auth,        setAuth]        = useState(false);
  const [isDark,      setIsDark]      = useState(true);
  const [roundNumber, setRoundNumber] = useState<number | string>('...');
  const d = isDark;

  if (!auth) return <Login onLogin={() => setAuth(true)} isDark={isDark} toggleTheme={() => setIsDark(v => !v)} />;

  const title = tab === 'apostar' ? `Rodada ${roundNumber}` : headerContent[tab].title;
  const sub   = headerContent[tab].sub;

  return (
    <div className="h-[100dvh] flex flex-col font-sans transition-colors duration-300" style={{ background: T.bg(d) }}>

      {/* Header */}
      <header className="shrink-0 px-5 pt-10 pb-4 z-10 transition-colors duration-300"
        style={{ background: T.headerBg(d), backdropFilter: 'blur(20px)', borderBottom: `1px solid ${T.border(d)}` }}>
        <div className="flex items-center justify-between max-w-lg mx-auto">
          <div className="flex-1 min-w-0">
            <AnimatePresence mode="wait">
              <motion.div key={tab + roundNumber} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={{ duration: 0.18 }}>
                <p className="text-xs font-bold uppercase tracking-widest mb-0.5" style={{ color: T.textMuted(d) }}>
                  Bolão dos Clássicos
                </p>
                <h1 className="font-black text-2xl tracking-tight" style={{ color: T.text(d) }}>{title}</h1>
                <p className="text-xs mt-0.5" style={{ color: T.textMuted(d) }}>{sub}</p>
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="flex items-center gap-2 ml-3 shrink-0">
            <button onClick={() => setIsDark(v => !v)}
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-90"
              style={{ background: T.surface(d), border: `1px solid ${T.border(d)}` }}>
              {d ? <Sun size={15} className="text-amber-400" /> : <Moon size={15} className="text-slate-500" />}
            </button>
            <button onClick={() => setAuth(false)}
              className="w-9 h-9 rounded-xl flex items-center justify-center transition-all active:scale-90"
              style={{ background: T.surface(d), border: `1px solid ${T.border(d)}` }}>
              <LogOut size={15} style={{ color: T.textMuted(d) }} />
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <div className="px-4 pt-4 pb-2 max-w-lg mx-auto">
          <AnimatePresence mode="wait">
            {tab === 'apostar' && (
              <motion.div key="apostar" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} transition={{ duration: 0.2 }}>
                <Apostar isDark={isDark} onRoundLoad={setRoundNumber} />
              </motion.div>
            )}
            {tab === 'ranking' && (
              <motion.div key="ranking" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} transition={{ duration: 0.2 }}>
                <Ranking isDark={isDark} />
              </motion.div>
            )}
            {tab === 'info' && (
              <motion.div key="info" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 12 }} transition={{ duration: 0.2 }}>
                <Informativo isDark={isDark} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* Bottom nav */}
      <nav className="shrink-0 z-50 transition-colors duration-300"
        style={{ background: T.navBg(d), backdropFilter: 'blur(20px)', borderTop: `1px solid ${T.border(d)}` }}>
        <div className="flex justify-around items-center pt-2 pb-6 px-4 max-w-lg mx-auto">
          {tabs.map(({ key, label, Icon }) => {
            const active = tab === key;
            return (
              <button key={key} onClick={() => setTab(key)}
                className="flex flex-col items-center gap-1 px-5 py-2 rounded-xl transition-all relative"
                style={{ minWidth: 72 }}>
                {active && (
                  <motion.div layoutId="tabBg" className="absolute inset-0 rounded-xl"
                    style={{ background: d ? 'rgba(251,191,36,0.1)' : 'rgba(251,191,36,0.12)' }}
                    transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }} />
                )}
                <Icon size={20} strokeWidth={active ? 2.5 : 1.8}
                  style={{ color: active ? '#FBBF24' : T.textMuted(d), position: 'relative' }} />
                <span className="text-[10px] font-bold tracking-wide relative"
                  style={{ color: active ? '#FBBF24' : T.textMuted(d) }}>
                  {label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
