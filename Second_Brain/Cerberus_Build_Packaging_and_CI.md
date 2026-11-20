---
title: Cerberus Build, Packaging & CI - Electron Vite, Builder & Native Modules
tags:
  - cerberus
  - build
  - electronvite
  - electronbuilder
  - packaging
  - ci
  - rust
aliases:
  - Build Packaging and CI
  - Build Pipeline
  - Packaging Guide
---

# Cerberus Build, Packaging & CI Pipeline

Esta nota documenta o pipeline de compilação, empacotamento multi-plataforma e automação de builds da plataforma **Cerberus**, integrando o **Electron Vite**, o **Electron Builder**, compilação nativa em **Rust/C++** e geração de instaladores.

Retornar ao Hub: [[00_Cerberus_MOC]]

---

## 🛠️ 1. Pipeline de Compilação: `electron.vite.config.ts`

O Cerberus adota o **electron-vite**, separando a compilação em três contextos independentes e otimizados:

```
electron.vite.config.ts
├── main:     Compilação Node.js (src/main/index.ts) -> out/main/index.js
├── preload:  Compilação segura de sandboxing (src/preload/index.ts) -> out/preload/index.js
└── renderer: Bundle web React 18 + Vite (src/renderer/index.html) -> out/renderer/
```

### Resolução de Aliases de Path

Para evitar caminhos relativos frágeis (`../../../../`), a configuração padroniza aliases estritos em todo o TypeScript:

- `@main`: Aponta para `src/main`
- `@renderer`: Aponta para `src/renderer/src`
- `@types`: Aponta para `src/types`
- `@locales`: Aponta para `src/locales`

---

## 🦀 2. Ciclo de Vida dos Módulos Nativos

O script `postinstall` no `package.json` orquestra a cadeia de compilação dos binários de baixo nível:

```bash
npm run build:native && electron-builder install-app-deps && node ./scripts/postinstall.cjs && npm run prepare:legendary
```

1. **`build:native` (`scripts/build-native-addon.cjs`)**:
   - Aciona o compilador `cargo build --release` no diretório `hydra-native/`.
   - Gera o arquivo binário Node-API `hydra-native.node`. Veja [[Cerberus_Torrent_and_Native_Engine]].
2. **`electron-builder install-app-deps`**:
   - Recompila módulos C++ instalados via npm (como o banco de dados `classic-level`) contra os cabeçalhos internos do runtime do Electron instalado, evitando erros de ABI mismatch (`NODE_MODULE_VERSION`).
3. **`prepare:legendary` (`scripts/prepare-legendary.cjs`)**:
   - Baixa e valida as versões executáveis do cliente Legendary correspondentes à plataforma atual. Veja [[Cerberus_Storefront_Integrations]].

---

## 📦 3. Empacotamento de Distribuição: `electron-builder.yml`

O Cerberus suporta geração de pacotes para os três principais sistemas operacionais desktop:

### 🍎 macOS (`npm run build:mac`)

- **Formatos**: `.dmg` (com imagem de background e atalho estilizado para `/Applications`) e `.zip`.
- **Arquiteturas**: Apple Silicon nativo (`arm64`) e Intel (`x64`), ou universal.
- **Hardened Runtime & Entitlements**: Configurado para permitir carregamento de dylibs de terceiros (necessárias para o runtime Wine/CrossOver) sem bloqueio do Gatekeeper do macOS. Veja [[Cerberus_macOS_and_FineWine]].

### 🐧 Linux (`npm run build:linux`)

- **Formatos**: `AppImage` (portável e universal), pacotes `.deb` (Debian/Ubuntu), `.pacman` (Arch Linux / SteamOS) e `.rpm` (Fedora).
- **Integração Desktop**: Arquivo `.desktop` gerado com suporte a esquemas de protocolo `hydralauncher://` e categorias de jogos do XDG. Veja [[Cerberus_Linux_Proton_and_UMU]].

### 🪟 Windows (`npm run build:win`)

- **Formatos**: Instalador assistido **NSIS** com desinstalador limpo e versão **portable** de execução direta sem privilégios de administrador.

---

## 🔗 Relações no Grafo

- **Hub Central**: [[00_Cerberus_MOC]]
- **Arquitetura Base**: [[Cerberus_Architecture_and_Runtime]]
- **Engine Nativa**: [[Cerberus_Torrent_and_Native_Engine]]
- **Interface e Renderer**: [[Cerberus_UI_Renderer_and_Themes]]
