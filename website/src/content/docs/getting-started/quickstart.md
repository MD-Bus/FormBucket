---
title: Quickstart
description: From nothing to your first stored submission in about five minutes.
sidebar:
  order: 1
---

This page takes you from a fresh install to a submission you can read in the dashboard and through the API.

## 1. Deploy

Click the button below, or follow [Deploy](/getting-started/deploy/) for the command line.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/momardia54/formbucket)

You don't need any secrets or database commands for the build.

## 2. Set your admin login

Open your Worker's address (`https://<name>.<subdomain>.workers.dev`). The login page tells you which variables are missing: add `ADMIN_USERNAME` and `ADMIN_PASSWORD` as **secrets** on the Worker (dashboard steps and commands are shown on that page, and explained in [Configuration](/getting-started/configuration/)), then press *check again* and sign in.

## 3. Create a form

Enter a name such as **Contact**. Its endpoint is `https://<your-worker>/f/contact`. The form id (`contact`) never changes.

## 4. Send your first submission

From a terminal:

```bash
curl -X POST https://<your-worker>/f/contact \
  -H 'Content-Type: application/json' \
  -d '{"name":"Ada","email":"ada@example.com","message":"Hello"}'
```

Or add this to a web page (the **Integration** tab generates it for your form):

```html
<form action="https://<your-worker>/f/contact" method="POST">
  <input name="name" required>
  <input name="email" type="email" required>
  <textarea name="message"></textarea>
  <button>Send</button>
</form>
```

Open **Submissions** in the dashboard and your entry should be there. Click it to see the details. [Sending data](/guides/sending-data/) covers every format and response.

## 5. Read it from your own app

Create an API key under **API keys**, then pull only what you have not seen:

```bash
curl -H "Authorization: Bearer fbk_YOUR_KEY" \
  "https://<your-worker>/api/v1/forms/contact/consumers/my-app/pull?ack=true"
```

Run it again and you get an empty list until a new submission arrives, because the server remembers where this consumer stopped. See [Pull API](/guides/pull-api/).

## Where to go next

- **Reject bad input:** describe your fields and turn on enforcement: [Schema and validation](/guides/schema/).
- **Deal with bots:** [Spam protection and blocking](/guides/spam-protection/).
- **Forward entries:** [Webhooks](/guides/webhooks/).
- **See how visitors use your form:** [Analytics](/guides/analytics/).
- **Something not working?** [Troubleshooting](/more/troubleshooting/).
