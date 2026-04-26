import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Trophy,
  Target,
  Share2,
  AlertCircle,
  RefreshCw,
  ChevronRight,
  ChevronLeft,
  Flame,
  Star,
  Bot,
  Zap,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { domToPng } from "modern-screenshot";
import { T } from "../constants/theme";
import { ymd, todayMidnight, fmtDate } from "../utils/format";
import { useRodada } from "../hooks/useRodada";
import { UserBetsList } from "./UserBetsList";
import { Match, User } from "../types";

interface ApostarProps {
  isDark: boolean;
  user: User | null;
  onRoundLoad?: (num: number) => void;
  onPointsChange?: (pts: number) => void;
}

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
  if (status === "STATUS_IN_PROGRESS" || status === "STATUS_HALFTIME") {
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
  const d = isDark;
  return (
    <div
      className="w-12 h-12 rounded-2xl flex items-center justify-center font-black text-sm overflow-hidden"
      style={{
        background: T.avatarBg(d),
        border: `1px solid ${T.border(d)}`,
        color: T.text(d),
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

export function Apostar({ isDark, user, onRoundLoad, onPointsChange }: ApostarProps) {
  const d = isDark;
  const { matches, loading, error, rodada, setRodada, refresh } = useRodada();
  const [activeScores, setActiveScores] = useState<Record<string, { home: string; away: string }>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [liberatedIds, setLiberatedIds] = useState<string[]>([]);
  const [anchorTs, setAnchorTs] = useState(Date.now());

  useEffect(() => {
    if (rodada && onRoundLoad) onRoundLoad(rodada);
  }, [rodada, onRoundLoad]);

  useEffect(() => {
    fetchLiberated();
    if (user) fetchUserBets();
  }, [rodada, user, anchorTs]);

  const fetchLiberated = async () => {
    const { data } = await supabase
      .from("jogos_liberados")
      .select("match_id")
      .eq("liberado", true);
    if (data) setLiberatedIds(data.map(x => x.match_id));
  };

  const fetchUserBets = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("palpites")
      .select("*")
      .eq("usuario_id", user.id);
    
    if (data) {
        const scores: any = {};
        data.forEach(p => {
            scores[p.match_id] = { home: p.home_score.toString(), away: p.away_score.toString() };
        });
        setActiveScores(scores);
    }
  };

  const setScore = (matchId: string, side: "home" | "away", val: string) => {
    const v = val.replace(/\D/g, "").substring(0, 2);
    setActiveScores(prev => ({
      ...prev,
      [matchId]: {
        ...(prev[matchId] || { home: "", away: "" }),
        [side]: v
      }
    }));
  };

  const handleSave = async (match: Match) => {
    if (!user || isSaving) return;
    const score = activeScores[match.id];
    if (!score || score.home === "" || score.away === "") return;

    setIsSaving(true);
    try {
      const { error: err } = await supabase
        .from("palpites")
        .upsert({
          usuario_id: user.id,
          match_id: match.id,
          home_score: parseInt(score.home),
          away_score: parseInt(score.away),
          rodada: rodada
        }, { onConflict: "usuario_id,match_id" });

      if (err) throw err;
      setAnchorTs(Date.now());
    } catch (err) {
      console.error("Erro ao salvar palpite:", err);
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) return (
    <div className="flex-1 flex flex-col items-center justify-center py-20 gap-4">
      <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        className="w-10 h-10 rounded-full border-4 border-amber-400/20 border-t-amber-400"
      />
      <p className="text-sm font-bold opacity-50" style={{ color: T.text(d) }}>Sincronizando rodada...</p>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full px-4 py-6 gap-6">
      {/* Header Rodada */}
      <div className="flex items-center justify-between bg-amber-400/5 p-4 rounded-3xl border border-amber-400/10 backdrop-blur-sm">
         <button onClick={() => setRodada(prev => Math.max(1, prev - 1))} className="p-3 rounded-2xl hover:bg-amber-400/20 transition-all">
            <ChevronLeft size={20} className="text-amber-400" />
         </button>
         <div className="text-center">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-400/60">Brasileirão 2024</p>
            <h2 className="text-xl font-black" style={{ color: T.text(d) }}>Rodada {rodada}</h2>
         </div>
         <button onClick={() => setRodada(prev => prev + 1)} className="p-3 rounded-2xl hover:bg-amber-400/20 transition-all">
            <ChevronRight size={20} className="text-amber-400" />
         </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {matches.map((m) => {
          const isLiberated = liberatedIds.includes(m.id);
          const score = activeScores[m.id] || { home: "", away: "" };
          
          return (
            <motion.div key={m.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="group p-5 rounded-[2rem] border transition-all hover:scale-[1.01] relative overflow-hidden"
              style={{ background: T.surface(d), borderColor: T.border(d) }}
            >
              {!isLiberated && (
                <div className="absolute inset-0 bg-slate-950/40 backdrop-blur-[2px] z-10 flex flex-col items-center justify-center gap-2 p-6 text-center">
                   <div className="w-12 h-12 rounded-2xl bg-slate-900 flex items-center justify-center border border-white/10">
                      <Zap size={24} className="text-amber-400 opacity-50" />
                   </div>
                   <p className="text-xs font-black uppercase tracking-wider text-white">Bloqueado</p>
                   <p className="text-[10px] text-white/60">Aguardando liberação do administrador</p>
                </div>
              )}

              <div className="flex items-center justify-between mb-6">
                <StatusBadge status={m.status} clock={m.clock} />
                <span className="text-[10px] font-bold opacity-40 uppercase" style={{ color: T.text(d) }}>
                  {fmtDate(m.date)}
                </span>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="flex flex-col items-center gap-2 flex-1">
                  <TeamLogo src={m.homeLogo} abbr={m.home} isDark={d} />
                  <span className="text-xs font-black text-center line-clamp-1" style={{ color: T.text(d) }}>{m.homeName}</span>
                </div>

                <div className="flex items-center gap-2">
                   <input type="text" inputMode="numeric" value={score.home} onChange={e => setScore(m.id, "home", e.target.value)}
                    className="w-12 h-12 rounded-2xl text-center text-xl font-black outline-none transition-all"
                    style={{ background: T.inputBg(d), border: `2px solid ${score.home ? "rgba(251,191,36,0.4)" : T.inputBdr(d)}`, color: T.text(d) }}
                   />
                   <div className="flex flex-col gap-1">
                      <div className="w-1 h-1 rounded-full bg-amber-400/30" />
                      <div className="w-1 h-1 rounded-full bg-amber-400/30" />
                   </div>
                   <input type="text" inputMode="numeric" value={score.away} onChange={e => setScore(m.id, "away", e.target.value)}
                    className="w-12 h-12 rounded-2xl text-center text-xl font-black outline-none transition-all"
                    style={{ background: T.inputBg(d), border: `2px solid ${score.away ? "rgba(251,191,36,0.4)" : T.inputBdr(d)}`, color: T.text(d) }}
                   />
                </div>

                <div className="flex flex-col items-center gap-2 flex-1">
                  <TeamLogo src={m.awayLogo} abbr={m.away} isDark={d} />
                  <span className="text-xs font-black text-center line-clamp-1" style={{ color: T.text(d) }}>{m.awayName}</span>
                </div>
              </div>

              {isLiberated && (
                 <button onClick={() => handleSave(m)} disabled={isSaving || score.home==="" || score.away===""}
                  className="w-full mt-6 py-3 rounded-2xl bg-amber-400 text-slate-950 font-black text-xs uppercase tracking-wider transition-all active:scale-95 disabled:opacity-20"
                 >
                   Salvar Palpite
                 </button>
              )}
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
