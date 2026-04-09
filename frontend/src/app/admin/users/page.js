"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { useToast } from "../../../components/Toast/toastContext";
import ConfirmModal from "../../../components/ConfirmModal/ConfirmModal";
import Modal from "../../../components/Modal/Modal";
import ModalBody from "../../../components/Modal/ModalBody";
import ModalFooter from "../../../components/Modal/ModalFooter";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";
const INVENTORY_ROLES = [
  "ADMIN_CICLO",
  "CONFERENTE",
  "REVISOR",
  "VISUALIZADOR",
];

export default function AdminUsersPage() {
  const router = useRouter();
  const { showToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [users, setUsers] = useState([]);
  const [inventories, setInventories] = useState([]);
  const [user, setUser] = useState(null);

  const [search, setSearch] = useState("");
  const [confirmRemove, setConfirmRemove] = useState(null);

  const [addModalUser, setAddModalUser] = useState(null);
  const [selectedInventoryId, setSelectedInventoryId] = useState("");
  const [selectedRole, setSelectedRole] = useState("CONFERENTE");
  const [savingAdd, setSavingAdd] = useState(false);

  const token = useMemo(
    () =>
      typeof window !== "undefined" ? localStorage.getItem("token") : null,
    [],
  );

  useEffect(() => {
    const localToken = localStorage.getItem("token");
    const userData = localStorage.getItem("user");

    if (!localToken) {
      router.push("/login");
      return;
    }

    setUser(userData ? JSON.parse(userData) : null);
    bootstrap(localToken);
  }, [router]);

  const bootstrap = async (localToken) => {
    setLoading(true);
    try {
      const [usersRes, inventoriesRes] = await Promise.all([
        axios.get(`${API}/admin/users`, {
          headers: { Authorization: `Bearer ${localToken}` },
        }),
        axios.get(`${API}/inventories/my`, {
          headers: { Authorization: `Bearer ${localToken}` },
        }),
      ]);

      setUsers(usersRes.data || []);
      setInventories(inventoriesRes.data || []);
    } catch (error) {
      showToast({
        type: "error",
        title: "Falha ao carregar gestão de usuários",
        message:
          error.response?.data?.error ||
          "Não foi possível carregar os dados de gerenciamento.",
      });
    } finally {
      setLoading(false);
    }
  };

  const loadUsers = async () => {
    if (!token) return;

    setLoadingUsers(true);
    try {
      const { data } = await axios.get(`${API}/admin/users`, {
        params: search.trim() ? { search: search.trim() } : undefined,
        headers: { Authorization: `Bearer ${token}` },
      });
      setUsers(data || []);
    } catch (error) {
      showToast({
        type: "error",
        title: "Falha ao buscar usuários",
        message:
          error.response?.data?.error || "Não foi possível buscar usuários.",
      });
    } finally {
      setLoadingUsers(false);
    }
  };

  const handleRemoveLink = async () => {
    if (!confirmRemove || !token) return;

    try {
      await axios.delete(
        `${API}/admin/users/${confirmRemove.userId}/inventories/${confirmRemove.inventoryId}`,
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      showToast({
        type: "success",
        title: "Vínculo removido",
        message: `${confirmRemove.inventoryName} removido para ${confirmRemove.userName}.`,
      });

      setConfirmRemove(null);
      await loadUsers();
    } catch (error) {
      showToast({
        type: "error",
        title: "Falha ao remover vínculo",
        message:
          error.response?.data?.error || "Não foi possível remover o vínculo.",
      });
    }
  };

  const openAddModal = (targetUser) => {
    setAddModalUser(targetUser);
    setSelectedInventoryId("");
    setSelectedRole("CONFERENTE");
  };

  const handleAddLink = async (event) => {
    event.preventDefault();
    if (!addModalUser || !selectedInventoryId || !token) return;

    setSavingAdd(true);
    try {
      await axios.post(
        `${API}/admin/users/${addModalUser.userId}/inventories`,
        {
          inventoryId: selectedInventoryId,
          role: selectedRole,
        },
        {
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      showToast({
        type: "success",
        title: "Vínculo salvo",
        message: "Usuário vinculado ao inventário com sucesso.",
      });

      setAddModalUser(null);
      await loadUsers();
    } catch (error) {
      showToast({
        type: "error",
        title: "Falha ao salvar vínculo",
        message:
          error.response?.data?.error || "Não foi possível salvar o vínculo.",
      });
    } finally {
      setSavingAdd(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("activeInventoryId");
    localStorage.removeItem("activeInventory");
    router.push("/login");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-600">Carregando usuários...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <header className="bg-white shadow-lg border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                Campus Inventory
              </h1>
              <p className="text-sm text-gray-500 mt-1">
                Gestão Global de Usuários
              </p>
            </div>
            <div className="flex items-center gap-3 self-start lg:self-auto">
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
                Inventários
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

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex-1 text-sm text-slate-700">
              Buscar por CN ou siape
              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Ex.: Renan ou 1918648"
                className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <button
              onClick={loadUsers}
              disabled={loadingUsers}
              className="rounded-lg bg-sky-600 px-4 py-2 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-60"
            >
              {loadingUsers ? "Buscando..." : "Buscar"}
            </button>
          </div>
        </div>

        {users.length === 0 ? (
          <div className="rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
            <h3 className="text-xl font-semibold text-slate-900">
              Nenhum usuário local encontrado
            </h3>
            <p className="mt-2 text-slate-600">
              Ajuste o termo de busca ou aguarde novos logins para popular o
              cadastro local.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {users.map((entry) => (
              <article
                key={entry.userId}
                className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200"
              >
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900">
                      {entry.fullName}
                    </h3>
                    <p className="text-xs text-slate-500">
                      {entry.samAccountName} • {entry.globalRole}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => openAddModal(entry)}
                    className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100"
                  >
                    add
                  </button>
                </div>

                <div className="flex flex-wrap gap-2">
                  {entry.inventories.length === 0 ? (
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-slate-600">
                      Sem inventários vinculados
                    </span>
                  ) : (
                    entry.inventories.map((link) => (
                      <span
                        key={`${entry.userId}-${link.inventoryId}`}
                        className="group inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-700"
                        title={`${link.inventoryName} (${link.role})`}
                      >
                        <span className="max-w-[180px] truncate">
                          {link.inventoryName} • {link.role}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setConfirmRemove({
                              userId: entry.userId,
                              userName: entry.fullName,
                              inventoryId: link.inventoryId,
                              inventoryName: link.inventoryName,
                            })
                          }
                          className="hidden h-4 w-4 items-center justify-center rounded-full bg-rose-100 text-rose-700 transition hover:bg-rose-200 group-hover:inline-flex"
                          aria-label={`Remover ${entry.fullName} de ${link.inventoryName}`}
                        >
                          x
                        </button>
                      </span>
                    ))
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
      </main>

      <ConfirmModal
        isOpen={Boolean(confirmRemove)}
        onCancel={() => setConfirmRemove(null)}
        onConfirm={handleRemoveLink}
        title="Remover vínculo de inventário"
        message={
          confirmRemove
            ? `Confirma remover ${confirmRemove.userName} do inventário ${confirmRemove.inventoryName}?`
            : ""
        }
        confirmText="Remover"
        variant="danger"
      />

      <Modal
        isOpen={Boolean(addModalUser)}
        onClose={() => setAddModalUser(null)}
        title={
          addModalUser
            ? `Vincular ${addModalUser.fullName}`
            : "Vincular usuário"
        }
        size="md"
      >
        <form onSubmit={handleAddLink}>
          <ModalBody>
            <div className="space-y-4">
              <label className="block text-sm text-slate-700">
                Inventário
                <select
                  value={selectedInventoryId}
                  onChange={(event) =>
                    setSelectedInventoryId(event.target.value)
                  }
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  required
                >
                  <option value="">Selecione um inventário</option>
                  {inventories.map((inventory) => (
                    <option key={inventory.id} value={inventory.id}>
                      {inventory.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm text-slate-700">
                Perfil no inventário
                <select
                  value={selectedRole}
                  onChange={(event) => setSelectedRole(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                  required
                >
                  {INVENTORY_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </ModalBody>

          <ModalFooter>
            <button
              type="button"
              onClick={() => setAddModalUser(null)}
              className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={savingAdd}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-60"
            >
              {savingAdd ? "Salvando..." : "Salvar vínculo"}
            </button>
          </ModalFooter>
        </form>
      </Modal>
    </div>
  );
}
