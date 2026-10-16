"use client";
import { useLayoutEffect, useRef } from "react";

/** Settlement may finish; a response from an earlier displayed room may not navigate it. */
export function useRoomPresentation(actorId: string, roomId: string) {
  const generation = useRef(0);
  useLayoutEffect(() => {
    generation.current++;
    return () => {
      generation.current++;
    };
  }, [actorId, roomId]);
  return {
    capture: () => generation.current,
    current: (captured: number) => generation.current === captured,
  };
}
