# SSAI Chatter Guide — How to Talk to SSAI

*For chatters working in the SSAI Conversations page. Last updated 2026-10-30.*

SSAI is not a magic button — it is a copilot you steer. This guide shows every
control you have, what it actually does, and what to type when SSAI is going in
the wrong direction.

---

## 1. What SSAI reads before it writes

Every time you press **Generate**, SSAI looks at:

- **The conversation on your screen** — the loaded messages (about the last 100),
  including who sent what, PPVs and whether they were opened, tips, and timing.
- **The fan's money history** — lifetime spend, tips, subscription status
  (pulled live from OnlyFans).
- **The Fan tab** — the memory log, the fan note, and the control toggles
  (timewaster, sexting mode, tip mode). See section 4.
- **Rejected drafts** — everything you rejected in this conversation, with your
  reasons. See section 3.
- **Your context box text** — if you typed something, it steers this draft.
  See section 2.
- **The creator's local clock** — SSAI knows what time it is *for the model*,
  so "good morning" lands correctly.

**What this means for you:** if SSAI "doesn't get it", one of these inputs is
missing or wrong. Fix the input instead of regenerating five times and hoping.

---

## 2. The context box (the "agent override" box)

The text field above Generate with the placeholder
*"e.g. he just tipped $50 · coming back after 2 weeks cold · …"* is the most
direct way to change SSAI's direction. Whatever you type goes straight into the
AI's instructions for the **next draft**.

### What to put in it

Two kinds of text work well — **facts SSAI can't see** and **direct orders**:

| Situation | Type this |
|---|---|
| He tipped on another platform / off-screen | `he just tipped $50, thank him` |
| Fan came back after a long silence | `coming back after 2 weeks cold, re-engage soft` |
| You're setting up a PPV | `about to send a PPV, run the promise ritual` |
| SSAI keeps trying to sell too early | `don't sell yet, keep it chitchat` |
| You want a specific topic | `ask about his trip to Vegas` |
| You want her to continue a story she started | `finish her bath story from earlier` |
| Fan is upset | `he's annoyed about the last PPV price, de-escalate, no selling` |
| Language | `answer in Spanish` |

### Rules that make it work

- **Be short and concrete.** One or two instructions. A paragraph of vague
  wishes gets diluted; `don't sell yet, ask about his dog` works.
- **It stays on until you clear it.** The box keeps steering every next draft
  until you empty it. If drafts feel "stuck" on an old instruction, check the
  box — the UI shows a marker on Generate when context is set, and there is an
  **✕** to clear it.
- **Orders beat the brain.** When you give a direct order ("send the goodbye",
  "pitch now"), SSAI follows *your* call even if its own strategy wanted
  something else. That's intentional — you are the pace-keeper.
- **It steers, it doesn't teach.** The box affects the next draft only. To make
  SSAI *stop repeating a mistake* for the whole conversation, use **Reject**
  instead (next section).

---

## 3. Reject & regenerate — teaching SSAI mid-conversation

When a draft is wrong, you have two buttons. They are not the same:

- **Dismiss** — throws the draft away. SSAI learns **nothing**. The same
  mistake can come straight back.
- **Reject** — asks you *why* ("Why wasn't this good? e.g. don't sell yet, ask
  about his dog"), then regenerates. Every later draft **in this conversation**
  sees your rejected draft + reason as "mistakes to learn from".

**Use Reject whenever the problem is a pattern**, not just a weak line:
selling too early, wrong tone, repeating itself, ignoring something the fan
said. Use Dismiss only when the draft is merely "meh".

How rejections behave:

- They apply to **this conversation only** and expire after the chat goes
  quiet for ~12 hours. A fresh conversation starts clean.
- They are **shared** — if a shift change happens, the next chatter's drafts
  avoid the same mistakes. They survive page reloads.
- Up to **5 at a time** (newest kept). The composer shows the active ones under
  **"SSAI is avoiding · this conversation"**, each with a remove button — remove
  one when it no longer applies ("don't sell yet" must go once it's time to sell!).

**Good rejection reasons** are instructions, not complaints:
`don't sell yet` · `too long, keep it under 2 lines` · `he already told you his
name is Mark, use it` · `stop asking questions, make statements`.

---

## 4. The Fan tab — memory & controls

Open the right rail's **Fan** tab. The "Memory & controls" card is persistent
fan knowledge that feeds every generation:

- **Timewaster** — flip this on and SSAI switches to its timewaster posture
  (stops investing, stops chasing). Flip it off when he starts paying.
- **Sexting mode** — allows/blocks the explicit lane for this fan.
- **Tip mode** — AUTO (SSAI decides), FORCE_ON (always work toward tips),
  FORCE_OFF (never ask).
- **Memory log** — a dated log of key facts about the fan. SSAI writes one
  entry per conversation automatically; **you can edit it**. Anything you type
  is protected — the AI appends below your text, never rewrites it. Put real
  intel here: job, kids, kinks, what he buys, what made him tip.
- **Field locks** — trust level / archetype / temperature are auto-managed by
  the AI. If you set one manually it locks (🔒) and the AI stops touching it;
  unlock to hand it back.
- **Fan note** — the OnlyFans note on the fan (📝 in the thread header). SSAI
  reads it too, so notes like "whale, loves feet, wife doesn't know" genuinely
  change the drafts.

**The AI Intel tab** (right rail) shows *why* SSAI did what it did after each
generation: temperature, phase, customer type, next move, warnings. When a
draft surprises you, read it before rejecting — often the fan's spend or an
old rejection explains the move.

---

## 5. "Is this a bug?" — behaviors that are by design

- **The model spoke last → SSAI writes a follow-up, not a reply.** If the fan
  hasn't answered yet, SSAI will NOT answer the model's own question or continue
  her last message — it opens a new light topic, or names how long he's been
  quiet. That's correct behavior. If you *want* her to continue her own thought,
  say so in the context box (`finish her bath story`).
- **"generation failed register check" sometimes appears.** SSAI threw away a
  draft that looked like leaked AI reasoning. Just generate again.
- **Generation takes 25–45 seconds.** Work another chat meanwhile — the row
  shows a spinner, then a green **Ready** pill, and you get a toast + sound
  when it's done (configurable in the bell menu).
- **A draft you generated stays waiting** until you Accept, Send, Reject or
  Dismiss it — even if you navigate away and come back.

---

## 6. Quick recipes

| I want SSAI to… | Do this |
|---|---|
| Change direction for the next message | Type it in the context box |
| Stop repeating a mistake all conversation | **Reject** the draft with the reason |
| Treat this fan as a timewaster | Fan tab → Timewaster ON |
| Never ask this fan for tips | Fan tab → Tip mode FORCE_OFF |
| Remember a fact forever | Fan tab → add it to the memory log |
| Use the fan's name | It does automatically — if not, put the name in the memory log |
| Write in another language | Context box: `answer in Spanish` |
| Be shorter / less emoji | Reject with `too long` / `less emojis` — it sticks |
| Sell / not sell right now | Context box: `pitch the PPV now` / `don't sell yet` |

---

## 7. Sending a PPV

The right rail has a **PPV** tab: the creator's saved PPV sets (media + price +
a default caption), the same idea as CreatorHero's PPV tab. Managers create them
right there: **PPV tab → New set → Add media from the vault** opens the vault
picker (folders on the left, media on the right — ticks survive switching
folders, up to 40 items) → **Add** → name, price, caption → **Create set**.
To change one later: **⋯ → Edit** on its card (**Change media** reopens the
picker with the set's media already ticked; the × on a tile removes it).

1. Open the fan's chat → **PPV** tab → click a set. It loads into the composer:
   the media tiles, a **Price to View** chip, and the default caption. If you
   already had text or media in the box you'll be asked before it's replaced.
2. Click **Generate caption** (the sparkle button). SSAI writes ONE short
   curiosity caption for *this* fan, in the creator's voice — it never
   describes what's in the content, and it does not answer or continue the
   fan's last message. **Accept** puts it in the box; **Accept & Send** sends.
3. Check the price. Click the chip to change it — free, or $3–$200. Send is
   disabled on anything else (OnlyFans would refuse it).
4. **Send PPV $20** posts a locked message. The thread shows an amber
   `$20.00 · Unpaid` pill until he buys, then green `Paid`.

Notes:
- The card's **Sent / Bought** pill is for the fan you have open. It only knows
  about PPVs sent *from SSAI* — a set sent from CreatorHero or OnlyFans directly
  shows no pill.
- A caption generate does not change the fan's AI Intel or memory — it is a
  caption, not a read of the conversation.
- Attaching a GIF or a file while a set is loaded removes the set (they can't
  go in the same message).

---

## 8. Known limits (today)

- **SSAI doesn't pick the set or suggest the price yet.** You choose the set and
  keep or change its price; SSAI writes the caption. Tip requests are still
  not sendable from the CRM.
- **Mass PPVs are handled automatically.** A locked mass message (MPPV) the fan
  hasn't bought shows a `· Mass` label on its pill and SSAI ignores it, so it no
  longer paces as if you'd already pitched him. A bought one counts as a real
  purchase. If it ever looks wrong, the context box still wins:
  `the locked message was a mass PPV, not ours`.
- **It only sees the loaded page** (~last 100 messages). Ancient history lives
  in the memory log — keep it good.
- **One draft at a time, per chat.** Generating again replaces the pending draft.
