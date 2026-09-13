/**
 * Lists Gemini/Imagen models available to your API key.
 * Run: npx tsx scripts/list-models.ts [filter]
 */
import { GoogleGenAI } from '@google/genai';
import { env } from '../src/config/env.js';

async function main() {
  const filter = process.argv[2]?.toLowerCase();
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const pager = await ai.models.list();
  for await (const model of pager) {
    if (!filter || model.name?.toLowerCase().includes(filter)) {
      console.log(model.name, '-', JSON.stringify(model.supportedActions));
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
