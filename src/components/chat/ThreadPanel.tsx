"use client";

import { useEffect } from "react";
import { useChat } from "./store";
import { useMessages, toggleReaction } from "./useMessages";
import { MessageList } from "./ChannelView";
import Composer from "./Composer";
import { MobileBack } from "./Views";

export default function ThreadPanel({ messageId, channelId }: { messageId: string; channelId: string }) {
  const { me, channels, memberships, setThread, channelTitle, markThreadRead } = useChat();
  const { messages, reactions, setReactions, upsert, loading } = useMessages(channelId, messageId);
  const parent = messages[0];
  const channel = channels[channelId];

  // Mark the thread read while it's visible
  useEffect(() => {
    if (document.visibilityState === "visible") markThreadRead(messageId);
    const onVis = () => document.visibilityState === "visible" && markThreadRead(messageId);
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [messageId, messages.length, markThreadRead]);

  return (
    <aside className="tm-slide-in tm-raised flex min-w-0 flex-1 flex-col overflow-hidden bg-white max-md:pb-[env(safe-area-inset-bottom)] md:rounded-2xl lg:w-[400px] lg:flex-none lg:shrink-0">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-tm-line px-2 md:px-5">
        <MobileBack onClick={() => setThread(null)} />
        <div className="min-w-0 flex-1">
          <div className="font-semibold">Thread</div>
          <div className="truncate text-xs text-zinc-400">{channel?.kind === "dm" ? channelTitle(channel) : channel ? `#${channel.name}` : ""}</div>
        </div>
        <button onClick={() => setThread(null)} className="hidden rounded-full p-1.5 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 md:block" aria-label="Close thread">
          ✕
        </button>
      </header>
      <MessageList messages={messages} reactions={reactions} loading={loading} inThread onReact={(m, e) => toggleReaction(m, e, me.id, reactions, setReactions)} />
      {parent && !parent.deleted_at && memberships[channelId] && (
        <Composer
          channelId={channelId}
          parentId={messageId}
          placeholder="Reply…"
          onSent={upsert}
          alsoSendLabel={channel?.kind === "dm" ? "Also send as direct message" : `Also send to #${channel?.name}`}
        />
      )}
    </aside>
  );
}
