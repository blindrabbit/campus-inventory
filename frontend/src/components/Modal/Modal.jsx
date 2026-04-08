"use client";

import { useEffect, useId, useRef } from "react";

function getFocusableElements(container) {
  if (!container) return [];

  return Array.from(
    container.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    ),
  ).filter(
    (el) => !el.hasAttribute("disabled") && !el.getAttribute("aria-hidden"),
  );
}

export default function Modal({
  isOpen,
  onClose,
  title,
  size = "md",
  children,
}) {
  const modalRef = useRef(null);
  const lastActiveElementRef = useRef(null);
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) return;

    lastActiveElementRef.current = document.activeElement;

    const focusable = getFocusableElements(modalRef.current);
    if (focusable.length > 0) {
      focusable[0].focus();
    } else {
      modalRef.current?.focus();
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }

      if (event.key !== "Tab") return;

      const elements = getFocusableElements(modalRef.current);
      if (elements.length === 0) {
        event.preventDefault();
        return;
      }

      const first = elements[0];
      const last = elements[elements.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (
        lastActiveElementRef.current &&
        typeof lastActiveElementRef.current.focus === "function"
      ) {
        lastActiveElementRef.current.focus();
      }
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const sizeClass =
    {
      sm: "ci-modal--sm",
      md: "ci-modal--md",
      lg: "ci-modal--lg",
    }[size] || "ci-modal--md";

  return (
    <div
      className="ci-modal-overlay"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <div
        className={`ci-modal ${sizeClass}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        ref={modalRef}
        tabIndex={-1}
      >
        {title ? (
          <h2 id={titleId} className="ci-modal-title">
            {title}
          </h2>
        ) : null}
        {children}
      </div>
    </div>
  );
}
