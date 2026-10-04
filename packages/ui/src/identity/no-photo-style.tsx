"use client";

import { createContext, useContext, type ReactNode } from "react";

import type { NoPhotoStyle } from "./silhouette";

/**
 * The season's choice for players with no photo, handed down once (in the
 * season's layout) instead of threaded through forty call sites. Outside a
 * season — a page that mixes players from many — it is the default, initials.
 */
const NoPhotoStyleContext = createContext<NoPhotoStyle>("initials");

export function NoPhotoStyleProvider({
  style,
  children,
}: {
  style: NoPhotoStyle;
  children: ReactNode;
}) {
  return <NoPhotoStyleContext.Provider value={style}>{children}</NoPhotoStyleContext.Provider>;
}

export function useNoPhotoStyle(): NoPhotoStyle {
  return useContext(NoPhotoStyleContext);
}
