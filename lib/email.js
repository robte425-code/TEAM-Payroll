const { ServerClient } = require("postmark");

let client = null;

function emailConfigured() {
  return Boolean(
    process.env.POSTMARK_SERVER_TOKEN?.trim() && process.env.EMAIL_FROM?.trim()
  );
}

function getClient() {
  if (!emailConfigured()) {
    throw new Error(
      "Postmark is not configured. Set POSTMARK_SERVER_TOKEN and EMAIL_FROM in Vercel."
    );
  }
  if (!client) {
    client = new ServerClient(process.env.POSTMARK_SERVER_TOKEN.trim());
  }
  return client;
}

async function sendEmail(input) {
  const messageStream = process.env.POSTMARK_MESSAGE_STREAM?.trim() || "outbound";
  await getClient().sendEmail({
    From: process.env.EMAIL_FROM.trim(),
    To: input.to,
    ReplyTo: input.replyTo,
    Subject: input.subject,
    HtmlBody: input.html,
    TextBody: input.text,
    MessageStream: messageStream,
  });
}

module.exports = {
  emailConfigured,
  sendEmail,
};
