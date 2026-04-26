import React, { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Swords,
  AlertCircle,
  CheckCircle2,
  Sun,
  Moon,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { T } from "../constants/theme";

interface LoginProps {
  onLogin: () => void;
  isDark: boolean;
}

export function Login({ onLogin, isDark }: LoginProps) {
  const d = isDark;
  const [mode, setMode] = useState<"login" | "register">("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [success, setSuccess] = useState(false);

  // Form states
  const [user, setUser] = useState(""); // email or nickname
  const [pass, setPass] = useState("");
  const [nome, setNome] = useState("");
  const [sobrenome, setSobrenome] = useState("");
  const [apelido, setApelido] = useState("");
  const [email, setEmail] = useState("");
  const [rememberMe, setRememberMe] = useState(true);

  useEffect(() => {
    const saved = localStorage.getItem("bolao_remembered_user");
    if (saved) setUser(saved);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (loading || success) return;
    setLoading(true);
    setError(false);

    try {
      let authData;
      if (mode === "login") {
        const isEmail = user.includes("@");
        const field = isEmail ? "email" : "apelido";
        const { data, error: err } = await supabase
          .from("usuarios")
          .select("*")
          .eq(field, user.trim())
          .eq("senha", pass)
          .single();
        
        if (err || !data) throw new Error("Credenciais inválidas");
        authData = data;
      } else {
        if (!nome.trim() || !email.trim() || !pass.trim()) {
          throw new Error("Preencha todos os campos obrigatórios");
        }
        const { data, error: err } = await supabase
          .from("usuarios")
          .insert([{
            nome: nome.trim(),
            sobrenome: sobrenome.trim(),
            apelido: apelido.trim() || nome.trim(),
            email: email.trim().toLowerCase(),
            senha: pass,
            status: "pendente",
          }])
          .select()
          .single();
        
        if (err) {
          if (err.code === "23505") throw new Error("E-mail ou apelido já cadastrado");
          throw new Error("Erro ao cadastrar. Tente novamente.");
        }
        authData = data;
        setSuccess(true);
        setTimeout(() => {
            setMode("login");
            setSuccess(false);
        }, 3000);
        return;
      }

      if (authData.status === "pendente") {
        throw new Error("Sua conta está aguardando aprovação.");
      }
      if (authData.status === "inativo") {
        throw new Error("Esta conta foi desativada.");
      }

      if (rememberMe) {
        localStorage.setItem("bolao_remembered_user", user.trim());
      } else {
        localStorage.removeItem("bolao_remembered_user");
      }

      localStorage.setItem("bolao_user", JSON.stringify(authData));
      onLogin();
    } catch (err: any) {
      setError(true);
      setErrorMessage(err.message || "Erro inesperado");
      setTimeout(() => setError(false), 5000);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div 
      className="min-h-screen flex items-center justify-center p-6 relative overflow-hidden"
      style={{ background: T.bg(d) }}
    >
      <div className="absolute inset-0 opacity-20 pointer-events-none"
        style={{ 
          backgroundImage: "radial-gradient(circle at 2px 2px, rgba(251,191,36,0.15) 1px, transparent 0)",
          backgroundSize: "40px 40px"
        }}
      />
      
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md relative z-10"
      >
        <div className="text-center mb-10">
          <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-amber-400 to-orange-500 flex items-center justify-center mx-auto mb-6 shadow-2xl shadow-amber-500/20">
            <Swords size={40} className="text-slate-950" />
          </div>
          <h1 className="text-4xl font-black tracking-tighter" style={{ color: T.text(d) }}>
            BOLÃO <span className="text-amber-400">CLASSICS</span>
          </h1>
          <p className="text-sm opacity-50 mt-2 font-medium" style={{ color: T.text(d) }}>
            {mode === "login" ? "Entre e faça seus palpites" : "Crie sua conta para participar"}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="p-8 rounded-[2.5rem] border backdrop-blur-xl shadow-2xl shadow-black/10"
            style={{ background: T.surface(d), borderColor: T.border(d) }}
          >
            <div className="space-y-4">
              {mode === "register" && (
                <div className="grid grid-cols-2 gap-4">
                  <input
                    placeholder="Nome"
                    value={nome}
                    onChange={e => setNome(e.target.value)}
                    className="w-full px-5 py-4 rounded-2xl outline-none border transition-all text-sm font-bold"
                    style={{ background: T.inputBg(d), borderColor: T.inputBdr(d), color: T.text(d) }}
                  />
                  <input
                    placeholder="Sobrenome"
                    value={sobrenome}
                    onChange={e => setSobrenome(e.target.value)}
                    className="w-full px-5 py-4 rounded-2xl outline-none border transition-all text-sm font-bold"
                    style={{ background: T.inputBg(d), borderColor: T.inputBdr(d), color: T.text(d) }}
                  />
                </div>
              )}

              <input
                type={mode === "login" ? "text" : "email"}
                placeholder={mode === "login" ? "E-mail ou Apelido" : "E-mail"}
                value={mode === "login" ? user : email}
                onChange={e => mode === "login" ? setUser(e.target.value) : setEmail(e.target.value)}
                className="w-full px-5 py-4 rounded-2xl outline-none border transition-all text-sm font-bold"
                style={{ background: T.inputBg(d), borderColor: T.inputBdr(d), color: T.text(d) }}
              />

              {mode === "register" && (
                 <input
                  placeholder="Apelido no App"
                  value={apelido}
                  onChange={e => setApelido(e.target.value)}
                  className="w-full px-5 py-4 rounded-2xl outline-none border transition-all text-sm font-bold"
                  style={{ background: T.inputBg(d), borderColor: T.inputBdr(d), color: T.text(d) }}
                />
              )}

              <input
                type="password"
                placeholder="Sua senha"
                value={pass}
                onChange={e => setPass(e.target.value)}
                className="w-full px-5 py-4 rounded-2xl outline-none border transition-all text-sm font-bold"
                style={{ background: T.inputBg(d), borderColor: T.inputBdr(d), color: T.text(d) }}
              />

              {mode === "login" && (
                <label className="flex items-center gap-3 px-1 cursor-pointer group">
                  <input 
                    type="checkbox" 
                    checked={rememberMe} 
                    onChange={e => setRememberMe(e.target.checked)}
                    className="w-5 h-5 rounded-lg border-2 border-amber-400/30 text-amber-400 focus:ring-0 accent-amber-400"
                  />
                  <span className="text-xs font-bold opacity-60 group-hover:opacity-100 transition-opacity" style={{ color: T.text(d) }}>
                    Lembrar meu acesso
                  </span>
                </label>
              )}
            </div>

            <AnimatePresence>
              {error && (
                <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
                  className="mt-6 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-500 text-xs font-bold flex items-center gap-2"
                >
                  <AlertCircle size={16} />
                  {errorMessage}
                </motion.div>
              )}
              {success && (
                <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }}
                  className="mt-6 p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-500 text-xs font-bold flex items-center gap-2"
                >
                  <CheckCircle2 size={16} />
                  Conta criada! Aguarde aprovação.
                </motion.div>
              )}
            </AnimatePresence>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-8 py-5 rounded-2xl bg-gradient-to-r from-amber-400 to-orange-500 text-slate-950 font-black text-sm uppercase tracking-wider shadow-xl shadow-amber-500/20 active:scale-[0.98] transition-all disabled:opacity-50"
            >
              {loading ? "Processando..." : (mode === "login" ? "Acessar Bolão" : "Criar Minha Conta")}
            </button>
          </div>
        </form>

        <button
          onClick={() => setMode(mode === "login" ? "register" : "login")}
          className="w-full mt-8 text-sm font-black text-amber-400 hover:scale-105 active:scale-95 transition-all"
        >
          {mode === "login" ? "Não tem uma conta? Cadastre-se" : "Já possui conta? Faça login"}
        </button>
      </motion.div>
    </div>
  );
}
