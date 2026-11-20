import type { NxCloudAvailableGame } from "@types";

import { db } from "../level";
import { levelKeys } from "./keys";

export const nxCloudStreamsSublevel = db.sublevel<
  string,
  NxCloudAvailableGame[]
>(levelKeys.nxCloudStreams, {
  valueEncoding: "json",
});
