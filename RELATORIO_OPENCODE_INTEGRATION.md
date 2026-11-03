# Relatório Técnico: Integração e Adaptações do Gemini Bridge com OpenCode

**Data:** 03 de Novembro de 2026  
**Autor:** Miguel de Sousa Batista  
**Repositório:** `gemini-cli-mcp-openai-bridge`  
**Versão:** `v0.1.15`  

---

## 1. Sumário Executivo

Este documento detalha o diagnóstico de falhas, a análise de causa raiz, as modificações de arquitetura e as atualizações implementadas no projeto **`gemini-cli-mcp-openai-bridge`** para viabilizar a sua integração completa com o assistente de linha de comando **OpenCode** (`opencode.ai`), permitindo o uso fluido de modelos modernos (como **Gemini 2.5 Flash/Pro**, **Gemini 3 Preview** e **Gemini 3.8 Flash**) com suporte a geração de texto e chamadas de ferramentas (*tool calling / function execution*).

---

## 2. Diagnóstico dos Problemas Iniciais

Ao configurar o OpenCode com o provedor `@ai-sdk/openai-compatible` apontando para o bridge local (`http://127.0.0.1:8765/v1`), dois bloqueios críticos ocorreram nas chamadas para a API do Google Gemini.

### Problema 1: Rejeição de Schema JSON (`exclusiveMinimum`)
* **Sintoma:** Logo na inicialização ou no envio de qualquer prompt pelo OpenCode, a requisição falhava imediatamente com código HTTP 400:
  ```json
  {
    "error": {
      "code": 400,
      "message": "Invalid JSON payload received. Unknown name \"exclusiveMinimum\" at 'request.tools[0].function_declarations[0].parameters.properties[1].value': Cannot find field.",
      "status": "INVALID_ARGUMENT"
    }
  }
  ```
* **Causa Raiz:** O OpenCode utiliza schemas de validação (via Effect Schema / Zod) que seguem a especificação JSON Schema moderna (Draft-07 / Draft 2020-12), na qual limites numéricos estritos são representados por campos como `"exclusiveMinimum": 0`. Por outro lado, a API REST do Google Gemini (`v1beta`) valida as declarações de função contra uma estrutura Protobuf estrita que suporta apenas um subconjunto de OpenAPI 3.0. Qualquer chave desconhecida rejeita a requisição no parser de payload do Google.
* **Limitação do Projeto Original:** A função `sanitizeGeminiSchema` do bridge original apenas filtrava duas chaves específicas (`$schema` e `additionalProperties`), deixando passar `exclusiveMinimum`, `exclusiveMaximum`, `$id`, `$defs`, `const`, `oneOf`, entre outras.

---

### Problema 2: Ausência de `thought_signature` no Fluxo Multi-Turn de Ferramentas
* **Sintoma:** Após a correção do schema, consultas simples funcionavam, mas ao executar prompts que acionavam ferramentas (ex.: execução de comandos bash pelo OpenCode), a rodada seguinte da conversa (*turn*) falhava com:
  ```json
  {
    "error": {
      "code": 400,
      "message": "Function call is missing a thought_signature in functionCall parts. This is required for tools to work correctly, and missing thought_signature may lead to degraded model performance. Additional data, function call default_api:bash , position 2. Please refer to https://ai.google.dev/gemini-api/docs/thought-signatures for more details."
    }
  }
  ```
* **Causa Raiz:** Nos modelos Gemini com capacidade de raciocínio (*thinking models*, como Gemini 2.5 e Gemini 3.x), cada `functionCall` gerado pelo modelo traz acoplado um token criptográfico opaco (`thoughtSignature` / `thought_signature`), que representa o "estado de pensamento" do modelo antes da interrupção para execução da ferramenta. Quando o cliente OpenAI executa a ferramenta e envia o histórico de volta (`assistant` com o `tool_calls` + `tool` com o resultado), a API do Gemini exige que a parte `functionCall` reenviada contenha obrigatoriamente a assinatura original.
* **Limitação do Projeto Original:** O bridge descartava completamente o `thoughtSignature` ao converter o fluxo da Gemini para os chunks OpenAI e, na reconstrução da mensagem enviada pelo cliente, gerava uma chamada de função limpa sem o campo `thoughtSignature`.

---

### Problema 3: Atualização do OpenCode para v2 e Roteamento de Configurações
* O OpenCode atualizou automaticamente no ambiente para a versão `v2.2.5`, que roda em arquitetura cliente-servidor em segundo plano (`opencode serve --service`). Na v2, a convenção prioritária de configuração é `~/.config/opencode/opencode.json` e as mudanças exigem reinicialização do serviço local (`opencode service restart`).

---

### Problema 4: Descasamento de Partes de Resposta de Ferramentas em Paralelo (*Tool Call Parity*)
* **Sintoma:** Ao executar prompts complexos no OpenCode (especialmente no modo **Plan** com `gemini-3.8-flash`), onde o modelo dispara múltiplas chamadas de ferramentas em paralelo (ex.: `→Explored: 1 search, 3 reads`, totalizando 4 chamadas), a rodada subsequente falhava com HTTP 400 da API Gemini:
  ```json
  {
    "error": {
      "code": 400,
      "message": "Please ensure that the number of function response parts is equal to the number of function call parts of the function call turn.",
      "status": "INVALID_ARGUMENT"
    }
  }
  ```
* **Causa Raiz:** Na especificação OpenAI (`chat/completions`), as chamadas paralelas são enviadas de volta pelo cliente como mensagens separadas com `role: "tool"` para cada chamada executada. Por outro lado, na API do Google Gemini, o protocolo de turnos é rígido: todas as respostas às chamadas de função de um turno do modelo devem ser empacotadas em um **único turno de usuário (`role: 'user'`)**, contendo exatamente a mesma quantidade de partes `functionResponse` que as partes `functionCall` do turno anterior do modelo.
* **Limitação do Projeto Original:** O bridge tratava cada mensagem `role: 'tool'` isoladamente em um mapeamento 1:1 (`messages.map(openAIMessageToGemini)`), gerando múltiplos turnos `user` com 1 única parte cada. Além disso, fazia `history.pop()`, enviando apenas a última ferramenta como turno atual e deixando as anteriores separadas no histórico, rompendo a alternância e a paridade de contagem de partes do Gemini.

---

### Problema 5: Roteamento Silencioso de Modelo Estático (*Model Ignored in GeminiChat*)
* **Sintoma:** Qualquer modelo solicitado na requisição OpenAI (inclusive nomes fictícios como `gemini-4-argon` ou variantes como `gemini-2.5-pro`) retornava 200 OK com o nome do modelo solicitado no JSON de saída, sugerindo que o modelo solicitado estava sendo executado.
* **Causa Raiz:** O componente `GeminiChat` do `@google/gemini-cli-core` obtém o modelo a ser invocado na API do Google unicamente através de `this.config.getModel()`. No bridge original, a instância de `this.config` passada para `GeminiChat` era a configuração global estática iniciada no boot do servidor (que usa por padrão `gemini-2.5-flash`). O parâmetro `model` enviado no corpo da requisição OpenAI era apenas usado para logs e re-injetado no payload JSON de resposta, enquanto o backend da Google executava silenciosamente sempre o `gemini-2.5-flash`.
* **Impacto:** Modelos avançados (`gemini-2.5-pro`, `gemini-3.8-flash`, etc.) não eram realmente executados pela Google, e modelos inexistentes não geravam o erro esperado de entidade não encontrada.

---

## 3. Adaptações Implementadas no Bridge

Para resolver definitivamente as incompatibilidades sem quebrar outras integrações OpenAI-compatíveis, foram realizadas as seguintes intervenções no código-fonte em `bridge-server`:

### A. Refatoração Robusta da Sanitização de Schemas (`src/gemini-client.ts`)
Implementou-se uma política de whitelist estrita combinada com transformações idiomáticas para o padrão suportado pela API do Gemini:
1. **Whitelist Estrita de Campos Suportados:**
   ```typescript
   const ALLOWED_GEMINI_SCHEMA_KEYS = new Set([
     'type', 'format', 'title', 'description', 'nullable', 'enum',
     'maxItems', 'minItems', 'properties', 'required', 'propertyOrdering',
     'items', 'maximum', 'minimum', 'maxLength', 'minLength',
     'maxProperties', 'minProperties', 'pattern', 'example', 'anyOf', 'default'
   ]);
   ```
2. **Conversão de Limites Numéricos Exclusivos:**
   - Se `exclusiveMinimum` estiver presente e `minimum` não:
     - Para inteiros: `minimum = exclusiveMinimum + 1`
     - Para números gerais: `minimum = exclusiveMinimum`
   - O mesmo cálculo é aplicado analogamente para `exclusiveMaximum`.
3. **Conversão de Construtos OpenAPI 3.1 / JSON Schema:**
   - `const`: convertido automaticamente para `enum: [String(const)]`.
   - `enum`: todos os elementos são convertidos para `string[]` (exigência estrita do Protobuf).
   - `oneOf`: convertido para `anyOf`.
   - Arrays de tipos (ex.: `type: ["string", "null"]`): convertidos para `type: "string", nullable: true`.
   - `allOf`: fusão automática de `properties` e `required` das sub-estruturas.
   - Remoção de chaves ilegais (`$id`, `$ref`, `$defs`, `definitions`, `additionalProperties`, etc.).
   - Recursão completa em nós aninhados (`properties`, `items` e `anyOf`).

### B. Preservação de `thoughtSignature` (`src/utils/thought-signature-cache.ts`)
1. **Cache de Assinaturas Limitado em Memória:**
   Criou-se uma estrutura `BoundedMap` que guarda as assinaturas por ID de chamada de ferramenta (`toolCallId`) e por nome de ferramenta como fallback seguro contra vazamento de memória:
   ```typescript
   export const thoughtSignatureCache = new BoundedMap<string, string>(2000);
   export const lastThoughtSignatureByTool = new BoundedMap<string, string>(500);
   ```
2. **Captura na Resposta do Gemini:**
   Nos métodos de streaming e resposta completa, a assinatura do `functionCall` é extraída e propagada para o tipo de dado interno `tool_code`.
3. **Associação no Stream Transformer (`src/bridge/stream-transformer.ts` e `openai.ts`):**
   Ao gerar o `toolCallId` padrão OpenAI (`call_${name}_${uuid}`), a assinatura correspondente é registrada no cache.
4. **Injeção Automática no Histórico (`src/gemini-client.ts`):**
   Ao receber a mensagem subsequente do assistente com `tool_calls`, o bridge busca a assinatura no cache e a reanexa como `thoughtSignature` na parte enviada à API do Gemini.

### C. Testes Automatizados (`src/gemini-client.test.ts`)
Adicionou-se uma suite de testes unitários em Vitest garantindo que todas as transformações de schema permaneçam válidas e estáveis:
- Remoção de `exclusiveMinimum` e `exclusiveMaximum` com conversão de limites;
- Tratamento de floats em `exclusiveMinimum`;
- Conversão de `const` para `enum`;
- Conversão de `oneOf` para `anyOf`;
- Tratamento de tipos nulos em array (`["string", "null"]`);
- Normalização de elementos de `enum` para strings;
- Limpeza de metadados `$id`, `$ref`, `$defs`.

### D. Agrupamento em Lote e Paridade Estrita de `functionResponse` (`src/gemini-client.ts`)
Para garantir 100% de compatibilidade com chamadas paralelas de ferramentas (*parallel tool calling*):
1. **Conversão de Mensagens em Lote (`convertOpenAIMessagesToGemini`):**
   - Mensagens consecutivas com `role: 'tool'` são agrupadas em um único objeto `Content` com `role: 'user'`.
   - Cada mensagem de ferramenta é mapeada para uma parte `functionResponse`, preservando o objeto retornado ou encapsulando em `{ output: ... }`.
2. **Reordenação e Correspondência Posicional 1:1:**
   - As respostas às chamadas de ferramentas são indexadas por `tool_call_id` e ordenadas rigorosamente na mesma ordem em que os `tool_calls` foram emitidos pelo turno anterior do assistente.
3. **Fallback para Chamadas Ausentes (*Missing Response Synthesis*):**
   - Caso o cliente OpenAI falhe ou aborte uma ferramenta em lote e envie menos respostas do que chamadas, o bridge sintetiza uma resposta explicativa (`{ error: 'No response provided for this tool call' }`), garantindo que `count(functionResponse) === count(functionCall)`.
4. **Cache e Resolução Confiável de Nomes de Ferramentas:**
   - Implementação de `toolCallNameCache` e mapeamento direto a partir dos `tool_calls` da mensagem do assistente, eliminando fragilidades de parsing por regex ou split.
5. **Alternância Estrita de Papéis (`user` / `model`):**
   - Mensagens consecutivas de usuário de texto são fundidas em um único turno, e a primeira mensagem da conversa sempre inicia com o papel `user`.

### E. Proxy Dinâmico de Configuração para Roteamento Real de Modelos (`src/gemini-client.ts`)
Para garantir que o modelo enviado na requisição seja de fato o modelo acionado no backend da Google:
1. **Proxy por Requisição em `requestConfig`:**
   - Criação de um Proxy em torno de `this.config` interceptando a chamada `getModel()` e retornando exatamente o `model` da requisição HTTP atual.
   - O `GeminiChat` e o gerador de conteúdo recebem esse Proxy, enviando o parâmetro correto para a API da Google (`CodeAssistServer` / Vertex AI).
2. **Mapeamento de 404 (`model_not_found`) em `error-mapper.ts`:**
   - Caso um modelo inexistente (ex.: `gemini-4-argon`) seja solicitado, a API do Google retorna erro 404 (`Requested entity was not found`), que agora é traduzido pelo bridge em HTTP 404 com o código OpenAI `model_not_found`.

---

## 4. Suporte a Modelos Modernos e Gemini 3.8 Flash

A rota `/v1/models` do bridge (`src/bridge/openai.ts`) e as definições do OpenCode foram atualizadas para expor formalmente os seguintes modelos suportados pela API:
- `gemini-3.8-flash` *(novo padrão no OpenCode)*
- `gemini-3-flash-preview`
- `gemini-3-pro-preview`
- `gemini-2.5-pro`
- `gemini-2.5-flash`

---

## 5. Novo Versionamento e Commits no Repositório

As alterações foram integradas tanto no submódulo de build quanto no diretório-fonte principal `bridge-server`:
- **Versão:** Atualizada de `0.1.14` para `0.1.15` em `package.json`.
- **Commits Registrados no Git:**
  - `0fcc8a9` - `fix(bridge): sanitize schema keywords and preserve thought signatures (v0.1.14)`
  - `2be1301` - `feat(bridge): expose gemini-3.8-flash and gemini-3 preview models in /models`
  - *(próximo)* - `fix(bridge): enforce 1:1 parity and grouping for parallel function response turns (v0.1.15)`

---

## 6. Atualização do Gemini CLI

O binário global do **Gemini CLI** foi atualizado no ambiente do usuário via Bun:
- **Versão anterior:** `0.60.0`
- **Versão atual:** `0.66.0` (última versão estável do registro npm)
- **Comando executado:** `bun add -g @google/gemini-cli@latest`

---

## 7. Configuração Final do OpenCode

Arquivo `~/.config/opencode/opencode.json` (e espelho em `config.json`):

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "gemini-bridge": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Gemini Bridge",
      "options": {
        "baseURL": "http://127.0.0.1:8765/v1",
        "apiKey": "dummy"
      },
      "models": {
        "gemini-3.8-flash": {
          "name": "Gemini 3.8 Flash"
        },
        "gemini-3-flash-preview": {
          "name": "Gemini 3 Flash Preview"
        },
        "gemini-3-pro-preview": {
          "name": "Gemini 3 Pro Preview"
        },
        "gemini-2.5-flash": {
          "name": "Gemini 2.5 Flash"
        },
        "gemini-2.5-pro": {
          "name": "Gemini 2.5 Pro"
        }
      }
    }
  },
  "model": "gemini-bridge/gemini-3.8-flash"
}
```

---

## 8. Resultados da Validação

Todos os fluxos foram testados e aprovados com sucesso:

1. **Consulta Direta (Sem ferramentas):**
   ```bash
   opencode run "hello"
   # Saída:
   # > build · gemini-3.8-flash
   # Hello! How can I help you today?
   ```

2. **Execução Multi-turn com Ferramenta Bash:**
   ```bash
   opencode run "run whoami and echo 'test passed'"
   # Saída:
   # > build · gemini-3.8-flash
   # $ whoami && echo 'test passed'
   # miguelsb
   # test passed
   ```

3. **Verificação de Modelos no OpenCode:**
   ```bash
   opencode models | grep gemini-bridge
   # Saída:
   # gemini-bridge/gemini-2.5-flash
   # gemini-bridge/gemini-2.5-pro
   # gemini-bridge/gemini-3-flash-preview
   # gemini-bridge/gemini-3-pro-preview
   # gemini-bridge/gemini-3.8-flash
   ```

---

## 9. Gerenciador CLI Global (`gemini-bridge` / `gb`)

Para abstrair o ciclo de vida do bridge como um serviço daemon similar ao Docker/systemctl, foi criado um utilitário global instalado em `~/.local/bin/gemini-bridge` com o atalho `~/.local/bin/gb`.

### Comandos Disponíveis:
- `gb up` ou `gemini-bridge up`: Inicia o serviço do bridge em background com verificação automática de prontidão (healthcheck).
- `gb down` ou `gemini-bridge down`: Finaliza o processo do bridge de forma graciosa.
- `gb status` ou `gb ps`: Exibe o painel de status com PID, memória, uptime, portas e modelos disponíveis.
- `gb logs`: Exibe as últimas 50 linhas do log em `~/.local/state/gemini-bridge/bridge.log`.
- `gb logs -f`: Acompanha a saída de logs em tempo real (*stream*).
- `gb restart`: Reinicia o serviço com um único comando.
