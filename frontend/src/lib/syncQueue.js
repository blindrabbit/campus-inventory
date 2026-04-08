// frontend/src/lib/syncQueue.js
import localforage from 'localforage';

const QUEUE_KEY = 'campus_inventory_sync_queue';
const isBrowser = typeof window !== 'undefined';
let isOnline = isBrowser ? navigator.onLine : true;
let queue = [];

function generateActionId() {
  if (!isBrowser) return `srv-${Date.now()}`;

  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  return `fallback-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Inicializar fila do IndexedDB
if (isBrowser) {
  localforage.getItem(QUEUE_KEY).then(stored => {
    queue = stored || [];
    if (queue.length > 0 && isOnline) processQueue();
  });

  window.addEventListener('online', () => { isOnline = true; processQueue(); });
  window.addEventListener('offline', () => { isOnline = false; });
}

export function enqueueAction(action) {
  if (!isBrowser) return null;

  queue.push({ ...action, id: generateActionId(), timestamp: Date.now() });
  saveQueue();
  
  if (isOnline) processQueue();
  return action.id;
}

async function saveQueue() {
  await localforage.setItem(QUEUE_KEY, queue);
}

async function processQueue() {
  if (!isBrowser || !isOnline || queue.length === 0) return;
  
  const api = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8088/api';
  const token = localStorage.getItem('token');
  if (!token) return;

  // Processar em ordem FIFO
  while (queue.length > 0) {
    const action = queue[0];
    try {
      await fetch(`${api}${action.endpoint}`, {
        method: action.method || 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(action.payload)
      });
      queue.shift(); // Remove sucesso
      await saveQueue();
    } catch (err) {
      console.warn('⏸️ Ação em fila (offline/erro):', action.endpoint);
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