# Regras de Build e Desenvolvimento do Cerberus Launcher (macOS Apple Silicon)

## 1. Empacotamento Obrigatório para `dist/mac-arm64`

- Sempre que finalizar alterações ou gerar uma nova build neste repositório no macOS, **apague primeiro a build anterior** em `/Volumes/SSD FN501 PRO/Emulations/Cerberus Launcher/dist/mac-arm64` (`rm -rf "/Volumes/SSD FN501 PRO/Emulations/Cerberus Launcher/dist/mac-arm64"`).
- Sempre gere o novo `Cerberus.app` diretamente na pasta `/Volumes/SSD FN501 PRO/Emulations/Cerberus Launcher/dist/mac-arm64` executando `npm run build:mac:app` (ou `npm run build:mac` quando um instalador completo `.dmg`/`.zip` for explicitamente solicitado).
- Nunca pare apenas executando `npm run build` (que atualiza somente `out/`) ao entregar alterações ao usuário — sempre gere novamente `/Volumes/SSD FN501 PRO/Emulations/Cerberus Launcher/dist/mac-arm64/Cerberus.app`.
- Não desative a assinatura de código macOS (`CSC_IDENTITY_AUTO_DISCOVERY=false`) a menos que seja explicitamente solicitado; deixe o `electron-builder` utilizar o certificado local Apple Development.
- Sempre verifique após o empacotamento que `/Volumes/SSD FN501 PRO/Emulations/Cerberus Launcher/dist/mac-arm64/Cerberus.app` existe com timestamp atualizado e `Contents/Resources/app.asar` recém-gerado.

---

## 2. Otimização de Tokens & Navegação MOC-First (Rennan Dev Cycle)

Para evitar consumo desnecessário de contexto e leituras cegas do repositório:

1. **Navegação via Segundo Cérebro (MOC-First)**:
   - Antes de realizar varreduras amplas no código, consulte sempre o grafo central em `Second_Brain/00_Cerberus_MOC.md` e a nota temática do subsistema (`Second_Brain/Cerberus_*.md`).
   - Elas contêm o mapa exato dos arquivos, fluxos IPC, tipos e arquitetura de cada componente (Mac/FineWine, Scanner, UI, Torrents, Stores, etc.).

2. **Leituras Cirúrgicas (Anti-Bloat)**:
   - Proibido ler arquivos inteiros desnecessariamente. Use sempre limites de linha (`StartLine` e `EndLine`) e buscas pontuais (`rg` / `grep`).
   - Limite de 300 linhas por arquivo novo ou refatorado (The 300-Line Rule).

3. **Saídas de Terminal Enxutas**:
   - Comandos com saídas longas de compilação ou testes devem ser filtrados/truncados (`tail -n 25`, pipe para grep de erros) para não inundar o histórico da conversa com texto inútil.

4. **Isolamento de Pesquisas Pesadas**:
   - Caso precise mapear múltiplos arquivos simultaneamente, delegue para subagentes pontuais (`role: research`), que processam a busca em contexto isolado e devolvem apenas a resposta necessária.

