import { useLocalSearchParams } from "expo-router";
import Conversation from "@/components/Conversation";

// A thread: the parent message and its replies. ?c= is the channel it's in.
export default function ThreadScreen() {
  const { id, c } = useLocalSearchParams<{ id: string; c: string }>();
  return <Conversation key={id} channelId={c} parentId={id} />;
}
