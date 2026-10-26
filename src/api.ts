import type { ChatMessage, ModelSettings } from "./types";

export type ToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };

const assistantTools = [
  { type: "function", function: { name: "get_app_context", description: "查看当前页面、选中角色和最近对话摘要。", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "search_characters", description: "在已导入的角色卡中查找角色。", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
  { type: "function", function: { name: "switch_section", description: "在聊天、角色库或设置页之间切换。", parameters: { type: "object", properties: { section: { type: "string", enum: ["chat", "characters", "settings"] } }, required: ["section"] } } },
  { type: "function", function: { name: "open_settings", description: "打开模型设置面板。", parameters: { type: "object", properties: {} } } },
  { type: "function", function: { name: "get_recent_messages", description: "读取当前对话最后几条消息。", parameters: { type: "object", properties: { count: { type: "integer", minimum: 1, maximum: 12 } } } } },
  { type: "function", function: { name: "get_recent_logs", description: "读取本地助手工具和导入/模型请求的近期应用事件，用于排查问题。", parameters: { type: "object", properties: { count: { type: "integer", minimum: 1, maximum: 12 } } } } },
  { type: "function", function: { name: "create_character", description: "创建一张简单的本地角色卡。", parameters: { type: "object", properties: { name: { type: "string" }, description: { type: "string" } }, required: ["name", "description"] } } },
] as const;

function endpoint(baseUrl: string) {
  const base = baseUrl.trim().replace(/\/+$/, "");
  if (!base) throw new Error("请先在模型设置中填写 API 地址。");
  return base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
}

function headers(apiKey: string) {
  return { "Content-Type": "application/json", ...(apiKey.trim() ? { Authorization: `Bearer ${apiKey.trim()}` } : {}) };
}

async function checkedJson(response: Response) {
  const body = await response.text();
  if (!response.ok) throw new Error(`模型接口返回 ${response.status}：${body.slice(0, 320) || response.statusText}`);
  try { return JSON.parse(body); } catch { throw new Error("模型接口返回了无法识别的数据，请检查 API 地址。"); }
}

export async function streamChat(
  settings: ModelSettings,
  apiKey: string,
  systemPrompt: string,
  messages: ChatMessage[],
  onToken: (text: string) => void,
) {
  if (!settings.model.trim()) throw new Error("请先在模型设置中填写模型名称。");
  const response = await fetch(endpoint(settings.baseUrl), {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({
      model: settings.model,
      stream: true,
      temperature: settings.temperature,
      messages: [{ role: "system", content: systemPrompt }, ...messages.map(({ role, content }) => ({ role, content }))],
    }),
  });
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`模型接口返回 ${response.status}：${error.slice(0, 320) || response.statusText}`);
  }
  if (!response.body) throw new Error("当前接口没有提供流式响应。");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let output = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const token = JSON.parse(data)?.choices?.[0]?.delta?.content;
        if (typeof token === "string") { output += token; onToken(output); }
      } catch { /* Ignore non-JSON SSE keepalive frames. */ }
    }
    if (done) break;
  }
  if (!output) throw new Error("模型没有返回文字，请确认模型名和接口兼容性。");
}

export async function askAssistant(
  settings: ModelSettings,
  apiKey: string,
  messages: unknown[],
  systemPrompt: string,
) {
  if (!settings.model.trim()) throw new Error("请先在模型设置中填写模型名称。");
  const response = await fetch(endpoint(settings.baseUrl), {
    method: "POST",
    headers: headers(apiKey),
    body: JSON.stringify({
      model: settings.model,
      stream: false,
      temperature: 0.3,
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      tools: assistantTools,
      tool_choice: "auto",
    }),
  });
  return await checkedJson(response);
}
