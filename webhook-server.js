const express = require('express');
const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;

app.post('/webhook', async (req, res) => {
  const event = req.headers['x-github-event'];
  const payload = req.body;

  if (event === 'issue_comment' && payload.issue?.pull_request) {
    const { comment, issue, repository, sender } = payload;

    const msg = `💬 *New PR Comment*
📌 PR: [${issue.title}](${issue.html_url})
👤 From: ${sender.login}
📁 Repo: ${repository.full_name}

${comment.body}`;

    await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text: msg,
        parse_mode: 'Markdown'
      })
    });
  }

  res.sendStatus(200);
});

app.listen(8080, () => console.log('Webhook listening on port 8080'));
