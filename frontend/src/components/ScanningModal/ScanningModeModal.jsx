"use client";
import { useEffect, useRef, useCallback, useState } from "react";
import axios from "axios";
import { useToast } from "../Toast/toastContext";

const API = process.env.NEXT_PUBLIC_API_URL || "/api";

// Estrutura de um item na sessão de leitura:
// { sessionId, item, action, relocated, originalSpaceId, originalSpaceName, timestamp, undone, undoing }

export default function ScanningModeModal({
  isOpen,
  onClose,
  spaceId,
  connectionId,
  // Estado persistente da sessão (gerenciado pelo pai)
  history,
  currentIndex,
  onHistoryChange,
  onIndexChange,
  // Callback para atualizar a lista de itens da sala após cada leitura/desfazer
  onScanEvent,
}) {
  const inputRef = useRef(null);
  const { showToast } = useToast();
  const [processing, setProcessing] = useState(false);
  const [lastError, setLastError] = useState(null);
  const [lastCode, setLastCode] = useState("");

  const currentEntry = history[currentIndex] ?? null;

  // Foca o input oculto sempre que o modal abre
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 80);
    }
  }, [isOpen]);

  // Volta o foco ao input após qualquer clique na área do modal
  const refocus = useCallback(() => {
    setTimeout(() => inputRef.current?.focus(), 60);
  }, []);

  const handleKeyDown = useCallback(
    async (e) => {
      if (e.key !== "Enter") return;
      const code = inputRef.current?.value?.trim();
      if (inputRef.current) inputRef.current.value = "";
      if (!code || processing) return;

      const inventoryId = localStorage.getItem("activeInventoryId");
      const token = localStorage.getItem("token");
      if (!inventoryId || !token) return;

      setProcessing(true);
      setLastError(null);
      setLastCode(code);

      const authHeaders = {
        Authorization: `Bearer ${token}`,
        "x-inventory-id": inventoryId,
      };

      try {
        // 1. Buscar item pelo código
        const { data: found } = await axios.get(`${API}/items/scan`, {
          params: { code, spaceId, inventoryId },
          headers: authHeaders,
        });

        // 2. Confirmar item via scan
        const { data: confirmed } = await axios.post(
          `${API}/items/scan-confirm`,
          { itemId: found.id, spaceId, inventoryId, connectionId },
          { headers: authHeaders },
        );

        const newEntry = {
          sessionId: `${found.id}-${Date.now()}`,
          item: found,
          action: confirmed.relocated
            ? "ENCONTRADO_LEITURA_REALOCADO"
            : "ENCONTRADO_LEITURA",
          relocated: confirmed.relocated,
          originalSpaceId: confirmed.originalSpaceId,
          originalSpaceName: confirmed.originalSpaceName,
          timestamp: new Date(),
          undone: false,
          undoing: false,
        };

        const newHistory = [...history, newEntry];
        onHistoryChange(newHistory);
        onIndexChange(newHistory.length - 1);
        onScanEvent?.();

        if (confirmed.relocated) {
          showToast(
            `⚠️ Item realocado de "${confirmed.originalSpaceName}" para esta sala`,
            "warning",
          );
        }
      } catch (err) {
        const msg =
          err.response?.data?.error || "Erro ao processar leitura";
        setLastError(msg);
        showToast(msg, "error");
      } finally {
        setProcessing(false);
        refocus();
      }
    },
    [
      processing,
      spaceId,
      connectionId,
      history,
      onHistoryChange,
      onIndexChange,
      onScanEvent,
      showToast,
      refocus,
    ],
  );

  const handleUndo = useCallback(
    async (entryIndex) => {
      const entry = history[entryIndex];
      if (!entry || entry.undone || entry.undoing) return;

      const inventoryId = localStorage.getItem("activeInventoryId");
      const token = localStorage.getItem("token");
      if (!inventoryId || !token) return;

      const newHistory = history.map((h, i) =>
        i === entryIndex ? { ...h, undoing: true } : h,
      );
      onHistoryChange(newHistory);

      try {
        await axios.post(
          `${API}/items/scan-undo`,
          {
            itemId: entry.item.id,
            originalSpaceId: entry.originalSpaceId || spaceId,
            inventoryId,
            connectionId,
          },
          { headers: { Authorization: `Bearer ${token}`, "x-inventory-id": inventoryId } },
        );

        onHistoryChange(
          history.map((h, i) =>
            i === entryIndex ? { ...h, undone: true, undoing: false } : h,
          ),
        );

        onScanEvent?.();
        showToast("Leitura desfeita com sucesso", "success");
      } catch (err) {
        onHistoryChange(
          history.map((h, i) =>
            i === entryIndex ? { ...h, undoing: false } : h,
          ),
        );
        showToast(
          err.response?.data?.error || "Erro ao desfazer leitura",
          "error",
        );
      } finally {
        refocus();
      }
    },
    [history, onHistoryChange, spaceId, connectionId, onScanEvent, showToast, refocus],
  );

  if (!isOpen) return null;

  const totalItems = history.length;
  const displayIndex = currentIndex + 1;
  const canGoPrev = currentIndex > 0;
  const canGoNext = currentIndex < history.length - 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={refocus}
    >
      {/* Input oculto que captura a entrada do leitor HID */}
      <input
        ref={inputRef}
        type="text"
        aria-hidden="true"
        tabIndex={-1}
        className="absolute opacity-0 pointer-events-none w-0 h-0"
        onKeyDown={handleKeyDown}
        readOnly={false}
        autoComplete="off"
      />

      <div
        className="relative w-full max-w-lg mx-4 bg-white rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Cabeçalho */}
        <div className="flex items-center justify-between px-5 py-4 bg-blue-600 text-white">
          <div className="flex items-center gap-2">
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-white" />
            </span>
            <span className="font-semibold text-sm tracking-wide uppercase">
              Modo Leitura Ativo
            </span>
          </div>
          <div className="flex items-center gap-3">
            {totalItems > 0 && (
              <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">
                {totalItems} {totalItems === 1 ? "item" : "itens"} na sessão
              </span>
            )}
            <button
              onClick={onClose}
              className="p-1 rounded-lg hover:bg-white/20 transition-colors"
              title="Fechar modo leitura (histórico mantido)"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Área principal */}
        <div className="px-5 py-4 min-h-[260px] flex flex-col">
          {totalItems === 0 ? (
            // Estado vazio — aguardando primeira leitura
            <div className="flex-1 flex flex-col items-center justify-center gap-3 text-gray-400">
              <svg className="w-12 h-12 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                  d="M12 4v1m0 14v1M4.22 6.22l.707.707m12.146 12.146.707.707M4 12H3m18 0h-1M6.929 17.071l-.707.707M17.778 6.222l-.707-.707M9 12a3 3 0 1 0 6 0 3 3 0 0 0-6 0z" />
              </svg>
              <p className="text-sm font-medium">Aguardando leitura</p>
              <p className="text-xs text-center">
                Aponte o leitor de código de barras ou RFID para um item
              </p>
            </div>
          ) : (
            <>
              {/* Navegação entre itens da sessão */}
              <div className="flex items-center justify-between mb-3">
                <button
                  onClick={() => { onIndexChange(currentIndex - 1); refocus(); }}
                  disabled={!canGoPrev}
                  className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title="Item anterior"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                </button>

                <span className="text-xs text-gray-500">
                  Item{" "}
                  <span className="font-semibold text-gray-700">{displayIndex}</span>
                  {" "}de{" "}
                  <span className="font-semibold text-gray-700">{totalItems}</span>
                </span>

                <button
                  onClick={() => { onIndexChange(currentIndex + 1); refocus(); }}
                  disabled={!canGoNext}
                  className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                  title="Próximo item"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </button>
              </div>

              {/* Card do item atual */}
              {currentEntry && (
                <ItemCard
                  entry={currentEntry}
                  entryIndex={currentIndex}
                  onUndo={handleUndo}
                  refocus={refocus}
                />
              )}
            </>
          )}
        </div>

        {/* Rodapé — estado do processamento */}
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-100">
          {processing ? (
            <div className="flex items-center gap-2 text-blue-600 text-xs">
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Processando leitura...
            </div>
          ) : lastError ? (
            <div className="flex items-center gap-2 text-red-500 text-xs">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              </svg>
              <span className="truncate">{lastError}</span>
              {lastCode && (
                <span className="text-gray-400 font-mono ml-auto flex-shrink-0">
                  "{lastCode}"
                </span>
              )}
            </div>
          ) : (
            <p className="text-xs text-gray-400 text-center">
              Pronto — aponte o leitor para o próximo item
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function ItemCard({ entry, entryIndex, onUndo, refocus }) {
  const { item, relocated, originalSpaceName, undone, undoing, timestamp } =
    entry;

  return (
    <div
      className={`rounded-xl border-2 p-4 transition-all ${
        undone
          ? "border-gray-200 bg-gray-50 opacity-60"
          : relocated
          ? "border-amber-300 bg-amber-50"
          : "border-green-300 bg-green-50"
      }`}
    >
      {/* Badges de status */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {undone ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium bg-gray-200 text-gray-500 px-2 py-0.5 rounded-full line-through">
            Desfeito
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-medium bg-green-100 text-green-700 px-2 py-0.5 rounded-full">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            Confirmado
          </span>
        )}
        {relocated && !undone && (
          <span className="inline-flex items-center gap-1 text-xs font-medium bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            Realocado automaticamente
          </span>
        )}
        <span className="ml-auto text-xs text-gray-400">
          {timestamp.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
        </span>
      </div>

      {/* Dados do item */}
      <h3 className="font-semibold text-gray-900 text-sm leading-tight mb-1 line-clamp-2">
        {item.descricao || "Sem título"}
      </h3>

      {item.autores && (
        <p className="text-xs text-gray-500 mb-1">
          {item.autores}
          {item.anoPublicacao && ` · ${item.anoPublicacao}`}
        </p>
      )}

      <div className="mt-2 space-y-0.5 text-xs text-gray-500">
        {item.patrimonio && (
          <div className="flex gap-1">
            <span className="text-gray-400 w-20 shrink-0">Patrimônio</span>
            <span className="font-mono text-gray-700">{item.patrimonio}</span>
          </div>
        )}
        {item.codigoBarras && (
          <div className="flex gap-1">
            <span className="text-gray-400 w-20 shrink-0">Cód. barras</span>
            <span className="font-mono text-gray-700">{item.codigoBarras}</span>
          </div>
        )}
        {item.codigoRFID && (
          <div className="flex gap-1">
            <span className="text-gray-400 w-20 shrink-0">RFID</span>
            <span className="font-mono text-gray-700">{item.codigoRFID}</span>
          </div>
        )}
        {relocated && originalSpaceName && (
          <div className="flex gap-1 mt-1">
            <span className="text-amber-500 w-20 shrink-0">Sala de origem</span>
            <span className="text-amber-700 font-medium">{originalSpaceName}</span>
          </div>
        )}
      </div>

      {/* Botão desfazer */}
      {!undone && (
        <div className="mt-3 flex justify-end">
          <button
            onClick={() => { onUndo(entryIndex); refocus(); }}
            disabled={undoing}
            className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg border border-gray-200 hover:border-red-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {undoing ? (
              <>
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                Desfazendo...
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
                </svg>
                Desfazer esta leitura
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
}
