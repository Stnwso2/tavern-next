import type { CharacterCard, ChatMessage } from "./types";
import { makeId } from "./storage";

const asText = (value: unknown) => (typeof value === "string" ? value : "");
const asObject = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

function decodeBase64Json(value: string): unknown {
  const normalized = value.trim().replace(/\s/g, "");
  try {
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    try { return JSON.parse(normalized); } catch { return null; }
  }
}

async function readPngMetadata(file: File): Promise<unknown> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!signature.every((byte, index) => bytes[index] === byte)) throw new Error("这不是有效的 PNG 文件。");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = view.getUint32(offset);
    const type = new TextDecoder().decode(bytes.subarray(offset + 4, offset + 8));
    const start = offset + 8;
    const chunk = bytes.subarray(start, start + length);
    if (type === "tEXt") {
      const zero = chunk.indexOf(0);
      if (zero >= 0) {
        const key = new TextDecoder().decode(chunk.subarray(0, zero));
        if (key === "chara" || key === "ccv3") return decodeBase64Json(new TextDecoder().decode(chunk.subarray(zero + 1)));
      }
    }
    if (type === "iTXt") {
      const zero = chunk.indexOf(0);
      if (zero >= 0) {
        const key = new TextDecoder().decode(chunk.subarray(0, zero));
        if (key === "chara" || key === "ccv3") {
          let cursor = zero + 1;
          const compressed = chunk[cursor++] === 1;
          cursor++; // compression method
          while (cursor < chunk.length && chunk[cursor++] !== 0) { /* language tag */ }
          while (cursor < chunk.length && chunk[cursor++] !== 0) { /* translated keyword */ }
          let text = chunk.subarray(cursor);
          if (compressed && "DecompressionStream" in window) {
            const stream = new Blob([text]).stream().pipeThrough(new DecompressionStream("deflate"));
            text = new Uint8Array(await new Response(stream).arrayBuffer());
          }
          return decodeBase64Json(new TextDecoder().decode(text));
        }
      }
    }
    offset = start + length + 4;
    if (type === "IEND") break;
  }
  throw new Error("PNG 中没有找到 SillyTavern 角色卡元数据。请确认这是带有角色卡信息的 PNG。");
}

export async function readCharacterCard(file: File): Promise<CharacterCard> {
  const raw = file.name.toLowerCase().endsWith(".png")
    ? await readPngMetadata(file)
    : JSON.parse(await file.text());
  const root = asObject(raw);
  const data = asObject(root.data ?? root);
  const name = asText(data.name ?? data.char_name ?? root.name).trim();
  if (!name) throw new Error("角色卡缺少名称，暂时无法导入。");
  return {
    id: makeId("char"),
    name,
    description: asText(data.description ?? data.char_description),
    personality: asText(data.personality ?? data.char_personality),
    scenario: asText(data.scenario ?? data.world_scenario),
    systemPrompt: asText(data.system_prompt),
    postHistoryInstructions: asText(data.post_history_instructions),
    creatorNotes: asText(data.creator_notes),
    firstMessage: asText(data.first_mes ?? data.char_greeting),
    exampleMessages: asText(data.mes_example ?? data.example_dialogue),
    creator: asText(data.creator ?? data.character_version),
    tags: Array.isArray(data.tags) ? data.tags.filter((tag): tag is string => typeof tag === "string") : [],
    avatar: file.type === "image/png" || file.name.toLowerCase().endsWith(".png") ? await fileToDataUrl(file) : undefined,
    rawCard: data,
    createdAt: Date.now(),
  };
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("读取角色卡图片失败。"));
    reader.readAsDataURL(file);
  });
}
function isChatExport(value: unknown): value is unknown[] {
  if (Array.isArray(value)) return value.some((item) => {
    const obj = asObject(item);
    return typeof (obj.mes ?? obj.content ?? obj.message) === "string";
  });
  const obj = asObject(value);
  return Array.isArray(obj.messages) || Array.isArray(obj.chat);
}

export async function readChatExport(file: File, characterName: string): Promise<ChatMessage[]> {
  const parsed: unknown = JSON.parse(await file.text());
  const root = asObject(parsed);
  const entries: unknown[] = Array.isArray(parsed) ? parsed : Array.isArray(root.messages) ? root.messages : Array.isArray(root.chat) ? root.chat : [];
  if (!isChatExport(parsed)) throw new Error("这个 JSON 看起来不是聊天记录导出文件。");
  return entries.flatMap((entry): ChatMessage[] => {
    const obj = asObject(entry);
    const content = asText(obj.mes ?? obj.content ?? obj.message);
    if (!content.trim() || obj.is_system === true || obj.is_meta === true) return [];
    const isUser = obj.is_user === true || obj.role === "user" || (typeof obj.name === "string" && obj.name !== characterName && obj.name !== "assistant");
    const date = obj.send_date ? Date.parse(String(obj.send_date)) : NaN;
    return [{ id: makeId("msg"), role: isUser ? "user" : "assistant", content, createdAt: Number.isFinite(date) ? date : Date.now() }];
  });
}
