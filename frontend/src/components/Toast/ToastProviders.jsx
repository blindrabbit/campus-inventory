"use client";

import { ToastProvider } from "./toastContext";

export default function ToastProviders({ children }) {
  return <ToastProvider>{children}</ToastProvider>;
}
