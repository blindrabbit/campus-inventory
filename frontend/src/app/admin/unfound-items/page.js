"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import Modal from "../../../components/Modal/Modal";
import ModalBody from "../../../components/Modal/ModalBody";
import ModalFooter from "../../../components/Modal/ModalFooter";
import { useToast } from "../../../components/Toast/toastContext";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("pt-BR");
}

function getStatusBadge(statusAtual) {
  if (statusAtual === "MOVIDO_PENDENTE_ACEITE") {
    return {
      label: "Movido - pendente de aceite",
      className: "bg-amber-100 text-amber-800",
    };
  }

  if (statusAtual === "NAO" || statusAtual === "NAO_ENCONTRADO") {
    return {
      label: "Não encontrado",
      className: "bg-red-100 text-red-700",
    };
  }

  if (statusAtual === "PENDENTE") {
    return {
      label: "Pendente",
      className: "bg-slate-100 text-slate-700",
    };
  }

  return {
    label: statusAtual || "-",
    className: "bg-slate-100 text-slate-700",
  };
}

export default function UnfoundItemsPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [items, setItems] = useState([]);
  const [spaces, setSpaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [historyItem, setHistoryItem] = useState(null);
  const [historyDetails, setHistoryDetails] = useState(null);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
  });
  const [filters, setFilters] = useState({
    fromDate: "",
    toDate: "",
    fromSpaceId: "",
    conferente: "",
    action: "",
  });

  useEffect(() => {
    const token = localStorage.getItem("token");
    const inventoryId = localStorage.getItem("activeInventoryId");
    const user = JSON.parse(localStorage.getItem("user") || "null");

    if (!token) {
      router.push("/login");
      return;
    }

    if (!inventoryId) {
      router.push("/inventories");
      return;
    }

    if (user?.role !== "ADMIN") {
      showToast({
        type: "error",
        title: "Acesso negado",
        message: "Somente administradores podem acessar a auditoria.",
      });
      router.push("/dashboard");
      return;
    }

    loadData(token, inventoryId);
  }, [router, showToast]);

  const loadData = async (token, inventoryId) => {
    try {
      const [spacesRes, itemsRes] = await Promise.all([
        axios.get(`${API}/spaces/active`, {
          params: { inventoryId },
          headers: { Authorization: `Bearer ${token}` },
        }),
        axios.get(`${API}/audit/unfound-items`, {
          params: { page: 1, limit: 20, inventoryId },
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);

      setSpaces(spacesRes.data);
      setItems(itemsRes.data.items || itemsRes.data);
      setPagination(
        itemsRes.data.pagination || {
          page: 1,
          limit: 20,
          total: itemsRes.data.length || 0,
          totalPages: 1,
        },
      );
    } catch (error) {
      showToast({
        type: "error",
        title: "Falha ao carregar auditoria",
        message:
          error.response?.data?.error ||
          "Não foi possível carregar os itens não localizados.",
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredItems = useMemo(() => items, [items]);

  const refreshAudit = async () => {
    const token = localStorage.getItem("token");
    const inventoryId = localStorage.getItem("activeInventoryId");
    const params = Object.fromEntries(
      Object.entries(filters).filter(([, value]) => value),
    );
    params.inventoryId = inventoryId;
    params.page = pagination.page;
    params.limit = pagination.limit;

    try {
      const { data } = await axios.get(`${API}/audit/unfound-items`, {
        params,
        headers: { Authorization: `Bearer ${token}` },
      });
      setItems(data.items || data);
      setPagination(
        data.pagination || {
          page: pagination.page,
          limit: pagination.limit,
          total: (data.items || data).length,
          totalPages: 1,
        },
      );
    } catch (error) {
      showToast({
        type: "error",
        title: "Falha ao filtrar auditoria",
        message:
          error.response?.data?.error || "Não foi possível aplicar os filtros.",
      });
    }
  };

  const goToPage = async (nextPage) => {
    const token = localStorage.getItem("token");
    const inventoryId = localStorage.getItem("activeInventoryId");
    const params = Object.fromEntries(
      Object.entries(filters).filter(([, value]) => value),
    );
    params.inventoryId = inventoryId;
    params.page = nextPage;
    params.limit = pagination.limit;

    try {
      const { data } = await axios.get(`${API}/audit/unfound-items`, {
        params,
        headers: { Authorization: `Bearer ${token}` },
      });

      setItems(data.items || data);
      setPagination(
        data.pagination || {
          page: nextPage,
          limit: pagination.limit,
          total: (data.items || data).length,
          totalPages: nextPage,
        },
      );
    } catch (error) {
      showToast({
        type: "error",
        title: "Falha ao paginar auditoria",
        message:
          error.response?.data?.error || "Não foi possível navegar na página.",
      });
    }
  };

  const openHistory = async (item) => {
    const token = localStorage.getItem("token");
    const inventoryId = localStorage.getItem("activeInventoryId");
    setHistoryItem(item);
    setHistoryDetails(null);

    try {
      const { data } = await axios.get(
        `${API}/audit/items/${item.id}/history`,
        {
          params: { inventoryId },
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      setHistoryDetails(data);
    } catch (error) {
      showToast({
        type: "error",
        title: "Falha ao carregar histórico",
        message:
          error.response?.data?.error ||
          "Não foi possível abrir o histórico do item.",
      });
    }
  };

  const markFound = async (itemId) => {
    const token = localStorage.getItem("token");
    const inventoryId = localStorage.getItem("activeInventoryId");
    try {
      await axios.post(
        `${API}/items/${itemId}/restore`,
        { inventoryId },
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      showToast({
        type: "success",
        title: "Item marcado como encontrado",
        message: "O registro de auditoria foi atualizado com sucesso.",
      });
      await refreshAudit();
    } catch (error) {
      showToast({
        type: "error",
        title: "Falha ao atualizar item",
        message:
          error.response?.data?.error ||
          "Não foi possível marcar o item como encontrado.",
      });
    }
  };

  const handleExportAudit = async () => {
    const token = localStorage.getItem("token");
    if (!token) {
      showToast({
        type: "error",
        title: "Erro de autenticação",
        message: "Token não encontrado. Faça login novamente.",
      });
      return;
    }

    setExporting(true);
    try {
      const params = Object.fromEntries(
        Object.entries(filters).filter(([, value]) => value),
      );
      params.inventoryId = localStorage.getItem("activeInventoryId");

      const response = await axios.get(`${API}/export/audit-xlsx`, {
        params,
        headers: { Authorization: `Bearer ${token}` },
        responseType: "blob",
      });

      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;

      const contentDisposition = response.headers["content-disposition"];
      const fileName = contentDisposition
        ? contentDisposition.split("filename=")[1].replace(/['"]/g, "")
        : "inventario_auditoria.xlsx";

      link.setAttribute("download", fileName);
      document.body.appendChild(link);
      link.click();
      link.parentNode.removeChild(link);
      window.URL.revokeObjectURL(url);

      showToast({
        type: "success",
        title: "Exportação concluída",
        message: `Arquivo ${fileName} foi baixado com sucesso.`,
      });
    } catch (error) {
      showToast({
        type: "error",
        title: "Falha ao exportar auditoria",
        message:
          error.response?.data?.error ||
          "Não foi possível gerar o arquivo XLSX.",
      });
    } finally {
      setExporting(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-center text-slate-600">
        Carregando auditoria...
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <div className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.2em] text-sky-600">
                Auditoria
              </p>
              <h1 className="mt-2 text-2xl font-bold text-slate-900">
                Itens não localizados e movidos pendentes
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Consulta de rastreabilidade, histórico e recuperação de itens.
              </p>
            </div>
            <button
              type="button"
              onClick={() => router.push("/dashboard")}
              className="self-start rounded-xl border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              ← Voltar ao dashboard
            </button>
          </div>

          <div className="mt-6 grid gap-3 md:grid-cols-5">
            <input
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              type="date"
              value={filters.fromDate}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, fromDate: e.target.value }))
              }
            />
            <input
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              type="date"
              value={filters.toDate}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, toDate: e.target.value }))
              }
            />
            <select
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              value={filters.fromSpaceId}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, fromSpaceId: e.target.value }))
              }
            >
              <option value="">Espaço de origem</option>
              {spaces.map((space) => (
                <option key={space.id} value={space.id}>
                  {space.name}
                </option>
              ))}
            </select>
            <input
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              placeholder="Conferente"
              value={filters.conferente}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, conferente: e.target.value }))
              }
            />
            <select
              className="rounded-xl border border-slate-200 px-3 py-2 text-sm"
              value={filters.action}
              onChange={(e) =>
                setFilters((prev) => ({ ...prev, action: e.target.value }))
              }
            >
              <option value="">Ação</option>
              <option value="NAO_LOCALIZADO">NAO_LOCALIZADO</option>
              <option value="REALOCADO">REALOCADO</option>
              <option value="ESTORNADO">ESTORNADO</option>
            </select>
          </div>

          <div className="mt-4 flex justify-end gap-3">
            <button
              type="button"
              onClick={handleExportAudit}
              disabled={exporting}
              className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {exporting ? "Exportando..." : "📊 Exportar XLSX"}
            </button>
            <button
              type="button"
              onClick={refreshAudit}
              className="rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700"
            >
              Aplicar filtros
            </button>
          </div>
        </div>

        <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-200">
          <table className="min-w-full divide-y divide-slate-200">
            <thead className="bg-slate-50">
              <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                <th className="px-6 py-4">Nº Patrimônio</th>
                <th className="px-6 py-4">Descrição</th>
                <th className="px-6 py-4">Último local conhecido</th>
                <th className="px-6 py-4">Última conferência</th>
                <th className="px-6 py-4">Conferente</th>
                <th className="px-6 py-4">Status atual</th>
                <th className="px-6 py-4">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {filteredItems.length === 0 ? (
                <tr>
                  <td
                    className="px-6 py-10 text-center text-sm text-slate-500"
                    colSpan={7}
                  >
                    Nenhum item não localizado ou movido pendente encontrado.
                  </td>
                </tr>
              ) : (
                filteredItems.map((item) =>
                  (() => {
                    const statusBadge = getStatusBadge(item.statusAtual);

                    return (
                      <tr key={item.id} className="align-top">
                        <td className="px-6 py-4 text-sm font-semibold text-slate-900">
                          {item.patrimonio}
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-700">
                          {item.descricao}
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-700">
                          {item.ultimoLocalConhecido || "-"}
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-700">
                          {formatDate(item.dataUltimaAlteracao)}
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-700">
                          {item.conferente || "-"}
                        </td>
                        <td className="px-6 py-4 text-sm">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusBadge.className}`}
                          >
                            {statusBadge.label}
                          </span>
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => openHistory(item)}
                              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                            >
                              📋 Histórico
                            </button>
                            <button
                              type="button"
                              onClick={() => markFound(item.id)}
                              className="rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
                            >
                              ✅ Marcar como Encontrado
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })(),
                )
              )}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between rounded-3xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200">
          <p className="text-sm text-slate-600">
            Página {pagination.page} de {pagination.totalPages} •{" "}
            {pagination.total} itens
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => goToPage(Math.max(pagination.page - 1, 1))}
              disabled={pagination.page <= 1}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Anterior
            </button>
            <button
              type="button"
              onClick={() =>
                goToPage(Math.min(pagination.page + 1, pagination.totalPages))
              }
              disabled={pagination.page >= pagination.totalPages}
              className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Próxima
            </button>
          </div>
        </div>
      </div>

      <Modal
        isOpen={Boolean(historyItem)}
        onClose={() => setHistoryItem(null)}
        title={
          historyItem ? `Histórico #${historyItem.patrimonio}` : "Histórico"
        }
        size="lg"
      >
        <ModalBody>
          {!historyDetails ? (
            <p className="text-sm text-slate-500">Carregando histórico...</p>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-slate-600">
                {historyDetails.item?.descricao}
              </p>
              <div className="max-h-[60vh] space-y-3 overflow-auto pr-1">
                {historyDetails.history.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-slate-900">
                          {entry.action}
                        </p>
                        <p className="mt-1 text-xs text-slate-500">
                          {formatDate(entry.createdAt)} • {entry.createdBy}
                        </p>
                      </div>
                    </div>
                    <div className="mt-3 space-y-1 text-sm text-slate-700">
                      <p>De: {entry.fromSpaceName || "-"}</p>
                      <p>Para: {entry.toSpaceName || "-"}</p>
                      {entry.reason ? (
                        <p>Justificativa: {entry.reason}</p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <button
            type="button"
            onClick={() => setHistoryItem(null)}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Fechar
          </button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
