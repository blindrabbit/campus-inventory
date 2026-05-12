"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";

// ─── helpers ─────────────────────────────────────────────────────────────────

function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function fmtDate(v) {
  if (!v) return "—";
  return new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "medium" });
}

function statusColor(code) {
  if (code >= 500) return "bg-red-100 text-red-800";
  if (code >= 400) return "bg-amber-100 text-amber-800";
  if (code >= 200) return "bg-green-100 text-green-800";
  return "bg-slate-100 text-slate-700";
}

function methodColor(m) {
  if (m === "DELETE") return "text-red-600 font-bold";
  if (m === "POST")   return "text-blue-600 font-semibold";
  if (m === "PUT" || m === "PATCH") return "text-amber-600 font-semibold";
  return "text-slate-500";
}

const PATH_LABELS = {
  "POST /api/backups":             "Criar backup",
  "POST /api/backups/:id/restore": "Restaurar backup",
  "DELETE /api/backups/:id":       "Excluir backup",
  "POST /api/spaces/admin/spaces": "Criar espaço",
  "PUT /api/spaces/admin/spaces/:id":    "Editar espaço",
  "DELETE /api/spaces/admin/spaces/:id": "Excluir espaço",
  "POST /api/items/:id/found":     "Conferir item (encontrado)",
  "POST /api/items/:id/not-found": "Conferir item (não localizado)",
  "POST /api/items/:id/relocate":  "Solicitar realocação",
  "POST /api/auth/login":          "Login",
};

function actionLabel(method, path) {
  return PATH_LABELS[`${method} ${path}`] || `${method} ${path}`;
}

// ─── subcomponents ───────────────────────────────────────────────────────────

function StatCard({ label, value, sub, accent }) {
  const colors = {
    red:   "border-red-400 bg-red-50",
    amber: "border-amber-400 bg-amber-50",
    green: "border-green-400 bg-green-50",
    blue:  "border-blue-400 bg-blue-50",
    slate: "border-slate-300 bg-slate-50",
  };
  return (
    <div className={`rounded-xl border-l-4 p-4 shadow-sm ${colors[accent] || colors.slate}`}>
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className="text-2xl font-bold text-slate-800">{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
    </div>
  );
}

function MiniBar({ label, count, max, color = "bg-blue-500" }) {
  const pct = max > 0 ? Math.max(4, Math.round((count / max) * 100)) : 0;
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="w-48 truncate text-slate-700 text-xs" title={label}>{label}</span>
      <div className="flex-1 bg-slate-100 rounded-full h-2">
        <div className={`${color} h-2 rounded-full`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right text-slate-600 text-xs">{count}</span>
    </div>
  );
}

function DayChart({ byDay }) {
  if (!byDay?.length) return null;
  const maxTotal = Math.max(...byDay.map(d => d.total), 1);
  return (
    <div className="flex items-end gap-1 h-16">
      {byDay.map(d => (
        <div key={d.day} className="flex-1 flex flex-col items-center gap-0.5" title={`${d.day}: ${d.total} eventos, ${d.errors} erros`}>
          <div className="w-full flex flex-col justify-end" style={{ height: "48px" }}>
            <div
              className="w-full rounded-sm bg-blue-200 relative overflow-hidden"
              style={{ height: `${Math.max(4, Math.round((d.total / maxTotal) * 48))}px` }}
            >
              {d.errors > 0 && (
                <div
                  className="absolute bottom-0 left-0 w-full bg-red-400"
                  style={{ height: `${Math.round((d.errors / d.total) * 100)}%` }}
                />
              )}
            </div>
          </div>
          <span className="text-[9px] text-slate-400 rotate-0 leading-none">
            {d.day.slice(5)}
          </span>
        </div>
      ))}
    </div>
  );
}

// ─── main page ───────────────────────────────────────────────────────────────

export default function EventLogPage() {
  const router = useRouter();

  const today = new Date();
  const [filters, setFilters] = useState({
    from: isoDate(new Date(today - 7 * 86400000)),
    to:   isoDate(today),
    userId:     "",
    onlyErrors: false,
  });

  const [insights, setInsights]   = useState(null);
  const [events, setEvents]       = useState([]);
  const [total, setTotal]         = useState(0);
  const [offset, setOffset]       = useState(0);
  const [users, setUsers]         = useState([]);
  const [loading, setLoading]     = useState(true);
  const [loadingIns, setLoadingIns] = useState(true);
  const [tab, setTab]             = useState("eventos"); // "eventos" | "insights"

  const limit = 100;

  const headers = useCallback(() => {
    const token = localStorage.getItem("token");
    const inventoryId = localStorage.getItem("activeInventoryId");
    return {
      headers: { Authorization: `Bearer ${token}` },
      params: { inventoryId },
    };
  }, []);

  const loadUsers = useCallback(async () => {
    try {
      const cfg = headers();
      const { data } = await axios.get(`${API}/audit/event-log/users`, {
        ...cfg,
        params: { ...cfg.params, from: filters.from, to: filters.to },
      });
      setUsers(data);
    } catch { /* silencioso */ }
  }, [filters.from, filters.to, headers]);

  const loadInsights = useCallback(async () => {
    setLoadingIns(true);
    try {
      const cfg = headers();
      const { data } = await axios.get(`${API}/audit/event-log/insights`, {
        ...cfg,
        params: { ...cfg.params, from: filters.from, to: `${filters.to}T23:59:59` },
      });
      setInsights(data);
    } catch { /* silencioso */ } finally { setLoadingIns(false); }
  }, [filters.from, filters.to, headers]);

  const loadEvents = useCallback(async (off = 0) => {
    setLoading(true);
    try {
      const cfg = headers();
      const { data } = await axios.get(`${API}/audit/event-log`, {
        ...cfg,
        params: {
          ...cfg.params,
          from: filters.from,
          to: `${filters.to}T23:59:59`,
          userId:     filters.userId     || undefined,
          onlyErrors: filters.onlyErrors || undefined,
          limit,
          offset: off,
        },
      });
      setEvents(data.rows);
      setTotal(data.total);
      setOffset(off);
    } catch { /* silencioso */ } finally { setLoading(false); }
  }, [filters, headers]);

  // guard: only ADMIN
  useEffect(() => {
    const token = localStorage.getItem("token");
    const user  = JSON.parse(localStorage.getItem("user") || "null");
    if (!token) { router.push("/login"); return; }
    if (user?.role !== "ADMIN") { router.back(); return; }
    loadUsers();
    loadInsights();
    loadEvents(0);
  }, []); // eslint-disable-line

  const applyFilters = () => {
    loadInsights();
    loadEvents(0);
    loadUsers();
  };

  const pages = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-6">
      <div className="max-w-7xl mx-auto space-y-4">

        {/* header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-800">Relatório de Eventos</h1>
            <p className="text-sm text-slate-500">Histórico de ações e erros exibidos aos usuários</p>
          </div>
          <button onClick={() => router.back()} className="text-sm text-slate-500 hover:text-slate-700 underline">
            ← Voltar
          </button>
        </div>

        {/* filtros */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs text-slate-500 mb-1">De</label>
              <input type="date" value={filters.from}
                onChange={e => setFilters(f => ({ ...f, from: e.target.value }))}
                className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-400 outline-none" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Até</label>
              <input type="date" value={filters.to}
                onChange={e => setFilters(f => ({ ...f, to: e.target.value }))}
                className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-400 outline-none" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Usuário</label>
              <select value={filters.userId}
                onChange={e => setFilters(f => ({ ...f, userId: e.target.value }))}
                className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-400 outline-none">
                <option value="">Todos</option>
                {users.map(u => (
                  <option key={u.userId} value={u.userId}>{u.userName || u.userId}</option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer select-none">
              <input type="checkbox" checked={filters.onlyErrors}
                onChange={e => setFilters(f => ({ ...f, onlyErrors: e.target.checked }))}
                className="rounded" />
              Apenas erros
            </label>
            <button onClick={applyFilters}
              className="bg-blue-600 text-white rounded-lg px-4 py-1.5 text-sm font-medium hover:bg-blue-700 transition">
              Filtrar
            </button>
          </div>
        </div>

        {/* tabs */}
        <div className="flex gap-1 bg-slate-200 rounded-xl p-1 w-fit">
          {[["eventos", "Eventos"], ["insights", "Insights"]].map(([key, label]) => (
            <button key={key} onClick={() => setTab(key)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${tab === key ? "bg-white shadow text-slate-800" : "text-slate-500 hover:text-slate-700"}`}>
              {label}
            </button>
          ))}
        </div>

        {/* ── INSIGHTS tab ── */}
        {tab === "insights" && (
          <div className="space-y-4">
            {loadingIns ? (
              <p className="text-slate-400 text-sm text-center py-12">Carregando insights…</p>
            ) : !insights ? (
              <p className="text-slate-400 text-sm text-center py-12">Nenhum dado no período.</p>
            ) : (
              <>
                {/* stat cards */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <StatCard label="Total de eventos" value={insights.total.toLocaleString("pt-BR")} accent="blue" />
                  <StatCard label="Erros (4xx/5xx)" value={insights.errors.toLocaleString("pt-BR")}
                    sub={`${insights.errorRate}% do total`} accent={insights.errorRate > 10 ? "red" : "amber"} />
                  <StatCard label="Erros de servidor (5xx)" value={insights.serverErrors.toLocaleString("pt-BR")}
                    accent={insights.serverErrors > 0 ? "red" : "green"} />
                  <StatCard label="Tempo médio de resposta" value={`${insights.avgMs} ms`}
                    sub={`máx ${insights.maxMs} ms`} accent={insights.avgMs > 2000 ? "amber" : "green"} />
                </div>

                {/* gráfico de barras diárias */}
                {insights.byDay?.length > 0 && (
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                    <h3 className="text-sm font-semibold text-slate-700 mb-3">Eventos por dia
                      <span className="ml-2 font-normal text-slate-400 text-xs">(azul = total · vermelho = erros)</span>
                    </h3>
                    <DayChart byDay={insights.byDay} />
                  </div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* top erros */}
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 md:col-span-1">
                    <h3 className="text-sm font-semibold text-slate-700 mb-3">Erros mais frequentes</h3>
                    {insights.topErrors.length === 0 ? (
                      <p className="text-xs text-slate-400">Nenhum erro no período 🎉</p>
                    ) : (
                      <div className="space-y-2">
                        {insights.topErrors.map((e, i) => (
                          <MiniBar key={i} label={e.msg} count={e.count}
                            max={insights.topErrors[0].count} color="bg-red-400" />
                        ))}
                      </div>
                    )}
                  </div>

                  {/* top endpoints */}
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                    <h3 className="text-sm font-semibold text-slate-700 mb-3">Endpoints com mais erros</h3>
                    {insights.topEndpoints.length === 0 ? (
                      <p className="text-xs text-slate-400">Sem dados.</p>
                    ) : (
                      <div className="space-y-2">
                        {insights.topEndpoints.map((e, i) => (
                          <MiniBar key={i}
                            label={`${e.method} ${e.path}`}
                            count={e.errors}
                            max={Math.max(...insights.topEndpoints.map(x => x.errors), 1)}
                            color="bg-amber-400" />
                        ))}
                      </div>
                    )}
                  </div>

                  {/* top users */}
                  <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                    <h3 className="text-sm font-semibold text-slate-700 mb-3">Usuários com mais erros</h3>
                    {insights.topUsers.length === 0 ? (
                      <p className="text-xs text-slate-400">Sem dados.</p>
                    ) : (
                      <div className="space-y-2">
                        {insights.topUsers.map((u, i) => (
                          <div key={i} className="flex items-center justify-between text-xs">
                            <span className="text-slate-700 truncate">{u.userName || u.userId}</span>
                            <span className="ml-2 whitespace-nowrap text-slate-500">
                              {u.errors} erro{u.errors !== 1 ? "s" : ""} / {u.total} ações
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ── EVENTOS tab ── */}
        {tab === "eventos" && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
              <p className="text-sm text-slate-600">
                {loading ? "Carregando…" : `${total.toLocaleString("pt-BR")} evento${total !== 1 ? "s" : ""}`}
              </p>
              {pages > 1 && (
                <div className="flex items-center gap-2 text-sm text-slate-500">
                  <button onClick={() => loadEvents(Math.max(0, offset - limit))}
                    disabled={currentPage <= 1}
                    className="px-2 py-1 rounded hover:bg-slate-100 disabled:opacity-40">‹</button>
                  <span>Pág. {currentPage} / {pages}</span>
                  <button onClick={() => loadEvents(offset + limit)}
                    disabled={currentPage >= pages}
                    className="px-2 py-1 rounded hover:bg-slate-100 disabled:opacity-40">›</button>
                </div>
              )}
            </div>

            {loading ? (
              <p className="text-center py-16 text-slate-400 text-sm">Carregando eventos…</p>
            ) : events.length === 0 ? (
              <p className="text-center py-16 text-slate-400 text-sm">
                Nenhum evento encontrado no período.<br />
                <span className="text-xs">Ajuste os filtros ou aguarde a geração de novos eventos.</span>
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 text-xs text-slate-500 uppercase tracking-wide">
                      <th className="px-4 py-2 text-left font-medium">Horário</th>
                      <th className="px-4 py-2 text-left font-medium">Usuário</th>
                      <th className="px-4 py-2 text-left font-medium">Ação</th>
                      <th className="px-4 py-2 text-left font-medium">Status</th>
                      <th className="px-4 py-2 text-left font-medium">Tempo</th>
                      <th className="px-4 py-2 text-left font-medium">Mensagem de erro</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {events.map((e) => (
                      <tr key={e.id} className={`hover:bg-slate-50 ${e.status_code >= 400 ? "bg-red-50/30" : ""}`}>
                        <td className="px-4 py-2 text-xs text-slate-500 whitespace-nowrap">{fmtDate(e.ts)}</td>
                        <td className="px-4 py-2 text-xs text-slate-700 whitespace-nowrap">{e.user_name || e.user_id || "—"}</td>
                        <td className="px-4 py-2 text-xs whitespace-nowrap">
                          <span className={`${methodColor(e.method)} mr-1`}>{e.method}</span>
                          <span className="text-slate-500 font-mono">{e.path}</span>
                        </td>
                        <td className="px-4 py-2">
                          <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${statusColor(e.status_code)}`}>
                            {e.status_code}
                          </span>
                        </td>
                        <td className="px-4 py-2 text-xs text-slate-500 whitespace-nowrap">
                          {e.response_ms != null ? `${e.response_ms} ms` : "—"}
                        </td>
                        <td className="px-4 py-2 text-xs text-red-700 max-w-sm">
                          {e.error_msg || <span className="text-slate-300">—</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
