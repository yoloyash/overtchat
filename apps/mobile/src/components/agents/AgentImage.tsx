import { useState } from "react";
import { Pressable } from "react-native";
import { Image } from "expo-image";
import ImageViewing from "react-native-image-viewing";
import { getApiBase, getAuthCookie } from "@/lib/api";
import { agentImageSource } from "@/lib/agents/model";
import { AgentText } from "./AgentPrimitives";

export function AgentImage({ url, label }: { url: string; label: string }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  const source = agentImageSource(url, getApiBase(), getAuthCookie());
  if (!source)
    return <AgentText muted>{label} (preview unavailable)</AgentText>;
  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`View ${label}`}
        onPress={() => {
          setFailed(false);
          setOpen(true);
        }}
      >
        {failed ? (
          <AgentText muted>{label} · Tap to retry preview</AgentText>
        ) : (
          <Image
            source={source}
            style={{ width: 160, height: 120, borderRadius: 10 }}
            contentFit="cover"
            onError={() => setFailed(true)}
          />
        )}
      </Pressable>
      <ImageViewing
        images={[source]}
        imageIndex={0}
        visible={open}
        onRequestClose={() => setOpen(false)}
      />
    </>
  );
}
