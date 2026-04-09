"use client";
import { useEffect, useState, useCallback } from "react";
import { useRouter, useParams } from "next/navigation";
import axios from "axios";
import { enqueueAction, useAutoSave } from "../../../lib/syncQueue";
import Modal from "../../../components/Modal/Modal";
import ModalBody from "../../../components/Modal/ModalBody";
import ModalFooter from "../../../components/Modal/ModalFooter";
import ConfirmModal from "../../../components/ConfirmModal/ConfirmModal";
import { useToast } from "../../../components/Toast/toastContext";
import SpaceSearchBar from "../../../components/SpaceSearchBar/SpaceSearchBar";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";

export default function RoomPage() {
  const params = useParams();
  const router = useRouter();
  const spaceId = params.spaceId;
  const autoSave = useAutoSave();
  const { showToast } = useToast();

  const [space, setSpace] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedItem, setExpandedItem] = useState(null);
  const [user, setUser] = useState(null);
  const [relocateModal, setRelocateModal] = useState(null); // { itemId, currentSpace }
  const [spaces, setSpaces] = useState([]);
  const [saving, setSaving] = useState(false);
  const [showAddPatrimonio, setShowAddPatrimonio] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [searchError, setSearchError] = useState("");
  const [isFinalizeModalOpen, setIsFinalizeModalOpen] = useState(false);
  const [pendingMoveCandidate, setPendingMoveCandidate] = useState(null);
  const [pendingUnfoundItem, setPendingUnfoundItem] = useState(null);
  const [activeTab, setActiveTab] = useState("itens");
  const [movementHistory, setMovementHistory] = useState([]);
  const [movementLoading, setMovementLoading] = useState(false);
  const [movementPagination, setMovementPagination] = useState({
    page: 1,
    limit: 20,
    total: 0,
    totalPages: 1,
  });

  useEffect(() => {
    const token = localStorage.getItem("token");
    const userData = localStorage.getItem("user");
    const inventoryId = localStorage.getItem("activeInventoryId");
    if (!token) {
      router.push("/login");
      return;
    }
    if (!inventoryId) {
      router.push("/inventories");
      return;
    }
    setUser(JSON.parse(userData));
    loadData(token, inventoryId);
    loadMovementHistory(token, inventoryId, 1);
  }, [spaceId, router]);

  const loadMovementHistory = async (token, inventoryId, page = 1) => {
    setMovementLoading(true);
    try {
      const { data } = await axios.get(`${API}/audit/space-movements`, {
        params: {
          inventoryId,
          spaceId,
          page,
          limit: 20,
        },
        headers: { Authorization: `Bearer ${token}` },
      });

      setMovementHistory(data.items || []);
      setMovementPagination(
        data.pagination || {
          page,
          limit: 20,
          total: (data.items || []).length,
          totalPages: 1,
        },
      );
    } catch (err) {
      showToast({
        type: "error",
        title: "Falha ao carregar histórico",
        message:
          err.response?.data?.error ||
          "Não foi possível carregar as movimentações desta sala.",
      });
    } finally {
      setMovementLoading(false);
    }
  };

  const goToMovementPage = async (nextPage) => {
    const token = localStorage.getItem("token");
    const inventoryId = localStorage.getItem("activeInventoryId");
    await loadMovementHistory(token, inventoryId, nextPage);
  };

  const formatMovementDate = (value) => {
    if (!value) return "-";
    return new Date(value).toLocaleString("pt-BR");
  };

  const getDirectionBadgeClass = (direction) => {
    if (direction === "ENTRADA") return "bg-emerald-100 text-emerald-700";
    if (direction === "SAIDA") return "bg-amber-100 text-amber-800";
    return "bg-slate-100 text-slate-700";
  };

  const loadData = async (token, inventoryId) => {
    try {
      const [spacesRes, itemsRes] = await Promise.all([
        axios.get(`${API}/spaces/active`, {
          params: { includeFinalized: "true", inventoryId },
          headers: { Authorization: `Bearer ${token}` },
        }),
        axios.get(`${API}/items?spaceId=${spaceId}`, {
          params: { inventoryId },
          headers: { Authorization: `Bearer ${token}` },
        }),
      ]);
      setSpaces(spacesRes.data);
      setItems(itemsRes.data);
      setSpace(spacesRes.data.find((s) => s.id === spaceId));
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleCheck = useCallback(
    (itemId, condicao) => {
      setSaving(true);
      autoSave(() => {
        const inventoryId = localStorage.getItem("activeInventoryId");
        enqueueAction({
          endpoint: "/items/check",
          method: "POST",
          payload: { itemId, condicao, inventoryId },
        });

        setItems((prev) =>
          prev.map((i) =>
            i.id === itemId
              ? { ...i, statusEncontrado: "SIM", condicaoVisual: condicao }
              : i,
          ),
        );
        setSaving(false);
      });
    },
    [autoSave],
  );

  const handleRelocate = useCallback(
    (itemId, targetSpaceId) => {
      setSaving(true);
      autoSave(() => {
        const inventoryId = localStorage.getItem("activeInventoryId");
        enqueueAction({
          endpoint: "/items/relocate",
          method: "POST",
          payload: { itemId, targetSpaceId, inventoryId },
        });

        // Atualiza UI localmente
        setItems((prev) => prev.filter((i) => i.id !== itemId));
        setRelocateModal(null);
        setSaving(false);
      });
    },
    [autoSave],
  );

  const confirmFinalize = async () => {
    try {
      const token = localStorage.getItem("token");
      const inventoryId = localStorage.getItem("activeInventoryId");
      await axios.post(
        `${API}/spaces/${spaceId}/finalize`,
        { inventoryId },
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      showToast({
        type: "success",
        title: "Espaço finalizado",
        message: "A conferência foi encerrada com sucesso.",
      });
      router.push("/dashboard");
    } catch (err) {
      showToast({
        type: "error",
        title: "Erro ao finalizar",
        message:
          err.response?.data?.error ||
          "Não foi possível finalizar este espaço.",
      });
    } finally {
      setIsFinalizeModalOpen(false);
    }
  };

  const handleSearchPatrimonio = async () => {
    const query = searchTerm.trim();
    if (query.length < 2) {
      showToast({
        type: "warning",
        title: "Busca inválida",
        message: "Digite ao menos 2 caracteres para buscar um patrimônio.",
      });
      setSearchError("Digite ao menos 2 caracteres para buscar");
      setSearchResults([]);
      return;
    }

    setSearching(true);
    setSearchError("");

    try {
      const token = localStorage.getItem("token");
      const inventoryId = localStorage.getItem("activeInventoryId");
      const { data } = await axios.get(`${API}/items/search`, {
        params: {
          inventoryId,
          q: query,
          excludeSpaceId: spaceId,
        },
        headers: { Authorization: `Bearer ${token}` },
      });
      setSearchResults(data);
      if (data.length === 0) {
        showToast({
          type: "error",
          title: "Patrimônio não encontrado",
          message: "Patrimônio não consta no registro oficial.",
        });
        setSearchError("Nenhum patrimônio encontrado para este termo");
      }
    } catch (err) {
      const message = err.response?.data?.error || "Erro ao buscar patrimônios";
      setSearchError(message);
      setSearchResults([]);
      showToast({
        type: "error",
        title: "Falha na busca",
        message,
      });
    } finally {
      setSearching(false);
    }
  };

  const confirmMoveToCurrentRoom = useCallback(() => {
    if (!pendingMoveCandidate) return;

    setSaving(true);
    autoSave(() => {
      const inventoryId = localStorage.getItem("activeInventoryId");
      enqueueAction({
        endpoint: "/items/relocate",
        method: "POST",
        payload: {
          itemId: pendingMoveCandidate.id,
          targetSpaceId: spaceId,
          inventoryId,
        },
      });

      setSearchResults((prev) =>
        prev.filter((result) => result.id !== pendingMoveCandidate.id),
      );
      setSearchTerm("");
      setShowAddPatrimonio(false);
      setPendingMoveCandidate(null);
      setSaving(false);
      showToast({
        type: "success",
        title: "Movimentação registrada",
        message: "A realocação foi enviada para sincronização.",
      });
    });
  }, [autoSave, pendingMoveCandidate, showToast, spaceId]);

  const handleMoveToCurrentRoom = (candidate) => {
    setPendingMoveCandidate(candidate);
  };

  const handleUnfoundItem = () => {
    if (!pendingUnfoundItem) return;

    enqueueAction({
      endpoint: "/items/unfound",
      method: "POST",
      payload: {
        itemId: pendingUnfoundItem.id,
        inventoryId: localStorage.getItem("activeInventoryId"),
      },
    });

    setItems((prev) => prev.filter((i) => i.id !== pendingUnfoundItem.id));
    setPendingUnfoundItem(null);
    setRelocateModal(null);

    showToast({
      type: "info",
      title: "Item removido da sala",
      message:
        "O item foi marcado como não localizado e enviado para sincronização.",
    });
  };

  const handleUndoLastAction = async (item) => {
    if (!item?.meta?.isRelocated) {
      showToast({
        type: "warning",
        title: "Ação indisponível",
        message:
          "Desfazer está disponível apenas para itens realocados pendentes.",
      });
      return;
    }

    try {
      setSaving(true);
      const token = localStorage.getItem("token");
      const inventoryId = localStorage.getItem("activeInventoryId");
      await axios.post(
        `${API}/items/${item.id}/restore`,
        { inventoryId },
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      setItems((prev) => prev.filter((i) => i.id !== item.id));
      setExpandedItem((prev) => (prev === item.id ? null : prev));

      showToast({
        type: "success",
        title: "Ação desfeita",
        message: "A realocação pendente foi revertida com sucesso.",
      });
    } catch (err) {
      showToast({
        type: "error",
        title: "Falha ao desfazer",
        message:
          err.response?.data?.error ||
          "Não foi possível desfazer a ação deste item.",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="p-8 text-center">Carregando...</div>;
  if (!space)
    return (
      <div className="p-8 text-center text-red-600">Espaço não encontrado</div>
    );

  const progress =
    items.length > 0
      ? Math.round(
          (items.filter((i) => i.statusEncontrado === "SIM").length /
            items.length) *
            100,
        )
      : 0;

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header Fixo */}
      <header className="bg-white shadow-lg border-b sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 py-4">
          {/* <div className="mb-4">
            <SpaceSearchBar placeholder="Buscar espaços por nome..." />
          </div> */}
          <div className="flex justify-between items-center mb-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{space.name}</h1>
              <p className="text-sm text-gray-500">
                Resp: {space.responsibleDisplay || space.responsible}
              </p>
            </div>
            <button
              onClick={() => router.push("/dashboard")}
              className="text-gray-600 hover:text-gray-900"
            >
              ← Voltar
            </button>
          </div>

          <div className="w-full bg-gray-200 rounded-full h-2.5 mb-1">
            <div
              className="bg-green-600 h-2.5 rounded-full transition-all"
              style={{ width: `${progress}%` }}
            ></div>
          </div>
          <div className="flex justify-between text-xs text-gray-500">
            <span>{progress}% conferido</span>
            <span>
              {items.filter((i) => i.statusEncontrado === "SIM").length}/
              {items.length} itens
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-6 space-y-4">
        <div className="bg-white rounded-xl shadow p-2 inline-flex gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("itens")}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${
              activeTab === "itens"
                ? "bg-sky-600 text-white"
                : "text-slate-700 hover:bg-slate-100"
            }`}
          >
            Itens da sala
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("historico")}
            className={`px-4 py-2 rounded-lg text-sm font-medium ${
              activeTab === "historico"
                ? "bg-sky-600 text-white"
                : "text-slate-700 hover:bg-slate-100"
            }`}
          >
            Histórico de movimentações
          </button>
        </div>

        {activeTab === "historico" ? (
          <>
            <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-200">
              <table className="min-w-full divide-y divide-slate-200">
                <thead className="bg-slate-50">
                  <tr className="text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                    <th className="px-6 py-4">Nº Patrimônio</th>
                    <th className="px-6 py-4">Descrição</th>
                    <th className="px-6 py-4">Movimento</th>
                    <th className="px-6 py-4">Origem → Destino</th>
                    <th className="px-6 py-4">Responsável</th>
                    <th className="px-6 py-4">Data</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {movementLoading ? (
                    <tr>
                      <td
                        className="px-6 py-10 text-center text-sm text-slate-500"
                        colSpan={6}
                      >
                        Carregando movimentações...
                      </td>
                    </tr>
                  ) : movementHistory.length === 0 ? (
                    <tr>
                      <td
                        className="px-6 py-10 text-center text-sm text-slate-500"
                        colSpan={6}
                      >
                        Nenhuma movimentação encontrada para esta sala.
                      </td>
                    </tr>
                  ) : (
                    movementHistory.map((entry) => (
                      <tr key={entry.id} className="align-top">
                        <td className="px-6 py-4 text-sm font-semibold text-slate-900">
                          {entry.patrimonio}
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-700">
                          {entry.descricao}
                        </td>
                        <td className="px-6 py-4 text-sm">
                          <span
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${getDirectionBadgeClass(entry.direction)}`}
                          >
                            {entry.direction}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-700">
                          {(entry.fromSpaceName || "-") +
                            " → " +
                            (entry.toSpaceName || "-")}
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-700">
                          {entry.createdBy || "-"}
                        </td>
                        <td className="px-6 py-4 text-sm text-slate-700">
                          {formatMovementDate(entry.createdAt)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between rounded-3xl bg-white px-4 py-3 shadow-sm ring-1 ring-slate-200">
              <p className="text-sm text-slate-600">
                Página {movementPagination.page} de{" "}
                {movementPagination.totalPages} • {movementPagination.total}{" "}
                movimentações
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() =>
                    goToMovementPage(Math.max(movementPagination.page - 1, 1))
                  }
                  disabled={movementPagination.page <= 1}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Anterior
                </button>
                <button
                  type="button"
                  onClick={() =>
                    goToMovementPage(
                      Math.min(
                        movementPagination.page + 1,
                        movementPagination.totalPages,
                      ),
                    )
                  }
                  disabled={
                    movementPagination.page >= movementPagination.totalPages
                  }
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Próxima
                </button>
              </div>
            </div>
          </>
        ) : null}

        {activeTab === "itens" ? (
          <div className="bg-white rounded-xl shadow p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-gray-900">
                  Incluir novo patrimônio
                </h3>
                <p className="text-sm text-gray-500">
                  Busque por número ou descrição para mover para esta sala
                </p>
              </div>
              <button
                onClick={() => {
                  setShowAddPatrimonio((prev) => !prev);
                  setSearchError("");
                }}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700"
              >
                {showAddPatrimonio ? "Fechar busca" : "+ Incluir patrimônio"}
              </button>
            </div>

            {showAddPatrimonio && (
              <div className="mt-4 space-y-3">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Ex: 8038 ou MONITOR DELL"
                    className="flex-1 border rounded-lg px-3 py-2"
                  />
                  <button
                    onClick={handleSearchPatrimonio}
                    disabled={searching}
                    className="px-4 py-2 bg-gray-800 text-white rounded-lg hover:bg-black disabled:opacity-50"
                  >
                    {searching ? "Buscando..." : "Buscar"}
                  </button>
                </div>

                {searchError && (
                  <p className="text-sm text-red-600">{searchError}</p>
                )}

                {searchResults.length > 0 && (
                  <ul className="border rounded-lg divide-y max-h-64 overflow-auto">
                    {searchResults.map((candidate) => (
                      <li
                        key={candidate.id}
                        className="p-3 flex items-start justify-between gap-3"
                      >
                        <div>
                          <p className="font-semibold text-sm">
                            #{candidate.patrimonio}
                          </p>
                          <p className="text-sm text-gray-700">
                            {candidate.descricao}
                          </p>
                          <p className="text-xs text-gray-500">
                            Origem: {candidate.spaceName}
                          </p>
                        </div>
                        <button
                          onClick={() => handleMoveToCurrentRoom(candidate)}
                          disabled={saving}
                          className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 disabled:opacity-50"
                        >
                          Mover para esta sala
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        ) : null}

        {activeTab === "itens" && items.length === 0 ? (
          <div className="bg-white p-12 rounded-xl shadow text-center text-gray-500">
            Nenhum item registrado neste espaço.
          </div>
        ) : activeTab === "itens" ? (
          items.map((item) => {
            const formattedValue =
              item.valor != null
                ? `R$ ${Number(item.valor).toFixed(2)}`
                : "N/A";
            const formattedDataAquisicao = item.dataAquisicao
              ? new Date(item.dataAquisicao).toLocaleDateString("pt-BR")
              : "N/A";

            return (
              <div
                key={item.id}
                className={`bg-white rounded-xl shadow border-l-4 transition-all ${
                  item.meta?.isRelocated
                    ? "border-yellow-500 bg-yellow-50"
                    : item.statusEncontrado === "SIM"
                      ? "border-green-500"
                      : "border-gray-300"
                }`}
              >
                {/* Card Colapsado */}
                <div className="p-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <div
                      className="flex-1 cursor-pointer"
                      onClick={() =>
                        setExpandedItem(
                          expandedItem === item.id ? null : item.id,
                        )
                      }
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-bold text-lg">
                          #{item.patrimonio}
                        </span>
                        {item.meta?.isRelocated && (
                          <span className="px-2 py-0.5 bg-yellow-200 text-yellow-800 text-xs rounded font-medium">
                            ⚠️ Movido de {item.meta.fromSpaceName}
                          </span>
                        )}
                        {item.statusEncontrado === "SIM" && (
                          <span className="text-green-600 text-sm">✓</span>
                        )}
                      </div>
                      <p className="text-gray-700 text-sm line-clamp-1">
                        {item.descricao}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2 lg:justify-end">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCheck(
                            item.id,
                            item.condicaoVisual || "EXCELENTE",
                          );
                        }}
                        className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-sm hover:bg-green-700"
                      >
                        ✅ Encontrado
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setRelocateModal(item);
                        }}
                        className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700"
                      >
                        ➡️ Mover
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingUnfoundItem(item);
                        }}
                        className="px-3 py-1.5 bg-red-100 text-red-700 rounded-lg text-sm hover:bg-red-200"
                      >
                        🚫 Não localizado
                      </button>
                    </div>
                  </div>
                </div>

                {/* Expandido */}
                {expandedItem === item.id && (
                  <div className="px-5 pb-5 border-t pt-4">
                    <div className="space-y-2 mb-5 text-sm text-gray-700">
                      <p>
                        <span className="font-semibold">Descrição:</span>{" "}
                        {item.descricao}
                      </p>
                      <p>
                        <span className="font-semibold">Valor:</span>{" "}
                        {formattedValue} |{" "}
                        <span className="font-semibold">
                          Condição Original:
                        </span>{" "}
                        {item.condicaoOriginal || "N/A"}
                      </p>
                      <p>
                        <span className="font-semibold">Código SIA:</span>{" "}
                        {item.codigoSIA || "N/A"} |{" "}
                        <span className="font-semibold">Fornecedor:</span>{" "}
                        {item.fornecedor || "N/A"}
                      </p>
                      <p>
                        <span className="font-semibold">Data Aquisição:</span>{" "}
                        {formattedDataAquisicao} |{" "}
                        <span className="font-semibold">Documento:</span>{" "}
                        {item.documento || "N/A"}
                      </p>
                    </div>

                    <div>
                      <p className="mb-2 text-sm font-semibold text-gray-800">
                        🎨 Estado de Conservação:
                      </p>
                      <div className="flex flex-wrap gap-3 mb-5">
                        {["EXCELENTE", "BOM", "INSERVIVEL"].map((status) => (
                          <button
                            key={status}
                            onClick={() => handleCheck(item.id, status)}
                            className={`py-2 px-4 rounded-lg font-medium transition ${
                              item.condicaoVisual === status
                                ? "bg-blue-600 text-white"
                                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                            }`}
                          >
                            {status === "EXCELENTE"
                              ? "🟢 Ótimo"
                              : status === "BOM"
                                ? "🟡 Regular"
                                : "🔴 Ruim"}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="mb-2 text-sm font-semibold text-gray-800">
                        ⚙️ Ações:
                      </p>
                      <button
                        onClick={() => handleUndoLastAction(item)}
                        disabled={saving}
                        className="px-3 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
                      >
                        ↩️ Desfazer
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        ) : null}

        {activeTab === "itens" ? (
          <div className="flex justify-end pt-4">
            <button
              onClick={() => setIsFinalizeModalOpen(true)}
              className="px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 shadow-lg"
            >
              🏁 Sala Finalizada
            </button>
          </div>
        ) : null}
      </main>

      {/* Modal de Realocação */}
      <Modal
        isOpen={Boolean(relocateModal)}
        onClose={() => setRelocateModal(null)}
        title={
          relocateModal
            ? `Realocar #${relocateModal.patrimonio}`
            : "Realocar item"
        }
        size="md"
      >
        <ModalBody>
          <p className="text-sm text-gray-600 mb-4">
            Selecione o novo espaço de destino:
          </p>
          <select
            className="w-full border rounded-lg p-3 mb-4"
            onChange={(e) =>
              e.target.value &&
              relocateModal &&
              handleRelocate(relocateModal.id, e.target.value)
            }
            defaultValue=""
          >
            <option value="">Selecione um espaço...</option>
            {spaces
              .filter((s) => s.id !== spaceId)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </ModalBody>
        <ModalFooter>
          <button
            onClick={() => setRelocateModal(null)}
            className="px-4 py-2 text-gray-600 hover:bg-gray-100 rounded-lg"
          >
            Cancelar
          </button>
          <button
            onClick={() =>
              relocateModal && setPendingUnfoundItem(relocateModal)
            }
            className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700"
          >
            Marcar como Não Localizado
          </button>
        </ModalFooter>
      </Modal>

      <ConfirmModal
        isOpen={isFinalizeModalOpen}
        onConfirm={confirmFinalize}
        onCancel={() => setIsFinalizeModalOpen(false)}
        title="Finalizar sala"
        message="Finalizar conferência deste espaço? Esta ação bloqueará novas edições."
        confirmText="Finalizar"
        cancelText="Cancelar"
        variant="danger"
      />

      <ConfirmModal
        isOpen={Boolean(pendingMoveCandidate)}
        onConfirm={confirmMoveToCurrentRoom}
        onCancel={() => setPendingMoveCandidate(null)}
        title="Confirmar realocação"
        message={
          pendingMoveCandidate
            ? `Deseja mover o patrimônio #${pendingMoveCandidate.patrimonio} para a sala atual (${space.name})? Origem atual: ${pendingMoveCandidate.spaceName}.`
            : ""
        }
        confirmText="Mover item"
        cancelText="Cancelar"
        variant="warning"
      />

      <ConfirmModal
        isOpen={Boolean(pendingUnfoundItem)}
        onConfirm={handleUnfoundItem}
        onCancel={() => setPendingUnfoundItem(null)}
        title="Confirmar remoção"
        message={
          pendingUnfoundItem
            ? `Marcar o patrimônio #${pendingUnfoundItem.patrimonio} como não localizado?`
            : ""
        }
        confirmText="Confirmar remoção"
        cancelText="Cancelar"
        variant="danger"
      />
    </div>
  );
}
