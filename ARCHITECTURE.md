# Third Door — Core Architecture

Visual companion to [SPEC.md](SPEC.md). Diagrams are Mermaid (render in IDE/GitHub, stay editable).

---

## 1. System overview — request to result

```mermaid
flowchart TD
    User([User types one sentence]) --> Chat[Chat Interface]
    Chat --> Intent

    subgraph Brain["🧠 Intelligence Layer"]
        Intent[Intent Engine<br/>LLM · Haiku 4.5]
        Intent -->|StructuredQuery + 3-6 hypotheses| Orchestrator[Search Orchestrator]
    end

    subgraph Sources["🔌 Source Adapters (interchangeable)"]
        direction LR
        Orchestrator -->|fast, first| SB[Supabase Adapter<br/>internal data]
        Orchestrator -->|async gap-fill| AP[Apify Adapter<br/>external scrape]
        Orchestrator -.future.-> GH[GitHub Adapter]
    end

    SB --> Norm[Normalizer]
    AP --> Norm
    GH -.-> Norm

    Norm -->|raw → unified Person| IDR[Identity Resolution<br/>dedup + merge]
    IDR --> Rank[Ranking Engine<br/>LLM · Opus 4.8]
    Rank -->|score + why + concerns| Results[Results UI<br/>cards · detail]

    Results --> Refine{Refine via chat?}
    Refine -->|"focus India / exclude enterprise"| Intent
    Results --> FB[Feedback Loop<br/>👍 👎 ⭐]
    FB --> Store[(Supabase:<br/>feedback + sessions)]
    Store -.improves future ranking.-> Rank

    classDef brain fill:#ede9fe,stroke:#7c3aed,color:#000
    classDef source fill:#dbeafe,stroke:#2563eb,color:#000
    classDef core fill:#dcfce7,stroke:#16a34a,color:#000
    class Intent,Orchestrator,Rank brain
    class SB,AP,GH source
    class Norm,IDR core
```

**The two boundaries that must not leak:** the `Normalizer` (raw → `Person`) and the
`SourceAdapter` interface. Everything left of the Normalizer knows about sources; everything
right of it only knows `Person`.

---

## 2. The hybrid timing — why it "feels alive"

```mermaid
sequenceDiagram
    participant U as User
    participant UI as Chat UI
    participant I as Intent Engine
    participant SB as Supabase
    participant AP as Apify
    participant R as Ranking

    U->>UI: "Find senior AI engineers in India"
    UI->>I: parse intent
    I-->>UI: stage: Understanding ✓
    I->>SB: query (3-6 hypotheses)
    Note over UI: stage: Finding profiles…
    SB-->>R: internal matches (instant)
    R-->>UI: ranked cards appear NOW ⚡
    par background enrichment
        I->>AP: gap-fill scrape
        AP-->>R: external profiles (seconds later)
        R-->>UI: cards stream in + re-rank
    end
    Note over UI: stage: Ranking ✓
```

Internal results render immediately; Apify enrichment streams in and re-ranks live. The user
never waits on a blank screen.

---

## 3. Data layer — unified Person contract

```mermaid
classDiagram
    class Person {
        +string id
        +string name
        +string headline
        +string current_title
        +string company
        +string location
        +string summary
        +int profile_strength  // 0-100
        +int confidence_score  // 0-100
        +string last_updated
        -SourceRef[] _sources  // internal only
    }
    class Experience {
        +string company
        +string title
        +string start
        +string end
    }
    class Education {
        +string school
        +string degree
    }
    class SocialLink {
        +string type
        +string url
    }
    class SourceRef {
        +string adapter
        +string raw_id
        +float trust
    }
    Person "1" --> "*" Experience
    Person "1" --> "*" Education
    Person "1" --> "*" SocialLink
    Person "1" --> "*" SourceRef : provenance (never rendered)
```

---

## 4. Identity resolution — how duplicates collapse

```mermaid
flowchart LR
    A[Normalized profiles<br/>from all sources] --> B{Match signals}
    B --> N[Name similarity]
    B --> C[Company overlap]
    B --> S[Social URL match]
    B --> E[Experience history]
    N & C & S & E --> Score[Match confidence]
    Score -->|high| Merge[Merge → one Person<br/>combine _sources]
    Score -->|low| Keep[Keep separate]
    Merge --> Out([Deduped people])
    Keep --> Out
```

Tuning the high/low threshold is an early risk: too loose merges different people, too strict
shows visible duplicates.

---

## 5. Deployment / stack view

```mermaid
flowchart TB
    subgraph Client["Browser"]
        UI[Next.js App<br/>chat · cards · detail]
    end
    subgraph Server["Next.js API / Edge"]
        API[Route handlers]
        Orch[Orchestrator + Adapters]
        AI[LLM calls]
    end
    subgraph External["Services"]
        DB[(Supabase<br/>profiles · sessions · feedback)]
        Apify[Apify Actors]
        Claude[Anthropic API<br/>Opus 4.8 + Haiku 4.5]
    end

    UI <-->|stream| API
    API --> Orch
    Orch --> DB
    Orch --> Apify
    AI --> Claude
    Orch --> AI
    API --> DB

    classDef ext fill:#fef9c3,stroke:#ca8a04,color:#000
    class DB,Apify,Claude ext
```

---

## Legend

| Color | Meaning |
|---|---|
| 🟪 Purple | LLM-powered intelligence (intent, ranking) |
| 🟦 Blue | Source adapters (swappable) |
| 🟩 Green | Core source-agnostic logic (normalize, dedup) |
| 🟨 Yellow | External services |
