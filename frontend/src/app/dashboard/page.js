"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import { useToast } from "../../components/Toast/toastContext";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";

export default function DashboardPage() {
  const [spaces, setSpaces] = useState([]);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState(null);
  const router = useRouter();
  const { showToast } = useToast();

  useEffect(() => {
    const token = localStorage.getItem("token");
    const userData = localStorage.getItem("user");

    if (!token) {
      router.push("/login");
      return;
    }

    setUser(JSON.parse(userData));
    loadSpaces(token);
  }, [router]);

  const loadSpaces = async (token) => {
    try {
      const { data } = await axios.get(`${API}/spaces/active`, {
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
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("token");
    localStorage.removeItem("user");
    router.push("/login");
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
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                ️ Campus Inventory
              </h1>
              <p className="text-sm text-gray-500 mt-1">
                Sistema de Conferência de Patrimônio
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div className="text-right">
                <p className="text-sm font-semibold text-gray-800">
                  {user?.fullName}
                </p>
                <p className="text-xs text-gray-500">
                  {user?.samAccountName} • {user?.role}
                </p>
              </div>
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
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-800 mb-2">
            Espaços para Conferência
          </h2>
          <p className="text-gray-600">
            Selecione um espaço para iniciar a conferência de itens patrimoniais
          </p>
        </div>

        {spaces.length === 0 ? (
          <div className="bg-white rounded-xl shadow-md p-12 text-center">
            <div className="text-6xl mb-4">📦</div>
            <h3 className="text-xl font-semibold text-gray-800 mb-2">
              Nenhum espaço disponível
            </h3>
            <p className="text-gray-500">
              Não há espaços ativos para conferência no momento.
            </p>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {spaces.map((space) => (
              <a
                key={space.id}
                href={`/room/${space.id}`}
                className="block bg-white rounded-xl shadow-md hover:shadow-xl transition-all duration-300 border border-gray-100 overflow-hidden group"
              >
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
              </a>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
