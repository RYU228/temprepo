import type { Response } from "express";

/** 접속한 모든 브라우저에 실시간 이벤트를 보내는 SSE 허브 */
const clients = new Set<Response>();

export function addClient(res: Response) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(": connected\n\n");
  clients.add(res);
  const ping = setInterval(() => res.write(": ping\n\n"), 25000);
  res.on("close", () => {
    clearInterval(ping);
    clients.delete(res);
  });
}

export type OfficeEvent =
  | { type: "agent_status"; agentId: number; status: string; message?: string }
  | { type: "task_update"; taskId: number }
  | { type: "step_created"; taskId: number; stepId: number }
  | { type: "step_delta"; taskId: number; stepId: number; text: string }
  | { type: "step_done"; taskId: number; stepId: number }
  | { type: "org_changed" };

export function broadcast(ev: OfficeEvent) {
  const data = `data: ${JSON.stringify(ev)}\n\n`;
  for (const c of clients) c.write(data);
}
