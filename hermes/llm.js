// OpenRouter integration: turn free-text (from Telegram) into a structured task.
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

function buildSystemPrompt(nowIso, tz) {
  return [
    'You convert a user message (in Indonesian or English) into a single structured task.',
    'Return ONLY a JSON object, no markdown, no explanation.',
    'Schema:',
    '{',
    '  "title": string,            // short task title, cleaned up',
    '  "tier": "primary"|"secondary"|"temporary",  // importance, default "primary"',
    '  "deadline": string|null     // ISO 8601 with timezone offset, or null if none mentioned',
    '}',
    `Current datetime is ${nowIso} (timezone ${tz}).`,
    'Interpret relative dates ("besok", "nanti sore", "lusa jam 3") against that current datetime.',
    'If no time is given but a date is, default the time to 09:00 local.',
    'If nothing about timing is mentioned, deadline = null.',
  ].join('\n');
}

// Parse a free-text message into { title, tier, deadline }.
// Falls back to a plain task (title = raw text) if the LLM/network fails.
export async function parseTask(text, { apiKey, model, timezone, now = new Date() }) {
  const fallback = { title: text.trim(), tier: 'primary', deadline: null };
  if (!apiKey) return fallback;

  try {
    const res = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: buildSystemPrompt(now.toISOString(), timezone) },
          { role: 'user', content: text },
        ],
      }),
    });

    if (!res.ok) {
      console.error('[llm] OpenRouter error', res.status, await res.text());
      return fallback;
    }

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) return fallback;

    const parsed = JSON.parse(content);
    const tier = ['primary', 'secondary', 'temporary'].includes(parsed.tier) ? parsed.tier : 'primary';
    let deadline = null;
    if (parsed.deadline) {
      const d = new Date(parsed.deadline);
      if (!isNaN(d.getTime())) deadline = d.toISOString();
    }
    return {
      title: (parsed.title || text).toString().trim(),
      tier,
      deadline,
    };
  } catch (err) {
    console.error('[llm] parseTask failed:', err.message);
    return fallback;
  }
}
