"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { useToast } from "../../components/Toast/toastContext";
import { useSSE } from "../../lib/useSSE";
import Modal from "../../components/Modal/Modal";
import ModalBody from "../../components/Modal/ModalBody";
import ModalFooter from "../../components/Modal/ModalFooter";
import SpaceSearchBar from "../../components/SpaceSearchBar/SpaceSearchBar";
import StrategicDashboardPanel from "../../components/StrategicDashboardPanel/StrategicDashboardPanel";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const INVENTORY_ROLES = [
  "ADMIN_CICLO",
  "CONFERENTE",
  "REVISOR",
  "VISUALIZADOR",
];
const INVENTORY_STATUSES = [
  "NAO_INICIADO",
  "EM_EXECUCAO",
  "PAUSADO",
  "EM_AUDITORIA",
  "FINALIZADO",
  "CANCELADO",
];
const STATUS_LABELS = {
  NAO_INICIADO: "Não iniciado",
  EM_EXECUCAO: "Em execução",
  PAUSADO: "Pausado",
  EM_AUDITORIA: "Em Auditoria",
  FINALIZADO: "Finalizado",
  CANCELADO: "Cancelado",
};
const STATUS_BADGE_STYLES = {
  NAO_INICIADO: "bg-slate-100 text-slate-700 ring-slate-200",
  EM_EXECUCAO: "bg-emerald-100 text-emerald-700 ring-emerald-200",
  PAUSADO: "bg-amber-100 text-amber-700 ring-amber-200",
  EM_AUDITORIA: "bg-sky-100 text-sky-700 ring-sky-200",
  FINALIZADO: "bg-indigo-100 text-indigo-700 ring-indigo-200",
  CANCELADO: "bg-rose-100 text-rose-700 ring-rose-200",
};
const DASHBOARD_TABS = [
  {
    id: "espacos",
    label: "Espaços",
  },
  {
    id: "estrategico",
    label: "Acompanhamento",
  },
  {
    id: "usuarios",
    label: "Usuarios",
  },
  {
    id: "dados",
    label: "Dados",
  },
  {
    id: "criar-grupos",
    label: "Criar Grupos",
  },
  {
    id: "nao-localizados",
    label: "Não Localizados",
  },
  {
    id: "backups",
    label: "Backups",
  },
];

export default function DashboardPage() {
  const [spaces, setSpaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [spaceModal, setSpaceModal] = useState(null);
  const [activeInventory, setActiveInventory] = useState(null);
  const [spaceForm, setSpaceForm] = useState({
    name: "",
    responsible: "",
    sector: "",
    unit: "",
  });
  const [activeTab, setActiveTab] = useState("espacos");
  const [inventoryDetails, setInventoryDetails] = useState(null);
  const [inventoryNameDraft, setInventoryNameDraft] = useState("");
  const [inventoryStatusDraft, setInventoryStatusDraft] =
    useState("NAO_INICIADO");
  const [savingInventorySettings, setSavingInventorySettings] = useState(false);
  const [statusHistory, setStatusHistory] = useState([]);
  const [loadingStatusHistory, setLoadingStatusHistory] = useState(false);
  const [members, setMembers] = useState([]);
  const [permissionsLoading, setPermissionsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchingUsers, setSearchingUsers] = useState(false);
  const [searchResults, setSearchResults] = useState([]);
  const [newMemberRole, setNewMemberRole] = useState("CONFERENTE");
  const [allItems, setAllItems] = useState([]);
  const [loadingItems, setLoadingItems] = useState(false);
  const [groupedItems, setGroupedItems] = useState({});
  const [expandedGroups, setExpandedGroups] = useState({});
  const [selectedItems, setSelectedItems] = useState(new Set());
  const [groupCreationModal, setGroupCreationModal] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDescription, setNewGroupDescription] = useState("");
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [itemSearch, setItemSearch] = useState("");
  const [itemGroups, setItemGroups] = useState([]);
  const [loadingGroups, setLoadingGroups] = useState(false);
  const [expandedCreatedGroups, setExpandedCreatedGroups] = useState({});
  const [groupSubTab, setGroupSubTab] = useState("itens");

  // Estados para aba "Não Localizados"
  const [unfoundItems, setUnfoundItems] = useState([]);
  const [unfoundLoading, setUnfoundLoading] = useState(false);
  const [expandedUnfoundItem, setExpandedUnfoundItem] = useState(null);
  const [unfoundSubTab, setUnfoundSubTab] = useState("itens");
  const [unfoundItemHistory, setUnfoundItemHistory] = useState([]);
  const [unfoundHistoryLoading, setUnfoundHistoryLoading] = useState(false);
  const [expandedUnfoundItems, setExpandedUnfoundItems] = useState({});
  const [unfoundActionModal, setUnfoundActionModal] = useState(null); // { item, action: "mover" }
  const [unfoundCondicao, setUnfoundCondicao] = useState("BOM");
  const [unfoundMoveTargetSpaceId, setUnfoundMoveTargetSpaceId] = useState("");
  const [savingUnfoundAction, setSavingUnfoundAction] = useState(false);
  const [dashboardSummary, setDashboardSummary] = useState(null);
  const [dashboardSummaryLoading, setDashboardSummaryLoading] = useState(false);
  const [dashboardSummaryError, setDashboardSummaryError] = useState("");
  const [dashboardSummaryDenied, setDashboardSummaryDenied] = useState(false);

  // Backup state
  const [backupInventories, setBackupInventories] = useState([]); // inventories the user can manage backups for
  const [backupSelectedInventoryId, setBackupSelectedInventoryId] = useState(null);
  const [backupList, setBackupList] = useState([]);
  const [backupSchedule, setBackupSchedule] = useState(null);
  const [backupLockStatus, setBackupLockStatus] = useState(null);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupListLoading, setBackupListLoading] = useState(false);
  const [backupLabelInput, setBackupLabelInput] = useState("");
  const [scheduleIntervalInput, setScheduleIntervalInput] = useState("");
  const [backupRestoreId, setBackupRestoreId] = useState(null);
  const [backupDeleteId, setBackupDeleteId] = useState(null);
  const [backupConfirmAction, setBackupConfirmAction] = useState(null); // "restore" | "delete"
  const [dashboardRecentEvents, setDashboardRecentEvents] = useState([]);
  const router = useRouter();
  const { showToast } = useToast();

  // SSE — listen for realtime events across the entire inventory
  const currentInventoryId =
    typeof window !== "undefined"
      ? localStorage.getItem("activeInventoryId")
      : null;
  const { lastEvent } = useSSE({
    inventoryId: currentInventoryId,
    spaceId: null, // no space filter — see all events for this inventory
    enabled: !!currentInventoryId && activeTab === "estrategico",
  });

  // React to SSE events — show toast and refresh data
  const loadSpacesRef = useRef(null);
  const loadDashboardSummaryRef = useRef(null);
  useEffect(() => {
    if (!lastEvent) return;
    const token = localStorage.getItem("token");
    if (!token || !currentInventoryId || !loadSpacesRef.current) return;

    const config = {
      item_relocated: {
        title: "📦 Item realocado",
        msg: `${lastEvent.data.user} moveu um item para outra sala.`,
      },
      group_relocated: {
        title: `📦 Grupo realocado`,
        msg: `${lastEvent.data.user} moveu ${lastEvent.data.count} itens de um grupo.`,
      },
      item_checked: {
        title: "✅ Item conferido",
        msg: `${lastEvent.data.user} marcou um item como encontrado.`,
      },
      item_unfound: {
        title: "Item nao localizado",
        msg: `${lastEvent.data.user} marcou um item como nao localizado.`,
      },
      item_unchecked: {
        title: "Conferencia desfeita",
        msg: `${lastEvent.data.user} desfez a conferencia de um item.`,
      },
      item_verified: {
        title: "Item verificado",
        msg: `${lastEvent.data.user} confirmou um item na reverificacao.`,
      },
      batch_checked: {
        title: "✅ Conferência em massa",
        msg: `${lastEvent.data.user} conferiu ${lastEvent.data.count} itens.`,
      },
      batch_unfound: {
        title: "Não localizados em massa",
        msg: `${lastEvent.data.user} marcou ${lastEvent.data.count} itens como não localizados.`,
      },
      batch_relocated: {
        title: "📦 Movimentação em massa",
        msg: `${lastEvent.data.user} moveu ${lastEvent.data.count} itens em lote.`,
      },
      item_restored: {
        title: "🔄 Item restaurado",
        msg: `${lastEvent.data.user} restaurou um item.`,
      },
    };

    const c = config[lastEvent.type];
    if (c) {
      showToast({ type: "info", title: c.title, message: c.msg });
      setDashboardRecentEvents((prev) => {
        const nextEvent = {
          type: lastEvent.type,
          data: lastEvent.data,
          receivedAt: new Date().toISOString(),
        };
        return [nextEvent, ...prev].slice(0, 8);
      });
      // Refresh dashboard data
      if (loadSpacesRef.current) {
        loadSpacesRef.current(token, currentInventoryId);
      }
      if (!dashboardSummaryDenied && loadDashboardSummaryRef.current) {
        loadDashboardSummaryRef.current(token, currentInventoryId);
      }
    }
  }, [lastEvent, showToast, currentInventoryId, dashboardSummaryDenied]);

  const isInventoryAdmin = useMemo(() => {
    if (user?.role === "ADMIN") return true;
    return activeInventory?.role === "ADMIN_CICLO";
  }, [user, activeInventory]);

  const canManageSpaces = useMemo(() => {
    return isInventoryAdmin || activeInventory?.role === "REVISOR";
  }, [isInventoryAdmin, activeInventory?.role]);

  const visibleTabs = useMemo(() => {
    if (isInventoryAdmin) return DASHBOARD_TABS;
    const inventoryRole = activeInventory?.role;
    if (inventoryRole === "REVISOR") {
      return DASHBOARD_TABS.filter(
        (tab) => tab.id === "espacos" || tab.id === "criar-grupos",
      );
    }
    // CONFERENTE e VISUALIZADOR veem apenas a aba de espaços
    return DASHBOARD_TABS.filter((tab) => tab.id === "espacos");
  }, [isInventoryAdmin, activeInventory?.role]);

  const filteredGroupedItems = useMemo(() => {
    const term = itemSearch.trim().toLowerCase();
    if (!term) return groupedItems;
    const result = {};
    for (const [descricao, items] of Object.entries(groupedItems)) {
      const matchedItems = items.filter(
        (item) =>
          item.patrimonio?.toLowerCase().includes(term) ||
          descricao.toLowerCase().includes(term) ||
          item.space?.name?.toLowerCase().includes(term),
      );
      if (matchedItems.length > 0) result[descricao] = matchedItems;
    }
    return result;
  }, [groupedItems, itemSearch]);

  const getItemOrderPriority = (item) => {
    if (item?.meta?.isRelocated) return 0;
    if (item?.statusEncontrado === "SIM") return 2;
    return 1;
  };

  const compareItemsByPriority = (a, b) => {
    const priorityDiff = getItemOrderPriority(a) - getItemOrderPriority(b);
    if (priorityDiff !== 0) return priorityDiff;

    return (a?.patrimonio || "").localeCompare(b?.patrimonio || "", "pt-BR", {
      numeric: true,
      sensitivity: "base",
    });
  };

  const hasAuditAccess = useMemo(() => {
    return user?.role === "ADMIN" || activeInventory?.role === "ADMIN_CICLO";
  }, [user, activeInventory]);

  const sortedSpaces = useMemo(() => {
    return [...spaces].sort((a, b) => {
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
  }, [spaces]);

  const fmtDate = (value) =>
    value ? new Date(value).toLocaleDateString("pt-BR") : "--/--/--";

  const fmtDateTime = (value) =>
    value ? new Date(value).toLocaleString("pt-BR") : "--";

  const fmtBytes = (bytes) => {
    if (!bytes) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const loadBackupInventories = async (activeId) => {
    const token = localStorage.getItem("token");
    if (!token) return;
    try {
      const { data } = await axios.get(`${API}/inventories/my`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const eligible = (data || []).filter((inv) => inv.role === "ADMIN_CICLO");
      setBackupInventories(eligible);
      // Default to active inventory if eligible, otherwise first in list
      const preferred = eligible.find((inv) => inv.id === activeId) || eligible[0];
      if (preferred) setBackupSelectedInventoryId((prev) => prev || preferred.id);
    } catch {
      // silently fail
    }
  };

  const loadBackupData = async (inventoryId) => {
    const token = localStorage.getItem("token");
    const id = inventoryId || backupSelectedInventoryId || activeInventory?.id;
    if (!token || !id) return;
    setBackupListLoading(true);
    try {
      const [listRes, schedRes, lockRes] = await Promise.all([
        axios.get(`${API}/backups`, { params: { inventoryId: id }, headers: { Authorization: `Bearer ${token}` } }),
        axios.get(`${API}/backups/schedule`, { params: { inventoryId: id }, headers: { Authorization: `Bearer ${token}` } }),
        axios.get(`${API}/backups/lock-status`, { params: { inventoryId: id }, headers: { Authorization: `Bearer ${token}` } }),
      ]);
      setBackupList(listRes.data);
      setBackupSchedule(schedRes.data);
      setBackupLockStatus(lockRes.data);
      if (schedRes.data) setScheduleIntervalInput(String(schedRes.data.intervalHours));
    } catch {
      // silently fail — not critical
    } finally {
      setBackupListLoading(false);
    }
  };

  const handleCreateBackup = async () => {
    const token = localStorage.getItem("token");
    const inventoryId = backupSelectedInventoryId;
    if (!token || !inventoryId) return;
    setBackupLoading(true);
    try {
      const { data } = await axios.post(
        `${API}/backups`,
        { label: backupLabelInput.trim() || undefined, inventoryId },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      setBackupList((prev) => [data, ...prev]);
      setBackupLabelInput("");
      showToast({ type: "success", title: "Backup criado", message: "Arquivo SQL gerado com sucesso." });
    } catch (err) {
      showToast({ type: "error", title: "Erro ao criar backup", message: err.response?.data?.error || "Tente novamente." });
    } finally {
      setBackupLoading(false);
    }
  };

  const handleSaveSchedule = async () => {
    const token = localStorage.getItem("token");
    const inventoryId = backupSelectedInventoryId;
    const hours = parseInt(scheduleIntervalInput, 10);
    if (!hours || hours < 1) {
      showToast({ type: "error", title: "Intervalo inválido", message: "Digite ao menos 1 hora." });
      return;
    }
    try {
      const { data } = await axios.post(
        `${API}/backups/schedule`,
        { intervalHours: hours, inventoryId },
        { headers: { Authorization: `Bearer ${token}` } },
      );
      setBackupSchedule(data);
      showToast({ type: "success", title: "Agendamento salvo", message: `Backup automático a cada ${hours}h configurado.` });
    } catch (err) {
      showToast({ type: "error", title: "Erro", message: err.response?.data?.error || "Erro ao salvar agendamento." });
    }
  };

  const handleDeleteSchedule = async () => {
    const token = localStorage.getItem("token");
    const inventoryId = backupSelectedInventoryId;
    try {
      await axios.delete(`${API}/backups/schedule`, { params: { inventoryId }, headers: { Authorization: `Bearer ${token}` } });
      setBackupSchedule(null);
      setScheduleIntervalInput("");
      showToast({ type: "success", title: "Agendamento removido", message: "Backup automático desativado." });
    } catch {
      showToast({ type: "error", title: "Erro", message: "Não foi possível remover o agendamento." });
    }
  };

  const handleDownloadBackup = (record) => {
    const token = localStorage.getItem("token");
    const inventoryId = backupSelectedInventoryId;
    const url = `${API}/backups/${record.id}/download?inventoryId=${inventoryId}`;
    const a = document.createElement("a");
    a.href = url;
    a.setAttribute("download", record.fileName);
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((blob) => {
        const objUrl = URL.createObjectURL(blob);
        a.href = objUrl;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(objUrl);
      })
      .catch(() => showToast({ type: "error", title: "Erro", message: "Não foi possível baixar o backup." }));
  };

  const handleRestoreBackup = async (id) => {
    const token = localStorage.getItem("token");
    const inventoryId = backupSelectedInventoryId;
    try {
      await axios.post(`${API}/backups/${id}/restore`, { inventoryId }, { headers: { Authorization: `Bearer ${token}` } });
      showToast({ type: "success", title: "Restauração concluída", message: "Backup de segurança criado e inventário restaurado com sucesso." });
      await loadBackupData();
    } catch (err) {
      showToast({ type: "error", title: "Erro na restauração", message: err.response?.data?.error || "Falha ao restaurar." });
    } finally {
      setBackupConfirmAction(null);
      setBackupRestoreId(null);
    }
  };

  const handleDeleteBackup = async (id) => {
    const token = localStorage.getItem("token");
    const inventoryId = backupSelectedInventoryId;
    try {
      await axios.delete(`${API}/backups/${id}`, { params: { inventoryId }, headers: { Authorization: `Bearer ${token}` } });
      setBackupList((prev) => prev.filter((r) => r.id !== id));
      showToast({ type: "success", title: "Backup removido", message: "Arquivo excluído com sucesso." });
    } catch {
      showToast({ type: "error", title: "Erro", message: "Não foi possível excluir o backup." });
    } finally {
      setBackupConfirmAction(null);
      setBackupDeleteId(null);
    }
  };

  const abbreviateName = (name) => {
    if (!name) return "usuário não identificado";
    const parts = name.trim().split(/\s+/);
    if (parts.length <= 1) return name;
    return parts[0] + " " + parts.slice(1).map((p) => p[0].toUpperCase() + ".").join(" ");
  };

  const getSpacePhaseBadges = (space) => {
    const badges = [];

    if (space.startedAt || space.executionStatus === "INICIADO" || space.executionStatus === "FINALIZADO") {
      const date = space.startedAt ? new Date(space.startedAt).toLocaleDateString("pt-BR") : "--/--/--";
      badges.push({ label: `🟠 Iniciado em ${date} por ${abbreviateName(space.startedBy)}`, className: "bg-amber-100 text-amber-800" });
    }

    if (space.isFinalized || space.executionStatus === "FINALIZADO") {
      badges.push({ label: `🟢 Finalizado em ${fmtDate(space.finalizedAt)} por ${abbreviateName(space.finalizedBy)}`, className: "bg-emerald-100 text-emerald-800" });
    }

    if (space.isVerified && space.confirmedBy) {
      badges.push({ label: `🟣 Confirmado em ${fmtDate(space.confirmedAt)} por ${abbreviateName(space.confirmedBy)}`, className: "bg-purple-100 text-purple-800" });
    }

    if (badges.length === 0) {
      badges.push({ label: "🔴 Não iniciado", className: "bg-rose-100 text-rose-800" });
    }

    return badges;
  };

  const activeTabMeta = useMemo(
    () => visibleTabs.find((tab) => tab.id === activeTab) || visibleTabs[0],
    [activeTab, visibleTabs],
  );

  const syncActiveInventoryFromStorage = () => {
    const inventoryData = localStorage.getItem("activeInventory");
    const inventoryId = localStorage.getItem("activeInventoryId");

    if (!inventoryId) {
      setActiveInventory(null);
      return null;
    }

    const parsedInventory = inventoryData ? JSON.parse(inventoryData) : null;
    const normalizedInventory = {
      ...(parsedInventory || {}),
      id: parsedInventory?.id || inventoryId,
    };

    setActiveInventory((prev) => {
      if (
        prev?.id === normalizedInventory.id &&
        prev?.name === normalizedInventory.name &&
        prev?.role === normalizedInventory.role &&
        prev?.statusOperacao === normalizedInventory.statusOperacao
      ) {
        return prev;
      }
      return normalizedInventory;
    });

    return normalizedInventory;
  };

  useEffect(() => {
    const tabIsVisible = visibleTabs.some((tab) => tab.id === activeTab);
    if (!tabIsVisible) {
      setActiveTab("espacos");
    }

    const token = localStorage.getItem("token");
    if (token) {
      if (activeTab === "criar-grupos") {
        loadAllItems(token);
        loadItemGroups(token);
      }

      if (activeTab === "nao-localizados") {
        loadUnfoundItems(token);
      }

      if (activeTab === "estrategico") {
        setDashboardRecentEvents([]);
        // fire-and-forget load of the summary when switching to the tab
        loadDashboardSummary(token, localStorage.getItem("activeInventoryId"));
      }

      if (activeTab === "backups") {
        loadBackupInventories(activeInventory?.id);
      }
    }
  }, [activeTab, visibleTabs, unfoundSubTab]);

  // Reload backup data whenever the selected inventory changes
  useEffect(() => {
    if (activeTab === "backups" && backupSelectedInventoryId) {
      loadBackupData(backupSelectedInventoryId);
    }
  }, [backupSelectedInventoryId]);

  useEffect(() => {
    const token = localStorage.getItem("token");
    const userData = localStorage.getItem("user");

    if (!token) {
      router.push("/login");
      return;
    }

    const normalizedInventory = syncActiveInventoryFromStorage();
    if (!normalizedInventory?.id) {
      router.push("/inventories");
      return;
    }

    const parsedUser = userData ? JSON.parse(userData) : null;
    setUser(parsedUser);

    // Refresh the inventory role from the API — localStorage can be stale
    // if an admin changed the user's role since the last session.
    const refreshInventoryRole = async () => {
      try {
        const { data } = await axios.get(`${API}/auth/inventory-role`, {
          params: { inventoryId: normalizedInventory.id },
          headers: { Authorization: `Bearer ${token}` },
        });
        if (data.inventoryRole) {
          const updated = { ...normalizedInventory, role: data.inventoryRole };
          localStorage.setItem("activeInventory", JSON.stringify(updated));
          setActiveInventory(updated);
        }
      } catch {
        // Non-critical — stale cached role will be used as fallback
      }
    };
    refreshInventoryRole();

    const handleStorage = () => {
      syncActiveInventoryFromStorage();
    };

    window.addEventListener("storage", handleStorage);
    window.addEventListener("focus", handleStorage);

    return () => {
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener("focus", handleStorage);
    };
  }, [router]);

  useEffect(() => {
    const token = localStorage.getItem("token");
    const inventoryId = activeInventory?.id;

    if (!token || !inventoryId) {
      return;
    }

    setLoading(true);

    const loadForInventory = async () => {
      setDashboardRecentEvents([]);
      await loadSpaces(token, inventoryId);
      await loadDashboardSummary(token, inventoryId);

      if (user?.role === "ADMIN" || activeInventory?.role === "ADMIN_CICLO") {
        await Promise.all([
          loadInventoryDetails(token, inventoryId),
          loadStatusHistory(token, inventoryId),
          loadPermissionsMembers(token, inventoryId),
        ]);
      }
    };

    loadForInventory();
  }, [activeInventory?.id, activeInventory?.role, user?.role]);

  const loadSpaces = async (token, inventoryId) => {
    try {
      const { data } = await axios.get(`${API}/spaces/active`, {
        params: { inventoryId, includeFinalized: "true" },
        headers: { Authorization: `Bearer ${token}` },
      });
      setSpaces(data);
    } catch (err) {
      console.error("Erro ao carregar espaços:", err);
      showToast({
        type: "error",
        title: "Falha ao carregar espaços",
        message:
          err.response?.data?.error ||
          "Não foi possível carregar a lista de espaços.",
      });
      if (err.response?.status === 403) {
        localStorage.removeItem("activeInventoryId");
        localStorage.removeItem("activeInventory");
        router.push("/inventories");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("activeInventoryId");
    localStorage.removeItem("activeInventory");
    router.push("/login");
  };

  const loadAllItems = async (token) => {
    try {
      setLoadingItems(true);
      const inventoryId = localStorage.getItem("activeInventoryId");
      const { data } = await axios.get(`${API}/items/all`, {
        params: { inventoryId },
        headers: { Authorization: `Bearer ${token}` },
      });

      // Agrupar itens por descricao e patrimonio range
      const grouped = {};
      const items = Array.isArray(data) ? data : [];

      items.forEach((item) => {
        const desc = item.descricao || "Sem descrição";
        if (!grouped[desc]) {
          grouped[desc] = [];
        }
        grouped[desc].push(item);
      });

      // Ordenar itens dentro de cada grupo: movidos no topo e encontrados no final.
      Object.keys(grouped).forEach((desc) => {
        grouped[desc].sort(compareItemsByPriority);
      });

      setAllItems(items);
      setGroupedItems(grouped);
      setSelectedItems(new Set());
    } catch (err) {
      showToast({
        type: "error",
        title: "Falha ao carregar itens",
        message:
          err.response?.data?.error ||
          "Não foi possível carregar os itens do inventário.",
      });
    } finally {
      setLoadingItems(false);
    }
  };

  const loadItemGroups = async (token) => {
    try {
      setLoadingGroups(true);
      const inventoryId = localStorage.getItem("activeInventoryId");
      const { data } = await axios.get(`${API}/item-groups/all`, {
        params: { inventoryId },
        headers: { Authorization: `Bearer ${token}` },
      });
      const groups = Array.isArray(data) ? data : [];
      setItemGroups(
        groups.map((group) => ({
          ...group,
          items: Array.isArray(group.items)
            ? [...group.items].sort(compareItemsByPriority)
            : [],
        })),
      );
    } catch (err) {
      showToast({
        type: "error",
        title: "Falha ao carregar grupos",
        message:
          err.response?.data?.error || "Não foi possível carregar os grupos.",
      });
    } finally {
      setLoadingGroups(false);
    }
  };

  const loadUnfoundItems = async (token) => {
    try {
      setUnfoundLoading(true);
      const inventoryId = localStorage.getItem("activeInventoryId");
      const { data } = await axios.get(`${API}/audit/unfound-items`, {
        params: { inventoryId, limit: 1000 },
        headers: { Authorization: `Bearer ${token}` },
      });

      const items = Array.isArray(data.items) ? data.items : [];

      // Filtrar apenas itens não localizados (excluindo movidos pendentes)
      const unfoundOnly = items.filter(
        (item) => item.statusAtual !== "MOVIDO_PENDENTE_ACEITE",
      );

      // Enriquecer itens com informação de quem marcou como NAO_LOCALIZADO
      const enrichedItems = unfoundOnly.map((item) => {
        const naoLocalizadoHistory = item.historicoLocalizacoes?.find(
          (h) => h.action === "NAO_LOCALIZADO",
        );
        return {
          ...item,
          marcadoPorQuem:
            naoLocalizadoHistory?.createdBy || item.conferente || "-",
          marcadoEm:
            naoLocalizadoHistory?.createdAt || item.dataUltimaAlteracao,
          marcadoOnde:
            naoLocalizadoHistory?.fromSpaceName || item.ultimoLocalConhecido || null,
        };
      });

      enrichedItems.sort((a, b) => {
        const aNum = parseInt(a.patrimonio) || 0;
        const bNum = parseInt(b.patrimonio) || 0;
        return aNum - bNum;
      });

      setUnfoundItems(enrichedItems);
    } catch (err) {
      showToast({
        type: "error",
        title: "Falha ao carregar não localizados",
        message:
          err.response?.data?.error ||
          "Não foi possível carregar itens não localizados.",
      });
    } finally {
      setUnfoundLoading(false);
    }
  };

  const loadUnfoundItemHistory = async (token) => {
    try {
      setUnfoundHistoryLoading(true);
      const inventoryId = localStorage.getItem("activeInventoryId");
      const { data } = await axios.get(`${API}/audit/unfound-items`, {
        params: {
          inventoryId,
          limit: 100,
        },
        headers: { Authorization: `Bearer ${token}` },
      });

      // Format the unfound items to a history-like view
      const historyItems = (data.items || []).map((item) => {
        const latestMove = item.historicoLocalizacoes?.[0];
        return {
          id: item.id,
          itemPatrimonio: item.patrimonio,
          itemDescricao: item.descricao,
          userName: item.conferente || item.ultimoResponsavel,
          timestamp: item.dataUltimaAlteracao,
          action: latestMove?.action || "NAO_LOCALIZADO",
        };
      });

      setUnfoundItemHistory(historyItems);
    } catch (err) {
      // Falha silenciosa se o endpoint não existir
      console.warn("Error loading unfound item history:", err);
      setUnfoundItemHistory([]);
    } finally {
      setUnfoundHistoryLoading(false);
    }
  };

  const handleUnfoundItemAction = async (
    item,
    action,
    condicao = "BOM",
    targetSpaceId,
  ) => {
    if (!item || !action) return;

    try {
      setSavingUnfoundAction(true);
      const token = localStorage.getItem("token");
      const inventoryId = localStorage.getItem("activeInventoryId");

      if (action === "mover") {
        if (!targetSpaceId) {
          showToast({ type: "error", title: "Sala obrigatória", message: "Selecione a sala de destino." });
          return;
        }
        await axios.post(
          `${API}/items/relocate`,
          { itemId: item.id, targetSpaceId, inventoryId },
          { headers: { Authorization: `Bearer ${token}` } },
        );
        // Record visual condition via check (marks item as PENDENTE in target space)
        await axios.post(
          `${API}/items/${item.id}/check`,
          { itemId: item.id, condicao, inventoryId },
          { headers: { Authorization: `Bearer ${token}` }, params: { inventoryId } },
        );
        showToast({
          type: "success",
          title: "Item movido",
          message: `Patrimônio #${item.patrimonio} realocado com sucesso.`,
        });
        setUnfoundActionModal(null);
        setUnfoundMoveTargetSpaceId("");
        await loadUnfoundItems(token);
      }
    } catch (err) {
      showToast({
        type: "error",
        title: "Falha ao mover item",
        message: err.response?.data?.error || "Não foi possível mover o item.",
      });
    } finally {
      setSavingUnfoundAction(false);
    }
  };

  loadSpacesRef.current = async (token, inventoryId) => {
    await loadSpaces(token, inventoryId);

    if (activeTab === "criar-grupos") {
      await Promise.all([loadAllItems(token), loadItemGroups(token)]);
    }
  };

  loadDashboardSummaryRef.current = async (token, inventoryId) => {
    await loadDashboardSummary(token, inventoryId);
  };

  const handleToggleItemSelection = (itemId) => {
    const newSelected = new Set(selectedItems);
    if (newSelected.has(itemId)) {
      newSelected.delete(itemId);
    } else {
      newSelected.add(itemId);
    }
    setSelectedItems(newSelected);
  };

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) {
      showToast({
        type: "error",
        title: "Nome obrigatório",
        message: "Digite um nome para o grupo.",
      });
      return;
    }

    if (selectedItems.size === 0) {
      showToast({
        type: "error",
        title: "Selecione itens",
        message: "Selecione pelo menos um item para criar o grupo.",
      });
      return;
    }

    try {
      setCreatingGroup(true);
      const token = localStorage.getItem("token");
      const inventoryId = localStorage.getItem("activeInventoryId");

      const itemIds = Array.from(selectedItems);

      await axios.post(
        `${API}/item-groups`,
        {
          name: newGroupName,
          description: newGroupDescription,
          itemIds,
          inventoryId,
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      showToast({
        type: "success",
        title: "Grupo criado com sucesso",
        message: `${selectedItems.size} item(ns) adicionados ao grupo "${newGroupName}".`,
      });

      setNewGroupName("");
      setNewGroupDescription("");
      setGroupCreationModal(false);
      setSelectedItems(new Set());
      await Promise.all([loadAllItems(token), loadItemGroups(token)]);
      setGroupSubTab("grupos-criados");
    } catch (err) {
      showToast({
        type: "error",
        title: "Falha ao criar grupo",
        message: err.response?.data?.error || "Não foi possível criar o grupo.",
      });
    } finally {
      setCreatingGroup(false);
    }
  };

  const loadInventoryDetails = async (token, inventoryId) => {
    try {
      const { data } = await axios.get(`${API}/inventories/${inventoryId}`, {
        headers: {
          Authorization: `Bearer ${token}`,
          "x-inventory-id": inventoryId,
        },
      });

      setInventoryDetails(data);
      setInventoryNameDraft(data?.name || "");
      setInventoryStatusDraft(data?.statusOperacao || "NAO_INICIADO");
    } catch (error) {
      showToast({
        type: "error",
        title: "Falha ao carregar dados",
        message:
          error.response?.data?.error ||
          "Não foi possível carregar os dados administrativos do inventário.",
      });
    }
  };

  const loadDashboardSummary = async (token, inventoryId) => {
    if (!token || !inventoryId) return;

    setDashboardSummaryLoading(true);
    setDashboardSummaryError("");
    setDashboardSummaryDenied(false);

    try {
      const { data } = await axios.get(`${API}/dashboard/summary`, {
        params: { inventoryId },
        headers: { Authorization: `Bearer ${token}` },
      });

      setDashboardSummary(data || null);
    } catch (error) {
      if (error.response?.status === 403) {
        setDashboardSummary(null);
        setDashboardSummaryDenied(true);
        return;
      }

      setDashboardSummary(null);
      setDashboardSummaryError(
        error.response?.data?.error ||
          "Não foi possível carregar o painel estratégico.",
      );
    } finally {
      setDashboardSummaryLoading(false);
    }
  };

  const loadStatusHistory = async (token, inventoryId) => {
    setLoadingStatusHistory(true);
    try {
      const { data } = await axios.get(
        `${API}/inventories/${inventoryId}/status-history`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "x-inventory-id": inventoryId,
          },
        },
      );

      setStatusHistory(data || []);
    } catch (error) {
      showToast({
        type: "error",
        title: "Falha ao carregar histórico",
        message:
          error.response?.data?.error ||
          "Não foi possível carregar o histórico de status.",
      });
    } finally {
      setLoadingStatusHistory(false);
    }
  };

  const handleSaveInventorySettings = async () => {
    const token = localStorage.getItem("token");
    const inventoryId = localStorage.getItem("activeInventoryId");
    if (!inventoryId) return;

    setSavingInventorySettings(true);
    try {
      const { data } = await axios.patch(
        `${API}/inventories/${inventoryId}`,
        {
          name: inventoryNameDraft?.trim(),
          statusOperacao: inventoryStatusDraft,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "x-inventory-id": inventoryId,
          },
        },
      );

      const updatedInventory = data?.inventory;
      if (updatedInventory) {
        setInventoryDetails((prev) => ({
          ...(prev || {}),
          ...updatedInventory,
        }));

        const activeInventoryRaw = localStorage.getItem("activeInventory");
        const parsed = activeInventoryRaw ? JSON.parse(activeInventoryRaw) : {};
        const updatedActive = {
          ...parsed,
          id: updatedInventory.id,
          name: updatedInventory.name,
          statusOperacao: updatedInventory.statusOperacao,
        };

        localStorage.setItem("activeInventory", JSON.stringify(updatedActive));
        setActiveInventory(updatedActive);
      }

      await loadStatusHistory(token, inventoryId);

      showToast({
        type: "success",
        title: "Inventário atualizado",
        message: "Nome e status operacional atualizados com sucesso.",
      });
    } catch (error) {
      showToast({
        type: "error",
        title: "Falha ao atualizar inventário",
        message:
          error.response?.data?.error ||
          "Não foi possível atualizar nome/status do inventário.",
      });
    } finally {
      setSavingInventorySettings(false);
    }
  };

  const loadPermissionsMembers = async (token, inventoryId) => {
    setPermissionsLoading(true);
    try {
      const { data } = await axios.get(
        `${API}/inventories/${inventoryId}/permissions`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "x-inventory-id": inventoryId,
          },
        },
      );
      setMembers(data || []);
    } catch (error) {
      showToast({
        type: "error",
        title: "Falha ao carregar permissões",
        message:
          error.response?.data?.error ||
          "Não foi possível carregar os membros do inventário.",
      });
    } finally {
      setPermissionsLoading(false);
    }
  };

  const handleSearchUsers = async () => {
    const inventoryId = localStorage.getItem("activeInventoryId");
    if (!inventoryId) return;

    if (!searchQuery || searchQuery.trim().length < 2) {
      showToast({
        type: "warning",
        title: "Busca curta",
        message: "Digite pelo menos 2 caracteres para buscar usuários.",
      });
      return;
    }

    const token = localStorage.getItem("token");
    setSearchingUsers(true);
    try {
      const { data } = await axios.get(
        `${API}/inventories/${inventoryId}/permissions/search`,
        {
          params: { q: searchQuery.trim() },
          headers: {
            Authorization: `Bearer ${token}`,
            "x-inventory-id": inventoryId,
          },
        },
      );
      setSearchResults(data?.users || []);
    } catch (error) {
      showToast({
        type: "error",
        title: "Falha na busca",
        message:
          error.response?.data?.error || "Não foi possível buscar usuários.",
      });
    } finally {
      setSearchingUsers(false);
    }
  };

  const handleAddPermission = async (result) => {
    const inventoryId = localStorage.getItem("activeInventoryId");
    if (!inventoryId) return;

    const token = localStorage.getItem("token");
    try {
      await axios.post(
        `${API}/inventories/${inventoryId}/permissions`,
        {
          samAccountName: result.samAccountName,
          role: newMemberRole,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "x-inventory-id": inventoryId,
          },
        },
      );

      showToast({
        type: "success",
        title: "Permissão atualizada",
        message: `Usuário ${result.samAccountName} vinculado ao inventário.`,
      });

      await loadPermissionsMembers(token, inventoryId);
    } catch (error) {
      showToast({
        type: "error",
        title: "Falha ao adicionar permissão",
        message:
          error.response?.data?.error ||
          "Não foi possível vincular o usuário ao inventário.",
      });
    }
  };

  const handleUpdatePermission = async (member, role) => {
    const inventoryId = localStorage.getItem("activeInventoryId");
    if (!inventoryId) return;

    const token = localStorage.getItem("token");
    try {
      await axios.patch(
        `${API}/inventories/${inventoryId}/permissions/${member.userId}`,
        { role },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "x-inventory-id": inventoryId,
          },
        },
      );

      setMembers((prev) =>
        prev.map((item) =>
          item.userId === member.userId
            ? { ...item, inventoryRole: role }
            : item,
        ),
      );
    } catch (error) {
      showToast({
        type: "error",
        title: "Falha ao alterar perfil",
        message:
          error.response?.data?.error || "Não foi possível alterar o perfil.",
      });
    }
  };

  const handleRemovePermission = async (member) => {
    const inventoryId = localStorage.getItem("activeInventoryId");
    if (!inventoryId) return;

    const token = localStorage.getItem("token");
    try {
      await axios.delete(
        `${API}/inventories/${inventoryId}/permissions/${member.userId}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "x-inventory-id": inventoryId,
          },
        },
      );

      setMembers((prev) =>
        prev.filter((item) => item.userId !== member.userId),
      );
      showToast({
        type: "success",
        title: "Permissão removida",
        message: `Acesso removido para ${member.samAccountName}.`,
      });
    } catch (error) {
      showToast({
        type: "error",
        title: "Falha ao remover permissão",
        message:
          error.response?.data?.error ||
          "Não foi possível remover a permissão.",
      });
    }
  };

  const openCreateSpaceModal = () => {
    setSpaceModal({ mode: "create" });
    setSpaceForm({ name: "", responsible: "", sector: "", unit: "" });
  };

  const openEditSpaceModal = (space) => {
    setSpaceModal({ mode: "edit", space });
    setSpaceForm({
      name: space.name || "",
      responsible: space.responsible || "",
      sector: space.sector || "",
      unit: space.unit || "",
    });
  };

  const closeSpaceModal = () => {
    setSpaceModal(null);
  };

  const submitSpaceModal = async (event) => {
    event.preventDefault();

    const token = localStorage.getItem("token");
    const inventoryId = localStorage.getItem("activeInventoryId");
    try {
      if (spaceModal?.mode === "create") {
        await axios.post(
          `${API}/spaces/admin/spaces`,
          {
            inventoryId,
            name: spaceForm.name,
            responsible: spaceForm.responsible,
            sector: spaceForm.sector,
            unit: spaceForm.unit,
          },
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        showToast({
          type: "success",
          title: "Espaço criado",
          message: "O novo espaço foi adicionado com sucesso.",
        });
      } else if (spaceModal?.mode === "edit" && spaceModal.space) {
        await axios.put(
          `${API}/spaces/admin/spaces/${spaceModal.space.id}`,
          {
            inventoryId,
            name: spaceForm.name,
          },
          {
            headers: { Authorization: `Bearer ${token}` },
          },
        );
        showToast({
          type: "success",
          title: "Espaço atualizado",
          message: "O nome do espaço foi alterado com sucesso.",
        });
      }

      closeSpaceModal();
      await loadSpaces(token, inventoryId);
    } catch (error) {
      showToast({
        type: "error",
        title:
          spaceModal?.mode === "create"
            ? "Falha ao criar"
            : "Falha ao atualizar",
        message:
          error.response?.data?.error ||
          "Não foi possível salvar as alterações do espaço.",
      });
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600">Carregando espaços...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      {/* Header */}
      <header className="bg-white shadow-lg border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-4">
              <div>
                <h1 className="text-3xl font-bold text-gray-900">Inventário</h1>
                <p className="text-sm text-gray-500 mt-1">
                  Sistema de Conferência de Patrimônio
                </p>
                {activeInventory?.name ? (
                  <div className="mt-2 inline-flex flex-col gap-1 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2">
                    <p className="text-xs font-semibold text-sky-800">
                      Inventário ativo: {activeInventory.name}
                    </p>
                    {activeInventory?.id ? (
                      <p className="text-[11px] text-slate-500">
                        ID: {activeInventory.id}
                      </p>
                    ) : null}
                    <span
                      className={`inline-flex w-fit items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${
                        STATUS_BADGE_STYLES[activeInventory?.statusOperacao] ||
                        "bg-slate-100 text-slate-700 ring-slate-200"
                      }`}
                    >
                      Status:{" "}
                      {STATUS_LABELS[activeInventory?.statusOperacao] ||
                        activeInventory?.statusOperacao ||
                        "Não informado"}
                    </span>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="flex items-center gap-4 self-start lg:self-auto">
              <div className="text-right">
                <p className="text-sm font-semibold text-gray-800">
                  {user?.samAccountName} -{" "}
                  {user?.fullName?.split(" ")[0] || user?.fullName}
                </p>
                <p className="text-xs text-gray-500">
                  {activeInventory?.role || user?.role}
                </p>
              </div>
              <button
                onClick={() => router.push("/inventories")}
                className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Trocar inventário
              </button>
              <button
                onClick={handleLogout}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition text-sm font-medium"
              >
                Sair
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Strategic panel moved to its own tab (Acompanhamento) */}

        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <div className="hidden sm:block">
            <nav className="flex items-center gap-2 overflow-x-auto">
              <div className="flex min-w-max gap-2">
                {visibleTabs.map((tab) => {
                  const isActive = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                        isActive
                          ? "bg-slate-900 text-white"
                          : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}
              </div>
              {hasAuditAccess ? (
                <button
                  type="button"
                  onClick={() => router.push("/admin/unfound-items")}
                  className="ml-auto rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-700 transition hover:bg-sky-100"
                >
                  Auditoria
                </button>
              ) : null}
            </nav>
          </div>

          <div className="sm:hidden">
            <label
              htmlFor="dashboard-main-tab-select"
              className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500"
            >
              Navegação
            </label>
            <select
              id="dashboard-main-tab-select"
              value={activeTab}
              onChange={(event) => setActiveTab(event.target.value)}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
            >
              {visibleTabs.map((tab) => (
                <option key={tab.id} value={tab.id}>
                  {tab.label}
                </option>
              ))}
            </select>
            {hasAuditAccess ? (
              <button
                type="button"
                onClick={() => router.push("/admin/unfound-items")}
                className="mt-3 w-full rounded-lg border border-sky-200 bg-sky-50 px-4 py-2 text-sm font-medium text-sky-700 transition hover:bg-sky-100"
              >
                Auditoria
              </button>
            ) : null}
          </div>
        </div>

        {activeTab === "espacos" ? (
          <div className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="w-full lg:max-w-2xl">
              <SpaceSearchBar placeholder="Buscar espaços por nome..." />
            </div>
            {canManageSpaces ? (
              <div className="lg:flex lg:justify-end">
                <button
                  type="button"
                  onClick={openCreateSpaceModal}
                  className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  📝 Novo espaço
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {activeTab === "estrategico" ? (
          <StrategicDashboardPanel
            visible={
              !dashboardSummaryDenied &&
              (dashboardSummaryLoading ||
                Boolean(dashboardSummary) ||
                Boolean(dashboardSummaryError))
            }
            loading={dashboardSummaryLoading}
            summary={dashboardSummary}
            error={dashboardSummaryError}
            recentEvents={dashboardRecentEvents}
          />
        ) : null}

        {activeTab === "espacos" && sortedSpaces.length === 0 ? (
          <div className="bg-white rounded-xl shadow-md p-12 text-center">
            <div className="text-6xl mb-4">📦</div>
            <h3 className="text-xl font-semibold text-gray-800 mb-2">
              Nenhum espaço disponível
            </h3>
            <p className="text-gray-500">
              Não há espaços ativos para conferência no momento.
            </p>
          </div>
        ) : activeTab === "espacos" ? (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {sortedSpaces.map((space) => {
              const phaseBadges = getSpacePhaseBadges(space);
              return (
                <div
                  key={space.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => router.push(`/room/${space.id}`)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      router.push(`/room/${space.id}`);
                    }
                  }}
                  className="group relative block cursor-pointer overflow-hidden rounded-xl border border-gray-100 bg-white shadow-md transition-all duration-300 hover:shadow-xl"
                >
                  {canManageSpaces ? (
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        openEditSpaceModal(space);
                      }}
                      className="absolute left-3 top-3 z-10 rounded-full bg-white/95 px-3 py-2 text-sm font-semibold text-slate-700 opacity-0 shadow-md transition hover:bg-slate-50 group-hover:opacity-100"
                      aria-label={`Editar espaço ${space.name}`}
                      title="Editar nome"
                    >
                      ✏️
                    </button>
                  ) : null}
                  <div className="p-6">
                    <div className="flex justify-between items-start mb-4">
                      <h3 className="font-bold text-lg text-gray-900 group-hover:text-blue-600 transition line-clamp-2">
                        {space.name}
                      </h3>
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-blue-100 text-blue-800">
                        {space.itemCount}{" "}
                        {space.itemCount === 1 ? "item" : "itens"}
                      </span>
                    </div>

                    <div className="mb-4 flex flex-col gap-1">
                      {phaseBadges.map((badge, i) => (
                        <span
                          key={i}
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${badge.className}`}
                        >
                          {badge.label}
                        </span>
                      ))}
                    </div>

                    <div className="space-y-2 mb-6">
                      <div className="flex items-center text-sm text-gray-600">
                        <span className="font-medium mr-2">👤</span>
                        <span className="truncate">
                          {space.responsible || "Não informado"}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-4 border-t border-gray-100">
                      <span className="text-sm text-gray-500">
                        Clique para conferir
                      </span>
                      <span className="inline-flex items-center text-blue-600 font-medium group-hover:translate-x-1 transition-transform">
                        {space.isFinalized ? "Visualizar" : "Iniciar"}
                        <svg
                          className="w-4 h-4 ml-1"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M9 5l7 7-7 7"
                          />
                        </svg>
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}

        {activeTab === "criar-grupos" ? (
          <section className="mt-10 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            {/* Sub-abas */}
            <div className="mb-5 flex gap-2 border-b border-slate-200 pb-3">
              <button
                type="button"
                onClick={() => setGroupSubTab("itens")}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                  groupSubTab === "itens"
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                Itens
              </button>
              <button
                type="button"
                onClick={() => setGroupSubTab("grupos-criados")}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${
                  groupSubTab === "grupos-criados"
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                Grupos Criados
                {itemGroups.length > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-xs font-semibold ${
                      groupSubTab === "grupos-criados"
                        ? "bg-white/20 text-white"
                        : "bg-slate-300 text-slate-700"
                    }`}
                  >
                    {itemGroups.length}
                  </span>
                )}
              </button>
            </div>

            {/* Sub-aba: Itens */}
            {groupSubTab === "itens" && (
              <div className="rounded-xl border border-slate-200 p-4">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-slate-800">
                      Criar grupo de itens
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      Selecione os itens que deseja agrupar. Itens serão
                      listados agrupados pela descrição e patrimônio.
                    </p>
                  </div>
                  <button
                    onClick={() => {
                      if (selectedItems.size > 0) {
                        const selected = allItems.filter((i) =>
                          selectedItems.has(i.id),
                        );
                        const descs = [
                          ...new Set(
                            selected.map((i) => i.descricao).filter(Boolean),
                          ),
                        ];
                        if (descs.length === 1) setNewGroupName(descs[0]);
                        setGroupCreationModal(true);
                      } else {
                        showToast({
                          type: "error",
                          title: "Nenhum item selecionado",
                          message:
                            "Selecione pelo menos um item para criar um grupo.",
                        });
                      }
                    }}
                    disabled={selectedItems.size === 0 || creatingGroup}
                    className="whitespace-nowrap rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {creatingGroup
                      ? "Criando..."
                      : `Criar Grupo (${selectedItems.size})`}
                  </button>
                </div>

                <input
                  value={itemSearch}
                  onChange={(e) => setItemSearch(e.target.value)}
                  placeholder="Buscar por patrimônio, descrição ou localização..."
                  className="mb-4 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />

                {loadingItems ? (
                  <p className="py-8 text-center text-sm text-slate-600">
                    Carregando itens...
                  </p>
                ) : Object.keys(filteredGroupedItems).length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-600">
                    {itemSearch.trim()
                      ? "Nenhum item encontrado para a busca."
                      : "Nenhum item disponível no inventário."}
                  </p>
                ) : (
                  <div className="space-y-3">
                    {(() => {
                      const allFilteredIds = Object.values(filteredGroupedItems)
                        .flat()
                        .map((i) => i.id);
                      const allSelected =
                        allFilteredIds.length > 0 &&
                        allFilteredIds.every((id) => selectedItems.has(id));
                      const someSelected = allFilteredIds.some((id) =>
                        selectedItems.has(id),
                      );
                      return (
                        <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100">
                          <input
                            type="checkbox"
                            checked={allSelected}
                            ref={(el) => {
                              if (el)
                                el.indeterminate = someSelected && !allSelected;
                            }}
                            onChange={() => {
                              setSelectedItems((prev) => {
                                const next = new Set(prev);
                                if (allSelected) {
                                  allFilteredIds.forEach((id) =>
                                    next.delete(id),
                                  );
                                } else {
                                  allFilteredIds.forEach((id) => next.add(id));
                                }
                                return next;
                              });
                            }}
                          />
                          Selecionar todos ({allFilteredIds.length})
                        </label>
                      );
                    })()}
                    {Object.entries(filteredGroupedItems)
                      .sort((a, b) => b[1].length - a[1].length)
                      .map(([descricao, items]) => {
                        const firstPatrimonio =
                          parseInt(items[0]?.patrimonio) || 0;
                        const lastPatrimonio =
                          parseInt(items[items.length - 1]?.patrimonio) || 0;
                        const isExpanded = expandedGroups[descricao];
                        const groupIds = items.map((i) => i.id);
                        const groupAllSelected = groupIds.every((id) =>
                          selectedItems.has(id),
                        );
                        const groupSomeSelected = groupIds.some((id) =>
                          selectedItems.has(id),
                        );

                        return (
                          <div
                            key={descricao}
                            className="rounded-lg border border-slate-200 bg-slate-50"
                          >
                            <div className="flex items-center px-4 py-3 hover:bg-slate-100">
                              <input
                                type="checkbox"
                                checked={groupAllSelected}
                                ref={(el) => {
                                  if (el)
                                    el.indeterminate =
                                      groupSomeSelected && !groupAllSelected;
                                }}
                                onChange={() => {
                                  setSelectedItems((prev) => {
                                    const next = new Set(prev);
                                    if (groupAllSelected) {
                                      groupIds.forEach((id) => next.delete(id));
                                    } else {
                                      groupIds.forEach((id) => next.add(id));
                                    }
                                    return next;
                                  });
                                }}
                                className="mr-3 shrink-0"
                              />
                              <button
                                onClick={() =>
                                  setExpandedGroups((prev) => ({
                                    ...prev,
                                    [descricao]: !prev[descricao],
                                  }))
                                }
                                className="flex flex-1 items-center justify-between gap-2 text-left"
                              >
                                <div className="flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-semibold text-slate-600">
                                      {isExpanded ? "▼" : "▶"}
                                    </span>
                                    <span className="font-semibold text-slate-900">
                                      {descricao}
                                    </span>
                                  </div>
                                  <p className="mt-1 text-xs text-slate-600">
                                    Patrimônio #{firstPatrimonio} a #
                                    {lastPatrimonio} • {items.length} unidade(s)
                                  </p>
                                </div>
                                <span className="inline-flex items-center gap-2 rounded-full bg-sky-100 px-2.5 py-1 text-xs font-semibold text-sky-700">
                                  {
                                    groupIds.filter((id) =>
                                      selectedItems.has(id),
                                    ).length
                                  }
                                  /{items.length}
                                </span>
                              </button>
                            </div>

                            {isExpanded && (
                              <div className="border-t border-slate-200 bg-white">
                                <div className="max-h-72 space-y-1 overflow-y-auto p-3">
                                  {items.map((item) => {
                                    const isSealed = item.space?.isFinalized;
                                    const isRevisorVerified =
                                      item.space?.isVerifiedByRevisor;
                                    return (
                                      <label
                                        key={item.id}
                                        className={`flex cursor-pointer items-start gap-3 rounded-lg px-3 py-2 ${
                                          isRevisorVerified
                                            ? "bg-purple-50 hover:bg-purple-100"
                                            : isSealed
                                              ? "bg-purple-50/60 hover:bg-purple-100/60"
                                              : "hover:bg-slate-50"
                                        }`}
                                      >
                                        <input
                                          type="checkbox"
                                          checked={selectedItems.has(item.id)}
                                          onChange={() =>
                                            !isSealed &&
                                            handleToggleItemSelection(item.id)
                                          }
                                          disabled={isSealed}
                                          className="mt-1 disabled:opacity-40"
                                        />
                                        <div className="flex-1 text-sm">
                                          <div className="flex items-center gap-2 flex-wrap">
                                            <p
                                              className={`font-medium ${isSealed ? "text-purple-900" : "text-slate-900"}`}
                                            >
                                              #{item.patrimonio}
                                            </p>
                                            {isSealed && (
                                              <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-700">
                                                🔒{" "}
                                                {isRevisorVerified
                                                  ? "Revisado — sala lacrada"
                                                  : "Sala lacrada"}
                                              </span>
                                            )}
                                          </div>
                                          <p
                                            className={`text-xs ${isSealed ? "text-purple-600" : "text-slate-600"}`}
                                          >
                                            {item.space?.name} •{" "}
                                            {item.condicaoVisual}
                                          </p>
                                          {isSealed && (
                                            <p className="mt-0.5 text-xs text-purple-500">
                                              Para mover este item, a sala
                                              precisa ser reaberta pelo
                                              administrador.
                                            </p>
                                          )}
                                        </div>
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            )}

            {/* Sub-aba: Grupos Criados */}
            {groupSubTab === "grupos-criados" && (
              <div className="rounded-xl border border-slate-200 p-4">
                {loadingGroups ? (
                  <p className="py-8 text-center text-sm text-slate-500">
                    Carregando grupos...
                  </p>
                ) : itemGroups.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-500">
                    Nenhum grupo criado ainda.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {itemGroups.map((group) => {
                      const isOpen = expandedCreatedGroups[group.id];
                      const found = group.items.filter(
                        (i) => i.statusEncontrado === "SIM",
                      ).length;
                      return (
                        <div
                          key={group.id}
                          className="rounded-lg border border-slate-200 bg-slate-50"
                        >
                          <button
                            onClick={() =>
                              setExpandedCreatedGroups((prev) => ({
                                ...prev,
                                [group.id]: !prev[group.id],
                              }))
                            }
                            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-slate-100"
                          >
                            <div className="flex-1">
                              <p className="font-semibold text-slate-900">
                                {group.name}
                              </p>
                              {group.description && (
                                <p className="text-xs text-slate-500">
                                  {group.description}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-slate-500">
                                {found}/{group.items.length} encontrado(s)
                              </span>
                              <span
                                className={`h-2 w-2 rounded-full ${
                                  found === group.items.length &&
                                  group.items.length > 0
                                    ? "bg-emerald-500"
                                    : found > 0
                                      ? "bg-amber-400"
                                      : "bg-rose-400"
                                }`}
                              />
                              <span className="text-xs font-semibold text-slate-500">
                                {isOpen ? "▲" : "▼"}
                              </span>
                            </div>
                          </button>

                          {isOpen && (
                            <div className="border-t border-slate-200 bg-white">
                              {group.items.length === 0 ? (
                                <p className="px-4 py-3 text-xs text-slate-500">
                                  Sem itens.
                                </p>
                              ) : (
                                <div className="divide-y divide-slate-100">
                                  {group.items.map((item) => (
                                    <div
                                      key={item.id}
                                      className="flex items-center justify-between gap-3 px-4 py-2.5"
                                    >
                                      <div className="min-w-0">
                                        <p className="text-sm font-medium text-slate-900">
                                          #{item.patrimonio}
                                        </p>
                                        <p className="truncate text-xs text-slate-500">
                                          {item.descricao}
                                        </p>
                                      </div>
                                      <div className="flex shrink-0 flex-col items-end gap-1">
                                        <span className="text-xs text-slate-600">
                                          {item.space?.name ||
                                            "Sem localização"}
                                        </span>
                                        <span
                                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                                            item.statusEncontrado === "SIM"
                                              ? "bg-emerald-100 text-emerald-700"
                                              : item.statusEncontrado === "NAO"
                                                ? "bg-rose-100 text-rose-700"
                                                : "bg-amber-100 text-amber-700"
                                          }`}
                                        >
                                          {item.statusEncontrado === "SIM"
                                            ? "Encontrado"
                                            : item.statusEncontrado === "NAO"
                                              ? "Não localizado"
                                              : "Pendente"}
                                        </span>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </section>
        ) : activeTab === "nao-localizados" ? (
          <section className="mt-10 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            {/* Sub-abas */}
            <div className="mb-5 flex gap-2 border-b border-slate-200 pb-3">
              <button
                type="button"
                onClick={() => setUnfoundSubTab("itens")}
                className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
                  unfoundSubTab === "itens"
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                Itens Não Localizados
              </button>
              <button
                type="button"
                onClick={() => setUnfoundSubTab("historico")}
                className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition ${
                  unfoundSubTab === "historico"
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                }`}
              >
                Histórico
                {unfoundItems.length > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 text-xs font-semibold ${
                      unfoundSubTab === "historico"
                        ? "bg-white/20 text-white"
                        : "bg-slate-300 text-slate-700"
                    }`}
                  >
                    {unfoundItems.length}
                  </span>
                )}
              </button>
            </div>

            {/* Sub-aba: Itens Não Localizados */}
            {unfoundSubTab === "itens" && (
              <div className="rounded-xl border border-slate-200 p-4">
                {unfoundLoading ? (
                  <p className="py-8 text-center text-sm text-slate-600">
                    Carregando itens não localizados...
                  </p>
                ) : unfoundItems.length === 0 ? (
                  <div className="text-center py-8">
                    <div className="text-4xl mb-2">✓</div>
                    <p className="text-slate-600 font-medium">
                      Todos os itens foram localizados!
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {unfoundItems.map((item) => {
                      const isExpanded = expandedUnfoundItems[item.id];
                      return (
                        <div
                          key={item.id}
                          className="rounded-lg border border-slate-200 bg-slate-50 hover:bg-slate-100"
                        >
                          <button
                            onClick={() =>
                              setExpandedUnfoundItems((prev) => ({
                                ...prev,
                                [item.id]: !prev[item.id],
                              }))
                            }
                            className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="font-semibold text-slate-900">
                                #{item.patrimonio}
                              </p>
                              <p className="text-xs text-slate-600 truncate">
                                {item.descricao}
                              </p>
                              <p className="text-xs text-slate-500 mt-1">
                                📍 {item.space?.name || "Localização não informada"}
                              </p>
                              {item.marcadoPorQuem && item.marcadoPorQuem !== "-" && (
                                <p className="text-xs text-rose-600 mt-0.5">
                                  Não localizado por {abbreviateName(item.marcadoPorQuem)}
                                  {item.marcadoOnde ? ` em ${item.marcadoOnde}` : ""}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="rounded-full px-2 py-0.5 text-xs font-semibold bg-rose-100 text-rose-700">
                                Não Localizado
                              </span>
                              <span className="text-xs font-semibold text-slate-500">
                                {isExpanded ? "▲" : "▼"}
                              </span>
                            </div>
                          </button>

                          {isExpanded && (
                            <div className="border-t border-slate-200 bg-white p-3">
                              <div className="space-y-3 text-sm">
                                <div>
                                  <p className="text-xs font-medium text-slate-500 uppercase">
                                    Patrimônio
                                  </p>
                                  <p className="text-slate-900 font-medium">
                                    {item.patrimonio}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs font-medium text-slate-500 uppercase">
                                    Descrição
                                  </p>
                                  <p className="text-slate-900">
                                    {item.descricao}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs font-medium text-slate-500 uppercase">
                                    Condição Visual
                                  </p>
                                  <p className="text-slate-900">
                                    {item.condicaoVisual}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-xs font-medium text-slate-500 uppercase">
                                    Localização Registrada
                                  </p>
                                  <p className="text-slate-900">
                                    {item.space?.name || "Sem informação"}
                                  </p>
                                </div>
                              </div>

                              <div className="mt-4 pt-4 border-t border-slate-200">
                                <button
                                  onClick={() => {
                                    setUnfoundCondicao("BOM");
                                    setUnfoundMoveTargetSpaceId("");
                                    setUnfoundActionModal({ item, action: "mover" });
                                  }}
                                  className="w-full px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition"
                                >
                                  ➡️ Mover para outra sala
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Sub-aba: Histórico */}
            {unfoundSubTab === "historico" && (
              <div className="rounded-xl border border-slate-200 p-4">
                {unfoundLoading ? (
                  <p className="py-8 text-center text-sm text-slate-600">
                    Carregando histórico...
                  </p>
                ) : unfoundItems.length === 0 ? (
                  <p className="py-8 text-center text-sm text-slate-600">
                    Nenhum histórico de itens não localizados.
                  </p>
                ) : (
                  <div className="overflow-hidden rounded-lg border border-slate-200">
                    <table className="w-full text-left text-sm">
                      <thead className="bg-slate-50 text-slate-700">
                        <tr>
                          <th className="px-3 py-2">Patrimônio</th>
                          <th className="px-3 py-2">Descrição</th>
                          <th className="px-3 py-2">Marcado por</th>
                          <th className="px-3 py-2">Data/Hora</th>
                          <th className="px-3 py-2">Localização</th>
                        </tr>
                      </thead>
                      <tbody>
                        {unfoundItems.map((item, index) => (
                          <tr key={index} className="border-t border-slate-100">
                            <td className="px-3 py-2 font-medium text-slate-900">
                              #{item.patrimonio || "-"}
                            </td>
                            <td className="px-3 py-2 text-slate-600 truncate max-w-xs">
                              {item.descricao || "-"}
                            </td>
                            <td className="px-3 py-2 text-slate-600 text-xs">
                              {item.marcadoPorQuem || "-"}
                            </td>
                            <td className="px-3 py-2 text-slate-600 text-xs">
                              {item.marcadoEm
                                ? new Date(item.marcadoEm).toLocaleString(
                                    "pt-BR",
                                  )
                                : item.dataUltimaAlteracao
                                  ? new Date(
                                      item.dataUltimaAlteracao,
                                    ).toLocaleString("pt-BR")
                                  : "-"}
                            </td>
                            <td className="px-3 py-2 text-slate-600 text-xs">
                              {item.ultimoLocalConhecido || "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </section>
        ) : activeTab !== "espacos" ? (
          <section className="mt-10 rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200">
            {isInventoryAdmin ? (
              <div className="min-w-0 rounded-xl border border-slate-200 p-4">
                {activeTab === "usuarios" ? (
                  <div>
                    <div className="mb-6 rounded-xl border border-slate-200 p-4">
                      <p className="mb-3 text-sm font-semibold text-slate-800">
                        Buscar usuário para incluir
                      </p>
                      <div className="flex flex-wrap gap-2">
                        <input
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          placeholder="Digite nome, siape ou cpf"
                          className="min-w-[220px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        />
                        <select
                          value={newMemberRole}
                          onChange={(e) => setNewMemberRole(e.target.value)}
                          className="rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        >
                          {INVENTORY_ROLES.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>
                        <button
                          onClick={handleSearchUsers}
                          disabled={searchingUsers}
                          className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
                        >
                          {searchingUsers ? "Buscando..." : "Buscar"}
                        </button>
                      </div>

                      {searchResults.length > 0 ? (
                        <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
                          <table className="w-full text-left text-sm">
                            <thead className="bg-slate-50 text-slate-700">
                              <tr>
                                <th className="px-3 py-2">Usuário</th>
                                <th className="px-3 py-2">Situação</th>
                                <th className="px-3 py-2">Ação</th>
                              </tr>
                            </thead>
                            <tbody>
                              {searchResults.map((result) => (
                                <tr
                                  key={result.samAccountName}
                                  className="border-t border-slate-100"
                                >
                                  <td className="px-3 py-2">
                                    <p className="font-medium text-slate-900">
                                      {result.samAccountName} -{" "}
                                      {result.givenName ||
                                        result.fullName?.split(" ")[0] ||
                                        result.fullName}
                                    </p>
                                  </td>
                                  <td className="px-3 py-2 text-xs text-slate-600">
                                    {result.alreadyLinked
                                      ? `Já vinculado (${result.inventoryRole})`
                                      : result.existsLocally
                                        ? "Encontrado no banco local"
                                        : "Encontrado no AD"}
                                  </td>
                                  <td className="px-3 py-2">
                                    <button
                                      onClick={() =>
                                        handleAddPermission(result)
                                      }
                                      className="rounded-md bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-700"
                                    >
                                      {result.alreadyLinked
                                        ? "Atualizar perfil"
                                        : "Adicionar"}
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null}
                    </div>

                    <div>
                      <p className="mb-3 text-sm font-semibold text-slate-800">
                        Usuários autorizados
                      </p>
                      {permissionsLoading ? (
                        <p className="text-sm text-slate-600">
                          Carregando membros...
                        </p>
                      ) : members.length === 0 ? (
                        <p className="text-sm text-slate-600">
                          Nenhum usuário vinculado.
                        </p>
                      ) : (
                        <div className="overflow-hidden rounded-lg border border-slate-200">
                          <table className="w-full text-left text-sm">
                            <thead className="bg-slate-50 text-slate-700">
                              <tr>
                                <th className="px-3 py-2">Usuário</th>
                                <th className="px-3 py-2">Perfil</th>
                                <th className="px-3 py-2">Ações</th>
                              </tr>
                            </thead>
                            <tbody>
                              {members.map((member) => (
                                <tr
                                  key={member.userId}
                                  className="border-t border-slate-100"
                                >
                                  <td className="px-3 py-2">
                                    <p className="font-medium text-slate-900">
                                      {member.samAccountName} -{" "}
                                      {member.fullName?.split(" ")[0] ||
                                        member.fullName}
                                    </p>
                                  </td>
                                  <td className="px-3 py-2">
                                    <select
                                      value={member.inventoryRole}
                                      onChange={(e) =>
                                        handleUpdatePermission(
                                          member,
                                          e.target.value,
                                        )
                                      }
                                      className="rounded-md border border-slate-300 px-2 py-1 text-xs"
                                    >
                                      {INVENTORY_ROLES.map((role) => (
                                        <option key={role} value={role}>
                                          {role}
                                        </option>
                                      ))}
                                    </select>
                                  </td>
                                  <td className="px-3 py-2">
                                    <button
                                      onClick={() =>
                                        handleRemovePermission(member)
                                      }
                                      className="rounded-md bg-rose-600 px-2 py-1 text-xs font-semibold text-white hover:bg-rose-700"
                                    >
                                      Remover
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}

                {activeTab === "dados" ? (
                  <div className="space-y-6">
                    <div className="rounded-xl border border-slate-200 p-4">
                      <p className="mb-3 text-sm font-semibold text-slate-800">
                        Metadados do inventário
                      </p>

                      <div className="grid gap-3 md:grid-cols-2">
                        <label className="text-sm text-slate-700">
                          Nome do inventário
                          <input
                            value={inventoryNameDraft}
                            onChange={(event) =>
                              setInventoryNameDraft(event.target.value)
                            }
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          />
                        </label>

                        <label className="text-sm text-slate-700">
                          Situação operacional
                          <select
                            value={inventoryStatusDraft}
                            onChange={(event) =>
                              setInventoryStatusDraft(event.target.value)
                            }
                            className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                          >
                            {INVENTORY_STATUSES.map((status) => (
                              <option key={status} value={status}>
                                {STATUS_LABELS[status]}
                              </option>
                            ))}
                          </select>
                        </label>

                        <div className="text-sm text-slate-700">
                          Responsável principal
                          <p className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                            {inventoryDetails?.owner
                              ? `${inventoryDetails.owner.samAccountName} - ${inventoryDetails.owner.fullName?.split(" ")[0] || inventoryDetails.owner.fullName}`
                              : "Não informado"}
                          </p>
                        </div>

                        <div className="text-sm text-slate-700">
                          Fonte de dados
                          <p className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                            {inventoryDetails?.sourceType || "Não informado"}
                          </p>
                        </div>

                        <div className="text-sm text-slate-700">
                          Data de início
                          <p className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                            {inventoryDetails?.startedAt
                              ? new Date(
                                  inventoryDetails.startedAt,
                                ).toLocaleDateString("pt-BR")
                              : "Não definida"}
                          </p>
                        </div>

                        <div className="text-sm text-slate-700">
                          Data de término
                          <p className="mt-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                            {inventoryDetails?.finishedAt
                              ? new Date(
                                  inventoryDetails.finishedAt,
                                ).toLocaleDateString("pt-BR")
                              : "Não definida"}
                          </p>
                        </div>
                      </div>

                      <div className="mt-3 flex justify-end">
                        <button
                          onClick={handleSaveInventorySettings}
                          disabled={savingInventorySettings}
                          className="rounded-lg bg-indigo-600 px-3 py-2 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
                        >
                          {savingInventorySettings
                            ? "Salvando..."
                            : "Salvar dados"}
                        </button>
                      </div>
                    </div>

                    <div>
                      <p className="mb-2 text-sm font-semibold text-slate-800">
                        Histórico de status
                      </p>
                      {loadingStatusHistory ? (
                        <p className="text-sm text-slate-600">
                          Carregando histórico...
                        </p>
                      ) : statusHistory.length === 0 ? (
                        <p className="text-sm text-slate-600">
                          Nenhuma mudança de status registrada.
                        </p>
                      ) : (
                        <div className="overflow-hidden rounded-lg border border-slate-200">
                          <table className="w-full text-left text-sm">
                            <thead className="bg-slate-50 text-slate-700">
                              <tr>
                                <th className="px-3 py-2">Transição</th>
                                <th className="px-3 py-2">Usuário</th>
                                <th className="px-3 py-2">Data/Hora</th>
                              </tr>
                            </thead>
                            <tbody>
                              {statusHistory.map((entry) => (
                                <tr
                                  key={entry.id}
                                  className="border-t border-slate-100"
                                >
                                  <td className="px-3 py-2 text-xs text-slate-700">
                                    {STATUS_LABELS[entry.fromStatus] ||
                                      entry.fromStatus}
                                    {" -> "}
                                    {STATUS_LABELS[entry.toStatus] ||
                                      entry.toStatus}
                                  </td>
                                  <td className="px-3 py-2 text-xs text-slate-600">
                                    {entry.changedBy}
                                  </td>
                                  <td className="px-3 py-2 text-xs text-slate-600">
                                    {new Date(entry.changedAt).toLocaleString(
                                      "pt-BR",
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}

                {activeTab === "backups" ? (
                  <div className="space-y-6">

                    {/* Inventory selector — only shown when the user manages more than one inventory */}
                    {backupInventories.length > 1 && (
                      <div className="rounded-xl border border-slate-200 p-5">
                        <h3 className="text-sm font-semibold text-slate-800 mb-3">📦 Inventário</h3>
                        <select
                          value={backupSelectedInventoryId || ""}
                          onChange={(e) => {
                            setBackupList([]);
                            setBackupSchedule(null);
                            setBackupLockStatus(null);
                            setBackupSelectedInventoryId(e.target.value);
                          }}
                          className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                        >
                          {backupInventories.map((inv) => (
                            <option key={inv.id} value={inv.id}>
                              {inv.name}{inv.campus ? ` — ${inv.campus}` : ""}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Lock status banner */}
                    {backupLockStatus?.locked && (
                      <div className="flex items-center gap-3 rounded-xl border border-orange-300 bg-orange-50 p-4">
                        <span className="text-xl">🔒</span>
                        <div>
                          <p className="text-sm font-semibold text-orange-900">
                            Sistema bloqueado — {backupLockStatus.lock?.reason === "BACKUP" ? "Backup" : "Restauração"} em andamento
                          </p>
                          <p className="text-xs text-orange-700 mt-0.5">
                            Alterações no inventário estão temporariamente bloqueadas. Aguarde a conclusão.
                          </p>
                        </div>
                      </div>
                    )}

                    {/* Manual backup */}
                    <div className="rounded-xl border border-slate-200 p-5">
                      <h3 className="text-sm font-semibold text-slate-800 mb-1">🗄️ Criar backup manual</h3>
                      <p className="text-xs text-slate-500 mb-4">
                        Gera um arquivo SQL com o estado atual do inventário. O sistema ficará bloqueado para alterações durante a geração.
                      </p>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={backupLabelInput}
                          onChange={(e) => setBackupLabelInput(e.target.value)}
                          placeholder="Descrição opcional (ex: antes da auditoria)"
                          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                        />
                        <button
                          type="button"
                          onClick={handleCreateBackup}
                          disabled={backupLoading || backupLockStatus?.locked}
                          className="shrink-0 rounded-lg bg-slate-800 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-900 disabled:opacity-50"
                        >
                          {backupLoading ? "Gerando..." : "Gerar backup"}
                        </button>
                      </div>
                    </div>

                    {/* Scheduled backup */}
                    <div className="rounded-xl border border-slate-200 p-5">
                      <h3 className="text-sm font-semibold text-slate-800 mb-1">🕒 Backup automático</h3>
                      <p className="text-xs text-slate-500 mb-4">
                        O sistema criará backups automaticamente no intervalo configurado.
                      </p>
                      {backupSchedule ? (
                        <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 mb-3 flex items-center justify-between">
                          <div>
                            <p className="text-sm font-semibold text-emerald-800">
                              ✅ Ativo — a cada {backupSchedule.intervalHours}h
                            </p>
                            <p className="text-xs text-emerald-700 mt-0.5">
                              Último: {backupSchedule.lastRunAt ? fmtDateTime(backupSchedule.lastRunAt) : "ainda não executou"} •{" "}
                              Próximo: {fmtDateTime(backupSchedule.nextRunAt)}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={handleDeleteSchedule}
                            className="rounded-lg border border-red-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
                          >
                            Desativar
                          </button>
                        </div>
                      ) : null}
                      <div className="flex gap-2 items-center">
                        <input
                          type="number"
                          min="1"
                          value={scheduleIntervalInput}
                          onChange={(e) => setScheduleIntervalInput(e.target.value)}
                          placeholder="Intervalo em horas (ex: 12)"
                          className="w-56 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
                        />
                        <button
                          type="button"
                          onClick={handleSaveSchedule}
                          className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700"
                        >
                          {backupSchedule ? "Atualizar intervalo" : "Ativar agendamento"}
                        </button>
                      </div>
                    </div>

                    {/* Backup list */}
                    <div className="rounded-xl border border-slate-200 p-5">
                      <div className="flex items-center justify-between mb-4">
                        <h3 className="text-sm font-semibold text-slate-800">📋 Backups realizados</h3>
                        <button
                          type="button"
                          onClick={loadBackupData}
                          className="text-xs text-sky-600 hover:underline"
                        >
                          Atualizar
                        </button>
                      </div>

                      {backupListLoading ? (
                        <p className="text-sm text-slate-400">Carregando...</p>
                      ) : backupList.length === 0 ? (
                        <p className="text-sm text-slate-400">Nenhum backup encontrado.</p>
                      ) : (
                        <div className="overflow-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-slate-200 text-left text-xs text-slate-500">
                                <th className="pb-2 pr-4">Data / Hora</th>
                                <th className="pb-2 pr-4">Descrição</th>
                                <th className="pb-2 pr-4">Criado por</th>
                                <th className="pb-2 pr-4">Tamanho</th>
                                <th className="pb-2 pr-4">Tipo</th>
                                <th className="pb-2 pr-4">Status</th>
                                <th className="pb-2">Ações</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                              {backupList.map((record) => (
                                <tr key={record.id} className="align-middle">
                                  <td className="py-2.5 pr-4 whitespace-nowrap text-slate-700">
                                    {fmtDateTime(record.createdAt)}
                                  </td>
                                  <td className="py-2.5 pr-4 text-slate-600 max-w-[180px] truncate">
                                    {record.label || <span className="text-slate-400 italic">—</span>}
                                  </td>
                                  <td className="py-2.5 pr-4 text-slate-600 whitespace-nowrap">
                                    {abbreviateName(record.createdBy)}
                                  </td>
                                  <td className="py-2.5 pr-4 text-slate-600 whitespace-nowrap">
                                    {fmtBytes(record.fileSizeBytes)}
                                  </td>
                                  <td className="py-2.5 pr-4">
                                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${record.isScheduled ? "bg-blue-100 text-blue-700" : "bg-slate-100 text-slate-700"}`}>
                                      {record.isScheduled ? "Automático" : "Manual"}
                                    </span>
                                  </td>
                                  <td className="py-2.5 pr-4">
                                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${
                                      record.status === "COMPLETED" ? "bg-emerald-100 text-emerald-700"
                                      : record.status === "FAILED" ? "bg-red-100 text-red-700"
                                      : "bg-amber-100 text-amber-700"
                                    }`}>
                                      {record.status === "COMPLETED" ? "✓ Concluído"
                                        : record.status === "FAILED" ? "✗ Falha"
                                        : "⏳ Em andamento"}
                                    </span>
                                  </td>
                                  <td className="py-2.5">
                                    <div className="flex gap-1.5">
                                      {record.status === "COMPLETED" && (
                                        <>
                                          <button
                                            type="button"
                                            title="Baixar SQL"
                                            onClick={() => handleDownloadBackup(record)}
                                            className="rounded-lg border border-slate-300 px-2.5 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
                                          >
                                            ⬇ Baixar
                                          </button>
                                          <button
                                            type="button"
                                            title="Restaurar este backup"
                                            onClick={() => { setBackupRestoreId(record.id); setBackupConfirmAction("restore"); }}
                                            className="rounded-lg border border-amber-300 px-2.5 py-1 text-xs font-medium text-amber-700 hover:bg-amber-50"
                                          >
                                            ↩ Restaurar
                                          </button>
                                        </>
                                      )}
                                      <button
                                        type="button"
                                        title="Excluir backup"
                                        onClick={() => { setBackupDeleteId(record.id); setBackupConfirmAction("delete"); }}
                                        className="rounded-lg border border-red-200 px-2.5 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                                      >
                                        🗑
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </div>
            ) : (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-sm font-semibold text-amber-900">
                  Acesso restrito
                </p>
                <p className="mt-1 text-sm text-amber-800">
                  A aba {activeTabMeta.label} está disponível apenas para
                  administradores do inventário (ADMIN_CICLO).
                </p>
              </div>
            )}
          </section>
        ) : null}
      </main>

      <Modal
        isOpen={Boolean(spaceModal)}
        onClose={closeSpaceModal}
        title={spaceModal?.mode === "edit" ? "Editar espaço" : "Novo espaço"}
        size="md"
      >
        <form onSubmit={submitSpaceModal}>
          <ModalBody>
            <div className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Nome
                </label>
                <input
                  value={spaceForm.name}
                  onChange={(event) =>
                    setSpaceForm((prev) => ({
                      ...prev,
                      name: event.target.value,
                    }))
                  }
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  placeholder="Nome do espaço"
                  required
                />
              </div>

              {spaceModal?.mode === "create" ? (
                <>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-slate-700">
                      Responsável
                    </label>
                    <input
                      value={spaceForm.responsible}
                      onChange={(event) =>
                        setSpaceForm((prev) => ({
                          ...prev,
                          responsible: event.target.value,
                        }))
                      }
                      className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                      placeholder="Nome do responsável"
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">
                        Setor
                      </label>
                      <input
                        value={spaceForm.sector}
                        onChange={(event) =>
                          setSpaceForm((prev) => ({
                            ...prev,
                            sector: event.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        placeholder="Opcional"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">
                        Unidade
                      </label>
                      <input
                        value={spaceForm.unit}
                        onChange={(event) =>
                          setSpaceForm((prev) => ({
                            ...prev,
                            unit: event.target.value,
                          }))
                        }
                        className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                        placeholder="Opcional"
                      />
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </ModalBody>
          <ModalFooter>
            <button
              type="button"
              onClick={closeSpaceModal}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700"
            >
              {spaceModal?.mode === "edit" ? "Salvar mudanças" : "Criar espaço"}
            </button>
          </ModalFooter>
        </form>
      </Modal>

      <Modal
        isOpen={groupCreationModal}
        onClose={() => {
          setGroupCreationModal(false);
          setNewGroupName("");
          setNewGroupDescription("");
        }}
      >
        <ModalBody>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Nome do Grupo *
              </label>
              <input
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="Ex: Carteiras da Sala 101"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                autoFocus
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Descrição (opcional)
              </label>
              <textarea
                value={newGroupDescription}
                onChange={(e) => setNewGroupDescription(e.target.value)}
                placeholder="Descreva o propósito ou características do grupo..."
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                rows="3"
              />
            </div>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-xs font-semibold text-slate-700">
                Itens selecionados: {selectedItems.size}
              </p>
              <p className="mt-1 text-xs text-slate-600">
                Este grupo incluirá os {selectedItems.size} item(ns) que você
                selecionou.
              </p>
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <button
            type="button"
            onClick={() => {
              setGroupCreationModal(false);
              setNewGroupName("");
              setNewGroupDescription("");
            }}
            disabled={creatingGroup}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            onClick={handleCreateGroup}
            disabled={creatingGroup || !newGroupName.trim()}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
          >
            {creatingGroup ? "Criando grupo..." : "Criar Grupo"}
          </button>
        </ModalFooter>
      </Modal>

      {/* Modal para ação de item não localizado */}
      <Modal
        isOpen={!!unfoundActionModal}
        onClose={() => setUnfoundActionModal(null)}
        title="Mover item para outra sala"
        size="md"
      >
        <ModalBody>
          <div className="space-y-4">
            <div>
              <p className="text-sm font-semibold text-slate-800">
                Item: #{unfoundActionModal?.item?.patrimonio}
              </p>
              <p className="text-xs text-slate-600 mt-1">
                {unfoundActionModal?.item?.descricao}
              </p>
            </div>

            <div>
              <p className="mb-2 text-sm font-semibold text-slate-700">
                Sala de destino:
              </p>
              <select
                value={unfoundMoveTargetSpaceId}
                onChange={(e) => setUnfoundMoveTargetSpaceId(e.target.value)}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-sky-500 focus:outline-none focus:ring-2 focus:ring-sky-200"
              >
                <option value="">Selecione uma sala...</option>
                {spaces
                  .filter((s) => s.id !== unfoundActionModal?.item?.spaceId && !s.isFinalized)
                  .map((s) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
              </select>
            </div>

            <div>
              <p className="mb-2 text-sm font-semibold text-slate-700">
                Condição visual:
              </p>
              <div className="flex gap-2">
                {[["BOM", "🟢 Bom"], ["REGULAR", "🟡 Regular"], ["RUIM", "🔴 Ruim"]].map(([val, label]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setUnfoundCondicao(val)}
                    className={`flex-1 py-2 px-2 rounded-lg font-medium text-xs transition ${
                      unfoundCondicao === val
                        ? "bg-blue-600 text-white"
                        : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            <div className="rounded-lg bg-amber-50 p-3 border border-amber-200">
              <p className="text-xs text-amber-800">
                O item será movido para a sala selecionada e ficará aguardando confirmação na sala de destino.
              </p>
            </div>
          </div>
        </ModalBody>
        <ModalFooter>
          <button
            type="button"
            onClick={() => setUnfoundActionModal(null)}
            disabled={savingUnfoundAction}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => {
              if (unfoundActionModal?.item) {
                handleUnfoundItemAction(
                  unfoundActionModal.item,
                  unfoundActionModal.action,
                  unfoundCondicao,
                  unfoundMoveTargetSpaceId,
                );
              }
            }}
            disabled={savingUnfoundAction || !unfoundMoveTargetSpaceId}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {savingUnfoundAction ? "Movendo..." : "Confirmar mover"}
          </button>
        </ModalFooter>
      </Modal>

      {/* Backup confirmation modal (restore / delete) */}
      <Modal
        isOpen={!!backupConfirmAction}
        onClose={() => { setBackupConfirmAction(null); setBackupRestoreId(null); setBackupDeleteId(null); }}
        title={backupConfirmAction === "restore" ? "Confirmar restauração" : "Confirmar exclusão"}
        size="sm"
      >
        <ModalBody>
          {backupConfirmAction === "restore" ? (
            <div>
              <p className="text-sm text-slate-700 mb-3">
                <strong>Atenção:</strong> Esta operação irá <strong>substituir todos os dados atuais</strong> do inventário pelo conteúdo deste backup.
              </p>
              <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 mb-3">
                <p className="text-xs text-blue-800 font-semibold">🛡️ Salvaguarda automática: antes de restaurar, o sistema criará automaticamente um backup do estado atual, garantindo que nenhum dado seja perdido sem possibilidade de recuperação.</p>
              </div>
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
                <p className="text-xs text-amber-800 font-semibold">O sistema ficará bloqueado para alterações durante o processo de backup de segurança e restauração.</p>
              </div>
            </div>
          ) : (
            <p className="text-sm text-slate-700">
              O arquivo SQL será excluído permanentemente e não poderá ser recuperado.
            </p>
          )}
        </ModalBody>
        <ModalFooter>
          <button
            type="button"
            onClick={() => { setBackupConfirmAction(null); setBackupRestoreId(null); setBackupDeleteId(null); }}
            className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => {
              if (backupConfirmAction === "restore" && backupRestoreId) handleRestoreBackup(backupRestoreId);
              if (backupConfirmAction === "delete" && backupDeleteId) handleDeleteBackup(backupDeleteId);
            }}
            className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${backupConfirmAction === "restore" ? "bg-amber-600 hover:bg-amber-700" : "bg-red-600 hover:bg-red-700"}`}
          >
            {backupConfirmAction === "restore" ? "Sim, restaurar" : "Sim, excluir"}
          </button>
        </ModalFooter>
      </Modal>
    </div>
  );
}
