# Remote access with Telegram

Talk to your Oryn agents from your phone, from anywhere, while Oryn keeps
running on your computer.

**How it works.** Oryn *long-polls* the Telegram Bot API from your machine — it
asks Telegram "any new messages?" and Telegram answers. Because the connection
always goes **out** from your computer, there is nothing to expose: no public
URL, no port forwarding, no tunnel, no webhook, no cloud account. If your
computer can open a website, it can run the bridge.

**Who can use it.** Only the single Telegram account you pair. Anyone else who
finds your bot gets a polite refusal and nothing else.

Setup takes about two minutes.

---

## 1 · Create a bot with @BotFather

BotFather is Telegram's official bot for making bots.

1. Open Telegram (phone or desktop) and search for **`@BotFather`**.
   Pick the one with the **blue verification check**. Or open
   <https://t.me/BotFather> directly.
2. Tap **Start**.
3. Send **`/newbot`**.
4. BotFather asks for a **name** — this is the display name people see, e.g.
   `My Oryn`. Anything works.
5. BotFather asks for a **username** — it must be unique across Telegram and
   **end in `bot`**, e.g. `myname_oryn_bot`. If it's taken, try another.
6. BotFather replies with a message containing your **token**, which looks like:

   ```
   123456789:AAHf0x-ExAmPlE_tOkEn_DoNoTuSe-12345
   ```

   Copy it. **Treat it like a password** — anyone with the token can control
   the bot. (If it ever leaks, send `/revoke` to BotFather to get a new one.)

> Optional polish, all in BotFather: `/setuserpic` to give the bot an avatar,
> `/setdescription` for the text people see before pressing Start. You don't
> need `/setcommands` — Oryn registers its commands automatically.

## 2 · Give the token to Oryn

Pick one:

- **In the app (recommended):** open **Settings → Remote access**, paste the
  token into step 2 and press **Connect**. Within a second it shows
  `polling as @your_bot`.
- **In `.env`:** add `TELEGRAM_BOT_TOKEN=123456789:AAH…` and restart Oryn.

## 3 · Pair your Telegram account

Still in **Settings → Remote access**, step 3 shows a **QR code** and a
**pairing code**. Use whichever is easiest:

- **Scan the QR code** with your phone's camera → Telegram opens your bot →
  tap **Start**. Done.
- **Click "Open in Telegram"** on the computer → tap **Start**.
- **Type it:** send `/pair YOURCODE` to your bot.

The page updates by itself to **Paired with @you** and the bot greets you.
From now on that account is the only one the bot will answer.

## 4 · Use it

Just write to the bot like you'd write to an agent in the app.

| Command   | What it does                                                   |
| --------- | -------------------------------------------------------------- |
| `/agents` | Pick the agent or squad you're talking to (tap a button)       |
| `/new`    | Start a fresh thread with the current agent or squad           |
| `/stop`   | Interrupt the agent mid-task                                   |
| `/status` | Who you're talking to, which model, whether a turn is running |
| `/help`   | Quick reference                                                |

- While an agent works, a small status message lists its steps live
  (`$ git clone …`, `search "…"`), then the answer arrives as a normal message.
- In a **squad**, start a message with `@Name` to address a specific member,
  e.g. `@Vega what changed in the docs this week?`.
- Ask an agent to **show its screen** and the screenshot arrives as a photo.
- Threads you start from Telegram appear in the app on your computer (marked
  *via telegram*), and memory is shared: something you tell an agent on your
  phone, it remembers on your desktop.

---

## Troubleshooting

**The bot doesn't answer.**
Oryn must be running and your computer awake and online. Check the status line
in Settings → Remote access.

**"Telegram rejected the bot token."**
The token was mistyped or revoked. Copy it again from BotFather (send `/token`
there and pick your bot) and paste it.

**"Another program is using this bot token."**
Only one program can poll a bot at a time. Stop the other Oryn (or whatever
else uses the token), or create a separate bot for each machine.

**I want to switch phones / accounts.**
Settings → Remote access → **Unpair**, then pair the new account with the fresh
code.

**I'd rather not pair interactively.**
Set `TELEGRAM_OWNER_ID` in `.env` to your numeric Telegram user id (ask
`@userinfobot`), restart, and skip step 3.

## Security notes

- The token is stored in `.env` or in your local database (`data/oryn.db`) and
  never sent anywhere except to Telegram.
- Only the paired account is answered. A pairing code is single-use and is
  replaced automatically after a few wrong guesses.
- Messages travel through Telegram's servers like any Telegram chat. Don't send
  through the bot anything you wouldn't send in a regular Telegram message.
- To turn remote access off, press **disconnect** in Settings (or remove the
  token from `.env`). To kill the bot entirely, `/deletebot` in BotFather.
