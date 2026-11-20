---
title: Cerberus Cloud Saves & Sync - Ludusavi Engine, Memory Cards & Conflict Resolution
tags:
  - cerberus
  - saves
  - ludusavi
  - cloudsaves
  - sync
  - backup
aliases:
  - Cloud Saves and Sync
  - Ludusavi Integration
  - Save Manager
---

# Cerberus Cloud Saves & Sync

Esta nota detalha o subsistema de salvamento, empacotamento e sincronização de progresso de jogos do **Cerberus**, utilizando a tecnologia de detecção do utilitário open-source **Ludusavi** (`src/main/services/cloud-save/` e `cloud-sync.ts`).

Retornar ao Hub: [[00_Cerberus_MOC]]

---

## 💾 1. O Desafio dos Saves de Jogos no PC

Diferente de consoles fechados onde os dados salvos ficam restritos a uma partição padronizada, no PC os jogos salvam em diretórios arbitrários espalhados pelo sistema:
- `AppData/Local/` e `AppData/Roaming/`
- `Saved Games/`
- `Documents/My Games/`
- Chaves do Registro do Windows (`HKEY_CURRENT_USER\Software\...`)
- Prefixo Wine/Proton em ambientes Linux e garrafas CrossOver no macOS.

---

## 🔍 2. O Motor Ludusavi

O Cerberus integra o banco de definições e heurísticas do **Ludusavi**:
1. **Mapeamento de Rotas Baseado em Regras**: Consulta uma base de dados comunitária com mais de 10.000 títulos para saber exatamente onde cada jogo armazena seus dados salvos.
2. **Resolução de Caminhos Multi-Plataforma**: Converte caminhos virtuais do Windows (ex: `%APPDATA%`, `%USERPROFILE%`) para as pastas reais do Linux e para o interior das garrafas Wine no macOS (`drive_c/users/crossover/AppData`). Veja [[Cerberus_macOS_and_FineWine]].
3. **Empacotamento Atômico**: Compacta todos os arquivos do save em um arquivo compactado leve `.zip` associado ao identificador do jogo.

---

## 🔄 3. Resolução de Conflitos e Sincronização

Durante a inicialização e o encerramento de um jogo monitorado pelo `ProcessWatcher`:
- **Verificação Pré-Launch**: Compara o timestamp e o checksum do save local com a versão armazenada no backup.
- **Detecção de Conflitos**: Caso o jogo tenha sido jogado em outra máquina ou tenha havido divergência, o Cerberus exibe uma modal visual com a data, horário e tamanho dos dois estados de save para que o jogador escolha qual preservar.
- **Backup de Salvaguarda**: Antes de sobrescrever qualquer save divergente, o Cerberus move o estado anterior para uma pasta de quarentena temporal, impedindo perda irreversível de progresso.

---

## 🎮 4. Memory Cards de Emuladores

O Cerberus Classics estende a sincronização de saves para jogos emulados:
- **PlayStation 1 & 2**: Sincronização de memory cards virtuais (`.mcr`, `.ps2`) vinculados por título.
- **PlayStation 3 & 4**: Sincronização de pastas de progresso (`savedata/`).
- **RetroArch**: Backup automático de arquivos de save state (`.state`) e save de bateria (`.srm`). Veja [[Cerberus_Emulation_and_RetroClassics]].

---

## 🛡️ 5. Modo Local-First no Cerberus Standalone

Na transição para a arquitetura standalone do Cerberus:
- Os saves não dependem obrigatoriamente de conexão ativa com servidores em nuvem.
- O Cerberus suporta armazenamento local em diretórios de sincronização de terceiros (como iCloud Drive, Dropbox, Syncthing ou pendrive/SSD externo). Veja [[Cerberus_Standalone_Evolution]].

---

## 🔗 Relações no Grafo
- **Hub Central**: [[00_Cerberus_MOC]]
- **Biblioteca de Jogos**: [[Cerberus_Library_and_Game_Management]]
- **Emuladores e Clássicos**: [[Cerberus_Emulation_and_RetroClassics]]
- **Evolução Standalone**: [[Cerberus_Standalone_Evolution]]
- **Execução no Mac**: [[Cerberus_macOS_and_FineWine]]
