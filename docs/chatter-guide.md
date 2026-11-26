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

## 7. Scripts and PPVs

**Scripts** are the creator's ready-made messages, the same idea as CreatorHero's
scripts. In SSAI, like CreatorHero, a folder holds scripts; each script is one message.
A script is text only, text + free media, or text + media + a price (a PPV). The
badge on each script tells you which: **Text**, **Free**, or **PPV $20**.

**Open the Scripts panel.** In a chat, click the **Scripts** button at the
top-right of the message box. A panel opens over the bottom of the chat. It
closes by itself when you load a script or switch chats, or press Esc or click
outside it.

- It first lists the creator's folders. Each shows your progress with the fan
  you have open, e.g. `3/23`.
- Click a folder to see its scripts. Each script is marked **Sent** (and **Bought**
  for a PPV he has unlocked). The next script you haven't sent is outlined and
  tagged **Next**.
- Click a script to preview it. Use the **‹ ›** arrows to move between scripts, then
  **Use** to load it (arrow keys and Enter work too).
- A script tagged **Needs media** can't be used yet: it was imported without its
  photos or videos. Ask a manager to add the media.

1. **Use** loads the script into the message box: the text, the media tiles and the
   **Price to View** chip if it has them. The fan's name is filled in for you
   (`{Fan Name}` / `{Custom Name}`);
   if he only has a raw OnlyFans id like `u12345678`, the script's fallback name
   is used, or the name is just left out. If you already had text or media in
   the box you'll be asked before it's replaced.
2. Read it over and edit freely. **Check for `[script notes]`**: anything the
   script author left in square brackets is an instruction to you, not part of
   the message. If one is still in the text when you press Send, SSAI asks
   "This message still contains script notes in [brackets]. Send anyway?" —
   Cancel jumps to the note so you can fix it.
3. **Generate** is optional and depends on the script:
   - **PPV or Free script** (has media): SSAI writes ONE short curiosity caption
     for *this* fan, in the creator's voice. It never describes the content and
     doesn't answer his last message. **Accept** puts it in the box; **Accept &
     Send** sends.
   - **Text script**: Generate writes a normal reply to the conversation, exactly
     as it does with no script loaded. Your script and its text stay where they are
     until you accept. **Accepting that reply (Accept or Accept & Send) removes
     the script's chip**: the reply isn't the script, so it won't tick the script off.
     To send the script itself, Dismiss the reply and send the script's text.
4. **Check the price** (PPV scripts). Under the chip SSAI shows its own read, e.g.
   `AI: $12 · cold lurker, first PPV must be low-risk [Use]` (`AI agrees: $20`
   when it matches). It's a second opinion only — the script's price stays unless
   you click **Use**. Click the chip to change the price by hand — free, or
   $3–$200. Send is disabled on anything else (OnlyFans would refuse it). If the
   caption card shows an amber line like **"SSAI planned a rapport beat next"**,
   the last plan SSAI made for this fan was *not* to sell yet. The caption is
   written anyway — send only if he's ready to unlock.
5. **Send**. A PPV posts a locked message; the thread shows an amber
   `$20.00 · Unpaid` pill until he buys, then green `Paid`.

**The "Script · …" chip.** A text script shows a small chip above the box,
`Script · {title} ×`. It means "when I send this, count it as that script". It
stays while you edit or generate, and goes away if you accept an AI reply
instead (see step 3). Click **×** to remove it if you've gone off
script and don't want the send to tick the script off (the text stays). It clears
by itself after you send.

**Mark sent / Unmark.** SSAI only knows about scripts sent *from SSAI*. If you
sent one from CreatorHero or OnlyFans directly, open the script's **⋯** menu in the
panel and choose **Mark sent** so progress and **Next** stay right. **Unmark**
undoes a mark you made by hand (a script that was really sent from SSAI says "Sent
from SSAI" and can't be unmarked).

**The PPV tab.** The right side of the chat has three tabs: **Fan**, **AI Intel**
and **PPV**. PPV lists every PPV (a priced message with media) sent to this fan,
newest first, whoever sent it: SSAI, CreatorHero or OnlyFans, because it reads
the chat that is open. Each card shows the price and:
- **Bought**: he unlocked it.
- **Not bought**: still locked.
- **Mass**: it went out as a mass message, not just to him.

Click a card to jump to that message in the chat.

### For managers

- **Scripts page.** Managers see **Scripts** in the sidebar. Pick the creator,
  then **New folder** or **New script** (or **⋯ → Edit** on a script). A script has a
  title, text (buttons insert the name labels), a fallback name, optional media
  from the vault (vault folders on the left, ticks survive switching folders, up to 40
  items) and a price. You can search, and reorder folders and scripts with the
  arrows or by dragging. Deleting keeps the send history.
- **Import from CreatorHero.** In CreatorHero go to Creator Settings → Scripts →
  Export, then on the Scripts page click **Import CSV** and choose the file.
  You get a preview first (folders, scripts, scripts needing media, anything
  skipped); confirm to import. A folder whose name already exists for this
  creator is skipped, never merged, and the file isn't kept.
- **Attach media to Needs media scripts.** The CreatorHero export has no media, so
  scripts that were PPV or free-media come in tagged **Needs media**. Open each
  (**⋯ → Edit**), add its media from the vault and check the price. Until then
  chatters can't use it, and it can't be sent.

Notes:
- A caption generate does not change the fan's AI Intel or memory — it is a
  caption, not a read of the conversation.
- If you load a different script while a draft is still generating, the old draft
  is thrown away when it arrives — it belonged to the previous script.
- Attaching a GIF or a file while a media script is loaded removes the script
  (they can't go in the same message).

---

## 7b. The intent bar — take control of the next message

Above the message box there is a row of buttons: **PPV**, **Re-pitch**, **CTA**, **Objection**,
**ChitChat**, **Sexting**, **Tip ask**, **Goodbye** and a **More** menu, with a small line of
counts under it (messages in the chat, messages since the last PPV). Buttons with a small arrow
(CTA, Objection, Goodbye, and Promise / Aftersale inside More) open a short list: pick one
option and the draft is written. Use them when SSAI is looping or reading the chat wrong and you
know what the next message should be. One click writes a draft for that move — it never sends
by itself. You still **Accept** or **Send**. It applies to that one message only; the next
plain Generate is SSAI back on its own pacing. The draft card says which button it came from
("Intent: Objection – Too expensive / discount").

Anything you type in the box when you click is added to the button as an extra note
("Agent note"), so you can say *how* to do it. A button can't be talked out of its job.

**Why is a button grey?** Hover it, it tells you:
- **PPV** is locked until the chat has enough messages (`8 of 12 messages`; 10 for a fan who
  has been here before) and at least 6 messages since the last PPV (`4 of 6 since the last PPV`).
- **Re-pitch** needs a PPV he hasn't opened (`No unpaid PPV`) and at least 5 messages since it
  (`3 of 5 messages since the unpaid PPV`). When it is ready it lights up.
- **Re-offer MPPV** needs a mass message he never bought (`No unbought mass PPV`).

**What each one does**
- **PPV**: opens the Scripts panel on the next PPV script you haven't sent. Pick it with **Use**
  and SSAI writes the caption for it, as in section 7.
- **Re-pitch**: nudges him to open the PPV that is already in the chat. Same price, no discount,
  no new content, no number in the text. Curiosity and a light push, not pressure.
- **Re-offer MPPV** (in **More**): takes a mass message he didn't buy and offers that same content
  to him personally, as if it were just for him. No price in the text; you attach the content and
  set the price yourself.
- **CTA 1 / CTA 2**: CTA 1 builds the personal connection that makes him want to see more (no
  offer, no price yet). CTA 2 gives him the reason to open or buy now, with curiosity (never
  describes the content, never names a price).
- **Objection**: pick what he said (Only want naked, Is it worth it?, You lied / expected more,
  Only want a body part / menu, Other girls show more for less, Too expensive / discount,
  Something for free, Bad experiences, Send a preview, Later / not now, Didn't like it). SSAI
  answers it the way the playbook says: understands him, brings it back to the connection, adds
  curiosity. It holds the price: no discount and no number in the text.
- **ChitChat**: a friendly rapport message, flirts on what he said and asks about him. No selling.
- **Sexting**: one warm-up sexting message that builds the scene and hands the next move back to
  him with a question. No PPV pitch, no price.
- **Tip ask**: one tip ask, kept vague, in her voice (spoil her / take care of her). Never an
  amount or number.
- **Goodbye**: pick Phase 1 (bounce back and pivot), Phase 2 (chill chat and vetting) or
  Phase 3 (smooth exit), one message each.
- **Promise** (More): **Ask** opens the promise ritual (the trust ask before any content);
  **Reinforce ×1** and **Reinforce ×2** are the follow-up messages after he agrees. They
  reinforce, they don't ask again.
- **Post-purchase** (More): he just opened her PPV. SSAI reacts to it and asks him one deeper
  question. No new pitch, no price.
- **Post-tip** (More): he just tipped. Real thanks plus a question about him. No content, no
  pitch, no price.
- **FreePicture** (More): opens your vault with photos only. Pick one or more photos and SSAI
  writes a short caption for them. Sending posts the photos for free (no price unless you set one)
  and does not tick any script step as sent.
- **Breadcrumb** (More): moves from chit-chat toward a pitch by dropping one scene hint tied to
  something he said. No offer, no price.
- **Hook** (More): an eye-catching first message to a new subscriber. Short, personal, easy to
  answer. No selling.
- **Follow-up** (More): he went quiet after spending. One light, warm message that calls back to
  the last specific thing he shared. No chasing, no guilt, no pitch.
- **Aftersale** (More): pick **After sexting** or **After a no**. SSAI switches into its aftercare mode:
  no selling, no pitch. After sexting it reacts and asks how he is feeling; after a no it is a warm,
  short sign-off. **Anything you typed in the box is not used for Aftersale**, and the
  draft card tells you ("Your note wasn't used for Aftersale"). If you need a specific message,
  write it yourself.

**The tag chip.** Every priced message you sent has a small chip on its bubble: **Chat PPV**,
**Mass** or **Free preview**. SSAI guesses it (it says "· auto"). Click it to correct it, or
choose Auto to clear your change. It matters because SSAI and the counts treat them differently:
an unbought **Mass** is hidden from SSAI's view of the chat (and can be re-offered), a **Chat PPV**
counts for the locks above, and a **Free preview** is not a pitch at all. The chip is shared:
every chatter on that fan sees the same one.

If a button says it is unavailable when you click, refresh the chat — the thread changed
since the page loaded.

---

## 7c. The SSAI state card — correct how SSAI reads the fan

The intent bar steers **one** message. The **SSAI state** card steers **every** message until you
change it back. It sits on the **Fan** tab, under Memory & controls, one row per setting. Each row
starts on **Auto**, which shows what SSAI currently thinks (for example `Auto · Sale` or
`Auto · Returning (from trust L3)`). Pick a value when SSAI has him wrong. That row turns blue,
the card header counts how many you set ("2 set by agent"), and SSAI follows it on every
Generate for this fan, for every chatter, until someone sets it back to **Auto**.

| Row | Values | What SSAI does |
|---|---|---|
| **Phase** | Warm up · Rapport · Link · Sale · Loop · Aftersale | Works in that stage of the playbook. **Warm up** = short, light, friendly replies, no selling and no personal questions yet: get him talking. |
| **RLS beat** | 1–12 | Writes the message for that beat of the RLS script. After you send it and he replies, it moves to the next beat by itself (stops at 12). |
| **Fan type** | New · Returning · Spender | Treats him as new, as someone who has been here before, or as a buyer. Returning/Spender also use the 10-message PPV rule. |
| **Lane** | Normal · Sex-only · Rude | **Sex-only**: keeps it sexual and short, moves to paid content sooner, never gives explicit content free. **Rude**: stays calm and short, states one clear boundary, no selling while he's rude, doesn't argue or chase. |
| **Posture** | Normal · Frame-hold · Timewaster | **Frame-hold** is for a fan fishing for free validation or free pics: she teases without confirming and holds back without rejecting him. |
| **Trust** | L1–L5 | The same trust level as the Memory card (setting it locks it there too). |
| **Promise** | Not asked · Asked · Reinforced ×1 · Reinforced ×2 | Where the promise ritual stands, so SSAI doesn't re-ask a promise he already made. |
| **Language** | ES · EN | Replies only in that language. Shown only for creators marked bilingual on the Creator Models page. |
| **Support mode** | Off · On | See below. |

**Two settings beat the card.** The **Mark as timewaster** box on the Fan tab wins over Posture:
while it is ticked the Posture row is grey and reads "Timewaster (flag on Fan tab)". And an
intent button still decides its own one message; the card is the background it works in.

**Support mode** is for a fan who is going through something (illness, a loss, a crisis). While it
is on, SSAI only helps, reassures and is kind, and **nothing can sell**: the PPV, Re-pitch,
Re-offer MPPV, CTA, Tip ask, Promise and FreePicture buttons are grey ("Support mode is on — no
selling."), a priced script won't load or send, and the server refuses a priced send even if the
page is out of date. Free media and plain messages still go. A **Support mode** pill shows in the
thread header so nobody forgets it is on. Turn it off on the card when he's ready.

**The counts line** under the intent bar now also shows, when they matter:
- `last rung $21 → next $35`: the last PPV he bought and the next price on the creator's ladder
  (set on the Creator Models page; default $12 / $21 / $35 / $49 / $69 / $100). When a loaded PPV
  script has a different price, the price chip offers `Ladder: $35 [Use]`. It never changes the
  price unless you click **Use**.
- `objections 3`: how many of his objections SSAI has answered in this conversation. At 3 the
  **FreePicture** button lights up ("He's objected 3 times — a free teaser can help").
- `sex-only 2`: how many times he has pushed for sexual content without buying. At 2 the **PPV**
  button lights up when it is unlocked ("He keeps pushing for sexual content — time to sell").

Both counts go up once per fan message when you **Accept** or send a draft (accepting two drafts
for the same message counts once), and go back to 0 when he buys a PPV or the chat goes quiet for
12 hours.

---

## 8. Known limits (today)

- **SSAI suggests a price, but doesn't pick the script yet.** You choose the script;
  SSAI writes the caption and offers a price you can Use or ignore. The price
  read only appears after you Generate on a media script. Tip requests are still
  not sendable from the CRM.
- **Mass PPVs are handled automatically.** A locked mass message (MPPV) the fan
  hasn't bought carries the **Mass · auto** tag chip on its bubble (§7b) and SSAI
  ignores it, so it no longer paces as if you'd already pitched him. A bought one
  counts as a real purchase. If SSAI guessed wrong, click the chip and pick the
  right tag (**Chat PPV** / **Mass** / **Free preview**).
- **It only sees the loaded page** (~last 100 messages). Ancient history lives
  in the memory log — keep it good.
- **One draft at a time, per chat.** Generating again replaces the pending draft.
