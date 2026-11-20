import type { ControllersState } from "@types";

import { db } from "../level";
import { levelKeys } from "./keys";

export const controllerProfilesSublevel = db.sublevel<
  string,
  ControllersState
>(levelKeys.controllerProfiles, {
  valueEncoding: "json",
});
