# Kello — Honest Reference Diagram

Built from the **actual scraped content** of [kello.ai](https://kello.ai/#mcp) (scraped 2026-06-22).

> ⚠️ **Honesty note:** Kello's internal architecture is NOT public. Everything in §1–§3 is
> taken verbatim from their marketing site (the user-facing flow, the 5 steps, MCP). §4 is
> clearly labeled **inference** — a reasonable guess at internals, not fact. I have not
> reverse-engineered their actual system.

Source of truth — their own copy:
- _"Its your AI Sourcer that reviews 100M profiles. Scouts 30 candidates worth calling. In 60 mins."_
- _"NO TOOLING. NO TRAINING. FREE TO TRY."_ · _"First 2 jobs are Free."_
- Company: © 2026 XXV Century Private Limited

---

## 1. The user-facing flow (100% from the site)

```mermaid
flowchart LR
    JD([User emails a JD<br/>source@kello.ai]) --> K[Kello AI Sourcer]
    K -->|within 60 mins| Inbox([Inbox:<br/>30 reviews · Excel<br/>Name / Verdict columns])
    Inbox --> Reply{User replies<br/>with feedback}
    Reply -->|"Kello learns from your reactions"| Next[Next batch]
    Next --> Inbox

    classDef io fill:#dcfce7,stroke:#16a34a,color:#000
    class JD,Inbox io
```

No dashboard, no setup — the entire product entry point is **email a job description**. Output
is an **Excel file of 30 candidates** with Name/Verdict columns. There is a feedback loop by reply.

---

## 2. The 5-step process (exact wording from the site)

```mermaid
flowchart TD
    A["01 · The Read<br/><i>'studies the job, not just the JD'</i><br/>title, level, skills, synonyms,<br/>company context, team culture"]
    B["02 · The Calibration<br/><i>'learns what great looks like at your company'</i><br/>studies past hires into the role<br/>e.g. '18 past hires · studied'"]
    C["03 · The Hypotheses<br/><i>'builds potential personas'</i><br/>2–6 personas · 4 AI Sourcers working at once"]
    D["04 · The Review<br/><i>'a thesis. And an anti-thesis.'</i><br/>why they fit + areas to go deeper"]
    E["05 · The Delivery<br/><i>'to your inbox within 60 mins'</i><br/>30 reviews · feedback loop"]

    A --> B --> C --> D --> E

    classDef step fill:#ede9fe,stroke:#7c3aed,color:#000
    class A,B,C,D,E step
```

### Step 03 fans out into parallel persona "bets" (their 4 named examples)

```mermaid
flowchart TD
    H[Hypotheses engine] --> P1[The Domain Insider<br/>'shipping consumer playback<br/>at a music/video platform']
    H --> P2[The Modern-Stack Engineer<br/>'Android eng at consumer cos.<br/>different domain, same craft']
    H --> P3[The Proven Scaler<br/>'rode hypergrowth from<br/>200 to 5,000 people']
    H --> P4[The Adjacent Specialist<br/>'iOS eng from competitor<br/>streaming apps']
    P1 & P2 & P3 & P4 --> M[Merged candidate pool → reviews]

    classDef p fill:#dbeafe,stroke:#2563eb,color:#000
    class P1,P2,P3,P4 p
```

Each candidate review carries a **thesis + anti-thesis** (their real example):
> **Arjun · Sr Android · Hotstar · 6.8 yrs**
> _Thesis:_ "Shipped Hotstar's playback rewrite through the IPL season…"
> _Anti-thesis:_ "Has only worked at one consumer-scale company…"

---

## 3. The MCP product (separate from the email flow)

```mermaid
flowchart LR
    AI([Claude or ChatGPT]) -->|custom connector<br/>kello.ai/mcp · OAuth, no API keys| MCP[Kello MCP Server]
    MCP --> Find[("Find anyone"<br/>sales · hiring · fundraising)]
    Find --> AI

    classDef mcp fill:#fef9c3,stroke:#ca8a04,color:#000
    class MCP mcp
```

Their real example prompts:
- _"Tell me everything about Rajan Anandan — fun, work, investments. I'm looking to fundraise."_
- _"Who are the eng leaders at CRED? I'm looking to onboard them as customers…"_

So Kello has **two surfaces**: (a) the async email-a-JD sourcing product, and (b) an MCP
"find anyone" connector that lives inside Claude/ChatGPT.

---

## 4. Inferred internals — ⚠️ SPECULATION, not from the site

This is a *plausible* architecture consistent with their claims. **Kello has not published this**;
treat every box as a guess.

```mermaid
flowchart TD
    JD([JD email]) -.-> Parse[?? JD parsing / extraction]
    Parse -.-> Hist[?? Lookup of past hires<br/>per company/role]
    Hist -.-> Pers[?? Persona generation<br/>2–6 'bets']
    Pers -.-> Search[?? Parallel search over<br/>'100M profiles' index]
    Search -.-> Review[?? Per-candidate scoring<br/>thesis / anti-thesis]
    Review -.-> Excel[Excel of 30 → inbox]
    Excel -.-> FB[?? Feedback learning loop]
    FB -.-> Pers

    classDef guess fill:#fee2e2,stroke:#dc2626,color:#000,stroke-dasharray: 5 5
    class Parse,Hist,Pers,Search,Review,FB guess
```

Unknowns I deliberately did **not** invent: where the 100M profiles come from, what models they
use, how "calibration on past hires" is implemented, latency/cost, or dedup logic.

---

## 5. Kello vs. Third Door — honest comparison

| Dimension | Kello (observed) | Third Door (planned) |
|---|---|---|
| Input | Email a JD | One-sentence intent in chat |
| Interaction | **Async** — wait ~60 min | **Hybrid real-time** — instant + streaming |
| Output | Excel of 30, by email | Live ranked cards + profile detail |
| Strategy fan-out | 2–6 personas, 4 sourcers | 3–6 hypotheses |
| Per-candidate reasoning | thesis + anti-thesis | match score + why + concerns |
| Feedback | Reply to email | In-app 👍/👎/⭐ |
| Source transparency | Not discussed publicly | **Explicitly hidden** (unified Person) |
| Secondary surface | MCP "find anyone" | (not in MVP) |

The shared DNA is striking: **fan out into personas → search → review with both sides → learn
from feedback.** Third Door's bet is to make that *interactive and instant* rather than batch email.
