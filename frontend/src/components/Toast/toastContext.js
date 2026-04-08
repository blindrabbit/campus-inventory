"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import ToastContainer from "./ToastContainer";

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timeoutMapRef = useRef(new Map());

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
    const timeout = timeoutMapRef.current.get(id);
    if (timeout) {
      clearTimeout(timeout);
      timeoutMapRef.current.delete(id);
    }
  }, []);

  const showToast = useCallback(
    ({ type = "info", title = "", message = "", duration = 3000 }) => {
      const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      setToasts((prev) => [...prev, { id, type, title, message }]);

      const timeout = setTimeout(() => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
        timeoutMapRef.current.delete(id);
      }, duration);

      timeoutMapRef.current.set(id, timeout);
    },
    [],
  );

  const value = useMemo(
    () => ({ showToast, dismissToast }),
    [showToast, dismissToast],
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error("useToast must be used within ToastProvider");
  }

  return context;
}
