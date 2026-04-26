# Análise do Projeto: Bolão

Este documento fornece uma visão geral técnica e funcional do projeto **Bolão**, uma plataforma de palpites para jogos de futebol (focada no Campeonato Brasileiro Série A e Série C).

## 🚀 Tecnologias Utilizadas

### Core
- **Framework**: [React 19](https://react.dev/)
- **Build Tool**: [Vite 6](https://vitejs.dev/)
- **Linguagem**: [TypeScript](https://www.typescriptlang.org/)
- **Estilização**: [Tailwind CSS 4](https://tailwindcss.com/) & [Vanilla CSS](src/index.css)
- **Animações**: [Motion (Framer Motion)](https://motion.dev/)

### Backend & Database
- **Plataforma**: [Supabase](https://supabase.com/)
  - Autenticação de usuários.
  - Banco de dados PostgreSQL para armazenamento de palpites, usuários e configurações.
  - Realtime para atualizações em tempo real.

### Mobile
- **Hybrid Bridge**: [Capacitor](https://capacitorjs.com/)
  - Suporte nativo para Android.
  - Plugins: Splash Screen, Assets management.

### Integrações de API (Esportes)
- **ESPN API**: Utilizada para obter placares e rodadas da **Série A**.
- **TheSportsDB API**: Utilizada para obter dados da **Série C**.

### Inteligência Artificial
- **Google Generative AI (Gemini)**: Integrado para fornecer análises e "insights" de analista pro sobre os jogos e palpites.

---

## 📂 Estrutura do Projeto

```text
bolao/
├── android/              # Código nativo Android (Capacitor)
├── public/               # Ativos estáticos públicos
├── src/
│   ├── components/       # Componentes modulares da interface
│   │   ├── AdminPanel.tsx   # Gerenciamento administrativo
│   │   ├── AnalistaView.tsx # Interface da IA (Gemini)
│   │   ├── Apostar.tsx      # Tela de registro de palpites
│   │   ├── Login.tsx        # Fluxo de autenticação
│   │   ├── Ranking.tsx      # Tabela de classificação
│   │   └── UserBetsList.tsx # Histórico de palpites do usuário
│   ├── lib/              # Configurações de bibliotecas (Supabase)
│   ├── types/            # Definições de tipos TypeScript
│   ├── utils/            # Funções auxiliares (datas, formatação)
│   ├── App.tsx           # Componente principal (lógica central e roteamento)
│   └── main.tsx          # Ponto de entrada da aplicação
├── capacitor.config.ts   # Configuração do Capacitor
├── package.json          # Dependências e scripts
└── vite.config.ts        # Configuração do Vite
```

---

## ✨ Funcionalidades Principais

1. **Gestão de Palpites**:
   - Os usuários podem inserir placares para os jogos das rodadas atuais das Séries A e C.
   - Interface intuitiva com logos dos times e badges de status dos jogos.

2. **Sistema de Pontuação Automatizado**:
   - **Placar Exato**: 25 pontos.
   - **Resultado Correto (Vencedor/Empate)**: 10 pontos.
   - Cálculo automático assim que o status do jogo é alterado para "Final" via APIs externas.

3. **Ranking em Tempo Real**:
   - Classificação geral dos participantes baseada no total de pontos acumulados.
   - Visualização de posições, medalhas e tendências.

4. **Painel Administrativo**:
   - Controle total sobre usuários (ativar/inativar).
   - Gerenciamento de rodadas e visualização de métricas financeiras.

5. **Analista Pro (IA)**:
   - Integração com Gemini para analisar confrontos e sugerir tendências baseadas em dados.

6. **Compartilhamento**:
   - Geração de imagens (screenshots) dos palpites ou ranking para compartilhamento em redes sociais/WhatsApp via `modern-screenshot`.

7. **Suporte Multi-Tema**:
   - Modo Escuro (Dark Mode) e Modo Claro, adaptando-se às preferências do sistema ou escolha do usuário.

---

## 🛠️ Comandos Úteis

- `npm run dev`: Inicia o servidor de desenvolvimento.
- `npm run build`: Gera o bundle de produção.
- `npm run mobile:build`: Compila o web e sincroniza com o Capacitor.
- `npm run mobile:apk`: Gera o arquivo APK para Android (disponível na raiz como `bolao.apk`).

---

## 📝 Observações de Arquitetura

O projeto utiliza uma abordagem de **Single Page Application (SPA)** onde o estado global é gerenciado principalmente através de hooks do React e persistência no Supabase. O arquivo `App.tsx` atua como o orquestrador central, lidando com a lógica de polling das APIs de esportes e gerenciamento de sessões.
