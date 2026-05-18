const express = require('express');
const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const GITHUB_USERNAME = 'nadialvy';

async function sendTelegram(msg) {
  await fetch(`https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: `${CHAT_ID}`,
      text: msg,
      parse_mode: 'Markdown'
    })
  });
}

app.post('/webhook', async (req, res) => {
  const event = req.headers['x-github-event'];
  const payload = req.body;

  // Notif PR comment
  if (event === 'issue_comment' && payload.issue?.pull_request) {
    const { comment, issue, repository, sender } = payload;

    const msg = `💬 *New PR Comment*
📌 PR: [${issue.title}](${issue.html_url})
👤 From: ${sender.login}
📁 Repo: ${repository.full_name}

${comment.body}`;

    await sendTelegram(msg);
  }

  // Notif issue assigned ke kamu
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

  res.sendStatus(200);
});

app.listen(8080, () => console.log('Webhook listening on port 8080'));
