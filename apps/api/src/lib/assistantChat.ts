import { ConversationKind } from "@prisma/client";
import { prisma } from "./prisma.js";
import { ensureAssistantBotUserId } from "./criticalRecipients.js";

export async function ensureAssistantDmConversation(recipientUserId: string): Promise<string> {
  const botId = await ensureAssistantBotUserId();
  if (recipientUserId === botId) {
    throw new Error("Cannot open assistant chat with bot self");
  }

  const existing = await prisma.conversation.findFirst({
    where: {
      kind: ConversationKind.DM,
      AND: [
        { participants: { some: { userId: botId } } },
        { participants: { some: { userId: recipientUserId } } }
      ]
    },
    select: { id: true }
  });
  if (existing) return existing.id;

  const created = await prisma.conversation.create({
    data: {
      kind: ConversationKind.DM,
      participants: {
        create: [{ userId: botId }, { userId: recipientUserId }]
      }
    }
  });
  return created.id;
}

export async function postAssistantChatMessage(recipientUserId: string, text: string): Promise<void> {
  const botId = await ensureAssistantBotUserId();
  const conversationId = await ensureAssistantDmConversation(recipientUserId);
  await prisma.message.create({
    data: {
      conversationId,
      senderId: botId,
      text: text.trim().slice(0, 4000)
    }
  });
  await prisma.conversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() }
  });
}
