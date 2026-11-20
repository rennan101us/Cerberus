---
title: Cerberus UI, Renderer & Themes - React 18, Monaco Editor & Big Picture Mode
tags:
  - cerberus
  - frontend
  - react
  - redux
  - virtualization
  - monaco
  - bigpicture
  - themes
aliases:
  - UI Renderer and Themes
  - Big Picture Mode
  - Theme Engine
---

# Cerberus UI, Renderer & Themes

Esta nota documenta a camada de apresentação visual do **Cerberus**, cobrindo o ecossistema frontend em **React 18**, gerenciamento de estado com **Redux Toolkit**, renderização virtualizada de alta performance, o editor embutido de temas **Monaco** e o modo para controles **Big Picture**.

Retornar ao Hub: [[00_Cerberus_MOC]]

---

## 🎨 1. Stack Tecnológico do Frontend

A interface gráfica do Cerberus está localizada em `src/renderer/` e `src/big-picture/`:

- **React 18 & TypeScript**: Componentização modular baseada em hooks e tipagem estrita via `@types`.
- **Redux Toolkit (`@reduxjs/toolkit`)**: Estado global centralizado (biblioteca de jogos, filtros ativos, downloads em andamento, preferências de áudio e notificações).
- **Radix UI & Floating UI**: Componentes acessíveis e sem estilos embutidos (modais, menus de contexto, tooltips e dropdowns via `@radix-ui/react-dropdown-menu` e `@floating-ui/dom`).
- **Phosphor Icons (`@phosphor-icons/react`) & Octicons**: Conjunto de ícones consistentes para toda a interface.
- **TipTap Rich Text Editor (`@tiptap/react`)**: Editor WYSIWYG modular para anotações do jogador e resenhas de jogos.

---

## ⚡ 2. Virtualização de Alta Performance (`@tanstack/react-virtual`)

Quando um usuário possui centenas ou milhares de jogos na biblioteca ou navega pelo catálogo completo:

- Criar nós DOM para cada card causaria degradação severa de memória e travamento no scroll.
- O Cerberus utiliza o `@tanstack/react-virtual` para renderizar apenas os elementos visíveis na janela de exibição (viewport) mais um pequeno buffer acima e abaixo.
- Isso garante 60 FPS estáveis mesmo em computadores mais modestos ou durante scroll rápido em bibliotecas massivas.

---

## 🖌️ 3. Sistema de Temas e Editor Monaco

O Cerberus possui um motor de temas totalmente dinâmico baseado em variáveis CSS customizadas:

- **Variáveis Principais**: `--color-background`, `--color-surface`, `--color-accent`, `--color-text-primary`, `--border-radius`, `--blur-intensity`.
- **Editor Monaco Embutido (`@monaco-editor/react`)**:
  - Usuários avançados podem abrir o editor integrado de CSS na aba de configurações.
  - Oferece auto-complete, validação de sintaxe e realce de cores em tempo real.
  - As alterações são aplicadas instantaneamente sem necessidade de reiniciar a aplicação.
- **Exportação e Compartilhamento**: Os temas podem ser exportados como arquivos `.json` leves contendo o mapa de variáveis e estilos complementares.

---

## 🎮 4. Modo Big Picture (Console / Handheld Mode)

Para jogadores que utilizam o Cerberus em TVs de sala ou dispositivos portáteis (como Steam Deck, ROG Ally ou MacBooks conectados à televisão):

- **Código Separado**: Localizado em `src/big-picture/`, com bundle independente configurado no Vite (`npm run dev:big-picture`).
- **Navegação Integral por Gamepad**:
  - Foco visual claro (outline animado e zoom suave no card selecionado).
  - Mapeamento completo de botões: D-Pad/Analógico para navegação, A/X para seleção, B/Círculo para retorno, Menu/Start para opções do jogo.
- **Interface Otimizada para 10 Pés (10-Foot Experience)**: Tipografia ampliada (Space Grotesk e Noto Sans), botões generosos e eliminação de controles minúsculos de mouse.

---

## 🔗 Relações no Grafo

- **Hub Central**: [[00_Cerberus_MOC]]
- **Arquitetura Base**: [[Cerberus_Architecture_and_Runtime]]
- **Biblioteca de Jogos**: [[Cerberus_Library_and_Game_Management]]
- **Build & Packaging**: [[Cerberus_Build_Packaging_and_CI]]
