---
date: 2026-09-21

developer: Sarujanan

project: Ask the Digit – Knowledge Interface

project_code: ATDK

phase: Development - Phase 02

requirement_id: REQ-01

deliverable_id: D04

status: In Progress

evidence_location:
- /library (Document Library page)
- /api/library/ask
- /api/library/document/:id
- /api/cron/conversations
- audit_logs (action conversation.deleted, record_id conversation-retention, id 160)
- drive_document_cache (truncated once, 8 rows)
- /, /login, /library and /admin (logo and favicon)
- public/logo-mark.png, favicon.ico, favicon-32.png, apple-touch-icon.png
- Provider probe and latency measurements (recorded inline below; scratch scripts were deleted after use)
- Validation logs
- Build logs
- Lint reports
- TypeScript validation

blos_keys_used:
- single_document_isolation
- document_qa_refusal_rule
- ai_provider_fallback_order
- document_cache_freshness
- conversation_retention_days

hardcoded_thresholds:
- Conversation retention: 7 days, measured from chat_sessions.started_at (src/lib/services/conversations.service.ts:83)
- Retention schedule: daily at 00:00 (vercel.json:3)
- Provider first-token timeout: 20000 ms, env-overridable through AI_FIRST_CHUNK_TIMEOUT_MS (src/lib/ai/gateway.server.ts:36)
- Drive modifiedTime trusted for 60 seconds before Drive is asked again (src/lib/services/google-drive.server.ts:142)
- Drive cache TTL when modifiedTime is unavailable: 30 minutes (src/lib/services/google-drive.server.ts:51)
- Document Library tree cache: 10 minutes, raised from 2 (src/lib/services/google-library.server.ts:122)
- Whole-document prompt budget: 96000 characters, about 24000 tokens (src/lib/services/library-ai.server.ts:27)
- Gemini thinking level for document Q&A: minimal, sent only when the configured model starts with gemini-3 (src/routes/api/library.ask.ts:118)
- Browser cache for the library tree and an opened document: 5 minutes (src/routes/library.tsx:100)
- External limits observed, not configurable here: Gemini 3 free tier 20 requests per day per model; Groq free tier 8000 tokens per minute

three_am_standard: TRUE

llm_queryable: TRUE

company_knowledge_candidate: TRUE

domain: AI Knowledge Management

Today's Task:
- Add only the Shopify Workbench BGCT to the existing policy dashboard (the Document Library), which already shows documents from the Google Sheet with a chat section, so users can click and directly refer to the Shopify BGCT documents
- Find why the Document Library AI was slow and unreliable, and fix it

Task Assigned By: Mayuri

User: Management Team

Expected Benefit:
- Users can quickly access and refer to the Shopify Workbench BGCT documents directly from the existing policy dashboard, making policy information easier to find and use
- Users get faster and more dependable answers from the Document Library AI, and questions the document can answer are no longer refused

Benefit status: Partial — answer quality and lookup latency verified locally; production benefit depends on deployment, Vercel environment changes and the Gemini quota decision

---

# SYSTEM STATE

The Document Library (/library) is a separate path from the Admin Knowledge system. It reads its hierarchy from a Google Sheet, reads documents from Google Drive through a service account, caches each document's extracted text in drive_document_cache, and answers questions by placing the whole selected document in the prompt. It uses no chunking, no embeddings and no knowledge_chunks. The Admin Knowledge system, the public chatbot and department/Shared retrieval were not changed.

The AI was reported as slow and unreliable. In the Document Library, questions that the document could answer — explain the document, explain it in Tamil, explain the images — returned "I couldn't find that information in this document."

A conversation-retention job (purgeOlderThan, the /api/cron/conversations route and a vercel.json cron entry) was already in the repository but had never been run. 97 chat sessions older than 7 days were still in the database.

The product's logo was a navy tile with a white letter D, drawn separately in eight places, and the favicon was a matching favicon.svg.

---

# WHAT CHANGED TODAY

Two further requests from the developer were handled in the same session and are recorded below: keeping only the last 7 days of conversation history, and replacing the logo and favicon.

Investigated the slowness by replaying the reported questions through the real gateway and measuring every step, instead of reasoning from the code. Six causes were found. The primary model, gemini-3-flash-preview, is limited to 20 requests per day on the free tier, so after that limit every request moved down the fallback chain. Both fallbacks were misconfigured: Groq's llama-3.3-70b-versatile and OpenRouter's :free model both returned 404, so every fallback ended on the self-hosted Qwen, which took 8.8 seconds to the first word on the first question against a document. Every question also read the 2.5 MB reading copy of the document from Postgres although the AI needs only about 3.7 KB. Gemini 3's default thinking used 334 to 863 hidden tokens to write an 11-token answer. The gateway did not recognise the abort chunk that the SDK sends when a provider stalls, so it committed to the dead provider and returned an empty answer. The prompt refused requests for another language, an overview or images.

Fixed the gateway so a timed-out provider counts as a failure and the next provider takes over (src/lib/ai/gateway.server.ts:202). Added optional per-call provider options to the gateway; the general chatbot passes none and is unchanged (src/lib/ai/gateway.server.ts:141). Corrected the Groq default model to openai/gpt-oss-120b in code, in .env and in .env.example (src/lib/ai/providers.server.ts:58).

Changed the Drive cache read so the reading copy is loaded only when the viewer asks for it, using a CASE expression in the query (src/lib/services/google-drive.server.ts:204). Added a 60-second memo for Drive modifiedTime so a question no longer costs a Drive round trip. Raised the tree cache from 2 to 10 minutes. Stopped the page from re-downloading the large document on every browser tab focus (src/routes/library.tsx:100).

Rewrote the document prompt so it answers requests to explain, summarise, translate or walk through the document, and refuses only when the information is genuinely absent (src/lib/services/library-ai.server.ts:107). The AI copy of a document now keeps each screenshot's position as a numbered marker, [Screenshot N], instead of dropping it (src/lib/services/google-drive.server.ts:131). Sent Gemini's thinkingLevel minimal for document Q&A only (src/routes/api/library.ask.ts:118). Truncated drive_document_cache once so rows written without markers were not served as fresh.

Retention: reviewed the existing implementation, then ran purgeOlderThan() once through the same function the cron uses. It deleted 97 sessions with cutoff 2026-09-14T03:57:11Z. Generated a local CRON_SECRET, which was missing, and tested the endpoint. It returned 401 with no header, 401 with a wrong secret, and 200 with {"deleted":0} with the correct secret.

Measured results. Document lookup per question went from 7.6, 1.2, 3.8 and 0.7 seconds to 0.4, 0.05, 0.65, 0.05 and 0.26 seconds. On five answerable questions Gemini flash-lite went from 2 of 5 answered to 5 of 5, and Groq from 3 of 5 to 4 of 5, where the fifth was a rate limit rather than a prompt failure. All off-topic control questions were still refused, 10 of 10 in the prompt comparison. That comparison used the wording before the final tightening of the screenshot instruction; the final wording was checked end to end only, where it refused 3 of 3. Through the real gateway the final run answered 5 of 5 and refused 3 of 3; Groq answered 5 of the 8 requests and Qwen 3.

Replaced the logo and favicon with the DigitWeb Lanka mark. One shared component, BrandLogo (src/components/brand-logo.tsx), now replaces the eight hand-drawn D tiles: the public chat header and its two bot avatars, the admin sidebar, the Document Library header, the login page brand panel and its mobile row, and the admin conversation transcript avatar. The mark is shown on a white tile, because the source image is dark navy on a white background with no transparency and would disappear on the navy headers. Only the emblem is used: the wordmark under it is 7 pixels tall in the 200 by 200 source image and cannot be read at any size the interface shows. The favicon set is favicon.ico (16, 32 and 48 pixels), favicon-32.png and an opaque 180 pixel apple-touch-icon.png, linked from src/routes/__root.tsx. The old public/favicon.svg was deleted so it cannot override them. Checked by screenshots in headless Chrome of the chat page, the login page on desktop and mobile, and the Document Library header; TypeScript, ESLint and the production build passed.

---

# POSTGRESQL / MCP FINDING

Reading a wide column over the Neon HTTP driver is expensive and variable. Reading the 2.5 MB display_text column took 950 to 4800 ms, against 50 to 210 ms for the 3.7 KB extracted_text in the same row. A column the caller does not use must not be selected. Wrapping it as CASE WHEN param::bool THEN column END keeps it out of the response entirely.

The Neon HTTP driver returns timestamptz as a JavaScript Date. Comparing it to Drive's ISO string with === is always false. Compare instants with getTime(). The current cache code already does this.

Retention deletes cascade as designed. From chat_sessions the delete reaches chat_messages, message_citations and feedback. Counts before and after: sessions 137 to 40, messages 244 to 68, citations 769 to 261. knowledge_gaps stayed at 31 and ai_provider_logs stayed at 0. The schema sets gap and provider-log links to NULL rather than deleting them; the counts confirm the rows survived, but the cleared links were not individually inspected.

audit_logs.actor_id is nullable, so a system-triggered deletion is recorded with no user. The audit entry for this purge is id 160, source retention, retentionDays 7.

---

# GAP FOUND

Gemini 3 flash preview allows 20 requests per day on the free tier (quota id GenerateRequestsPerDayPerProjectPerModel-FreeTier). The primary model is effectively unavailable for most of a working day. Enabling billing on the Google project is the real fix and is an owner decision, not made today.

The OpenRouter fallback still returns 404. The working slug is the paid version of the same model, so it was not changed without an owner decision on cost.

Groq's free tier allows 8000 tokens per minute. A document above roughly 7000 tokens can never be answered by Groq and goes to Qwen. Qwen's first token measured 8.8 seconds cold and 26 seconds total for a long summary. Some warm requests returned the first word in about 0.9 seconds; the cause was not investigated.

The AI cannot see screenshots. The markers give only their position. Real image understanding needs a vision-capable model. Only Gemini in this chain supports images, and it would add image tokens, latency and quota use per request. It was not implemented.

The new prompt was not re-verified on gemini-3-flash-preview itself because its daily quota was exhausted. It was verified on Gemini flash-lite, on Groq gpt-oss-120b and end to end through the gateway.

CRON_SECRET must be set in the Vercel project. Without it the cron route returns 401 on every call and retention never runs. Vercel Hobby runs a cron at most once per day. Retention days is a hardcoded constant, not an environment or BLOS value.

All of today's changes are uncommitted and undeployed. After deployment, drive_document_cache may need truncating again if older code repopulates it without screenshot markers.

The Document Library page changes (browser caching of the tree and the opened document) were verified at service and API level only. A Chrome install exists on this machine and was used for the logo check, but pages behind sign-in cannot be screenshot without a session. Requirement, deliverable and phase identifiers were not supplied and are inferred.

The Shopify Workbench BGCT addition, the assigner Mayuri and the Management Team user were supplied by the developer. The dashboard is the Document Library in this repository, but no change for the Shopify Workbench BGCT exists in the working tree as of this entry, so this file records that task as reported and cannot supply files, measurements or validation results for it. It is also not defined which Google Sheet or Drive folder counts as the Shopify Workbench BGCT. A Google Sheet named Shopify- LcMA - BGCT - Intern mode is linked under Shopify / Model_04 in the source Sheet, and is the likely candidate but is not confirmed. Whether Mayuri assigned the AI slowness fix as well was not stated and is assumed. The document reader currently opens Word, PDF and text files; it cannot render a Google Sheet, so adding a spreadsheet source needs a new reader.

The logo source is a 200 by 200 raster with a white background and an unreadable wordmark. A high-resolution or vector original would give sharper large-size use and a transparent version. The admin sidebar, the chat bot avatars and the admin transcript avatar were not screenshot-checked, because they need a sign-in or a conversation. Browsers cache favicons strongly, so the new one may need a hard refresh.

---

# VALIDATION RULE ADDED OR CHANGED

Validation Rule:

IF the selected document's content answers the request, including requests to explain, summarise, translate or walk through it

THEN answer from that document, in the language the user asked for.

IF the information is genuinely not in the selected document

THEN reply with exactly "I couldn't find that information in this document." and nothing else.

Never use other documents, departments, Shared knowledge or outside knowledge while a document is selected.

IF the user asks about images or screenshots

THEN say once that images cannot be seen and explain the steps each [Screenshot N] marker accompanies.

OTHERWISE ignore the markers and do not mention screenshots.

IF a provider produces no content within the first-token timeout, or the stream ends with abort

THEN treat it as a failure and try the next provider.

IF a provider returns 400 or 422

THEN stop the chain (unchanged).

IF the configured Gemini model starts with gemini-3

THEN send thinkingLevel minimal for document Q&A only.

OTHERWISE send no thinking option. An unsupported option returns 400 and would stop the entire chain.

IF the Document Library AI path reads a cached document

THEN load only the AI text. Load the reading copy only when the viewer asks for it.

IF a conversation started more than 7 days ago

THEN delete it, with its messages, citations and feedback, in one transaction with a system audit entry. The cutoff comes from the database clock and the run is safe to repeat.

IF the cron request does not carry "Bearer <CRON_SECRET>" (compared in constant time), or CRON_SECRET is not set

THEN return 401.

---

# FAILURE MODE OR EDGE CASE

Empty answer after 20 seconds. When the first-token timer aborts a stalled provider, the SDK emits an abort chunk, not an error chunk. The gateway treated abort as real content and committed to the dead provider. Reproduced by setting AI_FIRST_CHUNK_TIMEOUT_MS=1: the browser received ["start","abort"], empty text, and the log said "answering with gemini". After the fix the request falls through every provider and ends in AllProvidersFailedError.

Over-refusal. The old rule said to reply with the refusal sentence whenever the content did not answer the question. Models read a request for another language, an overview or images as "no answer". The first improved wording then made one model prefix "I cannot see the screenshots." to answers that had nothing to do with images. The final wording ignores the markers unless the user asks about images.

Inconsistent answers. With default thinking, the same question returned a refusal in one run and a full answer in another.

Silent fallback misconfiguration. Groq and OpenRouter model ids returned 404, so each fallback added a failed hop and ended on the slowest provider without anyone seeing the cause. Model retirement is per account and the model list endpoint does not prove a model can still be called.

Slow failure. A Gemini 503 "high demand" took about 10 seconds to fail. A 429 quota error failed in about 0.4 seconds.

Wrong diagnosis retracted. A cache bug was first reported from a re-created snippet, not from the real code. The real code already compared timestamps correctly. The actual cost was payload size.

Operational slip. A broad process kill by command-line pattern may have stopped the developer's own dev server. Kill by port or process id.

Blank mobile screenshot. The login page at mobile width came out blank and looked like a regression from the logo change. The original code produced the same blank page: framer-motion entrance animations stay at opacity 0 under headless Chrome's fake clock. Emulating reduced motion, which the page's own code honours, rendered it correctly.

---

# DECISIONS MADE TODAY

Measure the real code path before naming a cause. Every claim in this file comes from a measurement or from the code on disk.

The reading copy became opt-in instead of being split into a second table, because only the viewer needs it.

The prompt wording was chosen by comparing candidates on two providers with must-refuse control questions in the same run. A wording that answers more but weakens refusal was not acceptable.

The Groq default was corrected in code, not only in .env, so production is fixed even where the environment variable is not set.

OpenRouter was left unchanged because the working model is paid.

The Gemini thinking option is opt-in per call and guarded by model id, so the general chatbot's behaviour is unchanged and a config change cannot become an outage.

Screenshot markers were chosen over sending images, because only Gemini could use images and it would add cost, latency and quota use.

The 97 old sessions were deleted by calling purgeOlderThan(), the same function the scheduled job runs, not by ad-hoc SQL, so the action is audited and repeatable. The requester had confirmed this deletion when the count was 97, and it was still 97.

drive_document_cache was truncated, not migrated, because it is a pure cache that rebuilds on demand.

One shared BrandLogo component replaced eight copies of the old tile, so the next logo change touches one file. Only the emblem is used, on a white tile. The old favicon.svg was deleted instead of being kept beside the new icons, because browsers prefer an SVG icon when one is listed.

---

# COMPANY KNOWLEDGE EXTRACT

Free-tier model quotas are per model per project and can be as low as 20 requests per day. When "the AI is slow" is reported, read the quota id in the 429 error first. A fallback chain hides quota exhaustion as latency.

A fallback chain is only as good as its last working link. Test every fallback with a real prompt on a schedule. A retired model id fails silently and each dead hop adds latency.

Reasoning models spend hidden tokens. For answering from text that is already in the prompt, set minimal reasoning and measure reasoning tokens as well as latency.

Do not select columns the caller does not use over an HTTP database driver. A 2.5 MB column cost 1 to 5 seconds per question.

A "refuse if not answered" prompt must separate "the information is absent" from "the user asked for a different language, format or overview". Test it with answerable questions and must-refuse questions in the same run.

Stream SDKs emit abort as well as error. Handle both when racing a timeout.

Timestamps from the Neon HTTP driver are Date objects. Compare with getTime(), not with ===.

Run retention deletes through the audited function the scheduler uses. Verify the cascades and that history tables survive.

A text-only model cannot see screenshots. Keep position markers so it can anchor its explanation, and make it say plainly that it cannot see the images.

Measure the real code path before naming a root cause. A re-created snippet can show a bug the real code does not have.

Kill development servers by port or process id, never by command-line pattern.

When a change is suspected of blanking a page, compare against the original code before fixing anything. A blank headless screenshot can come from the test harness, not the change.

framer-motion entrance animations can stay at opacity 0 in headless Chrome. Use --force-prefers-reduced-motion when the page honours reduced motion.

A logo with a white background and dark shapes needs a white tile on a dark header. A wordmark 7 pixels tall in the source cannot be used at interface sizes, so use the emblem alone.

Headless Chrome is installed on this machine: google-chrome --headless=new --no-sandbox --screenshot=FILE URL renders public pages for visual checks.

---

# LLM STANDARD CHECK

LLM Queryable: TRUE

Operational terminology consistent: TRUE

Business rules documented: TRUE

Department isolation documented: TRUE (unchanged today; single-document isolation re-verified by 10 of 10 refusals in the prompt comparison, run on the wording before the final tightening, and 3 of 3 end to end on the final wording)

Validation rules documented: TRUE

Failure scenarios documented: TRUE

Implementation decisions documented: TRUE

Reusable company knowledge extracted: TRUE

Evidence referenced: PARTIAL — figures are recorded inline; the measurement scripts were deleted after use. audit_logs id 160 and the TypeScript, lint and build results can be re-verified.

3 AM Standard satisfied: TRUE

Another developer can continue implementation independently: TRUE

Company knowledge candidate: TRUE

Known weaknesses of this file: requirement, deliverable and phase identifiers are inferred; the prompt was not re-verified on gemini-3-flash-preview; the Document Library changes were not verified in a browser, only the logo pages were; the Shopify Workbench BGCT addition is developer-reported and has no change in this repository yet; its source Sheet is not confirmed; the measurement scripts are not retained.

---

# BLOS GOVERNANCE

No BLOS table exists for this project, so the keys listed in the header are implementation rule names, not stored BLOS keys.

Operational thresholds were introduced or changed today and none is governed: conversation retention days (hardcoded constant, 7), the Drive freshness windows (60 seconds and 30 minutes), the tree cache (10 minutes), the whole-document prompt budget (96000 characters), the Gemini thinking level, and the provider fallback order and model ids.

Move conversation_retention_days to BLOS first. It is a data-deletion policy that a business owner should own, not a developer constant. Provider fallback order and model ids are next, because retired or rate-limited models changed user-visible speed today.

Single-document isolation, the refusal rule and department isolation remain implementation rules, not configurable thresholds.
