---
title: Cerberus Architecture and Runtime - Process Model, IPC & Persistence
tags:
  - cerberus
  - architecture
  - electron
  - runtime
  - leveldb
  - ipc
aliases:
  - Architecture and Runtime
  - Process Model
  - Core Runtime
---

# Cerberus Architecture & Runtime

Esta nota documenta o modelo de execução, o ciclo de vida de inicialização, a comunicação entre processos (IPC) e a camada de persistência local da plataforma **Cerberus**.

Retornar ao Hub: [[00_Cerberus_MOC]]

---

## 🏛️ Modelo Multi-Processo (Electron Process Model)

O Cerberus adota a arquitetura de segregação estrita de processos do Electron para garantir estabilidade, isolamento de falhas de renderização e segurança de acesso ao sistema de arquivos:

```
+--------------------------------------------------------------------+
|                        Main Process (Node.js)                      |
|  - src/main/index.ts & src/main/main.ts                            |
|  - LevelDB (classic-level) & IPC Dispatcher                        |
|  - ProcessWatcher, Services (CrossOver, Torrent, Steam, etc.)      |
+-------------------+--------------------------------+---------------+
                    |                                |
       (Preload IPC Bridge)             (Preload IPC Bridge)
                    |                                |
+-------------------v----------------+   +-----------v---------------+
|        Renderer Window (React)     |   |     Big Picture Window    |
|  - src/renderer/src/app.tsx        |   |  - src/big-picture        |
|  - Redux Toolkit, Virtualization   |   |  - Gamepad Navigation     |
|  - Monaco Themes, Radix UI         |   |  - 10-foot UI Experience  |
+------------------------------------+   +---------------------------+
```

### 1. Main Process (`src/main/index.ts`)
- É o processo pai com privilégios completos de sistema operacional.
- Inicializa os subsistemas de compatibilidade de SO:
  - No macOS: dispara `CrossOverProvisioner.resetTrial()`, `CrossOverDiscovery.autoImportBottleGames()` e `CrossOverDiscovery.enrichLibraryArtwork()`. Veja [[Cerberus_macOS_and_FineWine]].
  - No Linux: configura switches de renderização Ozone Wayland e portal de atalhos globais. Veja [[Cerberus_Linux_Proton_and_UMU]].
- Orquestra os addons nativos em Rust/C++ (`hydra-native`). Veja [[Cerberus_Torrent_and_Native_Engine]].
- Mantém o ciclo de vida das janelas via `WindowManager` (`src/main/services/window-manager.ts`).

### 2. Preload Scripts (`src/preload/index.ts`)
- Executado em um contexto com acesso limitado, utiliza `contextBridge.exposeInMainWorld("electron", ...)` para publicar de forma tipada e segura as APIs para o Renderer.
- Não expõe diretamente o módulo `fs` ou `child_process` para a web, apenas métodos estruturados de invocação de eventos IPC (`ipcRenderer.invoke` e `ipcRenderer.send`).

### 3. Renderer Processes (`src/renderer` & `src/big-picture`)
- Processos de interface baseados em Chromium.
- Operam com Redux Toolkit para estado de interface e reatividade rápida. Veja [[Cerberus_UI_Renderer_and_Themes]].
- O Cerberus suporta tanto o modo de desktop tradicional quanto o modo console de TV via rota dedicada `dev:big-picture`.

---

## 🔒 Protocolos Customizados Seguros

Para permitir que a interface exiba com alta performance ativos locais (capas de jogos, ícones, banners) sem desabilitar o isolamento web (CORS e web security), o Cerberus registra esquemas privilegiados:

1. **`local://`**:
   - Mapeado diretamente para o sistema de arquivos local (`src/main/index.ts:134`).
   - Usa `net.fetch(url.pathToFileURL(filePath))` para transmitir imagens de capa em streaming nativo sem carregar arquivos inteiros em buffers de memória no Node.js.
2. **`gradient://`**:
   - Um gerador de SVG inline vetorizado para planos de fundo e placeholders quando o jogo não possui arte configurada, com proteção contra ReDoS (`src/main/index.ts:139`).

---

## 💾 Camada de Persistência Local: LevelDB (`classic-level`)

Em vez de bancos relacionais pesados ou arquivos JSON monolíticos sujeitos a corrupção em caso de fechamento abrupto, o Cerberus emprega o **LevelDB** compilado nativamente (`classic-level`):

- **Localização**: `userData/hydra-db` (gerenciado em `src/main/level/index.ts`).
- **Sub-níveis (Sublevels)**:
  - `gamesSublevel`: Armazena todos os registros do tipo `Game` da biblioteca do usuário.
  - `gamesShopAssetsSublevel`: Armazena o cache de assets e imagens de catálogo (heróis, logos, ícones, screenshots).
- **Chaves de Configuração (`levelKeys`)**:
  - `language`: Idioma ativo do launcher.
  - `userPreferences`: Preferências de interface, diretórios de download e opções gráficas.
  - `downloadsQueue`: Fila de downloads persistente para retomada após reinicialização.

Essa estrutura leve e transacional foi fundamental para viabilizar a evolução para o modo **standalone** do Cerberus, conforme detalhado em [[Cerberus_Standalone_Evolution]].

---

## 📡 Barramento de Eventos IPC

O Cerberus organiza a comunicação IPC em módulos claros dentro de `src/main/events`:

| Módulo | Responsabilidade | Conexão de Grafo |
| :--- | :--- | :--- |
| `events/library/*` | Adição de jogos customizados, abertura de instaladores, scans locais e lançamento | [[Cerberus_Library_and_Game_Management]] |
| `events/catalogue/*` | Busca de informações na base de dados de jogos e recuperação de assets | [[Cerberus_Storefront_Integrations]] |
| `events/download/*` | Controles de pausa, cancelamento e monitoramento de velocidade de download | [[Cerberus_Torrent_and_Native_Engine]] |
| `events/hardware/*` | Monitoramento de bateria, temperatura e status de controle | [[Cerberus_UI_Renderer_and_Themes]] |

---

## 🔗 Relações no Grafo
- **Hub Central**: [[00_Cerberus_MOC]]
- **Execução macOS**: [[Cerberus_macOS_and_FineWine]]
- **Execução Linux**: [[Cerberus_Linux_Proton_and_UMU]]
- **Gerenciamento de Biblioteca**: [[Cerberus_Library_and_Game_Management]]
- **Evolução Standalone**: [[Cerberus_Standalone_Evolution]]
