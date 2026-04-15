"use client";
import { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { useRouter, useParams } from "next/navigation";
import axios from "axios";
import { enqueueAction, useAutoSave } from "../../../lib/syncQueue";
import { useSSE } from "../../../lib/useSSE";
import Modal from "../../../components/Modal/Modal";
import ModalBody from "../../../components/Modal/ModalBody";
import ModalFooter from "../../../components/Modal/ModalFooter";
import ConfirmModal from "../../../components/ConfirmModal/ConfirmModal";
import { useToast } from "../../../components/Toast/toastContext";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";

const HISTORY_ACTION_CONFIG = {
  ENCONTRADO: {
    label: "Encontrado",
    badgeClass: "bg-blue-100 text-blue-700",
    defaultDirection: "INTERNO",
  },
  NAO_LOCALIZADO: {
    label: "Não localizado",
    badgeClass: "bg-rose-100 text-rose-700",
    defaultDirection: "SAIDA",
  },
  REALOCADO: {
    label: "Realocado",
    badgeClass: "bg-violet-100 text-violet-700",
    defaultDirection: "INTERNO",
  },
  ESTORNADO: {
    label: "Realocação desfeita",
    badgeClass: "bg-orange-100 text-orange-700",
    defaultDirection: "SAIDA",
  },
  DESFEITO_ENCONTRADO: {
    label: "Encontrado desfeito",
    badgeClass: "bg-orange-100 text-orange-700",
    defaultDirection: "INTERNO",
  },
};

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
  const [quickActionMode, setQuickActionMode] = useState("single");
  const [searchTerm, setSearchTerm] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [searchError, setSearchError] = useState("");
  const [isFinalizeModalOpen, setIsFinalizeModalOpen] = useState(false);
  const [pendingMoveCandidate, setPendingMoveCandidate] = useState(null);
  const [groupMoveCount, setGroupMoveCount] = useState("");
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
  const [relocateSearchInput, setRelocateSearchInput] = useState("");
  const [relocateSearchTerm, setRelocateSearchTerm] = useState("");
  const [batchStartPatrimonio, setBatchStartPatrimonio] = useState("");
  const [batchEndPatrimonio, setBatchEndPatrimonio] = useState("");
  const [batchCondicao, setBatchCondicao] = useState("EXCELENTE");
  const [batchPreview, setBatchPreview] = useState(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false);
  const [showFoundItems, setShowFoundItems] = useState(true);
  const [showRelocatedItems, setShowRelocatedItems] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState({});

  // Verification workflow for reviewers
  const [verificationStatus, setVerificationStatus] = useState(null);
  const [verificationItems, setVerificationItems] = useState([]);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isRevertModalOpen, setIsRevertModalOpen] = useState(false);
  const verificationInitiatedRef = useRef(false);
  const [inventoryRole, setInventoryRole] = useState(null);

  // SSE — listen for realtime events from other users in this space
  const currentInventoryId =
    typeof window !== "undefined"
      ? localStorage.getItem("activeInventoryId")
      : null;
  const sseHook = useSSE({
    inventoryId: currentInventoryId,
    spaceId,
    enabled: !!currentInventoryId && !!spaceId,
  });
  const { lastEvent, connectionId } = sseHook;

  // React to SSE events — show toast and refresh data
  const loadDataRef = useMemo(() => ({ current: null }), []);
  useEffect(() => {
    if (!lastEvent) return;
    const token = localStorage.getItem("token");
    if (!token || !loadDataRef.current) {
      return;
    }

    const config = {
      item_relocated: {
        title: "📦 Item movido para esta sala",
        msg: `Um item foi movido para cá por ${lastEvent.data.user}.`,
      },
      group_relocated: {
        title: `📦 ${lastEvent.data.count} ite${lastEvent.data.count > 1 ? "ns" : "m"} movido${lastEvent.data.count > 1 ? "s" : ""} para esta sala`,
        msg: `Grupo movido por ${lastEvent.data.user}.`,
      },
      item_checked: {
        title: "✅ Item conferido",
        msg: `${lastEvent.data.user} marcou um item como encontrado nesta sala.`,
      },
      batch_checked: {
        title: "✅ Conferência em massa",
        msg: `${lastEvent.data.user} conferiu ${lastEvent.data.count} itens nesta sala.`,
      },
      item_restored: {
        title: "🔄 Item restaurado",
        msg: `${lastEvent.data.user} restaurou um item para esta sala.`,
      },
    };

    const c = config[lastEvent.type];
    if (c) {
      showToast({ type: "info", title: c.title, message: c.msg });
      if (loadDataRef.current) {
        loadDataRef.current(token, currentInventoryId);
      }
    }
  }, [lastEvent, showToast, currentInventoryId]);

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

  const getSpaceStartBadge = (spaceData) => {
    // Verificar primeiro se está finalizado
    if (spaceData?.isFinalized) {
      const date = spaceData?.finalizedAt || spaceData?.startedAt;
      const finalizedLabel = date
        ? new Date(date).toLocaleDateString("pt-BR")
        : "--/--/--";
      const finalizedBy =
        spaceData?.finalizedBy ||
        spaceData?.startedByDisplay ||
        spaceData?.startedBy ||
        "usuário não identificado";

      return {
        label: `🟢 Finalizado em ${finalizedLabel} por ${finalizedBy}`,
        className: "bg-emerald-100 text-emerald-800",
      };
    }

    const wasStarted =
      Boolean(spaceData?.startedAt) ||
      spaceData?.executionStatus === "INICIADO" ||
      spaceData?.executionStatus === "FINALIZADO";

    if (wasStarted) {
      const startedLabel = spaceData?.startedAt
        ? new Date(spaceData.startedAt).toLocaleDateString("pt-BR")
        : "--/--/--";
      const startedBy =
        spaceData?.startedByDisplay ||
        spaceData?.startedBy ||
        "usuário não identificado";

      return {
        label: `🟠 Iniciado em ${startedLabel} por ${startedBy}`,
        className: "bg-amber-100 text-amber-800",
      };
    }

    return {
      label: "🔴 Não iniciado",
      className: "bg-rose-100 text-rose-700",
    };
  };;

  const getDirectionBadgeClass = (direction) => {
    if (direction === "ENTRADA") return "bg-emerald-100 text-emerald-700";
    if (direction === "SAIDA") return "bg-amber-100 text-amber-800";
    return "bg-slate-100 text-slate-700";
  };

  const getActionLabel = (action) => {
    return HISTORY_ACTION_CONFIG[action]?.label || action || "Atualização";
  };

  const getActionBadgeClass = (action) => {
    return (
      HISTORY_ACTION_CONFIG[action]?.badgeClass || "bg-slate-100 text-slate-700"
    );
  };

  const prependMovementEntry = useCallback(
    (entry) => {
      setMovementHistory((prev) =>
        [entry, ...prev].slice(0, movementPagination.limit),
      );
      setMovementPagination((prev) => ({
        ...prev,
        total: (prev.total || 0) + 1,
        totalPages: Math.max(
          Math.ceil(((prev.total || 0) + 1) / (prev.limit || 20)),
          1,
        ),
      }));
    },
    [movementPagination.limit],
  );

  const registerLocalHistoryAction = useCallback(
    ({
      action,
      item,
      direction,
      fromSpaceName,
      toSpaceName,
      reason = null,
    }) => {
      if (!item?.id) return;

      const resolvedDirection =
        direction ||
        HISTORY_ACTION_CONFIG[action]?.defaultDirection ||
        "INTERNO";

      prependMovementEntry({
        id: `local-${action?.toLowerCase?.() || "update"}-${item.id}-${Date.now()}`,
        itemId: item.id,
        patrimonio: item.patrimonio,
        descricao: item.descricao,
        action,
        direction: resolvedDirection,
        fromSpaceName:
          fromSpaceName === undefined ? space?.name || null : fromSpaceName,
        toSpaceName:
          toSpaceName === undefined ? space?.name || null : toSpaceName,
        createdBy: user?.fullName || user?.sub || "Usuário",
        createdAt: new Date().toISOString(),
        reason,
      });
    },
    [prependMovementEntry, space?.name, user?.fullName, user?.sub],
  );

  useEffect(() => {
    const timer = setTimeout(() => {
      setRelocateSearchTerm(relocateSearchInput.trim().toLowerCase());
    }, 250);
    return () => clearTimeout(timer);
  }, [relocateSearchInput]);

  const filteredRelocationSpaces = useMemo(() => {
    const candidates = spaces.filter((s) => s.id !== spaceId);
    const filtered = !relocateSearchTerm
      ? candidates
      : candidates.filter((candidate) => {
          const name = candidate.name?.toLowerCase() || "";
          const responsible =
            candidate.responsibleDisplay?.toLowerCase() ||
            candidate.responsible?.toLowerCase() ||
            "";
          return (
            name.includes(relocateSearchTerm) ||
            responsible.includes(relocateSearchTerm)
          );
        });

    return filtered.sort((a, b) => {
      const aStarted =
        Boolean(a.startedAt) ||
        a.executionStatus === "INICIADO" ||
        a.executionStatus === "FINALIZADO" ||
        a.isFinalized;
      const bStarted =
        Boolean(b.startedAt) ||
        b.executionStatus === "INICIADO" ||
        b.executionStatus === "FINALIZADO" ||
        b.isFinalized;

      if (aStarted !== bStarted) {
        return aStarted ? 1 : -1;
      }

      return (a.name || "").localeCompare(b.name || "", "pt-BR", {
        sensitivity: "base",
      });
    });
  }, [relocateSearchTerm, spaceId, spaces]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      // Verification-related items should ALWAYS be shown regardless of filters
      if (
        item.verificationStatus === "REVERIFICAR" ||
        item.verificationStatus === "NAO_LOCALIZADO_VERIFICACAO" ||
        verificationItems?.includes(item.id)
      ) {
        return true;
      }

      if (!showFoundItems && item.statusEncontrado === "SIM") return false;
      if (!showRelocatedItems && item.meta?.isRelocated) return false;
      return true;
    });
  }, [items, showFoundItems, showRelocatedItems, verificationItems]);

  // Separa itens em grupos visuais (pilha) e itens avulsos
  // Escalonamento:
  // 1) Itens movidos para a sala (topo)
  // 2) Itens pendentes/não encontrados
  // 3) Itens encontrados (final)
  const displayRows = useMemo(() => {
    const getItemOrderPriority = (item) => {
      // Verification items take highest priority (for reviewers)
      if (item?.verificationStatus === "REVERIFICAR") return -1;
      if (item?.meta?.isRelocated) return 0;
      if (item?.statusEncontrado === "SIM") return 2;
      return 1;
    };

    const compareItems = (a, b) => {
      const priorityDiff = getItemOrderPriority(a) - getItemOrderPriority(b);
      if (priorityDiff !== 0) return priorityDiff;

      return (a.patrimonio || "").localeCompare(b.patrimonio || "", "pt-BR", {
        numeric: true,
        sensitivity: "base",
      });
    };

    const getRowOrderPriority = (row) => {
      if (row.type === "single") {
        return getItemOrderPriority(row.item);
      }

      // Para grupos, usa a maior prioridade presente no grupo
      // (se houver item verificação, grupo sobe; se houver item movido, grupo sobe; se todos encontrados, grupo desce).
      return row.items.reduce(
        (minPriority, item) =>
          Math.min(minPriority, getItemOrderPriority(item)),
        2,
      );
    };

    const groupMap = {};
    const rows = [];
    for (const item of filteredItems) {
      if (item.itemGroupId) {
        if (!groupMap[item.itemGroupId]) {
          groupMap[item.itemGroupId] = {
            type: "group",
            groupId: item.itemGroupId,
            groupName: item.groupName,
            items: [],
          };
          rows.push(groupMap[item.itemGroupId]);
        }
        groupMap[item.itemGroupId].items.push(item);
      } else {
        rows.push({ type: "single", item });
      }
    }

    // Ordena itens dentro de cada grupo com a mesma regra geral.
    Object.values(groupMap).forEach((groupRow) => {
      groupRow.items.sort(compareItems);
    });

    // Ordenação final das linhas.
    rows.sort((a, b) => {
      const priorityDiff = getRowOrderPriority(a) - getRowOrderPriority(b);
      if (priorityDiff !== 0) return priorityDiff;

      const aName =
        a.type === "single"
          ? a.item.patrimonio || a.item.descricao || ""
          : a.groupName || "";
      const bName =
        b.type === "single"
          ? b.item.patrimonio || b.item.descricao || ""
          : b.groupName || "";

      return aName.localeCompare(bName, "pt-BR", {
        numeric: true,
        sensitivity: "base",
      });
    });

    return rows;
  }, [filteredItems]);

  const foundItemsCount = useMemo(
    () => items.filter((item) => item.statusEncontrado === "SIM").length,
    [items],
  );

  const relocatedItemsCount = useMemo(
    () => items.filter((item) => item.meta?.isRelocated).length,
    [items],
  );

  const loadData = async (token, inventoryId) => {
    try {
      const [spacesRes, itemsRes, roleRes] = await Promise.all([
        axios.get(`${API}/spaces/active`, {
          params: { includeFinalized: "true", inventoryId },
          headers: { Authorization: `Bearer ${token}` },
        }),
        axios.get(`${API}/items?spaceId=${spaceId}`, {
          params: { inventoryId },
          headers: { Authorization: `Bearer ${token}` },
        }),
        axios
          .get(`${API}/auth/inventory-role`, {
            params: { inventoryId },
            headers: { Authorization: `Bearer ${token}` },
          })
          .catch(() => ({ data: { inventoryRole: null } })),
      ]);
      setSpaces(spacesRes.data);
      setItems(itemsRes.data);
      setSpace(spacesRes.data.find((s) => s.id === spaceId));
      setInventoryRole(roleRes.data.inventoryRole || null);
    } catch (err) {
      console.error("[Room Page] Error loading data:", err);
    } finally {
      setLoading(false);
    }
  };
  // Expose loadData to SSE handler via ref
  loadDataRef.current = loadData;

  // Verification workflow for reviewers
  const initiateVerification = async () => {
    if (
      !space?.isFinalized ||
      !["REVISOR", "ADMIN_CICLO"].includes(inventoryRole)
    )
      return;

    try {
      setIsVerifying(true);
      const token = localStorage.getItem("token");
      const inventoryId = localStorage.getItem("activeInventoryId");

      const { data } = await axios.post(
        `${API}/spaces/${spaceId}/initiate-verification`,
        { inventoryId },
        { headers: { Authorization: `Bearer ${token}` } },
      );

      setVerificationStatus({
        verificationRoll: data.verificationRoll,
        totalToReview: data.totalToReview,
        totalItems: data.totalItems,
      });

      const selectedIds = data.selectedItemIds || [];
      setVerificationItems(selectedIds);

      // Reload data to get items with verificationStatus field populated
      await loadData(token, inventoryId);

      showToast({
        type: "info",
        title: "Verificação Iniciada",
        message: `${data.totalToReview} itens selecionados para reverificação (10% da sala)`,
      });
    } catch (err) {
      if (err.response?.data?.error?.includes("já em andamento")) {
        // Verification already exists, just load it
        loadVerificationStatus();
        const token = localStorage.getItem("token");
        const inventoryId = localStorage.getItem("activeInventoryId");
        await loadData(token, inventoryId);
      } else {
        showToast({
          type: "error",
          title: "Erro ao iniciar verificação",
          message: err.response?.data?.error || "Erro ao iniciar verificação",
        });
      }
    } finally {
      setIsVerifying(false);
    }
  };

  const loadVerificationStatus = async () => {
    if (
      !space?.isFinalized ||
      !["REVISOR", "ADMIN_CICLO"].includes(inventoryRole)
    )
      return;

    try {
      const token = localStorage.getItem("token");
      const inventoryId = localStorage.getItem("activeInventoryId");
      const { data } = await axios.get(
        `${API}/spaces/${spaceId}/verification-status`,
        {
          params: { inventoryId },
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      if (data.hasActiveVerification) {
        setVerificationStatus({
          verificationRoll: data.verificationRoll,
          verified: data.verified,
          remaining: data.remaining,
        });
        setVerificationItems(data.items.map((i) => i.id));
      }
    } catch (err) {
      console.error("Error loading verification status:", err);
    }
  };

  const handleRevertFinalization = async () => {
    try {
      const token = localStorage.getItem("token");
      const inventoryId = localStorage.getItem("activeInventoryId");

      await axios.post(
        `${API}/spaces/${spaceId}/revert-finalization`,
        { reason: "revisor_requested", inventoryId },
        { headers: { Authorization: `Bearer ${token}` } },
      );

      showToast({
        type: "success",
        title: "Sala Revertida",
        message: "Sala retornada para inspeção dos conferentes",
      });

      setIsRevertModalOpen(false);
      setTimeout(() => router.push("/dashboard"), 1500);
    } catch (err) {
      showToast({
        type: "error",
        title: "Erro ao reverter sala",
        message: err.response?.data?.error || "Erro ao reverter sala",
      });
    }
  };

  const handleVerifyCheck = async (itemId, condicao) => {
    try {
      setSaving(true);
      const token = localStorage.getItem("token");
      const inventoryId = localStorage.getItem("activeInventoryId");

      const { data } = await axios.post(
        `${API}/items/${itemId}/verify-check`,
        { condicao, spaceId, inventoryId },
        { headers: { Authorization: `Bearer ${token}` } },
      );

      if (condicao === "SIM") {
        // Item verified — turn green, clear verification mark
        setItems((prev) =>
          prev.map((i) =>
            i.id === itemId
              ? {
                  ...i,
                  verificationStatus: null,
                  statusEncontrado: "SIM",
                  verifiedAt: data.item?.verifiedAt,
                  verifiedBy: data.item?.verifiedBy,
                }
              : i,
          ),
        );
        showToast({
          type: "success",
          title: "Item Verificado",
          message: "Item re-verificado com sucesso.",
        });
      } else {
        // Item not found during verification — stays in room, marked red
        setItems((prev) =>
          prev.map((i) =>
            i.id === itemId
              ? {
                  ...i,
                  verificationStatus: "NAO_LOCALIZADO_VERIFICACAO",
                  verifiedAt: data.item?.verifiedAt,
                  verifiedBy: data.item?.verifiedBy,
                }
              : i,
          ),
        );
        showToast({
          type: "warning",
          title: "Item Não Localizado",
          message:
            "Item ficará destacado em vermelho para o conferente re-verificar.",
        });
      }
    } catch (err) {
      showToast({
        type: "error",
        title: "Erro ao verificar item",
        message: err.response?.data?.error || "Erro ao verificar item",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCompleteVerification = async () => {
    try {
      setSaving(true);
      const token = localStorage.getItem("token");
      const inventoryId = localStorage.getItem("activeInventoryId");

      await axios.post(
        `${API}/spaces/${spaceId}/complete-verification`,
        { inventoryId },
        { headers: { Authorization: `Bearer ${token}` } },
      );

      showToast({
        type: "success",
        title: "Verificação Concluída",
        message: "Sala finalizada com sucesso após verificação.",
      });

      setTimeout(() => router.push("/dashboard"), 1500);
    } catch (err) {
      showToast({
        type: "error",
        title: "Erro ao finalizar verificação",
        message: err.response?.data?.error || "Erro ao concluir verificação",
      });
    } finally {
      setSaving(false);
    }
  };

  // Initiate verification when space is finalized and user is revisor
  useEffect(() => {
    if (
      space?.isFinalized &&
      ["REVISOR", "ADMIN_CICLO"].includes(inventoryRole) &&
      items.length > 0 &&
      !verificationInitiatedRef.current
    ) {
      verificationInitiatedRef.current = true;
      // Try to initiate verification - it will fail silently if already exists
      initiateVerification();
    }
  }, [space?.isFinalized, inventoryRole, spaceId, items.length]);

  const handleCheck = useCallback(
    (itemId, condicao) => {
      setSaving(true);
      autoSave(() => {
        const inventoryId = localStorage.getItem("activeInventoryId");
        const itemBeforeUpdate = items.find((i) => i.id === itemId);

        enqueueAction({
          endpoint: "/items/check",
          method: "POST",
          payload: { itemId, condicao, inventoryId, connectionId },
        });

        setItems((prev) =>
          prev.map((i) =>
            i.id === itemId
              ? {
                  ...i,
                  statusEncontrado: "SIM",
                  condicaoVisual: condicao,
                  // Limpar meta.isRelocated quando confirmar presença
                  meta: { ...i.meta, isRelocated: false },
                }
              : i,
          ),
        );

        if (itemBeforeUpdate) {
          registerLocalHistoryAction({
            action: "ENCONTRADO",
            item: itemBeforeUpdate,
          });
        }

        setSaving(false);
      });
    },
    [autoSave, items, registerLocalHistoryAction],
  );

  const handleRelocate = useCallback(
    (itemId, targetSpaceId) => {
      setSaving(true);
      autoSave(() => {
        const inventoryId = localStorage.getItem("activeInventoryId");
        enqueueAction({
          endpoint: "/items/relocate",
          method: "POST",
          payload: { itemId, targetSpaceId, inventoryId, connectionId },
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

  const confirmMoveToCurrentRoom = useCallback(async () => {
    if (!pendingMoveCandidate) return;

    const inventoryId = localStorage.getItem("activeInventoryId");
    const token = localStorage.getItem("token");

    // Batch de grupo: mover N itens do grupo via endpoint dedicado
    if (pendingMoveCandidate.itemGroup && groupMoveCount !== "") {
      setSaving(true);
      try {
        const { data } = await axios.post(
          `${API}/items/relocate-group`,
          {
            inventoryId,
            itemGroupId: pendingMoveCandidate.itemGroup.id,
            sourceSpaceId: pendingMoveCandidate.spaceId,
            targetSpaceId: spaceId,
            count: Number(groupMoveCount),
            connectionId,
          },
          { headers: { Authorization: `Bearer ${token}` } },
        );

        setSearchResults((prev) =>
          prev.filter((r) => r.id !== pendingMoveCandidate.id),
        );
        setSearchTerm("");
        setPendingMoveCandidate(null);
        setGroupMoveCount("");
        // Recarrega os itens da sala para refletir os novos itens movidos
        loadData(token, inventoryId);
        showToast({
          type: "success",
          title: "Grupo realocado",
          message:
            data.message || `${data.movedCount} item(ns) movidos com sucesso.`,
        });
      } catch (err) {
        showToast({
          type: "error",
          title: "Falha na realocação",
          message:
            err.response?.data?.error ||
            "Não foi possível realocar os itens do grupo.",
        });
      } finally {
        setSaving(false);
      }
      return;
    }

    // Realocação simples de item único
    setSaving(true);
    autoSave(() => {
      enqueueAction({
        endpoint: "/items/relocate",
        method: "POST",
        payload: {
          itemId: pendingMoveCandidate.id,
          targetSpaceId: spaceId,
          inventoryId,
          connectionId,
        },
      });

      setSearchResults((prev) =>
        prev.filter((result) => result.id !== pendingMoveCandidate.id),
      );
      setSearchTerm("");
      setPendingMoveCandidate(null);
      setGroupMoveCount("");
      setSaving(false);
      showToast({
        type: "success",
        title: "Movimentação registrada",
        message: "A realocação foi enviada para sincronização.",
      });
    });
  }, [autoSave, groupMoveCount, pendingMoveCandidate, showToast, spaceId]);

  const handleMoveToCurrentRoom = (candidate) => {
    setPendingMoveCandidate(candidate);
  };

  const handleUnfoundItem = () => {
    if (!pendingUnfoundItem) return;

    const itemToRemove = pendingUnfoundItem;

    enqueueAction({
      endpoint: "/items/unfound",
      method: "POST",
      payload: {
        itemId: itemToRemove.id,
        inventoryId: localStorage.getItem("activeInventoryId"),
      },
    });

    setItems((prev) => prev.filter((i) => i.id !== itemToRemove.id));

    registerLocalHistoryAction({
      action: "NAO_LOCALIZADO",
      item: itemToRemove,
      toSpaceName: null,
    });

    setPendingUnfoundItem(null);
    setRelocateModal(null);

    showToast({
      type: "info",
      title: "Item removido da sala",
      message:
        "O item foi marcado como não localizado e enviado para sincronização.",
    });
  };

  const validateBatchFields = () => {
    const patrimonioInicial = batchStartPatrimonio.trim();
    const patrimonioFinal = batchEndPatrimonio.trim();

    if (!patrimonioInicial || !patrimonioFinal) {
      showToast({
        type: "warning",
        title: "Intervalo incompleto",
        message: "Informe patrimônio inicial e final para gerar a prévia.",
      });
      return null;
    }

    if (!/\d/.test(patrimonioInicial) || !/\d/.test(patrimonioFinal)) {
      showToast({
        type: "warning",
        title: "Intervalo inválido",
        message: "Informe patrimônios válidos contendo números.",
      });
      return null;
    }

    return { patrimonioInicial, patrimonioFinal };
  };

  const handleBatchPreview = async () => {
    const validated = validateBatchFields();
    if (!validated) return;

    const { patrimonioInicial, patrimonioFinal } = validated;

    try {
      setBatchLoading(true);
      const token = localStorage.getItem("token");
      const inventoryId = localStorage.getItem("activeInventoryId");
      const { data } = await axios.post(
        `${API}/items/check-batch`,
        {
          inventoryId,
          spaceId,
          patrimonioInicial,
          patrimonioFinal,
          condicaoVisual: batchCondicao,
          dryRun: true,
          connectionId,
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      setBatchPreview(data);
      if (!data?.matchedCount) {
        showToast({
          type: "info",
          title: "Prévia sem itens",
          message:
            "Nenhum patrimônio no intervalo informado foi encontrado nesta sala.",
        });
      }
    } catch (err) {
      showToast({
        type: "error",
        title: "Falha na prévia",
        message:
          err.response?.data?.error ||
          "Não foi possível gerar a prévia da marcação em massa.",
      });
    } finally {
      setBatchLoading(false);
    }
  };

  const handleBatchConfirm = async () => {
    const validated = validateBatchFields();
    if (!validated) return;

    const { patrimonioInicial, patrimonioFinal } = validated;

    try {
      setBatchLoading(true);
      const token = localStorage.getItem("token");
      const inventoryId = localStorage.getItem("activeInventoryId");
      const { data } = await axios.post(
        `${API}/items/check-batch`,
        {
          inventoryId,
          spaceId,
          patrimonioInicial,
          patrimonioFinal,
          condicaoVisual: batchCondicao,
          connectionId,
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      await loadData(token, inventoryId);

      setBatchPreview(data);
      setBatchConfirmOpen(false);
      showToast({
        type: "success",
        title: "Conferência em massa aplicada",
        message: `${data.updatedCount || 0} item(ns) marcados como encontrados.`,
      });
    } catch (err) {
      showToast({
        type: "error",
        title: "Falha na conferência em massa",
        message:
          err.response?.data?.error ||
          "Não foi possível aplicar a marcação em massa.",
      });
    } finally {
      setBatchLoading(false);
    }
  };

  const handleUndoLastAction = async (item) => {
    const canUndoRelocation = Boolean(item?.meta?.isRelocated);
    const canUndoFound = item?.statusEncontrado === "SIM";

    if (!canUndoRelocation && !canUndoFound) {
      showToast({
        type: "warning",
        title: "Ação indisponível",
        message:
          "Desfazer está disponível apenas para itens encontrados ou realocados.",
      });
      return;
    }

    try {
      setSaving(true);
      const token = localStorage.getItem("token");
      const inventoryId = localStorage.getItem("activeInventoryId");

      if (canUndoFound) {
        await axios.post(
          `${API}/items/uncheck`,
          { itemId: item.id, inventoryId },
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );

        setItems((prev) =>
          prev.map((i) =>
            i.id === item.id
              ? {
                  ...i,
                  statusEncontrado: "PENDENTE",
                  condicaoVisual: null,
                  dataConferencia: null,
                  ultimoConferente: null,
                }
              : i,
          ),
        );

        registerLocalHistoryAction({
          action: "DESFEITO_ENCONTRADO",
          item,
        });

        showToast({
          type: "success",
          title: "Encontrado desfeito",
          message: "A confirmação de encontrado foi removida com sucesso.",
        });
        return;
      }

      if (canUndoRelocation) {
        await axios.post(
          `${API}/items/${item.id}/restore`,
          { inventoryId },
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );

        setItems((prev) => prev.filter((i) => i.id !== item.id));
        setExpandedItem((prev) => (prev === item.id ? null : prev));

        registerLocalHistoryAction({
          action: "ESTORNADO",
          item,
          toSpaceName: item.meta?.fromSpaceName || null,
        });

        showToast({
          type: "success",
          title: "Ação desfeita",
          message: "A realocação pendente foi revertida com sucesso.",
        });
        return;
      }
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

  // True when every sampled item has been resolved (verified or not-found)
  const allVerificationItemsResolved = useMemo(() => {
    if (!space?.isFinalized) return false;
    if (!["REVISOR", "ADMIN_CICLO"].includes(inventoryRole)) return false;
    if (!verificationItems || verificationItems.length === 0) return false;
    return !items.some((i) => i.verificationStatus === "REVERIFICAR");
  }, [space?.isFinalized, inventoryRole, verificationItems, items]);

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
  const startBadge = getSpaceStartBadge(space);
  const hasStateFilters = !showFoundItems || !showRelocatedItems;

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
              <div className="mt-2 flex flex-col gap-1">
                <span
                  className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${startBadge.className}`}
                >
                  {startBadge.label}
                </span>
                {space.isVerified && space.confirmedBy && (
                  <span className="inline-flex rounded-full px-2.5 py-1 text-xs font-semibold bg-purple-100 text-purple-800">
                    🟣 Confirmado em{" "}
                    {space.confirmedAt
                      ? new Date(space.confirmedAt).toLocaleDateString("pt-BR")
                      : "--/--/--"}{" "}
                    por {space.confirmedBy}
                  </span>
                )}
              </div>
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
            Histórico de atualizações
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
                    <th className="px-6 py-4">Atualização</th>
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
                        colSpan={7}
                      >
                        Carregando atualizações...
                      </td>
                    </tr>
                  ) : movementHistory.length === 0 ? (
                    <tr>
                      <td
                        className="px-6 py-10 text-center text-sm text-slate-500"
                        colSpan={7}
                      >
                        Nenhuma atualização encontrada para esta sala.
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
                            className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${getActionBadgeClass(entry.action)}`}
                          >
                            {getActionLabel(entry.action)}
                          </span>
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
                atualizações
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
                  Atualização rápida de patrimônios
                </h3>
                <p className="text-sm text-gray-500">
                  Inclua um item por busca ou atualize um conjunto por intervalo
                  com validação.
                </p>
              </div>
              <div className="inline-flex rounded-lg bg-slate-100 p-1">
                <button
                  type="button"
                  onClick={() => {
                    setQuickActionMode("single");
                    setSearchError("");
                  }}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    quickActionMode === "single"
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Item único
                </button>
                <button
                  type="button"
                  onClick={() => setQuickActionMode("batch")}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    quickActionMode === "batch"
                      ? "bg-white text-slate-900 shadow-sm"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  Lote por intervalo
                </button>
              </div>
            </div>

            {quickActionMode === "single" ? (
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
                    {searching ? "Buscando..." : "Buscar item"}
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
            ) : (
              <div className="mt-4 space-y-3">
                <div className="grid gap-3 md:grid-cols-4">
                  <input
                    type="text"
                    value={batchStartPatrimonio}
                    onChange={(e) => setBatchStartPatrimonio(e.target.value)}
                    placeholder="Patrimônio inicial"
                    className="border rounded-lg px-3 py-2"
                  />
                  <input
                    type="text"
                    value={batchEndPatrimonio}
                    onChange={(e) => setBatchEndPatrimonio(e.target.value)}
                    placeholder="Patrimônio final"
                    className="border rounded-lg px-3 py-2"
                  />
                  <select
                    value={batchCondicao}
                    onChange={(e) => setBatchCondicao(e.target.value)}
                    className="border rounded-lg px-3 py-2"
                  >
                    <option value="EXCELENTE">🟢 Ótimo</option>
                    <option value="BOM">🟡 Regular</option>
                    <option value="INSERVIVEL">🔴 Ruim</option>
                  </select>
                  <button
                    type="button"
                    onClick={handleBatchPreview}
                    disabled={batchLoading}
                    className="px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-900 disabled:opacity-50"
                  >
                    {batchLoading ? "Gerando prévia..." : "Pré-visualizar lote"}
                  </button>
                </div>

                {batchPreview ? (
                  <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <p className="text-sm text-slate-700">
                      Itens no intervalo:{" "}
                      <strong>{batchPreview.matchedCount || 0}</strong>
                    </p>
                    <p className="text-sm text-slate-700">
                      Itens fora do intervalo/ignorados:{" "}
                      <strong>{batchPreview.skippedCount || 0}</strong>
                    </p>
                    <div className="mt-3">
                      <button
                        type="button"
                        disabled={
                          batchLoading || (batchPreview.matchedCount || 0) === 0
                        }
                        onClick={() => setBatchConfirmOpen(true)}
                        className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                      >
                        Confirmar marcação em massa
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            )}
          </div>
        ) : null}

        {activeTab === "itens" ? (
          <div className="bg-white rounded-xl shadow p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-slate-800">
                Filtros de estado dos itens
              </p>
              <div className="flex flex-wrap items-center gap-4">
                <button
                  type="button"
                  onClick={() => setShowFoundItems((prev) => !prev)}
                  aria-pressed={showFoundItems}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                    showFoundItems
                      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                      : "border-slate-300 bg-slate-100 text-slate-500"
                  }`}
                >
                  <span>{showFoundItems ? "✓" : "○"}</span>
                  <span>Encontrados</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      showFoundItems
                        ? "bg-emerald-200 text-emerald-800"
                        : "bg-slate-200 text-slate-600"
                    }`}
                  >
                    {foundItemsCount}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowRelocatedItems((prev) => !prev)}
                  aria-pressed={showRelocatedItems}
                  className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm font-medium transition ${
                    showRelocatedItems
                      ? "border-amber-300 bg-amber-50 text-amber-700"
                      : "border-slate-300 bg-slate-100 text-slate-500"
                  }`}
                >
                  <span>{showRelocatedItems ? "✓" : "○"}</span>
                  <span>Movidos</span>
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      showRelocatedItems
                        ? "bg-amber-200 text-amber-800"
                        : "bg-slate-200 text-slate-600"
                    }`}
                  >
                    {relocatedItemsCount}
                  </span>
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {activeTab === "itens" && filteredItems.length === 0 ? (
          <div className="bg-white p-12 rounded-xl shadow text-center text-gray-500">
            {items.length === 0
              ? "Nenhum item registrado neste espaço."
              : hasStateFilters
                ? "Nenhum item visível com os filtros selecionados."
                : "Nenhum item disponível para exibição."}
          </div>
        ) : activeTab === "itens" ? (
          displayRows.map((row) => {
            if (row.type === "group") {
              const isExpanded = expandedGroups[row.groupId];
              const foundCount = row.items.filter(
                (i) => i.statusEncontrado === "SIM",
              ).length;
              const totalCount = row.items.length;
              const allFound = foundCount === totalCount;
              const relocatedCount = row.items.filter(
                (i) => i.meta?.isRelocated,
              ).length;

              return (
                <div key={`group-${row.groupId}`} className="relative">
                  {/* Stack shadow cards */}
                  <div
                    className="absolute inset-x-0 top-2 h-full bg-white rounded-xl shadow border border-gray-200 opacity-60"
                    style={{ transform: "translateY(4px) scale(0.98)" }}
                  />
                  <div
                    className="absolute inset-x-0 top-2 h-full bg-white rounded-xl shadow border border-gray-200 opacity-30"
                    style={{ transform: "translateY(8px) scale(0.96)" }}
                  />

                  {/* Main group card */}
                  <div
                    className={`relative bg-white rounded-xl shadow border-l-4 transition-all ${
                      allFound
                        ? "border-green-500"
                        : relocatedCount > 0
                          ? "border-indigo-500"
                          : row.items.some(
                                (i) => i.verificationStatus === "REVERIFICAR",
                              )
                            ? "border-purple-500"
                            : "border-indigo-400"
                    }`}
                  >
                    <div
                      className="p-5 cursor-pointer select-none"
                      onClick={() =>
                        setExpandedGroups((prev) => ({
                          ...prev,
                          [row.groupId]: !prev[row.groupId],
                        }))
                      }
                    >
                      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="text-indigo-600 text-lg">🗂</span>
                            <span className="font-bold text-lg text-indigo-800">
                              {row.groupName}
                            </span>
                            <span className="px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs rounded-full font-medium">
                              Grupo · {totalCount} itens
                            </span>
                            {relocatedCount > 0 && (
                              <span className="px-2 py-0.5 bg-yellow-100 text-yellow-800 text-xs rounded-full font-medium">
                                ⚠️ {relocatedCount} movido
                                {relocatedCount !== 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                          <p className="text-sm text-gray-500">
                            {allFound ? (
                              <span className="text-green-600 font-medium">
                                ✓ Todos encontrados
                              </span>
                            ) : (
                              <>
                                <span className="text-green-600 font-medium">
                                  {foundCount} encontrado
                                  {foundCount !== 1 ? "s" : ""}
                                </span>{" "}
                                de {totalCount}
                              </>
                            )}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          {!allFound && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                const inventoryId =
                                  localStorage.getItem("activeInventoryId");
                                const itemsToCheck = row.items.filter(
                                  (i) => i.statusEncontrado !== "SIM",
                                );
                                // Enqueue all API calls upfront (no debounce interference)
                                itemsToCheck.forEach((i) => {
                                  enqueueAction({
                                    endpoint: "/items/check",
                                    method: "POST",
                                    payload: {
                                      itemId: i.id,
                                      condicao: i.condicaoVisual || "EXCELENTE",
                                      inventoryId,
                                      connectionId,
                                    },
                                  });
                                });
                                // Single batch state update
                                setItems((prev) =>
                                  prev.map((i) => {
                                    if (
                                      itemsToCheck.some((tc) => tc.id === i.id)
                                    ) {
                                      return {
                                        ...i,
                                        statusEncontrado: "SIM",
                                        condicaoVisual:
                                          i.condicaoVisual || "EXCELENTE",
                                        meta: { ...i.meta, isRelocated: false },
                                      };
                                    }
                                    return i;
                                  }),
                                );
                                // Register history for each found item
                                itemsToCheck.forEach((i) => {
                                  registerLocalHistoryAction({
                                    action: "ENCONTRADO",
                                    item: i,
                                  });
                                });
                              }}
                              className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs hover:bg-green-700 font-medium"
                            >
                              ✅ Encontrar tudo
                            </button>
                          )}
                          {relocatedCount > 0 && (
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                for (const i of row.items.filter(
                                  (i) => i.meta?.isRelocated,
                                )) {
                                  await handleUndoLastAction(i);
                                }
                              }}
                              className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg text-xs hover:bg-slate-200 font-medium border border-slate-300"
                            >
                              ↩️ Desfazer movimentação
                            </button>
                          )}
                          {allFound && (
                            <button
                              onClick={async (e) => {
                                e.stopPropagation();
                                for (const i of row.items.filter(
                                  (i) => i.statusEncontrado === "SIM",
                                )) {
                                  await handleUndoLastAction(i);
                                }
                              }}
                              className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg text-xs hover:bg-slate-200 font-medium border border-slate-300"
                            >
                              ↩️ Desfazer tudo
                            </button>
                          )}
                          <span className="text-sm text-gray-400">
                            {isExpanded ? "▲ Recolher" : "▼ Expandir"}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Expanded individual items */}
                    {isExpanded && (
                      <div className="border-t px-4 pb-4 pt-3 space-y-3">
                        {row.items.map((item) => {
                          const formattedValue =
                            item.valor != null
                              ? `R$ ${Number(item.valor).toFixed(2)}`
                              : "N/A";
                          const formattedDataAquisicao = item.dataAquisicao
                            ? new Date(item.dataAquisicao).toLocaleDateString(
                                "pt-BR",
                              )
                            : "N/A";
                          const canUndoAction =
                            item?.meta?.isRelocated ||
                            item?.statusEncontrado === "SIM";

                          return (
                            <div
                              key={item.id}
                              className={`bg-gray-50 rounded-lg border-l-4 transition-all ${
                                item.verificationStatus ===
                                "NAO_LOCALIZADO_VERIFICACAO"
                                  ? "border-red-500 bg-red-50"
                                  : item.verificationStatus === "REVERIFICAR" ||
                                      verificationItems?.includes(item.id)
                                    ? "border-purple-500 bg-purple-50"
                                    : item.meta?.isRelocated
                                      ? "border-yellow-500 bg-yellow-50"
                                      : item.statusEncontrado === "SIM"
                                        ? "border-green-500"
                                        : "border-gray-300"
                              }`}
                            >
                              <div className="p-4">
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                  <div
                                    className="flex-1 cursor-pointer"
                                    onClick={() =>
                                      setExpandedItem(
                                        expandedItem === item.id
                                          ? null
                                          : item.id,
                                      )
                                    }
                                  >
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className="font-bold text-base">
                                        #{item.patrimonio}
                                      </span>
                                      {item.verificationStatus ===
                                        "NAO_LOCALIZADO_VERIFICACAO" && (
                                        <span className="px-2 py-0.5 bg-red-200 text-red-800 text-xs rounded font-medium">
                                          ⚠️ Não localizado na verificação
                                        </span>
                                      )}
                                      {item.meta?.isRelocated && (
                                        <span className="px-2 py-0.5 bg-yellow-200 text-yellow-800 text-xs rounded font-medium">
                                          ⚠️ Movido de {item.meta.fromSpaceName}
                                        </span>
                                      )}
                                      {item.statusEncontrado === "SIM" &&
                                        !item.verificationStatus && (
                                          <span className="text-green-600 text-sm">
                                            ✓
                                          </span>
                                        )}
                                    </div>
                                    <p className="text-gray-600 text-xs line-clamp-1">
                                      {item.descricao}
                                    </p>
                                  </div>

                                  <div className="flex flex-wrap gap-2 lg:justify-end">
                                    {item.statusEncontrado === "SIM" ||
                                    item.verificationStatus ===
                                      "REVERIFICAR" ||
                                    verificationItems?.includes(
                                      item.id,
                                    ) ? null : item.verificationStatus ===
                                      "NAO_LOCALIZADO_VERIFICACAO" ? (
                                      <span className="px-3 py-1.5 bg-red-100 text-red-700 rounded-lg text-xs font-medium">
                                        ⚠️ Aguardando conferente
                                      </span>
                                    ) : (
                                      <>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleCheck(
                                              item.id,
                                              item.condicaoVisual ||
                                                "EXCELENTE",
                                            );
                                          }}
                                          className="px-3 py-1.5 bg-green-600 text-white rounded-lg text-xs hover:bg-green-700"
                                        >
                                          ✅ Encontrado
                                        </button>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setRelocateModal(item);
                                          }}
                                          className="px-3 py-1.5 bg-blue-600 text-white rounded-lg text-xs hover:bg-blue-700"
                                        >
                                          ➡️ Mover
                                        </button>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setPendingUnfoundItem(item);
                                          }}
                                          className="px-3 py-1.5 bg-red-100 text-red-700 rounded-lg text-xs hover:bg-red-200"
                                        >
                                          🚫 Não localizado
                                        </button>
                                      </>
                                    )}
                                  </div>
                                </div>
                              </div>

                              {/* Inner expanded details */}
                              {expandedItem === item.id && (
                                <div className="px-4 pb-4 border-t pt-3">
                                  <div className="space-y-1.5 mb-4 text-sm text-gray-700">
                                    <p>
                                      <span className="font-semibold">
                                        Descrição:
                                      </span>{" "}
                                      {item.descricao}
                                    </p>
                                    <p>
                                      <span className="font-semibold">
                                        Valor:
                                      </span>{" "}
                                      {formattedValue} |{" "}
                                      <span className="font-semibold">
                                        Condição Original:
                                      </span>{" "}
                                      {item.condicaoOriginal || "N/A"}
                                    </p>
                                    <p>
                                      <span className="font-semibold">
                                        Código SIA:
                                      </span>{" "}
                                      {item.codigoSIA || "N/A"} |{" "}
                                      <span className="font-semibold">
                                        Fornecedor:
                                      </span>{" "}
                                      {item.fornecedor || "N/A"}
                                    </p>
                                    <p>
                                      <span className="font-semibold">
                                        Data Aquisição:
                                      </span>{" "}
                                      {formattedDataAquisicao} |{" "}
                                      <span className="font-semibold">
                                        Documento:
                                      </span>{" "}
                                      {item.documento || "N/A"}
                                    </p>
                                  </div>

                                  <div>
                                    <p className="mb-2 text-sm font-semibold text-gray-800">
                                      🎨 Estado de Conservação:
                                    </p>
                                    <div className="flex flex-wrap gap-2 mb-4">
                                      {["EXCELENTE", "BOM", "INSERVIVEL"].map(
                                        (status) => (
                                          <button
                                            key={status}
                                            onClick={() =>
                                              handleCheck(item.id, status)
                                            }
                                            className={`py-1.5 px-3 rounded-lg text-sm font-medium transition ${
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
                                        ),
                                      )}
                                    </div>
                                  </div>

                                  <button
                                    onClick={() => handleUndoLastAction(item)}
                                    disabled={saving || !canUndoAction}
                                    className="px-3 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    ↩️ Desfazer
                                  </button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </div>
              );
            }

            // row.type === "single"
            const item = row.item;
            const formattedValue =
              item.valor != null
                ? `R$ ${Number(item.valor).toFixed(2)}`
                : "N/A";
            const formattedDataAquisicao = item.dataAquisicao
              ? new Date(item.dataAquisicao).toLocaleDateString("pt-BR")
              : "N/A";
            const canUndoAction =
              item?.meta?.isRelocated || item?.statusEncontrado === "SIM";

            return (
              <div
                key={item.id}
                className={`bg-white rounded-xl shadow border-l-4 transition-all ${
                  item.verificationStatus === "NAO_LOCALIZADO_VERIFICACAO"
                    ? "border-red-500 bg-red-50"
                    : item.verificationStatus === "REVERIFICAR" ||
                        verificationItems?.includes(item.id)
                      ? "border-purple-500 bg-purple-50"
                      : item.meta?.isRelocated
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
                        {item.verificationStatus ===
                          "NAO_LOCALIZADO_VERIFICACAO" && (
                          <span className="px-2 py-0.5 bg-red-200 text-red-800 text-xs rounded font-medium">
                            ⚠️ Não localizado na verificação
                          </span>
                        )}
                        {item.meta?.isRelocated && (
                          <span className="px-2 py-0.5 bg-yellow-200 text-yellow-800 text-xs rounded font-medium">
                            ⚠️ Movido de {item.meta.fromSpaceName}
                          </span>
                        )}
                        {item.statusEncontrado === "SIM" &&
                          !item.verificationStatus && (
                            <span className="text-green-600 text-sm">✓</span>
                          )}
                      </div>
                      <p className="text-gray-700 text-sm line-clamp-1">
                        {item.descricao}
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2 lg:justify-end">
                      {item.statusEncontrado === "SIM" ||
                      item.verificationStatus === "REVERIFICAR" ||
                      verificationItems?.includes(item.id) ? null : item.verificationStatus ===
                        "NAO_LOCALIZADO_VERIFICACAO" ? (
                        <span className="px-3 py-1.5 bg-red-100 text-red-700 rounded-lg text-xs font-medium">
                          ⚠️ Aguardando conferente
                        </span>
                      ) : (
                        <>
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
                        </>
                      )}
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
                        disabled={saving || !canUndoAction}
                        className="px-3 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
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
          <div className="flex justify-between items-center pt-4 gap-4">
            {space?.isFinalized &&
              ["REVISOR", "ADMIN_CICLO"].includes(inventoryRole) && (
                <div className="text-sm text-slate-600">
                  {verificationStatus && (
                    <span className="font-medium">
                      Revisão: {verificationStatus.verified || 0}/
                      {verificationStatus.totalToReview || 0} itens verificados
                    </span>
                  )}
                </div>
              )}
            <div className="flex gap-3 ml-auto">
              {space?.isFinalized &&
                ["REVISOR", "ADMIN_CICLO"].includes(inventoryRole) && (
                  <button
                    onClick={() => setIsRevertModalOpen(true)}
                    className="px-6 py-3 bg-amber-600 text-white rounded-xl font-semibold hover:bg-amber-700 shadow-lg"
                  >
                    ↩️ Retornar Etapa
                  </button>
                )}
              {allVerificationItemsResolved && (
                <button
                  onClick={handleCompleteVerification}
                  disabled={saving}
                  className="px-6 py-3 bg-emerald-600 text-white rounded-xl font-semibold hover:bg-emerald-700 shadow-lg disabled:opacity-50"
                >
                  ✅ Finalizar Sala
                </button>
              )}
              {!space?.isFinalized && inventoryRole !== "VISUALIZADOR" && (
                <button
                  onClick={() => setIsFinalizeModalOpen(true)}
                  className="px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 shadow-lg"
                >
                  🏁 Sala Finalizada
                </button>
              )}
            </div>
          </div>
        ) : null}
      </main>

      {/* Modal de Realocação */}
      <Modal
        isOpen={Boolean(relocateModal)}
        onClose={() => {
          setRelocateModal(null);
          setRelocateSearchInput("");
        }}
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
          <input
            type="text"
            value={relocateSearchInput}
            onChange={(e) => setRelocateSearchInput(e.target.value)}
            placeholder="Pesquisar espaço de destino..."
            className="w-full border rounded-lg p-3 mb-3"
          />
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
            {filteredRelocationSpaces.map((s) => {
              const startedLabel = s.startedAt
                ? new Date(s.startedAt).toLocaleDateString("pt-BR")
                : "--/--/--";
              const startedBy =
                s.startedByDisplay || s.startedBy || "usuário não identificado";
              const statusLabel =
                s.startedAt ||
                s.executionStatus === "INICIADO" ||
                s.executionStatus === "FINALIZADO" ||
                s.isFinalized
                  ? `Iniciado em ${startedLabel} por ${startedBy}`
                  : "Não iniciado";

              return (
                <option key={s.id} value={s.id}>
                  {s.name} • {s.responsibleDisplay || s.responsible} •{" "}
                  {statusLabel}
                </option>
              );
            })}
          </select>
          {filteredRelocationSpaces.length === 0 ? (
            <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
              Nenhum espaço encontrado para o termo informado.
            </p>
          ) : null}
        </ModalBody>
        <ModalFooter>
          <button
            onClick={() => {
              setRelocateModal(null);
              setRelocateSearchInput("");
            }}
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

      <Modal
        isOpen={Boolean(pendingMoveCandidate)}
        onClose={() => {
          setPendingMoveCandidate(null);
          setGroupMoveCount("");
        }}
        title="Confirmar realocação"
        size="md"
      >
        <ModalBody>
          {pendingMoveCandidate && (
            <div className="space-y-4">
              <p className="text-sm text-slate-700">
                Deseja mover o patrimônio{" "}
                <span className="font-semibold">
                  #{pendingMoveCandidate.patrimonio}
                </span>{" "}
                para a sala atual (
                <span className="font-semibold">{space?.name}</span>)? Origem
                atual:{" "}
                <span className="font-semibold">
                  {pendingMoveCandidate.spaceName}
                </span>
                .
              </p>

              {pendingMoveCandidate.itemGroup && (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3">
                  <div>
                    <p className="text-sm font-semibold text-amber-900">
                      Este item pertence a um grupo
                    </p>
                    <p className="mt-0.5 text-xs text-amber-800">
                      Grupo:{" "}
                      <span className="font-medium">
                        {pendingMoveCandidate.itemGroup.name}
                      </span>
                      {" · "}
                      {pendingMoveCandidate.itemGroup.totalItems} item(ns) no
                      grupo
                    </p>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-amber-900">
                      Quantos itens deste grupo serão movidos nesta operação?
                    </label>
                    <input
                      type="number"
                      min="1"
                      max={pendingMoveCandidate.itemGroup.totalItems}
                      value={groupMoveCount}
                      onChange={(e) => setGroupMoveCount(e.target.value)}
                      placeholder={`1 – ${pendingMoveCandidate.itemGroup.totalItems}`}
                      className="w-full rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm focus:border-amber-500 focus:outline-none"
                    />
                  </div>
                </div>
              )}
            </div>
          )}
        </ModalBody>
        <ModalFooter>
          <button
            type="button"
            onClick={() => {
              setPendingMoveCandidate(null);
              setGroupMoveCount("");
            }}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={confirmMoveToCurrentRoom}
            disabled={
              saving ||
              (pendingMoveCandidate?.itemGroup && groupMoveCount === "")
            }
            className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
          >
            {saving ? "Movendo..." : "Mover item"}
          </button>
        </ModalFooter>
      </Modal>

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

      <ConfirmModal
        isOpen={batchConfirmOpen}
        onConfirm={handleBatchConfirm}
        onCancel={() => setBatchConfirmOpen(false)}
        title="Confirmar encontrado em massa"
        message={`Aplicar status de encontrado para ${batchPreview?.matchedCount || 0} item(ns) no intervalo informado?`}
        confirmText="Aplicar em massa"
        cancelText="Cancelar"
        variant="warning"
      />

      <ConfirmModal
        isOpen={isRevertModalOpen}
        onConfirm={handleRevertFinalization}
        onCancel={() => setIsRevertModalOpen(false)}
        title="Retornar Etapa"
        message="Tem certeza que deseja retornar esta sala para inspeção dos conferentes? Isso desfará o status de finalização."
        confirmText="Retornar"
        cancelText="Cancelar"
        variant="warning"
      />
    </div>
  );
}
