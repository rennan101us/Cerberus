import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { AppLogEntry } from "@types";

export interface LogsState {
  entries: AppLogEntry[];
}

const initialState: LogsState = {
  entries: [],
};

export const logsSlice = createSlice({
  name: "logs",
  initialState,
  reducers: {
    setLogs: (state, action: PayloadAction<AppLogEntry[]>) => {
      state.entries = action.payload.slice(-5000);
    },
    appendLog: (state, action: PayloadAction<AppLogEntry>) => {
      state.entries.push(action.payload);
      if (state.entries.length > 5000) {
        state.entries.splice(0, state.entries.length - 5000);
      }
    },
    clearLogsState: (state) => {
      state.entries = [];
    },
  },
});

export const { setLogs, appendLog, clearLogsState } = logsSlice.actions;
