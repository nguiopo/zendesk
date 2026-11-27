// Adaptateur OpenAI : expose la même forme d'appel que l'ancien client Gemini
// (`ai.models.generateContent({ model, contents, config })` -> `{ text }`)
// afin que les routes /api/ai/* n'aient pas à être réécrites.

export const Type = {
  OBJECT: 'object',
  STRING: 'string',
  NUMBER: 'number',
  INTEGER: 'integer',
  BOOLEAN: 'boolean',
  ARRAY: 'array',
} as const;

interface GenerateParams {
  model?: string;
  contents: string;
  config?: {
    responseMimeType?: string;
    responseSchema?: Record<string, unknown>;
  };
}

export interface AiClient {
  models: {
    generateContent(params: GenerateParams): Promise<{ text: string }>;
  };
}

const DEFAULT_MODEL = 'gpt-4o-mini';

export function getAiClient(): AiClient {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY manquante dans les secrets du serveur.');
  }
  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;

  return {
    models: {
      async generateContent({ contents, config }: GenerateParams) {
        const body: Record<string, unknown> = {
          model,
          messages: [{ role: 'user', content: contents }],
        };

        if (config?.responseSchema) {
          body.response_format = {
            type: 'json_schema',
            json_schema: { name: 'response', schema: config.responseSchema, strict: false },
          };
        } else if (config?.responseMimeType === 'application/json') {
          body.response_format = { type: 'json_object' };
        }

        const res = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const detail = await res.text().catch(() => '');
          throw new Error(`OpenAI ${res.status}: ${detail.slice(0, 300)}`);
        }

        const data = (await res.json()) as {
          choices?: Array<{ message?: { content?: string | null } }>;
        };
        return { text: data.choices?.[0]?.message?.content ?? '' };
      },
    },
  };
}
