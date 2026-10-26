import { get, set } from "idb-keyval";
import type { AppData, CharacterCard, ChatMessage } from "./types";

const STORAGE_KEY = "tavern-next:data:v1";

const demoCharacter: CharacterCard = {
  id: "demo-yunxi",
  name: "云汐",
  description: "在海边旧书店工作的见习占星师。她相信每段相遇都有自己的潮汐。",
  personality: "敏锐、温柔，偶尔用轻松的玩笑掩饰认真。喜欢收集旧地图和奇怪的明信片。",
  scenario: "雨夜，你走进了「潮汐之间」旧书店。窗外的海雾漫进街巷，云汐正点亮柜台上的一盏小灯。",
  systemPrompt: "",
  postHistoryInstructions: "",
  creatorNotes: "",
  firstMessage: "欢迎来到潮汐之间。外面雨很大——要不要先把伞放在门边？我刚煮了茶，今晚的海风好像带来了一点不寻常的消息。",
  exampleMessages: "<START>\n{{user}}: 你说的消息是什么？\n{{char}}: 云汐从摊开的星图上抬起眼睛，指尖停在一颗没有名字的星旁边。\n\n<START>\n{{user}}: 我可以看看这张地图吗？\n{{char}}: 当然。她把地图推过来，纸页边缘还留着一点海盐的痕迹。",
  creator: "Tavern Next",
  tags: ["奇幻", "日常", "海边"],
  rawCard: {},
  createdAt: Date.now(),
};

const starterMessages: ChatMessage[] = [
  { id: "demo-1", role: "assistant", content: "欢迎来到潮汐之间。外面雨很大——要不要先把伞放在门边？我刚煮了茶，今晚的海风好像带来了一点不寻常的消息。", createdAt: Date.now() - 1000 * 60 * 5 },
  { id: "demo-2", role: "user", content: "什么样的消息？", createdAt: Date.now() - 1000 * 60 * 4 },
  { id: "demo-3", role: "assistant", content: "云汐把一张旧地图摊在柜台上。地图的边缘被海水浸得微微卷起，而在原本空白的海面上，多了一座从未见过的小岛。\n\n「你看，」她轻声说，「它只在涨潮的时候出现。」", createdAt: Date.now() - 1000 * 60 * 3 },
];

export const emptyAppData = (): AppData => ({
  characters: [demoCharacter],
  chats: [{ id: "demo-chat", characterId: demoCharacter.id, title: "雨夜来信", updatedAt: Date.now(), messages: starterMessages }],
  settings: { baseUrl: "http://localhost:11434/v1", model: "", temperature: 0.85 },
});

export async function loadAppData(): Promise<AppData> {
  const saved = await get<AppData>(STORAGE_KEY);
  if (!saved || !Array.isArray(saved.characters) || !saved.settings) return emptyAppData();
  return {
    ...emptyAppData(),
    ...saved,
    chats: saved.chats ?? [],
    settings: { ...emptyAppData().settings, ...saved.settings },
  };
}

export async function saveAppData(data: AppData) {
  await set(STORAGE_KEY, data);
}

export function makeId(prefix = "item") {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function makeMessage(role: ChatMessage["role"], content: string): ChatMessage {
  return { id: makeId("msg"), role, content, createdAt: Date.now() };
}
