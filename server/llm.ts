import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";

export const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";

/** API 키가 없거나 DEMO_MODE=1 이면 가짜 응답으로 동작 (화면/흐름 확인용) */
export const DEMO_MODE =
  process.env.DEMO_MODE === "1" ||
  (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN);

const client = DEMO_MODE ? null : new Anthropic();

// 거절(refusal) 시 서버 측에서 자동으로 다른 모델로 재시도
const FALLBACK = {
  betas: ["server-side-fallback-2026-07-01"],
  fallbacks: "default" as const,
};

export const PlanSchema = z.object({
  analysis: z.string().describe("업무를 어떻게 나눴는지 1~3문장 설명"),
  assignments: z
    .array(
      z.object({
        agent_id: z.number().int().describe("업무를 맡길 팀원의 id"),
        instruction: z.string().describe("그 팀원에게 주는 구체적인 지시"),
      }),
    )
    .describe("팀원별 업무 배정. 필요한 팀원에게만 배정"),
});
export type Plan = z.infer<typeof PlanSchema>;

export class RefusalError extends Error {}

/** 팀장이 업무를 분석해 팀원에게 배분 (구조화된 JSON 출력) */
export async function makePlan(system: string, prompt: string, memberIds: number[]): Promise<Plan> {
  if (!client) return demoPlan(prompt, memberIds);

  const res = await client.beta.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    ...FALLBACK,
    output_config: { effort: "medium", format: betaZodOutputFormat(PlanSchema) },
    system,
    messages: [{ role: "user", content: prompt }],
  });
  if (res.stop_reason === "refusal") throw new RefusalError("모델이 이 업무 요청을 거절했습니다.");
  if (!res.parsed_output) throw new Error("업무 배분 결과를 해석하지 못했습니다.");
  return res.parsed_output;
}

/** 텍스트를 스트리밍으로 생성하며 조각마다 onDelta 호출 */
export async function streamText(
  system: string,
  prompt: string,
  onDelta: (text: string) => void,
): Promise<string> {
  if (!client) return demoStream(prompt, onDelta);

  const stream = client.beta.messages.stream({
    model: MODEL,
    max_tokens: 64000,
    ...FALLBACK,
    output_config: { effort: "medium" },
    system,
    messages: [{ role: "user", content: prompt }],
  });
  for await (const ev of stream) {
    if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") onDelta(ev.delta.text);
  }
  const final = await stream.finalMessage();
  if (final.stop_reason === "refusal") throw new RefusalError("모델이 이 업무 요청을 거절했습니다.");
  return final.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

// ───────────── 데모 모드 ─────────────
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function demoPlan(prompt: string, memberIds: number[]): Promise<Plan> {
  await sleep(1500);
  const title = prompt.match(/업무 제목: (.*)/)?.[1] ?? "업무";
  const parts = ["자료 조사와 현황 파악", "핵심 내용 초안 작성", "리스크와 개선점 검토"];
  return {
    analysis: `[데모] "${title}" 업무를 팀원 ${memberIds.length}명에게 나눠 진행합니다.`,
    assignments: memberIds.map((id, i) => ({
      agent_id: id,
      instruction: `"${title}" 관련 ${parts[i % parts.length]}을 맡아주세요.`,
    })),
  };
}

async function demoStream(prompt: string, onDelta: (t: string) => void): Promise<string> {
  const isSummary = prompt.includes("팀원들의 결과물");
  const text = isSummary
    ? "## 최종 보고\n\n[데모 모드] 팀원들의 결과물을 종합했습니다.\n\n- 핵심 결론: 계획대로 진행 가능\n- 다음 단계: 세부 일정 확정 및 담당자 지정\n- 리스크: 일정 지연 가능성, 리소스 부족\n\n실제 AI 응답을 보려면 `ANTHROPIC_API_KEY`를 설정하고 서버를 재시작하세요."
    : "[데모 모드] 맡은 업무를 진행했습니다.\n\n1. 현황을 정리했습니다.\n2. 초안을 작성했습니다.\n3. 검토 의견을 덧붙였습니다.\n\n실제 내용은 API 키 설정 후 생성됩니다.";
  let out = "";
  for (const ch of text.match(/.{1,4}/gs) ?? []) {
    await sleep(60 + Math.random() * 80);
    out += ch;
    onDelta(ch);
  }
  return out;
}
