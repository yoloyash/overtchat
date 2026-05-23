import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const DEFAULT_URL = "http://10.0.0.200:4717";

type Status =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; body: unknown }
  | { kind: "error"; message: string };

export default function PingScreen() {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function ping() {
    setStatus({ kind: "loading" });
    try {
      const res = await fetch(`${url.replace(/\/+$/, "")}/api/ping`);
      const text = await res.text();
      if (!res.ok) {
        setStatus({ kind: "error", message: `HTTP ${res.status}: ${text}` });
        return;
      }
      setStatus({ kind: "ok", body: JSON.parse(text) });
    } catch (err) {
      setStatus({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    }
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.inner}>
        <Text style={styles.title}>overtchat ping</Text>

        <TextInput
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="http://10.0.0.200:4717"
          style={styles.input}
        />

        <Pressable onPress={ping} style={styles.button}>
          <Text style={styles.buttonText}>{status.kind === "loading" ? "pinging..." : "ping"}</Text>
        </Pressable>

        {status.kind === "ok" && (
          <View style={[styles.result, styles.ok]}>
            <Text style={styles.resultText}>{JSON.stringify(status.body, null, 2)}</Text>
          </View>
        )}
        {status.kind === "error" && (
          <View style={[styles.result, styles.err]}>
            <Text style={styles.resultText}>{status.message}</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#0b0b0d" },
  inner: { flex: 1, padding: 24, gap: 16, justifyContent: "center" },
  title: { color: "#fff", fontSize: 28, fontWeight: "600", marginBottom: 12 },
  input: {
    backgroundColor: "#17171a",
    color: "#fff",
    borderRadius: 8,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  button: {
    backgroundColor: "#3b82f6",
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: "center",
  },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  result: { padding: 14, borderRadius: 8, marginTop: 8 },
  ok: { backgroundColor: "#0f2e1f", borderWidth: 1, borderColor: "#1f7a4d" },
  err: { backgroundColor: "#2e0f15", borderWidth: 1, borderColor: "#7a1f2f" },
  resultText: { color: "#fff", fontFamily: "monospace", fontSize: 13 },
});
