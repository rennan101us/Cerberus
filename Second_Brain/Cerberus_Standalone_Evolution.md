---
title: Cerberus Standalone Evolution - From Cloud Hydra to Local-First Gaming Platform
tags:
  - cerberus
  - evolution
  - standalone
  - offline
  - localfirst
  - macos
  - philosophy
aliases:
  - Standalone Evolution
  - Project Cerberus Genesis
  - Local-First Architecture
---

# Cerberus Standalone Evolution: From Cloud Hydra to Local-First Gaming

Esta nota documenta a evolução arquitetural, histórica e filosófica do **Cerberus**, registrando a transformação de um launcher originalmente dependente de nuvem em uma plataforma de jogos **local-first**, autônoma e otimizada para o **macOS**.

Retornar ao Hub: [[00_Cerberus_MOC]]

---

## 🏛️ 1. O Ponto de Partida: O Hydra Original

O Hydra Launcher nasceu com o objetivo louvável de unificar o gerenciamento de bibliotecas de jogos. No entanto, sua arquitetura original trazia acoplamentos que limitavam a soberania do usuário:

- **Dependência de Autenticação Web**: Necessidade de login permanente em servidores proprietários na nuvem para acessar abas essenciais.
- **Rankings Globais & Social Obrigatório**: Processamento constante de telemetria para tabelas de classificação globais (leaderboards), chat em tempo real e feeds sociais.
- **Falta de Suporte Oficial ao macOS**: Foco quase exclusivo em Windows e Linux, deixando usuários de computadores Apple Silicon sem uma solução nativa de launcher com Wine integrado.
- **Falha de Inicialização em Ambientes Offline**: Quedas ou instabilidades na API remota degradavam ou impediam a navegação na biblioteca local.

---

## ⚡ 2. A Virada de Chave: O Nascimento do Cerberus Standalone

Na branch `feature/macos-crossover-integration` (culminando no commit `209203671`), consolidou-se a visão do **Cerberus v0.0.1**:

```
+--------------------------------------------------------------+
|                        HYDRA ORIGINAL                        |
|  - Auth Cloud Obrigatória          - Telemetria de Rankings  |
|  - Catálogo Bloqueado por Nuvem    - Sem suporte nativo Mac  |
+------------------------------+-------------------------------+
                               |
                   (Refatoração Arquitetural)
                               |
                               v
+--------------------------------------------------------------+
|                     CERBERUS STANDALONE                      |
|  - 100% Offline e Local-First      - Zero Bloqueio de Auth   |
|  - CrossOver / Fine Wine Integrado - Auto-Import de Garrafas |
|  - Enriquecimento Steam sem Conta  - Desempenho Apple Silicon|
+--------------------------------------------------------------+
```

### Principais Modificações Realizadas:

1. **Desacoplamento de Telas de Autenticação (`src/renderer/src/routes.tsx`)**:
   - Remoção de barreiras de sign-in/sign-up. A aplicação inicializa diretamente na biblioteca de jogos do usuário.
2. **Purificação do Catálogo (`catalogue.tsx`)**:
   - O catálogo agora atua primariamente como um indexador e explorador local, sem exigir validações remotas de perfil de jogador.
3. **Desativação de Ranking e Telemetria**:
   - Eliminação de rotinas em segundo plano que consumiam ciclos de CPU transmitindo estatísticas para servidores externos (`achievement-watcher-manager.ts`).
4. **Foco Total no macOS & Fine Wine**:
   - Criação do serviço `crossover` (`CrossOverDetector`, `CrossOverDiscovery`, `CrossOverProvisioner`, `CrossOverRunner`). Veja [[Cerberus_macOS_and_FineWine]].
   - Reset de trial automatizado a cada inicialização para uma experiência limpa e sem interrupções.
   - Enriquecimento visual automatizado de títulos sem metadados usando as APIs públicas da Steam.

---

## 🌟 3. A Filosofia Local-First do Cerberus

A evolução para o Cerberus é guiada por quatro princípios inegociáveis:

1. **Soberania dos Dados**: Seus jogos, seu tempo de jogo e seus saves pertencem a você e ficam armazenados localmente em disco no LevelDB e pastas abertas. Veja [[Cerberus_Architecture_and_Runtime]] e [[Cerberus_Cloud_Saves_and_Sync]].
2. **Resiliência Offline Total**: O launcher deve abrir instantaneamente e executar qualquer jogo sem demandar conexão com a internet.
3. **Aproveitamento Máximo do Hardware**: Em Macs com Apple Silicon (M1/M2/M3/M4), o Cerberus extrai o potencial máximo das APIs Metal (`D3DMetal` GPTK, `DXMT`) com o mínimo de sobrecarga de sistema.
4. **Universalidade de Fontes**: Não importa se o jogo é da Steam, da Epic Games, um executável avulso em uma garrafa Wine ou uma ROM clássica: a experiência visual e a conveniência de lançamento são idênticas. Veja [[Cerberus_Library_and_Game_Management]].

---

## 🔮 4. Próximos Passos e Visão Futura

- Expandir a integração com novas versões do Game Porting Toolkit e bibliotecas DXMT.
- Aprimorar o suporte a controles modernos com vibração avançada no modo Big Picture.
- Disponibilizar instaladores nativos `.dmg` pré-configurados para a comunidade Apple Silicon.

---

## 🔗 Relações no Grafo

- **Hub Central**: [[00_Cerberus_MOC]]
- **Arquitetura Base**: [[Cerberus_Architecture_and_Runtime]]
- **Execução no Mac**: [[Cerberus_macOS_and_FineWine]]
- **Interface e Temas**: [[Cerberus_UI_Renderer_and_Themes]]
- **Biblioteca de Jogos**: [[Cerberus_Library_and_Game_Management]]
