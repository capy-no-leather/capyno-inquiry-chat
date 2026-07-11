const fs = require('fs');
const path = require('path');

const faq = JSON.parse(fs.readFileSync(path.join(__dirname, '../../faq.json'), 'utf8'));

const NO_MATCH_MARKER = '[NO_MATCH]';

function buildSystemPrompt() {
  const faqJson = JSON.stringify(faq.map(f => ({ question: f.q, answer: f.a })));
  return `あなたは革小物ブランド「Capy-no(カピーノ)」のカスタマーサポート担当「温泉カピバラ」です。
ブランドはカピバラをモチーフにした革小物を作っており、主なお客さまは30〜50代の女性です。
以下の「想定問答集」の内容だけを根拠にして、お客さまの質問に日本語で回答してください。

【想定問答集(JSON)】
${faqJson}

【回答のルール】
- お客さまの質問が想定問答集のどれかと意味的に近ければ、その内容をもとに自然な文章で答えてください(一言一句そのまま貼り付けなくてよい)。
- 想定問答集に無い情報は絶対に作り出さないでください。
- 該当する項目が見つからない場合は、丁寧に謝った上で、まずFAQページ([FAQページ](https://capyno.official.ec/p/00001))をご案内し、それでも解決しない場合は公式LINE([公式LINE](https://lin.ee/e5Dr0DT))から直接お問い合わせいただくようご案内してください。さらに、回答の一番最後に改行してから「${NO_MATCH_MARKER}」とだけ追記してください(この行はお客さまには表示されません)。
- 文章中でURL・リンクを紹介する場合は、URLをそのまま書かず、必ず「[リンクの説明](URL)」というMarkdown形式のリンクにしてください。想定問答集の回答中にすでにMarkdownリンクがある場合はそのままの形式を使ってください。
- 口調は丁寧語ベースですが、堅苦しすぎず温かみのある大人向けの接客トーンにしてください。
- 返信は2〜4文程度、簡潔にまとめてください。
- 挨拶や前置きは不要で、本題から答えてください。`;
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let userText;
  try {
    const body = JSON.parse(event.body || '{}');
    userText = typeof body.message === 'string' ? body.message.trim() : '';
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid request body' }) };
  }

  if (!userText) {
    return { statusCode: 400, body: JSON.stringify({ error: 'message is required' }) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server is not configured' }) };
  }

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        system: buildSystemPrompt(),
        messages: [{ role: 'user', content: userText }],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error('Anthropic API error:', response.status, errText);
      return { statusCode: 502, body: JSON.stringify({ error: 'AI API error' }) };
    }

    const data = await response.json();
    const textBlock = (data.content || []).find((b) => b.type === 'text');
    let reply = textBlock ? textBlock.text : '申し訳ございません、うまく回答を作成できませんでした。';

    if (reply.includes(NO_MATCH_MARKER)) {
      console.log('[UNANSWERED]', JSON.stringify({ time: new Date().toISOString(), question: userText }));
      reply = reply.replace(NO_MATCH_MARKER, '').trim();
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reply }),
    };
  } catch (err) {
    console.error('Unexpected error:', err);
    return { statusCode: 500, body: JSON.stringify({ error: 'Internal error' }) };
  }
};
