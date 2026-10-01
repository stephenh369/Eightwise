import "./style.css";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("#app missing");

app.innerHTML = `
  <h1>Eightwise</h1>
  <div class="sphere" aria-hidden="true">
    <div class="sphere__answer" id="sphere-answer">
      <p class="sphere__answer-text" id="sphere-window">Ask below</p>
    </div>
  </div>
  <p class="meta" id="result-meta" hidden></p>
  <div class="controls">
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
`;

const questionInput = document.querySelector<HTMLInputElement>("#question")!;
const askButton = document.querySelector<HTMLButtonElement>("#ask")!;
const retryButton = document.querySelector<HTMLButtonElement>("#retry")!;
const statusEl = document.querySelector<HTMLParagraphElement>("#status")!;
const sphereWindow = document.querySelector<HTMLParagraphElement>("#sphere-window")!;
const sphereAnswer = document.querySelector<HTMLDivElement>("#sphere-answer")!;
const resultMeta = document.querySelector<HTMLParagraphElement>("#result-meta")!;

type AskSuccessBody = {
  ok: true;
  answer: string;
  probability: number;
};

let lastQuestion = "";
let inFlight = false;

function clearResultMeta() {
  resultMeta.textContent = "";
  resultMeta.hidden = true;
}

function isValidProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function formatResultMeta(latencyMs: number, probability: number): string {
  return `${Math.round(latencyMs)}ms · ${probability.toFixed(2)}`;
}

function setStatus(message: string, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle("status--error", isError);
}

function updateAskEnabled() {
  const hasText = questionInput.value.trim().length > 0;
  askButton.disabled = !hasText || inFlight;
}

questionInput.addEventListener("input", () => {
  retryButton.hidden = true;
  updateAskEnabled();
});

async function submitQuestion(question: string) {
  if (inFlight) return;
  const trimmed = question.trim();
  if (!trimmed) return;

  inFlight = true;
  lastQuestion = trimmed;
  retryButton.hidden = true;
  setStatus("Thinking…");
  sphereWindow.textContent = "…";
  sphereAnswer.classList.remove("sphere__answer--ready");
  clearResultMeta();
  updateAskEnabled();

  const t0 = performance.now();

  try {
    const response = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: trimmed }),
    });

    const data = (await response.json()) as AskSuccessBody & { error?: string };

    if (!response.ok) {
      const code = data.error ?? "request_failed";
      setStatus(friendlyError(code), true);
      sphereWindow.textContent = "Try again";
      retryButton.hidden = false;
      clearResultMeta();
      return;
    }

    if (!data.answer) {
      setStatus(friendlyError("request_failed"), true);
      sphereWindow.textContent = "Try again";
      retryButton.hidden = false;
      clearResultMeta();
      return;
    }

    const latencyMs = performance.now() - t0;

    setStatus("");
    sphereWindow.textContent = data.answer;
    sphereAnswer.classList.add("sphere__answer--ready");

    if (isValidProbability(data.probability)) {
      resultMeta.textContent = formatResultMeta(latencyMs, data.probability);
      resultMeta.hidden = false;
    } else {
      clearResultMeta();
    }
  } catch {
    setStatus("Network error — check your connection.", true);
    sphereWindow.textContent = "Try again";
    retryButton.hidden = false;
    clearResultMeta();
  } finally {
    inFlight = false;
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
    default:
      return "Something went wrong. Try again.";
  }
}

askButton.addEventListener("click", () => {
  void submitQuestion(questionInput.value);
});

retryButton.addEventListener("click", () => {
  void submitQuestion(lastQuestion);
});

questionInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !askButton.disabled) {
    void submitQuestion(questionInput.value);
  }
});

updateAskEnabled();
