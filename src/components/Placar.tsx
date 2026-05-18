import React, { useState, useEffect } from "react";
import { motion } from "motion/react";
import {
  Trophy,
  Save,
  RefreshCw,
  ChevronRight,
  ChevronLeft,
  Zap,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { T } from "../constants/theme";
import { fmtDate } from "../utils/format";
import { useRodada } from "../hooks/useRodada";
import { Match, User } from "../types";

interface PlacarProps {
  isDark: boolean;
  user: User | null;
}

export function Placar({ isDark, user }: PlacarProps) {
  const d = isDark;
  const [anchorTs, setAnchorTs] = useState(Date.now());
  const { data, loading, refetch: refresh } = useRodada(anchorTs);
  const matches = data?.matches || [];
  const rodada = Number(data?.roundNumber || 0);

  const [realScores, setRealScores] = useState<Record<string, { home: string; away: string }>>({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (matches.length > 0) {
      const scores: Record<string, { home: string; away: string }> = {};
      matches.forEach(m => {
        // Inicializa com o que já tem no banco (se houver) ou o que veio da API
        // Mas o usuário quer "tudo vazio" para preencher?
        // Vamos deixar vazio para facilitar o preenchimento manual conforme solicitado.
        scores[m.id] = { home: "", away: "" };
      });
      setRealScores(scores);
    }
  }, [matches.length, anchorTs]);

  const setScore = (matchId: string, side: "home" | "away", val: string) => {
    const v = val.replace(/\D/g, "").substring(0, 2);
    setRealScores(prev => ({
      ...prev,
      [matchId]: {
        ...(prev[matchId] || { home: "", away: "" }),
        [side]: v
      }
    }));
  };

  const handleSaveResult = async (match: Match) => {
    if (!user || isSaving || !user.is_admin) return;
    const score = realScores[match.id];
    if (!score || score.home === "" || score.away === "") return;

    setIsSaving(true);
    try {
      const { error } = await supabase
        .from("resultados_rodada")
        .upsert({
          match_id: match.id,
          home_score: parseInt(score.home),
          away_score: parseInt(score.away)
        }, { onConflict: "match_id" });

      if (error) throw error;
      alert("Resultado salvo com sucesso!");
    } catch (err) {
      console.error("Erro ao salvar resultado:", err);
      alert("Erro ao salvar resultado.");
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) return (
    <div className="flex-1 flex flex-col items-center justify-center py-20 gap-4">
      <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
        className="w-10 h-10 rounded-full border-4 border-amber-400/20 border-t-amber-400"
      />
      <p className="text-sm font-bold opacity-50" style={{ color: T.text(d) }}>Carregando jogos...</p>
    </div>
  );

  return (
    <div className="flex-1 flex flex-col max-w-4xl mx-auto w-full px-4 py-6 gap-6">
      {/* Aviso Admin */}
      <div className="bg-amber-400/10 p-4 rounded-2xl border border-amber-400/20 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-amber-400 flex items-center justify-center text-slate-900">
          <Zap size={18} />
        </div>
        <div>
          <p className="text-xs font-black uppercase text-amber-400">Modo Administrador</p>
          <p className="text-[10px] opacity-60" style={{ color: T.text(d) }}>Insira os resultados reais para teste de pontuação.</p>
        </div>
      </div>

      {/* Header Rodada */}
      <div className="flex items-center justify-between bg-amber-400/5 p-4 rounded-3xl border border-amber-400/10 backdrop-blur-sm">
         <button onClick={() => setAnchorTs(prev => prev - 7 * 24 * 60 * 60 * 1000)} className="p-3 rounded-2xl hover:bg-amber-400/20 transition-all">
            <ChevronLeft size={20} className="text-amber-400" />
         </button>
         <div className="text-center">
            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-amber-400/60">Controle de Resultados</p>
            <h2 className="text-xl font-black" style={{ color: T.text(d) }}>Rodada {rodada}</h2>
         </div>
         <button onClick={() => setAnchorTs(prev => prev + 7 * 24 * 60 * 60 * 1000)} className="p-3 rounded-2xl hover:bg-amber-400/20 transition-all">
            <ChevronRight size={20} className="text-amber-400" />
         </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {matches.map((m) => {
          const score = realScores[m.id] || { home: "", away: "" };
          
          return (
            <motion.div key={m.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="group p-5 rounded-[2rem] border transition-all relative overflow-hidden"
              style={{ background: T.surface(d), borderColor: T.border(d) }}
            >
              <div className="flex items-center justify-between mb-6">
                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-500/10" style={{ color: T.textMuted(d) }}>
                  {m.status === "STATUS_FINAL" ? "Oficial: Concluído" : "Oficial: Pendente"}
                </span>
                <span className="text-[10px] font-bold opacity-40 uppercase" style={{ color: T.text(d) }}>
                  {fmtDate(m.date)}
                </span>
              </div>

              <div className="flex items-center justify-between gap-4">
                <div className="flex flex-col items-center gap-2 flex-1">
                  <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center border shadow-sm">
                    {m.homeLogo ? <img src={m.homeLogo} alt={m.home} className="w-7 h-7 object-contain" /> : <span className="text-xs font-black">{m.home}</span>}
                  </div>
                  <span className="text-xs font-black text-center line-clamp-1" style={{ color: T.text(d) }}>{m.homeName}</span>
                </div>

                <div className="flex items-center gap-2">
                   <input type="text" inputMode="numeric" value={score.home} onChange={e => setScore(m.id, "home", e.target.value)}
                    placeholder={m.homeScore !== "-" ? m.homeScore : "0"}
                    className="w-12 h-12 rounded-2xl text-center text-xl font-black outline-none transition-all"
                    style={{ background: T.inputBg(d), border: `2px solid ${score.home ? "rgba(34,197,94,0.4)" : T.inputBdr(d)}`, color: T.text(d) }}
                   />
                   <div className="flex flex-col gap-1">
                      <div className="w-1 h-1 rounded-full bg-amber-400/30" />
                      <div className="w-1 h-1 rounded-full bg-amber-400/30" />
                   </div>
                   <input type="text" inputMode="numeric" value={score.away} onChange={e => setScore(m.id, "away", e.target.value)}
                    placeholder={m.awayScore !== "-" ? m.awayScore : "0"}
                    className="w-12 h-12 rounded-2xl text-center text-xl font-black outline-none transition-all"
                    style={{ background: T.inputBg(d), border: `2px solid ${score.away ? "rgba(34,197,94,0.4)" : T.inputBdr(d)}`, color: T.text(d) }}
                   />
                </div>

                <div className="flex flex-col items-center gap-2 flex-1">
                  <div className="w-10 h-10 rounded-xl bg-white flex items-center justify-center border shadow-sm">
                    {m.awayLogo ? <img src={m.awayLogo} alt={m.away} className="w-7 h-7 object-contain" /> : <span className="text-xs font-black">{m.away}</span>}
                  </div>
                  <span className="text-xs font-black text-center line-clamp-1" style={{ color: T.text(d) }}>{m.awayName}</span>
                </div>
              </div>

              <button onClick={() => handleSaveResult(m)} disabled={isSaving || score.home==="" || score.away===""}
                className="w-full mt-6 py-3 rounded-2xl bg-emerald-500 text-slate-950 font-black text-xs uppercase tracking-wider transition-all active:scale-95 disabled:opacity-20 flex items-center justify-center gap-2"
              >
                <Save size={14} />
                Definir Placar Real
              </button>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
