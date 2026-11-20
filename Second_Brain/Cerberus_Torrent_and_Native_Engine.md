---
title: Cerberus Torrent & Native Engine - Rust Addon, libtorrent C++ & Download Pipeline
tags:
  - cerberus
  - torrent
  - rust
  - libtorrent
  - cpp
  - downloads
  - neon
aliases:
  - Torrent and Native Engine
  - Native Engine
  - Libtorrent Bridge
---

# Cerberus Torrent & Native Engine

Esta nota detalha a infraestrutura de baixo nível do **Cerberus**, responsável pelo download de jogos via protocolo BitTorrent e servidores de descompressão/armazenamento direto, combinando código **Rust (`hydra-native`)**, **C++ (`libtorrent`)** e **TypeScript**.

Retornar ao Hub: [[00_Cerberus_MOC]]

---

## 🏗️ Arquitetura do Subsistema Nativo

Historicamente, muitos launchers baseados em Electron recorriam a daemons externos em Python para gerenciar torrents. O Cerberus emprega uma arquitetura nativa embutida de alto desempenho que elimina qualquer dependência de runtime externo:

```
+--------------------------------------------------------------+
|               Cerberus Main Process (TypeScript)             |
|  - DownloadOrchestrator (src/main/services/download-orchestrator.ts)
|  - TorrentService & TorrentClient                            |
+------------------------------+-------------------------------+
                               |
                   (Node-API / Neon Bindings)
                               |
                               v
+--------------------------------------------------------------+
|              hydra-native Addon (Rust - neon/napi)           |
|  - hydra-native/src/lib.rs                                   |
|  - Thread-pool assíncrono para eventos I/O de rede           |
+------------------------------+-------------------------------+
                               |
                     (C++ FFI Bridge / ABI)
                               |
                               v
+--------------------------------------------------------------+
|                 Torrent Bridge (C++ libtorrent)              |
|  - native/torrent-bridge/                                    |
|  - libtorrent-rasterbar (vcpkg ou prebuilt)                  |
|  - I/O assíncrono com suporte a IPv6, DHT, PeX e LSD         |
+--------------------------------------------------------------+
```

---

## 🦀 1. Addon Rust (`hydra-native`)

Localizado no diretório `hydra-native/`:
- Compilado via `cargo` durante o script de `postinstall` (`scripts/build-native-addon.cjs`). Veja [[Cerberus_Build_Packaging_and_CI]].
- Produz o arquivo binário compilado `hydra-native/hydra-native.node`, carregado dinamicamente pelo processo Main do Electron.
- Expõe funções thread-safe para inicializar sessões torrent, adicionar magnet links ou arquivos `.torrent`, ajustar limites de velocidade (upload/download) e receber métricas de progresso em tempo real sem bloquear a event loop do Node.js.

---

## ⚡ 2. C++ `libtorrent` Bridge

Localizado em `native/torrent-bridge/`:
- Envolve a biblioteca industrial **libtorrent-rasterbar** (uma das mais rápidas e completas implementações BitTorrent do mundo).
- **Prebuilts Inteligentes**: Para evitar tempos de compilação excessivos em computadores de desenvolvimento e usuários finais, o Cerberus inclui bridges pré-compiladas em `native/torrent-bridge/prebuilt` para Windows x64 e Linux x64.
- **Compilação via vcpkg**: Em plataformas sem binários prévios ou quando a variável de ambiente `HYDRA_TORRENT_BRIDGE_FROM_SOURCE=1` é definida, o instalador compila o CMake e o libtorrent via vcpkg automaticamente.

---

## 📥 3. Orquestrador de Downloads (`DownloadOrchestrator`)

O arquivo `src/main/services/download-orchestrator.ts` é o cérebro das operações de transferência:

1. **Gerenciamento de Fila**:
   - Priorização automática de pacotes.
   - Pausa e retomada sem perda de integridade de dados (validação de hash por blocos).
   - Limitação de taxa de upload/download configurável nas opções do usuário.
2. **Suporte a Provedores Debrid**:
   - Para usuários que preferem download direto (HTTP/HTTPS) em alta velocidade ao invés de P2P puro, o Cerberus integra autenticação e resolução de links para provedores como Real-Debrid, AllDebrid e TorBox.
3. **Extração Automática com 7-Zip (`archive-extraction.ts`)**:
   - Assim que o download é concluído, o sistema invoca o módulo `node-7z` (`src/main/services/7zip.ts`) para descompactar arquivos `.zip`, `.rar` ou `.7z` na pasta final de destino.
   - Detecta instaladores executáveis pós-extração e notifica a biblioteca para cadastro. Veja [[Cerberus_Library_and_Game_Management]].

---

## 🔗 Relações no Grafo
- **Hub Central**: [[00_Cerberus_MOC]]
- **Arquitetura Base**: [[Cerberus_Architecture_and_Runtime]]
- **Biblioteca de Jogos**: [[Cerberus_Library_and_Game_Management]]
- **Pipeline de Compilação**: [[Cerberus_Build_Packaging_and_CI]]
