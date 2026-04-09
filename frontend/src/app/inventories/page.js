"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { useToast } from "../../components/Toast/toastContext";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";

const STATUS_LABELS = {
  NAO_INICIADO: "Não iniciado",
  EM_EXECUCAO: "Em execução",
  PAUSADO: "Pausado",
  EM_AUDITORIA: "Em Auditoria",
  FINALIZADO: "Finalizado",
  CANCELADO: "Cancelado",
};

export default function InventoriesPage() {
  const router = useRouter();
  const { showToast } = useToast();
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const [inventories, setInventories] = useState([]);

  useEffect(() => {
    const token = localStorage.getItem("token");
    const userData = localStorage.getItem("user");
    if (!token) {
      router.push("/login");
      return;
    }

    setUser(userData ? JSON.parse(userData) : null);
    loadInventories(token);
  }, [router]);

  const loadInventories = async (token) => {
    try {
      const { data } = await axios.get(`${API}/inventories/my`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setInventories(data || []);
    } catch (error) {
      showToast({
        type: "error",
        title: "Falha ao carregar inventários",
        message:
          error.response?.data?.error ||
          "Não foi possível carregar os inventários autorizados.",
      });
    } finally {
      setLoading(false);
    }
  };

  const canCreateInventory = () => {
    if (user?.role === "ADMIN") return true;
    return inventories.some((inventory) => inventory.role === "ADMIN_CICLO");
  };

  const handleSelectInventory = (inventory) => {
    localStorage.setItem("activeInventoryId", inventory.id);
    localStorage.setItem(
      "activeInventory",
      JSON.stringify({
        id: inventory.id,
        name: inventory.name,
        role: inventory.role,
        statusOperacao: inventory.statusOperacao,
      }),
    );

    router.push("/dashboard");
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    localStorage.removeItem("activeInventoryId");
    localStorage.removeItem("activeInventory");
    router.push("/login");
  };

  const handleManageUsers = () => {
    router.push("/admin/users");
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <p className="text-slate-600">Carregando inventários...</p>
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
                Sistema de Conferência de Patrimônio
              </p>
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
              {canCreateInventory() ? (
                <button
                  onClick={() => router.push("/inventories/new")}
                  className="px-4 py-2 rounded-lg border border-sky-300 bg-sky-50 text-sm font-medium text-sky-700 hover:bg-sky-100"
                >
                  Criar novo inventário
                </button>
              ) : null}
              {canCreateInventory() ? (
                <button
                  onClick={handleManageUsers}
                  className="px-4 py-2 rounded-lg border border-slate-300 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  Gerenciar Usuários
                </button>
              ) : null}
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

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-800 mb-2">
            Meus Inventários
          </h2>
          <p className="text-gray-600">
            Clique no card para selecionar um inventário autorizado e continuar.
          </p>
        </div>

        {inventories.length === 0 ? (
          <div className="rounded-2xl bg-white p-8 text-center shadow-sm ring-1 ring-slate-200">
            <h3 className="text-xl font-semibold text-slate-900">
              Nenhum inventário autorizado
            </h3>
            <p className="mt-2 text-slate-600">
              Solicite ao administrador a liberação de acesso a um inventário.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {inventories.map((inventory) => (
              <div
                key={inventory.id}
                role="button"
                tabIndex={0}
                onClick={() => handleSelectInventory(inventory)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    handleSelectInventory(inventory);
                  }
                }}
                className="group cursor-pointer rounded-2xl bg-white p-5 text-left shadow-sm ring-1 ring-slate-200 transition hover:-translate-y-0.5 hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500"
              >
                <p className="text-xs font-medium uppercase tracking-wide text-sky-700">
                  {inventory.campus || "Campus não informado"}
                </p>
                <h3 className="mt-1 text-xl font-semibold text-slate-900 group-hover:text-sky-700">
                  {inventory.name}
                </h3>
                <div className="mt-4 flex flex-wrap gap-2 text-xs text-slate-600">
                  <span className="rounded-full bg-slate-100 px-2 py-1">
                    Perfil: {inventory.role}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-1">
                    Status:{" "}
                    {STATUS_LABELS[inventory.statusOperacao] ||
                      inventory.statusOperacao}
                  </span>
                  <span className="rounded-full bg-slate-100 px-2 py-1">
                    Espaços: {inventory.counts?.spaces ?? 0}
                  </span>
                </div>
                <p className="mt-4 text-xs font-medium text-sky-700">
                  Clique para acessar o inventário
                </p>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
