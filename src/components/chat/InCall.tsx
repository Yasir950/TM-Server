"use client";

import { CALL } from "@/lib/brand";
import { Icon } from "../icons";
import { useChat } from "./store";

// Headphones next to a name while that person is in a call anywhere in the workspace, like Slack.
// Only says that they're in one, never where.
export function InCallIcon({ userId, size = 13, className = "" }: { userId?: string; size?: number; className?: string }) {
  const { huddles } = useChat();
  if (!userId || !Object.values(huddles).some((ids) => ids.includes(userId))) return null;
  return (
    <span className={`flex shrink-0 self-center text-tm-green ${className}`} title={`In a ${CALL}`}>
      <Icon name="headphones" size={size} />
    </span>
  );
}
