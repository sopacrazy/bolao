
import React, { useState, useEffect } from "react";
import { motion } from "motion/react";
import { RefreshCw, Bot } from "lucide-react";
import { supabase } from "../lib/supabase";
import { T } from "../constants/theme";
import { useRodada, useSerieCRodada } from "../hooks/useRodada";
import { fmtDate, todayMidnight } from "../utils/format";
import { Match } from "../types";

interface AnalistaViewProps {
  isDark: boolean;
  onAnalyze: (m: Match) => void;
}

export function AnalistaView({ 
  isDark, 
  onAnalyze 
}: AnalistaViewProps) {
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
          className="p-4 rounded-2xl border flex items-center justify-between gap-4 transition-all active:scale-[0.98] cursor-pointer"
          style={{ background: T.surface(d), borderColor: T.border(d) }}
          onClick={() => onAnalyze(match)}
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
          <Bot size={18} className="text-amber-400 opacity-40" />
        </motion.div>
      ))}
    </div>
  );
}
