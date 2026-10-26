export type CharacterCard = {
  id: string;
  name: string;
  description: string;
  personality: string;
  scenario: string;
  systemPrompt: string;
  postHistoryInstructions: string;
  creatorNotes: string;
  firstMessage: string;
  exampleMessages: string;
  creator: string;
  tags: string[];
  avatar?: string;
  rawCard: Record<string, unknown>;
  createdAt: number;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
};

export type ChatSession = {
  id: string;
  characterId: string;
  title: string;
  updatedAt: number;
  messages: ChatMessage[];
};

export type ModelSettings = {
  baseUrl: string;
  model: string;
  temperature: number;
};

export type AppData = {
  characters: CharacterCard[];
  chats: ChatSession[];
  settings: ModelSettings;
};
