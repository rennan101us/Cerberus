---
title: Cerberus Library and Game Management - Scanner, ProcessWatcher & Artworks
tags:
  - cerberus
  - library
  - scanner
  - processwatcher
  - playtime
  - steamgriddb
  - metadata
aliases:
  - Library and Game Management
  - ProcessWatcher
  - Library Manager
---

# Cerberus Library & Game Management

Esta nota documenta o subsistema de gestão de biblioteca de jogos da plataforma **Cerberus**, responsável pela catalogação local, varredura de discos rígidos, monitoramento de processos ativos, contabilização de tempo de jogo e obtenção de ativos visuais de alta resolução.

Retornar ao Hub: [[00_Cerberus_MOC]]

---

## 🗃️ 1. O Modelo de Dados do Jogo (`Game`)

No Cerberus, cada jogo é persistido no LevelDB (`gamesSublevel`) como um registro com as seguintes propriedades essenciais:

- `id`: Identificador único (UUID, Steam AppID ou hash de executável).
- `title`: Nome visível do título.
- `executablePath`: Caminho absoluto para o binário executável (`.exe`, `.app` ou script).
- `playTimeInMilliseconds`: Duração acumulada de sessões de jogo.
- `lastTimePlayed`: Timestamp da última sessão finalizada.
- `shop`: Origem do jogo (`steam`, `epic`, `custom`, `crossover`, `classics`).
- `compatibility`: Configurações de compatibilidade associadas (ex: opções de backend gráfico no Mac ou versão do Proton no Linux).

---

## 🔍 2. Varredura e Detecção Automática (`scan-installed-games.ts`)

O Cerberus possui um mecanismo avançado de descoberta de jogos instalados:

1. **Varredura de Drives Locais**: Localiza diretórios comuns de instalação em discos internos e externos (ex: `SteamLibrary`, `Epic Games`, `GOG Games`, `Games`, `C:\Program Files`).
2. **Integração com Garrafas CrossOver/Fine Wine**: No macOS, utiliza o `CrossOverDiscovery` para inspecionar todas as garrafas e extrair jogos automaticamente. Veja [[Cerberus_macOS_and_FineWine]].
3. **Instaladores Avulsos**: Detecta executáveis `setup.exe` recém-baixados ou extraídos e permite a instalação assistida via `open-game-installer.ts`.

---

## ⏱️ 3. Monitoramento em Tempo Real (`ProcessWatcher`)

O rastreamento preciso de tempo de jogo em títulos lançados por wrappers (Wine, CrossOver, Proton ou launchers intermediários) é um desafio técnico clássico, pois o processo executado inicialmente pelo Cerberus costuma fechar logo após disparar o processo real do jogo.

O Cerberus resolve isso com o **`ProcessWatcher`** (`src/main/services/process-watcher.ts`):

```
+-------------------------------------------------------------+
|                     Cerberus ProcessWatcher                 |
|             (Varredura periódica a cada 2000ms)             |
+------------------------------+------------------------------+
                               |
               Inspeciona Árvore de Processos
                               |
            +------------------+------------------+
            |                                     |
            v                                     v
+-----------------------+             +-----------------------+
|  Processos Windows    |             | Processos macOS/Linux |
| - Query WMI / Enum    |             | - pgrep / ps -ax      |
| - Correspondência PID |             | - Inspeciona wineserver|
| - Detecção de filhos  |             | - Vincula ao bottle   |
+-----------------------+             +-----------------------+
                               |
            Atualiza Registro no LevelDB (playtime)
```

- **Rastreamento de Processos Filhos**: Monitora a árvore de processos descendentes; o cronômetro só é pausado quando o último processo do jogo for encerrado.
- **Tolerância a Suspensão/Hibernação**: Detecta eventos de `suspend` e `resume` do sistema operacional para evitar contagem fantasma de tempo quando o computador estiver em modo de repouso.
- **Roteamento de Fechamento**: Permite forçar o encerramento do jogo diretamente pela interface do Cerberus (`close-game.ts`), matando a cadeia de processos de forma limpa.

---

## 🎨 4. Enriquecimento Visual e SteamGridDB

Para oferecer uma interface rica no estilo console/Steam Deck:

- **Resolução Automática**: Se o jogo não possuir capas locais, o Cerberus busca automaticamente no **SteamGridDB** ou na API da Steam via `src/main/services/game-artwork.ts`.
- **Assets Padronizados**:
  - `cover`: Capa vertical com proporção de poster (600x900).
  - `hero`: Imagem panorâmica de fundo exibida no topo da página de detalhes (1920x620).
  - `logo`: Logotipo oficial transparente sobreposto ao banner hero.
  - `icon`: Ícone quadrado para listagem e atalhos na barra de tarefas.
- **Cache Local Permanente**: Todas as imagens são salvas localmente no diretório de dados do usuário e servidas através do protocolo seguro `local://`. Veja [[Cerberus_Architecture_and_Runtime]].

---

## 🔗 Relações no Grafo

- **Hub Central**: [[00_Cerberus_MOC]]
- **Arquitetura Base**: [[Cerberus_Architecture_and_Runtime]]
- **Execução macOS**: [[Cerberus_macOS_and_FineWine]]
- **Execução Linux**: [[Cerberus_Linux_Proton_and_UMU]]
- **Integração de Lojas**: [[Cerberus_Storefront_Integrations]]
