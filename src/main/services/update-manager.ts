export class UpdateManager {
  public static async checkForUpdates() {
    // Cerberus standalone does not connect to external Hydra update servers.
    return false;
  }
}
