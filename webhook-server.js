const express = require('express');
const app = express();
app.use(express.json());

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const GITHUB_USERNAME = 'nadialvy';
const REMINDER_INTERVAL = 60 * 60 * 1000; // 1 jam

// Simpan failed checks di memory
const failedChecks = new Map();

async function sendTelegram(msg) {
  console.log('Sending to:', CHAT_ID);
  console.log('Token exists:', !!TELEGRAM_TOKEN);

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

  console.log('EVENT:', event);
  console.log('ACTION:', payload.action);
  console.log('CONCLUSION:', payload.check_run?.conclusion);


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

  // Notif PR check gagal
  // Notif PR check gagal
  if (event === 'check_run') {
    const { check_run, repository } = payload;

    if (check_run.conclusion === 'failure' && payload.action === 'completed') {
      const checkKey = `${repository.full_name}-${check_run.id}`;

      const msg = `❌ *PR Check Failed*
📌 Check: ${check_run.name}
🔗 [View logs](${check_run.html_url})
📁 Repo: ${repository.full_name}

Fix within 1 hour or you'll get a reminder!`;

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
    }
  }

  res.sendStatus(200);
});

// Scheduler — cek tiap 5 menit
setInterval(async () => {
  const now = Date.now();

  for (const [key, check] of failedChecks.entries()) {
    const elapsed = now - check.failedAt;

    // Kirim reminder kalau udah 1 jam belum resolved
    if (elapsed >= REMINDER_INTERVAL && !check.reminded) {
      const msg = `⏰ *Reminder: PR Check Still Failing!*
📌 Check: ${check.checkName}
🔗 PR: [${check.prUrl}](${check.prUrl})
📁 Repo: ${check.repo}

It's been 1 hour and this check is still failing!`;

      await sendTelegram(msg);

      // Update reminded biar ga spam
      failedChecks.set(key, { ...check, reminded: true });
    }
  }
}, 5 * 60 * 1000); // cek tiap 5 menit

app.listen(8080, () => console.log('Webhook listening on port 8080'));
