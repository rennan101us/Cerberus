---
title: Cerberus Emulation & RetroClassics - ROM Matching, Emulators & Recomps
tags:
  - cerberus
  - emulation
  - retroarch
  - rpcs3
  - pcsx2
  - duckstation
  - dolphin
  - recomps
aliases:
  - Emulation and RetroClassics
  - Cerberus Classics
  - Emulator Hub
---

# Cerberus Emulation & RetroClassics

Esta nota documenta o subsistema **Cerberus Classics** (`src/main/services/emulators/`), projetado para integrar a biblioteca de consoles clássicos ao mesmo padrão de qualidade e conveniência dos jogos de PC modernos.

Retornar ao Hub: [[00_Cerberus_MOC]]

---

## 🎮 1. O Ecossistema Cerberus Classics

Ao contrário de interfaces tradicionais de emuladores que demandam configuração manual de listas de arquivos para cada sistema, o Cerberus unifica tudo em um pipeline automatizado:
1. O usuário aponta diretórios contendo ROMs ou imagens de disco (`.iso`, `.chd`, `.rvz`, `.bin/.cue`, `.pkg`).
2. O Cerberus calcula hashes rápidos de cabeçalho e consulta bases de metadados públicas para identificar o jogo, desenvolvedor, ano de lançamento e gênero.
3. Baixa capas verticais e logos em alta resolução.
4. Vincula a execução a um clique com o emulador correspondente instalado no sistema operacional.

---

## 🕹️ 2. Emuladores Standalone Suportados

O módulo `src/main/services/emulators/` suporta descoberta e configuração automática para:

| Emulador | Plataforma Alvo | Recursos Especiais |
| :--- | :--- | :--- |
| **DuckStation** | PlayStation 1 | Up-scaling de resolução interna, correção de distorção de textura PGXP. |
| **PCSX2** | PlayStation 2 | Suporte a renderizadores Vulkan/Metal, patches de 60 FPS automáticos. |
| **RPCS3** | PlayStation 3 | Rastreamento local de troféus e compatibilidade de firmware. |
| **shadPS4** | PlayStation 4 | Emulador moderno em rápido desenvolvimento para jogos de PS4. |
| **PPSSPP** | PlayStation Portable | Filtros de pós-processamento e texturas em alta definição. |
| **Dolphin** | GameCube & Wii | Suporte a controles reais do Wii e packs de texturas HD. |
| **RetroArch** | Multi-sistemas | Orquestração de cores Libretro (SNES, Mega Drive, GBA, Arcade) via IPC. |

---

## 🔄 3. Recompilações Estáticas (PC Recomps)

Uma das inovações mais recentes integradas ao Cerberus é o suporte aos **Community PC Recomps** (`recompilationGameSessions` em `src/main/services/game-running-state.ts`):
- Em vez de emular instruções de hardware ciclo a ciclo, recompiladores modernos (como o projeto *Zelda 64 Recomp*) traduzem o código binário da ROM original em código C nativo para PC.
- O Cerberus permite ao usuário baixar o runtime do recompilador e simplesmente associar a ROM compatível, resultando em:
  - 60+ FPS sem glitches de física.
  - Suporte nativo a telas ultra-wide (21:9).
  - Controle de câmera analógico e suporte pleno a gamepads modernos com vibração háptica.

---

## 🏆 4. Conquistas Retro (RetroAchievements)

Para reviver jogos clássicos com a mesma sensação de progressão de plataformas modernas:
- **Integração com RetroAchievements API** (`src/main/services/retro-achievements/`): Permite conectar a conta de jogador e desbloquear conquistas durante a jogatina.
- **Overlay e Notificações Customizadas**: Popups na tela com o som clássico de conquista configurável quando um desafio é completado.

---

## 🔗 Relações no Grafo
- **Hub Central**: [[00_Cerberus_MOC]]
- **Biblioteca de Jogos**: [[Cerberus_Library_and_Game_Management]]
- **Saves na Nuvem (Memory Cards)**: [[Cerberus_Cloud_Saves_and_Sync]]
- **Interface e Big Picture**: [[Cerberus_UI_Renderer_and_Themes]]
