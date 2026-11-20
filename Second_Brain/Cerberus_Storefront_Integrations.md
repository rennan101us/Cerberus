---
title: Cerberus Storefront Integrations - Steam OpenID, Web APIs & Epic Legendary CLI
tags:
  - cerberus
  - steam
  - epic
  - legendary
  - storefronts
  - sync
aliases:
  - Storefront Integrations
  - Steam and Epic
  - Store Connectors
---

# Cerberus Storefront Integrations

Esta nota documenta os módulos de integração do **Cerberus** com as duas maiores lojas digitais de jogos para PC: **Steam** e **Epic Games Store**, viabilizando a unificação de bibliotecas em uma experiência centralizada.

Retornar ao Hub: [[00_Cerberus_MOC]]

---

## 🎮 1. Integração com a Steam

A ponte com a Steam é implementada em `src/main/services/steam-integration/` e `src/main/services/steam.ts`:

### Fluxo de Autenticação Segura (Steam OpenID)
- Para importar a biblioteca, amigos e tempo de jogo sem solicitar a senha do usuário, o Cerberus abre uma janela dedicada de navegador (`steam-store-session.ts`).
- O usuário realiza o login na interface oficial da Valve via protocolo OpenID 2.0.
- O retorno é capturado e validado por `steam-openid-return.ts`, extraindo o `SteamID64` do usuário de forma criptograficamente segura.

### Sincronização de Biblioteca (`steam-sync-orchestrator.ts`)
- Consulta a API Web da Steam (`IPlayerService/GetOwnedGames`) para obter a lista completa de jogos adquiridos.
- Detecta os manifestos de instalação locais (`appmanifest_<appid>.acf`) nos diretórios `steamapps/` para marcar jogos instalados como prontos para jogar imediatamente.
- Realiza a sincronização periódica de conquistas e tempo de jogo acumulado na conta Steam.

---

## ⚡ 2. Integração com a Epic Games (Legendary CLI)

Para gerenciar títulos da Epic Games sem depender do cliente oficial proprietário da Epic (conhecido por seu alto consumo de recursos em segundo plano), o Cerberus emprega o **Legendary** (`src/main/services/epic/` e `legendary.ts`):

- **Script de Preparação (`scripts/prepare-legendary.cjs`)**: Baixa e empacota os binários nativos do Legendary para Windows, Linux e macOS durante a etapa de instalação do projeto.
- **Autenticação Baseada em Tokens**: O usuário autoriza a conta através do fluxo de login web da Epic; os tokens de autenticação (OAuth2) são armazenados de forma segura e renovados automaticamente.
- **Gerenciamento de Instalações e Updates**:
  - Download e verificação de arquivos de jogos diretamente dos servidores de CDN da Epic.
  - Instalação e execução silenciosa através de comandos estruturados do Legendary (`legendary launch <app-name>`).
  - Fila dedicada de download de artes e metadados (`epic-library-artwork-queue.ts`).

---

## 🧩 3. Fusão Unificada de Catálogo

Um dos principais diferenciais da arquitetura do Cerberus é a fusão de títulos:
- Se o usuário possui o mesmo título na Steam e na Epic, o Cerberus consolida as informações em uma única entrada visual na biblioteca.
- Permite selecionar qual launcher/versão deve ser executada como padrão.
- Padroniza o visual da biblioteca com heróis e logos de alta resolução, independente da loja de origem. Veja [[Cerberus_Library_and_Game_Management]].

---

## 🔗 Relações no Grafo
- **Hub Central**: [[00_Cerberus_MOC]]
- **Biblioteca de Jogos**: [[Cerberus_Library_and_Game_Management]]
- **Execução no Mac**: [[Cerberus_macOS_and_FineWine]]
- **Saves na Nuvem**: [[Cerberus_Cloud_Saves_and_Sync]]
