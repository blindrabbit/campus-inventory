"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { useToast } from "../../../components/Toast/toastContext";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";

const PRINT_STYLES = `
@media print {
  @page {
    size: A4 landscape;
    margin: 10mm;
  }

  html,
  body {
    background: #ffffff !important;
  }

  .no-print {
    display: none !important;
  }

  .print-root {
    background: #ffffff !important;
    padding: 0 !important;
  }

  .print-sheet {
    box-shadow: none !important;
    border: none !important;
    border-radius: 0 !important;
    padding: 0 !important;
    max-width: none !important;
  }

  .print-table {
    font-size: 9.5pt;
    border: 1px solid #475569;
  }

  .print-table thead {
    display: table-header-group;
  }

  .print-table tfoot {
    display: table-footer-group;
  }

  .print-table tr {
    break-inside: avoid;
    page-break-inside: avoid;
  }

  .print-table th,
  .print-table td {
    border: 1px solid #94a3b8 !important;
    padding: 4pt 6pt !important;
    color: #000000 !important;
    background: #ffffff !important;
  }

  .print-table thead th {
    background: #e2e8f0 !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }

  .print-badge {
    border: 1px solid #64748b !important;
    background: #ffffff !important;
    color: #000000 !important;
  }
}
`;

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("pt-BR");
}

function normalize(value) {
  return (value || "")
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function spaceStatusLabel(space) {
  if (!space.isActive) return "Desativado";
  if (space.isVerifiedByRevisor) return "Verificado";
  if (space.isFinalized) return "Lacrado";
  if (space.executionStatus === "INICIADO") return "Em conferência";
  return "Não iniciado";
}

function itemStatusLabel(status) {
  if (status === "SIM") return "Encontrado";
  if (status === "NAO") return "Não localizado";
  if (status === "PENDENTE") return "Pendente";
  return status || "-";
}

export default function SpaceObservationsPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [spaces, setSpaces] = useState([]);
  const [duplicates, setDuplicates] = useState([]);
  const [inventoryName, setInventoryName] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("todos");
  const [generatedAt] = useState(() => new Date());

  useEffect(() => {
    const token = localStorage.getItem("token");
    const inventoryId = localStorage.getItem("activeInventoryId");
    const user = JSON.parse(localStorage.getItem("user") || "null");
    const activeInventory = JSON.parse(
      localStorage.getItem("activeInventory") || "null",
    );

    if (!token) {
      router.push("/login");
      return;
    }

    if (!inventoryId) {
      router.push("/inventories");
      return;
    }

    const allowed =
      user?.role === "ADMIN" ||
      activeInventory?.role === "ADMIN_CICLO" ||
      activeInventory?.role === "REVISOR";

    if (!allowed) {
      showToast({
        type: "error",
        title: "Acesso negado",
        message:
          "Somente administradores e revisores podem acessar este relatório.",
      });
      router.push("/dashboard");
      return;
    }

    setInventoryName(activeInventory?.name || "");

    const loadData = async () => {
      try {
        const [spacesRes, duplicatesRes] = await Promise.all([
          axios.get(`${API}/spaces/active`, {
            params: { inventoryId, includeFinalized: "true" },
            headers: { Authorization: `Bearer ${token}` },
          }),
          axios.get(`${API}/items/duplicates`, {
            params: { inventoryId },
            headers: { Authorization: `Bearer ${token}` },
          }),
        ]);

        setSpaces(spacesRes.data || []);
        setDuplicates(duplicatesRes.data || []);
      } catch (error) {
        showToast({
          type: "error",
          title: "Falha ao carregar relatório",
          message:
            error.response?.data?.error ||
            "Não foi possível carregar as observações dos espaços.",
        });
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [router, showToast]);

  const duplicatesBySpaceId = useMemo(() => {
    const map = new Map();
    duplicates.forEach((item) => {
      const key = item.space?.id || "__sem_espaco__";
      const list = map.get(key) || [];
      list.push(item);
      map.set(key, list);
    });
    return map;
  }, [duplicates]);

  const rows = useMemo(() => {
    const built = spaces.map((space) => ({
      id: space.id,
      name: space.name,
      sector: space.sector,
      unit: space.unit,
      responsible: space.responsibleDisplay || space.responsible,
      status: spaceStatusLabel(space),
      observacoes: (space.observacoes || "").trim(),
      duplicates: duplicatesBySpaceId.get(space.id) || [],
    }));

    const orphanDuplicates = duplicatesBySpaceId.get("__sem_espaco__") || [];
    if (orphanDuplicates.length > 0) {
      built.push({
        id: "__sem_espaco__",
        name: "Sem espaço vinculado",
        sector: null,
        unit: null,
        responsible: null,
        status: "-",
        observacoes: "",
        duplicates: orphanDuplicates,
      });
    }

    const term = normalize(search.trim());

    return built
      .filter((row) => row.observacoes || row.duplicates.length > 0)
      .filter((row) => {
        if (filter === "observacoes") return Boolean(row.observacoes);
        if (filter === "duplicatas") return row.duplicates.length > 0;
        return true;
      })
      .filter((row) => {
        if (!term) return true;
        const haystack = normalize(
          [
            row.name,
            row.sector,
            row.unit,
            row.responsible,
            row.observacoes,
            ...row.duplicates.map((d) =>
              [d.patrimonio, d.descricao, d.duplicateNotes].join(" "),
            ),
          ].join(" "),
        );
        return haystack.includes(term);
      })
      .sort((a, b) =>
        a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }),
      );
  }, [spaces, duplicatesBySpaceId, search, filter]);

  const totals = useMemo(
    () => ({
      spacesWithObservations: rows.filter((row) => row.observacoes).length,
      spacesWithDuplicates: rows.filter((row) => row.duplicates.length > 0)
        .length,
      duplicateItems: rows.reduce((acc, row) => acc + row.duplicates.length, 0),
    }),
    [rows],
  );

  if (loading) {
    return (
      <div className="p-8 text-center text-slate-600">
        Carregando observações...
      </div>
    );
  }

  return (
    <div className="print-root min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <style>{PRINT_STYLES}</style>

      <div className="mx-auto max-w-7xl space-y-6">
        <div className="print-sheet rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-sky-600">
                Relatório
              </p>
              <h1 className="mt-2 text-2xl font-bold text-slate-900">
                Observações dos espaços e duplicatas
              </h1>
              <p className="mt-1 text-sm text-slate-600">
                {inventoryName ? `Inventário: ${inventoryName} · ` : ""}
                Emitido em {formatDate(generatedAt)}
              </p>
            </div>
            <div className="no-print flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => router.push("/dashboard")}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                ← Voltar ao dashboard
              </button>
              <button
                type="button"
                onClick={() => window.print()}
                className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700"
              >
                🖨️ Imprimir
              </button>
            </div>
          </div>

          <div className="mt-6 grid gap-3 text-sm text-slate-700 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-200 px-4 py-3">
              <span className="block text-xs uppercase tracking-wide text-slate-500">
                Espaços com observações
              </span>
              <strong className="text-lg text-slate-900">
                {totals.spacesWithObservations}
              </strong>
            </div>
            <div className="rounded-xl border border-slate-200 px-4 py-3">
              <span className="block text-xs uppercase tracking-wide text-slate-500">
                Espaços com duplicatas
              </span>
              <strong className="text-lg text-slate-900">
                {totals.spacesWithDuplicates}
              </strong>
            </div>
            <div className="rounded-xl border border-slate-200 px-4 py-3">
              <span className="block text-xs uppercase tracking-wide text-slate-500">
                Itens sinalizados como duplicata
              </span>
              <strong className="text-lg text-slate-900">
                {totals.duplicateItems}
              </strong>
            </div>
          </div>

          <div className="no-print mt-4 grid gap-3 md:grid-cols-[2fr_1fr]">
            <input
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              placeholder="Buscar por espaço, setor, responsável, texto da observação ou patrimônio"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <select
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="todos">Observações e duplicatas</option>
              <option value="observacoes">Somente com observações</option>
              <option value="duplicatas">Somente com duplicatas</option>
            </select>
          </div>
        </div>

        <div className="print-sheet overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="print-table w-full table-fixed border-collapse text-sm">
            <colgroup>
              <col className="w-[18%]" />
              <col className="w-[14%]" />
              <col className="w-[10%]" />
              <col className="w-[30%]" />
              <col className="w-[28%]" />
            </colgroup>
            <thead className="bg-slate-50">
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                <th className="px-4 py-3">Espaço</th>
                <th className="px-4 py-3">Setor / Unidade / Responsável</th>
                <th className="px-4 py-3">Situação</th>
                <th className="px-4 py-3">Observações registradas</th>
                <th className="px-4 py-3">Itens sinalizados como duplicata</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white align-top">
              {rows.length === 0 ? (
                <tr>
                  <td
                    className="px-4 py-10 text-center text-sm text-slate-500"
                    colSpan={5}
                  >
                    Nenhuma observação ou duplicata registrada para os filtros
                    selecionados.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.id} className="align-top">
                    <td className="whitespace-pre-wrap break-words px-4 py-3 font-semibold text-slate-900">
                      {row.name}
                    </td>
                    <td className="whitespace-pre-wrap break-words px-4 py-3 text-slate-700">
                      <div>{row.sector || "-"}</div>
                      {row.unit ? (
                        <div className="text-xs text-slate-500">{row.unit}</div>
                      ) : null}
                      {row.responsible ? (
                        <div className="mt-1 text-xs text-slate-600">
                          Resp.: {row.responsible}
                        </div>
                      ) : null}
                    </td>
                    <td className="whitespace-pre-wrap break-words px-4 py-3 text-slate-700">
                      {row.status}
                    </td>
                    <td className="whitespace-pre-wrap break-words px-4 py-3 leading-relaxed text-slate-800">
                      {row.observacoes || (
                        <span className="text-slate-400">
                          Sem observações registradas
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-800">
                      {row.duplicates.length === 0 ? (
                        <span className="text-slate-400">
                          Nenhuma duplicata sinalizada
                        </span>
                      ) : (
                        <ul className="space-y-2">
                          {row.duplicates.map((item) => (
                            <li
                              key={item.id}
                              className="print-badge rounded-lg border border-orange-200 bg-orange-50 px-3 py-2"
                            >
                              <div className="whitespace-pre-wrap break-words font-semibold">
                                {item.patrimonio || "Sem patrimônio"} —{" "}
                                {item.descricao || "Sem descrição"}
                              </div>
                              <div className="mt-1 text-xs">
                                Situação: {itemStatusLabel(item.statusEncontrado)}
                                {item.itemGroup
                                  ? ` · Grupo: ${item.itemGroup.name}`
                                  : ""}
                                {` · Sinalizado em ${formatDate(item.updatedAt)}`}
                              </div>
                              {item.duplicateNotes ? (
                                <div className="mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed">
                                  Notas: {item.duplicateNotes}
                                </div>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
