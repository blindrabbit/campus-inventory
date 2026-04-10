// frontend/src/lib/syncQueue.js
import localforage from "localforage";

const QUEUE_KEY = "campus_inventory_sync_queue";
const isBrowser = typeof window !== "undefined";
let isOnline = isBrowser ? navigator.onLine : true;
let queue = [];

function buildActionKey(action) {
  const method = action?.method || "POST";
  const endpoint = action?.endpoint || "";
  const payload = action?.payload || {};
  return `${method}:${endpoint}:${JSON.stringify(payload)}`;
}

function normalizeQueueEntries(storedQueue) {
  if (!Array.isArray(storedQueue)) return [];

  const normalized = [];
  const seen = new Set();

  for (const entry of storedQueue) {
    if (!entry || typeof entry !== "object") continue;

    const normalizedEntry = {
      ...entry,
      method: entry.method || "POST",
    };
    normalizedEntry.actionKey = buildActionKey(normalizedEntry);

    if (seen.has(normalizedEntry.actionKey)) continue;
    seen.add(normalizedEntry.actionKey);
    normalized.push(normalizedEntry);
  }

  return normalized;
}

function coalesceItemActions(nextAction) {
  const endpoint = nextAction.endpoint;
  const itemId = nextAction?.payload?.itemId;
  if (!itemId) return;

  if (endpoint === "/items/relocate") {
    // Keep only the latest pending relocation for the same item.
    queue = queue.filter(
      (queued) =>
        !(
          queued.endpoint === "/items/relocate" &&
          queued?.payload?.itemId === itemId
        ),
    );
  }

  if (endpoint === "/items/check") {
    // Keep only the latest pending check action for the same item.
    queue = queue.filter(
      (queued) =>
        !(
          queued.endpoint === "/items/check" &&
          queued?.payload?.itemId === itemId
        ),
    );
  }
}

function generateActionId() {
  if (!isBrowser) return `srv-${Date.now()}`;

  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }

  if (
    typeof crypto !== "undefined" &&
    typeof crypto.getRandomValues === "function"
  ) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  }

  return `fallback-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Inicializar fila do IndexedDB
if (isBrowser) {
  localforage.getItem(QUEUE_KEY).then((stored) => {
    queue = normalizeQueueEntries(stored);
    saveQueue();
    if (queue.length > 0 && isOnline) processQueue();
  });

  window.addEventListener("online", () => {
    isOnline = true;
    processQueue();
  });
  window.addEventListener("offline", () => {
    isOnline = false;
  });
}

export function enqueueAction(action) {
  if (!isBrowser) return null;

  const normalizedAction = {
    ...action,
    method: action?.method || "POST",
  };
  coalesceItemActions(normalizedAction);
  const actionKey = buildActionKey(normalizedAction);

  const alreadyQueued = queue.some((queued) => queued.actionKey === actionKey);
  if (alreadyQueued) {
    return null;
  }

  queue.push({
    ...normalizedAction,
    id: generateActionId(),
    timestamp: Date.now(),
    actionKey,
  });
  saveQueue();

  if (isOnline) processQueue();
  return action.id;
}

async function saveQueue() {
  await localforage.setItem(QUEUE_KEY, queue);
}

async function processQueue() {
  if (!isBrowser || !isOnline || queue.length === 0) return;

  const api = process.env.NEXT_PUBLIC_API_URL || "/api";
  const token = localStorage.getItem("token");
  const activeInventoryId = localStorage.getItem("activeInventoryId");
  if (!token) return;

  // Processar em ordem FIFO
  while (queue.length > 0) {
    const action = queue[0];
    try {
      const response = await fetch(`${api}${action.endpoint}`, {
        method: action.method || "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...(activeInventoryId ? { "x-inventory-id": activeInventoryId } : {}),
        },
        body: JSON.stringify(action.payload),
      });

      // Validar que a resposta foi bem-sucedida (2xx)
      if (!response.ok) {
        let errorBody = "";
        try {
          errorBody = await response.text();
        } catch {
          errorBody = "";
        }

        const httpError = new Error(
          `HTTP ${response.status} ao sincronizar ${action.endpoint}${errorBody ? `: ${errorBody}` : ""}`,
        );
        httpError.status = response.status;
        throw httpError;
      }

      // Sucesso: remover da fila apenas após validar response.ok
      queue.shift();
      await saveQueue();
    } catch (err) {
      const statusCode = err?.status || 0;

      // Erros 4xx (cliente): requisição inválida, nunca vai funcionar
      // Remover da fila e logar para auditoria
      if (statusCode >= 400 && statusCode < 500) {
        const message = err?.message || "";
        const isExpectedRelocateConflict =
          action.endpoint === "/items/relocate" &&
          statusCode === 400 &&
          message.includes("já está no espaço de destino informado");

        if (isExpectedRelocateConflict) {
          console.info(
            "ℹ️ Ação descartada da fila (realocação já aplicada):",
            action.endpoint,
          );
        } else {
          console.warn(
            "⚠️ Ação removida da fila (erro de cliente HTTP",
            statusCode + "):",
            action.endpoint,
            err?.message || err,
          );
        }

        queue.shift();
        await saveQueue();
        // Continuar tentando próximas ações da fila
        continue;
      }

      // Erros 5xx (servidor) ou sem conexão: podem ser transitórios
      // Manter na fila e parar/tentar depois
      console.warn(
        "⏸️ Ação em fila (offline/erro transitório):",
        action.endpoint,
        err?.message || err,
      );
      break; // Para na falha, tenta depois
    }
  }
}

// Hook simplificado para debounce + auto-save
export function useAutoSave() {
  let timer = null;
  return (actionFn, delay = 1000) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      actionFn();
    }, delay);
  };
}
