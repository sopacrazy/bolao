# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev       # Start dev server at http://localhost:3000
npm run build     # Production build
npm run lint      # Type-check with tsc --noEmit
npm run clean     # Remove dist/
```

## Architecture

Single-page React app (Vite + TypeScript + Tailwind CSS v4) with all UI in [src/App.tsx](src/App.tsx).

**App flow:**
1. `Login` component gates access — hardcoded credentials (`marcos` / `123`)
2. After login, `App` renders a 3-tab shell: **Apostar**, **Ranking**, **Informativo**
3. Tab content swaps via `AnimatePresence` (Framer Motion via `motion/react`)

**Key data:**
- `mockMatches` — 10 Brazilian Série A fixtures (static, not fetched)
- `mockRanking` — 59 participants with random points (regenerated on each render)
- `finance` constants — prize pool math: gross → subtract 15% work + 10% commission → split 70/30

**Theme:** Dark/light toggle stored in `isDark` state at the root; propagated as a prop to every component. No context or store — everything lives in `App`.

**Environment:** `GEMINI_API_KEY` is loaded from `.env.local` via Vite and exposed as `process.env.GEMINI_API_KEY`, but not yet used in the UI code.

**`@` alias** resolves to the repo root (not `src/`).
