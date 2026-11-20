---
title: Cerberus Linux, Proton and UMU - Unified Launcher, Wine Prefixes & Wayland
tags:
  - cerberus
  - linux
  - proton
  - umu
  - wine
  - wayland
  - gamemode
aliases:
  - Linux and Proton
  - UMU Launcher
  - Linux Compatibility Layer
---

# Cerberus Linux, Proton & UMU Integration

Esta nota detalha a infraestrutura de execução e compatibilidade de jogos para distribuições **Linux** na plataforma **Cerberus**, cobrindo o integrador **UMU (Unified Linux Launcher)**, o runtime **Proton / Proton-GE**, o isolamento de prefixos Wine, utilitários de desempenho e suporte nativo a Wayland.

Retornar ao Hub: [[00_Cerberus_MOC]]

---

## 🐧 O Ecossistema de Compatibilidade Linux

No Linux, a execução de títulos Windows sem cliente Steam depende da padronização de ambientes de execução. O Cerberus resolve isso utilizando o **UMU** (`src/main/services/umu.ts`), que orquestra a injeção do Proton da Valve ou Proton-GE da comunidade para qualquer jogo avulso adicionado à biblioteca:

```
+-------------------------------------------------------------+
|                Cerberus Main Process (Linux)                |
|                    src/main/helpers/launch-game.ts          |
+------------------------------+------------------------------+
                               |
                               v
+-------------------------------------------------------------+
|                     UMU Service (umu.ts)                    |
|  - Supervisão de processos: umu-supervised-process.ts       |
|  - Monitoramento de saída e logs: umu-output-monitor.ts     |
|  - Atualizador e downloader: umu-updater.ts                 |
+------------------------------+------------------------------+
                               |
            +------------------+------------------+
            |                                     |
            v                                     v
+-----------------------+             +-----------------------+
|   Proton / Proton-GE  |             |  Ferramentas Extras   |
| - DXVK (Vulkan DX9-11)|             | - GameMode (Feral)    |
| - VKD3D-Proton (DX12) |             | - MangoHud (Overlay)  |
| - Wine Prefix isolado |             | - Winetricks DLLs     |
+-----------------------+             +-----------------------+
```

---

## ⚙️ 1. UMU (Unified Linux Launcher)

O UMU é mantido pelo time do GloriousEggroll / Open-Wine-Components e atua como uma ponte universal entre o Proton e executáveis não-Steam:

- **Resolução Automática de Proton**: Identifica instalações locais de Proton (instaladas via Steam, Lutris ou Heroic) ou baixa versões Proton-GE otimizadas.
- **Preparação de Prefixo (`umu-prefix-preparation.ts`)**: Cria um diretório de prefixo Wine isolado para cada jogo em `~/.local/share/hydra/prefixes/<game-id>`, evitando que alterações de registro ou instalação de dependências de um jogo interfiram em outros.
- **Supervisão Contínua (`umu-supervised-process.ts`)**: Mantém a árvore de processos sob monitoramento constante via `/proc` para alimentar o `ProcessWatcher`. Veja [[Cerberus_Library_and_Game_Management]].

---

## 🛠️ 2. Otimizações de Desempenho e Ferramentas

O Cerberus oferece alternadores integrados na interface por jogo:

1. **GameMode (`gamemoderun`)**:
   - Ajusta o governador de CPU para `performance`, eleva a prioridade de I/O de disco e otimiza a alocação de threads no kernel do Linux.
2. **MangoHud**:
   - Injeta o overlay Vulkan/OpenGL com métricas de taxa de quadros, temperaturas de CPU/GPU, uso de memória RAM/VRAM e frametimes.
3. **Winetricks (`wine-prefix.ts`)**:
   - Permite a instalação com um clique de dependências comuns do Windows necessárias para inicialização de jogos antigos (DirectX 9, fontes corefonts, Visual C++ Runtimes, dotnet48).

---

## 🖥️ 3. Integração Wayland & Flatpak

O Cerberus é totalmente compatível com ambientes de desktop modernos no Linux (GNOME e KDE Plasma sob Wayland):

- **Ozone Platform Hint**: Configura `app.commandLine.appendSwitch("ozone-platform-hint", "auto")` para permitir renderização nativa em Wayland sem passar pelo XWayland (`src/main/index.ts:87`).
- **Global Shortcuts Portal**: Ativa o suporte ao portal XDG Desktop para captura de atalhos globais de teclado e controles mesmo quando o Cerberus estiver em segundo plano.
- **Screencast Portal**: Suporte para captura de tela de conquistas e streaming local através do portal PipeWire do Wayland.

---

## 🔗 Relações no Grafo

- **Hub Central**: [[00_Cerberus_MOC]]
- **Arquitetura Base**: [[Cerberus_Architecture_and_Runtime]]
- **Biblioteca de Jogos**: [[Cerberus_Library_and_Game_Management]]
- **Build & Packaging**: [[Cerberus_Build_Packaging_and_CI]]
- **Comparativo com macOS**: [[Cerberus_macOS_and_FineWine]]
