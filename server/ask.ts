import {
  APIConnectionError,
  APIError,
  AuthenticationError,
  choice,
  TypeSafeClient,
} from "@typesafe-ai/sdk";

const UPSTREAM_TIMEOUT_MS = 9_000;

const REPLIES = {
  it_is_certain: {
    text: "It is certain.",
    criteria:
      "Stock reply: It is certain. The asked outcome is effectively guaranteed.",
  },
  without_a_doubt: {
    text: "Without a doubt.",
    criteria:
      "Stock reply: Without a doubt. There is no serious room for a no.",
  },
  yes_definitely: {
    text: "Yes, definitely.",
    criteria: "Stock reply: Yes, definitely. A direct, emphatic yes.",
  },
  you_may_rely_on_it: {
    text: "You may rely on it.",
    criteria:
      "Stock reply: You may rely on it. The asker can treat yes as dependable.",
  },
  as_i_see_it_yes: {
    text: "As I see it, yes.",
    criteria:
      "Stock reply: As I see it, yes. A reasoned yes, not an absolute guarantee.",
  },
  most_likely: {
    text: "Most likely.",
    criteria:
      "Stock reply: Most likely. Yes is probable, with some remaining chance of no.",
  },
  outlook_good: {
    text: "Outlook good.",
    criteria:
      "Stock reply: Outlook good. Conditions look favorable without being certain.",
  },
  signs_point_to_yes: {
    text: "Signs point to yes.",
    criteria:
      "Stock reply: Signs point to yes. Available signals lean yes; the case is not closed.",
  },
  yes: {
    text: "Yes.",
    criteria: "Stock reply: Yes. A plain yes with no extra emphasis.",
  },
  absolutely_lean_in: {
    text: "Absolutely, lean in.",
    criteria:
      "Stock reply: Absolutely, lean in. An enthusiastic yes; the asker should go for it.",
  },
  reply_hazy_try_again: {
    text: "Reply hazy, try again.",
    criteria:
      "Stock reply: Reply hazy, try again. The question is too vague or muddled to answer as yes or no.",
  },
  ask_again_later: {
    text: "Ask again later.",
    criteria:
      "Stock reply: Ask again later. The outcome depends on information not available yet.",
  },
  better_not_tell_you_now: {
    text: "Better not tell you now.",
    criteria:
      "Stock reply: Better not tell you now. Answering now would be premature or unhelpful.",
  },
  cannot_predict_now: {
    text: "Cannot predict now.",
    criteria:
      "Stock reply: Cannot predict now. The situation is genuinely unpredictable from the question alone.",
  },
  concentrate_and_ask_again: {
    text: "Concentrate and ask again.",
    criteria:
      "Stock reply: Concentrate and ask again. The asker needs a clearer, more specific yes/no question.",
  },
  dont_count_on_it: {
    text: "Don't count on it.",
    criteria:
      "Stock reply: Don't count on it. Hoping for yes is unwise; disappointment is likely.",
  },
  my_reply_is_no: {
    text: "My reply is no.",
    criteria: "Stock reply: My reply is no. A direct no.",
  },
  outlook_not_so_good: {
    text: "Outlook not so good.",
    criteria:
      "Stock reply: Outlook not so good. Conditions look unfavorable without being a hard no.",
  },
  very_doubtful: {
    text: "Very doubtful.",
    criteria: "Stock reply: Very doubtful. A yes would be surprising.",
  },
  no_sit_this_one_out: {
    text: "No, sit this one out.",
    criteria:
      "Stock reply: No, sit this one out. A clear no with gentle advice to abstain.",
  },
} as const;

type ReplyId = keyof typeof REPLIES;

const REPLY_IDS = Object.keys(REPLIES) as ReplyId[];
const REPLY_CRITERIA = Object.fromEntries(
  REPLY_IDS.map((id) => [id, REPLIES[id].criteria]),
) as { [K in ReplyId]: string };

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

function normalizeQuestion(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function parseAskBody(raw: unknown): { question: string } | AskResult {
  if (raw === null || typeof raw !== "object") {
    return { status: 400, body: { error: "invalid_body" } };
  }
  const question = normalizeQuestion((raw as { question?: unknown }).question);
  if (!question) {
    return { status: 400, body: { error: "empty_question" } };
  }
  return { question };
}

export async function handleAsk(
  question: string,
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
    const response = await client.systemOne({
      state: { question },
      questions: {
        reply: choice(
          "Which stock Eightwise reply should appear for `question`?",
          REPLY_CRITERIA,
        ),
      },
    });

    const { reply } = response.answers;
    const id = reply.choice as ReplyId;
    const answer = REPLIES[id].text;
    const probability = reply.probabilities[id] ?? reply.probabilities[reply.choice];

    return { status: 200, body: { ok: true, answer, probability } };
  } catch (error) {
    if (error instanceof AuthenticationError) {
      return { status: 500, body: { error: "proxy_misconfigured" } };
    }
    if (error instanceof APIError || error instanceof APIConnectionError) {
      return { status: 502, body: { error: "upstream_unavailable" } };
    }
    return { status: 502, body: { error: "upstream_unavailable" } };
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
  return handleAsk(parsed.question, apiKey);
}
