# Digital English Proficiency Tests — UI, Items, Rubrics, Scores

*Test-maker sources only (web search unavailable). UNVERIFIED = not confirmable from a primary source.*

## 1. Test-session UI

| Test | Screen model | Timer | Nav / review |
|---|---|---|---|
| **TOEFL iBT 2026** | Reading & Listening **two-stage adaptive** (router → lower/upper module); Writing/Speaking linear; no breaks. [spec](https://www.ets.org/content/dam/ets-org/pdfs/toefl/toefl-ibt-test-specifications-2026.pdf) | 1 h 23–1 h 29 | **UNVERIFIED** |
| **IELTS on computer** | Listening/Reading/Writing on screen, answers typed; **Speaking face-to-face with an examiner**. On-screen **note-taking tool** (examiner never sees notes); some questions have **suggested time limits**. [test day](https://ielts.org/take-a-test/preparation-resources/on-test-day) | On-screen clock; watches banned | Paper IELTS retired **mid-2026**; "Writing on Paper" = on-screen tasks, handwritten answers [update](https://ielts.org/news-and-insights/updates-to-ielts-test-delivery) |
| **PTE Academic** | Booth with keyboard, **headset**, notepad. Speaking: **mic-open countdown**, **"Recording" → "Completed"**, **progress bar**, **one recording only**. Writing: **live word count**, **cut/copy/paste**. [format](https://www.pearsonpte.com/pte-academic/test-format/speaking-writing/) | Per-section (§6) | UNVERIFIED |
| **Duolingo** | **Computer-adaptive (CAT)**; recordings stream via `MediaRecorder` (chunked upload, 20 s start timeout) with a **"Page X of Y"** indicator; desktop **Firefox/Safari blocked**. [bundle](https://englishtest.duolingo.com/scores) | Section intros: min/max seconds | Adaptive verified; one-item screens UNVERIFIED |

Split ratios (passage vs question pane): **UNVERIFIED**.

## 2. Question types

- **TOEFL** — Reading: Complete the Words (30), Read in Daily Life (5–15), Academic Passage (5–15). Listening: Choose a Response, Conversation, Announcement, Academic Talk. Writing: Build a Sentence, Email, Academic Discussion. Speaking: Listen and Repeat, Interview. [spec](https://www.ets.org/content/dam/ets-org/pdfs/toefl/toefl-ibt-test-specifications-2026.pdf)
- **IELTS Academic** — MCQ single/multiple; True/False/Not Given; Yes/No/Not Given; four matching variants; sentence/note/table/flow-chart completion; diagram labelling; short answer. Writing: ≥150-w description, ≥250-w essay. [source](https://ielts.org/take-a-test/test-types/ielts-academic-test/ielts-academic-format-reading)
- **PTE Academic** (22 types) — Pt1: Read Aloud, Repeat Sentence, Describe Image, Retell Lecture, Answer Short Question, Summarize Group Discussion, Respond to a Situation, Summarize Written Text, Write Essay. Pt2: Fill in the Blanks (dropdown), MCQ multi, **Reorder Paragraph**, Fill in the Blanks (**drag-and-drop**), MCQ single. Pt3: Summarize Spoken Text, MCQ multi, Fill in the Blanks (type-in), Highlight Correct Summary, MCQ single, Select Missing Word, Highlight Incorrect Words, **Write from Dictation**. [source](https://www.pearsonpte.com/pte-academic/test-format/)
- **Duolingo** — Read and Select; Fill in the Blanks; Read and Complete; Listen and Type; Write/Speak About the Photo; Read Then Speak; Interactive Reading/Listening/Writing/Speaking; writing/speaking samples. [bundle](https://englishtest.duolingo.com/scores)
- **LanguageCert Academic** — gap-fill, synonym replacement, MCQ, gapped text, matching. Writing: 150–200-w report from an infographic, 250-w discursive. Speaking: questions, role play, **read aloud** (20 s prep), presentation (1 min prep, 2 min talk). [source](https://www.languagecert.org/en/language-exams/english/languagecert-academic/academic)

*UI implications: drag-and-drop/ordering need keyboard alternatives; mic tasks need state machines; passage items need synced scroll or a split pane; free text needs a word count.*

## 3. Rubrics

- **IELTS Writing** — four equally weighted criteria; **Task 2 weighted twice Task 1**: Task Achievement (T1)/Task Response (T2), Coherence & Cohesion, Lexical Resource, Grammatical Range & Accuracy. **Speaking** mirrors this: Fluency & Coherence, Lexical Resource, Grammar, Pronunciation. [scoring](https://ielts.org/take-a-test/your-results/ielts-scoring-in-detail)
- **PTE traits** — Content, Oral Fluency, Pronunciation, Form, Development/Structure/Coherence, Grammar, General Linguistic Range, Vocabulary. Items are correct/incorrect or partial credit; **Content = 0 zeroes the item**. Seven task types (Describe Image, Retell Lecture, Respond to a Situation, Summarize Group Discussion, Summarize Written Text, Write Essay, Summarize Spoken Text) also get **human Content review**. [guide](https://www.pearsonpte.com/content/dam/ELL/pte/pearsonpte/pdfs/pte-academic-pdfs/PTE-Academic-Test-Taker-Score-Guide.pdf)
- **TOEFL** — items are **Machine Scored** (selected response) or **AI Scored** (constructed response: fluency, coherence, grammar); no human rater live. **Duolingo** publishes **standard errors** (overall, Literacy/Comprehension/Conversation 5; Production 10) and bands 10–55 / 60–95 / 100–125 / 130–160. [TOEFL spec](https://www.ets.org/content/dam/ets-org/pdfs/toefl/toefl-ibt-test-specifications-2026.pdf), [DET bundle](https://englishtest.duolingo.com/scores)

## 4. Score reporting

| Test | Scale | Composition |
|---|---|---|
| **TOEFL iBT** (21 Jan 2026 onward) | **1–6**, half bands, per section + overall | Overall = **average of the four sections rounded to the nearest half band** (5.125→5; 5.25→5.5); a comparable **0–120** total (band midpoint) issued for two years. Legacy: four 0–30 sections, total = **sum**. [scores](https://www.ets.org/toefl/test-takers/ibt/scores/understand-scores.html) |
| **IELTS** | **Band 1–9**, whole/half per skill + overall | Average of four skills; **.25 → next half band, .75 → next whole**. [scoring](https://ielts.org/take-a-test/your-results/ielts-scoring-in-detail) |
| **PTE Academic** | **10–90** overall + four skills | Overall is **explicitly not the average** of skills; integrated items feed several skills. Typical minima: 36–50 foundation, 51–60 undergraduate, 57–67 postgraduate. [guide](https://www.pearsonpte.com/content/dam/ELL/pte/pearsonpte/pdfs/pte-academic-pdfs/PTE-Academic-Test-Taker-Score-Guide.pdf) |
| **Duolingo** | **10–160** overall; subscores in **5-point steps** | Certificate: Overall, **Individual Subscores** (Literacy, Comprehension, Conversation, Production), **Integrated Subscores**, speaking/writing samples, verification link. API adds SWRL reading/listening/speaking/writing subscores. [API](https://englishtest.duolingo.com/api) |
| **Cambridge English Scale** | Band per qualification → grade A/B/C + CEFR level | Per-skill scores (Reading, Writing, Listening, Speaking; Use of English in some) plus overall. [scale](https://www.cambridgeenglish.org/exams-and-tests/cambridge-english-scale/) |
| **LanguageCert Academic** | Overall + four skills; B1–C2 multilevel | Competent 57 L/60 R/64 W/70 S; Proficient 67/71/78/82; Superior 80/83/89/89. Nominal maximum **UNVERIFIED**. [DHA](https://www.languagecert.org/en/get-to-know-languagecert-academic-for-australian-visas/minimum-score-requirements) |

**Cambridge boundaries** (A/B/C/below-C, CEFR in brackets; [A2 Key](https://www.cambridgeenglish.org/exams-and-tests/key/results/), [B1](https://www.cambridgeenglish.org/exams-and-tests/preliminary/results/), [B2](https://www.cambridgeenglish.org/exams-and-tests/first/results/), [C1](https://www.cambridgeenglish.org/exams-and-tests/advanced/results/), [C2](https://www.cambridgeenglish.org/exams-and-tests/proficiency/results/)):

| Exam | A | B | C | Below C |
|---|---|---|---|---|
| A2 Key | 140–150 (B1) | 133–139 (A2) | 120–132 (A2) | 100–119 (A1) |
| B1 Preliminary | 160–170 (B2) | 153–159 (B1) | 140–152 (B1) | 120–139 (A2) |
| B2 First | 180–190 (C1) | 173–179 (B2) | 160–172 (B2) | 140–159 (B1) |
| C1 Advanced | 200–210 (C2) | 193–199 (C1) | 180–192 (C1) | 160–179 (B2) |
| C2 Proficiency | 220–230 (C2) | 213–219 (C2) | 200–212 (C2) | 180–199 (C1) |

Below these, results are reported without a certificate.

## 5. CEFR

Six levels in three bands: **Basic A1–A2, Independent B1–B2, Proficient C1–C2**. Official global-scale descriptors (abridged): **C2** understand with ease virtually everything heard or read; express self spontaneously, very fluently and precisely. **C1** understand demanding longer texts and implicit meaning; use language flexibly for social, academic and professional purposes. **B2** understand main ideas of complex text, concrete and abstract; interact with fluency and spontaneity. **B1** understand main points of clear standard input; handle most situations whilst travelling. **A2** understand sentences and frequent expressions of immediate relevance. **A1** understand familiar everyday expressions and basic phrases. [CEFR global scale, archived](http://web.archive.org/web/20260916034214/https://www.coe.int/en/web/common-european-framework-reference-languages/table-1-cefr-3.3-common-reference-levels-global-scale)

**Self-assessment**: the ELP grid offers **34 "I can…" scales** covering listening, reading, spoken interaction, spoken production and writing. [COE ELP, archived](http://web.archive.org/web/20260119065516/https://www.coe.int/en/web/portfolio/self-assessment-grid)

**Concordance**: Duolingo publishes CEFR↔DET↔IELTS↔TOEFL (C2 = 155–160; C1 = 130–150; B2 = 100–125; B1 = 60–95; A1/A2 = 10–55) [bundle](https://englishtest.duolingo.com/scores). Pearson's 2024 study (n=1,522) maps PTE↔IELTS (24–30↔4.5, 63–70↔7.0, 90↔9.0) [Pearson](https://www.pearsonpte.com/content/dam/ELL/pte/pearsonpte/pdfs/Concordance-study-summary-pte-academic-july-2025.pdf). Cambridge has a CEFR/IELTS converter [CEFR](https://www.cambridgeenglish.org/exams-and-tests/cefr/); TOEFL 2026 targets A1–C2 per item type [spec](https://www.ets.org/content/dam/ets-org/pdfs/toefl/toefl-ibt-test-specifications-2026.pdf).

## 6. Durations and section counts

| Test | Sections | Items | Time |
|---|---|---|---|
| TOEFL iBT | 4 (R/L/W/S) | R 50, L 47, W 12, S 11 | R 30, L 29, W 23, S 8 min base; **1 h 23–1 h 29** total; ~2 h allowed; no breaks [content](https://www.ets.org/toefl/test-takers/ibt/about/content.html) |
| IELTS Academic | 4 | Listening 40 (4×10), Reading 40 (3 sections, 2150–2750 words), Writing 2 tasks | L ~30, R 60, W 60, S 11–14 min; **2 h 45 min**; R/L/W are one 2 h 40 min session, no breaks [format](https://ielts.org/take-a-test/test-types/ielts-academic-test) |
| PTE Academic | 3 parts | 65–75 questions, **22 types** | Pt1 76–84, Pt2 23–30, Pt3 31–39 min; **max 2 h 15 min** [format](https://www.pearsonpte.com/pte-academic/test-format/) |
| Duolingo | Adaptive + samples | Not published | Results in **2 days**; duration UNVERIFIED [site](https://englishtest.duolingo.com/) |
| LanguageCert Academic | 4 | L 30, R 30, W 2, S 4 parts | **2 h 34 min** (L ~40, R 50, W 50, S ~14) [source](https://www.languagecert.org/en/language-exams/english/languagecert-academic/academic) |

**Contested/varying**: IELTS raw-mark→band conversion "will vary slightly from test version to test version" (averages, e.g. Listening band 7 ≈ 30/40) [scoring](https://ielts.org/take-a-test/your-results/ielts-scoring-in-detail); PTE section times **do not sum** to the total because forms are balanced [guide](https://www.pearsonpte.com/content/dam/ELL/pte/pearsonpte/pdfs/pte-academic-pdfs/PTE-Academic-Test-Taker-Score-Guide.pdf); TOEFL counts/times "may vary" as it adapts [content](https://www.ets.org/toefl/test-takers/ibt/about/content.html).
