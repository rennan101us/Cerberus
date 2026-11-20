---
title: Cerberus macOS & Fine Wine - CrossOver Integration, D3DMetal & Apple Silicon
tags:
  - cerberus
  - macos
  - crossover
  - finewine
  - wine
  - d3dmetal
  - applesilicon
  - gptk
aliases:
  - macOS and FineWine
  - CrossOver Integration
  - Fine Wine Architecture
---

# Cerberus macOS & Fine Wine Compatibility Architecture

Esta nota documenta o subsistema especializado de execução no macOS da plataforma **Cerberus**, responsável por permitir a execução nativa de jogos do Windows (x86_64) no Apple Silicon (ARM64) através da camada de compatibilidade **Wine / CrossOver / Fine Wine** e **D3DMetal (Apple Game Porting Toolkit)**.

Retornar ao Hub: [[00_Cerberus_MOC]]

---

## 🎯 Visão Geral da Arquitetura macOS

No macOS (`process.platform === "darwin"`), o Cerberus não utiliza o Wine padrão de terminal, mas sim a infraestrutura avançada do CrossOver/Fine Wine, aproveitando os binários otimizados para Apple Silicon (`wine`, `cxbottle`, `cxstart`, `wineserver`) e tradução de instruções com o Rosetta 2 / Rosetta AVX.

O subsistema está localizado em `src/main/services/crossover/` e é composto por quatro componentes principais:

```
src/main/services/crossover/
├── crossover-detector.ts       # Detecção do CrossOver.app, garrafas e binários
├── crossover-discovery.ts      # Varredura inteligente de jogos .exe em garrafas
├── crossover-provisioner.ts    # Auto-reset de trial, cfprefsd e limpeza de system.reg
└── crossover-runner.ts         # Orquestrador de lançamento com D3DMetal/DXMT e MSync
```

---

## 🔍 1. Detecção do Ambiente (`crossover-detector.ts`)

O `CrossOverDetector` localiza instalações do aplicativo em:
- `/Applications/CrossOver.app`
- `~/Applications/CrossOver.app`

Ele extrai dinamicamente o caminho dos binários internos:
```
<CrossOver.app>/Contents/SharedSupport/CrossOver/bin/
├── wine
├── cxbottle
├── cxstart
└── wineserver
```
Além disso, resolve o diretório padrão de garrafas (`~/Library/Application Support/CrossOver/Bottles`), garantindo que o Cerberus possa inspecionar e gerenciar garrafas criadas pelo usuário ou a garrafa padrão dedicada `HydraGames`.

---

## 🚀 2. Orquestrador de Execução (`crossover-runner.ts`)

Ao lançar qualquer jogo no macOS através de `launchGame` (`src/main/helpers/launch-game.ts`), o Cerberus delega a execução para o `CrossOverRunner.prepareLaunchEnvironment`.

### Backends Gráficos Suportados
O usuário pode configurar o backend gráfico por jogo ou globalmente através de `MacOSCompatibilityOptions`:

| Backend | Variáveis Injetadas | Uso Recomendado |
| :--- | :--- | :--- |
| **`d3dmetal`** | `WINED3DMETAL=1`, `DXVK=0`, `D3DM_ENABLE_METALFX=1`, `D3DM_SUPPORT_DXR=1`, `D3DM_MTL4=1` | Jogos modernos DirectX 11 / DirectX 12 via Apple Game Porting Toolkit (Metal). |
| **`dxmt`** | `DXMT=1`, `WINED3DMETAL=0`, `DXVK=0`, `DXMT_ENABLE_NVEXT=1` | Jogos baseados em Direct3D 11 traduzidos diretamente para Metal sem camadas intermediárias. |
| **`dxvk`** | `DXVK=1`, `WINED3DMETAL=0` | Tradução de DirectX 9/10/11 para Vulkan via MoltenVK. |
| **`wined3d`** | `WINED3DMETAL=0`, `DXVK=0` | Renderizador clássico OpenGL de alta compatibilidade para jogos legados. |

### Sincronização e Desempenho
- **MSync (`WINEMSYNC=1`)**: Modo de sincronização ultrarrápido baseado em mach primitives do macOS XNU kernel, eliminando gargalos do `wineserver`.
- **ESync (`WINEESYNC=1`)**: Alternativa baseada em eventfd emulado.
- **Metal HUD (`MTL_HUD_ENABLED=1`)**: Exibição do overlay nativo da Apple com taxa de quadros (FPS), resolução, tempo de frame e consumo de VRAM em tempo real.
- **Rosetta AVX (`ROSETTA_ENABLE_AVX=1`)**: Ativação da emulação de extensões vetoriais AVX no macOS Sequoia / Sonoma para títulos modernos.

---

## 🔄 3. Provisionamento e Fine Reset (`crossover-provisioner.ts`)

Para garantir operação ininterrupta do backend sem que mensagens de expiração de avaliação bloqueiem o launcher ou os jogos, o `CrossOverProvisioner` implementa a rotina `resetTrial()` disparada a cada inicialização (`src/main/index.ts:217`):

1. **Atualização de Plist**: Atualiza `FirstRunDate` e `SULastCheckTime` no arquivo `~/Library/Preferences/com.codeweavers.CrossOver.plist` para o timestamp atual UTC via utilitário `/usr/bin/defaults`.
2. **Flush do Cache de Preferências**: Dispara `/usr/bin/killall cfprefsd` para garantir que o daemon de preferências do macOS recarregue o arquivo de disco imediatamente.
3. **Higienização de `system.reg`**: Itera sobre todas as garrafas encontradas em `~/Library/Application Support/CrossOver/Bottles` e limpa as chaves de registro do Windows associadas à verificação de licença do CrossOver.

---

## 🔎 4. Auto-Importação e Descoberta de Jogos (`crossover-discovery.ts`)

Uma das inovações mais fortes do Cerberus v0.0.1 é a auto-descoberta de jogos de garrafas:
- **Varredura Recursiva**: Percorre a pasta `drive_c/` de cada garrafa (focando em `Program Files`, `Program Files (x86)`, `Games`, etc.).
- **Lista de Exclusão Inteligente (`IGNORE_EXECUTABLES`)**: Filtra automaticamente mais de 20 utilitários do sistema (desinstaladores como `unins000.exe`, instaladores de DirectX `dxsetup.exe`, redistribuíveis `vc_redist`, crash handlers da Unity/Unreal e executáveis auxiliares da Steam).
- **Importação Direta na Biblioteca**: Transforma os executáveis encontrados em registros `Game` no LevelDB (`gamesSublevel`), vinculando o executável à garrafa e ao backend ideal. Veja [[Cerberus_Library_and_Game_Management]].

---

## 🎨 5. Enriquecimento de Metadados e Capas Steam

Ao encontrar um jogo em uma garrafa externa (ex: repack, jogo autônomo ou sem metadados), o Cerberus aciona o `CrossOverDiscovery.enrichLibraryArtwork`:
1. Sanitiza o nome do jogo (removendo tags como `v1.0`, `Repack`, `Gold Edition`).
2. Consulta a API pública de busca da Steam (`https://store.steampowered.com/api/storesearch/`).
3. Localiza o `appId` correspondente e faz o download automático de:
   - Capa vertical (Portrait cover)
   - Hero banner (Banner horizontal)
   - Logo oficial transparente
   - Ícone do jogo
4. Persiste os ativos no `gamesShopAssetsSublevel` para exibição instantânea no catálogo visual. Veja [[Cerberus_Storefront_Integrations]].

---

## 🛡️ 6. Modo Seguro para Instaladores FitGirl / Repacks (`fitgirl-installer-helpers.ts`)

Instaladores InnoSetup/FreeArc pesados (como repacks FitGirl) enfrentavam congelamento perpétuo no macOS Apple Silicon devido a conflitos entre MSync, D3DMetal, tradução Rosetta AVX e caminhos Unix profundos com caracteres especiais.
O Cerberus detecta automaticamente instaladores de repacks (`setup.exe` com arquivos `fgpack*.bin`, `setup-*.bin`, `unarc.dll` ou `isdone.dll`) e aplica uma configuração blindada de execução:
- **Caminho Curto Virtual**: Criação de link simbólico curto `C:\_fg_inst` apontando para a pasta do instalador, eliminando falhas de buffer de caminho longo do InnoSetup.
- **Ambiente de Descompressão Estável**: Desativação explícita de `WINEESYNC`, `WINEMSYNC`, `ROSETTA_ENABLE_AVX=0`, `D3DMETAL=0`, `DXVK=0` e forçagem de `WINEDLLOVERRIDES="isdone,unarc=n,b"`.
- **Modo Windows 7**: Adição de `--winver win7` no `cxstart` para compatibilidade com rotinas de extração legado.
- **Limpeza de Arquivos Temporários InnoSetup**: Varredura e purga de diretórios temporários órfãos (`is-*.tmp`).

---

## ⚡ 7. Centralização de Caches (`Cerberus_Cache`) e Porting Switch

Todas as operações de compilação, descompressão, staging e caches de ferramentas (`CrossOverTools`, `nx2android`, `AppSupport`, `Staging`, `Temp`) são centralizadas na pasta `<pasta de Cerberus.app>/Cerberus_Cache/` por padrão, mantendo isolamento e facilidade de limpeza:
- **Preservação de Pastas Existentes**: Usuários que já possuem diretórios configurados (ex: `/Volumes/SSD FN501 PRO/Emulations/Nx Ports`) mantêm suas preferências sem substituição forçada.
- **Controle no Modal de Porting (`SwitchPortModal`)**: Interface dedicada com seletores de pasta, botões de revelação no Finder e preset de 1 clique para `Cerberus_Cache`.
- **Porting para macOS (`.app`)**: Sanitização estrita de nomes de arquivos, rejeição de bundles já portados e isolamento de dependências.
- **Porting para iOS (`.ipa` / NxN Launcher)**: Validação de cadeias de shaders do Metal (`validateFramework`), reconstrução de frameworks incompatíveis e suporte a multi-jogos em container único.
- **Porting para Android (`.apk` / `nx2android`)**: Injeção correta de `NX2A_HOME`, `ANDROID_NDK_HOME`, `--jobs` e ativação automática de `--experimental` para jogos sem perfil oficial em `android.tsv`.

---

## 🔗 Relações no Grafo
- **Hub Central**: [[00_Cerberus_MOC]]
- **Arquitetura Base**: [[Cerberus_Architecture_and_Runtime]]
- **Biblioteca de Jogos**: [[Cerberus_Library_and_Game_Management]]
- **Integração com Lojas**: [[Cerberus_Storefront_Integrations]]
- **Evolução Standalone**: [[Cerberus_Standalone_Evolution]]
