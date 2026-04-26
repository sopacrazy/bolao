
import React from "react";
import { motion } from "motion/react";
import { Trophy, Medal, Target } from "lucide-react";
import { T, podiumCfg } from "../constants/theme";
import { User } from "../types";

interface RankingProps {
  isDark: boolean;
  users: User[];
  currentUser: User | null;
}

export function Ranking({ 
  isDark, 
  users, 
  currentUser 
}: RankingProps) {
  const d = isDark;
  const sorted = [...users].sort((a, b) => b.pontos - a.pontos || a.nome.localeCompare(b.nome));
  
  const podium = sorted.slice(0, 3);
  const list = sorted.slice(3);

  const getRankStyle = (idx: number) => {
    if (idx === 0) return { color: "#FBBF24", bg: "rgba(251,191,36,0.1)", border: "rgba(251,191,36,0.2)" };
    if (idx === 1) return { color: "#94A3B8", bg: "rgba(148,163,184,0.1)", border: "rgba(148,163,184,0.2)" };
    if (idx === 2) return { color: "#B45309", bg: "rgba(180,83,9,0.1)", border: "rgba(180,83,9,0.2)" };
    return { color: T.textMuted(d), bg: T.elevated(d), border: T.border(d) };
  };

  return (
    <div className="space-y-6 pb-20">
      {/* Podium - Desktop side-by-side or stacked on mobile */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {podium.map((user, idx) => {
          const cfg = podiumCfg[idx as 0 | 1 | 2];
          const style = getRankStyle(idx);
          return (
            <motion.div
              key={user.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              className="relative p-6 rounded-[2.5rem] border flex flex-col items-center text-center gap-3"
              style={{ 
                background: T.surface(d), 
                borderColor: style.border,
                boxShadow: idx === 0 ? "0 20px 40px -15px rgba(251,191,36,0.15)" : "none"
              }}
            >
              <div className="relative">
                <div className="w-16 h-16 rounded-2xl flex items-center justify-center font-black text-xl"
                     style={{ background: style.bg, color: style.color }}>
                  {user.nome[0]}{user.apelido[0]}
                </div>
                <div className="absolute -top-3 -right-3 w-8 h-8 rounded-full flex items-center justify-center border-2 border-[#0f172a]"
                     style={{ background: cfg.color }}>
                  <cfg.icon size={16} className="text-[#0f172a]" />
                </div>
              </div>
              
              <div>
                <p className="font-black text-sm uppercase tracking-tight" style={{ color: T.text(d) }}>
                  {user.apelido}
                </p>
                <p className="text-[10px] font-bold opacity-40 uppercase" style={{ color: T.text(d) }}>
                  {idx + 1}º Lugar
                </p>
              </div>

              <div className="flex items-center gap-4 mt-2">
                <div className="text-center">
                  <p className="text-lg font-black" style={{ color: cfg.color }}>{user.pontos}</p>
                  <p className="text-[8px] font-black uppercase opacity-30" style={{ color: T.text(d) }}>Pontos</p>
                </div>
                <div className="w-px h-6 bg-white/10" />
                <div className="text-center">
                  <p className="text-lg font-black" style={{ color: T.text(d) }}>{user.jogos}</p>
                  <p className="text-[8px] font-black uppercase opacity-30" style={{ color: T.text(d) }}>Jogos</p>
                </div>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Main List - Compact for Desktop */}
      <div className="rounded-[2.5rem] border overflow-hidden" style={{ background: T.surface(d), borderColor: T.border(d) }}>
        <div className="px-6 py-4 border-b flex items-center justify-between" style={{ borderColor: T.border(d) }}>
          <p className="text-[10px] font-black uppercase tracking-widest opacity-40" style={{ color: T.text(d) }}>Classificação Geral</p>
          <div className="flex items-center gap-4 text-[10px] font-black uppercase tracking-widest opacity-40" style={{ color: T.text(d) }}>
            <span>Jogos</span>
            <span className="w-12 text-right">Pts</span>
          </div>
        </div>

        <div className="divide-y" style={{ divideColor: T.border(d) }}>
          {list.map((user, idx) => {
            const rank = idx + 4;
            const isMe = currentUser?.id === user.id;
            return (
              <div 
                key={user.id}
                className="px-6 py-3 flex items-center justify-between transition-colors hover:bg-white/5"
                style={{ background: isMe ? "rgba(251,191,36,0.05)" : "transparent" }}
              >
                <div className="flex items-center gap-4">
                  <span className="w-6 text-[11px] font-black opacity-20" style={{ color: T.text(d) }}>{rank}</span>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center font-black text-[10px]"
                       style={{ background: T.elevated(d), color: T.text(d) }}>
                    {user.nome[0]}
                  </div>
                  <div>
                    <p className="text-xs font-black" style={{ color: T.text(d) }}>{user.apelido}</p>
                    <p className="text-[9px] font-bold opacity-30 uppercase" style={{ color: T.text(d) }}>{user.nome}</p>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                   <span className="text-xs font-bold opacity-40" style={{ color: T.text(d) }}>{user.jogos}</span>
                   <span className="w-12 text-right text-xs font-black" style={{ color: T.text(d) }}>{user.pontos}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
