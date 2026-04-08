"use client";

import Modal from "../Modal/Modal";
import ModalBody from "../Modal/ModalBody";
import ModalFooter from "../Modal/ModalFooter";

const VARIANT_STYLES = {
  danger: "bg-red-600 hover:bg-red-700 focus:ring-red-300",
  warning: "bg-amber-600 hover:bg-amber-700 focus:ring-amber-300",
  info: "bg-blue-600 hover:bg-blue-700 focus:ring-blue-300",
};

export default function ConfirmModal({
  isOpen,
  onConfirm,
  onCancel,
  title,
  message,
  confirmText = "Confirmar",
  cancelText = "Cancelar",
  variant = "info",
}) {
  const confirmClass = VARIANT_STYLES[variant] || VARIANT_STYLES.info;

  return (
    <Modal isOpen={isOpen} onClose={onCancel} title={title} size="sm">
      <ModalBody>
        <p className="text-sm text-gray-600">{message}</p>
      </ModalBody>
      <ModalFooter>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-100"
        >
          {cancelText}
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className={`px-4 py-2 rounded-lg text-white focus:outline-none focus:ring-2 ${confirmClass}`}
        >
          {confirmText}
        </button>
      </ModalFooter>
    </Modal>
  );
}
