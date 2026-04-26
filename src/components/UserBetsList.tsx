
import React, { useState, useEffect } from "react";
import { RefreshCw } from "lucide-react";
import { supabase } from "../lib/supabase";
import { T } from "../constants/theme";
import { Match } from "../types";

interface UserBetsListProps {
  userId: string;
  roundMatches: Match[];
  isDark: boolean;
}

export function UserBetsList({
  userId,
  roundMatches,
  isDark,
}: UserBetsListProps) {
  const d = isDark;
  const [bets, setBets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

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

  if (loading)
    return (
      <div className="py-10 flex justify-center">
        <RefreshCw className="animate-spin text-amber-400" />
      </div>
    );

  return (
    <div className="space-y-3">
      <p
        className="text-[10px] font-bold uppercase tracking-widest px-1"
        style={{ color: T.textMuted(d) }}
      >
        Palpites Registrados
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
      {roundMatches.map((m) => {
        const bet = bets.find((b) => b.match_id === m.id);
        return (
          <div
            key={m.id}
            className="p-4 rounded-2xl border flex flex-col gap-4 relative overflow-hidden"
            style={{ background: T.surface(d), borderColor: T.border(d) }}
          >
            <div className="flex items-center justify-between gap-2 relative z-10">
              <div className="flex flex-col items-center gap-2 flex-1 min-w-0">
                <img src={m.homeLogo} className="w-10 h-10 object-contain drop-shadow-sm" alt="" />
                <span className="text-[10px] font-black uppercase tracking-tighter truncate w-full text-center" style={{ color: T.text(d) }}>
                  {m.home}
                </span>
              </div>

              <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-black/20 border border-white/5">
                <span className="font-black text-lg" style={{ color: bet ? T.text(d) : T.textMuted(d) }}>
                  {bet ? bet.gols_home : "-"}
                </span>
                <span className="text-[10px] opacity-20 font-black">×</span>
                <span className="font-black text-lg" style={{ color: bet ? T.text(d) : T.textMuted(d) }}>
                  {bet ? bet.gols_away : "-"}
                </span>
              </div>

              <div className="flex flex-col items-center gap-2 flex-1 min-w-0">
                <img src={m.awayLogo} className="w-10 h-10 object-contain drop-shadow-sm" alt="" />
                <span className="text-[10px] font-black uppercase tracking-tighter truncate w-full text-center" style={{ color: T.text(d) }}>
                  {m.away}
                </span>
              </div>
            </div>
          </div>
        );
      })}
      </div>
    </div>
  );
}
