const express = require('express');
const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_USERNAME = 'nadialvy';
const REMINDER_INTERVAL = 60 * 60 * 1000;

const failedChecks = new Map();
let lastFailedContext = null; // simpan context PR terakhir yang gagal

async function sendTelegram(msg, chatId = CHAT_ID) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: msg,
      parse_mode: 'Markdown'
    })
  });
}

async function fetchGithubLogs(logsUrl) {
  try {
    const res = await fetch(logsUrl, {
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json'
      }
    });

    if (!res.ok) return null;

    const text = await res.text();
    return text.substring(0, 3000); 
  } catch (err) {
    console.error('Failed to fetch logs:', err);
    return null;
  }
}

async function fetchCheckRunDetails(repo, checkRunId) {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/check-runs/${checkRunId}/annotations`,
      {
        headers: {
          'Authorization': `Bearer ${GITHUB_TOKEN}`,
          'Accept': 'application/vnd.github+json'
        }
      }
    );

    if (!res.ok) return null;
    const annotations = await res.json();
    return annotations.map(a => `${a.path}:${a.start_line} — ${a.message}`).join('\n');
  } catch (err) {
    console.error('Failed to fetch annotations:', err);
    return null;
  }
}

async function askClaude(userMessage, context = null) {
  const systemPrompt = context
    ? `You are a helpful coding assistant. The user is asking about a failed GitHub Actions check. Here is the context of the failure:\n\n${context}\n\nHelp the user understand what went wrong and how to fix it.`
    : `You are a helpful coding assistant integrated into a Telegram bot. Answer concisely.`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }]
    })
  });

  const data = await res.json();
  return data.content?.[0]?.text || 'No response from Claude';
}

// Handle pesan masuk dari Telegram
app.post('/telegram', async (req, res) => {
  const message = req.body.message;
  if (!message?.text) return res.sendStatus(200);

  const chatId = message.chat.id;
  const text = message.text;

  console.log('Telegram message:', text);

  try {
    // Kalau ada context PR gagal, kirim ke Claude sekalian
    const reply = await askClaude(text, lastFailedContext);
    await sendTelegram(reply, chatId);
  } catch (err) {
    console.error('Claude error:', err);
    await sendTelegram('Sorry, something went wrong.', chatId);
  }

  res.sendStatus(200);
});

// GitHub webhook handler
app.post('/webhook', async (req, res) => {
  const event = req.headers['x-github-event'];
  const payload = req.body;

  console.log('EVENT:', event);
  console.log('ACTION:', payload.action);
  console.log('CONCLUSION:', payload.check_run?.conclusion);

  if (event === 'issue_comment' && payload.issue?.pull_request) {
    const { comment, issue, repository, sender } = payload;
    const msg = `💬 *New PR Comment*
📌 PR: [${issue.title}](${issue.html_url})
👤 From: ${sender.login}
📁 Repo: ${repository.full_name}

${comment.body}`;
    await sendTelegram(msg);
  }

  if (event === 'issues') {
    const { action, issue, repository, sender } = payload;
    if (action === 'assigned' && issue.assignee?.login === GITHUB_USERNAME) {
      const msg = `📋 *Issue Assigned to You*
📌 Issue: [${issue.title}](${issue.html_url})
👤 By: ${sender.login}
📁 Repo: ${repository.full_name}

${issue.body?.substring(0, 200) || ''}`;
      await sendTelegram(msg);
    }
  }

  if (event === 'check_run') {
    const { check_run, repository } = payload;

    if (check_run.conclusion === 'failure' && payload.action === 'completed') {
      const checkKey = `${repository.full_name}-${check_run.id}`;

      // Fetch annotations/error detail dari GitHub
      const annotations = await fetchCheckRunDetails(
        repository.full_name,
        check_run.id
      );

      // Simpan context buat Claude
      lastFailedContext = `
Repo: ${repository.full_name}
Check: ${check_run.name}
Status: Failed
Logs URL: ${check_run.html_url}
${annotations ? `\nError annotations:\n${annotations}` : ''}
      `.trim();

      const msg = `❌ *PR Check Failed*
📌 Check: ${check_run.name}
🔗 [View logs](${check_run.html_url})
📁 Repo: ${repository.full_name}
${annotations ? `\n⚠️ Errors:\n\`\`\`\n${annotations.substring(0, 500)}\n\`\`\`` : ''}

_Chat ke bot ini untuk tanya Claude kenapa gagal!_`;

      await sendTelegram(msg);

      failedChecks.set(checkKey, {
        checkName: check_run.name,
        prUrl: check_run.html_url,
        repo: repository.full_name,
        failedAt: Date.now(),
        reminded: false
      });
    }

    if (check_run.conclusion === 'success') {
      const checkKey = `${repository.full_name}-${check_run.id}`;
      failedChecks.delete(checkKey);
      lastFailedContext = null; // clear context kalau udah fixed
    }
  }

  res.sendStatus(200);
});

setInterval(async () => {
  const now = Date.now();
  for (const [key, check] of failedChecks.entries()) {
    if (now - check.failedAt >= REMINDER_INTERVAL && !check.reminded) {
      const msg = `⏰ *Reminder: PR Check Still Failing!*
📌 Check: ${check.checkName}
🔗 [View logs](${check.prUrl})
📁 Repo: ${check.repo}

It's been 1 hour and this check is still failing!`;
      await sendTelegram(msg);
      failedChecks.set(key, { ...check, reminded: true });
    }
  }
}, 5 * 60 * 1000);

app.listen(8080, () => console.log('Webhook listening on port 8080'));