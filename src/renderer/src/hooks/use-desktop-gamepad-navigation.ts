import { useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAppSelector } from "./redux";

type NavDirection = "up" | "down" | "left" | "right";

const FOCUSABLE_SELECTOR = [
  "button:not(:disabled)",
  "a[href]",
  'input:not(:disabled):not([type="hidden"])',
  "select:not(:disabled)",
  "textarea:not(:disabled)",
  '[role="button"]:not([aria-disabled="true"])',
  '[role="tab"]:not([aria-disabled="true"])',
  '[tabindex]:not([tabindex="-1"]):not(:disabled)',
].join(", ");

const TAB_SELECTOR = [
  ".game-options-modal__sidebar-button",
  ".settings__sidebar-button",
  ".settings__tab",
  ".catalogue__tab",
  '[role="tab"]',
].join(", ");

function isElementVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const style = globalThis.window.getComputedStyle(el);
  return (
    style.visibility !== "hidden" &&
    style.display !== "none" &&
    style.pointerEvents !== "none"
  );
}

function getTopModalRoot(): HTMLElement | null {
  const modals = Array.from(
    document.querySelectorAll<HTMLElement>(
      '[role="dialog"], .modal__content, .modal'
    )
  ).filter(isElementVisible);
  return modals.at(-1) ?? null;
}

function getFocusableElements(scope: HTMLElement): HTMLElement[] {
  return Array.from(scope.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    isElementVisible
  );
}

function findNextSpatialTarget(
  current: HTMLElement | null,
  candidates: HTMLElement[],
  dir: NavDirection
): HTMLElement | null {
  if (candidates.length === 0) return null;
  if (!current || !candidates.includes(current)) {
    return candidates[0];
  }

  const from = current.getBoundingClientRect();
  const fromCx = from.left + from.width / 2;
  const fromCy = from.top + from.height / 2;

  let best: HTMLElement | null = null;
  let bestScore = Number.POSITIVE_INFINITY;

  for (const el of candidates) {
    if (el === current) continue;
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const dx = cx - fromCx;
    const dy = cy - fromCy;

    let primary = 0;
    let cross = 0;

    if (dir === "up") {
      if (dy >= -2) continue;
      primary = -dy;
      cross = Math.abs(dx);
    } else if (dir === "down") {
      if (dy <= 2) continue;
      primary = dy;
      cross = Math.abs(dx);
    } else if (dir === "left") {
      if (dx >= -2) continue;
      primary = -dx;
      cross = Math.abs(dy);
    } else {
      if (dx <= 2) continue;
      primary = dx;
      cross = Math.abs(dy);
    }

    const score = primary + cross * 2.5;
    if (score < bestScore) {
      bestScore = score;
      best = el;
    }
  }

  return best;
}

function findScrollContainer(start: HTMLElement | null): HTMLElement | Element | null {
  let node = start;
  while (node && node !== document.body) {
    const style = globalThis.window.getComputedStyle(node);
    const canScroll =
      (style.overflowY === "auto" || style.overflowY === "scroll") &&
      node.scrollHeight > node.clientHeight + 4;
    if (canScroll) return node;
    node = node.parentElement;
  }

  const content = document.querySelector(".container__content");
  if (content && content.scrollHeight > content.clientHeight + 4) {
    return content;
  }

  return document.scrollingElement;
}

/**
 * Enables full Xbox / DualSense / Switch / Steam Controller spatial navigation
 * across the desktop Cerberus UI whenever Big Picture mode and launched games are not active.
 */
export function useDesktopGamepadNavigation(): void {
  const location = useLocation();
  const navigate = useNavigate();
  const isGameRunning = useAppSelector((state) =>
    Boolean(state.gameRunning.gameRunning)
  );

  useEffect(() => {
    const clearClass = () => {
      document.body.classList.remove("gamepad-nav-active");
    };
    globalThis.window.addEventListener("mousemove", clearClass, {
      passive: true,
    });
    globalThis.window.addEventListener("mousedown", clearClass, {
      passive: true,
    });
    return () => {
      globalThis.window.removeEventListener("mousemove", clearClass);
      globalThis.window.removeEventListener("mousedown", clearClass);
    };
  }, []);

  useEffect(() => {
    if (location.pathname.startsWith("/big-picture") || isGameRunning) {
      document.body.classList.remove("gamepad-nav-active");
      return;
    }

    const prevButtons = new Set<number>();
    let lastDirKey: NavDirection | null = null;
    let lastDirTriggerAt = 0;
    let firstDirHoldAt = 0;
    let rafId = 0;

    const tick = () => {
      if (!document.hasFocus()) {
        rafId = globalThis.window.requestAnimationFrame(tick);
        return;
      }

      const pads = navigator.getGamepads?.() ?? [];
      const pad = Array.from(pads).find((p) => p && p.connected);

      if (pad) {
        const isPressed = (idx: number) => Boolean(pad.buttons[idx]?.pressed);
        const risingEdge = (idx: number) => {
          const pressed = isPressed(idx);
          const was = prevButtons.has(idx);
          if (pressed) prevButtons.add(idx);
          else prevButtons.delete(idx);
          return pressed && !was;
        };

        const lx = pad.axes[0] ?? 0;
        const ly = pad.axes[1] ?? 0;

        let dir: NavDirection | null = null;
        if (isPressed(12) || ly < -0.45) dir = "up";
        else if (isPressed(13) || ly > 0.45) dir = "down";
        else if (isPressed(14) || lx < -0.45) dir = "left";
        else if (isPressed(15) || lx > 0.45) dir = "right";

        const now = performance.now();
        if (dir) {
          const delay =
            lastDirKey !== dir
              ? 0
              : now - firstDirHoldAt < 320
                ? 320
                : 110;
          if (lastDirKey !== dir || now - lastDirTriggerAt >= delay) {
            if (lastDirKey !== dir) {
              firstDirHoldAt = now;
            }
            lastDirKey = dir;
            lastDirTriggerAt = now;

            const scope = getTopModalRoot() || document.body;
            const candidates = getFocusableElements(scope);
            const active = document.activeElement as HTMLElement | null;
            const next = findNextSpatialTarget(active, candidates, dir);
            if (next) {
              document.body.classList.add("gamepad-nav-active");
              next.focus({ preventScroll: true });
              next.scrollIntoView({ block: "nearest", inline: "nearest" });
            }
          }
        } else {
          lastDirKey = null;
        }

        // A button -> activate focused element
        if (risingEdge(0)) {
          document.body.classList.add("gamepad-nav-active");
          const scope = getTopModalRoot() || document.body;
          const active = document.activeElement as HTMLElement | null;
          if (!active || !scope.contains(active) || active === document.body) {
            const first = getFocusableElements(scope)[0];
            first?.focus({ preventScroll: true });
          } else if (active.tagName.toLowerCase() === "select") {
            const sel = active as HTMLSelectElement;
            if (sel.options.length > 0) {
              sel.selectedIndex = (sel.selectedIndex + 1) % sel.options.length;
              sel.dispatchEvent(new Event("change", { bubbles: true }));
            }
          } else {
            active.click();
          }
        }

        // B button -> close topmost modal or navigate back
        if (risingEdge(1)) {
          document.body.classList.add("gamepad-nav-active");
          const modal = getTopModalRoot();
          if (modal) {
            document.dispatchEvent(
              new KeyboardEvent("keydown", {
                key: "Escape",
                code: "Escape",
                bubbles: true,
                cancelable: true,
              })
            );
            const closeBtn = modal.querySelector<HTMLElement>(
              ".modal__close-button"
            );
            closeBtn?.click();
          } else {
            navigate(-1);
          }
        }

        // LB (4) / RB (5) -> cycle tabs
        const cycleLeft = risingEdge(4);
        const cycleRight = risingEdge(5);
        if (cycleLeft || cycleRight) {
          const scope = getTopModalRoot() || document.body;
          const tabs = Array.from(
            scope.querySelectorAll<HTMLElement>(TAB_SELECTOR)
          ).filter(isElementVisible);
          if (tabs.length > 1) {
            document.body.classList.add("gamepad-nav-active");
            const activeIdx = tabs.findIndex(
              (tab) =>
                tab.className.includes("--active") ||
                tab.getAttribute("aria-selected") === "true" ||
                tab === document.activeElement
            );
            const delta = cycleRight ? 1 : -1;
            const baseIdx = activeIdx === -1 ? 0 : activeIdx;
            const nextTab = tabs[(baseIdx + delta + tabs.length) % tabs.length];
            nextTab.focus({ preventScroll: true });
            nextTab.click();
          }
        }

        // Right stick vertical -> smooth scroll
        const ry = pad.axes[3] ?? 0;
        if (Math.abs(ry) > 0.25) {
          const container = findScrollContainer(
            document.activeElement as HTMLElement | null
          );
          if (container) {
            container.scrollTop += Math.round(ry * 18);
          }
        }
      }

      rafId = globalThis.window.requestAnimationFrame(tick);
    };

    rafId = globalThis.window.requestAnimationFrame(tick);
    return () => {
      globalThis.window.cancelAnimationFrame(rafId);
    };
  }, [isGameRunning, location.pathname, navigate]);
}
