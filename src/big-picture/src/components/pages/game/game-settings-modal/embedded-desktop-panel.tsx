import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Button } from "../../../common";
import { useNavigation } from "../../../../hooks";
import "./embedded-desktop-panel.scss";

interface EmbeddedDesktopPanelProps {
  focusId: string;
  actionLabel?: string;
  helperText?: string;
  children: ReactNode;
}

const FOCUSABLE_SELECTOR = [
  "button:not(:disabled)",
  "a[href]",
  'input:not(:disabled):not([type="hidden"])',
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  '[role="button"]:not([aria-disabled="true"])',
].join(", ");

function getVisibleFocusableElements(root: HTMLElement | null): HTMLElement[] {
  if (!root) return [];
  const all = Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  return all.filter((el) => {
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return false;
    const style = globalThis.window.getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  });
}

function getActivePortalModal(): HTMLElement | null {
  const portals = Array.from(
    document.querySelectorAll<HTMLElement>(
      ".modal__content, .modal[role='dialog']"
    )
  ).filter((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  return portals.at(-1) ?? null;
}

export function EmbeddedDesktopPanel({
  focusId,
  actionLabel = "Navegar opções com controle",
  helperText = "D-pad ↑/↓ muda opção · A ativa · B retorna às abas",
  children,
}: Readonly<EmbeddedDesktopPanelProps>) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [engaged, setEngaged] = useState(false);
  const { setFocus } = useNavigation();

  const focusFirstControl = useCallback(() => {
    const scope = getActivePortalModal() || bodyRef.current;
    const focusables = getVisibleFocusableElements(scope);
    const first = focusables[0];
    if (first) {
      setEngaged(true);
      first.focus();
      first.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, []);

  const stepFocus = useCallback(
    (delta: 1 | -1) => {
      const scope = getActivePortalModal() || bodyRef.current;
      const focusables = getVisibleFocusableElements(scope);
      if (focusables.length === 0) return;

      const active = document.activeElement as HTMLElement | null;
      const idx = active ? focusables.indexOf(active) : -1;
      const nextIdx =
        idx === -1
          ? 0
          : (idx + delta + focusables.length) % focusables.length;
      const nextEl = focusables[nextIdx];
      nextEl.focus();
      nextEl.scrollIntoView({ block: "nearest", inline: "nearest" });
    },
    []
  );

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const active = document.activeElement as HTMLElement | null;
    const tag = active?.tagName.toLowerCase();

    if (event.key === "ArrowDown") {
      if (tag === "select" || tag === "textarea") return;
      event.preventDefault();
      event.stopPropagation();
      stepFocus(1);
    } else if (event.key === "ArrowUp") {
      if (tag === "select" || tag === "textarea") return;
      event.preventDefault();
      event.stopPropagation();
      stepFocus(-1);
    } else if (event.key === "Escape") {
      setEngaged(false);
      setFocus(focusId);
    }
  };

  useEffect(() => {
    const prevButtons = new Set<number>();
    let lastDirAt = 0;
    let rafId = 0;

    const tick = () => {
      const portalModal = getActivePortalModal();
      const activeEl = document.activeElement as HTMLElement | null;
      const insideBody = Boolean(
        activeEl && bodyRef.current?.contains(activeEl)
      );
      const activeInDesktopLayer = Boolean(portalModal) || insideBody || engaged;

      if (activeInDesktopLayer && document.hasFocus()) {
        const pads = navigator.getGamepads?.() ?? [];
        const pad = Array.from(pads).find((p) => p && p.connected);
        if (pad) {
          const isPressed = (idx: number) =>
            Boolean(pad.buttons[idx]?.pressed);
          const risingEdge = (idx: number) => {
            const pressed = isPressed(idx);
            const was = prevButtons.has(idx);
            if (pressed) prevButtons.add(idx);
            else prevButtons.delete(idx);
            return pressed && !was;
          };

          const now = performance.now();
          const up = isPressed(12) || (pad.axes[1] ?? 0) < -0.5;
          const down = isPressed(13) || (pad.axes[1] ?? 0) > 0.5;

          if ((up || down) && now - lastDirAt > 170) {
            lastDirAt = now;
            stepFocus(down ? 1 : -1);
          }

          if (risingEdge(0) && activeEl) {
            const tag = activeEl.tagName.toLowerCase();
            if (tag === "select") {
              const sel = activeEl as HTMLSelectElement;
              if (sel.options.length > 0) {
                sel.selectedIndex = (sel.selectedIndex + 1) % sel.options.length;
                sel.dispatchEvent(new Event("change", { bubbles: true }));
              }
            } else {
              activeEl.click();
            }
          }

          if (risingEdge(1)) {
            if (portalModal) {
              const closeBtn = portalModal.querySelector<HTMLElement>(
                ".modal__close-button"
              );
              closeBtn?.click();
            } else {
              setEngaged(false);
              setFocus(focusId);
            }
          }
        }
      }

      rafId = globalThis.window.requestAnimationFrame(tick);
    };

    rafId = globalThis.window.requestAnimationFrame(tick);
    return () => {
      globalThis.window.cancelAnimationFrame(rafId);
    };
  }, [engaged, focusId, setFocus, stepFocus]);

  return (
    <div
      className="bp-embedded-desktop-panel"
      onKeyDown={handleKeyDown}
    >
      <div className="bp-embedded-desktop-panel__entry-bar">
        <span>{helperText}</span>
        <Button
          focusId={focusId}
          variant="secondary"
          onClick={focusFirstControl}
        >
          {actionLabel}
        </Button>
      </div>

      <div
        ref={bodyRef}
        className="bp-embedded-desktop-panel__body"
        onFocus={() => setEngaged(true)}
      >
        {children}
      </div>
    </div>
  );
}
