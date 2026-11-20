import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { NxBuildJobEvent } from "@types";

export interface NxBuildJobState {
  activeJob: NxBuildJobEvent | null;
}

const initialState: NxBuildJobState = {
  activeJob: null,
};

export const nxBuildJobSlice = createSlice({
  name: "nxBuildJob",
  initialState,
  reducers: {
    setNxBuildJob: (state, action: PayloadAction<NxBuildJobEvent | null>) => {
      state.activeJob = action.payload;
    },
  },
});

export const { setNxBuildJob } = nxBuildJobSlice.actions;
