"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";

const ACTION_CONFIG = {
  ENCONTRADO:                 { label: "Encontrado",               icon: "✅", color: "text-emerald-700", bg: "bg-emerald-50",  border: "border-emerald-200" },
  NAO_LOCALIZADO:             { label: "Não localizado",           icon: "🚫", color: "text-rose-700",    bg: "bg-rose-50",     border: "border-rose-200" },
  REALOCADO:                  { label: "Realocado",                icon: "📦", color: "text-violet-700",  bg: "bg-violet-50",   border: "border-violet-200" },
  DESFEITO_ENCONTRADO:        { label: "Conferência desfeita",     icon: "↩️", color: "text-amber-700",   bg: "bg-amber-50",    border: "border-amber-200" },
  ESTORNADO:                  { label: "Relocação desfeita",       icon: "↩️", color: "text-amber-700",   bg: "bg-amber-50",    border: "border-amber-200" },
  NAO_LOCALIZADO_VERIFICACAO: { label: "Não loc. na verificação",  icon: "⚠️", color: "text-red-700",     bg: "bg-red-50",      border: "border-red-200" },
  VERIFICADO:                 { label: "Verificado pelo revisor",  icon: "🔍", color: "text-purple-700",  bg: "bg-purple-50",   border: "border-purple-200" },
  REVERTED_ITEM_NOT_FOUND:    { label: "Sala revertida",           icon: "🔄", color: "text-slate-700",   bg: "bg-slate-50",    border: "border-slate-200" },
};

const STATUS_CONFIG = {
  SIM:      { label: "Encontrado",     bg: "bg-emerald-100", text: "text-emerald-800" },
  NAO:      { label: "Não localizado", bg: "bg-rose-100",    text: "text-rose-800" },
  PENDENTE: { label: "Pendente",       bg: "bg-amber-100",   text: "text-amber-800" },
};

function fmtDateTime(v) {
  if (!v) return "—";
  return new Date(v).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

function fmtDate(v) {
  if (!v) return "—";
  return new Date(v).toLocaleDateString("pt-BR");
}

function fmtCurrency(v) {
  if (v == null) return "—";
  return `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`;
}

export default function ItemsPage() {
  const router = useRouter();

  const [inventoryId, setInventoryId] = useState(null);
  const [token, setToken] = useState(null);

  // Lista
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  // Filtros
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const searchInputRef = useRef(null);

  // Detalhe
  const [selectedItem, setSelectedItem] = useState(null); // { item, history }
  const [detailLoading, setDetailLoading] = useState(false);

  useEffect(() => {
    const t = localStorage.getItem("token");
    const inv = localStorage.getItem("activeInventoryId");
    if (!t || !inv) { router.push("/login"); return; }
    setToken(t);
    setInventoryId(inv);
  }, [router]);

  const loadItems = useCallback(async (t, inv, q, status, pg) => {
    setLoading(true);
    try {
      const { data } = await axios.get(`${API}/audit/items`, {
        params: { inventoryId: inv, q, status, page: pg, limit: 40 },
        headers: { Authorization: `Bearer ${t}` },
      });
      setItems(data.items);
      setTotal(data.total);
      setTotalPages(data.totalPages);
    } catch (err) {
      if (err.response?.status === 403) router.push("/dashboard");
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    if (!token || !inventoryId) return;
    loadItems(token, inventoryId, search, statusFilter, page);
  }, [token, inventoryId, page, loadItems]);

  // Debounce search
  const searchTimeout = useRef(null);
  const handleSearchChange = (v) => {
    setSearch(v);
    clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => {
      setPage(1);
      loadItems(token, inventoryId, v, statusFilter, 1);
    }, 350);
  };

  const handleStatusChange = (v) => {
    setStatusFilter(v);
    setPage(1);
    loadItems(token, inventoryId, search, v, 1);
  };

  const loadDetail = async (itemId) => {
    if (!token || !inventoryId) return;
    setDetailLoading(true);
    setSelectedItem(null);
    try {
      const { data } = await axios.get(`${API}/audit/items/${itemId}/history`, {
        params: { inventoryId },
        headers: { Authorization: `Bearer ${token}` },
      });
      setSelectedItem(data);
    } catch {
      // silently ignore
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-14 flex items-center gap-3">
          <button
            onClick={() => router.push("/dashboard")}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 transition"
          >
            ← Dashboard
          </button>
          <span className="text-slate-300">|</span>
          <h1 className="text-sm font-semibold text-slate-800">Rastreamento de Itens</h1>
          {total > 0 && (
            <span className="ml-auto text-xs text-slate-400">{total.toLocaleString("pt-BR")} itens</span>
          )}
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 flex gap-6">

        {/* ── Coluna esquerda: lista ── */}
        <div className="w-full lg:w-96 shrink-0 flex flex-col gap-3">

          {/* Filtros */}
          <div className="flex flex-col gap-2">
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Buscar por patrimônio ou descrição…"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
            />
            <select
              value={statusFilter}
              onChange={(e) => handleStatusChange(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
            >
              <option value="">Todos os status</option>
              <option value="SIM">✅ Encontrados</option>
              <option value="NAO">🚫 Não localizados</option>
              <option value="PENDENTE">⏳ Pendentes</option>
            </select>
          </div>

          {/* Lista */}
          <div className="flex flex-col gap-1.5">
            {loading && items.length === 0 && (
              <div className="text-center text-sm text-slate-400 py-10">Carregando…</div>
            )}
            {!loading && items.length === 0 && (
              <div className="text-center text-sm text-slate-400 py-10">Nenhum item encontrado.</div>
            )}
            {items.map((item) => {
              const st = STATUS_CONFIG[item.statusEncontrado] || STATUS_CONFIG.NAO;
              const isSelected = selectedItem?.item?.id === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => loadDetail(item.id)}
                  className={`text-left w-full rounded-lg border px-3 py-2.5 transition hover:shadow-sm ${
                    isSelected
                      ? "border-indigo-400 bg-indigo-50 ring-1 ring-indigo-300"
                      : "border-slate-200 bg-white hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-bold text-sm text-slate-800">#{item.patrimonio}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${st.bg} ${st.text}`}>
                      {st.label}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 line-clamp-1">{item.descricao}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{item.currentSpace?.name || "—"}</p>
                </button>
              );
            })}
          </div>

          {/* Paginação */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-xs text-slate-500 pt-1">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1.5 rounded border border-slate-200 bg-white disabled:opacity-40 hover:bg-slate-50 transition"
              >
                ← Anterior
              </button>
              <span>Pág. {page} / {totalPages}</span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1.5 rounded border border-slate-200 bg-white disabled:opacity-40 hover:bg-slate-50 transition"
              >
                Próxima →
              </button>
            </div>
          )}
        </div>

        {/* ── Coluna direita: detalhe ── */}
        <div className="flex-1 min-w-0">
          {!selectedItem && !detailLoading && (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400 text-sm gap-2">
              <span className="text-3xl">📋</span>
              Selecione um item para ver os detalhes e histórico
            </div>
          )}

          {detailLoading && (
            <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
              Carregando…
            </div>
          )}

          {selectedItem && !detailLoading && (
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">

              {/* Cabeçalho do item */}
              <div className="px-6 py-5 border-b border-slate-100">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <h2 className="text-xl font-bold text-slate-800">
                        #{selectedItem.item.patrimonio}
                      </h2>
                      {(() => {
                        const st = STATUS_CONFIG[selectedItem.item.statusEncontrado] || STATUS_CONFIG.NAO;
                        return (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.bg} ${st.text}`}>
                            {st.label}
                          </span>
                        );
                      })()}
                    </div>
                    <p className="text-sm text-slate-600">{selectedItem.item.descricao}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-xs text-slate-400">Sala atual</p>
                    <p className="text-sm font-semibold text-slate-700">
                      {selectedItem.item.currentSpace?.name || "—"}
                    </p>
                  </div>
                </div>
              </div>

              {/* Dados do item */}
              <div className="px-6 py-4 border-b border-slate-100 grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
                {[
                  ["Valor", fmtCurrency(selectedItem.item.valor)],
                  ["Condição original", selectedItem.item.condicaoOriginal || "—"],
                  ["Condição visual", selectedItem.item.condicaoVisual || "—"],
                  ["Código SIA", selectedItem.item.codigoSIA || "—"],
                  ["Fornecedor", selectedItem.item.fornecedor || "—"],
                  ["Tipo de aquisição", selectedItem.item.tipoAquisicao || "—"],
                  ["Data de aquisição", fmtDate(selectedItem.item.dataAquisicao)],
                  ["Documento", selectedItem.item.documento || "—"],
                ].map(([label, value]) => (
                  <div key={label}>
                    <p className="text-xs text-slate-400">{label}</p>
                    <p className="text-sm text-slate-700 font-medium">{value}</p>
                  </div>
                ))}
              </div>

              {/* Timeline de histórico */}
              <div className="px-6 py-5">
                <h3 className="text-sm font-semibold text-slate-700 mb-4">
                  Histórico completo
                  <span className="ml-2 text-xs font-normal text-slate-400">
                    {selectedItem.history.length} registro{selectedItem.history.length !== 1 ? "s" : ""}
                  </span>
                </h3>

                {selectedItem.history.length === 0 && (
                  <p className="text-sm text-slate-400">Nenhuma ação registrada ainda.</p>
                )}

                <ol className="relative border-l-2 border-slate-100 ml-2 space-y-5">
                  {selectedItem.history.map((entry, idx) => {
                    const cfg = ACTION_CONFIG[entry.action] || {
                      label: entry.action, icon: "•", color: "text-slate-600",
                      bg: "bg-slate-50", border: "border-slate-200",
                    };
                    return (
                      <li key={entry.id || idx} className="ml-5 relative">
                        {/* Marcador na linha */}
                        <span className={`absolute -left-[1.65rem] flex h-6 w-6 items-center justify-center rounded-full border-2 border-white text-sm ${cfg.bg}`}>
                          {cfg.icon}
                        </span>

                        <div className={`rounded-lg border px-4 py-3 ${cfg.bg} ${cfg.border}`}>
                          <div className="flex items-start justify-between gap-2 flex-wrap">
                            <span className={`text-sm font-semibold ${cfg.color}`}>
                              {cfg.label}
                            </span>
                            <span className="text-xs text-slate-400 shrink-0">
                              {fmtDateTime(entry.createdAt)}
                            </span>
                          </div>

                          <p className="text-xs text-slate-600 mt-1">
                            por <span className="font-medium">{entry.createdBy}</span>
                          </p>

                          {(entry.fromSpaceName || entry.toSpaceName) && (
                            <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-500 flex-wrap">
                              {entry.fromSpaceName && (
                                <span className="px-2 py-0.5 rounded bg-white border border-slate-200">
                                  {entry.fromSpaceName}
                                </span>
                              )}
                              {entry.fromSpaceName && entry.toSpaceName && (
                                <span className="text-slate-400">→</span>
                              )}
                              {entry.toSpaceName && (
                                <span className="px-2 py-0.5 rounded bg-white border border-slate-200 font-medium">
                                  {entry.toSpaceName}
                                </span>
                              )}
                            </div>
                          )}

                          {entry.reason && (
                            <p className="text-xs text-slate-500 mt-1 italic">"{entry.reason}"</p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
