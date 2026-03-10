import { GoogleGenAI, Chat, Part } from "@google/genai";
import { Message, SupportMode } from "../types";
import { SYSTEM_INSTRUCTION, MODEL_LIST, DEFAULT_MODEL } from "../constants";

let chatSession: Chat | null = null;
let genAI: GoogleGenAI | null = null;
let currentSessionModelId: string | null = null;

// Get API Key Priority: localStorage only (User inputted)
export const getApiKey = (): string | null => {
  const localKey = localStorage.getItem('gemini_api_key');
  if (localKey && localKey.trim()) return localKey;
  return null;
};

export const initializeChat = async (apiKey: string, modelId: string) => {

  genAI = new GoogleGenAI({ apiKey });
  chatSession = genAI.chats.create({
    model: modelId,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      temperature: 0.3,
      maxOutputTokens: 4000,
    },
    history: [],
  });
  currentSessionModelId = modelId;
  console.log(`✅ Chat initialized with model: ${modelId}`);
};

export const sendMessageToGemini = async (
  text: string,
  currentMode: SupportMode,
  history: Message[],
  image?: string,
  preferredModelId: string = DEFAULT_MODEL
): Promise<string> => {

  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("API_MISSING");
  }

  // Fallback order as defined in instructions
  // If preferredModelId is not in the list (unlikely), we add it to front
  const standardFallback = ['gemini-3-flash-preview', 'gemini-3-pro-preview', 'gemini-2.5-flash'];

  let modelQueue = [preferredModelId];
  // Add others effectively
  for (const m of standardFallback) {
    if (m !== preferredModelId) modelQueue.push(m);
  }

  const contextAwareMessage = `[CHẾ ĐỘ HIỆN TẠI: ${currentMode.toUpperCase()}]

Câu hỏi/Trả lời của học sinh:
${text}`;

  let messageContent: string | Part[] = contextAwareMessage;

  if (image) {
    // Assuming image is base64 string
    const parts: Part[] = [];
    parts.push({ text: contextAwareMessage });

    try {
      const [mimeTypeHeader, base64Data] = image.split(';base64,');
      const mimeType = mimeTypeHeader.split(':')[1];
      parts.push({
        inlineData: {
          mimeType: mimeType,
          data: base64Data
        }
      });
      messageContent = parts;
    } catch (e) {
      console.error("Error parsing image", e);
    }
  }

  let lastError: any = null;

  for (const modelId of modelQueue) {
    try {
      console.log(`🔄 Attempting with model: ${modelId}`);

      // Re-initialize if needed
      if (!chatSession || currentSessionModelId !== modelId) {
        await initializeChat(apiKey, modelId);
      }

      if (!chatSession) throw new Error("Session init failed");

      const response = await chatSession.sendMessage({ message: messageContent });
      return response.text || "Cô đang suy nghĩ, em đợi chút nhé...";

    } catch (error: any) {
      console.error(`❌ Model ${modelId} failed:`, error);
      lastError = error;
      // Reset session to force re-creation
      chatSession = null;
      currentSessionModelId = null;
      // Continue to next model
    }
  }

  // If we get here, all models failed
  const errorMsg = lastError?.message || JSON.stringify(lastError);

  // Extract specific error code if possible for UI
  if (errorMsg.includes("429") || errorMsg.includes("RESOURCE_EXHAUSTED")) {
    throw new Error("429 RESOURCE_EXHAUSTED");
  }

  throw new Error(`Lỗi hệ thống: ${errorMsg}`);
};

export const generateDailyReport = async (messages: Message[]): Promise<string> => {
  const apiKey = getApiKey();
  if (!apiKey) return "Vui lòng nhập API Key để tạo báo cáo.";

  const prompt = `Dựa trên đoạn hội thoại sau, hãy lập "BÁO CÁO HỖ TRỢ HỌC SINH" theo mẫu đã quy định trong System Instruction.
Chỉ trích xuất thông tin từ cuộc hội thoại này.

Hội thoại:
${messages.map(m => `${m.role}: ${m.text}`).join('\n')}`;

  // Try with flash first for reports
  const modelId = 'gemini-3-flash-preview';

  try {
    const ai = new GoogleGenAI({ apiKey });
    const response = await ai.models.generateContent({
      model: modelId,
      contents: prompt
    });
    return response.text || "Không thể tạo báo cáo.";
  } catch (error) {
    console.error("Report generation failed:", error);
    return "Lỗi khi tạo báo cáo. Vui lòng thử lại sau.";
  }
};
