
import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Users,
  Target,
  Clock,
  Gamepad2,
  CheckCircle2,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { T } from "../constants/theme";
import { useRodada, useSerieCRodada } from "../hooks/useRodada";
import { UserBetsList } from "./UserBetsList";
import { fmtDate, todayMidnight } from "../utils/format";
import { League, LEAGUES } from "../types";

interface AdminPanelProps {
  isDark: boolean;
}

export function AdminPanel({ isDark }: AdminPanelProps) {
  const d = isDark;
  const [admTab, setAdmTab] = useState<"dashboard" | "pending" | "bets" | "jogos">(
    "dashboard",
  );
  const [pending, setPending] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [totalBets, setTotalBets] = useState(0);
  const [userTotal, setUserTotal] = useState(0);

  // Controle de jogos selecionados
  const [selectedMatchIds, setSelectedMatchIds] = useState<string[]>([]);
  const [admLeague, setAdmLeague] = useState<League>("bra.1");

  // Re-usando lógica de rodada para mostrar os jogos no palpite do usuário
  const [anchorTs] = useState(() => todayMidnight());
  const { data: roundData } = useRodada(
    anchorTs,
    "bra.1",
  );

  // TheSportsDB para Série C no admin
  const [admShowPast] = useState(false);
  const { data: serieCAdmData } =
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

    const { data: allUsers } = await supabase
      .from("usuarios")
      .select("id, nome, sobrenome, apelido")
      .eq("status", "aprovado");

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
    setTotalBets(betsData?.length || 0);
    setUserTotal(allUsers?.length || 0);
    setSelectedMatchIds((selMatches || []).map((m) => m.match_id));
    setLoading(false);
  };

  useEffect(() => {
    fetchData();
  }, []);

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
        ) : (
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
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
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
