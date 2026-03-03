import { GoogleGenAI } from '@google/genai';
import { env } from './config/env.js';

async function main() {
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const pager = await ai.models.list();
  for await (const model of pager) {
    if (model.name?.includes('imagen')) {
      console.log(model.name, '-', JSON.stringify(model.supportedActions));
    }
  }
}

main().catch(console.error);
