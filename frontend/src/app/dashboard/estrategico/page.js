"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { useSSE } from "../../../lib/useSSE";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api";

// ── Treemap: binary-partition layout ─────────────────────────────────────────

function binaryLayout(items, x, y, width, height) {
  if (items.length === 0 || width < 2 || height < 2) return [];
  if (items.length === 1) return [{ ...items[0], x, y, width, height }];

  const total = items.reduce((s, i) => s + i.displayValue, 0);
  if (total <= 0) return [];

  // Find the split index whose prefix sum is closest to 50% of total
  let acc = 0;
  let bestSplit = 1;
  let minDiff = Infinity;
  for (let i = 0; i < items.length - 1; i++) {
    acc += items[i].displayValue;
    const diff = Math.abs(acc / total - 0.5);
    if (diff < minDiff) { minDiff = diff; bestSplit = i + 1; }
  }

  const leftFrac = items.slice(0, bestSplit).reduce((s, i) => s + i.displayValue, 0) / total;

  if (width >= height) {
    const lw = Math.max(2, Math.round(width * leftFrac));
    return [
      ...binaryLayout(items.slice(0, bestSplit), x, y, lw, height),
      ...binaryLayout(items.slice(bestSplit), x + lw, y, width - lw, height),
    ];
  } else {
    const th = Math.max(2, Math.round(height * leftFrac));
    return [
      ...binaryLayout(items.slice(0, bestSplit), x, y, width, th),
      ...binaryLayout(items.slice(bestSplit), x, y + th, width, height - th),
    ];
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function completionColor(rate) {
  if (rate >= 1)    return { bg: "#065f46", text: "#d1fae5" };
  if (rate >= 0.75) return { bg: "#15803d", text: "#dcfce7" };
  if (rate >= 0.5)  return { bg: "#ca8a04", text: "#fefce8" };
  if (rate >= 0.25) return { bg: "#ea580c", text: "#fff7ed" };
  if (rate > 0)     return { bg: "#dc2626", text: "#fef2f2" };
  return                   { bg: "#7f1d1d", text: "#fee2e2" };
}

function fmtPct(n, d) {
  if (!d) return "—";
  return `${Math.round((n / d) * 100)}%`;
}

function abbreviateName(name) {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return [parts[0], ...parts.slice(1).map((p) => p[0] + ".")].join(" ");
}

const LEGEND = [
  ["#7f1d1d", "0%"],
  ["#dc2626", "1–24%"],
  ["#ea580c", "25–49%"],
  ["#ca8a04", "50–74%"],
  ["#15803d", "75–99%"],
  ["#065f46", "100%"],
];

const KPI_CONFIG = [
  { key: "checked",   label: "Conferidos",         icon: "✅", bg: "#eff6ff", border: "#bfdbfe", text: "#1d4ed8" },
  { key: "unfound",   label: "Não Localizados",     icon: "❌", bg: "#fff1f2", border: "#fecdd3", text: "#be123c" },
  { key: "relocated", label: "Movidos (pendente)",  icon: "↪️", bg: "#fffbeb", border: "#fde68a", text: "#b45309" },
  { key: "pending",   label: "Pendente conferência",icon: "⏳", bg: "#f8fafc", border: "#e2e8f0", text: "#475569" },
];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function EstrategicoDashboardPage() {
  const router = useRouter();
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]           = useState("");
  const [data, setData]             = useState(null);
  const [invName, setInvName]       = useState("");
  const [invId, setInvId]           = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  // Treemap
  const containerRef = useRef(null);
  const [cSize, setCSize]     = useState({ width: 0, height: 0 });
  const [tiles, setTiles]     = useState([]);
  const [selectedTile, setSelectedTile] = useState(null);

  // Location table sort
  const [locSort, setLocSort] = useState("completionAsc");

  // Debounce timer for SSE-triggered refresh
  const refreshTimer = useRef(null);

  // ── Shared API call (used by initial load and SSE-triggered refresh) ────────
  const doFetch = useCallback((token, inventoryId, { silent = false } = {}) => {
    if (silent) setRefreshing(true);
    else { setLoading(true); setError(""); }

    return axios
      .get(`${API}/dashboard/strategic`, {
        params: { inventoryId },
        headers: { Authorization: `Bearer ${token}` },
      })
      .then((r) => {
        const payload = r.data || {};
        setData({
          spaces: Array.isArray(payload.spaces) ? payload.spaces : [],
          byUser: Array.isArray(payload.byUser) ? payload.byUser : [],
          inventoryName: payload.inventoryName || "",
          campus: payload.campus || "",
        });
        setLastUpdated(new Date());
        if (!silent) setSelectedTile(null);
      })
      .catch((e) => { if (!silent) setError(e.response?.data?.error || "Erro ao carregar dados."); })
      .finally(() => { setLoading(false); setRefreshing(false); });
  }, []);

  // ── Initial fetch ─────────────────────────────────────────────────────────
  const fetchData = useCallback(() => {
    const token = localStorage.getItem("token");
    if (!token) { router.push("/login"); return; }

    const inventoryId = localStorage.getItem("activeInventoryId");
    if (!inventoryId) { router.push("/inventories"); return; }

    setInvId(inventoryId);
    try {
      const inv = JSON.parse(localStorage.getItem("activeInventory") || "{}");
      setInvName(inv.name || "");
    } catch (_) {}

    doFetch(token, inventoryId);
  }, [router, doFetch]);

  useEffect(fetchData, []);

  // ── SSE: auto-refresh on inventory activity ───────────────────────────────
  const { lastEvent } = useSSE({ inventoryId: invId, enabled: !!invId && !loading });

  useEffect(() => {
    if (!lastEvent || !invId) return;
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      const token = localStorage.getItem("token");
      if (token) doFetch(token, invId, { silent: true });
    }, 3000); // debounce: wait 3s after last event before refreshing
  }, [lastEvent, invId, doFetch]);

  // ── Measure treemap container ─────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;
    const measure = () => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (rect) setCSize({ width: Math.round(rect.width), height: Math.round(rect.height) });
    };
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(containerRef.current);
    return () => obs.disconnect();
  }, [data]);

  // ── Compute treemap layout ────────────────────────────────────────────────
  useEffect(() => {
    if (!data || cSize.width < 10) return;
    const { width, height } = cSize;

    const filtered = data.spaces.filter((sp) => sp.totalItems > 0);
    if (filtered.length === 0) { setTiles([]); return; }

    // sqrt compression: evens out extreme size differences so small rooms
    // stay visible while large ones don't dominate overwhelmingly
    const sqrtMax = Math.sqrt(Math.max(...filtered.map((sp) => sp.totalItems)));
    const floor   = sqrtMax * 0.07; // smallest tile = 7% of largest sqrt

    const items = filtered
      .map((sp) => ({
        ...sp,
        displayValue: Math.max(Math.sqrt(sp.totalItems), floor),
      }))
      .sort((a, b) => b.displayValue - a.displayValue);

    setTiles(binaryLayout(items, 0, 0, width, height));
  }, [data, cSize]);

  // ── Derived totals ────────────────────────────────────────────────────────
  const totals = (data?.spaces || []).reduce(
    (acc, sp) => ({
      items:     acc.items     + (sp.totalItems     || 0),
      checked:   acc.checked   + (sp.checkedCount   || 0),
      unfound:   acc.unfound   + (sp.unfoundCount   || 0),
      pending:   acc.pending   + (sp.pendingCount   || 0),
      relocated: acc.relocated + (sp.relocatedPending || 0),
    }),
    { items: 0, checked: 0, unfound: 0, pending: 0, relocated: 0 },
  );

  // ── Sorted locations ──────────────────────────────────────────────────────
  const sortedSpaces = [...(data?.spaces || [])].sort((a, b) => {
    const actA = a.totalItems - (a.unfoundCount || 0);
    const actB = b.totalItems - (b.unfoundCount || 0);
    const rA = actA > 0 ? a.checkedCount / actA : a.totalItems > 0 ? 1 : 0;
    const rB = actB > 0 ? b.checkedCount / actB : b.totalItems > 0 ? 1 : 0;
    if (locSort === "completionAsc")  return rA - rB;
    if (locSort === "completionDesc") return rB - rA;
    if (locSort === "totalDesc")      return b.totalItems - a.totalItems;
    return a.name.localeCompare(b.name, "pt-BR");
  });

  // ── Render states ─────────────────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <p className="text-slate-500 animate-pulse">Carregando painel estratégico...</p>
    </div>
  );

  if (error) return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center">
      <div className="text-center space-y-3">
        <p className="text-rose-600 font-medium">{error}</p>
        <button onClick={() => router.back()} className="text-sky-600 text-sm underline">← Voltar</button>
      </div>
    </div>
  );

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-slate-50">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-10 bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          <button
            onClick={() => router.back()}
            className="flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800 transition"
          >
            ← Voltar
          </button>
          <div className="h-4 w-px bg-slate-200" />
          <div className="flex-1 min-w-0">
            <h1 className="text-sm font-bold text-slate-900">Painel Estratégico</h1>
            {invName && <p className="text-xs text-slate-500 truncate">{invName}</p>}
          </div>

          {/* Live status indicator */}
          <div className="flex items-center gap-2 shrink-0">
            {refreshing ? (
              <span className="flex items-center gap-1.5 text-xs text-amber-600">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-pulse" />
                Atualizando...
              </span>
            ) : lastUpdated ? (
              <span className="flex items-center gap-1.5 text-xs text-emerald-600">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                {`Atualizado às ${lastUpdated.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`}
              </span>
            ) : null}
            <button
              onClick={fetchData}
              className="text-xs text-sky-600 hover:underline"
            >
              ↺ Atualizar
            </button>
            <button
              onClick={() => router.push("/dashboard/items")}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition font-medium"
            >
              📋 Rastrear itens
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8 space-y-8">

        {/* ── KPI Cards ────────────────────────────────────────────────────── */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {KPI_CONFIG.map(({ key, label, icon, bg, border, text }) => {
            const val = totals[key];
            return (
              <div
                key={key}
                style={{ backgroundColor: bg, borderColor: border }}
                className="rounded-2xl border p-5 shadow-sm"
              >
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
                  {icon} {label}
                </p>
                <p style={{ color: text }} className="text-3xl font-bold">
                  {val.toLocaleString("pt-BR")}
                </p>
                <p className="text-xs text-slate-400 mt-1">
                  {fmtPct(val, totals.items)} · {totals.items.toLocaleString("pt-BR")} itens total
                </p>
                {/* mini progress bar */}
                <div className="mt-3 h-1.5 rounded-full bg-slate-200 overflow-hidden">
                  <div
                    style={{ width: `${totals.items ? Math.round((val / totals.items) * 100) : 0}%`, backgroundColor: text }}
                    className="h-full rounded-full transition-all"
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Treemap ──────────────────────────────────────────────────────── */}
        <section className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 pt-5 pb-3">
            <h2 className="text-sm font-bold text-slate-800">🗺️ Mapa de Localizações</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Tamanho = volume de itens (mín 2% · máx 25%) · Cor = taxa de conclusão · Clique para abrir a sala
            </p>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3">
              {LEGEND.map(([color, label]) => (
                <div key={label} className="flex items-center gap-1.5">
                  <div style={{ background: color }} className="w-3 h-3 rounded-sm shrink-0" />
                  <span className="text-xs text-slate-500">{label}</span>
                </div>
              ))}
            </div>
          </div>

          <div
            ref={containerRef}
            className="relative h-[520px] mx-5 mb-5 rounded-xl overflow-hidden bg-slate-100"
          >
            {tiles.map((tile) => {
              const tileActive = tile.totalItems - (tile.unfoundCount || 0);
              const rate = tileActive > 0 ? tile.checkedCount / tileActive : tile.totalItems > 0 ? 1 : 0;
              const { bg, text } = completionColor(rate);
              const w = Math.max(tile.width - 2, 2);
              const h = Math.max(tile.height - 2, 2);
              const showName = w > 40 && h > 22;
              const showPct  = w > 52 && h > 36;
              const showCnt  = w > 75 && h > 58;
              const isSelected = selectedTile?.spaceId === tile.spaceId;
              return (
                <div
                  key={tile.spaceId}
                  onClick={() => setSelectedTile(isSelected ? null : tile)}
                  title={`${tile.name} — ${tile.checkedCount}/${tileActive} (${Math.round(rate * 100)}%)`}
                  style={{
                    position: "absolute",
                    left:   tile.x + 1,
                    top:    tile.y + 1,
                    width:  w,
                    height: h,
                    backgroundColor: bg,
                    color: text,
                    borderRadius: 5,
                    overflow: "hidden",
                    cursor: "pointer",
                    transition: "opacity 0.15s, box-shadow 0.15s",
                    boxShadow: isSelected ? "0 0 0 2.5px white, 0 0 0 4px rgba(99,102,241,0.9)" : "none",
                    zIndex: isSelected ? 10 : 1,
                  }}
                  className={isSelected ? "" : "hover:opacity-80"}
                >
                  <div style={{ padding: "4px 5px" }} className="h-full flex flex-col justify-between">
                    {showName && (
                      <p style={{ fontSize: 9, fontWeight: 600, lineHeight: 1.2 }} className="line-clamp-2 break-words">
                        {tile.name}
                      </p>
                    )}
                    {showPct && (
                      <div>
                        <p style={{ fontSize: 13, fontWeight: 700, lineHeight: 1 }}>
                          {Math.round(rate * 100)}%
                        </p>
                        {showCnt && (
                          <p style={{ fontSize: 8, opacity: 0.75, marginTop: 2 }}>
                            {tile.checkedCount}/{tileActive}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Tile detail panel ────────────────────────────────────────────── */}
        {selectedTile && (() => {
          const t = selectedTile;
          const tActive = t.totalItems - (t.unfoundCount || 0);
          const rate = tActive > 0 ? t.checkedCount / tActive : t.totalItems > 0 ? 1 : 0;
          const { bg } = completionColor(rate);

          const status = t.isVerifiedByRevisor
            ? { label: "Verificada pelo revisor", cls: "bg-violet-100 text-violet-700" }
            : t.isFinalized
            ? { label: "Finalizada",              cls: "bg-emerald-100 text-emerald-700" }
            : t.startedAt
            ? { label: "Em andamento",            cls: "bg-amber-100 text-amber-700" }
            : { label: "Não iniciada",            cls: "bg-slate-100 text-slate-500" };

          const fmtDate = (d) => d
            ? new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
            : null;

          return (
            <div className="rounded-2xl bg-white border border-indigo-200 shadow-md overflow-hidden">
              {/* colour stripe */}
              <div style={{ backgroundColor: bg, height: 5 }} />

              <div className="px-5 py-4">
                {/* header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-slate-800 leading-tight truncate">{t.name}</h3>
                    {(t.sector || t.unit) && (
                      <p className="text-xs text-slate-400 mt-0.5">{[t.sector, t.unit].filter(Boolean).join(" · ")}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${status.cls}`}>
                      {status.label}
                    </span>
                    <button
                      onClick={() => router.push(`/room/${t.spaceId}`)}
                      className="flex items-center gap-1 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium rounded-lg transition-colors"
                    >
                      Abrir sala
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17 8l4 4m0 0l-4 4m4-4H3" />
                      </svg>
                    </button>
                    <button
                      onClick={() => setSelectedTile(null)}
                      className="text-slate-400 hover:text-slate-600 text-lg leading-none"
                      aria-label="Fechar"
                    >×</button>
                  </div>
                </div>

                {/* metrics row */}
                <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: "Itens na sala",        value: tActive,        color: "#475569" },
                    { label: "Conferidos",           value: t.checkedCount, color: "#059669" },
                    { label: "Faltam conferir",      value: t.pendingCount, color: "#d97706" },
                    { label: "Não localizados",      value: t.unfoundCount, color: "#e11d48" },
                  ].map(({ label, value, color }) => (
                    <div key={label} className="rounded-xl bg-slate-50 border border-slate-100 px-4 py-3 text-center">
                      <p className="text-[11px] text-slate-500 font-medium mb-1">{label}</p>
                      <p style={{ color }} className="text-2xl font-bold leading-none">{value}</p>
                    </div>
                  ))}
                </div>

                {/* progress bar */}
                <div className="mt-3">
                  <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                    <span>Progresso de conferência</span>
                    <span className="font-semibold text-slate-600">{Math.round(rate * 100)}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      style={{ width: `${Math.round(rate * 100)}%`, backgroundColor: bg }}
                      className="h-full rounded-full transition-all duration-500"
                    />
                  </div>
                </div>

                {/* meta info */}
                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-slate-500">
                  {t.responsible && (
                    <span>👤 <span className="font-medium text-slate-700">Responsável:</span> {t.responsible}</span>
                  )}
                  {t.startedByName && (
                    <span>▶ <span className="font-medium text-slate-700">Iniciado por:</span> {t.startedByName}</span>
                  )}
                  {t.startedAt && (
                    <span>📅 <span className="font-medium text-slate-700">Início em:</span> {fmtDate(t.startedAt)}</span>
                  )}
                  {!t.startedAt && (
                    <span className="text-slate-400 italic">Conferência ainda não iniciada nesta sala</span>
                  )}
                </div>
              </div>
            </div>
          );
        })()}

        {/* ── By User ──────────────────────────────────────────────────────── */}
        <section className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 pt-5 pb-3">
            <h2 className="text-sm font-bold text-slate-800">👥 Atividade por Usuário</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Taxa de conferência = itens conferidos ÷ total de ações realizadas
            </p>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
                  <th className="px-5 py-3 font-semibold">Nome</th>
                  <th className="px-5 py-3 font-semibold text-right text-emerald-600">Conferidos</th>
                  <th className="px-5 py-3 font-semibold text-right text-rose-500">Não localizados</th>
                  <th className="px-5 py-3 font-semibold text-right text-amber-500">Movidos</th>
                  <th className="px-5 py-3 font-semibold text-right">Total ações</th>
                  <th className="px-5 py-3 font-semibold text-right">Taxa conferência</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.byUser.map((u) => {
                  const rate = u.total > 0 ? u.foundCount / u.total : 0;
                  return (
                    <tr key={u.samAccountName} className="hover:bg-slate-50">
                      <td className="px-5 py-3 font-medium text-slate-800">{abbreviateName(u.fullName)}</td>
                      <td className="px-5 py-3 text-right font-semibold text-emerald-600">{u.foundCount}</td>
                      <td className="px-5 py-3 text-right text-rose-500">{u.unfoundCount}</td>
                      <td className="px-5 py-3 text-right text-amber-500">{u.movedCount}</td>
                      <td className="px-5 py-3 text-right text-slate-500">{u.total}</td>
                      <td className="px-5 py-3 text-right">
                        <span className={`font-bold ${rate >= 0.9 ? "text-emerald-600" : rate >= 0.7 ? "text-amber-600" : "text-rose-600"}`}>
                          {Math.round(rate * 100)}%
                        </span>
                        <div className="mt-1 h-1 w-full rounded-full bg-slate-100 overflow-hidden">
                          <div
                            style={{ width: `${Math.round(rate * 100)}%` }}
                            className={`h-full rounded-full ${rate >= 0.9 ? "bg-emerald-500" : rate >= 0.7 ? "bg-amber-400" : "bg-rose-400"}`}
                          />
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {data.byUser.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-sm text-slate-400">
                      Nenhuma atividade registrada ainda.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        {/* ── By Location ──────────────────────────────────────────────────── */}
        <section className="rounded-2xl bg-white border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 pt-5 pb-3 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-sm font-bold text-slate-800">📍 Detalhes por Localização</h2>
              <p className="text-xs text-slate-500 mt-0.5">Clique em uma linha para abrir a sala</p>
            </div>
            <select
              value={locSort}
              onChange={(e) => setLocSort(e.target.value)}
              className="shrink-0 text-xs border border-slate-300 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-sky-200"
            >
              <option value="completionAsc">% Conclusão ↑ (menor primeiro)</option>
              <option value="completionDesc">% Conclusão ↓ (maior primeiro)</option>
              <option value="totalDesc">Volume de itens</option>
              <option value="nameAsc">Nome (A–Z)</option>
            </select>
          </div>
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500">
                  <th className="px-5 py-3 font-semibold">Sala</th>
                  <th className="px-5 py-3 font-semibold text-right">Total</th>
                  <th className="px-5 py-3 font-semibold text-right text-emerald-600">Conferidos</th>
                  <th className="px-5 py-3 font-semibold text-right">%</th>
                  <th className="px-5 py-3 font-semibold text-right text-rose-500">Não localiz.</th>
                  <th className="px-5 py-3 font-semibold text-right text-slate-400">Pendente</th>
                  <th className="px-5 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {sortedSpaces.map((sp) => {
                  const spActive = sp.totalItems - (sp.unfoundCount || 0);
                  const rate = spActive > 0 ? sp.checkedCount / spActive : sp.totalItems > 0 ? 1 : 0;
                  const rateColor =
                    rate >= 1 ? "text-emerald-600" :
                    rate >= 0.5 ? "text-amber-600" : "text-rose-600";

                  const status = sp.isVerifiedByRevisor
                    ? { label: "Verificada",    cls: "bg-violet-100 text-violet-700" }
                    : sp.isFinalized
                    ? { label: "Finalizada",    cls: "bg-emerald-100 text-emerald-700" }
                    : sp.startedAt
                    ? { label: "Em andamento",  cls: "bg-amber-100 text-amber-700" }
                    : { label: "Não iniciada",  cls: "bg-slate-100 text-slate-500" };

                  return (
                    <tr
                      key={sp.spaceId}
                      onClick={() => router.push(`/room/${sp.spaceId}`)}
                      className="hover:bg-slate-50 cursor-pointer"
                    >
                      <td className="px-5 py-3 font-medium text-slate-800 max-w-[220px]">
                        <p className="truncate">{sp.name}</p>
                        {sp.sector && <p className="text-xs text-slate-400 truncate">{sp.sector}</p>}
                      </td>
                      <td className="px-5 py-3 text-right text-slate-500">{spActive}</td>
                      <td className="px-5 py-3 text-right font-semibold text-emerald-600">{sp.checkedCount}</td>
                      <td className="px-5 py-3 text-right">
                        <span className={`font-bold ${rateColor}`}>{Math.round(rate * 100)}%</span>
                        <div className="mt-1 h-1 w-full rounded-full bg-slate-100 overflow-hidden">
                          <div
                            style={{ width: `${Math.round(rate * 100)}%` }}
                            className={`h-full rounded-full ${rate >= 1 ? "bg-emerald-500" : rate >= 0.5 ? "bg-amber-400" : "bg-rose-400"}`}
                          />
                        </div>
                      </td>
                      <td className="px-5 py-3 text-right text-rose-500">{sp.unfoundCount || 0}</td>
                      <td className="px-5 py-3 text-right text-slate-400">{sp.pendingCount}</td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${status.cls}`}>
                          {status.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

      </main>
    </div>
  );
}
