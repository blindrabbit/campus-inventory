"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { useToast } from "../../components/Toast/toastContext";
import Modal from "../../components/Modal/Modal";
import ModalBody from "../../components/Modal/ModalBody";
import ModalFooter from "../../components/Modal/ModalFooter";
import SpaceSearchBar from "../../components/SpaceSearchBar/SpaceSearchBar";

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
    id: "usuarios",
    label: "Usuarios",
  },
  {
    id: "dados",
    label: "Dados",
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
  const router = useRouter();
  const { showToast } = useToast();

  const isInventoryAdmin = useMemo(() => {
    if (user?.role === "ADMIN") return true;
    return activeInventory?.role === "ADMIN_CICLO";
  }, [user, activeInventory]);

  const visibleTabs = useMemo(() => {
    if (isInventoryAdmin) return DASHBOARD_TABS;
    return DASHBOARD_TABS.filter((tab) => tab.id === "espacos");
  }, [isInventoryAdmin]);

  const hasAuditAccess = useMemo(() => {
    return user?.role === "ADMIN" || activeInventory?.role === "ADMIN_CICLO";
  }, [user, activeInventory]);

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
  }, [activeTab, visibleTabs]);

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
      await loadSpaces(token, inventoryId);

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
        params: { inventoryId },
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
                <h1 className="text-3xl font-bold text-gray-900">
                  Campus Inventory
                </h1>
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
                  {user?.fullName}
                </p>
                <p className="text-xs text-gray-500">
                  {user?.samAccountName} • {user?.role}
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
            {user?.role === "ADMIN" ? (
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

        {activeTab === "espacos" && spaces.length === 0 ? (
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
            {spaces.map((space) => (
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
                {user?.role === "ADMIN" ? (
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
                      Iniciar
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
            ))}
          </div>
        ) : null}

        {activeTab !== "espacos" ? (
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
                                      {result.fullName}
                                    </p>
                                    <p className="text-xs text-slate-500">
                                      {result.samAccountName}
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
                                      {member.fullName}
                                    </p>
                                    <p className="text-xs text-slate-500">
                                      {member.samAccountName}
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
                            {inventoryDetails?.owner?.fullName ||
                              "Não informado"}
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
    </div>
  );
}
