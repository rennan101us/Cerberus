import type { MacCompatibilityReport } from "@types";

import { db } from "../level";
import { levelKeys } from "./keys";

export const macCompatibilityCacheSublevel = db.sublevel<
  string,
  MacCompatibilityReport
>(levelKeys.macCompatibilityCache, {
  valueEncoding: "json",
});
