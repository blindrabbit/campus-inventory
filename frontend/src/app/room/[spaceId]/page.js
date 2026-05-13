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

// Utility function to normalize strings (remove accents)
function normalizeString(str) {
  if (!str) return "";
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

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
  const [batchCondicao, setBatchCondicao] = useState("BOM");
  const [batchPreview, setBatchPreview] = useState(null);
  const [batchLoading, setBatchLoading] = useState(false);
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false);
  const [batchAction, setBatchAction] = useState("confirm"); // "confirm" | "unfound" | "move"
  const [batchTargetSpaceId, setBatchTargetSpaceId] = useState("");
  const [batchSpaceSearch, setBatchSpaceSearch] = useState("");
  const [batchSpaceDropdownOpen, setBatchSpaceDropdownOpen] = useState(false);

  // Observações
  const [observacoesText, setObservacoesText] = useState("");
  const [observacoesSaving, setObservacoesSaving] = useState(false);
  const [observacoesHasChanges, setObservacoesHasChanges] = useState(false);

  // Multi-select state
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedItemIds, setSelectedItemIds] = useState(new Set());
  const [multiMoveOpen, setMultiMoveOpen] = useState(false);
  const [multiMoveSpaceSearch, setMultiMoveSpaceSearch] = useState("");
  const [multiMoveSpaceDropdownOpen, setMultiMoveSpaceDropdownOpen] =
    useState(false);
  const [multiMoveTargetSpaceId, setMultiMoveTargetSpaceId] = useState("");
  const longPressTimerRef = useRef(null);
  const [showFoundItems, setShowFoundItems] = useState(true);

  // Animação de saída dos cards: { [itemId]: "found" | "unfound" | "moving" }
  const [exitingItems, setExitingItems] = useState({});

  const triggerItemExit = useCallback((itemId, type, callback) => {
    setExitingItems((prev) => ({ ...prev, [itemId]: type }));
    setTimeout(() => {
      setExitingItems((prev) => {
        const next = { ...prev };
        delete next[itemId];
        return next;
      });
      callback();
    }, 340);
  }, []);
  const [showRelocatedItems, setShowRelocatedItems] = useState(true);
  const [expandedGroups, setExpandedGroups] = useState({});
  const [itemSearchFilter, setItemSearchFilter] = useState("");

  // Verification workflow for reviewers
  const [verificationStatus, setVerificationStatus] = useState(null);
  const [verificationItems, setVerificationItems] = useState([]);
  const [isVerifying, setIsVerifying] = useState(false);
  const [isRevertModalOpen, setIsRevertModalOpen] = useState(false);
  const [reopenJustification, setReopenJustification] = useState("");
  const verificationInitiatedRef = useRef(false);
  const [inventoryRole, setInventoryRole] = useState(null);
  const isViewer = inventoryRole === "VISUALIZADOR";

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

    const d = lastEvent.data;
    const itemLabel = d.patrimonio ? `Patrimônio ${d.patrimonio}` : (d.descricao ? d.descricao : "Item");

    const config = {
      item_relocated: {
        title: "📦 Item movido para esta sala",
        msg: `${itemLabel} movido por ${d.user}${d.fromSpaceName ? ` de "${d.fromSpaceName}"` : ""}.`,
      },
      item_left_space: {
        title: "📤 Item saiu desta sala",
        msg: `${itemLabel} movido por ${d.user} para "${d.toSpaceName || "outro local"}".`,
        onReceive: () => setItems((prev) => prev.filter((i) => i.id !== d.itemId)),
      },
      group_relocated: {
        title: `📦 ${d.count} item${d.count > 1 ? "ns" : ""} movido${d.count > 1 ? "s" : ""} para esta sala`,
        msg: `Grupo movido por ${d.user}${d.fromSpaceName ? ` de "${d.fromSpaceName}"` : ""}.`,
      },
      group_left_space: {
        title: `📤 ${d.count} item${d.count > 1 ? "ns" : ""} saiu${d.count > 1 ? "ram" : ""} desta sala`,
        msg: `Grupo movido por ${d.user} para "${d.toSpaceName || "outro local"}".`,
      },
      item_checked: {
        title: "✅ Item conferido",
        msg: `${d.user} marcou um item como encontrado nesta sala.`,
      },
      batch_checked: {
        title: "✅ Conferência em massa",
        msg: `${d.user} conferiu ${d.count} itens nesta sala.`,
      },
      batch_unfound: {
        title: "Itens não localizados em massa",
        msg: `${d.user} marcou ${d.count} itens como não localizados nesta sala.`,
      },
      batch_relocated: {
        title: "📦 Itens movidos em massa para esta sala",
        msg: `${d.user} moveu ${d.count} itens${d.fromSpaceName ? ` de "${d.fromSpaceName}"` : ""}.`,
      },
      batch_left_space: {
        title: "📤 Itens movidos em massa desta sala",
        msg: `${d.user} moveu ${d.count} itens para "${d.toSpaceName || "outro local"}".`,
      },
      item_restored: {
        title: "🔄 Item restaurado",
        msg: `${d.user} restaurou um item para esta sala.`,
      },
      space_auto_reverted: {
        title: "⚠️ Sala reaberta pelo revisor",
        msg: `Item #${d.patrimonio} não localizado — sala retornada para conferência.`,
      },
    };

    const c = config[lastEvent.type];
    if (c) {
      if (c.onReceive) c.onReceive();
      showToast({ type: lastEvent.type === "space_auto_reverted" ? "warning" : "info", title: c.title, message: c.msg });
      loadDataRef.current(token, currentInventoryId);
    }
  }, [lastEvent, showToast, currentInventoryId]);

  // Registra a última sala visitada — fire-and-forget, sem bloquear a UI
  useEffect(() => {
    if (!spaceId) return;
    const token = localStorage.getItem("token");
    const inventoryId = localStorage.getItem("activeInventoryId");
    if (!token || !inventoryId) return;

    axios
      .patch(
        `${API}/users/me/last-visited`,
        { spaceId, inventoryId },
        { headers: { Authorization: `Bearer ${token}` } },
      )
      .catch(() => {});
  }, [spaceId]);

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

  const abbreviateName = (name) => {
    if (!name) return "usuário não identificado";
    const parts = name.trim().split(/\s+/);
    if (parts.length <= 1) return name;
    return parts[0] + " " + parts.slice(1).map((p) => p[0].toUpperCase() + ".").join(" ");
  };

  const getSpacePhaseBadges = (spaceData) => {
    const fmtD = (v) => v ? new Date(v).toLocaleDateString("pt-BR") : "--/--/--";
    const badges = [];

    const wasStarted =
      Boolean(spaceData?.startedAt) ||
      spaceData?.executionStatus === "INICIADO" ||
      spaceData?.executionStatus === "FINALIZADO";

    if (wasStarted) {
      badges.push({
        label: `🟠 Iniciado em ${fmtD(spaceData?.startedAt)} por ${abbreviateName(spaceData?.startedByDisplay || spaceData?.startedBy)}`,
        className: "bg-amber-100 text-amber-800",
      });
    }

    if (spaceData?.isFinalized) {
      badges.push({
        label: `🟢 Finalizado em ${fmtD(spaceData?.finalizedAt)} por ${abbreviateName(spaceData?.finalizedBy)}`,
        className: "bg-emerald-100 text-emerald-800",
      });
    }

    if (spaceData?.isVerifiedByRevisor) {
      badges.push({
        label: `🔵 Verificado pelo revisor em ${fmtD(spaceData?.finalizedAt || spaceData?.startedAt)}`,
        className: "bg-blue-100 text-blue-800",
      });
    }

    if (spaceData?.isVerified && spaceData?.confirmedBy) {
      badges.push({
        label: `🟣 Confirmado em ${fmtD(spaceData?.confirmedAt)} por ${abbreviateName(spaceData?.confirmedBy)}`,
        className: "bg-purple-100 text-purple-800",
      });
    }

    if (badges.length === 0) {
      badges.push({ label: "🔴 Não iniciado", className: "bg-rose-100 text-rose-700" });
    }

    return badges;
  };

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
      setRelocateSearchTerm(normalizeString(relocateSearchInput));
    }, 250);
    return () => clearTimeout(timer);
  }, [relocateSearchInput]);

  const filteredRelocationSpaces = useMemo(() => {
    const candidates = spaces.filter((s) => s.id !== spaceId);
    const filtered = !relocateSearchTerm
      ? candidates
      : candidates.filter((candidate) => {
          const name = normalizeString(candidate.name || "");
          const responsible = normalizeString(
            candidate.responsibleDisplay || candidate.responsible || "",
          );
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

      // Apply text search filter
      if (itemSearchFilter.trim()) {
        const searchTerm = normalizeString(itemSearchFilter);
        const patrimonio = normalizeString(item.patrimonio);
        const descricao = normalizeString(item.descricao);

        const matchesPatrimonio = patrimonio.includes(searchTerm);
        const matchesDescricao = descricao.includes(searchTerm);

        if (!matchesPatrimonio && !matchesDescricao) {
          return false;
        }
      }

      return true;
    });
  }, [
    items,
    showFoundItems,
    showRelocatedItems,
    verificationItems,
    itemSearchFilter,
  ]);

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
      const currentSpace = spacesRes.data.find((s) => s.id === spaceId);
      setSpace(currentSpace);
      setObservacoesText(currentSpace?.observacoes || "");
      setObservacoesHasChanges(false);
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
          totalToReview: data.items.length,
        });
        // Only include items still pending — already-verified items must NOT
        // appear here or the purple buttons will show for them incorrectly
        setVerificationItems(
          data.items
            .filter((i) => i.verificationStatus === "REVERIFICAR")
            .map((i) => i.id),
        );
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
        { justification: reopenJustification, inventoryId },
        { headers: { Authorization: `Bearer ${token}` } },
      );

      showToast({
        type: "success",
        title: "Sala Reaberta",
        message: "Sala reaberta para inspeção dos conferentes",
      });

      setIsRevertModalOpen(false);
      setReopenJustification("");
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
        // Remove from verificationItems so card turns green and buttons disappear
        setVerificationItems((prev) => prev.filter((id) => id !== itemId));
        // Update verification progress counter
        setVerificationStatus((prev) =>
          prev ? { ...prev, verified: (prev.verified || 0) + 1 } : prev,
        );
        showToast({
          type: "success",
          title: "Item Verificado",
          message: "Item confirmado na sala.",
        });
      } else if (data.autoReverted) {
        // Backend auto-reverted the space — reload everything
        showToast({
          type: "warning",
          title: "Sala Reaberta",
          message: data.message,
        });
        const token2 = localStorage.getItem("token");
        const inventoryId2 = localStorage.getItem("activeInventoryId");
        setVerificationItems([]);
        setVerificationStatus(null);
        verificationInitiatedRef.current = false;
        await loadData(token2, inventoryId2);
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
      const inventoryId = localStorage.getItem("activeInventoryId");
      const itemBeforeUpdate = items.find((i) => i.id === itemId);

      autoSave(() => {
        enqueueAction({
          endpoint: "/items/check",
          method: "POST",
          payload: { itemId, condicao, inventoryId, connectionId },
        });
      });

      if (itemBeforeUpdate) {
        registerLocalHistoryAction({ action: "ENCONTRADO", item: itemBeforeUpdate });
      }

      triggerItemExit(itemId, "found", () => {
        setItems((prev) =>
          prev.map((i) =>
            i.id === itemId
              ? { ...i, statusEncontrado: "SIM", condicaoVisual: condicao, meta: { ...i.meta, isRelocated: false } }
              : i,
          ),
        );
        setSaving(false);
      });
    },
    [autoSave, items, registerLocalHistoryAction, triggerItemExit],
  );

  const handleRelocate = useCallback(
    (itemId, targetSpaceId) => {
      setSaving(true);
      setRelocateModal(null);
      autoSave(() => {
        const inventoryId = localStorage.getItem("activeInventoryId");
        enqueueAction({
          endpoint: "/items/relocate",
          method: "POST",
          payload: { itemId, targetSpaceId, inventoryId, connectionId },
        });
      });
      triggerItemExit(itemId, "moving", () => {
        setItems((prev) => prev.filter((i) => i.id !== itemId));
        setSaving(false);
      });
    },
    [autoSave, triggerItemExit],
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

    // Realocação simples de item único — chama API diretamente para recarregar a sala após mover
    setSaving(true);
    try {
      await axios.post(
        `${API}/items/relocate`,
        {
          itemId: pendingMoveCandidate.id,
          targetSpaceId: spaceId,
          inventoryId,
          connectionId,
        },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      setSearchResults((prev) =>
        prev.filter((result) => result.id !== pendingMoveCandidate.id),
      );
      setSearchTerm("");
      setPendingMoveCandidate(null);
      setGroupMoveCount("");
      loadData(token, inventoryId);
      showToast({
        type: "success",
        title: "Item movido para esta sala",
        message: `${pendingMoveCandidate.patrimonio ? `Patrimônio ${pendingMoveCandidate.patrimonio}` : "Item"} realocado com sucesso.`,
      });
    } catch (err) {
      showToast({
        type: "error",
        title: "Falha na realocação",
        message: err.response?.data?.error || "Não foi possível realocar o item.",
      });
    } finally {
      setSaving(false);
    }
  }, [groupMoveCount, pendingMoveCandidate, showToast, spaceId, connectionId]);

  const handleMoveToCurrentRoom = (candidate) => {
    setPendingMoveCandidate(candidate);
  };

  const handleSearchResultAction = useCallback(
    (candidate) => {
      if (candidate.spaceId === spaceId) {
        setSearchResults((prev) =>
          prev.filter((item) => item.id !== candidate.id),
        );
        showToast({
          type: "success",
          title: "Item confirmado na sala",
          message: "O item já estava nesta sala e foi confirmado.",
        });
        handleCheck(candidate.id, candidate.condicaoVisual || "BOM");
        return;
      }

      handleMoveToCurrentRoom(candidate);
    },
    [handleCheck, spaceId],
  );

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

    registerLocalHistoryAction({
      action: "NAO_LOCALIZADO",
      item: itemToRemove,
      toSpaceName: null,
    });

    setPendingUnfoundItem(null);
    setRelocateModal(null);

    triggerItemExit(itemToRemove.id, "unfound", () => {
      setItems((prev) => prev.filter((i) => i.id !== itemToRemove.id));
    });

    showToast({
      type: "info",
      title: "Item removido da sala",
      message:
        "O item foi marcado como não localizado e enviado para sincronização.",
    });
  };

  const handleSaveObservacoes = async () => {
    if (!observacoesHasChanges) return;
    try {
      setObservacoesSaving(true);
      const token = localStorage.getItem("token");
      const inventoryId = localStorage.getItem("activeInventoryId");
      await axios.patch(
        `${API}/spaces/${spaceId}/observacoes`,
        { observacoes: observacoesText, inventoryId },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      setObservacoesHasChanges(false);
      showToast({
        type: "success",
        title: "Observações salvas",
        message: "As observações da sala foram atualizadas.",
      });
    } catch (err) {
      showToast({
        type: "error",
        title: "Erro ao salvar",
        message:
          err.response?.data?.error || "Não foi possível salvar as observações.",
      });
    } finally {
      setObservacoesSaving(false);
    }
  };

  // ── Multi-select ──────────────────────────────────────────────────────────

  const startLongPress = useCallback((itemId) => {
    longPressTimerRef.current = setTimeout(() => {
      if (navigator.vibrate) navigator.vibrate(40);
      setSelectionMode(true);
      setSelectedItemIds(new Set([itemId]));
    }, 500);
  }, []);

  const cancelLongPress = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const toggleItemSelection = useCallback((itemId) => {
    setSelectedItemIds((prev) => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      if (next.size === 0) setSelectionMode(false);
      return next;
    });
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedItemIds(new Set());
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleMultiCheck = useCallback(async () => {
    const token = localStorage.getItem("token");
    const inventoryId = localStorage.getItem("activeInventoryId");
    const targets = items.filter(
      (i) => selectedItemIds.has(i.id) && i.statusEncontrado !== "SIM",
    );
    if (targets.length === 0) { exitSelectionMode(); return; }

    // Optimistic UI first
    setItems((prev) =>
      prev.map((i) =>
        selectedItemIds.has(i.id)
          ? { ...i, statusEncontrado: "SIM", condicaoVisual: i.condicaoVisual || "BOM", meta: { ...i.meta, isRelocated: false } }
          : i,
      ),
    );
    exitSelectionMode();

    try {
      await axios.post(`${API}/items/action-by-ids`,
        { itemIds: targets.map((i) => i.id), action: "check", condicaoVisual: "BOM", inventoryId, connectionId },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      showToast({ type: "success", title: "Itens marcados", message: `${targets.length} item(ns) marcados como encontrados.` });
    } catch {
      showToast({ type: "error", title: "Erro ao marcar itens", message: "Não foi possível confirmar. Tente novamente." });
    }
  }, [items, selectedItemIds, exitSelectionMode, showToast, connectionId]);

  const handleMultiUnfound = useCallback(async () => {
    const token = localStorage.getItem("token");
    const inventoryId = localStorage.getItem("activeInventoryId");
    const targets = items.filter((i) => selectedItemIds.has(i.id));
    if (targets.length === 0) { exitSelectionMode(); return; }

    // Optimistic UI first
    setItems((prev) => prev.filter((i) => !selectedItemIds.has(i.id)));
    exitSelectionMode();

    try {
      await axios.post(`${API}/items/action-by-ids`,
        { itemIds: targets.map((i) => i.id), action: "unfound", inventoryId, connectionId },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      showToast({ type: "info", title: "Itens não localizados", message: `${targets.length} item(ns) marcados como não localizados.` });
    } catch {
      showToast({ type: "error", title: "Erro ao marcar itens", message: "Não foi possível confirmar. Tente novamente." });
    }
  }, [items, selectedItemIds, exitSelectionMode, showToast, connectionId]);

  const handleMultiMove = useCallback(async () => {
    if (!multiMoveTargetSpaceId) return;
    const token = localStorage.getItem("token");
    const inventoryId = localStorage.getItem("activeInventoryId");
    const targets = items.filter((i) => selectedItemIds.has(i.id));
    if (targets.length === 0) { exitSelectionMode(); return; }

    // Optimistic UI first
    setItems((prev) => prev.filter((i) => !selectedItemIds.has(i.id)));
    setMultiMoveOpen(false);
    setMultiMoveSpaceSearch("");
    setMultiMoveTargetSpaceId("");
    exitSelectionMode();

    try {
      await axios.post(`${API}/items/action-by-ids`,
        { itemIds: targets.map((i) => i.id), action: "relocate", targetSpaceId: multiMoveTargetSpaceId, inventoryId, connectionId },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      showToast({ type: "success", title: "Itens movidos", message: `${targets.length} item(ns) enviados para a sala de destino.` });
    } catch {
      showToast({ type: "error", title: "Erro ao mover itens", message: "Não foi possível mover. Tente novamente." });
    }
  }, [
    items, selectedItemIds, multiMoveTargetSpaceId,
    exitSelectionMode, showToast, connectionId,
  ]);

  // ─────────────────────────────────────────────────────────────────────────

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

    if (batchAction === "move" && !batchTargetSpaceId) {
      showToast({
        type: "warning",
        title: "Destino não selecionado",
        message: "Selecione a sala de destino para mover os itens.",
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

      const body = {
        inventoryId,
        spaceId,
        patrimonioInicial,
        patrimonioFinal,
        dryRun: true,
        connectionId,
      };
      if (batchAction === "confirm") body.condicaoVisual = batchCondicao;
      if (batchAction === "move") body.targetSpaceId = batchTargetSpaceId;

      const endpointMap = {
        confirm: `${API}/items/check-batch`,
        unfound: `${API}/items/unfound-batch`,
        move: `${API}/items/relocate-batch`,
      };

      const { data } = await axios.post(endpointMap[batchAction], body, {
        headers: { Authorization: `Bearer ${token}` },
      });

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

    const endpointMap = {
      confirm: `${API}/items/check-batch`,
      unfound: `${API}/items/unfound-batch`,
      move: `${API}/items/relocate-batch`,
    };

    const successMessageMap = {
      confirm: (count) => `${count} item(ns) marcados como encontrados.`,
      unfound: (count) => `${count} item(ns) marcados como não localizados.`,
      move: (count) => `${count} item(ns) movidos para a sala de destino.`,
    };

    try {
      setBatchLoading(true);
      const token = localStorage.getItem("token");
      const inventoryId = localStorage.getItem("activeInventoryId");

      const body = {
        inventoryId,
        spaceId,
        patrimonioInicial,
        patrimonioFinal,
        connectionId,
      };
      if (batchAction === "confirm") body.condicaoVisual = batchCondicao;
      if (batchAction === "move") body.targetSpaceId = batchTargetSpaceId;

      const { data } = await axios.post(endpointMap[batchAction], body, {
        headers: { Authorization: `Bearer ${token}` },
      });

      await loadData(token, inventoryId);

      setBatchPreview(data);
      setBatchConfirmOpen(false);
      showToast({
        type: "success",
        title: "Operação em massa aplicada",
        message: successMessageMap[batchAction](data.updatedCount || 0),
      });
    } catch (err) {
      showToast({
        type: "error",
        title: "Falha na operação em massa",
        message:
          err.response?.data?.error ||
          "Não foi possível aplicar a operação em massa.",
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

  // True when every sampled item has been confirmed OK (no REVERIFICAR remaining)
  // NAO_LOCALIZADO_VERIFICACAO causes auto-revert so it won't be present here
  const allVerificationItemsResolved = useMemo(() => {
    if (!space?.isFinalized || space?.isVerifiedByRevisor) return false;
    if (!["REVISOR", "ADMIN_CICLO"].includes(inventoryRole)) return false;
    if (!verificationStatus) return false; // no active verification roll
    return !items.some((i) => i.verificationStatus === "REVERIFICAR");
  }, [space?.isFinalized, space?.isVerifiedByRevisor, inventoryRole, verificationStatus, items]);

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
  const phaseBadges = getSpacePhaseBadges(space);
  const hasStateFilters =
    !showFoundItems ||
    !showRelocatedItems ||
    itemSearchFilter.trim().length > 0;

  return (
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Header Fixo */}
      <header className="bg-white shadow-lg border-b sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 py-2 sm:py-4">
          <div className="flex justify-between items-center mb-2 sm:mb-3">
            <div className="min-w-0 flex-1 mr-3">
              <h1
                className="text-base font-bold text-gray-900 truncate sm:text-2xl"
                title={space.name}
              >
                {space.name}
              </h1>
              <p className="hidden sm:block text-sm text-gray-500 mt-0.5">
                Resp: {space.responsibleDisplay || space.responsible}
              </p>
              <div className="mt-1 sm:mt-2 flex flex-wrap gap-1">
                {phaseBadges.map((badge, i) => (
                  <span
                    key={i}
                    className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold sm:px-2.5 sm:py-1 ${badge.className}`}
                  >
                    {badge.label}
                  </span>
                ))}
              </div>
            </div>
            <button
              onClick={() => router.push("/dashboard")}
              className="shrink-0 text-gray-600 hover:text-gray-900 text-sm sm:text-base"
            >
              ← Voltar
            </button>
          </div>

          <div className="w-full bg-gray-200 rounded-full h-2 sm:h-2.5 mb-1">
            <div
              className="bg-green-600 h-full rounded-full transition-all"
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
          <button
            type="button"
            onClick={() => setActiveTab("observacoes")}
            className={`px-4 py-2 rounded-lg text-sm font-medium relative ${
              activeTab === "observacoes"
                ? "bg-sky-600 text-white"
                : "text-slate-700 hover:bg-slate-100"
            }`}
          >
            Observações
            {observacoesHasChanges && (
              <span className="absolute top-1 right-1 w-2 h-2 rounded-full bg-amber-400" />
            )}
          </button>
        </div>

        {activeTab === "observacoes" ? (
          <div className="bg-white rounded-xl shadow p-5 space-y-4">
            <div>
              <h3 className="font-semibold text-gray-900 mb-1">
                Observações da sala
              </h3>
              <p className="text-sm text-gray-500">
                Registre informações relevantes sobre este espaço — detalhes de
                acesso, pendências, particularidades ou qualquer nota útil para
                a equipe.
              </p>
            </div>

            <textarea
              value={observacoesText}
              onChange={(e) => {
                setObservacoesText(e.target.value);
                setObservacoesHasChanges(true);
              }}
              placeholder="Digite aqui as observações sobre esta sala..."
              rows={8}
              className="w-full border border-slate-300 rounded-xl px-4 py-3 text-sm text-gray-800 placeholder-gray-400 resize-y focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent"
            />

            <div className="flex items-center justify-between">
              <p className="text-xs text-slate-400">
                {observacoesText.length > 0
                  ? `${observacoesText.length} caractere${observacoesText.length !== 1 ? "s" : ""}`
                  : "Nenhuma observação registrada"}
              </p>
              <button
                onClick={handleSaveObservacoes}
                disabled={!observacoesHasChanges || observacoesSaving}
                className="px-5 py-2 bg-sky-600 text-white rounded-xl text-sm font-semibold hover:bg-sky-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
              >
                {observacoesSaving ? "Salvando..." : "Salvar observações"}
              </button>
            </div>
          </div>
        ) : activeTab === "historico" ? (
          <>
            <div className="overflow-hidden rounded-3xl bg-white shadow-sm ring-1 ring-slate-200">
              {/* Mobile: card list */}
              <div className="sm:hidden">
                {movementLoading ? (
                  <p className="px-4 py-10 text-center text-sm text-slate-500">
                    Carregando atualizações...
                  </p>
                ) : movementHistory.length === 0 ? (
                  <p className="px-4 py-10 text-center text-sm text-slate-500">
                    Nenhuma atualização encontrada para esta sala.
                  </p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {movementHistory.map((entry) => (
                      <li key={entry.id} className="px-4 py-3 space-y-1.5">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${getActionBadgeClass(entry.action)}`}
                          >
                            {getActionLabel(entry.action)}
                          </span>
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${getDirectionBadgeClass(entry.direction)}`}
                          >
                            {entry.direction}
                          </span>
                        </div>
                        <p className="text-sm font-semibold text-slate-900 leading-snug">
                          #{entry.patrimonio}
                          {entry.descricao && (
                            <span className="font-normal text-slate-600">
                              {" "}— {entry.descricao}
                            </span>
                          )}
                        </p>
                        {(entry.fromSpaceName || entry.toSpaceName) && (
                          <p className="text-xs text-slate-500">
                            {entry.fromSpaceName || "-"} →{" "}
                            {entry.toSpaceName || "-"}
                          </p>
                        )}
                        <p className="text-xs text-slate-400">
                          {entry.createdBy || "-"} •{" "}
                          {formatMovementDate(entry.createdAt)}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Desktop: table */}
              <table className="hidden sm:table min-w-full divide-y divide-slate-200">
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

        {!isViewer && activeTab === "itens" ? (
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
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-sm font-semibold text-slate-800">
                    Busca geral do inventário
                  </p>
                  <p className="text-xs text-slate-500">
                    Localiza patrimônios em qualquer sala. Os itens que já estão
                    aqui aparecem com uma cor diferente.
                  </p>
                </div>
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
                    {searching ? "Buscando..." : "Buscar no inventário"}
                  </button>
                </div>

                {searchError && (
                  <p className="text-sm text-red-600">{searchError}</p>
                )}

                {searchResults.length > 0 && (
                  <ul className="border rounded-lg divide-y max-h-64 overflow-auto">
                    {searchResults.map((candidate) => {
                      const isInCurrentRoom = candidate.spaceId === spaceId;
                      const isSealed = !isInCurrentRoom && candidate.spaceIsFinalized && candidate.statusEncontrado !== "NAO";
                      const isRevisorVerified = candidate.spaceIsVerifiedByRevisor;

                      return (
                        <li
                          key={candidate.id}
                          className={`p-3 flex items-start justify-between gap-3 border-l-4 ${
                            isInCurrentRoom
                              ? "bg-sky-50 border-sky-400"
                              : isSealed
                              ? "bg-purple-50 border-purple-400"
                              : "bg-amber-50 border-amber-400"
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="font-semibold text-sm">
                              #{candidate.patrimonio}
                            </p>
                            <p className="text-sm text-gray-700">
                              {candidate.descricao}
                            </p>
                            <p className="text-xs text-gray-500">
                              {isInCurrentRoom
                                ? `Já está nesta sala${candidate.spaceName ? ` • ${candidate.spaceName}` : ""}`
                                : `Origem: ${candidate.spaceName || "Sala não informada"}`}
                            </p>
                            {isSealed && (
                              <p className="text-xs text-purple-600 font-medium mt-1">
                                🔒 {isRevisorVerified ? "Sala revisada e lacrada" : "Sala lacrada"} — para mover este item, a sala precisa ser reaberta pelo administrador.
                              </p>
                            )}
                          </div>
                          {isSealed ? (
                            <span className="shrink-0 px-3 py-1.5 bg-purple-100 text-purple-600 rounded-lg text-sm font-medium">
                              🔒 Lacrado
                            </span>
                          ) : (
                            <button
                              onClick={() => handleSearchResultAction(candidate)}
                              disabled={saving}
                              className={`shrink-0 px-3 py-1.5 text-white rounded-lg text-sm disabled:opacity-50 ${
                                isInCurrentRoom
                                  ? "bg-emerald-600 hover:bg-emerald-700"
                                  : "bg-blue-600 hover:bg-blue-700"
                              }`}
                            >
                              {isInCurrentRoom
                                ? "Confirmar na sala"
                                : "Mover para esta sala"}
                            </button>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {/* Seletor de tipo de operação em lote */}
                <div className="inline-flex rounded-lg bg-slate-100 p-1 gap-1">
                  {[
                    { key: "confirm", label: "Confirmar" },
                    { key: "unfound", label: "Não Localizado" },
                    { key: "move", label: "Mover" },
                  ].map(({ key, label }) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => {
                        setBatchAction(key);
                        setBatchPreview(null);
                        setBatchSpaceSearch("");
                        setBatchTargetSpaceId("");
                      }}
                      className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                        batchAction === key
                          ? "bg-white text-slate-900 shadow-sm"
                          : "text-slate-600 hover:text-slate-900"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                <div
                  className={`grid gap-3 ${batchAction === "unfound" ? "md:grid-cols-3" : "md:grid-cols-4"}`}
                >
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
                  {batchAction === "confirm" && (
                    <select
                      value={batchCondicao}
                      onChange={(e) => setBatchCondicao(e.target.value)}
                      className="border rounded-lg px-3 py-2"
                    >
                      <option value="BOM">🟢 Bom</option>
                      <option value="REGULAR">🟡 Regular</option>
                      <option value="RUIM">🔴 Ruim</option>
                    </select>
                  )}
                  {batchAction === "move" && (
                    <div className="relative">
                      <input
                        type="text"
                        placeholder="Buscar sala de destino..."
                        value={batchSpaceSearch}
                        onFocus={() => setBatchSpaceDropdownOpen(true)}
                        onBlur={() =>
                          setTimeout(
                            () => setBatchSpaceDropdownOpen(false),
                            150,
                          )
                        }
                        onChange={(e) => {
                          setBatchSpaceSearch(e.target.value);
                          setBatchTargetSpaceId("");
                          setBatchPreview(null);
                          setBatchSpaceDropdownOpen(true);
                        }}
                        className={`w-full border rounded-lg px-3 py-2 text-sm ${
                          batchTargetSpaceId
                            ? "border-blue-400 bg-blue-50"
                            : "border-slate-300"
                        }`}
                      />
                      {batchSpaceDropdownOpen && (
                        <div className="absolute z-20 w-full bg-white border border-slate-200 rounded-lg shadow-lg mt-1 max-h-52 overflow-auto">
                          {spaces
                            .filter((s) => s.id !== spaceId)
                            .filter(
                              (s) =>
                                batchSpaceSearch === "" ||
                                s.name
                                  .toLowerCase()
                                  .includes(batchSpaceSearch.toLowerCase()),
                            )
                            .map((s) => (
                              <button
                                key={s.id}
                                type="button"
                                disabled={s.isFinalized}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  if (s.isFinalized) return;
                                  setBatchTargetSpaceId(s.id);
                                  setBatchSpaceSearch(s.name);
                                  setBatchSpaceDropdownOpen(false);
                                  setBatchPreview(null);
                                }}
                                className={`w-full text-left px-3 py-2.5 text-sm border-b border-slate-100 last:border-0 ${
                                  s.isFinalized
                                    ? "bg-purple-50 text-purple-400 cursor-not-allowed"
                                    : batchTargetSpaceId === s.id
                                    ? "bg-blue-50 text-blue-700 font-medium"
                                    : "hover:bg-slate-50"
                                }`}
                              >
                                {s.isFinalized && "🔒 "}
                                {s.name}
                                {s.isFinalized && (
                                  <span className="ml-2 text-xs text-purple-500">
                                    {s.isVerifiedByRevisor ? "revisado" : "lacrada"}
                                  </span>
                                )}
                              </button>
                            ))}
                          {spaces
                            .filter((s) => s.id !== spaceId)
                            .filter(
                              (s) =>
                                batchSpaceSearch !== "" &&
                                !s.name
                                  .toLowerCase()
                                  .includes(batchSpaceSearch.toLowerCase()),
                            ).length ===
                            spaces.filter((s) => s.id !== spaceId).length && (
                            <p className="px-3 py-2.5 text-sm text-slate-400">
                              Nenhuma sala encontrada
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}
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
                        className={`px-4 py-2 text-white rounded-lg disabled:opacity-50 ${
                          batchAction === "unfound"
                            ? "bg-red-600 hover:bg-red-700"
                            : batchAction === "move"
                              ? "bg-blue-600 hover:bg-blue-700"
                              : "bg-emerald-600 hover:bg-emerald-700"
                        }`}
                      >
                        {batchAction === "confirm" &&
                          "Confirmar marcação em massa"}
                        {batchAction === "unfound" &&
                          "Marcar como não localizado em massa"}
                        {batchAction === "move" && "Mover em massa"}
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
              <div>
                <p className="text-sm font-semibold text-slate-800">
                  Filtro da sala
                </p>
                <p className="text-xs text-slate-500">
                  Esse campo não busca em outras salas. Ele só reduz o que já
                  está sendo exibido aqui.
                </p>
              </div>
              <div className="flex flex-nowrap items-center gap-2 md:gap-4 overflow-x-auto">
                <button
                  type="button"
                  onClick={() => setShowFoundItems((prev) => !prev)}
                  aria-pressed={showFoundItems}
                  className={`inline-flex items-center gap-0.5 md:gap-2 rounded-full border px-1.5 md:px-3 py-0.5 md:py-1.5 text-xs md:text-sm font-medium transition whitespace-nowrap flex-shrink-0 ${
                    showFoundItems
                      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                      : "border-slate-300 bg-slate-100 text-slate-500"
                  }`}
                >
                  <span>{showFoundItems ? "✓" : "○"}</span>
                  <span>Encontrados</span>
                  <span
                    className={`rounded-full px-1 md:px-2 py-0.5 text-xs font-semibold ${
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
                  className={`inline-flex items-center gap-0.5 md:gap-2 rounded-full border px-1.5 md:px-3 py-0.5 md:py-1.5 text-xs md:text-sm font-medium transition whitespace-nowrap flex-shrink-0 ${
                    showRelocatedItems
                      ? "border-amber-300 bg-amber-50 text-amber-700"
                      : "border-slate-300 bg-slate-100 text-slate-500"
                  }`}
                >
                  <span>{showRelocatedItems ? "✓" : "○"}</span>
                  <span>Movidos</span>
                  <span
                    className={`rounded-full px-1 md:px-2 py-0.5 text-xs font-semibold ${
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

            {/* Search filter for patrimonio and description */}
            <div className="mt-4 flex flex-col gap-3">
              <input
                type="text"
                value={itemSearchFilter}
                onChange={(e) => setItemSearchFilter(e.target.value)}
                placeholder="Filtrar apenas os itens visíveis nesta sala..."
                className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />

              {/* Show "Select all filtered" button when in multi-select mode and there are filtered items */}
              {selectionMode && filteredItems.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    const allFilteredIds = new Set(
                      filteredItems.map((item) => item.id),
                    );
                    setSelectedItemIds(allFilteredIds);
                  }}
                  className="w-full px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition"
                >
                  ✓ Selecionar {filteredItems.length} filtrado
                  {filteredItems.length !== 1 ? "s" : ""}
                </button>
              )}
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
                          {!isViewer && !allFound && (
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
                                      condicao: i.condicaoVisual || "BOM",
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
                                          i.condicaoVisual || "BOM",
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
                          {!isViewer && relocatedCount > 0 && (
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
                          {!isViewer && allFound && (
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
                              onTouchStart={() =>
                                !selectionMode && startLongPress(item.id)
                              }
                              onTouchEnd={cancelLongPress}
                              onTouchMove={cancelLongPress}
                              onTouchCancel={cancelLongPress}
                              onContextMenu={(e) => {
                                e.preventDefault();
                                if (!selectionMode) {
                                  setSelectionMode(true);
                                  setSelectedItemIds(new Set([item.id]));
                                }
                              }}
                              onClick={() =>
                                selectionMode && toggleItemSelection(item.id)
                              }
                              style={
                                exitingItems[item.id]
                                  ? { animation: `item-exit-${exitingItems[item.id]} 0.34s ease forwards`, pointerEvents: "none" }
                                  : undefined
                              }
                              className={`relative rounded-lg border-l-4 transition-all select-none ${
                                selectionMode && selectedItemIds.has(item.id)
                                  ? "ring-2 ring-blue-500 ring-offset-1"
                                  : ""
                              } ${
                                item.verificationStatus ===
                                "NAO_LOCALIZADO_VERIFICACAO"
                                  ? "border-red-500 bg-red-50"
                                  : item.verificationStatus === "REVERIFICAR" ||
                                      verificationItems?.includes(item.id)
                                    ? "border-purple-500 bg-purple-50"
                                    : item.meta?.isRelocated
                                      ? "border-yellow-500 bg-yellow-50"
                                      : item.statusEncontrado === "SIM"
                                        ? "border-green-500 bg-green-50"
                                        : "border-gray-300 bg-gray-50"
                              }`}
                            >
                              {selectionMode && (
                                <div className="absolute top-2 right-2 z-10 pointer-events-none">
                                  <div
                                    className={`w-5 h-5 rounded-full border-2 flex items-center justify-center text-xs font-bold ${
                                      selectedItemIds.has(item.id)
                                        ? "bg-blue-600 border-blue-600 text-white"
                                        : "border-slate-400 bg-white"
                                    }`}
                                  >
                                    {selectedItemIds.has(item.id) && "✓"}
                                  </div>
                                </div>
                              )}
                              <div className="p-4">
                                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                                  <div
                                    className="flex-1 cursor-pointer"
                                    onClick={(e) => {
                                      if (selectionMode) return;
                                      e.stopPropagation();
                                      setExpandedItem(
                                        expandedItem === item.id
                                          ? null
                                          : item.id,
                                      );
                                    }}
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
                                      {item.meta?.isRelocated &&
                                        (item.meta?.wasUnfound ? (
                                          <span className="px-2 py-0.5 bg-orange-200 text-orange-800 text-xs rounded font-medium">
                                            🔍 Não localizado em{" "}
                                            {item.meta.fromSpaceName}
                                          </span>
                                        ) : (
                                          <span className="px-2 py-0.5 bg-yellow-200 text-yellow-800 text-xs rounded font-medium">
                                            ⚠️ Movido de{" "}
                                            {item.meta.fromSpaceName}
                                          </span>
                                        ))}
                                      {item.statusEncontrado === "SIM" &&
                                        !item.verificationStatus && (
                                          <span className="text-green-600 text-sm">
                                            ✓
                                          </span>
                                        )}
                                    </div>
                                    <p className={`text-gray-600 text-xs ${expandedItem === item.id ? "" : "line-clamp-2"}`}>
                                      {item.descricao}
                                    </p>
                                  </div>

                                  <div className="flex justify-between gap-2 md:gap-4 w-full mt-3">
                                    {!selectionMode &&
                                      (item.verificationStatus ===
                                        "REVERIFICAR" ||
                                      verificationItems?.includes(item.id)
                                        ? ["REVISOR", "ADMIN_CICLO"].includes(
                                            inventoryRole,
                                          )
                                          ? (
                                            <>
                                              <button
                                                disabled={saving}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleVerifyCheck(
                                                    item.id,
                                                    "SIM",
                                                  );
                                                }}
                                                className="flex-1 px-3 md:px-4 py-2 md:py-2.5 bg-purple-600 text-white rounded md:rounded-lg text-sm md:text-base font-medium hover:bg-purple-700 transition disabled:opacity-50"
                                              >
                                                <span className="hidden md:inline">
                                                  ✅ Está aqui
                                                </span>
                                                <span className="md:hidden">
                                                  ✅ Aqui
                                                </span>
                                              </button>
                                              <button
                                                disabled={saving}
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  handleVerifyCheck(
                                                    item.id,
                                                    "NAO",
                                                  );
                                                }}
                                                className="flex-1 px-3 md:px-4 py-2 md:py-2.5 bg-red-100 text-red-700 rounded md:rounded-lg text-sm md:text-base font-medium hover:bg-red-200 transition disabled:opacity-50"
                                              >
                                                <span className="hidden md:inline">
                                                  ❌ Não está aqui
                                                </span>
                                                <span className="md:hidden">
                                                  ❌ N.Aqui
                                                </span>
                                              </button>
                                            </>
                                          )
                                          : null
                                        : item.statusEncontrado === "SIM"
                                          ? null
                                          : item.verificationStatus ===
                                              "NAO_LOCALIZADO_VERIFICACAO"
                                            ? (
                                              <span className="px-3 py-1.5 bg-red-100 text-red-700 rounded-lg text-xs font-medium">
                                                ⚠️ Aguardando conferente
                                              </span>
                                            )
                                            : !isViewer
                                              ? (
                                              <>
                                                <button
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleCheck(
                                                      item.id,
                                                      item.condicaoVisual ||
                                                        "BOM",
                                                    );
                                                  }}
                                                  className="flex-1 px-3 md:px-4 py-2 md:py-2.5 bg-green-600 text-white rounded md:rounded-lg text-sm md:text-base font-medium hover:bg-green-700 transition"
                                                >
                                                  <span className="hidden md:inline">
                                                    ✅ Encontrado
                                                  </span>
                                                  <span className="md:hidden">
                                                    ✅ Enc.
                                                  </span>
                                                </button>
                                                {!space?.isFinalized && (
                                                  <button
                                                    onClick={(e) => {
                                                      e.stopPropagation();
                                                      setRelocateModal(item);
                                                    }}
                                                    className="flex-1 px-3 md:px-4 py-2 md:py-2.5 bg-blue-600 text-white rounded md:rounded-lg text-sm md:text-base font-medium hover:bg-blue-700 transition"
                                                  >
                                                    <span className="hidden md:inline">
                                                      ➡️ Mover
                                                    </span>
                                                    <span className="md:hidden">
                                                      ➡️ Mov.
                                                    </span>
                                                  </button>
                                                )}
                                                <button
                                                  onClick={(e) => {
                                                    e.stopPropagation();
                                                    setPendingUnfoundItem(item);
                                                  }}
                                                  className="flex-1 px-3 md:px-4 py-2 md:py-2.5 bg-red-100 text-red-700 rounded md:rounded-lg text-sm md:text-base font-medium hover:bg-red-200 transition"
                                                >
                                                  <span className="hidden md:inline">
                                                    🚫 Não localizado
                                                  </span>
                                                  <span className="md:hidden">
                                                    🚫 N.Loc
                                                  </span>
                                                </button>
                                              </>
                                            ) : null)}
                                  </div>
                                </div>
                              </div>

                              {/* Inner expanded details */}
                              {expandedItem === item.id && (
                                <div className="px-4 pb-4 border-t pt-3">
                                  <div className="space-y-1.5 mb-4 text-sm text-gray-700">
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

                                  {!isViewer && (
                                  <div>
                                    <p className="mb-2 text-sm font-semibold text-gray-800">
                                      🎨 Estado de Conservação:
                                    </p>
                                    <div className="flex flex-wrap gap-2 mb-4">
                                      {[["BOM", "🟢 Bom"], ["REGULAR", "🟡 Regular"], ["RUIM", "🔴 Ruim"]].map(
                                        ([status, label]) => (
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
                                            {label}
                                          </button>
                                        ),
                                      )}
                                    </div>
                                  </div>
                                  )}

                                  {!isViewer && (
                                  <button
                                    onClick={() => handleUndoLastAction(item)}
                                    disabled={saving || !canUndoAction}
                                    className="px-3 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    ↩️ Desfazer
                                  </button>
                                  )}
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
                onTouchStart={() => !selectionMode && startLongPress(item.id)}
                onTouchEnd={cancelLongPress}
                onTouchMove={cancelLongPress}
                onTouchCancel={cancelLongPress}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!selectionMode) {
                    setSelectionMode(true);
                    setSelectedItemIds(new Set([item.id]));
                  }
                }}
                onClick={() => selectionMode && toggleItemSelection(item.id)}
                style={
                  exitingItems[item.id]
                    ? { animation: `item-exit-${exitingItems[item.id]} 0.34s ease forwards`, pointerEvents: "none" }
                    : undefined
                }
                className={`relative rounded-xl shadow border-l-4 transition-all select-none ${
                  selectionMode && selectedItemIds.has(item.id)
                    ? "ring-2 ring-blue-500 ring-offset-1"
                    : ""
                } ${
                  item.verificationStatus === "NAO_LOCALIZADO_VERIFICACAO"
                    ? "border-red-500 bg-red-50"
                    : item.verificationStatus === "REVERIFICAR" ||
                        verificationItems?.includes(item.id)
                      ? "border-purple-500 bg-purple-50"
                      : item.meta?.isRelocated
                        ? "border-yellow-500 bg-yellow-50"
                        : item.statusEncontrado === "SIM"
                          ? "border-green-500 bg-green-50"
                          : "border-gray-300 bg-white"
                }`}
              >
                {selectionMode && (
                  <div className="absolute top-3 right-3 z-10 pointer-events-none">
                    <div
                      className={`w-6 h-6 rounded-full border-2 flex items-center justify-center text-xs font-bold ${
                        selectedItemIds.has(item.id)
                          ? "bg-blue-600 border-blue-600 text-white"
                          : "border-slate-400 bg-white"
                      }`}
                    >
                      {selectedItemIds.has(item.id) && "✓"}
                    </div>
                  </div>
                )}
                {/* Card Colapsado */}
                <div className="p-4 lg:p-5">
                  {/* Linha 1: patrimônio + descrição (clique para expandir) */}
                  <div
                    className="cursor-pointer mb-3"
                    onClick={(e) => {
                      if (selectionMode) return;
                      e.stopPropagation();
                      setExpandedItem(
                        expandedItem === item.id ? null : item.id,
                      );
                    }}
                  >
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <span className="font-bold text-lg">
                        #{item.patrimonio}
                      </span>
                      {item.verificationStatus ===
                        "NAO_LOCALIZADO_VERIFICACAO" && (
                        <span className="px-2 py-0.5 bg-red-200 text-red-800 text-xs rounded font-medium">
                          ⚠️ Não localizado na verificação
                        </span>
                      )}
                      {item.meta?.isRelocated &&
                        (item.meta?.wasUnfound ? (
                          <span className="px-2 py-0.5 bg-orange-200 text-orange-800 text-xs rounded font-medium">
                            🔍 Não localizado em {item.meta.fromSpaceName}
                          </span>
                        ) : (
                          <span className="px-2 py-0.5 bg-yellow-200 text-yellow-800 text-xs rounded font-medium">
                            ⚠️ Movido de {item.meta.fromSpaceName}
                          </span>
                        ))}
                      {item.statusEncontrado === "SIM" &&
                        !item.verificationStatus && (
                          <span className="text-green-600 text-sm">✓</span>
                        )}
                    </div>
                    <p className={`text-gray-700 text-sm ${expandedItem === item.id ? "" : "line-clamp-2"}`}>
                      {item.descricao}
                    </p>
                  </div>

                  {/* Linha 2: botão expandir + botões de ação */}
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setExpandedItem(expandedItem === item.id ? null : item.id);
                      }}
                      className="shrink-0 flex items-center justify-center w-9 h-9 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-600 text-sm font-medium"
                    >
                      {expandedItem === item.id ? "▲" : "▼"}
                    </button>
                    <div className="flex flex-1 gap-2">
                      {!selectionMode &&
                        (item.verificationStatus === "REVERIFICAR" ||
                        verificationItems?.includes(item.id)
                          ? ["REVISOR", "ADMIN_CICLO"].includes(inventoryRole)
                            ? (
                              <>
                                <button
                                  disabled={saving}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleVerifyCheck(item.id, "SIM");
                                  }}
                                  className="flex-1 px-3 md:px-4 py-2 md:py-2.5 bg-purple-600 text-white rounded md:rounded-lg text-sm md:text-base font-medium hover:bg-purple-700 transition disabled:opacity-50"
                                >
                                  <span className="hidden md:inline">
                                    ✅ Está aqui
                                  </span>
                                  <span className="md:hidden">✅ Aqui</span>
                                </button>
                                <button
                                  disabled={saving}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleVerifyCheck(item.id, "NAO");
                                  }}
                                  className="flex-1 px-3 md:px-4 py-2 md:py-2.5 bg-red-100 text-red-700 rounded md:rounded-lg text-sm md:text-base font-medium hover:bg-red-200 transition disabled:opacity-50"
                                >
                                  <span className="hidden md:inline">
                                    ❌ Não está aqui
                                  </span>
                                  <span className="md:hidden">❌ N.Aqui</span>
                                </button>
                              </>
                            )
                            : null
                          : item.statusEncontrado === "SIM"
                            ? null
                            : item.verificationStatus ===
                                "NAO_LOCALIZADO_VERIFICACAO"
                              ? (
                                <span className="px-3 py-1.5 bg-red-100 text-red-700 rounded-lg text-xs font-medium">
                                  ⚠️ Aguardando conferente
                                </span>
                              )
                              : !isViewer
                                ? (
                                <>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleCheck(
                                        item.id,
                                        item.condicaoVisual || "BOM",
                                      );
                                    }}
                                    className="flex-1 px-3 md:px-4 py-2 md:py-2.5 bg-green-600 text-white rounded md:rounded-lg text-sm md:text-base font-medium hover:bg-green-700 transition"
                                  >
                                    <span className="hidden md:inline">
                                      ✅ Encontrado
                                    </span>
                                    <span className="md:hidden">✅ Enc.</span>
                                  </button>
                                  {!space?.isFinalized && (
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setRelocateModal(item);
                                      }}
                                      className="flex-1 px-3 md:px-4 py-2 md:py-2.5 bg-blue-600 text-white rounded md:rounded-lg text-sm md:text-base font-medium hover:bg-blue-700 transition"
                                    >
                                      <span className="hidden md:inline">
                                        ➡️ Mover
                                      </span>
                                      <span className="md:hidden">➡️ Mov.</span>
                                    </button>
                                  )}
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setPendingUnfoundItem(item);
                                    }}
                                    className="flex-1 px-3 md:px-4 py-2 md:py-2.5 bg-red-100 text-red-700 rounded md:rounded-lg text-sm md:text-base font-medium hover:bg-red-200 transition"
                                  >
                                    <span className="hidden md:inline">
                                      🚫 Não localizado
                                    </span>
                                    <span className="md:hidden">🚫 N.Loc</span>
                                  </button>
                                </>
                              ) : null)}
                    </div>
                  </div>
                </div>

                {/* Expandido */}
                {expandedItem === item.id && (
                  <div className="px-5 pb-5 border-t pt-4">
                    <div className="space-y-2 mb-5 text-sm text-gray-700">
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

                    {!isViewer && (
                    <div>
                      <p className="mb-2 text-sm font-semibold text-gray-800">
                        🎨 Estado de Conservação:
                      </p>
                      <div className="flex flex-wrap gap-3 mb-5">
                        {[["BOM", "🟢 Bom"], ["REGULAR", "🟡 Regular"], ["RUIM", "🔴 Ruim"]].map(([status, label]) => (
                          <button
                            key={status}
                            onClick={() => handleCheck(item.id, status)}
                            className={`py-2 px-4 rounded-lg font-medium transition ${
                              item.condicaoVisual === status
                                ? "bg-blue-600 text-white"
                                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                            }`}
                          >
                            {label}
                          </button>
                        ))}
                      </div>
                    </div>
                    )}

                    {!isViewer && (
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
                    )}
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
                inventoryRole === "ADMIN_CICLO" && (
                  <button
                    onClick={() => setIsRevertModalOpen(true)}
                    className="px-6 py-3 bg-slate-600 text-white rounded-xl font-semibold hover:bg-slate-700 shadow-lg"
                  >
                    🔓 Reabrir Sala
                  </button>
                )}
              {allVerificationItemsResolved && (
                <button
                  onClick={handleCompleteVerification}
                  disabled={saving}
                  className="px-6 py-3 bg-purple-600 text-white rounded-xl font-semibold hover:bg-purple-700 shadow-lg disabled:opacity-50"
                >
                  🟣 Fechar Definitivamente
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
          <p className="text-sm text-gray-600 mb-3">
            Selecione o novo espaço de destino:
          </p>
          <input
            type="text"
            value={relocateSearchInput}
            onChange={(e) => setRelocateSearchInput(e.target.value)}
            placeholder="Pesquisar espaço de destino..."
            className="w-full border rounded-lg p-3 mb-3"
            autoFocus
          />
          <div className="border rounded-lg divide-y max-h-64 overflow-auto mb-2">
            {filteredRelocationSpaces.length === 0 ? (
              <p className="px-3 py-3 text-sm text-amber-700 bg-amber-50">
                Nenhum espaço encontrado para o termo informado.
              </p>
            ) : (
              filteredRelocationSpaces.map((s) => {
                const isSealed = s.isFinalized;
                const isRevisorVerified = s.isVerifiedByRevisor;
                return (
                  <button
                    key={s.id}
                    type="button"
                    disabled={isSealed}
                    onClick={() =>
                      !isSealed && relocateModal && handleRelocate(relocateModal.id, s.id)
                    }
                    className={`w-full text-left px-3 py-2.5 border-b border-slate-100 last:border-0 transition ${
                      isSealed
                        ? "bg-purple-50 cursor-not-allowed"
                        : "hover:bg-slate-50 cursor-pointer"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-medium truncate ${isSealed ? "text-purple-700" : "text-slate-800"}`}>
                          {isSealed && "🔒 "}
                          {s.name}
                        </p>
                        <p className={`text-xs mt-0.5 ${isSealed ? "text-purple-500" : "text-slate-500"}`}>
                          {s.responsibleDisplay || s.responsible}
                        </p>
                        {isSealed && (
                          <p className="text-xs text-purple-600 font-medium mt-1">
                            {isRevisorVerified
                              ? "Sala revisada e lacrada — não pode receber novos itens"
                              : "Sala lacrada — não pode receber novos itens"}
                          </p>
                        )}
                      </div>
                      {isSealed && (
                        <span className="shrink-0 text-xs bg-purple-100 text-purple-600 px-2 py-0.5 rounded-full font-medium mt-0.5">
                          {isRevisorVerified ? "Revisado" : "Lacrado"}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
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
        title={
          batchAction === "confirm"
            ? "Confirmar encontrado em massa"
            : batchAction === "unfound"
              ? "Marcar não localizado em massa"
              : "Mover itens em massa"
        }
        message={
          batchAction === "confirm"
            ? `Aplicar status de encontrado para ${batchPreview?.matchedCount || 0} item(ns) no intervalo informado?`
            : batchAction === "unfound"
              ? `Marcar ${batchPreview?.matchedCount || 0} item(ns) como não localizado no intervalo informado?`
              : `Mover ${batchPreview?.matchedCount || 0} item(ns) para a sala de destino selecionada?`
        }
        confirmText={
          batchAction === "confirm"
            ? "Aplicar em massa"
            : batchAction === "unfound"
              ? "Marcar não localizado"
              : "Mover em massa"
        }
        cancelText="Cancelar"
        variant={batchAction === "unfound" ? "danger" : "warning"}
      />

      {isRevertModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl p-6 w-full max-w-md">
            <h2 className="text-lg font-bold text-gray-900 mb-2">🔓 Reabrir Sala</h2>
            <p className="text-sm text-gray-600 mb-4">
              Esta ação remove o lacre da sala e permite novas conferências. Descreva o motivo da reabertura.
            </p>
            <textarea
              value={reopenJustification}
              onChange={(e) => setReopenJustification(e.target.value)}
              placeholder="Descreva a justificativa para reabrir esta sala (mínimo 10 caracteres)..."
              className="w-full border border-gray-300 rounded-xl p-3 text-sm resize-none h-28 focus:outline-none focus:ring-2 focus:ring-slate-400 mb-4"
            />
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setIsRevertModalOpen(false); setReopenJustification(""); }}
                className="px-4 py-2 rounded-xl border border-gray-300 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancelar
              </button>
              <button
                onClick={handleRevertFinalization}
                disabled={reopenJustification.trim().length < 10}
                className="px-4 py-2 rounded-xl bg-slate-700 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                🔓 Confirmar Reabertura
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Barra flutuante de seleção múltipla ──────────────────────────── */}
      {selectionMode && (
        <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 flex items-center justify-between gap-3 bg-white rounded-2xl shadow-2xl border border-slate-200 px-4 py-3 w-11/12 max-w-2xl">
          <span className="text-xs font-semibold text-slate-500 whitespace-nowrap">
            {selectedItemIds.size} sel.
          </span>

          {selectedItemIds.size >= 2 && !space?.isFinalized && (
            <>
              <button
                onClick={handleMultiCheck}
                className="flex-1 px-3 md:px-4 py-2 md:py-2.5 bg-green-600 text-white rounded md:rounded-lg text-sm md:text-base font-medium hover:bg-green-700 active:scale-95 transition-transform"
              >
                <span className="hidden sm:inline">✅ Localizado</span>
                <span className="sm:hidden">✅ Loc</span>
              </button>
              <button
                onClick={() => {
                  setMultiMoveSpaceSearch("");
                  setMultiMoveTargetSpaceId("");
                  setMultiMoveOpen(true);
                }}
                className="flex-1 px-3 md:px-4 py-2 md:py-2.5 bg-blue-600 text-white rounded md:rounded-lg text-sm md:text-base font-medium hover:bg-blue-700 active:scale-95 transition-transform"
              >
                <span className="hidden sm:inline">➡️ Mover</span>
                <span className="sm:hidden">➡️ Mov</span>
              </button>
              <button
                onClick={handleMultiUnfound}
                className="flex-1 px-3 md:px-4 py-2 md:py-2.5 bg-red-600 text-white rounded md:rounded-lg text-sm md:text-base font-medium hover:bg-red-700 active:scale-95 transition-transform"
              >
                <span className="hidden sm:inline">🚫 N. Loc.</span>
                <span className="sm:hidden">🚫 NL</span>
              </button>
            </>
          )}

          <button
            onClick={exitSelectionMode}
            className="ml-1 w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 text-sm font-bold active:scale-95 transition-transform flex-shrink-0"
          >
            ✕
          </button>
        </div>
      )}

      {/* ── Modal de destino para mover em multi-select ───────────────────── */}
      {multiMoveOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setMultiMoveOpen(false);
            }
          }}
        >
          <div className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl shadow-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-slate-800">
                Mover {selectedItemIds.size} item(ns)
              </h3>
              <button
                onClick={() => setMultiMoveOpen(false)}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 text-sm font-bold"
              >
                ✕
              </button>
            </div>

            <div className="relative mb-4">
              <input
                type="text"
                placeholder="Buscar sala de destino..."
                autoFocus
                value={multiMoveSpaceSearch}
                onFocus={() => setMultiMoveSpaceDropdownOpen(true)}
                onBlur={() =>
                  setTimeout(() => setMultiMoveSpaceDropdownOpen(false), 150)
                }
                onChange={(e) => {
                  setMultiMoveSpaceSearch(e.target.value);
                  setMultiMoveTargetSpaceId("");
                  setMultiMoveSpaceDropdownOpen(true);
                }}
                className={`w-full border rounded-xl px-4 py-2.5 text-sm ${
                  multiMoveTargetSpaceId
                    ? "border-blue-400 bg-blue-50"
                    : "border-slate-300"
                }`}
              />
              {multiMoveSpaceDropdownOpen && (
                <div className="absolute z-10 w-full bg-white border border-slate-200 rounded-xl shadow-lg mt-1 max-h-52 overflow-auto">
                  {spaces
                    .filter((s) => s.id !== spaceId)
                    .filter(
                      (s) =>
                        multiMoveSpaceSearch === "" ||
                        s.name
                          .toLowerCase()
                          .includes(multiMoveSpaceSearch.toLowerCase()),
                    )
                    .map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        disabled={s.isFinalized}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          if (s.isFinalized) return;
                          setMultiMoveTargetSpaceId(s.id);
                          setMultiMoveSpaceSearch(s.name);
                          setMultiMoveSpaceDropdownOpen(false);
                        }}
                        className={`w-full text-left px-4 py-2.5 text-sm border-b border-slate-100 last:border-0 ${
                          s.isFinalized
                            ? "bg-purple-50 text-purple-400 cursor-not-allowed"
                            : multiMoveTargetSpaceId === s.id
                            ? "bg-blue-50 text-blue-700 font-medium"
                            : "hover:bg-slate-50"
                        }`}
                      >
                        {s.isFinalized && "🔒 "}
                        {s.name}
                        {s.isFinalized && (
                          <span className="ml-2 text-xs text-purple-500">
                            {s.isVerifiedByRevisor ? "revisado" : "lacrada"}
                          </span>
                        )}
                      </button>
                    ))}
                  {spaces.filter(
                    (s) =>
                      s.id !== spaceId &&
                      multiMoveSpaceSearch !== "" &&
                      !s.name
                        .toLowerCase()
                        .includes(multiMoveSpaceSearch.toLowerCase()),
                  ).length ===
                    spaces.filter((s) => s.id !== spaceId).length && (
                    <p className="px-4 py-2.5 text-sm text-slate-400">
                      Nenhuma sala encontrada
                    </p>
                  )}
                </div>
              )}
            </div>

            <button
              onClick={handleMultiMove}
              disabled={!multiMoveTargetSpaceId}
              className="w-full py-2.5 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Confirmar movimentação
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
