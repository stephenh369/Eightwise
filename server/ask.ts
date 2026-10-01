import {
  APIConnectionError,
  APIError,
  AuthenticationError,
  choice,
  noul,
  score,
  TypeSafeClient,
} from "@typesafe-ai/sdk";

const UPSTREAM_TIMEOUT_MS = 9_000;

const REPLIES = {
  it_is_certain: {
    text: "It is certain",
    band: "yes",
    criteria: "The asked outcome is effectively guaranteed.",
  },
  it_is_decidedly_so: {
    text: "It is decidedly so",
    band: "yes",
    criteria: "The facts already point clearly to yes.",
  },
  without_a_doubt: {
    text: "Without a doubt",
    band: "yes",
    criteria: "There is no serious room for a no.",
  },
  yes_definitely: {
    text: "Yes definitely",
    band: "yes",
    criteria: "A direct, emphatic yes.",
  },
  you_may_rely_on_it: {
    text: "You may rely on it",
    band: "yes",
    criteria: "The asker can treat yes as dependable.",
  },
  as_i_see_it_yes: {
    text: "As I see it, yes",
    band: "yes",
    criteria: "A reasoned yes, not an absolute guarantee.",
  },
  most_likely: {
    text: "Most likely",
    band: "yes",
    criteria: "Yes is the probable outcome, with some remaining chance of no.",
  },
  outlook_good: {
    text: "Outlook good",
    band: "yes",
    criteria: "Conditions look favorable without being certain.",
  },
  yes: {
    text: "Yes",
    band: "yes",
    criteria: "A plain yes with no extra emphasis.",
  },
  signs_point_to_yes: {
    text: "Signs point to yes",
    band: "yes",
    criteria: "Available signals lean yes, but the case is not closed.",
  },
  reply_hazy_try_again: {
    text: "Reply hazy, try again",
    band: "haze",
    criteria: "The question is too vague or muddled to answer as yes or no.",
  },
  ask_again_later: {
    text: "Ask again later",
    band: "haze",
    criteria: "The outcome depends on information that is not available yet.",
  },
  better_not_tell_you_now: {
    text: "Better not tell you now",
    band: "haze",
    criteria: "Answering now would be premature or unhelpful.",
  },
  cannot_predict_now: {
    text: "Cannot predict now",
    band: "haze",
    criteria: "The situation is genuinely unpredictable from the question alone.",
  },
  concentrate_and_ask_again: {
    text: "Concentrate and ask again",
    band: "haze",
    criteria: "The asker needs a clearer, more specific yes/no question.",
  },
  dont_count_on_it: {
    text: "Don't count on it",
    band: "no",
    criteria: "Hoping for yes is unwise; disappointment is likely.",
  },
  my_reply_is_no: {
    text: "My reply is no",
    band: "no",
    criteria: "A direct no.",
  },
  my_sources_say_no: {
    text: "My sources say no",
    band: "no",
    criteria: "Available evidence points to no.",
  },
  outlook_not_so_good: {
    text: "Outlook not so good",
    band: "no",
    criteria: "Conditions look unfavorable without being a hard no.",
  },
  very_doubtful: {
    text: "Very doubtful",
    band: "no",
    criteria: "A yes would be surprising.",
  },
} as const;

type ReplyId = keyof typeof REPLIES;
type Band = (typeof REPLIES)[ReplyId]["band"];

const REPLY_IDS = Object.keys(REPLIES) as ReplyId[];
const REPLY_CRITERIA = Object.fromEntries(
  REPLY_IDS.map((id) => [id, REPLIES[id].criteria]),
) as { [K in ReplyId]: string };

export type AskSuccessBody = { ok: true; answer: string };
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

function idsForBand(band: Band): ReplyId[] {
  return REPLY_IDS.filter((id) => REPLIES[id].band === band);
}

function bandFromOutlook(outlook: number): Band {
  if (outlook < 1.5) return "no";
  if (outlook < 2.5) return "haze";
  return "yes";
}

function pickFromBand(
  band: Band,
  probabilities: Record<string, number>,
  preferred?: string,
): ReplyId {
  const ids = idsForBand(band);
  if (preferred && ids.includes(preferred as ReplyId)) {
    return preferred as ReplyId;
  }

  let best = ids[0];
  let highest = Number.NEGATIVE_INFINITY;
  for (const id of ids) {
    const probability = probabilities[id] ?? 0;
    if (probability > highest) {
      highest = probability;
      best = id;
    }
  }
  return best;
}

function composeAnswer(input: {
  answerable: number;
  outlook: number;
  choice: string;
  probabilities: Record<string, number>;
}): string {
  const band = input.answerable < 0.45 ? "haze" : bandFromOutlook(input.outlook);
  const id = pickFromBand(band, input.probabilities, input.choice);
  return REPLIES[id].text;
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
        answerable: noul(
          "Is `question` a well-formed yes/no question that a Magic 8-Ball can meaningfully answer?",
          {
            true: "A clear yes/no, should-I, will-it, or similar closed question.",
            false:
              "Not a question, a request for facts or open-ended advice, or too vague to answer as yes or no.",
          },
        ),
        outlook: score(
          "If `question` is treated as a yes/no question, how favorable is a sincere answer?",
          [
            "Strongly no: a yes would be surprising.",
            "Leaning no: the outlook is not so good.",
            "Unclear or not yet knowable from the question.",
            "Leaning yes: signs point to yes.",
            "Strongly yes: the asked outcome is nearly certain.",
          ],
        ),
        reply: choice(
          "Which classic Magic 8-Ball reply should appear for `question`?",
          REPLY_CRITERIA,
        ),
      },
    });

    const { answerable, outlook, reply } = response.answers;
    const answer = composeAnswer({
      answerable: answerable.noul,
      outlook: outlook.score,
      choice: reply.choice,
      probabilities: reply.probabilities,
    });

    return { status: 200, body: { ok: true, answer } };
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
