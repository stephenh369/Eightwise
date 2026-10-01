import "./style.css";
import { createShakeDetector } from "./shake";
import {
  appendShakeLog,
  formatLogMeta,
  loadShakeLog,
  type AskMode,
  type ShakeLogEntry,
} from "./shakeLog";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app missing");

app.innerHTML = `
  <main class="app-main">
    <h1>Eightwise</h1>
    <div class="sphere" id="sphere" role="button" tabindex="0" aria-label="Tap to ask when you have entered a question">
      <div class="sphere__answer" id="sphere-answer">
        <p class="sphere__answer-text" id="sphere-window">Ask below</p>
      </div>
    </div>
    <div class="controls">
      <fieldset class="mode-toggle" id="mode-toggle">
        <legend class="mode-toggle__legend">Answer style</legend>
        <div class="mode-toggle__group" role="radiogroup" aria-label="Answer style">
          <label class="mode-toggle__option">
            <input type="radio" name="mode" value="classic" checked />
            <span>Classic 20</span>
          </label>
          <label class="mode-toggle__option">
            <input type="radio" name="mode" value="noul" />
            <span>Yes/No %</span>
          </label>
        </div>
      </fieldset>
      <label for="question">Your question</label>
      <input
        id="question"
        type="text"
        autocomplete="off"
        placeholder="Should I…?"
        maxlength="500"
      />
      <button type="button" id="ask" disabled>Ask</button>
    </div>
    <div class="status-row">
      <p class="status" id="status" role="status"></p>
      <button type="button" id="retry" class="secondary" hidden>Retry</button>
    </div>
    <details class="recent" id="recent" hidden>
      <summary class="recent__summary">Recent</summary>
      <p class="recent__hint">Use 20 real questions, then decide keep / kill / niche-pivot.</p>
      <ul class="recent__list" id="recent-list"></ul>
    </details>
  </main>
  <footer class="disclaimer">For fun — not advice.</footer>
`;

const questionInput = document.querySelector<HTMLInputElement>("#question")!;
const askButton = document.querySelector<HTMLButtonElement>("#ask")!;
const retryButton = document.querySelector<HTMLButtonElement>("#retry")!;
const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;
const sphereEl = document.querySelector<HTMLDivElement>("#sphere")!;
const sphereWindow = document.querySelector<HTMLParagraphElement>("#sphere-window")!;
const sphereAnswer = document.querySelector<HTMLDivElement>("#sphere-answer")!;
const modeToggle = document.querySelector<HTMLFieldSetElement>("#mode-toggle")!;
const modeInputs = modeToggle.querySelectorAll<HTMLInputElement>('input[name="mode"]');
const recentDetails = document.querySelector<HTMLDetailsElement>("#recent")!;
const recentList = document.querySelector<HTMLUListElement>("#recent-list")!;

type AskSuccessBody = {
  ok: true;
  answer: string;
  probability: number;
};

let lastQuestion = "";
let inFlight = false;
let shakeStarted = false;

function isValidProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function getSelectedMode(): AskMode {
  const checked = modeToggle.querySelector<HTMLInputElement>('input[name="mode"]:checked');
  return checked?.value === "noul" ? "noul" : "classic";
}

function clearResult() {
  sphereWindow.textContent = "Ask below";
  sphereAnswer.classList.remove("sphere__answer--ready");
  retryButton.hidden = true;
  setStatus("");
}

function setModeToggleDisabled(disabled: boolean) {
  modeToggle.disabled = disabled;
}

function setStatus(message: string, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("status--error", isError);
}

function updateAskEnabled() {
  const hasText = questionInput.value.trim().length > 0;
  askButton.disabled = !hasText || inFlight;
  sphereEl.classList.toggle("sphere--ready", hasText && !inFlight);
}

function renderRecentList(entries: ShakeLogEntry[]) {
  recentList.replaceChildren();
  if (entries.length === 0) {
    recentDetails.hidden = true;
    return;
  }
  recentDetails.hidden = false;
  for (const entry of entries) {
    const li = document.createElement("li");
    li.className = "recent__item";

    const q = document.createElement("p");
    q.className = "recent__question";
    q.textContent = entry.question;

    const r = document.createElement("p");
    r.className = "recent__reply";
    r.textContent = entry.reply;

    const m = document.createElement("p");
    m.className = "recent__meta";
    m.textContent = formatLogMeta(entry.ms, entry.probability, entry.mode);

    li.append(q, r, m);
    recentList.append(li);
  }
}

function recordSuccess(
  question: string,
  reply: string,
  latencyMs: number,
  probability: number,
  mode: AskMode,
) {
  const entries = appendShakeLog({
    question,
    reply,
    ms: latencyMs,
    probability,
    mode,
  });
  renderRecentList(entries);
}

async function ensureShakeListening() {
  const granted = await shakeDetector.requestPermissionIfNeeded();
  if (granted && !shakeStarted) {
    shakeDetector.start();
    shakeStarted = true;
  }
}

function trySubmitFromQuestionInput() {
  if (askButton.disabled) return;
  void submitQuestion(questionInput.value);
}

const shakeDetector = createShakeDetector(() => {
  trySubmitFromQuestionInput();
});

questionInput.addEventListener("input", () => {
  retryButton.hidden = true;
  updateAskEnabled();
});

async function submitQuestion(question: string) {
  if (inFlight) return;
  const trimmed = question.trim();
  if (!trimmed) return;

  void ensureShakeListening();

  inFlight = true;
  lastQuestion = trimmed;
  const mode = getSelectedMode();
  retryButton.hidden = true;
  setStatus("Thinking…");
  sphereWindow.textContent = "…";
  sphereAnswer.classList.remove("sphere__answer--ready");
  updateAskEnabled();
  setModeToggleDisabled(true);

  const t0 = performance.now();

  try {
    const response = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: trimmed, mode }),
    });

    const data = (await response.json()) as AskSuccessBody & { error?: string };

    if (!response.ok) {
      const code = data.error ?? "request_failed";
      setStatus(friendlyError(code), true);
      sphereWindow.textContent = "Try again";
      retryButton.hidden = false;
      return;
    }

    if (!data.answer) {
      setStatus(friendlyError("request_failed"), true);
      sphereWindow.textContent = "Try again";
      retryButton.hidden = false;
      return;
    }

    const latencyMs = performance.now() - t0;

    setStatus("");
    sphereWindow.textContent = data.answer;
    sphereAnswer.classList.add("sphere__answer--ready");

    if (isValidProbability(data.probability)) {
      recordSuccess(trimmed, data.answer, latencyMs, data.probability, mode);
    }
  } catch {
    setStatus("Network error — check your connection.", true);
    sphereWindow.textContent = "Try again";
    retryButton.hidden = false;
  } finally {
    inFlight = false;
    setModeToggleDisabled(false);
    updateAskEnabled();
  }
}

function friendlyError(code: string): string {
  switch (code) {
    case "empty_question":
      return "Enter a question first.";
    case "proxy_misconfigured":
      return "The server is not configured yet.";
    case "upstream_unavailable":
      return "Could not reach the decision service. Try again.";
    case "invalid_mode":
      return "Invalid answer style. Try again.";
    default:
      return "Something went wrong. Try again.";
  }
}

askButton.addEventListener("click", () => {
  void ensureShakeListening();
  void submitQuestion(questionInput.value);
});

retryButton.addEventListener("click", () => {
  void submitQuestion(lastQuestion);
});

sphereEl.addEventListener("click", () => {
  trySubmitFromQuestionInput();
});

sphereEl.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    trySubmitFromQuestionInput();
  }
});

questionInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !askButton.disabled) {
    void submitQuestion(questionInput.value);
  }
});

for (const input of modeInputs) {
  input.addEventListener("change", () => {
    if (!inFlight) {
      clearResult();
    }
  });
}

renderRecentList(loadShakeLog());
updateAskEnabled();
