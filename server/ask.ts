import {
  APIConnectionError,
  APIError,
  AuthenticationError,
  noul,
  TypeSafeClient,
} from "@typesafe-ai/sdk";

const UPSTREAM_TIMEOUT_MS = 9_000;

/** Minimum P(yes) that `question` reads as a single yes/no proposition. */
const YES_NO_FORM_THRESHOLD = 0.5;

const REPLIES = {
  it_is_certain: { text: "It is certain." },
  without_a_doubt: { text: "Without a doubt." },
  yes_definitely: { text: "Yes, definitely." },
  you_may_rely_on_it: { text: "You may rely on it." },
  as_i_see_it_yes: { text: "As I see it, yes." },
  most_likely: { text: "Most likely." },
  outlook_good: { text: "Outlook good." },
  signs_point_to_yes: { text: "Signs point to yes." },
  yes: { text: "Yes." },
  absolutely_lean_in: { text: "Absolutely, lean in." },
  reply_hazy_try_again: { text: "Reply hazy, try again." },
  ask_again_later: { text: "Ask again later." },
  better_not_tell_you_now: { text: "Better not tell you now." },
  cannot_predict_now: { text: "Cannot predict now." },
  concentrate_and_ask_again: { text: "Concentrate and ask again." },
  dont_count_on_it: { text: "Don't count on it." },
  my_reply_is_no: { text: "My reply is no." },
  outlook_not_so_good: { text: "Outlook not so good." },
  very_doubtful: { text: "Very doubtful." },
  no_sit_this_one_out: { text: "No, sit this one out." },
} as const;

type ReplyId = keyof typeof REPLIES;

const HAZY_REPLY_IDS: ReplyId[] = [
  "reply_hazy_try_again",
  "ask_again_later",
  "better_not_tell_you_now",
  "cannot_predict_now",
  "concentrate_and_ask_again",
];

/** Map P(yes) to classic reply bands (8-ball tone, not epistemic refusal). */
const STANCE_BANDS: { max: number; ids: ReplyId[] }[] = [
  {
    max: 0.12,
    ids: ["very_doubtful", "my_reply_is_no"],
  },
  {
    max: 0.28,
    ids: ["dont_count_on_it", "outlook_not_so_good", "no_sit_this_one_out"],
  },
  {
    max: 0.42,
    ids: ["outlook_not_so_good", "dont_count_on_it", "very_doubtful"],
  },
  {
    max: 0.58,
    ids: ["as_i_see_it_yes", "most_likely", "yes", "signs_point_to_yes"],
  },
  {
    max: 0.72,
    ids: ["outlook_good", "signs_point_to_yes", "most_likely", "as_i_see_it_yes"],
  },
  {
    max: 0.85,
    ids: [
      "you_may_rely_on_it",
      "absolutely_lean_in",
      "most_likely",
      "outlook_good",
    ],
  },
  {
    max: 0.94,
    ids: ["yes_definitely", "without_a_doubt", "you_may_rely_on_it"],
  },
  {
    max: 1,
    ids: ["it_is_certain", "without_a_doubt", "yes_definitely"],
  },
];

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

export function classicReplyFromSignals(
  yesNoForm: number,
  pYes: number,
): { id: ReplyId; probability: number } {
  if (yesNoForm < YES_NO_FORM_THRESHOLD) {
    return {
      id: pickRandom(HAZY_REPLY_IDS),
      probability: yesNoForm,
    };
  }
  for (const band of STANCE_BANDS) {
    if (pYes <= band.max) {
      return { id: pickRandom(band.ids), probability: pYes };
    }
  }
  const last = STANCE_BANDS[STANCE_BANDS.length - 1]!;
  return { id: pickRandom(last.ids), probability: pYes };
}

export type AskSuccessBody = {
  ok: true;
  answer: string;
  probability: number;
};
export type AskErrorBody = { error: string };

export type AskResult = {
  status: number;
  body: AskSuccessBody | AskErrorBody;
};

export type AskMode = "classic" | "noul";

function normalizeQuestion(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseMode(raw: unknown): AskMode | AskResult {
  if (raw === undefined || raw === null) {
    return "classic";
  }
  if (raw === "classic" || raw === "noul") {
    return raw;
  }
  return { status: 400, body: { error: "invalid_mode" } };
}

export function parseAskBody(
  raw: unknown,
): { question: string; mode: AskMode } | AskResult {
  if (raw === null || typeof raw !== "object") {
    return { status: 400, body: { error: "invalid_body" } };
  }
  const body = raw as { question?: unknown; mode?: unknown };
  const question = normalizeQuestion(body.question);
  if (!question) {
    return { status: 400, body: { error: "empty_question" } };
  }
  const mode = parseMode(body.mode);
  if (typeof mode !== "string") {
    return mode;
  }
  return { question, mode };
}

function mapUpstreamError(error: unknown): AskResult {
  if (error instanceof AuthenticationError) {
    return { status: 500, body: { error: "proxy_misconfigured" } };
  }
  if (error instanceof APIError || error instanceof APIConnectionError) {
    return { status: 502, body: { error: "upstream_unavailable" } };
  }
  return { status: 502, body: { error: "upstream_unavailable" } };
}

const CLASSIC_QUESTIONS = {
  yes_no_form: noul("Is `question` a single clear yes-or-no question?", {
    true: "One yes/no proposition, even if the asker's private facts are unknown.",
    false: "Vague, compound, open-ended, or not reducible to yes/no.",
  }),
  stance: noul(
    "For a toy magic 8-ball responding to `question`, is yes the better answer?",
    {
      true: "Yes is the better 8-ball answer from how the question is framed; missing personal facts are not a reason to stay neutral.",
      false: "No is the better 8-ball answer from how the question is framed; missing personal facts are not a reason to stay neutral.",
    },
  ),
} as const;

async function handleClassicAsk(
  client: TypeSafeClient,
  question: string,
): Promise<AskResult> {
  const response = await client.systemOne({
    state: { question },
    questions: CLASSIC_QUESTIONS,
  });

  const yesNoForm = response.answers.yes_no_form.noul;
  const pYes = response.answers.stance.noul;
  const { id, probability } = classicReplyFromSignals(yesNoForm, pYes);
  const answer = REPLIES[id].text;

  return { status: 200, body: { ok: true, answer, probability } };
}

async function handleNoulAsk(
  client: TypeSafeClient,
  question: string,
): Promise<AskResult> {
  const response = await client.systemOne({
    state: { question },
    questions: {
      yes: noul("Is the answer to `question` yes?", {
        true: "Yes is the better answer.",
        false: "No is the better answer.",
      }),
    },
  });

  const pYes = response.answers.yes.noul;
  const answer = pYes >= 0.5 ? "Yes" : "No";

  return { status: 200, body: { ok: true, answer, probability: pYes } };
}

export async function handleAsk(
  question: string,
  mode: AskMode,
  apiKey: string | undefined,
): Promise<AskResult> {
  if (!apiKey?.trim()) {
    return { status: 500, body: { error: "proxy_misconfigured" } };
  }

  const client = new TypeSafeClient({
    apiKey: apiKey.trim(),
    timeout: UPSTREAM_TIMEOUT_MS,
    retry: { maxRetries: 1 },
    logLevel: "error",
  });

  try {
    if (mode === "noul") {
      return await handleNoulAsk(client, question);
    }
    return await handleClassicAsk(client, question);
  } catch (error) {
    return mapUpstreamError(error);
  }
}

export async function handleAskRequest(
  rawBody: unknown,
  apiKey: string | undefined,
): Promise<AskResult> {
  const parsed = parseAskBody(rawBody);
  if ("status" in parsed) {
    return parsed;
  }
  return handleAsk(parsed.question, parsed.mode, apiKey);
}
