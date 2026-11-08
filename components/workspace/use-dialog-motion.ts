"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";

/** Critically damped surface motion. Retargets preserve position and velocity. */
export function useDialogMotion(ref: RefObject<HTMLDivElement | null>, onClose: () => void) {
  const close = useRef(onClose);
  close.current = onClose;
  const control = useRef<(target: number) => void>(() => {});
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    let position = 0, velocity = 0, target = 1, frame = 0, previous = 0;
    const render = () => {
      element.style.opacity = String(Math.max(0, Math.min(1, position)));
      element.style.transform = reduced.matches ? "none" : `translateY(${12 * (1-position)}px) scale(${.97 + .03 * position})`;
    };
    const tick = (now: number) => {
      const dt = Math.min((now - previous) / 1000 || 1 / 60, .032);
      previous = now;
      if (reduced.matches) {
        position = target;
        velocity = 0;
      } else {
        // Exact critically damped solution; stable even after a background tab.
        const delta = position - target, omega = 28;
        const impulse = velocity + omega * delta, decay = Math.exp(-omega * dt);
        position = target + (delta + impulse * dt) * decay;
        velocity = (velocity - omega * impulse * dt) * decay;
      }
      render();
      if (Math.abs(position-target) < .001 && Math.abs(velocity) < .01) {
        position = target;
        render();
        frame = 0;
        if (target === 0) close.current();
      } else frame = requestAnimationFrame(tick);
    };
    control.current = (next) => {
      target = next;
      if (!frame) { previous = performance.now(); frame = requestAnimationFrame(tick); }
    };
    render();
    control.current(1);
    return () => {
      cancelAnimationFrame(frame);
      control.current = () => {};
      element.style.removeProperty("opacity");
      element.style.removeProperty("transform");
    };
  }, [ref]);
  return {
    dismiss: useCallback(() => control.current(0), []),
    resume: useCallback(() => control.current(1), []),
  };
}
