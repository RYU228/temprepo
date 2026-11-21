import { useCallback, useEffect, useRef, useState } from "react";

export type Department = { id: number; name: string; description: string; color: string };
export type Agent = {
  id: number;
  department_id: number;
  name: string;
  title: string;
  persona: string;
  color: string;
  is_lead: number;
  status: AgentStatus;
};
export type AgentStatus = "idle" | "thinking" | "working" | "waiting" | "meeting";
export type TaskStatus = "queued" | "planning" | "working" | "reviewing" | "done" | "failed";
export type Task = {
  id: number;
  department_id: number;
  title: string;
  description: string;
  status: TaskStatus;
  result: string | null;
  error: string | null;
  created_at: string;
  finished_at: string | null;
};
export type TaskStep = {
  id: number;
  task_id: number;
  agent_id: number | null;
  kind: "plan" | "work" | "summary";
  instruction: string;
  content: string;
  status: "running" | "done" | "failed";
};

type OfficeEvent =
  | { type: "agent_status"; agentId: number; status: AgentStatus; message?: string }
  | { type: "task_update"; taskId: number }
  | { type: "step_created"; taskId: number; stepId: number }
  | { type: "step_delta"; taskId: number; stepId: number; text: string }
  | { type: "step_done"; taskId: number; stepId: number }
  | { type: "org_changed" };

export const STATUS_LABEL: Record<AgentStatus, string> = {
  idle: "대기",
  thinking: "구상 중",
  working: "작업 중",
  waiting: "결과 대기",
  meeting: "보고 준비",
};
export const TASK_LABEL: Record<TaskStatus, string> = {
  queued: "대기열",
  planning: "업무 배분",
  working: "진행 중",
  reviewing: "종합 중",
  done: "완료",
  failed: "실패",
};

export async function api<T = unknown>(url: string, method = "GET", body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error || `요청 실패 (${res.status})`);
  return data as T;
}

/** 실시간으로 스트리밍된 단계별 텍스트. sawStart=true 면 처음부터 다 받은 것 */
export type LiveStep = { text: string; sawStart: boolean };

export function useOffice() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [info, setInfo] = useState<{ demo: boolean; model: string } | null>(null);
  const [connected, setConnected] = useState(false);
  const [stepTick, setStepTick] = useState(0);
  const live = useRef(new Map<number, LiveStep>());
  const listeners = useRef(new Set<(ev: OfficeEvent) => void>());
  const refetchTimer = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    const s = await api<{ departments: Department[]; agents: Agent[]; tasks: Task[] }>("/api/state");
    setDepartments(s.departments);
    setAgents(s.agents);
    setTasks(s.tasks);
  }, []);

  const scheduleRefresh = useCallback(() => {
    window.clearTimeout(refetchTimer.current);
    refetchTimer.current = window.setTimeout(() => refresh().catch(console.error), 120);
  }, [refresh]);

  useEffect(() => {
    refresh().catch(console.error);
    api<{ demo: boolean; model: string }>("/api/info").then(setInfo).catch(console.error);

    const es = new EventSource("/api/events");
    es.onopen = () => {
      setConnected(true);
      refresh().catch(console.error);
    };
    es.onerror = () => setConnected(false);
    es.onmessage = (m) => {
      const ev = JSON.parse(m.data) as OfficeEvent;
      switch (ev.type) {
        case "agent_status":
          setAgents((prev) => prev.map((a) => (a.id === ev.agentId ? { ...a, status: ev.status } : a)));
          break;
        case "step_created":
          live.current.set(ev.stepId, { text: "", sawStart: true });
          setStepTick((t) => t + 1);
          break;
        case "step_delta": {
          const cur = live.current.get(ev.stepId) ?? { text: "", sawStart: false };
          cur.text += ev.text;
          live.current.set(ev.stepId, cur);
          setStepTick((t) => t + 1);
          break;
        }
        case "step_done":
          setStepTick((t) => t + 1);
          break;
        case "task_update":
        case "org_changed":
          scheduleRefresh();
          break;
      }
      for (const l of listeners.current) l(ev);
    };
    return () => es.close();
  }, [refresh, scheduleRefresh]);

  const subscribe = useCallback((fn: (ev: OfficeEvent) => void) => {
    listeners.current.add(fn);
    return () => {
      listeners.current.delete(fn);
    };
  }, []);

  return { departments, agents, tasks, info, connected, refresh, subscribe, live: live.current, stepTick };
}

export type Office = ReturnType<typeof useOffice>;
