export default function Toast({ toast, onDismiss }) {
  const tone =
    {
      success: "border-emerald-500 bg-emerald-50",
      error: "border-red-500 bg-red-50",
      warning: "border-amber-500 bg-amber-50",
      info: "border-sky-500 bg-sky-50",
    }[toast.type] || "border-sky-500 bg-sky-50";

  return (
    <div
      className={`w-full max-w-sm rounded-lg border-l-4 p-4 shadow-lg ${tone}`}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          {toast.title ? (
            <p className="font-semibold text-gray-900">{toast.title}</p>
          ) : null}
          {toast.message ? (
            <p className="text-sm text-gray-700 mt-1">{toast.message}</p>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => onDismiss(toast.id)}
          className="text-gray-500 hover:text-gray-800"
          aria-label="Fechar notificação"
        >
          ×
        </button>
      </div>
    </div>
  );
}
