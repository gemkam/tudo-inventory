// Server only. Ask an AI for a JSON answer from TEXT or from a PHOTO (4 Nov 2026, used by app/api/people-import).
// Same services and order as the rest of the app; each one is tried only when its key is set in Vercel:
//   text : Groq -> OpenRouter -> Mistral -> Gemini -> OpenAI -> Anthropic
//   photo: Groq qwen/qwen3.8-27b -> OpenRouter vision free -> Mistral pixtral -> OpenAI gpt-4o-mini -> Anthropic
// Returns the parsed JSON object. Throws an Error with code NO_KEY / AI_FAIL / BAD_JSON.

async function openaiStyle(url, key, models, messages, errs, maxTokens) {
  for (const model of [...new Set(models.filter(Boolean))]) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, temperature: 0, max_tokens: maxTokens, messages })
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        const c = data.choices?.[0]?.message?.content;
        const t = Array.isArray(c) ? c.map((x) => x.text || '').join('') : String(c || '');
        if (t.trim()) return t;
        errs.push(`${model}: empty answer`);
        continue;
      }
      errs.push(`${model}: ${res.status} ${data?.error?.message || ''}`.trim());
      if (res.status === 401 || res.status === 403) break;
    } catch (e) {
      errs.push(`${model}: ${e.message}`);
    }
  }
  return null;
}

async function anthropic(key, content, errs, maxTokens) {
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: 'claude-haiku-4-5', max_tokens: maxTokens, temperature: 0, messages: [{ role: 'user', content }] })
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok) return (data.content || []).map((c) => c.text || '').join('');
    errs.push(`claude: ${res.status} ${data?.error?.message || ''}`);
  } catch (e) { errs.push(`claude: ${e.message}`); }
  return null;
}

function parse(text) {
  const t = String(text || '').replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/gi, '');
  const m = t.match(/\{[\s\S]*\}/);
  try { return JSON.parse(m ? m[0] : '{}'); } catch {
    const e = new Error('The AI answer could not be read. Try again.');
    e.code = 'BAD_JSON';
    throw e;
  }
}

export async function aiJson({ prompt, text, image, maxTokens = 6000 }) {
  const env = process.env;
  const errs = [];
  let out = null;
  if (image) {
    const msgs = [{ role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: image } }] }];
    if (!out && env.GROQ_API_KEY) out = await openaiStyle('https://api.groq.com/openai/v1/chat/completions', env.GROQ_API_KEY, [env.OCR_MODEL, 'qwen/qwen3.8-27b'], msgs, errs, maxTokens);
    if (!out && env.OPENROUTER_API_KEY) out = await openaiStyle('https://openrouter.ai/api/v1/chat/completions', env.OPENROUTER_API_KEY, [env.OPENROUTER_OCR_MODEL, 'qwen/qwen2.5-vl-72b-instruct:free', 'google/gemma-3-27b-it:free', 'meta-llama/llama-4-maverick:free', 'openrouter/free'], msgs, errs, maxTokens);
    if (!out && env.MISTRAL_API_KEY) out = await openaiStyle('https://api.mistral.ai/v1/chat/completions', env.MISTRAL_API_KEY, ['pixtral-large-latest', 'mistral-small-latest', 'pixtral-12b-2409'], msgs, errs, maxTokens);
    if (!out && env.OPENAI_API_KEY) out = await openaiStyle('https://api.openai.com/v1/chat/completions', env.OPENAI_API_KEY, ['gpt-4o-mini'], msgs, errs, maxTokens);
    if (!out && env.ANTHROPIC_API_KEY) {
      const m = String(image).match(/^data:(image\/\w+);base64,(.+)$/);
      if (m) out = await anthropic(env.ANTHROPIC_API_KEY, [{ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } }, { type: 'text', text: prompt }], errs, maxTokens);
    }
  } else {
    const msgs = [{ role: 'system', content: prompt }, { role: 'user', content: String(text || '') }];
    if (!out && env.GROQ_API_KEY) out = await openaiStyle('https://api.groq.com/openai/v1/chat/completions', env.GROQ_API_KEY, [env.AI_MODEL, 'llama-3.3-70b-versatile', 'openai/gpt-oss-120b', 'meta-llama/llama-4-scout-17b-16e-instruct', 'openai/gpt-oss-20b'], msgs, errs, maxTokens);
    if (!out && env.OPENROUTER_API_KEY) out = await openaiStyle('https://openrouter.ai/api/v1/chat/completions', env.OPENROUTER_API_KEY, [env.OPENROUTER_MODEL, 'openrouter/free'], msgs, errs, maxTokens);
    if (!out && env.MISTRAL_API_KEY) out = await openaiStyle('https://api.mistral.ai/v1/chat/completions', env.MISTRAL_API_KEY, [env.MISTRAL_MODEL, 'mistral-small-latest'], msgs, errs, maxTokens);
    if (!out && env.GEMINI_API_KEY) out = await openaiStyle('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', env.GEMINI_API_KEY, [env.GEMINI_MODEL, 'gemini-2.5-flash', 'gemini-2.0-flash'], msgs, errs, maxTokens);
    if (!out && env.OPENAI_API_KEY) out = await openaiStyle('https://api.openai.com/v1/chat/completions', env.OPENAI_API_KEY, ['gpt-4o-mini'], msgs, errs, maxTokens);
    if (!out && env.ANTHROPIC_API_KEY) out = await anthropic(env.ANTHROPIC_API_KEY, `${prompt}\n\n${text}`, errs, maxTokens);
  }
  if (out) return parse(out);
  const e = new Error(errs.length ? errs.join(' | ') : 'No AI key is set in Vercel.');
  e.code = errs.length ? 'AI_FAIL' : 'NO_KEY';
  throw e;
}
