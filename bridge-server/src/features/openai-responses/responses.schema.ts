/**
 * @license
 * Copyright 2026 Miguel de Sousa Batista
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from "zod";

const ResponsesApiContentPartSchema = z.looseObject({
  type: z.string(),
  text: z.string().optional(),
  image_url: z
    .looseObject({
      url: z.string(),
    })
    .optional(),
});

const ResponsesApiInputItemSchema = z.looseObject({
  type: z.string(),
  role: z.string().optional(),
  content: z.array(ResponsesApiContentPartSchema).optional(),
});

export const ResponsesApiRequestBodySchema = z.looseObject({
  model: z.string().optional(),
  input: z.array(ResponsesApiInputItemSchema).optional(),
  tools: z.array(z.unknown()).optional(),
  tool_choice: z.unknown().optional(),
});

export type ResponsesApiRequestBody = z.infer<typeof ResponsesApiRequestBodySchema>;
