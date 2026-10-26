import { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen, Camera, Check, Download, FolderOpen,
  MessageCircle, Plus, RefreshCw, Search, Send, Settings2, Sparkles,
  SquarePen, Trash2, X, PanelRightClose, PanelRightOpen, SlidersHorizontal, Upload, UserRound,
} from "lucide-react";
import html2canvas from "html2canvas";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { askAssistant, streamChat } from "./api";
import { makeId, makeMessage, loadAppData, saveAppData } from "./storage";
import { readCharacterCard, readChatExport } from "./tavernImport";
import type { AppData, CharacterCard, ChatMessage, ChatSession } from "./types";
import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update as TauriUpdate } from "@tauri-apps/plugin-updater";
import "./App.css";

type Section = "chat" | "characters";
type AssistantTurn = { id: string; role: "user" | "assistant"; content: string; image?: string };
type ToolLog = { id: string; label: string; detail: string; state: "done" | "running" };
type AppLog = { id: string; at: number; level: "info" | "error"; message: string };

const relativeTime = (timestamp: number) => {
  const delta = Math.max(0, Date.now() - timestamp);
  if (delta < 60_000) return "刚刚";
  if (delta < 3_600_000) return `${Math.floor(delta / 60_000)} 分钟前`;
  if (delta < 86_400_000) return `${Math.floor(delta / 3_600_000)} 小时前`;
  return new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(timestamp);
};

function Avatar({ character, size = "normal" }: { character: CharacterCard; size?: "normal" | "large" | "small" }) {
  if (character.avatar) return <img className={`avatar avatar-${size}`} src={character.avatar} alt="" />;
  return <div className={`avatar avatar-${size} avatar-generated avatar-${character.id.length % 4}`} aria-hidden="true">
    <span>{character.name.slice(0, 1)}</span><i />
  </div>;
}

function messageTitle(messages: ChatMessage[], fallback: string) {
  const firstUser = messages.find((item) => item.role === "user")?.content.trim();
  if (!firstUser) return fallback;
  return firstUser.length > 18 ? `${firstUser.slice(0, 18)}…` : firstUser;
}

function App() {
  const [data, setData] = useState<AppData | null>(null);
  const [ready, setReady] = useState(false);
  const [section, setSection] = useState<Section>("chat");
  const [selectedCharacterId, setSelectedCharacterId] = useState("demo-yunxi");
  const [activeChatId, setActiveChatId] = useState("demo-chat");
  const [searchText, setSearchText] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [apiKeyLoaded, setApiKeyLoaded] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isAssistantOpen, setIsAssistantOpen] = useState(true);
  const [assistantInput, setAssistantInput] = useState("");
  const [assistantTurns, setAssistantTurns] = useState<AssistantTurn[]>([]);
  const [assistantBusy, setAssistantBusy] = useState(false);
  const [toolLog, setToolLog] = useState<ToolLog[]>([]);
  const [appLogs, setAppLogs] = useState<AppLog[]>([]);
  const [screenshot, setScreenshot] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState<AppData["settings"]>({ baseUrl: "", model: "", temperature: 0.85 });
  const [toast, setToast] = useState("");
  const [availableUpdate, setAvailableUpdate] = useState<TauriUpdate | null>(null);
  const [updateBusy, setUpdateBusy] = useState(false);
  const [updateStatus, setUpdateStatus] = useState("启动后自动检查");
  const [updateProgress, setUpdateProgress] = useState<{ received: number; total?: number; finished?: boolean } | null>(null);
  const cardInputRef = useRef<HTMLInputElement>(null);
  const chatImportRef = useRef<HTMLInputElement>(null);
  const chatScrollRef = useRef<HTMLDivElement>(null);
  const assistantScrollRef = useRef<HTMLDivElement>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    void loadAppData().then((loaded) => {
      setData(loaded);
      const initialCharacter = loaded.characters[0];
      if (initialCharacter) setSelectedCharacterId(initialCharacter.id);
      const initialChat = loaded.chats[0];
      if (initialChat) {
        setActiveChatId(initialChat.id);
        setSelectedCharacterId(initialChat.characterId || initialCharacter?.id || "");
      }
      setSettingsDraft(loaded.settings);
      setReady(true);
    }).catch(() => {
      setData({ characters: [], chats: [], settings: { baseUrl: "http://localhost:11434/v1", model: "", temperature: 0.85 } });
      setReady(true);
      notify("本地数据读取失败，已启动空白工作区。");
    });
  }, []);

  useEffect(() => {
    void invoke<string | null>("get_api_key").then((savedApiKey) => {
      setApiKey(savedApiKey ?? "");
      setApiKeyLoaded(true);
    }).catch(() => {
      setApiKeyLoaded(false);
    });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void checkForUpdates(false), 4000);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => () => {
    if (availableUpdate) void availableUpdate.close();
  }, [availableUpdate]);

  useEffect(() => {
    if (ready && data) void saveAppData(data).catch(() => notify("本地数据保存失败，请检查磁盘空间。"));
  }, [data, ready]);

  const selectedCharacter = data?.characters.find((item) => item.id === selectedCharacterId) ?? data?.characters[0];
  const currentChat = data?.chats.find((chat) => chat.id === activeChatId)
    ?? data?.chats.filter((chat) => chat.characterId === selectedCharacter?.id).sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const messages = currentChat?.messages ?? [];
  const visibleCharacters = useMemo(() => (data?.characters ?? []).filter((item) =>
    `${item.name} ${item.description} ${item.tags.join(" ")}`.toLowerCase().includes(searchText.trim().toLowerCase())), [data?.characters, searchText]);
  const characterChats = useMemo(() => (data?.chats ?? []).filter((chat) => chat.characterId === selectedCharacterId)
    .sort((a, b) => b.updatedAt - a.updatedAt), [data?.chats, selectedCharacterId]);

  useEffect(() => {
    chatScrollRef.current?.scrollTo({ top: chatScrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, messages.length ? messages[messages.length - 1].content : ""]);
  useEffect(() => {
    assistantScrollRef.current?.scrollTo({ top: assistantScrollRef.current.scrollHeight, behavior: "smooth" });
  }, [assistantTurns.length, toolLog.length, assistantBusy]);

  function notify(message: string) {
    setToast(message);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(""), 3200);
  }

  async function checkForUpdates(manual = false) {
    if (updateBusy) return;
    setUpdateBusy(true);
    setUpdateStatus("正在检查更新…");
    try {
      const update = await check();
      if (update) {
        setAvailableUpdate(update);
        setUpdateProgress(null);
        setUpdateStatus(`发现新版本 ${update.version}`);
        if (manual) notify(`发现新版本 ${update.version}`);
      } else {
        setUpdateStatus("当前已是最新版本");
        if (manual) notify("当前已是最新版本");
      }
    } catch (error) {
      setUpdateStatus("检查失败，可稍后重试");
      if (manual) notify(error instanceof Error ? `更新检查失败：${error.message}` : "更新检查失败，请稍后重试。");
    } finally {
      setUpdateBusy(false);
    }
  }

  async function installAvailableUpdate() {
    if (!availableUpdate || updateBusy) return;
    setUpdateBusy(true);
    setUpdateStatus("正在下载更新…");
    setUpdateProgress({ received: 0 });
    try {
      await availableUpdate.downloadAndInstall((event) => {
        if (event.event === "Started") {
          setUpdateProgress({ received: 0, total: event.data.contentLength });
        } else if (event.event === "Progress") {
          setUpdateProgress((previous) => ({ received: (previous?.received ?? 0) + event.data.chunkLength, total: previous?.total }));
        } else if (event.event === "Finished") {
          setUpdateProgress((previous) => ({ received: previous?.received ?? 0, total: previous?.total, finished: true }));
        }
      });
      setUpdateStatus("安装完成，正在重启应用…");
      await relaunch();
    } catch (error) {
      setUpdateStatus("更新失败，可稍后重试");
      notify(error instanceof Error ? `更新失败：${error.message}` : "更新失败，请稍后重试。");
      setUpdateBusy(false);
    }
  }

  function dismissUpdatePrompt() {
    setAvailableUpdate(null);
    setUpdateProgress(null);
  }

  function recordLog(message: string, level: AppLog["level"] = "info") {
    setAppLogs((previous) => [...previous, { id: makeId("log"), at: Date.now(), level, message }].slice(-80));
  }

  function updateData(transform: (previous: AppData) => AppData) {
    setData((previous) => previous ? transform(previous) : previous);
  }

  function selectCharacter(character: CharacterCard) {
    setSelectedCharacterId(character.id);
    setSection("chat");
    const mostRecent = data?.chats.filter((chat) => chat.characterId === character.id).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    if (mostRecent) setActiveChatId(mostRecent.id);
    else {
      const fresh: ChatSession = { id: makeId("chat"), characterId: character.id, title: "新对话", updatedAt: Date.now(), messages: character.firstMessage ? [makeMessage("assistant", character.firstMessage)] : [] };
      updateData((previous) => ({ ...previous, chats: [fresh, ...previous.chats] }));
      setActiveChatId(fresh.id);
    }
  }

  function deleteCharacter(character: CharacterCard) {
    const chatsToRemove = data?.chats.filter((chat) => chat.characterId === character.id) ?? [];
    const detail = chatsToRemove.length
      ? `\n\n同时删除该角色的 ${chatsToRemove.length} 段对话。`
      : "";
    if (!window.confirm(`确定删除角色「${character.name}」吗？此操作无法撤销。${detail}`)) return;

    const remainingCharacters = data?.characters.filter((item) => item.id !== character.id) ?? [];
    updateData((previous) => ({
      ...previous,
      characters: previous.characters.filter((item) => item.id !== character.id),
      chats: previous.chats.filter((chat) => chat.characterId !== character.id),
    }));

    if (selectedCharacterId === character.id) {
      const nextCharacter = remainingCharacters[0];
      const nextChat = nextCharacter
        ? data?.chats.filter((chat) => chat.characterId === nextCharacter.id).sort((a, b) => b.updatedAt - a.updatedAt)[0]
        : undefined;
      setSelectedCharacterId(nextCharacter?.id ?? "");
      setActiveChatId(nextChat?.id ?? "");
      setSection("characters");
    }

    recordLog(`删除角色卡：${character.name}`);
    notify(`已删除「${character.name}」${chatsToRemove.length ? `及其 ${chatsToRemove.length} 段对话` : ""}`);
  }

  function startNewChat() {
    if (!selectedCharacter) return notify("先导入一张角色卡。 ");
    const fresh: ChatSession = { id: makeId("chat"), characterId: selectedCharacter.id, title: "新对话", updatedAt: Date.now(), messages: selectedCharacter.firstMessage ? [makeMessage("assistant", selectedCharacter.firstMessage)] : [] };
    updateData((previous) => ({ ...previous, chats: [fresh, ...previous.chats] }));
    setActiveChatId(fresh.id);
    setSection("chat");
    notify("新对话已创建");
  }

  function setChatMessages(chatId: string, transform: (previous: ChatMessage[]) => ChatMessage[]) {
    updateData((previous) => ({
      ...previous,
      chats: previous.chats.map((chat) => {
        if (chat.id !== chatId) return chat;
        const updatedMessages = transform(chat.messages);
        return { ...chat, messages: updatedMessages, updatedAt: Date.now(), title: messageTitle(updatedMessages, chat.title) };
      }),
    }));
  }

  async function sendChat() {
    const text = chatInput.trim();
    if (!text || isSending || !selectedCharacter || !currentChat) return;
    const userMessage = makeMessage("user", text);
    const placeholder = makeMessage("assistant", "");
    const history = [...messages, userMessage];
    const chatId = currentChat.id;
    const character = selectedCharacter;
    setChatInput("");
    setIsSending(true);
    setChatMessages(chatId, (previous) => [...previous, userMessage, placeholder]);
    const prompt = [
      `你正在扮演角色「${character.name}」。请自然地用中文回应，保持角色设定。`,
      character.description && `角色描述：${character.description}`,
      character.personality && `性格：${character.personality}`,
      character.scenario && `场景：${character.scenario}`,
      character.systemPrompt && `角色系统提示：${character.systemPrompt}`,
      character.exampleMessages && `示例对话：\n${character.exampleMessages}`,
      "除非用户要求，不要跳出角色，不要替用户决定行动。",
      character.postHistoryInstructions && `对话后置指令：${character.postHistoryInstructions}`,
    ].filter(Boolean).join("\n\n");
    try {
      await streamChat(data!.settings, apiKey, prompt, history, (content) => {
        setChatMessages(chatId, (previous) => previous.map((message) => message.id === placeholder.id ? { ...message, content } : message));
      });
      recordLog(`角色回复已完成：${character.name}`);
    } catch (error) {
      setChatMessages(chatId, (previous) => previous.filter((message) => message.id !== placeholder.id));
      recordLog("角色回复请求失败；请检查模型地址、模型名和连接状态。", "error");
      notify(error instanceof Error ? error.message : "生成失败，请检查模型设置和网络连接。");
    } finally {
      setIsSending(false);
    }
  }

  async function importCharacter(file?: File) {
    if (!file) return;
    try {
      const character = await readCharacterCard(file);
      const opening = character.firstMessage ? [makeMessage("assistant", character.firstMessage)] : [];
      const chat: ChatSession = { id: makeId("chat"), characterId: character.id, title: "初次见面", updatedAt: Date.now(), messages: opening };
      updateData((previous) => ({ ...previous, characters: [character, ...previous.characters], chats: [chat, ...previous.chats] }));
      setSelectedCharacterId(character.id);
      setActiveChatId(chat.id);
      setSection("chat");
      recordLog(`导入角色卡：${character.name}`);
      notify(`已导入角色卡「${character.name}」`);
    } catch (error) {
      recordLog("角色卡导入失败；请确认 PNG 内含角色卡元数据，或 JSON 是角色卡格式。", "error");
      notify(error instanceof Error ? error.message : "角色卡导入失败。");
    }
  }

  async function importChat(file?: File) {
    if (!file || !currentChat || !selectedCharacter) return;
    try {
      const imported = await readChatExport(file, selectedCharacter.name);
      if (!imported.length) throw new Error("聊天记录为空或格式不受支持。");
      setChatMessages(currentChat.id, (previous) => [...previous, ...imported]);
      recordLog(`导入 ${imported.length} 条聊天记录：${selectedCharacter.name}`);
      notify(`已导入 ${imported.length} 条消息到「${selectedCharacter.name}」`);
    } catch (error) {
      recordLog("聊天记录导入失败；请检查 JSON 文件是否为酒馆聊天导出。", "error");
      notify(error instanceof Error ? error.message : "聊天记录导入失败。");
    }
  }

  function openSettings() {
    if (data) setSettingsDraft(data.settings);
    setSettingsOpen(true);
  }

  async function saveSettings() {
    if (!apiKeyLoaded) {
      notify("无法访问 Windows 凭据管理器，请重启应用后重试。");
      return;
    }
    try {
      await invoke("save_api_key", { apiKey: apiKey.trim() });
      updateData((previous) => ({ ...previous, settings: settingsDraft }));
      setApiKey(apiKey.trim());
      setSettingsOpen(false);
      notify("模型设置已保存；聊天和助手共用此密钥");
    } catch {
      notify("API 密钥未能保存到 Windows 凭据管理器。");
    }
  }

  async function clearApiKey() {
    if (!apiKeyLoaded) {
      notify("无法访问 Windows 凭据管理器，请重启应用后重试。");
      return;
    }
    try {
      await invoke("save_api_key", { apiKey: "" });
      setApiKey("");
      notify("API 密钥已从本机清除。");
    } catch {
      notify("API 密钥未能从 Windows 凭据管理器中清除。");
    }
  }

  function exportBackup() {
    if (!data) return;
    const blob = new Blob([JSON.stringify({ spec: "tavern-next-backup-v1", exportedAt: new Date().toISOString(), ...data }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `tavern-next-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    notify("备份文件已导出");
  }

  async function captureScreenshot() {
    const root = document.querySelector(".app-shell") as HTMLElement | null;
    if (!root) return;
    try {
      const canvas = await html2canvas(root, { backgroundColor: "#f7f6f2", scale: 0.55, useCORS: true, logging: false });
      setScreenshot(canvas.toDataURL("image/jpeg", 0.7));
      notify("界面截图已附到助手消息");
    } catch {
      notify("截图失败，请稍后重试。");
    }
  }

  async function executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const log: ToolLog = { id: makeId("tool"), label: name, detail: "正在读取应用…", state: "running" };
    setToolLog((previous) => [...previous, log].slice(-8));
    let result: unknown;
    let detail = "已完成";
    if (!data) result = { error: "应用数据尚未就绪" };
    else if (name === "get_app_context") {
      result = {
        currentSection: section,
        selectedCharacter: selectedCharacter ? { name: selectedCharacter.name, tags: selectedCharacter.tags, description: selectedCharacter.description } : null,
        currentConversation: currentChat?.title,
        messageCount: messages.length,
        model: data.settings.model || "未配置",
        latestAppEvent: appLogs.length ? appLogs[appLogs.length - 1].message : "暂无应用事件",
        availableSections: ["chat", "characters", "settings"],
      };
      detail = "读取当前页面和选中角色";
    } else if (name === "search_characters") {
      const query = String(args.query ?? "").toLowerCase();
      const found = data.characters.filter((card) => `${card.name} ${card.description} ${card.tags.join(" ")}`.toLowerCase().includes(query)).slice(0, 8);
      result = found.map(({ id, name, description, tags }) => ({ id, name, description: description.slice(0, 300), tags }));
      detail = `查找角色：${String(args.query ?? "")}`;
    } else if (name === "switch_section") {
      const target = String(args.section ?? "chat");
      if (target === "settings") { openSettings(); detail = "打开模型设置"; }
      else { setSection(target === "characters" ? "characters" : "chat"); detail = target === "characters" ? "切换到角色库" : "切换到聊天"; }
      result = { ok: true, section: target };
    } else if (name === "open_settings") {
      openSettings(); result = { ok: true }; detail = "打开模型设置";
    } else if (name === "get_recent_messages") {
      const count = Math.max(1, Math.min(12, Number(args.count) || 6));
      result = messages.slice(-count).map(({ role, content }) => ({ role, content: content.slice(0, 1000) }));
      detail = `读取最近 ${count} 条对话`;
    } else if (name === "get_recent_logs") {
      const count = Math.max(1, Math.min(12, Number(args.count) || 8));
      result = appLogs.slice(-count).map(({ at, level, message }) => ({ at: new Date(at).toISOString(), level, message }));
      detail = `读取最近 ${count} 条本地事件`;
    } else if (name === "create_character") {
      const nameValue = String(args.name ?? "新角色").trim().slice(0, 48) || "新角色";
      const description = String(args.description ?? "").trim().slice(0, 1200);
      const created: CharacterCard = { id: makeId("char"), name: nameValue, description, personality: "", scenario: "", systemPrompt: "", postHistoryInstructions: "", creatorNotes: "", firstMessage: "你好，很高兴认识你。", exampleMessages: "", creator: "Tavern Next Assistant", tags: ["助手创建"], rawCard: {}, createdAt: Date.now() };
      const chat: ChatSession = { id: makeId("chat"), characterId: created.id, title: "初次见面", updatedAt: Date.now(), messages: [makeMessage("assistant", created.firstMessage)] };
      updateData((previous) => ({ ...previous, characters: [created, ...previous.characters], chats: [chat, ...previous.chats] }));
      setSelectedCharacterId(created.id); setActiveChatId(chat.id); setSection("chat");
      result = { ok: true, character: { id: created.id, name: created.name } }; detail = `创建角色卡：${created.name}`;
    } else {
      result = { error: `未知工具 ${name}` }; detail = "未知工具";
    }
    setToolLog((previous) => previous.map((item) => item.id === log.id ? { ...item, detail, state: "done" } : item));
    recordLog(`助手操作：${detail}`);
    return result;
  }

  async function sendAssistant(rawText = assistantInput) {
    const text = rawText.trim();
    if ((!text && !screenshot) || assistantBusy || !data) return;
    const attachment = screenshot;
    const userTurn: AssistantTurn = { id: makeId("assistant-user"), role: "user", content: text || "请看一下我附上的界面截图。", image: attachment ?? undefined };
    const prior = [...assistantTurns, userTurn];
    setAssistantTurns(prior);
    setAssistantInput(""); setScreenshot(null); setAssistantBusy(true);
    const assistantSystem = [
      "你是 Tavern Next 内置助手，帮助用户使用酒馆角色卡、管理对话、配置模型和排查本应用问题。用简洁中文回答。",
      "你可以调用提供的应用工具来查看当前页面、查角色、读取最近对话和本地事件、切换页面、打开设置或创建本地角色卡。涉及改变界面或创建内容时，先确认用户明确要求；不要假称完成工具未执行的动作。",
      "不要要求或回显 API 密钥。不要请求任意系统命令、文件系统或网络写入；当前助手只能操作列出的应用内工具。",
      selectedCharacter ? `当前角色：${selectedCharacter.name}。` : "当前没有选中的角色。",
    ].join("\n");
    try {
      const requestMessages: unknown[] = prior.map(({ role, content, image }) => ({
        role,
        content: image ? [{ type: "text", text: content }, { type: "image_url", image_url: { url: image } }] : content,
      }));
      let finalText = "";
      for (let pass = 0; pass < 5; pass += 1) {
        const response = await askAssistant(data.settings, apiKey, requestMessages, assistantSystem) as {
          choices?: Array<{ message?: { role?: string; content?: unknown; tool_calls?: Array<{ id: string; type: "function"; function: { name: string; arguments: string } }> } }>;
        };
        const modelMessage = response.choices?.[0]?.message;
        if (!modelMessage) throw new Error("助手没有返回有效内容。");
        const calls = modelMessage.tool_calls ?? [];
        requestMessages.push({ role: "assistant", content: modelMessage.content ?? "", ...(calls.length ? { tool_calls: calls } : {}) });
        if (!calls.length) {
          finalText = typeof modelMessage.content === "string" ? modelMessage.content : Array.isArray(modelMessage.content) ? modelMessage.content.map((part) => (part as { text?: string }).text ?? "").join("") : "";
          break;
        }
        for (const call of calls) {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(call.function.arguments || "{}"); } catch { /* Keep empty arguments on malformed tool calls. */ }
          const result = await executeTool(call.function.name, args);
          requestMessages.push({ role: "tool", tool_call_id: call.id, name: call.function.name, content: JSON.stringify(result) });
        }
      }
      if (!finalText.trim()) throw new Error("助手调用了多轮工具，但没有生成文字回复。请重试或使用支持工具调用的模型。");
      setAssistantTurns((previous) => [...previous, { id: makeId("assistant-response"), role: "assistant", content: finalText }]);
    } catch (error) {
      recordLog("内置助手请求失败；请确认当前模型支持 OpenAI 风格工具调用。", "error");
      notify(error instanceof Error ? error.message : "助手请求失败，请检查模型配置。");
      setAssistantTurns((previous) => [...previous, { id: makeId("assistant-error"), role: "assistant", content: "这次没有连上模型。请检查 API 地址、模型名和密钥设置后再试。" }]);
    } finally {
      setAssistantBusy(false);
    }
  }

  if (!ready || !data) return <div className="boot-screen"><div className="brand-mark">TN</div><span>正在打开你的酒馆…</span></div>;

  return <div className={`app-shell ${isAssistantOpen ? "assistant-visible" : ""}`}>
    <aside className="sidebar">
      <div className="brand-row">
        <div className="brand-mark">TN</div>
        <div className="brand-copy"><strong>TAVERN NEXT</strong></div>
      </div>

      <div className="side-actions">
        <button className={`side-tab ${section === "chat" ? "selected" : ""}`} onClick={() => setSection("chat")}><MessageCircle size={17} /><span>聊天</span></button>
        <button className={`side-tab ${section === "characters" ? "selected" : ""}`} onClick={() => setSection("characters")}><BookOpen size={17} /><span>角色库</span></button>
      </div>

      <div className="side-section-heading"><span>角色</span><button className="icon-button tiny" title="导入角色卡" onClick={() => cardInputRef.current?.click()}><Plus size={16} /></button></div>
      <label className="search-box"><Search size={15} /><input value={searchText} onChange={(event) => setSearchText(event.target.value)} placeholder="搜索角色" /></label>

      <div className="character-list">
        {visibleCharacters.map((character) => {
          const isSelected = character.id === selectedCharacter?.id;
          const recent = data.chats.filter((chat) => chat.characterId === character.id).sort((a, b) => b.updatedAt - a.updatedAt)[0];
          return <button className={`character-row ${isSelected ? "active" : ""}`} key={character.id} onClick={() => selectCharacter(character)}>
            <Avatar character={character} />
            <span className="character-row-copy"><strong>{character.name}</strong>{recent && <small>{messageTitle(recent.messages, recent.title)}</small>}</span>
            {isSelected && <span className="active-dot" />}
          </button>;
        })}
        {visibleCharacters.length === 0 && <div className="sidebar-empty">没有找到角色</div>}
      </div>

      <div className="side-section-heading chats-heading"><span>最近对话</span><button className="icon-button tiny" title="新对话" onClick={startNewChat}><SquarePen size={15} /></button></div>
      <div className="recent-list">
        {characterChats.slice(0, 6).map((chat) => <button className={`recent-row ${chat.id === (currentChat?.id ?? activeChatId) ? "current" : ""}`} key={chat.id} onClick={() => { setActiveChatId(chat.id); setSection("chat"); }}>
          <MessageCircle size={14} /><span>{messageTitle(chat.messages, chat.title)}</span><small>{relativeTime(chat.updatedAt)}</small>
        </button>)}
        {characterChats.length === 0 && <div className="sidebar-empty compact">开始一段新对话</div>}
      </div>

      <div className="sidebar-footer">
        <button className="profile-row" onClick={openSettings}><div className="profile-avatar"><Settings2 size={16} /></div><span><strong>模型设置</strong><small>{data.settings.model || "未配置"}</small></span><Settings2 size={17} /></button>
      </div>
    </aside>

    <main className="main-panel">
      <header className="topbar">
        <div className="crumbs"><strong>{section === "characters" ? "角色库" : selectedCharacter?.name ?? "酒馆"}</strong></div>
        <div className="topbar-actions">
          <button className="icon-button" title="模型设置" onClick={openSettings}><SlidersHorizontal size={17} /></button>
          <button className={`assistant-toggle ${isAssistantOpen ? "active" : ""}`} onClick={() => setIsAssistantOpen((open) => !open)}>
            <Sparkles size={16} /><span>AI 助手</span>{isAssistantOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
          </button>
        </div>
      </header>

      {section === "characters" ? <section className="library-page">
        <div className="library-heading"><div><h1>角色库</h1></div><button className="primary-button" onClick={() => cardInputRef.current?.click()}><Upload size={16} />导入角色</button></div>
        <div className="library-grid">{data.characters.map((character, index) => <div className="library-card-wrap" key={character.id}>
          <button className="library-card" onClick={() => selectCharacter(character)}>
            <div className={`library-cover cover-${index % 4}`}>{character.avatar ? <img src={character.avatar} alt="" /> : <div className="cover-glow"><span>{character.name.slice(0, 1)}</span></div>}<span className="cover-count">{data.chats.filter((chat) => chat.characterId === character.id).length} 段对话</span></div>
            <div className="library-card-copy"><div><h3>{character.name}</h3><span className="creator-label">{character.creator || "原创角色"}</span></div><p>{character.description || "还没有添加角色简介。"}</p><div className="tag-row">{character.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}</div></div>
          </button>
          <button type="button" className="library-delete-button" aria-label={`删除角色「${character.name}」`} title="删除角色" onClick={() => deleteCharacter(character)}><Trash2 size={16} /><span>删除</span></button>
        </div>)}
          <button className="add-card" onClick={() => cardInputRef.current?.click()}><span><Plus size={22} /></span><strong>导入新角色</strong><small>PNG 角色卡或 JSON</small></button>
        </div>
      </section> : selectedCharacter ? <>
        <div className="character-banner">
          <div className="banner-content"><Avatar character={selectedCharacter} size="large" /><div className="banner-copy"><h1>{selectedCharacter.name}</h1><p>{selectedCharacter.description || ""}</p></div></div>
        </div>

        <div className="chat-toolbar"><div className="conversation-title"><MessageCircle size={15} /><span>{currentChat?.title || "新对话"}</span></div><div className="chat-toolbar-actions"><button className="toolbar-button" onClick={() => chatImportRef.current?.click()}><FolderOpen size={15} />导入聊天</button><button className="toolbar-button" onClick={startNewChat}><Plus size={15} />新对话</button></div></div>

        <section className="chat-scroll" ref={chatScrollRef}>
          <div className="chat-inner">
            {messages.length === 0 && <div className="empty-conversation"><h2>开始对话</h2><p>给 {selectedCharacter.name} 发条消息。</p></div>}
            {messages.map((message) => <article className={`message-row ${message.role === "user" ? "from-user" : "from-character"}`} key={message.id}>
              {message.role === "assistant" && <Avatar character={selectedCharacter} size="small" />}
              <div className="message-body"><div className="message-meta"><strong>{message.role === "user" ? "你" : selectedCharacter.name}</strong><time>{new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(message.createdAt)}</time></div><div className="message-bubble">{message.content ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown> : <div className="typing-dots"><i /><i /><i /></div>}</div></div>
              {message.role === "user" && <div className="user-avatar">你</div>}
            </article>)}
            {isSending && <div className="generation-note"><span className="pulse-dot" />{selectedCharacter.name} 正在思考…</div>}
          </div>
        </section>

        <div className="composer-wrap">
          <form className="chat-composer" onSubmit={(event) => { event.preventDefault(); void sendChat(); }}>
            <textarea value={chatInput} onChange={(event) => setChatInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendChat(); } }} placeholder={`和 ${selectedCharacter.name} 说些什么…`} rows={2} />
            <div className="composer-footer"><span /> <button type="submit" className="send-button" disabled={!chatInput.trim() || isSending} title="发送消息">{isSending ? <span className="mini-spinner" /> : <Send size={16} />}<span>发送</span></button></div>
          </form>
        </div>
      </> : <div className="no-character"><div className="empty-spark"><BookOpen size={22} /></div><h2>先把角色请进来</h2><p>导入 SillyTavern PNG 角色卡或 JSON 文件，开始新的对话。</p><button className="primary-button" onClick={() => cardInputRef.current?.click()}><Upload size={16} />导入角色卡</button></div>}
    </main>

    {isAssistantOpen && <aside className="assistant-panel">
      <div className="assistant-header"><div className="assistant-title-mark"><Sparkles size={17} /></div><div className="assistant-heading"><strong>助手</strong></div><button className="icon-button tiny" title="收起助手" onClick={() => setIsAssistantOpen(false)}><X size={17} /></button></div>
      <div className="assistant-model"><div className="model-status"><span className={data.settings.model ? "connected" : "disconnected"} /><div><strong>{data.settings.model || "模型未配置"}</strong></div></div><button className="icon-button tiny" title="设置模型" onClick={openSettings}><Settings2 size={16} /></button></div>
      <div className="assistant-scroll" ref={assistantScrollRef}>
        {assistantTurns.length === 0 && <div className="assistant-welcome"><h2>需要帮忙吗？</h2><div className="suggestion-list"><button onClick={() => setAssistantInput("总结当前角色设定。")}>总结当前角色 <span>↗</span></button><button onClick={() => setAssistantInput("查找奇幻冒险角色。")}>查找角色 <span>↗</span></button><button onClick={() => setAssistantInput("检查模型配置。")}>检查模型 <span>↗</span></button></div></div>}
        {assistantTurns.map((turn) => <div className={`assistant-turn ${turn.role === "user" ? "assistant-user-turn" : "assistant-bot-turn"}`} key={turn.id}>
          <div className="turn-icon">{turn.role === "user" ? <UserRound size={13} /> : <Sparkles size={13} />}</div>
          <div className="turn-content">{turn.content && (turn.role === "assistant" ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{turn.content}</ReactMarkdown> : <p>{turn.content}</p>)}{turn.image && <img className="turn-image" src={turn.image} alt="界面截图" />}</div>
        </div>)}
        {toolLog.length > 0 && <div className="tool-history"><div className="tool-history-heading"><span>操作记录</span><span>{toolLog.length} 项</span></div>{toolLog.slice(-5).map((log) => <div className="tool-row" key={log.id}><span className="tool-check">{log.state === "done" ? <Check size={12} /> : <span className="mini-spinner" />}</span><span>{log.detail}</span><small>{log.label}</small></div>)}</div>}
        {assistantBusy && <div className="assistant-thinking"><span className="pulse-dot" />助手正在处理<span className="thinking-dots">···</span></div>}
      </div>
      <div className="assistant-composer-wrap">
        {screenshot && <div className="screenshot-attachment"><img src={screenshot} alt="待发送截图" /><span>截图</span><button className="icon-button tiny" onClick={() => setScreenshot(null)}><X size={14} /></button></div>}
        <form className="assistant-composer" onSubmit={(event) => { event.preventDefault(); void sendAssistant(); }}><textarea value={assistantInput} onChange={(event) => setAssistantInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendAssistant(); } }} rows={2} placeholder="问助手…" /><div className="assistant-composer-actions"><button type="button" className="icon-button subtle" title="截图当前界面" onClick={() => void captureScreenshot()}><Camera size={16} /></button><button className="assistant-send" type="submit" disabled={assistantBusy || (!assistantInput.trim() && !screenshot)}><Send size={15} /></button></div></form>
      </div>
    </aside>}

    <input ref={cardInputRef} type="file" accept="image/png,.png,.json,application/json" hidden onChange={(event) => { void importCharacter(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} />
    <input ref={chatImportRef} type="file" accept=".json,application/json" hidden onChange={(event) => { void importChat(event.currentTarget.files?.[0]); event.currentTarget.value = ""; }} />

    {settingsOpen && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}><section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
      <div className="modal-header"><div><h2 id="settings-title">模型设置</h2></div><button className="icon-button" onClick={() => setSettingsOpen(false)}><X size={18} /></button></div>
      <p className="modal-intro">支持 Ollama、LM Studio 和 OpenAI 兼容接口。</p>
      <label className="field-label">API 基础地址<input value={settingsDraft.baseUrl} onChange={(event) => setSettingsDraft((previous) => ({ ...previous, baseUrl: event.target.value }))} placeholder="http://localhost:11434/v1" /></label>
      <div className="preset-row"><button type="button" onClick={() => setSettingsDraft((previous) => ({ ...previous, baseUrl: "http://localhost:11434/v1" }))}>Ollama</button><button type="button" onClick={() => setSettingsDraft((previous) => ({ ...previous, baseUrl: "http://localhost:1234/v1" }))}>LM Studio</button><button type="button" onClick={() => setSettingsDraft((previous) => ({ ...previous, baseUrl: "https://api.openai.com/v1" }))}>OpenAI 兼容</button></div>
      <label className="field-label">模型名称<input value={settingsDraft.model} onChange={(event) => setSettingsDraft((previous) => ({ ...previous, model: event.target.value }))} placeholder="例如：qwen3.5:14b" /></label>
      <div className="field-label"><label htmlFor="api-key-input">API 密钥 <span className="optional-label">本机长期保存 · 聊天和助手共用</span></label><div className="api-key-input-row"><input id="api-key-input" type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} placeholder="输入 API 密钥" autoComplete="new-password" /><button type="button" className="clear-key-button" onClick={() => void clearApiKey()} disabled={!apiKeyLoaded || !apiKey}>清除密钥</button></div></div>
      <label className="field-label temperature-label">回复随机度 <span>{settingsDraft.temperature.toFixed(2)}</span><input type="range" min="0" max="1.5" step="0.05" value={settingsDraft.temperature} onChange={(event) => setSettingsDraft((previous) => ({ ...previous, temperature: Number(event.target.value) }))} /></label>
      <div className="security-note"><span>i</span><p>密钥会一直保存在本机 Windows 凭据管理器，重启后仍可用；点击“清除密钥”即可删除。</p></div>
      <div className="modal-divider" /><div className="backup-row"><div><strong>本地数据备份</strong><span>导出角色卡和对话记录的 JSON 备份</span></div><button className="secondary-button" onClick={exportBackup}><Download size={15} />导出备份</button></div>
      <div className="update-settings-row"><div><strong>软件更新</strong><span>{updateStatus}</span></div><button className="secondary-button" onClick={() => void checkForUpdates(true)} disabled={updateBusy}><RefreshCw size={15} className={updateBusy ? "update-spin" : ""} />检查更新</button></div>
      <div className="modal-footer"><button className="text-button" onClick={() => setSettingsOpen(false)}>取消</button><button className="primary-button" onClick={saveSettings}><Check size={16} />保存设置</button></div>
    </section></div>}

    {availableUpdate && <div className="update-prompt" role="dialog" aria-live="polite" aria-label="发现软件更新">
      <div className="update-prompt-heading"><div><strong>发现新版本 {availableUpdate.version}</strong><span>Tavern Next 可以在应用内完成更新。</span></div><button className="icon-button tiny" onClick={dismissUpdatePrompt} disabled={updateBusy} aria-label="稍后更新"><X size={15} /></button></div>
      {availableUpdate.body && <p>{availableUpdate.body}</p>}
      {updateProgress && <div className="update-progress"><div><span>{updateProgress.finished ? "下载完成" : "正在下载…"}</span><span>{updateProgress.total ? `${Math.min(100, Math.round(updateProgress.received / updateProgress.total * 100))}%` : ""}</span></div><div className="update-progress-track"><span style={{ width: updateProgress.total ? `${Math.min(100, updateProgress.received / updateProgress.total * 100)}%` : "24%" }} /></div></div>}
      <div className="update-prompt-actions"><button className="text-button" onClick={dismissUpdatePrompt} disabled={updateBusy}>稍后</button><button className="primary-button" onClick={() => void installAvailableUpdate()} disabled={updateBusy}><Download size={15} />{updateBusy ? "正在更新…" : "下载并更新"}</button></div>
    </div>}

    {toast && <div className="toast"><span className="toast-dot" />{toast}</div>}
  </div>;
}

export default App;
