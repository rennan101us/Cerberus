import fs from "node:fs";
import path from "node:path";
import type {
  CrossOverTool,
  CrossOverToolDownloadProgress,
  CrossOverToolWithStatus,
} from "@types";
import { CrossOverDetector, DEFAULT_BOTTLE_NAME } from "./crossover-detector";
import { CrossOverProvisioner } from "./crossover-provisioner";
import { CrossOverRunner } from "./crossover-runner";
import { downloadToFile, removeFileQuietly } from "../download-to-file";
import { CerberusPathsService } from "../cerberus-paths";
import { logger } from "../logger";

export const CROSSOVER_TOOLS: CrossOverTool[] = [
  {
    id: "steam",
    name: "Steam (Windows)",
    description:
      "Cliente oficial da Valve para Windows. Ideal para instalar e executar jogos exclusivos de Windows com suporte a D3DMetal e DXMT.",
    category: "storefront",
    bottleName: DEFAULT_BOTTLE_NAME,
    downloadUrl:
      "https://cdn.cloudflare.steamstatic.com/client/installer/SteamSetup.exe",
    installerFilename: "SteamSetup.exe",
    installedExecutables: [
      "drive_c/Program Files (x86)/Steam/steam.exe",
      "drive_c/Program Files/Steam/steam.exe",
    ],
    officialUrl: "https://store.steampowered.com/about/",
  },
  {
    id: "epic",
    name: "Epic Games Launcher",
    description:
      "Launcher oficial da Epic Games para Windows. Acesse sua biblioteca Epic, jogos grátis semanais e títulos Unreal Engine no macOS.",
    category: "storefront",
    bottleName: DEFAULT_BOTTLE_NAME,
    downloadUrl:
      "https://launcher-public-service-prod06.ol.epicgames.com/launcher/api/installer/download/EpicGamesLauncherInstaller.msi",
    installerFilename: "EpicGamesLauncherInstaller.msi",
    installedExecutables: [
      "drive_c/Program Files (x86)/Epic Games/Launcher/Portal/Binaries/Win64/EpicGamesLauncher.exe",
      "drive_c/Program Files (x86)/Epic Games/Launcher/Portal/Binaries/Win32/EpicGamesLauncher.exe",
      "drive_c/Program Files/Epic Games/Launcher/Portal/Binaries/Win64/EpicGamesLauncher.exe",
    ],
    officialUrl: "https://store.epicgames.com/",
  },
  {
    id: "gog",
    name: "GOG Galaxy",
    description:
      "Plataforma livre de DRM da CD Projekt. Instale jogos GOG com saves em nuvem e atualizações automáticas via Red Wine.",
    category: "storefront",
    bottleName: DEFAULT_BOTTLE_NAME,
    downloadUrl:
      "https://webinstallers.gog-statics.com/download/GOG_Galaxy_Setup.exe",
    installerFilename: "GOG_Galaxy_Setup.exe",
    installedExecutables: [
      "drive_c/Program Files (x86)/GOG Galaxy/GalaxyClient.exe",
      "drive_c/Program Files/GOG Galaxy/GalaxyClient.exe",
    ],
    officialUrl: "https://www.gog.com/galaxy",
  },
  {
    id: "battlenet",
    name: "Battle.net",
    description:
      "Plataforma da Blizzard Entertainment para Diablo IV, World of Warcraft, Overwatch 2, Call of Duty e StarCraft.",
    category: "storefront",
    bottleName: DEFAULT_BOTTLE_NAME,
    downloadUrl:
      "https://www.battle.net/download/getInstallerForGame?os=win&gameProgram=BATTLENET_APP&version=Live",
    installerFilename: "Battle.net-Setup.exe",
    installedExecutables: [
      "drive_c/Program Files (x86)/Battle.net/Battle.net Launcher.exe",
      "drive_c/Program Files (x86)/Battle.net/Battle.net.exe",
    ],
    officialUrl: "https://www.battle.net/",
  },
  {
    id: "ea",
    name: "EA App",
    description:
      "Plataforma oficial da Electronic Arts para EA Sports FC, Battlefield, Star Wars Jedi, The Sims e Need for Speed.",
    category: "storefront",
    bottleName: DEFAULT_BOTTLE_NAME,
    downloadUrl:
      "https://origin-a.akamaihd.net/EA-Desktop-Client-Download/installer-releases/EAappInstaller.exe",
    installerFilename: "EAappInstaller.exe",
    installedExecutables: [
      "drive_c/Program Files/Electronic Arts/EA Desktop/EA Desktop/EADesktop.exe",
      "drive_c/Program Files/Electronic Arts/EA Desktop/EA Desktop/EALauncher.exe",
    ],
    officialUrl: "https://www.ea.com/ea-app",
  },
  {
    id: "ubisoft",
    name: "Ubisoft Connect",
    description:
      "Ecossistema PC da Ubisoft para Assassin's Creed, Far Cry, Rainbow Six, Anno e The Division.",
    category: "storefront",
    bottleName: DEFAULT_BOTTLE_NAME,
    downloadUrl: "https://ubi.li/4vxt9",
    installerFilename: "UbisoftConnectInstaller.exe",
    installedExecutables: [
      "drive_c/Program Files (x86)/Ubisoft/Ubisoft Game Launcher/UbisoftConnect.exe",
      "drive_c/Program Files (x86)/Ubisoft/Ubisoft Game Launcher/upc.exe",
    ],
    officialUrl: "https://ubisoftconnect.com/",
  },
  {
    id: "rockstar",
    name: "Rockstar Games Launcher",
    description:
      "Cliente oficial da Rockstar Games para Grand Theft Auto V, Red Dead Redemption 2 e clássicos da franquia.",
    category: "storefront",
    bottleName: DEFAULT_BOTTLE_NAME,
    downloadUrl:
      "https://gamedownloads.rockstargames.com/public/installer/Rockstar-Games-Launcher.exe",
    installerFilename: "Rockstar-Games-Launcher.exe",
    installedExecutables: [
      "drive_c/Program Files/Rockstar Games/Launcher/LauncherPatcher.exe",
      "drive_c/Program Files/Rockstar Games/Launcher/Launcher.exe",
    ],
    officialUrl: "https://socialclub.rockstargames.com/rockstar-games-launcher",
  },
];

export class CrossOverToolsService {
  private static async getToolsCacheDir(): Promise<string> {
    return CerberusPathsService.getCrossOverToolsCacheDir();
  }

  public static findToolById(toolId: string): CrossOverTool | undefined {
    return CROSSOVER_TOOLS.find((tool) => tool.id === toolId);
  }

  private static findInstalledExecutable(
    bottlesDir: string,
    tool: CrossOverTool
  ): { executablePath: string | null; bottleExists: boolean } {
    const bottleDir = path.join(bottlesDir, tool.bottleName);
    const bottleExists = fs.existsSync(path.join(bottleDir, "cxbottle.conf"));

    if (!bottleExists) {
      return { executablePath: null, bottleExists: false };
    }

    for (const relPath of tool.installedExecutables) {
      const fullPath = path.join(bottleDir, relPath);
      if (fs.existsSync(fullPath)) {
        return { executablePath: fullPath, bottleExists: true };
      }
    }

    return { executablePath: null, bottleExists: true };
  }

  public static async getToolsWithStatus(): Promise<CrossOverToolWithStatus[]> {
    const bottlesDir =
      process.platform === "darwin"
        ? await CrossOverDetector.getBottlesDirectory().catch(() => null)
        : null;

    return CROSSOVER_TOOLS.map((tool) => {
      if (!bottlesDir) {
        return {
          ...tool,
          installed: false,
          executablePath: null,
          bottleExists: false,
        };
      }

      const { executablePath, bottleExists } = this.findInstalledExecutable(
        bottlesDir,
        tool
      );

      return {
        ...tool,
        installed: Boolean(executablePath),
        executablePath,
        bottleExists,
      };
    });
  }

  public static async downloadAndInstallTool(
    toolId: string,
    onProgress?: (progress: CrossOverToolDownloadProgress) => void
  ): Promise<{ success: boolean; error?: string }> {
    const tool = this.findToolById(toolId);
    if (!tool) {
      return { success: false, error: `Ferramenta desconhecida: ${toolId}` };
    }

    if (process.platform !== "darwin") {
      return {
        success: false,
        error: "A instalação de ferramentas Red Wine está disponível no macOS.",
      };
    }

    const appPath = CrossOverDetector.findCrossOverApp();
    if (!appPath) {
      return {
        success: false,
        error:
          "Red Wine não encontrado. Instale o motor Red Wine antes de baixar ferramentas.",
      };
    }

    const cacheDir = await this.getToolsCacheDir();
    const installerPath = path.join(cacheDir, tool.installerFilename);

    try {
      await fs.promises.mkdir(cacheDir, { recursive: true });

      onProgress?.({
        toolId,
        phase: "downloading",
        progress: 0,
        message: `Baixando instalador de ${tool.name}...`,
      });

      await downloadToFile(tool.downloadUrl, installerPath, (loaded, total) => {
        const pct =
          total && total > 0 ? Math.min(99, Math.round((loaded / total) * 100)) : 50;
        onProgress?.({
          toolId,
          phase: "downloading",
          progress: pct,
          loadedBytes: loaded,
          totalBytes: total,
          message: `Baixando ${tool.name}...`,
        });
      });

      onProgress?.({
        toolId,
        phase: "preparing_bottle",
        progress: 100,
        message: `Preparando garrafa '${tool.bottleName} (Default)' no Red Wine...`,
      });

      await CrossOverProvisioner.ensureBottle(tool.bottleName);

      onProgress?.({
        toolId,
        phase: "installing",
        progress: 100,
        message: `Iniciando instalador de ${tool.name} via Red Wine...`,
      });

      await CrossOverRunner.executeInstaller({
        installerPath,
        bottleName: tool.bottleName,
        compatibility: {
          bottleName: tool.bottleName,
          graphicsBackend: "d3dmetal",
          syncMode: "msync",
          rosettaAvx: true,
        },
        onExit: () => {
          logger.info(
            `[RedWineTools] Installer finished for '${tool.name}' in bottle '${tool.bottleName}'`
          );
        },
      });

      onProgress?.({
        toolId,
        phase: "done",
        progress: 100,
        message: `Instalador de ${tool.name} aberto no Red Wine.`,
      });

      return { success: true };
    } catch (error) {
      await removeFileQuietly(installerPath);
      const message =
        error instanceof Error
          ? error.message
          : `Falha ao instalar ${tool.name}`;
      logger.error(`[RedWineTools] Failed to install ${tool.name}`, error);
      onProgress?.({
        toolId,
        phase: "error",
        progress: 0,
        error: message,
      });
      return { success: false, error: message };
    }
  }

  public static async launchTool(
    toolId: string
  ): Promise<{ success: boolean; error?: string }> {
    const tool = this.findToolById(toolId);
    if (!tool) {
      return { success: false, error: `Ferramenta desconhecida: ${toolId}` };
    }

    if (process.platform !== "darwin") {
      return {
        success: false,
        error: "Ferramentas Red Wine são executadas apenas no macOS.",
      };
    }

    const bottlesDir = await CrossOverDetector.getBottlesDirectory();
    const { executablePath } = this.findInstalledExecutable(bottlesDir, tool);

    if (!executablePath) {
      return {
        success: false,
        error: `${tool.name} ainda não está instalado na garrafa '${tool.bottleName}'.`,
      };
    }

    try {
      await CrossOverRunner.executeInstaller({
        installerPath: executablePath,
        bottleName: tool.bottleName,
        compatibility: {
          bottleName: tool.bottleName,
          graphicsBackend: "d3dmetal",
          syncMode: "msync",
          rosettaAvx: true,
        },
      });
      return { success: true };
    } catch (error) {
      const message =
        error instanceof Error ? error.message : `Falha ao abrir ${tool.name}`;
      logger.error(`[RedWineTools] Failed to launch ${tool.name}`, error);
      return { success: false, error: message };
    }
  }
}
