import type { NxCompatibleGame } from "@types";

import { db } from "../level";
import { levelKeys } from "./keys";

export interface NxCompatibilityCachePayload {
  games: NxCompatibleGame[];
  updatedAt: number;
  isOnline: boolean;
}

export const nxCompatibilityCacheSublevel = db.sublevel<
  string,
  NxCompatibilityCachePayload
>(levelKeys.nxCompatibilityCache, {
  valueEncoding: "json",
});
