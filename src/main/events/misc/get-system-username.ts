import os from "node:os";

import { registerEvent } from "../register-event";

const getSystemUsername = async () => {
  try {
    const username = os.userInfo().username?.trim();
    if (username) return username;
  } catch {
    // ignore OS lookup error
  }
  return "Jogador";
};

registerEvent("getSystemUsername", getSystemUsername);
