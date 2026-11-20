import { useCallback } from "react";
import type { HydraCloudFeature } from "@types";

/**
 * Hydra Cloud subscription modal has been removed from Cerberus Launcher.
 */
export function useSubscription() {
  const showHydraCloudModal = useCallback((_feature?: HydraCloudFeature) => {
    // No-op: Hydra Cloud modal removed
  }, []);

  const hideHydraCloudModal = useCallback(() => {}, []);

  return {
    isHydraCloudModalVisible: false,
    hydraCloudFeature: null as HydraCloudFeature | null,
    showHydraCloudModal,
    hideHydraCloudModal,
  };
}
